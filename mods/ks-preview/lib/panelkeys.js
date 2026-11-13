// Vim keys for the side panels (Changes, Files, PRs, My PRs). A panel says "focusable": true in mod.json, so
// pane.go (service h/l, ctrl-w h/l, vim h/l) gives it the keyboard; it gets "focus" from nextCommand() then.
// In a panel: j/k (↓/↑) move, gg/G first/last, ctrl-d/ctrl-u half a page, Enter/o open, h/l/Esc leave towards
// the pane on that side (Esc: back to the terminal on the left).
// Source of truth: shared/panelkeys.js; scripts/install.sh copies it into each mod's lib/.
import { nextCommand, run, shared, setShared } from "herdr";

// The panel you moved to ({ mod }), kept while a key mode's strip holds the keyboard: the panel doesn't take the
// keyboard from the strip (a sticky mode keeps its keys), still shows its accent border, and gets "focus" when the
// strip closes (ks-keys reads this; ks-keys clears it before moving elsewhere).
export const MARK = "ks.panelFocus";
const stripOpen = () => Boolean(shared("ks-keys.open"));

// Herdr handed this panel the keyboard (pane.go): mark it, and focus it unless the key strip is open.
export function gotFocus(view, cx, mod) {
  if (shared(MARK)?.mod !== mod) setShared(MARK, { mod });
  if (!stripOpen()) view.handle?.focus();
  cx.notify();
}

// Takes "focus" from nextCommand(); other commands go to `other(command, cx)`.
export function takeFocus(view, cx, mod, other = null) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = await nextCommand();
      if (c === "focus") gotFocus(view, cx, mod);
      else if (other) other(c, cx);
    }
  });
}

// Redraws when this panel gains or loses the keyboard (its accent border follows it): focus moving away, to a
// terminal or another panel, doesn't redraw the panel by itself. `extra()` counts as focused too (a search box).
// The mark goes once the keyboard is elsewhere with no strip open (a click on a terminal, say).
export function watchFocus(view, cx, mod, extra = null) {
  let was = false;
  cx.timer.every(200, () => {
    const real = Boolean(view.handle?.is_focused() || (extra && extra()));
    if (!real && !stripOpen() && shared(MARK)?.mod === mod && view.__unfocusedTicks++ > 2) setShared(MARK, null);
    if (real || stripOpen()) view.__unfocusedTicks = 0;
    const now = focusedNow(view, mod, extra);
    if (now !== was) { was = now; cx.notify(); }
  });
}
export const focusedNow = (view, mod, extra = null) => Boolean(view.handle?.is_focused() || (extra && extra()) || (stripOpen() && shared(MARK)?.mod === mod));

export const leave = (direction) => { setShared(MARK, null); run("pane.go", { direction }); };

// List keys over `n` rows, with the row index in `view.cursor`. `open(i)` for Enter / o, `more(k, e)` for the
// panel's own keys (return true when handled). Returns true when the key was taken.
export function listKey(view, e, n, open, more = null) {
  const k = e.key, m = e.modifiers ?? {}, shift = Boolean(m.shift);
  if (m.platform || m.alt) return false;
  const at = Math.max(0, Math.min(n - 1, view.cursor ?? 0));
  const go = (i) => { view.cursor = Math.max(0, Math.min(n - 1, i)); return true; };
  const half = Math.max(3, Math.floor((view.pageRows ?? 12) / 2));
  if (m.control) {
    if (k === "d") return go(at + half);
    if (k === "u") return go(at - half);
    return false;
  }
  if (k === "g" && !shift) { if (view.__g) { view.__g = false; return go(0); } view.__g = true; return true; }
  view.__g = false;
  if (k === "G" || (shift && k === "g")) return go(n - 1);
  if ((k === "j" && !shift) || k === "down") return go(at + 1);
  if ((k === "k" && !shift) || k === "up") return go(at - 1);
  if ((k === "enter" || (k === "o" && !shift)) && n > 0) { open(at); return true; }
  if (more && more(k, e)) return true;
  if (k === "h" && !shift) { leave("left"); return true; }
  if (k === "l" && !shift) { leave("right"); return true; }
  if (k === "escape") { leave("left"); return true; }
  return false;
}
