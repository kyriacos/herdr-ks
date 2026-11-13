import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, run, openOverlay, theme, window, shared, setShared, layout, settings, focused, props, nextCommand, agents, panes, terminals, hc, exec, appHome } from "herdr";
import { closeTab, closePane, tabName, tabProgram } from "./close.js";
import * as sessions from "./lib/sessions.js";
import * as closing from "./lib/closing.js";
import { pref } from "./lib/prefs.js";
import { menuView, shortcut } from "./menu.js";
import { dimmed } from "./lib/focus.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    // A tab's right-click menu is this mod again, opened as a popup with props { menu: { id, space } }.
    if (props()?.menu) {
      this.at = 0;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.recordSessions(cx);
    // ks: close for real what has waited 30 s (lib/closing.js); redraw the Undo chip's countdown meanwhile.
    closing.finish();
    cx.timer.every(1000, (cx) => { if (closing.pending().length) { closing.finish(); cx.notify(); } });
    // cmd-w: the shown tab, or `close:<id>` for another one. cmd-shift-w (`close-pane`): the focused pane,
    // here and not in ks-pane, as the tab bar has one copy and every pane header would get it.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "close") closeTab(focused()?.tab ?? spaces().find(s => s.active)?.tabs.find(c => c.active)?.id);
        else if (command.startsWith("close:")) closeTab(command.slice("close:".length));
        else if (command === "close-pane" && focused()?.pane) closePane(focused().pane);
        // ks: undo a close (⌘⇧T: the latest; the toast: `undo:<key>`), lib/closing.js.
        else if (command.startsWith("soft-close:")) closing.closeTab(command.slice("soft-close:".length));
        else if (command === "close-space") { const sp = spaces().find(s => s.active); if (sp) closing.askSpace(sp.id); }
        else if (command === "undo") closing.undo(null);
        else if (command.startsWith("undo:")) closing.undo(command.slice("undo:".length));
        // Local change: panel:files / panel:changes (cmd-shift-e / cmd-shift-g) toggle the side panel like its buttons.
        else if (command.startsWith("panel:")) {
          const id = command.slice("panel:".length), root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
          if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }
        cx.notify();
      }
    });
  }

  // ks: which Claude Code session each agent terminal runs, every 20 s, into shared "ks.sessions" (see
  // lib/sessions.js), so a terminal lost to a reboot can resume it. The session log is read again when the
  // agent's pid changes, every 3 minutes (for its title), and every sweep until it has a conversation; shared state is written only when something changed.
  recordSessions(cx) {
    const seen = new Map(); // pid -> { at, info }
    const python = async (args) => {
      let r = await exec("python3", args).catch(() => null);
      if (!r || r.code !== 0) r = await exec("/usr/bin/python3", args).catch(() => null);
      return r?.code === 0 ? r.stdout : null;
    };
    const sweep = async () => {
      const live = agents().filter((a) => /claude/i.test(a.app ?? ""));
      const pids = {};
      for (const a of live) {
        const r = await hc(["get", a.address]).catch(() => null);
        try { const pid = JSON.parse(r.stdout).foreground?.pid; if (pid) pids[a.address] = pid; } catch {}
      }
      const stale = Object.values(pids).filter((pid) => !seen.get(pid)?.info || Date.now() - seen.get(pid).at > 180000);
      if (stale.length) {
        const out = await python(["-I", `${appHome()}/mods/ks-tabs/session_of.py`, ...stale.map(String)]);
        let found = {}; try { found = JSON.parse(out ?? "{}"); } catch {}
        for (const pid of stale) seen.set(pid, { at: Date.now(), info: found[String(pid)] ?? null });
      }
      const before = sessions.all(), next = { ...before }, ps = panes();
      let changed = false;
      for (const a of live) {
        const info = seen.get(pids[a.address])?.info;
        if (!info) continue;
        const old = before[a.address] ?? {}, pane = ps.find((p) => p.terminal === a.address)?.pane ?? old.pane ?? null;
        const rec = { sessionId: info.sessionId, cwd: info.cwd, title: info.title ?? null, pane, tab: a.tab ?? old.tab ?? null, carded: old.carded ?? null };
        const same = ["sessionId", "cwd", "title", "pane", "tab"].every((k) => rec[k] === old[k]);
        // `at` (last seen running) is refreshed at most every 10 minutes, so a sweep doesn't write for nothing.
        if (!same || Date.now() - (old.at ?? 0) > 600000) { next[a.address] = { ...rec, at: Date.now() }; changed = true; }
      }
      // A terminal that came back after a reboot (made after its session last ran) and shows a shell: draw the
      // session's card in it once, with resume on Enter.
      const alive = new Set(live.map((a) => a.address));
      for (const [addr, rec] of Object.entries(next)) {
        if (alive.has(addr) || !rec.sessionId || !pref("resumeCard")) continue;
        const r = await hc(["get", addr]).catch(() => null);
        let info = null; try { info = JSON.parse(r.stdout); } catch {}
        if (!info || info.state !== "live" || !(info.created_ms > (rec.at ?? 0)) || rec.carded === info.created_ms) continue;
        if (!/(^|\/)-?(zsh|bash|fish|sh|dash|ksh)$/.test(info.foreground?.argv?.[0] ?? "")) continue;
        next[addr] = { ...rec, carded: info.created_ms }; changed = true;
        sessions.showCard(addr, rec);
      }
      // Forget terminals that are gone (their tab closed) once a week has passed, and only once Herdr knows them.
      const known = new Set((terminals() ?? []).map((t) => t.address));
      if (known.size) for (const [addr, rec] of Object.entries(next)) {
        if (!known.has(addr) && Date.now() - (rec.at ?? 0) > 7 * 86400000) { delete next[addr]; changed = true; }
      }
      if (changed) setShared(sessions.KEY, next);
    };
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await sweep(); } catch (e) { console.log("ks-tabs: session sweep failed", String(e)); }
      busy = false;
    };
    cx.spawn(async () => tick());
    cx.timer.every(20000, () => { tick(); });
  }

  // Herdr's own tab menu (Rename, New tab, Close), with Close going through closeTab, then when
  // closing asks: Herdr's Settings have no place for that, and a mod can't add one.
  renderMenu() {
    const { id, space } = props().menu;
    return menuView(this, [
      { label: "Rename", icon: "square-pen", act: () => run("tab.rename", { id }), keys: shortcut(["tab.rename"]) },
      { label: "New tab", icon: "plus", act: () => run("tab.new", { space }), keys: shortcut(["tab.new"]) },
      { label: "Close", icon: "x", sep: true, act: () => closeTab(id), keys: shortcut(["ks-tabs.close", "tab.close"]) },
    ], "tab");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // ks: focus mode dims this until hovered (lib/focus.js).
  render(cx) { return dimmed(this, this.renderInner(cx)); }

  renderInner() {
    if (props()?.menu) return this.renderMenu();
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = (space?.tabs ?? []).filter(c => !closing.hiddenTab(c.id));
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const allPanes = panes();
    // ks: a tab's terminals whose Claude session can be resumed (their agent is gone; the pane shows a shell).
    const resumables = (c) => allPanes.filter((p) => p.tab === c.id && p.terminal)
      .map((p) => ({ address: p.terminal, rec: sessions.resumable(p.terminal, !p.program?.agent) })).filter((x) => x.rec);
    const item = (c, i) => {
      const program = tabProgram(c), name = tabName(c, program), lost = resumables(c);
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "ks-tabs", kind: "popup", width: 220, height: 237, props: { menu: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(lost.length > 0, el => el.child(div().id(`resume-${c.id}`).flex_none().h(18).px(6).flex().items_center().rounded(5)
          .bg(t.accent + "22").text_size(10.5).font_semibold().text_color(t.accent).hover(s => s.bg(t.accent + "40"))
          .tooltip(`Resume ${lost.map(x => `"${sessions.label(x.rec)}"`).join(", ")} · Claude ran here ${sessions.ago(Math.max(...lost.map(x => x.rec.at ?? 0)))}`)
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.select", { id: c.id }); for (const x of lost) sessions.resume(x.address, x.rec); })
          .child(lost.length > 1 ? `↻ Resume ${lost.length}` : "↻ Resume")))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .when(closing.pending().length > 0, el => {
        const list = closing.pending(), last = list[list.length - 1], left = Math.max(0, Math.ceil((last.until - Date.now()) / 1000));
        return el.child(h_flex().id("undo-close").flex_none().h(24).px(8).gap(6).items_center().rounded(6)
          .bg(t.accent + "1f").text_size(11.5).text_color(t.accent).hover(s => s.bg(t.accent + "3a"))
          .tooltip(list.length > 1 ? `${list.length} closing: ${list.map(e => `${e.kind} ${e.name}`).join(", ")}. ⌘⇧T undoes the latest.` : "⌘⇧T")
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closing.undo(last.key); })
          .child(div().font_semibold().child("↶ Undo"))
          .child(div().max_w(160).truncate().child(`${last.kind} ${last.name}`))
          .child(div().text_color(t.dim).child(`${left}s`)));
      })
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      // ks: open pull requests for the session's worktrees (ks-prs).
      .child(panelButton("prs", "PRs", "mods/ks-changes/changes.svg"))
      // ks: every ks setting in one panel (ks-settings).
      .child(button("ks-settings", "⚙", () => openOverlay({ mod: "ks-settings", kind: "dialog", width: 860, height: 620 })))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/ks-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/ks-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/ks-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
