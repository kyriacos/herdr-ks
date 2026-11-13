// Focus mode and zen mode, as every ks mod sees them. Source of truth: shared/focus.js; scripts/install.sh copies it
// into each mod's lib/.
//
// Focus mode (shared "ks-zen.focus": { on, level }): the interface around the terminals (sidebar, tab bar, side
// panel, inactive pane headers) is dimmed to `level` until the pointer is on it. Toggled by ks-zen (cmd-shift-f,
// service mode f). Herdr gives mods no way to dim a terminal's own text, so inactive panes keep it.
import { div } from "gpui-kit";
import { shared, setShared, props } from "herdr";

export const FOCUS = "ks-zen.focus";
export const focusOn = () => Boolean(shared(FOCUS)?.on);
export const focusLevel = () => shared(FOCUS)?.level ?? 0.35;
export const setFocus = (patch) => setShared(FOCUS, { on: focusOn(), level: focusLevel(), ...patch });

// Wraps a layout mod's whole render: dimmed in focus mode until hovered. Overlays (menus, dialogs) are left alone.
export function dimmed(view, el) {
  if (props()?.overlay) return el;
  return div().id("ks-focus").size_full()
    .on_hover((hovered, cx) => { if (view.__focusHover !== hovered) { view.__focusHover = hovered; cx.notify(); } })
    .when(focusOn() && !view.__focusHover, (e) => e.opacity(focusLevel()))
    .child(el);
}
