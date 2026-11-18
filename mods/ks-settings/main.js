// ks-settings: every setting of the ks layout in one place, like Herdr's Settings but for our own mods. Opened from
// the ⚙ in the tab bar, the main menu ("herdr-ks settings…") or cmd-shift-,. Each section writes the shared state the
// mods already read, so changes apply at once:
//   ks-zen.focus (focus mode), ks-zen.prefs (zen), ks-keys.config (key modes: shown here, edited in its editor),
//   ks-tabs.confirm-close / ks-pane.confirm-close (asking before closing), ks.prefs (lib/prefs.js: undo time,
//   resume card, idle main checkouts, PR toasts, layout and mod options), ks.sessions (remembered Claude sessions),
//   and the GitHub cache. Layout: which sidebar sections and panel buttons show, the side panel's side and the
//   sidebar's order (lib/arrange.js applies those with layout.set).
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { run, theme, props, closeOverlay, shared, setShared, layout, exec, appHome, notify } from "herdr";
import { focusOn, focusLevel, setFocus } from "./lib/focus.js";
import { prefs, setPref, DEFAULTS } from "./lib/prefs.js";
import { SIDEBAR, PANELS, arrange, node } from "./lib/arrange.js";

const SECTIONS = [
  ["layout", "Layout"],
  ["tasks", "Tasks"],
  ["notes", "Notes"],
  ["spaces", "Spaces & agents"],
  ["focus", "Focus mode"],
  ["zen", "Zen mode"],
  ["keys", "Keys & modes"],
  ["closing", "Tabs & closing"],
  ["sessions", "Claude sessions"],
  ["prs", "Pull requests"],
  ["panels", "Panels"],
  ["storage", "Storage"],
  ["about", "About"],
];

const ZEN = "ks-zen.prefs";
const zenPrefs = () => ({ backdrop: "theme", opacity: 1, share: 0.64, ...(shared(ZEN) ?? {}) });
const setZen = (patch) => setShared(ZEN, { ...zenPrefs(), ...patch });
const round = (v) => Math.round(v * 100) / 100;

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

export default class Settings extends View {
  init(_props, cx) {
    this.at = props()?.section ?? "layout";
    this.cacheFiles = null;
    this.rootInput = InputState.new({ value: prefs().worktreeRoot, placeholder: DEFAULTS.worktreeRoot });
    this.reposInput = InputState.new({ value: prefs().repoFolders, placeholder: DEFAULTS.repoFolders });
    this.reposInput.on("change", () => setPref("repoFolders", this.reposInput.value().trim() || DEFAULTS.repoFolders));
    this.rootInput.on("change", () => setPref("worktreeRoot", this.rootInput.value().trim() || DEFAULTS.worktreeRoot));
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.countCache(cx);
  }

  countCache(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", 'ls "$1"/*.json 2>/dev/null | wc -l', "sh", `${appHome()}/data/ks-cache`]).catch(() => null);
      this.cacheFiles = Number((r?.stdout ?? "0").trim()) || 0;
      cx.notify();
    });
  }

  close() { closeOverlay(props()?.overlay); }

  render(cx) {
    const t = theme();
    const nav = v_flex().w(180).flex_none().gap(2).pr(10).border_r(1).border_color(t.border)
      .children(SECTIONS.map(([id, label]) => h_flex().id(`nav-${id}`).h(30).px(10).items_center().rounded(7)
        .bg(this.at === id ? t.selected : t.popover).text_color(this.at === id ? t.foreground : t.muted).text_size(12.5)
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.at = id; cx.notify(); }).child(label)));
    return v_flex().id("ks-settings").track_focus(this.handle).size_full().min_h(0).p(18).gap(14).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.keystroke === "escape") { this.close(); cx.stop_propagation(); } })
      .child(h_flex().items_center().gap(10)
        .child(div().text_size(16).font_semibold().child("herdr-ks settings"))
        .child(div().text_size(11.5).text_color(t.dim).child("for the ks layout's own mods · changes apply at once"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(nav)
        .child(v_flex().id("pane").flex_1().min_w(0).h_full().pl(18).overflow_y_scroll().child(this.section(this.at, t, cx))));
  }

  // --- pieces ---

  ui(t) {
    const btn = (id, label, act, active = false) => h_flex().id(id).h(28).px(11).items_center().justify_center().rounded(7).border_1()
      .border_color(active ? t.accent : t.input).bg(active ? t.accent + "22" : t.raised).text_color(active ? t.accent : t.foreground)
      .text_size(12).cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { act(cx); cx.notify(); }).child(label);
    const row = (title, help, ...controls) => v_flex().gap(6).pb(16)
      .child(div().text_size(13).font_medium().child(title))
      .when(Boolean(help), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(help)))
      .child(h_flex().gap(8).flex_wrap().items_center().children(controls));
    const choice = (id, options, current, set) => options.map(([v, label]) => btn(`${id}-${v}`, label, () => set(v), current === v));
    const meter = (value) => h_flex().h(8).w(200).rounded(4).bg(t.hover).child(div().h_full().w(200 * value).rounded(4).bg(t.accent));
    const note = (text) => div().text_size(11.5).text_color(t.muted).child(text);
    const heading = (text) => div().pb(14).text_size(15).font_semibold().child(text);
    return { btn, row, choice, meter, note, heading };
  }

  section(id, t) {
    const { btn, row, choice, meter, note, heading } = this.ui(t);
    const p = prefs();
    switch (id) {
      case "layout": {
        const order = [...(p.sidebarOrder ?? DEFAULTS.sidebarOrder)];
        for (const [sid] of SIDEBAR) if (!order.includes(sid)) order.push(sid);
        const info = Object.fromEntries(SIDEBAR.map(([sid, name, help]) => [sid, { name, help }]));
        const move = (i, by) => { const o = [...order], j = i + by; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setPref("sidebarOrder", o); arrange(); };
        const shown = (sid) => { const n = node(sid); return Boolean(n && !n.hidden); };
        const buttons = p.panelButtons ?? DEFAULTS.panelButtons;
        const herdrPanels = shared("workspace.panels") ?? ["files", "changes"];
        return v_flex().child(heading("Layout"))
          .child(row("Side panel", "Files, Changes, PRs, Notes and Tasks open in the side panel, on this side of the terminals.",
            ...choice("side", [["left", "Left"], ["right", "Right"]], p.panelSide ?? "right", (v) => { setPref("panelSide", v); arrange(); })))
          .child(row("Side panels in the tab bar", "Which panels get a button at the top right. Their keys still open them either way.",
            ...PANELS.map(([pid, name, help]) => btn(`pb-${pid}`, `${buttons.includes(pid) ? "✓ " : ""}${name}`,
              () => setPref("panelButtons", buttons.includes(pid) ? buttons.filter((x) => x !== pid) : [...buttons, pid]), buttons.includes(pid)))))
          .child(v_flex().pb(16).gap(4).children(PANELS.map(([pid, name, help]) => h_flex().gap(10).text_size(11.5)
            .child(div().w(70).font_medium().text_color(buttons.includes(pid) ? t.foreground : t.dim).child(name))
            .child(div().flex_1().text_color(t.dim).child(help + (["files", "changes"].includes(pid) && !herdrPanels.includes(pid) ? " (switched off in Herdr's settings)" : ""))))))
          .child(div().pb(4).text_size(13).font_medium().child("Sidebar"))
          .child(div().pb(10).text_size(11.5).text_color(t.dim).child("Its sections, top to bottom: show or hide each, and move them with ↑ ↓."))
          .child(v_flex().pb(16).gap(6).children(order.filter((sid) => info[sid]).map((sid, i) => h_flex().gap(8).items_center()
            .child(btn(`up-${sid}`, "↑", () => move(i, -1)))
            .child(btn(`dn-${sid}`, "↓", () => move(i, 1)))
            .child(btn(`vis-${sid}`, shown(sid) ? "Shown" : "Hidden", () => run(shown(sid) ? "layout.hide" : "layout.show", { id: sid }), shown(sid)))
            .child(v_flex().flex_1().min_w(0)
              .child(div().text_size(12.5).font_medium().child(info[sid].name))
              .child(div().text_size(11).text_color(t.dim).child(info[sid].help))))))
          .child(row("Back to the defaults", "Side panel on the right, every panel button, the sidebar in its first order and every section shown.",
            btn("layout-reset", "Reset the layout choices", () => {
              setPref("panelSide", DEFAULTS.panelSide); setPref("sidebarOrder", DEFAULTS.sidebarOrder); setPref("panelButtons", DEFAULTS.panelButtons);
              for (const [sid] of SIDEBAR) run("layout.show", { id: sid });
              arrange();
            })));
      }
      case "tasks": {
        return v_flex().child(heading("Tasks"))
          .child(row("Start on", "Which tasks the Tasks panel shows when it opens: this space's (made in it or its worktrees), or every space's. The board window always opens on all. The panel's Here / All (s) switches either way.",
            ...choice("tall", [[false, "This space"], [true, "All spaces"]], Boolean(p.tasksAll), (v) => setPref("tasksAll", v))))
          .child(row(`Sidebar Tasks lists ${p.nowTasksMax ?? 3} in progress`, "How many tasks from the board's Doing column the sidebar shows before \"+N more\".",
            ...[1, 2, 3, 5].map((v) => btn(`ntm-${v}`, String(v), () => setPref("nowTasksMax", v), (p.nowTasksMax ?? 3) === v))))
          .child(row("Agents' task proposals", "A toast when an agent proposes a task (ks-task). The tab bar's \"Tasks · N new\" shows either way.",
            ...choice("ttoast", [[true, "On"], [false, "Off"]], p.taskToasts !== false, (v) => setPref("taskToasts", v))))
          .child(note("Kept in ~/.config/herdr-app/data/ks-tasks.json, attachments in data/ks-attach (neither is in the repo). Agents use the ks-task command (the ks-tasks skill)."));
      }
      case "notes": {
        return v_flex().child(heading("Notes"))
          .child(row("Start on", "This space's notes, or every note (grouped by space). The panel's This space / All (a) switches either way.",
            ...choice("nall", [[false, "This space"], [true, "All"]], Boolean(p.notesAll), (v) => setPref("notesAll", v))))
          .child(note("Kept in ~/.config/herdr-app/data/ks-notes.json, attachments in data/ks-attach (neither is in the repo)."));
      }
      case "spaces": {
        return v_flex().child(heading("Spaces & agents"))
          .child(row("Name spaces by repo and branch", "A space is called \"branch · repo\" of the worktree its agent works in (\"repo · main\" on main), unless you renamed it. Off: Herdr's own names.",
            ...choice("names", [[true, "On"], [false, "Off"]], p.autoSpaceNames !== false, (v) => setPref("autoSpaceNames", v))))
          .child(row("Worktree folder", "New worktrees go to <folder>/<repo>/<branch>: the New worktree dialog's default, and where a PR's worktree is made. ~ is your home folder.",
            Input.new(this.rootInput).w(360).h(30).px(10).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground)))
          .child(row("What each agent works on", "Under each space's name, its agent's task (the tab's name, else the session's title) with git's ↑ ↓ ±.",
            ...choice("tline", [[true, "Shown"], [false, "Hidden"]], p.spaceTaskLine !== false, (v) => setPref("spaceTaskLine", v))))
          .child(row("Processes under agents", "The Agents list's \"N procs\" chip: dev servers and commands an agent started, with ports, CPU and Stop. Off also stops looking them up (ps, lsof).",
            ...choice("procs", [[true, "On"], [false, "Off"]], p.agentProcs !== false, (v) => setPref("agentProcs", v))));
      }
      case "focus": {
        const level = focusLevel();
        return v_flex().child(heading("Focus mode"))
          .child(row("Focus mode", "Everything around your terminals dims until you point at it: sidebar, tab bar, side panel, status bar and the headers of panes without the keyboard. ⌘⇧F, or service f.",
            ...choice("focus", [[true, "On"], [false, "Off"]], focusOn(), (v) => setFocus({ on: v }))))
          .child(row(`How visible dimmed parts stay: ${Math.round(level * 100)}%`, "Lower is dimmer.",
            btn("lvl-less", "−", () => setFocus({ level: Math.max(0.1, round(level - 0.05)) })), meter(level),
            btn("lvl-more", "+", () => setFocus({ level: Math.min(0.9, round(level + 0.05)) })),
            ...[0.2, 0.35, 0.5, 0.7].map((v) => btn(`lvl-${v}`, `${Math.round(v * 100)}%`, () => setFocus({ level: v }), Math.abs(level - v) < 0.001))))
          .child(note("The text inside inactive terminals can't be dimmed by mods (a Herdr limit)."));
      }
      case "zen": {
        const z = zenPrefs();
        return v_flex().child(heading("Zen mode"))
          .child(row("Zen", "The terminal you're in, alone in a floating window over everything. ⌘⇧Z, service Z, vim zz.",
            btn("zen-now", "Open zen now", () => { this.close(); run("ks-zen.toggle"); })))
          .child(row(`Backdrop: ${z.opacity >= 1 ? "opaque" : `translucent, ${Math.round(z.opacity * 100)}%`}`, "Translucent shows the sidebar and panels through glass; the tab area behind zen stays solid.",
            btn("op-opaque", "Opaque", () => setZen({ opacity: 1 }), z.opacity >= 1),
            btn("op-glass", "Translucent", () => setZen({ opacity: 0.7 }), z.opacity < 1),
            btn("op-less", "−", () => setZen({ opacity: Math.max(0.4, round(z.opacity - 0.05)) })), meter(z.opacity),
            btn("op-more", "+", () => setZen({ opacity: Math.min(1, round(z.opacity + 0.05)) }))))
          .child(row("Backdrop color", null, ...choice("bd", [["theme", "Theme color"], ["dark", "Dark"]], z.backdrop === "dark" ? "dark" : "theme", (v) => setZen({ backdrop: v }))))
          .child(row(`Size: ${Math.round(z.share * 100)}% of the window`, "Also: drag its corners, Narrower / Wider in its bar, service r then - / +.",
            ...[0.55, 0.64, 0.72, 0.85].map((v) => btn(`sz-${v}`, `${Math.round(v * 100)}%`, () => setZen({ share: v }), Math.abs(z.share - v) < 0.001))));
      }
      case "keys": {
        const cfg = shared("ks-keys.config"), modes = cfg?.modes ?? null;
        const list = modes ? Object.entries(modes).map(([mid, m]) => [mid, m.name, m.off ? "off" : m.entry || "from another mode", m.sticky ? "sticky" : "one key"])
          : [["service", "service", "ctrl-;", "sticky"], ["vim", "vim", "service [", "sticky"], ["tmux", "tmux", "off (ctrl-b)", "one key"], ["move", "move", "service m", "sticky"], ["resize", "resize", "service r", "sticky"], ["tabs", "tabs", "service t", "sticky"], ["spaces", "spaces", "service S", "sticky"]];
        const fixed = [["⌘⇧Z", "Zen mode"], ["⌘⇧F", "Focus mode"], ["⌘⇧T", "Undo the last close"], ["⌘⇧N", "New space + worktree"], ["⌘⇧E / ⌘⇧G / ⌘⇧U", "Files / Changes / PRs panel"], ["⌘⇧J / ⌘⇧K", "Notes / Tasks panel"], ["⌘⇧M", "Show / hide My PRs"], ["⌘K", "Key modes editor"], ["⌘⇧,", "These settings"]];
        const vimOn = Boolean(modes?.window && !modes.window.off && modes.vim?.entry && !modes.vim.off);
        return v_flex().child(heading("Keys & modes"))
          .child(row("Vim keys", "Vim's ctrl-w window commands anywhere: h j k l go, H J K L swap, s v split, o zoom, c close, + - < > = resize what you're in, z zen. ctrl-\\ enters vim's normal mode (i or esc leaves). Takes ctrl-w from the shell: press it twice to delete a word, or use alt-backspace.",
            btn("vim-on", "On", () => run("ks-keys.vim:on"), vimOn), btn("vim-off", "Off", () => run("ks-keys.vim:off"), !vimOn)))
          .child(row(`Key strip shows after a ${((cfg?.delay ?? 1000) / 1000).toLocaleString("de-DE")} s pause`, "The keys work as soon as you enter a mode; the strip only appears once you stop typing for this long (each key starts the wait again).",
            ...[0, 500, 1000, 1500, 2500].map((v) => btn(`delay-${v}`, v ? `${(v / 1000).toLocaleString("de-DE")} s` : "At once", () => run(`ks-keys.delay:${v}`), (cfg?.delay ?? 1000) === v))))
          .child(row("Key modes", "Press a mode's key and a strip shows its keys. Switch modes on or off, change their keys and every binding in the editor.",
            btn("keys-edit", "Open the key modes editor", () => { this.close(); run("ks-keys.editor"); })))
          .child(v_flex().pb(16).gap(2).children(list.map(([mid, name, entry, kind]) => h_flex().h(24).gap(12).text_size(12)
            .child(div().w(90).font_medium().child(name)).child(div().w(170).text_color(entry === "off" ? t.dim : t.accent).child(entry)).child(div().text_color(t.muted).child(kind)))))
          .child(div().pb(6).text_size(13).font_medium().child("Shortcuts"))
          .child(v_flex().gap(2).children(fixed.map(([k, what]) => h_flex().h(22).gap(12).text_size(12).child(div().w(150).text_color(t.accent).child(k)).child(div().text_color(t.muted).child(what)))));
      }
      case "closing": {
        const mode = (k) => shared(k) ?? (k.startsWith("ks-tabs") ? "always" : "agents");
        const opts = [["never", "Never"], ["agents", "While an agent works"], ["always", "Always"]];
        return v_flex().child(heading("Tabs & closing"))
          .child(row("Ask before closing a tab", null, ...choice("ct", opts, mode("ks-tabs.confirm-close"), (v) => setShared("ks-tabs.confirm-close", v))))
          .child(row("Ask before closing a pane", null, ...choice("cp", opts, mode("ks-pane.confirm-close"), (v) => setShared("ks-pane.confirm-close", v))))
          .child(row(`Undo a close for ${p.undoSeconds} s`, "A closed tab or space keeps running, hidden, this long; ⌘⇧T, the toast or the tab bar's ↶ Undo brings it back.",
            ...[10, 30, 60, 120].map((v) => btn(`undo-${v}`, `${v} s`, () => setPref("undoSeconds", v), p.undoSeconds === v))));
      }
      case "sessions": {
        const n = Object.keys(shared("ks.sessions") ?? {}).length;
        return v_flex().child(heading("Claude sessions"))
          .child(row("Show the last session after a reboot", "A terminal that comes back as a plain shell shows a card of its last Claude session (Enter resumes). The ↻ Resume buttons stay either way.",
            ...choice("card", [[true, "On"], [false, "Off"]], p.resumeCard, (v) => setPref("resumeCard", v))))
          .child(row(`Remembered sessions: ${n}`, "Which Claude session ran in which terminal. Forgetting removes every ↻ Resume button until agents run again.",
            btn("forget", "Forget all", () => { setShared("ks.sessions", {}); notify({ title: "Forgot every remembered session", level: "info", timeout: 2500 }); })));
      }
      case "prs": {
        const myprs = find(layout(), "my-prs");
        return v_flex().child(heading("Pull requests"))
          .child(row("My PRs in the sidebar", "Your open GitHub PRs with CI, review and merge state. ⌘⇧M.",
            ...choice("myprs", [[true, "Shown"], [false, "Hidden"]], Boolean(myprs && !myprs.hidden), (v) => run(v ? "layout.show" : "layout.hide", { id: "my-prs" }))))
          .child(row("Repo folders", "Where your clones live, comma-separated (~/code, ~/work). The PR window looks here, two levels deep, for the repo of a PR no open space is in.",
            Input.new(this.reposInput).w(360).h(30).px(10).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground)))
          .child(row("Notifications", "A toast when a PR's CI turns red or green, it's approved, changes are requested, or it's merged or closed.",
            ...choice("toasts", [[true, "On"], [false, "Off"]], p.prToasts, (v) => setPref("prToasts", v))));
      }
      case "panels":
        return v_flex().child(heading("Panels"))
          .child(row("Hide idle main checkouts", "In the Changes, Files and PRs panels, leave out a main checkout on main/master with nothing changed (unless it's where you are).",
            ...choice("idle", [[true, "On"], [false, "Off"]], p.hideIdleMain, (v) => setPref("hideIdleMain", v))));
      case "storage":
        return v_flex().child(heading("Storage"))
          .child(row(`GitHub cache: ${this.cacheFiles ?? "…"} files`, "Answers from gh, shown at once and refreshed in the background (~/.config/herdr-app/data/ks-cache). Clearing makes the next look slower once.",
            btn("cache-clear", "Clear the cache", (cx) => cx.spawn(async (cx) => {
              await exec("sh", ["-c", 'rm -f "$1"/*.json', "sh", `${appHome()}/data/ks-cache`]).catch(() => null);
              notify({ title: "GitHub cache cleared", level: "info", timeout: 2500 });
              this.countCache(cx);
            }))));
      case "about":
        return v_flex().child(heading("About"))
          .child(note("herdr-ks: the ks layout for Herdr App, inspired by Herdr Roundup. Apache-2.0."))
          .child(div().h(12))
          .child(row("Guide", "Everything the layout does and how to use it.",
            btn("guide", "Open the guide", () => exec("open", ["https://github.com/kyriacos/herdr-ks/blob/main/docs/GUIDE.md"]).catch(() => null))))
          .child(note("Settings live in Herdr's shared state (~/.config/herdr-app/shared.json); install with scripts/install.sh from the repo."));
    }
    return div();
  }
}
