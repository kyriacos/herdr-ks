// Unified diff -> rows for an inline view and pairs for a side-by-side view, each line highlighted.
// Source of truth: shared/diff.js; scripts/install.sh copies it into each mod's lib/.
import { tokenize } from "./highlight.js";

const untab = (s) => s.replace(/[^\t]*\t/g, (x) => x.slice(0, -1).padEnd((x.length - 1) - (x.length - 1) % 4 + 4));

// rows: [{ kind: "@" | "+" | "-" | " ", old?, new?, text, tokens? }]. The old and new side are tokenized
// separately so a block comment opened on one side doesn't color the other.
export function parseDiff(lines, lang) {
  const rows = [];
  let old = 0, next = 0, sOld = null, sNew = null;
  for (const line of lines) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; sOld = sNew = null; rows.push({ kind: "@", text: line }); continue; }
    const k = line[0], text = untab(line.slice(1));
    if (k === "-") { const r = tokenize(text, lang, sOld); sOld = r.state; rows.push({ kind: "-", old: old++, text, tokens: r.tokens }); }
    else if (k === "+") { const r = tokenize(text, lang, sNew); sNew = r.state; rows.push({ kind: "+", new: next++, text, tokens: r.tokens }); }
    else if (k === " ") {
      const a = tokenize(text, lang, sOld), b = tokenize(text, lang, sNew); sOld = a.state; sNew = b.state;
      rows.push({ kind: " ", old: old++, new: next++, text, tokens: b.tokens });
    } else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
  }
  return rows;
}

// A whole file shown as context (no diff: unchanged or untracked), numbered as new lines.
export function fileRows(text, lang, kind = " ") {
  let state = null, n = 1;
  return text.replace(/\n$/, "").split("\n").map((l) => {
    const t = untab(l), r = tokenize(t, lang, state); state = r.state;
    const row = { kind, new: n, text: t, tokens: r.tokens };
    if (kind === " ") row.old = n;
    n++;
    return row;
  });
}

// Side by side: [{ hunk } | { left: row|null, right: row|null }]. A run of removed lines pairs with the run
// of added lines after it, line by line; the longer run gets blanks on the other side.
export function splitRows(rows) {
  const out = [];
  for (let i = 0; i < rows.length;) {
    const r = rows[i];
    if (r.kind === "@") { out.push({ hunk: r }); i++; continue; }
    if (r.kind === " ") { out.push({ left: r, right: r }); i++; continue; }
    const del = [], add = [];
    while (i < rows.length && rows[i].kind === "-") del.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "+") add.push(rows[i++]);
    for (let j = 0; j < Math.max(del.length, add.length); j++) out.push({ left: del[j] ?? null, right: add[j] ?? null });
  }
  return out;
}

// Wrapping: a monospace character is about 0.6 of the font size wide. colsFor(width px, font px, taken px)
// is how many fit in what's left of a row; wrapTokens cuts a highlighted line into rows of at most `cols`
// characters, keeping each piece's color. Rows are cached on the line object per width.
export const charWidth = (fontSize) => fontSize * 0.6;
export const colsFor = (width, fontSize, taken) => Math.max(20, Math.floor((width - taken) / charWidth(fontSize)));
export function wrapTokens(row, cols) {
  if (row._wrap?.cols === cols) return row._wrap.lines;
  const tokens = row.tokens ?? [{ text: row.text ?? "", kind: "plain" }];
  const lines = [[]];
  let used = 0;
  for (const t of tokens) {
    let rest = t.text;
    while (rest.length) {
      if (used === cols) { lines.push([]); used = 0; }
      const take = rest.slice(0, cols - used);
      lines[lines.length - 1].push({ text: take, kind: t.kind });
      used += take.length; rest = rest.slice(take.length);
    }
  }
  row._wrap = { cols, lines };
  return lines;
}
// The longest line, for a horizontal scroll width when not wrapping.
export const longest = (rows) => rows.reduce((n, r) => Math.max(n, (r.text ?? "").length), 0);
