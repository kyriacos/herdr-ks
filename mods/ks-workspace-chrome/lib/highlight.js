// A small line-based syntax highlighter for diff rows (Herdr's Editor colors whole files, but a diff
// needs its own rows with added/removed backgrounds). Source of truth: shared/highlight.js in the repo;
// scripts/install.sh copies it into each mod's lib/ (mods can't import from each other).
//
// tokenize(text, lang, state) -> { tokens: [{ text, kind }], state }
// kinds: keyword, string, comment, number, function, type, constant, plain. `state` carries an open
// block comment or multi-line string from one line to the next (null: none).

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const JS = words(`break case catch class const continue debugger default delete do else export extends finally for
  from function if import in instanceof let new of return static super switch this throw try typeof var void while
  with yield async await as implements interface type enum namespace declare readonly private protected public
  abstract keyof satisfies get set`);
const PY = words(`and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda nonlocal not or pass raise return try while with yield match case self cls`);
const GO = words(`break case chan const continue default defer else fallthrough for func go goto if import interface
  map package range return select struct switch type var`);
const RS = words(`as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod
  move mut pub ref return self Self static struct super trait type unsafe use where while`);
const SH = words(`if then else elif fi for while until do done case esac in function return local export readonly
  set unset shift exit source alias echo cd`);
const SQL = words(`select from where and or not insert into values update set delete create table alter drop index
  join left right inner outer on group by order having limit offset as distinct union all null is in exists case
  when then else end primary key foreign references default constraint begin commit rollback with returning`);
const CSS = words(`important media import supports keyframes from to`);
const CONST = words(`true false null undefined None True False nil NaN Infinity`);

const LANGS = {
  js: { kw: JS, line: ["//"], block: ["/*", "*/"], strings: ['"', "'", "`"], multi: ["`"] },
  py: { kw: PY, line: ["#"], strings: ['"', "'"], triple: true },
  go: { kw: GO, line: ["//"], block: ["/*", "*/"], strings: ['"', "'", "`"], multi: ["`"] },
  rs: { kw: RS, line: ["//"], block: ["/*", "*/"], strings: ['"'] },
  sh: { kw: SH, line: ["#"], strings: ['"', "'"] },
  sql: { kw: SQL, line: ["--"], block: ["/*", "*/"], strings: ["'"], ci: true },
  css: { kw: CSS, block: ["/*", "*/"], strings: ['"', "'"] },
  json: { kw: new Set(), strings: ['"'] },
  yaml: { kw: new Set(), line: ["#"], strings: ['"', "'"] },
  toml: { kw: new Set(), line: ["#"], strings: ['"', "'"] },
  html: { kw: new Set(), block: ["<!--", "-->"], strings: ['"', "'"] },
  c: { kw: words(`auto break case char const continue default do double else enum extern float for goto if int long
    register return short signed sizeof static struct switch typedef union unsigned void volatile while class public
    private protected namespace template typename new delete virtual override bool`), line: ["//"], block: ["/*", "*/"], strings: ['"', "'"] },
};

const EXT = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", tsx: "js", mts: "js", cts: "js", vue: "js", svelte: "js",
  py: "py", pyi: "py", go: "go", rs: "rs", sh: "sh", bash: "sh", zsh: "sh", fish: "sh", sql: "sql",
  css: "css", scss: "css", less: "css", json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", toml: "toml",
  html: "html", htm: "html", xml: "html", svg: "html", c: "c", h: "c", cpp: "c", hpp: "c", cc: "c", java: "c",
  kt: "c", swift: "c", cs: "c", php: "c", rb: "py",
};

export function langOf(path) {
  const name = (path ?? "").split("/").pop().toLowerCase();
  if (name === "dockerfile" || name === "makefile") return "sh";
  return EXT[name.includes(".") ? name.split(".").pop() : ""] ?? null;
}

// Theme colors per kind (theme(): ansi1..ansi7, dim, foreground).
export function colorsFor(t) {
  return { keyword: t.ansi5, string: t.ansi2, comment: t.dim, number: t.ansi3, function: t.ansi4, type: t.ansi6, constant: t.ansi3, plain: t.foreground };
}

const IDENT = /[A-Za-z_$][\w$]*/y, NUM = /(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y;

export function tokenize(text, lang, state = null) {
  const L = LANGS[lang];
  if (!L) return { tokens: [{ text, kind: "plain" }], state: null };
  const out = [];
  const push = (s, kind) => { if (!s) return; const last = out[out.length - 1]; if (last && last.kind === kind) last.text += s; else out.push({ text: s, kind }); };
  let i = 0;
  // Carried over: inside a block comment or a multi-line string.
  if (state?.block) {
    const end = text.indexOf(state.block, i);
    if (end < 0) return { tokens: [{ text, kind: "comment" }], state };
    push(text.slice(0, end + state.block.length), "comment"); i = end + state.block.length; state = null;
  } else if (state?.str) {
    const end = text.indexOf(state.str, i);
    if (end < 0) return { tokens: [{ text, kind: "string" }], state };
    push(text.slice(0, end + state.str.length), "string"); i = end + state.str.length; state = null;
  }
  while (i < text.length) {
    const rest = text.slice(i), c = text[i];
    if (L.line?.some((m) => rest.startsWith(m))) { push(rest, "comment"); return { tokens: out, state: null }; }
    if (L.block && rest.startsWith(L.block[0])) {
      const end = text.indexOf(L.block[1], i + L.block[0].length);
      if (end < 0) { push(rest, "comment"); return { tokens: out, state: { block: L.block[1] } }; }
      push(text.slice(i, end + L.block[1].length), "comment"); i = end + L.block[1].length; continue;
    }
    if (L.triple && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3), end = text.indexOf(q, i + 3);
      if (end < 0) { push(rest, "string"); return { tokens: out, state: { str: q } }; }
      push(text.slice(i, end + 3), "string"); i = end + 3; continue;
    }
    if (L.strings.includes(c)) {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length && L.multi?.includes(c)) { push(rest, "string"); return { tokens: out, state: { str: c } }; }
      // JSON keys read as names, not strings.
      const s = text.slice(i, j + 1), key = lang === "json" && /^\s*:/.test(text.slice(j + 1));
      push(s, key ? "type" : "string"); i = j + 1; continue;
    }
    NUM.lastIndex = i;
    if (/\d/.test(c) && !/[\w$]/.test(text[i - 1] ?? "") && NUM.test(text)) { push(text.slice(i, NUM.lastIndex), "number"); i = NUM.lastIndex; continue; }
    IDENT.lastIndex = i;
    if (IDENT.test(text)) {
      const w = text.slice(i, IDENT.lastIndex), next = text.slice(IDENT.lastIndex).match(/^\s*(.)/)?.[1];
      const kind = (L.ci ? L.kw.has(w.toLowerCase()) : L.kw.has(w)) ? "keyword"
        : CONST.has(w) ? "constant"
        : next === "(" ? "function"
        : /^[A-Z][A-Za-z0-9]*[a-z]/.test(w) ? "type"
        : /^[A-Z][A-Z0-9_]{2,}$/.test(w) ? "constant" : "plain";
      push(w, kind); i = IDENT.lastIndex; continue;
    }
    push(c, "plain"); i++;
  }
  return { tokens: out, state: null };
}

// Tokens for many lines in order (state carried), e.g. every line of one side of a diff.
export function tokenizeAll(lines, lang) {
  let state = null;
  return lines.map((l) => { const r = tokenize(l, lang, state); state = r.state; return r.tokens; });
}
