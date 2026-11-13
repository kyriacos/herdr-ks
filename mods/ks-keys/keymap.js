// ks-keys' keymap: modes you enter with a key, each a list of bindings. Self-contained: everything ks-keys knows
// is here and in shared state "ks-keys.config" (edited in its editor, saved across restarts).
//
// A binding can also say exit: true (a sticky mode leaves before running it); commands that open something to
// type into (EXITS below) always leave first.
// A mode: { name, off (switched off: no entry key, not reachable), entry (a key in keys.json spelling, "" = only
// from another mode), sticky (stays until Esc or a
// "leave" key; otherwise one key and out), counts (digits before a key repeat it, or fill its `count` action, as in
// vim: 3gt), bindings: [{ key, label, do, count? }] }.
// `key`: one typed character ("%", "H", "?"), a chord ("ctrl-d", "left", "escape"), or a sequence of them with
// spaces ("g t", "d d"). Typing a sequence's start waits for the rest.
// `do` (and `count`, used instead when a count was typed; `#` is the count):
//   "pane.split direction=right"   a Herdr command with arguments (numbers and true/false are converted)
//   "ks-tabs.undo"                 a mod's command
//   "mode:move"                    switch to another mode
//   "leave"                        leave the mode (back to the terminal)
//   "send:ctrl+b"                  press keys in the focused terminal (hc keys spelling)
//   "tab.shift by=1"               move the shown tab one place right (-1: left)
//   "resize id=panel by=24"        a layout block bigger (negative: smaller), px; id=auto: zen width, else the
//                                  side panel when it shows, else the sidebar
import { exec, appHome, shared, setShared } from "herdr";

export const KEY = "ks-keys.config";

// Commands that open a dialog, a picker or a search: a sticky mode leaves before them, so they get the keyboard.
export const EXITS = new Set(["tab.rename", "space.rename", "app.palette", "mod.open", "terminal.search", "ks-keys.editor",
  "ks-zen.settings", "ks-tabs.close", "ks-tabs.close-space", "space.new", "app.help"]);
export const VERSION = 5;

const go = [
  { key: "h", label: "Go left", do: "pane.go direction=left" },
  { key: "j", label: "Go down", do: "pane.go direction=down" },
  { key: "k", label: "Go up", do: "pane.go direction=up" },
  { key: "l", label: "Go right", do: "pane.go direction=right" },
  { key: "left", label: "Go left", do: "pane.go direction=left" },
  { key: "down", label: "Go down", do: "pane.go direction=down" },
  { key: "up", label: "Go up", do: "pane.go direction=up" },
  { key: "right", label: "Go right", do: "pane.go direction=right" },
];
const swap = [
  { key: "H", label: "Swap left", do: "pane.swap direction=left" },
  { key: "J", label: "Swap down", do: "pane.swap direction=down" },
  { key: "K", label: "Swap up", do: "pane.swap direction=up" },
  { key: "L", label: "Swap right", do: "pane.swap direction=right" },
];
const tabNumbers = Array.from({ length: 9 }, (_, i) => ({ key: String(i + 1), label: `Tab ${i + 1}`, do: `tab.select index=${i + 1}` }));

export const DEFAULTS = {
  version: VERSION,
  sections: ["layout:ks", "layout:ks-zen", "layout:ks-zen-dark"],
  editor: "cmd-k",
  modes: {
    // Service mode: entered with ctrl-;, its keys work until Esc (a key that opens something to type into, such as
    // rename or the palette, leaves it first).
    service: {
      name: "service", entry: "ctrl-;", sticky: true, counts: true, off: false,
      bindings: [
        { key: "%", label: "Split right", do: "pane.split direction=right" },
        { key: "\"", label: "Split down", do: "pane.split direction=down" },
        { key: "x", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "Z", label: "Zoom pane", do: "pane.zoom" },
        { key: "c", label: "New tab", do: "tab.new" },
        { key: "n", label: "Next tab", do: "tab.next" },
        { key: "p", label: "Previous tab", do: "tab.prev" },
        { key: "&", label: "Close tab", do: "ks-tabs.close" },
        { key: ",", label: "Rename tab", do: "tab.rename" },
        { key: "$", label: "Rename space", do: "space.rename" },
        { key: "(", label: "Previous space", do: "space.prev" },
        { key: ")", label: "Next space", do: "space.next" },
        { key: "o", label: "Next agent", do: "agent.next" },
        { key: "s", label: "Pick a space", do: "mod.open name=picker" },
        { key: "/", label: "Search terminal", do: "terminal.search" },
        { key: ":", label: "Command palette", do: "app.palette" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        { key: "z", label: "Zen mode", do: "ks-zen.toggle" },
        { key: "f", label: "Focus mode", do: "ks-zen.focus" },
        ...go, ...swap, ...tabNumbers,
        { key: "F", label: "Focus & zen settings", do: "ks-zen.settings" },
        { key: "r", label: "Resize mode (sticky)", do: "mode:resize" },
        { key: "-", label: "Smaller (panel / zen)", do: "resize id=auto by=-32" },
        { key: "=", label: "Larger (panel / zen)", do: "resize id=auto by=32" },
        { key: "[", label: "Vim mode (normal)", do: "mode:vim" },
        { key: "m", label: "Move mode (sticky)", do: "mode:move" },
        { key: "t", label: "Tab mode (sticky)", do: "mode:tabs" },
        { key: "S", label: "Space mode (sticky)", do: "mode:spaces" },
        { key: "?", label: "Edit key modes", do: "ks-keys.editor" },
      ],
    },
    // tmux: one key after the prefix, then back to the terminal. Off by default (ctrl-b stays the terminal's).
    tmux: {
      name: "tmux", entry: "ctrl-b", sticky: false, counts: false, off: true,
      bindings: [
        { key: "%", label: "Split right", do: "pane.split direction=right" },
        { key: "\"", label: "Split down", do: "pane.split direction=down" },
        { key: "x", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "z", label: "Zoom pane", do: "pane.zoom" },
        { key: "c", label: "New tab", do: "tab.new" },
        { key: "n", label: "Next tab", do: "tab.next" },
        { key: "p", label: "Previous tab", do: "tab.prev" },
        { key: "&", label: "Close tab", do: "ks-tabs.close" },
        { key: ",", label: "Rename tab", do: "tab.rename" },
        { key: "$", label: "Rename space", do: "space.rename" },
        { key: "(", label: "Previous space", do: "space.prev" },
        { key: ")", label: "Next space", do: "space.next" },
        { key: "o", label: "Next agent", do: "agent.next" },
        { key: "s", label: "Pick a space", do: "mod.open name=picker" },
        { key: "[", label: "Vim mode (normal)", do: "mode:vim" },
        ...go, ...tabNumbers,
      ],
    },
    // A normal mode for the window: motions, counts and sequences, until i / Esc.
    vim: {
      name: "vim", entry: "", sticky: true, counts: true, off: false,
      bindings: [
        { key: "h", label: "Pane left", do: "pane.go direction=left" },
        { key: "j", label: "Pane down", do: "pane.go direction=down" },
        { key: "k", label: "Pane up", do: "pane.go direction=up" },
        { key: "l", label: "Pane right", do: "pane.go direction=right" },
        ...swap,
        { key: "g t", label: "Next tab (3gt: tab 3)", do: "tab.next", count: "tab.select index=#" },
        { key: "g T", label: "Previous tab", do: "tab.prev" },
        { key: "w", label: "Next tab", do: "tab.next" },
        { key: "b", label: "Previous tab", do: "tab.prev" },
        { key: "}", label: "Next space", do: "space.next" },
        { key: "{", label: "Previous space", do: "space.prev" },
        { key: "g s", label: "Space (3gs: space 3)", do: "mod.open name=picker", count: "space.select index=#" },
        { key: "ctrl-d", label: "Scroll half page down", do: "terminal.scroll pages=0.5" },
        { key: "ctrl-u", label: "Scroll half page up", do: "terminal.scroll pages=-0.5" },
        { key: "ctrl-f", label: "Scroll page down", do: "terminal.scroll pages=1" },
        { key: "ctrl-b", label: "Scroll page up", do: "terminal.scroll pages=-1" },
        { key: "ctrl-e", label: "Scroll line down", do: "terminal.scroll lines=1" },
        { key: "ctrl-y", label: "Scroll line up", do: "terminal.scroll lines=-1" },
        { key: "g g", label: "Scroll to top", do: "terminal.scroll to=top" },
        { key: "G", label: "Scroll to bottom", do: "terminal.scroll to=bottom" },
        { key: "/", label: "Search terminal", do: "terminal.search" },
        { key: "s", label: "Split down", do: "pane.split direction=down" },
        { key: "v", label: "Split right", do: "pane.split direction=right" },
        { key: "o", label: "Zoom pane (only)", do: "pane.zoom" },
        { key: "d d", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "d t", label: "Close tab", do: "ks-tabs.close" },
        { key: "t", label: "New tab", do: "tab.new" },
        { key: "r", label: "Rename tab", do: "tab.rename" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        { key: "z z", label: "Zen mode", do: "ks-zen.toggle" },
        { key: ":", label: "Command palette", do: "app.palette" },
        { key: "i", label: "Back to the terminal", do: "leave" },
        { key: "a", label: "Back to the terminal", do: "leave" },
        { key: "q", label: "Back to the terminal", do: "leave" },
      ],
    },
    move: {
      name: "move", entry: "", sticky: true, counts: true,
      bindings: [
        ...go, ...swap,
        { key: "z", label: "Zoom pane", do: "pane.zoom" },
        { key: "s", label: "Split down", do: "pane.split direction=down" },
        { key: "v", label: "Split right", do: "pane.split direction=right" },
        { key: "x", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "n", label: "Next tab", do: "tab.next" },
        { key: "p", label: "Previous tab", do: "tab.prev" },
        { key: "t", label: "Tab mode", do: "mode:tabs" },
        { key: "q", label: "Done", do: "leave" },
        { key: "enter", label: "Done", do: "leave" },
      ],
    },
    // Keep pressing: - / + the side panel (or the zen width), [ ] the sidebar, { } the panel, j k My PRs.
    resize: {
      name: "resize", entry: "", sticky: true, counts: true, off: false,
      bindings: [
        { key: "-", label: "Smaller (panel, or zen width)", do: "resize id=auto by=-32" },
        { key: "=", label: "Larger (panel, or zen width)", do: "resize id=auto by=32" },
        { key: "+", label: "Larger (panel, or zen width)", do: "resize id=auto by=32" },
        { key: "[", label: "Sidebar narrower", do: "resize id=sidebar by=-24" },
        { key: "]", label: "Sidebar wider", do: "resize id=sidebar by=24" },
        { key: "h", label: "Sidebar narrower", do: "resize id=sidebar by=-24" },
        { key: "l", label: "Sidebar wider", do: "resize id=sidebar by=24" },
        { key: "{", label: "Panel narrower", do: "resize id=panel by=-32" },
        { key: "}", label: "Panel wider", do: "resize id=panel by=32" },
        { key: "H", label: "Panel wider", do: "resize id=panel by=32" },
        { key: "L", label: "Panel narrower", do: "resize id=panel by=-32" },
        { key: "j", label: "My PRs taller", do: "resize id=my-prs by=24" },
        { key: "k", label: "My PRs shorter", do: "resize id=my-prs by=-24" },
        { key: "z", label: "Zen narrower", do: "ks-zen.narrower" },
        { key: "Z", label: "Zen wider", do: "ks-zen.wider" },
        { key: "q", label: "Done", do: "leave" },
        { key: "enter", label: "Done", do: "leave" },
      ],
    },
    tabs: {
      name: "tabs", entry: "", sticky: true, counts: false,
      bindings: [
        { key: "h", label: "Previous tab", do: "tab.prev" },
        { key: "l", label: "Next tab", do: "tab.next" },
        { key: "left", label: "Previous tab", do: "tab.prev" },
        { key: "right", label: "Next tab", do: "tab.next" },
        { key: "H", label: "Move tab left", do: "tab.shift by=-1" },
        { key: "L", label: "Move tab right", do: "tab.shift by=1" },
        { key: "c", label: "New tab", do: "tab.new" },
        { key: "x", label: "Close tab", do: "ks-tabs.close" },
        { key: "r", label: "Rename tab", do: "tab.rename" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        ...tabNumbers,
        { key: "m", label: "Move mode", do: "mode:move" },
        { key: "S", label: "Space mode", do: "mode:spaces" },
        { key: "q", label: "Done", do: "leave" },
        { key: "enter", label: "Done", do: "leave" },
      ],
    },
    spaces: {
      name: "spaces", entry: "", sticky: true, counts: false,
      bindings: [
        { key: "j", label: "Next space", do: "space.next" },
        { key: "k", label: "Previous space", do: "space.prev" },
        { key: "down", label: "Next space", do: "space.next" },
        { key: "up", label: "Previous space", do: "space.prev" },
        { key: "n", label: "New space", do: "space.new" },
        { key: "w", label: "New space + worktree", do: "mod.open name=ks-worktree" },
        { key: "r", label: "Rename space", do: "space.rename" },
        { key: "x", label: "Close space", do: "ks-tabs.close-space" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        ...Array.from({ length: 9 }, (_, i) => ({ key: String(i + 1), label: `Space ${i + 1}`, do: `space.select index=${i + 1}` })),
        { key: "t", label: "Tab mode", do: "mode:tabs" },
        { key: "q", label: "Done", do: "leave" },
        { key: "enter", label: "Done", do: "leave" },
      ],
    },
  },
};

const clone = (x) => JSON.parse(JSON.stringify(x));
export const usable = (c, id) => Boolean(c.modes[id] && !c.modes[id].off);
export const config = () => {
  const c = shared(KEY);
  if (!c?.modes) return clone(DEFAULTS);
  return c.version === VERSION ? c : upgrade(c);
};

// A config saved by an older version keeps its changes and gains what's new: modes it doesn't have, and default
// keys that none of its keys take. (The tmux mode of version 1 is the service mode now.)
function upgrade(old) {
  const c = clone(old);
  if ((old.version ?? 0) < 2 && c.modes.tmux && !c.modes.service) { c.modes.service = { ...c.modes.tmux, name: "service" }; delete c.modes.tmux; }
  // Version 5: service mode stays on until Esc, Z zooms and z is zen (when those keys are still the old defaults).
  if ((old.version ?? 0) < 5 && c.modes.service) {
    const sv = c.modes.service;
    sv.sticky = true;
    const z = sv.bindings.find((b) => b.key === "z"), Z = sv.bindings.find((b) => b.key === "Z");
    if (z?.do === "pane.zoom" && Z?.do === "ks-zen.toggle") { z.key = "Z"; Z.key = "z"; }
  }
  for (const [id, m] of Object.entries(DEFAULTS.modes)) {
    if (!c.modes[id]) { c.modes[id] = clone(m); continue; }
    const mine = c.modes[id];
    for (const k of ["off", "counts"]) if (mine[k] === undefined) mine[k] = m[k];
    const taken = new Set(mine.bindings.map((b) => tokens(b.key).join(" ")));
    for (const b of m.bindings) if (!taken.has(tokens(b.key).join(" "))) mine.bindings.push(clone(b));
  }
  for (const sec of DEFAULTS.sections) if (!(c.sections ?? []).includes(sec)) c.sections = [...(c.sections ?? []), sec];
  c.version = VERSION;
  return c;
}
export const save = (c) => setShared(KEY, { ...c, version: VERSION });

// A key event as one token of a binding: what it types (so "%" and "H" work on any keyboard layout) when no
// ctrl/alt/cmd is held, else the whole chord ("ctrl-d", "left", "escape").
export function token(e) {
  const m = e.modifiers ?? {};
  if (e.key_char && [...e.key_char].length === 1 && e.key_char !== " " && !m.control && !m.alt && !m.platform && !m.function) return e.key_char;
  return e.keystroke;
}
export const tokens = (key) => String(key ?? "").trim().split(/\s+/).filter(Boolean);
export const isModifier = (e) => /^(shift|control|ctrl|alt|platform|cmd|function|fn)$/.test(e.key) || /^(shift|ctrl|alt|cmd|fn)$/.test(e.keystroke);

// "pane.split direction=right" -> { command, args }; "mode:move" -> { mode }; "send:ctrl+b" -> { send }; "leave".
export function parse(text, count = null) {
  const s = String(text ?? "").trim().replace(/#/g, String(count ?? 1));
  if (s === "leave") return { leave: true };
  if (s.startsWith("mode:")) return { mode: s.slice(5).trim() };
  if (s.startsWith("send:")) return { send: s.slice(5).trim().split(/\s+/) };
  const [command, ...rest] = s.split(/\s+/);
  const args = {};
  for (const kv of rest) {
    const i = kv.indexOf("=");
    if (i < 1) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    args[k] = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return { command, args };
}

// keys.json spelling ("ctrl-b") -> hc keys spelling ("ctrl+b").
export const hcKey = (key) => key.replace(/-(?=.)/g, "+");

// Keeps keys.json's sections holding the entry keys (and the editor's): replaces what ks-keys put there before
// (any action starting with "ks-keys.") and writes the file only when it changed. Run every few seconds, so a
// reinstall or a hand edit that drops them gets them back. Herdr reloads keys.json itself.
export async function syncKeys(c = config()) {
  const file = `${appHome()}/keys.json`;
  const r = await exec("cat", [file]).catch(() => null);
  let keys = {};
  try { keys = JSON.parse(r?.stdout || "{}"); } catch { return false; }
  const before = JSON.stringify(keys);
  const want = {};
  for (const [id, m] of Object.entries(c.modes)) if (m.entry && !m.off) want[m.entry] = `ks-keys.enter:${id}`;
  if (c.editor) want[c.editor] = "ks-keys.editor";
  for (const section of c.sections ?? []) {
    const cur = { ...(keys[section] ?? {}) };
    for (const [k, v] of Object.entries(cur)) if (typeof v === "string" && v.startsWith("ks-keys.")) delete cur[k];
    keys[section] = { ...cur, ...want };
  }
  if (JSON.stringify(keys) === before) return false;
  const body = JSON.stringify(keys, null, 2) + "\n";
  await exec("sh", ["-c", 'printf "%s" "$2" > "$1.tmp" && mv "$1.tmp" "$1"', "sh", file, body]);
  return true;
}
