// A side panel in a window of its own (the ⤢ in its header): the same mod opened as a window with props
// { window: true }, resizable like the review and Tasks windows (corners via ks-resize, the key modes' resize keys
// via lib/windows.js), its size kept in shared "<mod>.windowSize". Esc or ✕ closes it.
// Use: openPanelWindow(mod); in init, `if (isWindow()) initWindow(this, cx, mod)` (or `windowCommand(this, c, mod)`
// inside a mod's own nextCommand loop); in render, `windowFrame(this, root, t, mod)` and the header's
// `expandButton(t, mod)` / `closeButton(t)`.
//
// Zooming, the same in every panel: z in the panel opens its window, z in the window closes it; the window-level
// zoom keys (cmd-shift-enter, ctrl-w o, service o / z) do the same while a panel or its window has the keyboard
// (ks-zen sends "<mod>.zoom" when the panel has the keyboard, "<mod>.unzoom" when its window has). Every copy of a
// mod gets its commands: only the panel acts on "zoom" (opening a window that's open just brings it up), only the
// window on "unzoom".
// Source of truth: shared/panelwin.js; scripts/install.sh copies it into each mod's lib/.
import { div } from "gpui-kit";
import { openOverlay, closeOverlay, props, shared, setShared, nextCommand, settings } from "herdr";
import { trackActive, takeRequest, raiseStrip, claim, backToPanel } from "./windows.js";

const keyOf = (mod) => `${mod}-window`;
const sizeKey = (mod) => `${mod}.windowSize`;
export const isWindow = () => Boolean((props() ?? {}).window);
export const closeWindow = (mod = (props() ?? {}).mod) => { const o = props()?.overlay; closeOverlay(o); if (mod) backToPanel(keyOf(mod), mod); };

export function openPanelWindow(mod, size = shared(sizeKey(mod)) ?? null) {
  openOverlay({ mod, kind: "window", key: keyOf(mod), width: size?.width ?? 0.62, height: size?.height ?? 0.74, props: { window: true, mod } });
}

// The window copy: takes the keyboard, and follows the key modes' resize keys. `listen` false when the mod has its
// own nextCommand loop (it then calls windowCommand with each command).
export function initWindow(view, cx, mod, listen = true) {
  view.windowed = true;
  claim(view, cx, keyOf(mod), mod);
  trackActive(view, cx, keyOf(mod), mod);
  if (listen) cx.spawn(async () => { for (;;) { const c = await nextCommand(); windowCommand(view, c, mod) || zoomCommand(view, c, mod); } });
}
// "zoom": the panel opens its window; "unzoom": the window closes. True when it was one of them.
export function zoomCommand(view, c, mod) {
  if (c === "zoom") { if (!view.windowed) openPanelWindow(mod); return true; }
  if (c === "unzoom") { if (view.windowed) closeWindow(mod); return true; }
  return false;
}
// The z key, in the panel or the window. True when taken.
export function zoomKey(view, e, mod) {
  const m = e.modifiers ?? {};
  if (e.key !== "z" || m.shift || m.control || m.platform || m.alt) return false;
  if (view.windowed) closeWindow(mod); else openPanelWindow(mod);
  return true;
}
// "winresize": reopened bigger or smaller (or at the default size). True when it was that.
export function windowCommand(view, c, mod) {
  if (c !== "winresize") return false;
  const r = takeRequest(view, keyOf(mod));
  if (!r) return true;
  const cur = view.winSize ?? { width: 900, height: 640 }, step = 40 * (r.dir || 1);
  const size = r.reset ? null : { width: Math.max(420, Math.round(cur.width + (r.kind === "tall" ? 0 : step))), height: Math.max(320, Math.round(cur.height + (r.kind === "wide" ? 0 : step))) };
  setShared(sizeKey(mod), size); openPanelWindow(mod, size); raiseStrip();
  return true;
}

// The window's root: its size kept, where it is (for the corner grips), and the grips themselves.
export function windowFrame(view, el, t, mod) {
  if (!view.windowed) return el;
  return resizable(view, el, t, sizeKey(mod), { mod, key: keyOf(mod), props: { window: true, mod } });
}
// Any window made resizable by its corners: its size kept in shared `size` (reopen it with that), and `reopen`, the
// openOverlay spec ks-resize reopens it with ({ mod, key, props }).
export function resizable(view, el, t, size, reopen) {
  return el.relative()
    .on_size_change((s) => {
      if (!s?.width || (s.width === view.winSize?.width && s.height === view.winSize?.height)) return;
      view.winSize = s; setShared(size, { width: Math.round(s.width), height: Math.round(s.height) });
    })
    .on_mouse_move((ev) => { if (ev.bounds) view.winRect = ev.bounds; })
    .children(grips(view, t, reopen));
}
function grips(view, t, reopen) {
  const g = (corner) => div().id(`grip-${corner}`).absolute().size(14)
    .when(corner.includes("t"), (e) => e.top(0)).when(corner.includes("b"), (e) => e.bottom(0))
    .when(corner.includes("l"), (e) => e.left(0)).when(corner.includes("r"), (e) => e.right(0))
    .when(corner === "tl" || corner === "br", (e) => e.cursor_nwse_resize()).when(corner === "tr" || corner === "bl", (e) => e.cursor_nesw_resize())
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      if (!view.winRect) return;
      openOverlay({ mod: "ks-resize", kind: "window", frame: "none", key: "ks-resize", width: 1, height: 1, at: { x: 0, y: 0 },
        props: { rect: view.winRect, corner, zoom: settings().zoom || 1, reopen } });
    })
    .when(corner === "br", (e) => e.child(div().absolute().right(3).bottom(3).size(7).border_r_2().border_b_2().border_color(t.dim)));
  return ["tl", "tr", "bl", "br"].map(g);
}

// The header's buttons: ⤢ in the panel, ✕ in the window.
export const expandButton = (t, mod) => div().id(`${mod}-expand`).flex_none().h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
  .text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Open in a window (z)")
  .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); openPanelWindow(mod); }).child("⤢");
export const closeButton = (t, mod) => div().id("window-close").flex_none().size(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
  .text_color(t.muted).hover((s) => s.bg(t.hover)).tooltip("Close (Esc or z)").on_click((_e, cx) => { cx.stop_propagation(); closeWindow(mod); }).child("✕");
export const headerButton = (view, t, mod) => (view.windowed ? closeButton(t, mod) : expandButton(t, mod));
