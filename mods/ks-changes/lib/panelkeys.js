// Vim keys for the side panels (Changes, Files, PRs, My PRs). A panel says "focusable": true in mod.json, so
// pane.go (service h/l, ctrl-w h/l, vim h/l) gives it the keyboard; it gets "focus" from nextCommand() then.
// In a panel: j/k (↓/↑) move, gg/G first/last, ctrl-d/ctrl-u half a page, Enter/o open, h/l/Esc leave towards
// the pane on that side (Esc: back to the terminal on the left).
// Source of truth: shared/panelkeys.js; scripts/install.sh copies it into each mod's lib/.
import { nextCommand, run } from "herdr";

// Focuses `view.handle` whenever Herdr hands this panel the keyboard; other commands go to `other(command, cx)`.
export function takeFocus(view, cx, other = null) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = await nextCommand();
      if (c === "focus") { view.handle?.focus(); cx.notify(); }
      else if (other) other(c, cx);
    }
  });
}

export const leave = (direction) => run("pane.go", { direction });

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
