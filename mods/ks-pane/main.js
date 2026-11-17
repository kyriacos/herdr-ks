// A pane's header, cloned from Herdr's `pane` mod:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "ks-pane" } } } }
// Shows the program's icon, the pane's name, its id, the folder and the agent's status;
// buttons rename, split, zoom and close this pane. Props from the app: { pane, terminal }.
//
// - The id is the terminal's address (`t7`, what `hc` and Cmd-click take); a mod pane has no
//   terminal and shows its pane id, shortened. Double-click it: copied to the clipboard.
// - A name: double-click the name, or the pencil on hover. herdr-core can't rename a terminal
//   once it runs, so a terminal's name is its label `ks-pane.name` (kept by the core with
//   the terminal, seen by every Herdr client, gone when the terminal ends; set with
//   `hc label t7 ks-pane.name=…`). A mod pane's name is shared state `ks-pane.names`
//   (pane id -> name). An empty name goes back to the program's name.
// - The same mod draws the rename dialog: opened as an overlay with props { rename: {...} }.
// - Closing asks first as "Ask before closing a pane" in the terminal's menu says; a tab's only pane
//   as the tab menu's choice for tabs says (close.js, shared with ks-tabs). Ways to close: the ×,
//   cmd-shift-w (`ks-tabs.close-pane`: the tab bar has one copy, every header would get it) and
//   Close pane in the terminal's right-click menu, which is this mod too (the layout's `terminal_menu`).

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { panes, terminals, props, run, theme, settings, home, hc, shared, setShared, openOverlay, closeOverlay, notify } from "herdr";
import { closePane, givenName, fallbackName, NAME_LABEL, NAMES } from "./close.js";
import { menuView, shortcut } from "./menu.js";
import { folder, paneId, cutName } from "./header-text.js";
import * as sessions from "./lib/sessions.js";
import { focusOn, focusLevel } from "./lib/focus.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Herdr's pane menu (`menu`, tab "pane") item for item, with Close pane going through closePane.
// A terminal shown outside a tab (a layout terminal block, a window) has no pane to split, zoom or
// close: its pane is the block's id. Those rows (`inTab`) go, as in Herdr's menu 0.1.14, and with
// Close pane the choice of when closing asks.
const inTab = (target) => panes().some((p) => p.pane === target.pane);
function menuRows(target) {
  const all = terminals(), term = all.find((t) => t.address === target.terminal);
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  const pane = target.pane, tabbed = inTab(target);
  return [
    { label: "Split right", icon: "panel-right", inTab: true, act: () => run("pane.split", { direction: "right", pane }), keys: shortcut(["pane.split:right"]) },
    { label: "Split down", icon: "panel-right", inTab: true, act: () => run("pane.split", { direction: "down", pane }), keys: shortcut(["pane.split:down"]) },
    { label: "Zoom", icon: "square", inTab: true, act: () => run(`ks-zen.zoomtab:${pane}`), keys: shortcut(["ks-zen.zoomtab"]) },
    { label: "Zoom over the window", icon: "square", inTab: true, act: () => run(`ks-zen.zoom:${pane}`), keys: shortcut(["ks-zen.zoom"]) },
    ...(term ? [term.labels?.["herdr.right-click"] === "program"
      ? { label: "Use Herdr right-click menu", icon: "terminal", act: () => run("terminal.right_click", { terminal: term.address, to: "menu" }) }
      : { label: "Send right-clicks to pane", icon: "terminal", act: () => run("terminal.right_click", { terminal: term.address, to: "program" }) }] : []),
    ...(parent ? [{ label: `Send back to ${parent.name || parent.address}`, icon: "terminal", act: () => run("terminal.park", { terminal: term.address }) }] : []),
    { label: "Close pane", icon: "x", sep: true, inTab: true, act: () => closePane(pane), keys: shortcut(["ks-tabs.close-pane", "pane.close"]) },
  ].filter((row) => tabbed || !row.inTab);
}

async function saveName(target, raw) {
  const name = cutName(raw);
  if (target.terminal) {
    const r = await hc(["label", target.terminal, `${NAME_LABEL}=${name}`]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
    if (r.code !== 0) notify({ title: "Couldn't rename the pane", body: (r.stderr || r.stdout).trim(), level: "error" });
    return;
  }
  const names = { ...(shared(NAMES) ?? {}) };
  if (name) names[target.pane] = name; else delete names[target.pane];
  setShared(NAMES, names);
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.copied = false;
    if (props()?.rename) return this.initDialog(cx);
    // The terminal's right-click menu: props { tab: "pane", target: { pane, terminal }, overlay }.
    if (props()?.target) {
      this.at = 0;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // --- the header ---

  button(t, id, icon, tip, action) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(`mods/ks-pane/${icon}.svg`).size(14));
  }

  // "↻ Resume <title> · 3h ago": types `claude --resume <id>` (in the folder Claude was started in) into this
  // shell. On hover also: pick another session from Claude's list, or forget this one.
  resumePill(t, p, rec) {
    const small = (id, text, tip, act) => div().id(id).flex_none().h(18).px(6).flex().items_center().rounded(5)
      .text_size(10.5).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); act(); }).child(text);
    return h_flex().flex_none().gap(4).items_center()
      .child(h_flex().id(`ph-resume-${p.pane}`).flex_none().h(20).px(7).gap(6).items_center().rounded(5)
        .bg(t.accent + "22").text_size(11).text_color(t.accent).hover((s) => s.bg(t.accent + "40"))
        .tooltip(`claude --resume ${rec.sessionId}\nin ${folder(rec.cwd, home())}`)
        .on_click((_e, cx) => { cx.stop_propagation(); sessions.resume(p.terminal, rec); })
        .child(div().font_semibold().child("↻ Resume")))
      // The title: the session's card inside the terminal (prompts, last reply, files), Enter resumes there.
      .child(h_flex().id(`ph-card-${p.pane}`).flex_none().h(20).px(6).gap(6).items_center().rounded(5).text_size(11)
        .text_color(t.foreground).hover((s) => s.bg(t.hover)).tooltip("Show what this session was, in the terminal")
        .on_click((_e, cx) => { cx.stop_propagation(); sessions.showCard(p.terminal, rec); })
        .child(div().max_w(240).truncate().child(sessions.label(rec)))
        .child(div().text_color(t.dim).child(sessions.ago(rec.at ?? Date.now()))))
      .when(this.hovered, (el) => el
        .child(small(`ph-pick-${p.pane}`, "Pick…", "Choose from this folder's Claude sessions", () => sessions.resume(p.terminal, rec, true)))
        .child(small(`ph-forget-${p.pane}`, "✕", "Forget this session", () => sessions.forget(p.terminal))));
  }

  openRename(p, given, fallback) {
    openOverlay({
      mod: "ks-pane",
      kind: "dialog",
      width: 380,
      height: 196,
      props: { rename: { pane: p.pane, terminal: p.terminal, value: given, fallback } },
    });
  }

  copyId(cx, id) {
    cx.write_to_clipboard(id.copied);
    this.copied = true;
    cx.notify();
    this.copiedTimer?.cancel();
    this.copiedTimer = cx.timer.after(1200, (cx) => { this.copied = false; this.copiedTimer = null; cx.notify(); });
  }

  render(cx) {
    if (props()?.rename) return this.renderDialog();
    if (props()?.target) return menuView(this, menuRows(props().target), inTab(props().target) ? "pane" : null);
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const given = givenName(p);
    const fallback = fallbackName(p);
    const name = given || fallback;
    const id = paneId(p);
    const pic = icon(p.program, 14, t.dim);
    // ks-zen: a pane zoomed in its tab (Herdr), or a lone pane zoomed over the window (sidebar and panel hidden).
    const wz = shared("ks-zen.zoom"), winZoom = Boolean(wz && (!wz.tab || wz.tab === p.tab));
    const st = p.status, zoomed = p.zoomed || winZoom;
    const hiddenPanes = p.zoomed ? panes().filter((x) => x.tab === p.tab).length - 1 : 0;
    const pane = p.pane;
    const lost = p.terminal ? sessions.resumable(p.terminal, !p.program?.agent) : null;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      // The pane is rounded 10 with a 1 px border; the header sits inside it, so its top corners round 9 (square,
      // its background showed past the curve, more so when focus mode fades it).
      .rounded_t(9)
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      // ks: focus mode dims the headers of the panes that don't have the keyboard (lib/focus.js).
      .when(focusOn() && !p.focused && !this.hovered, (el) => el.opacity(focusLevel()))
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div()
        .id(`ph-name-${pane}`)
        .flex_none()
        .truncate()
        .max_w(260)
        .font_medium()
        .text_color(t.foreground)
        .tooltip(given ? `${given} · ${fallback} · double-click to rename` : "Double-click to name this pane")
        .on_click((e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); this.openRename(p, given, fallback); } })
        .child(name))
      .child(div()
        .id(`ph-id-${pane}`)
        .flex_none()
        .h(18)
        .px(5)
        .flex()
        .items_center()
        .rounded(4)
        .bg(this.copied ? t.accent + "26" : t.hover)
        .font_family(settings().font_family ?? "JetBrains Mono")
        .text_size(10.5)
        .text_color(this.copied ? t.accent : t.dim)
        .hover((s) => s.text_color(t.foreground))
        .tooltip(`${id.copied} · double-click to copy`)
        .on_click((e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); this.copyId(cx, id); } })
        .child(this.copied ? "copied" : id.shown))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd, home())))
      // ks: zoomed, say so and what it hides; a click zooms back out.
      .when(zoomed, (el) => el.child(h_flex().id(`ph-zoomed-${pane}`).flex_none().h(18).px(6).gap(4).items_center().rounded(5)
        .bg(t.accent + "26").border_1().border_color(t.accent + "66").text_size(10.5).font_semibold().text_color(t.accent).cursor_pointer()
        .hover((s) => s.bg(t.accent + "40"))
        .tooltip(`Zoomed: ${[p.zoomed && hiddenPanes > 0 ? `${hiddenPanes} other pane${hiddenPanes === 1 ? "" : "s"}` : null, winZoom ? "the sidebar and side panel" : null].filter(Boolean).join(" and ")} hidden. Click to unzoom.`)
        .on_click((_e, cx) => { cx.stop_propagation(); run(`ks-zen.zoom:${pane}`); })
        .child("⤢ Zoomed").when(p.zoomed && hiddenPanes > 0, (e) => e.child(div().child(`· ${hiddenPanes} hidden`)))))
      // ks: Claude ran here before this terminal was lost (a reboot): resume that session (lib/sessions.js).
      .when(Boolean(lost), (el) => el.child(this.resumePill(t, p, lost)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-n-${pane}`, "rename", "Rename", () => this.openRename(p, given, fallback)))
        .child(this.button(t, `ph-r-${pane}`, "split-right", "Split right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "Split down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, zoomed ? "unzoom" : "zoom", zoomed ? "Unzoom" : "Zoom", () => run(`ks-zen.zoomtab:${pane}`)))
        .child(this.button(t, `ph-x-${pane}`, "close", "Close", () => closePane(pane))));
  }

  // --- the rename dialog (this mod as an overlay), shaped like Herdr's `prompt` ---

  initDialog(cx) {
    const value = props().rename.value ?? "";
    this.input = InputState.new({ value, placeholder: props().rename.fallback ?? "" });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.submit());
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    const value = this.input.value();
    closeOverlay(p.overlay);
    saveName(p.rename, value);
  }

  renderDialog() {
    const t = theme();
    const p = props();
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Rename pane"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Name (empty: the program's name)"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("rn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("rn-save", "Save", true, () => this.submit())));
  }
}
