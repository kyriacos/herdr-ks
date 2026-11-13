// ks-zen: zen mode and focus mode.
//
// Zen (cmd-shift-z, service mode Z, vim zz): the shown tab alone, centered and floating on an almost black backdrop,
// everything else gone. It is its own layout (layouts/ks-zen.json); this mod switches to it and back, and in it
// draws the slim bar above the tab: where you are, Pane only (zoom the focused pane), narrower / wider, Focus,
// Exit. The width is kept (Herdr saves the layout's sizes).
// Focus mode (cmd-shift-f, service mode f): the interface around the terminals dims until hovered
// (lib/focus.js, which every ks mod uses).
//
// Copies: one floating in the ks layout (draws nothing, takes the commands there), and the bar in ks-zen.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, layout, spaces, panes, focused, nextCommand, shared, setShared, placement, notify, theme } from "herdr";
import { focusOn, focusLevel, setFocus } from "./lib/focus.js";

const ZEN = "ks-zen.state"; // { from: the layout to go back to, zoomed: the pane zen zoomed (to unzoom on exit) }
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
    run("layout.switch", { name: "ks-zen" });
  }
}

function toggleFocus() {
  const on = !focusOn();
  setFocus({ on });
  notify({ title: on ? "Focus mode on" : "Focus mode off", body: on ? "The interface dims until you point at it. ⌘⇧F turns it off." : "", level: "info", timeout: 2500 });
}

// The focused pane alone, or the whole tab again.
function togglePane() {
  const p = panes().find((x) => x.focused) ?? panes().find((x) => x.pane === focused()?.pane);
  if (!p) return;
  run("pane.zoom", { pane: p.pane });
  setShared(ZEN, { ...(shared(ZEN) ?? {}), zoomed: p.zoomed ? null : p.pane });
}

// Narrower / wider: the side spacers' share, 0 (edge to edge) to 30 each.
function widen(step) {
  const left = find(layout(), "zen-left"), w = left?.size?.weight ?? 10;
  const next = Math.max(0, Math.min(30, w - step));
  for (const id of ["zen-left", "zen-right"]) run("layout.resize", { id, weight: next });
}

export default class Zen extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") toggleZen();
        else if (c === "focus") toggleFocus();
        else if (c === "pane") togglePane();
        else if (c === "wider") widen(3);
        else if (c === "narrower") widen(-3);
        else if (c.startsWith("focus-level:")) setFocus({ level: Math.max(0.1, Math.min(0.9, Number(c.slice(12)) || 0.35)) });
        cx.notify();
      }
    });
  }

  render() {
    if (placement() || !inZen()) return div();
    const t = theme();
    const sp = spaces().find((s) => s.active), tab = sp?.tabs.find((x) => x.active);
    const zoomed = panes().some((p) => p.zoomed), split = panes().filter((p) => p.tab === tab?.id).length > 1;
    const fg = "#e8eaf0", dim = "#8a90a0";
    const stop = (_e, cx) => cx.stop_propagation();
    const btn = (id, label, act, on = false) => h_flex().id(id).h(24).px(9).items_center().rounded(6).text_size(11.5)
      .text_color(on ? fg : dim).bg(on ? "#ffffff1f" : "#00000000").hover((s) => s.bg("#ffffff14").text_color(fg))
      .on_mouse_down("left", stop).on_click((_e, cx) => { act(); cx.notify(); }).child(label);
    return h_flex().id("zen-bar").size_full().px(4).gap(4).items_center()
      .child(div().px(7).h(20).flex().items_center().rounded(5).bg(t.accent).text_color(t.solid_foreground ?? "#000").text_size(10.5).font_semibold().child("ZEN"))
      .child(div().pl(6).min_w(0).truncate().text_size(12).text_color(fg).child(tab?.name && !/^tb\d+$/.test(tab.name) ? tab.name : "tab"))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(dim).child(sp ? `· ${sp.name}` : ""))
      .child(div().flex_1())
      .when(split || zoomed, (e) => e.child(btn("zen-pane", zoomed ? "Whole tab" : "Pane only", togglePane, zoomed)))
      .child(btn("zen-narrow", "Narrower", () => widen(-3)))
      .child(btn("zen-wide", "Wider", () => widen(3)))
      .child(btn("zen-exit", "Exit  ⌘⇧Z", toggleZen));
  }
}
