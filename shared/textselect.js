// Double-click selects the word under the pointer and triple-click its line, in a text box (InputState or
// TextareaState), as everywhere else on macOS. The box's own press places the caret first; this widens it.
//   el.on_mouse_down("left", (e, cx) => selectOnClicks(state, e, cx))   on the box's frame (the press bubbles up to it)
// Source of truth: shared/textselect.js; scripts/install.sh copies it into each mod's lib/.
const WORD = /[\p{L}\p{N}_]/u;

export function selectOnClicks(state, e, cx) {
  const n = e?.click_count ?? 1;
  if (n < 2 || !state) return;
  // A press the box hasn't handled yet still has the old caret: widen it on the next tick.
  cx.timer.after(10, () => {
    const text = state.value?.() ?? "", r = state.selected_range?.();
    if (!r) return;
    const at = Math.min(r.start, text.length);
    let start = at, end = at;
    if (n >= 3) {
      start = text.lastIndexOf("\n", at - 1) + 1;
      const nl = text.indexOf("\n", at);
      end = nl < 0 ? text.length : nl;
    } else {
      const isWord = (i) => i >= 0 && i < text.length && WORD.test(text[i]);
      // On a word (or just after one): its letters; on anything else, that one character.
      const on = isWord(at) ? at : isWord(at - 1) ? at - 1 : -1;
      if (on < 0) { start = at; end = Math.min(text.length, at + 1); }
      else { start = on; end = on; while (isWord(start - 1)) start--; while (isWord(end)) end++; }
    }
    if (end > start) state.set_selected_range({ start, end });
  });
}
