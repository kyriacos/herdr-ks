// ks-zen: zen mode, focus mode, and their settings.
//
// Zen (cmd-shift-z, service Z, vim zz): the shown tab alone, centered, everything else gone. It is its own layout:
// `ks-zen` on your theme's own background (default) or `ks-zen-dark` on an almost black one. This mod switches to
// it and back, and draws the slim bar above the tab there: where you are, Pane only, narrower / wider, settings,
// Exit. Drag the space around the tab to resize it too (its edges are resizable); Herdr keeps the size.
// Focus mode (cmd-shift-f, service f): the interface around the terminals dims until hovered (lib/focus.js).
// Settings (main menu, service F, the bar's ⚙): focus on/off and how much it dims (live), zen's backdrop and width.
//
// Copies: one floating in the ks layout (draws nothing, takes commands), the bar in the zen layouts, and the
// settings dialog (props { settings: true }).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, layout, spaces, panes, focused, nextCommand, shared, setShared, placement, notify, theme, props, openOverlay, closeOverlay } from "herdr";
import { focusOn, focusLevel, setFocus } from "./lib/focus.js";

const ZEN = "ks-zen.state";   // { from, zoomed (the pane zen zoomed, unzoomed on exit) }
const PREFS = "ks-zen.prefs"; // { backdrop: "theme" | "dark" }
const prefs = () => ({ backdrop: "theme", ...(shared(PREFS) ?? {}) });
const zenLayout = () => (prefs().backdrop === "dark" ? "ks-zen-dark" : "ks-zen");
const inZen = () => layout()?.id === "zen-root";

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

function toggleZen() {
  if (inZen()) {
    const st = shared(ZEN) ?? {};
    if (st.zoomed && panes().find((p) => p.pane === st.zoomed)?.zoomed) run("pane.zoom", { pane: st.zoomed });
    setShared(ZEN, null);
    run("layout.switch", { name: st.from || "ks" });
  } else {
    setShared(ZEN, { from: "ks", zoomed: null });
    run("layout.switch", { name: zenLayout() });
  }
}

function toggleFocus() {
  const on = !focusOn();
  setFocus({ on });
  notify({ title: on ? "Focus mode on" : "Focus mode off", body: on ? `Dims to ${Math.round(focusLevel() * 100)}% until you point at it. ⌘⇧F turns it off.` : "", level: "info", timeout: 2500 });
}

function togglePane() {
  const p = panes().find((x) => x.focused) ?? panes().find((x) => x.pane === focused()?.pane);
  if (!p) return;
  run("pane.zoom", { pane: p.pane });
  setShared(ZEN, { ...(shared(ZEN) ?? {}), zoomed: p.zoomed ? null : p.pane });
}

// Narrower / wider: the side spaces' share, 0 (edge to edge) to 30 each.
function widen(step) {
  if (!inZen()) return;
  const left = find(layout(), "zen-left"), w = left?.size?.weight ?? 10;
  const next = Math.max(0, Math.min(30, w - step));
  for (const id of ["zen-left", "zen-right"]) run("layout.resize", { id, weight: next });
}

const openSettings = () => openOverlay({ mod: "ks-zen", kind: "dialog", width: 460, height: 400, props: { settings: true } });

export default class Zen extends View {
  init(_props, cx) {
    if (props()?.settings) { this.handle = cx.focus_handle(); this.handle.focus(); return; }
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") toggleZen();
        else if (c === "focus") toggleFocus();
        else if (c === "pane") togglePane();
        else if (c === "wider") widen(3);
        else if (c === "narrower") widen(-3);
        else if (c === "settings") openSettings();
        else if (c.startsWith("focus-level:")) setFocus({ level: Math.max(0.1, Math.min(0.9, Number(c.slice(12)) || 0.35)) });
        cx.notify();
      }
    });
  }

  render() {
    if (props()?.settings) return this.renderSettings();
    if (placement() || !inZen()) return div();
    const t = theme(), dark = prefs().backdrop === "dark";
    const sp = spaces().find((s) => s.active), tab = sp?.tabs.find((x) => x.active);
    const zoomed = panes().some((p) => p.zoomed), split = panes().filter((p) => p.tab === tab?.id).length > 1;
    const fg = dark ? "#e8eaf0" : t.foreground, dim = dark ? "#8a90a0" : t.muted, hover = dark ? "#ffffff14" : t.hover;
    const stop = (_e, cx) => cx.stop_propagation();
    const btn = (id, label, act, on = false) => h_flex().id(id).h(24).px(9).items_center().rounded(6).text_size(11.5)
      .text_color(on ? fg : dim).bg(on ? hover : "#00000000").hover((s) => s.bg(hover).text_color(fg))
      .on_mouse_down("left", stop).on_click((_e, cx) => { act(); cx.notify(); }).child(label);
    return h_flex().id("zen-bar").size_full().px(4).gap(4).items_center()
      .child(div().px(7).h(20).flex().items_center().rounded(5).bg(t.accent).text_color(t.solid_foreground ?? t.background).text_size(10.5).font_semibold().child("ZEN"))
      .child(div().pl(6).min_w(0).truncate().text_size(12).text_color(fg).child(tab?.name && !/^tb\d+$/.test(tab.name) ? tab.name : "tab"))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(dim).child(sp ? `· ${sp.name}` : ""))
      .child(div().flex_1())
      .when(split || zoomed, (e) => e.child(btn("zen-pane", zoomed ? "Whole tab" : "Pane only", togglePane, zoomed)))
      .child(btn("zen-narrow", "Narrower", () => widen(-3)))
      .child(btn("zen-wide", "Wider", () => widen(3)))
      .child(btn("zen-settings", "⚙", openSettings))
      .child(btn("zen-exit", "Exit  ⌘⇧Z", toggleZen));
  }

  renderSettings() {
    const t = theme(), p = prefs(), level = focusLevel(), on = focusOn();
    const btn = (id, label, act, active = false) => h_flex().id(id).h(28).px(11).items_center().justify_center().rounded(7).border_1()
      .border_color(active ? t.accent : t.input).bg(active ? t.accent + "22" : t.raised).text_color(active ? t.accent : t.foreground)
      .text_size(12).cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { act(); cx.notify(); }).child(label);
    const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const pct = Math.round(level * 100);
    // A bar showing the level: the filled part is how visible dimmed things stay.
    const bar = h_flex().h(8).w(220).rounded(4).bg(t.hover).child(div().h_full().w(220 * level).rounded(4).bg(t.accent));
    return v_flex().id("zen-settings").track_focus(this.handle).size_full().p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.keystroke === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Focus & zen")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Focus mode: the interface dims until you point at it (⌘⇧F)"))
      .child(h_flex().gap(8).child(btn("f-on", "On", () => setFocus({ on: true }), on)).child(btn("f-off", "Off", () => setFocus({ on: false }), !on)))
      .child(label(`How visible dimmed parts stay: ${pct}%`))
      .child(h_flex().gap(8).items_center()
        .child(btn("f-less", "−", () => setFocus({ level: Math.max(0.1, Math.round((level - 0.05) * 100) / 100) })))
        .child(bar)
        .child(btn("f-more", "+", () => setFocus({ level: Math.min(0.9, Math.round((level + 0.05) * 100) / 100) }))))
      .child(h_flex().pt(8).gap(6)
        .children([0.2, 0.35, 0.5, 0.7].map((v) => btn(`f-${v}`, `${Math.round(v * 100)}%`, () => setFocus({ level: v, on: true }), Math.abs(level - v) < 0.001))))
      .child(label("Zen backdrop (⌘⇧Z)"))
      .child(h_flex().gap(8)
        .child(btn("z-theme", "Your theme", () => setShared(PREFS, { ...p, backdrop: "theme" }), p.backdrop !== "dark"))
        .child(btn("z-dark", "Dark", () => setShared(PREFS, { ...p, backdrop: "dark" }), p.backdrop === "dark")))
      .child(div().pt(6).text_size(11).text_color(t.dim).child(inZen() ? "Takes effect the next time you enter zen." : "Width: Narrower / Wider in zen's bar, drag the edges, or service r then - / +."));
  }
}
