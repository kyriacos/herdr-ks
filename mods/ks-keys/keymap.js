// ks-keys' keymap: modes you enter with a key, each a list of bindings. Self-contained: everything ks-keys knows
// is here and in shared state "ks-keys.config" (edited in its editor, saved across restarts).
//
// A mode: { name, entry (a key in keys.json spelling, "" = only from another mode), sticky (stays until Esc,
// e.g. moving between panes with h/j/k/l; otherwise one key and out), bindings: [{ key, label, do }] }.
// `key`: one typed character ("%", "H", "?") or a chord ("ctrl-x", "left", "enter").
// `do`: what it runs, as text:
//   "pane.split direction=right"   a Herdr command with arguments (numbers and true/false are converted)
//   "ks-tabs.undo"                 a mod's command
//   "mode:move"                    switch to another mode
//   "send:ctrl+b"                  press keys in the focused terminal (hc keys spelling)
//   "tab.shift by=1"               move the shown tab one place right (-1: left)
import { exec, appHome, shared, setShared } from "herdr";

export const KEY = "ks-keys.config";

const nav = (prefix = "") => [
  { key: "h", label: "Go left", do: "pane.go direction=left" },
  { key: "j", label: "Go down", do: "pane.go direction=down" },
  { key: "k", label: "Go up", do: "pane.go direction=up" },
  { key: "l", label: "Go right", do: "pane.go direction=right" },
  { key: "left", label: "Go left", do: "pane.go direction=left" },
  { key: "down", label: "Go down", do: "pane.go direction=down" },
  { key: "up", label: "Go up", do: "pane.go direction=up" },
  { key: "right", label: "Go right", do: "pane.go direction=right" },
  { key: "H", label: "Swap left", do: "pane.swap direction=left" },
  { key: "J", label: "Swap down", do: "pane.swap direction=down" },
  { key: "K", label: "Swap up", do: "pane.swap direction=up" },
  { key: "L", label: "Swap right", do: "pane.swap direction=right" },
];
const numbers = () => Array.from({ length: 9 }, (_, i) => ({ key: String(i + 1), label: `Tab ${i + 1}`, do: `tab.select index=${i + 1}` }));
const modes = () => [
  { key: "m", label: "Move mode (sticky)", do: "mode:move" },
  { key: "t", label: "Tab mode (sticky)", do: "mode:tabs" },
  { key: "S", label: "Space mode (sticky)", do: "mode:spaces" },
];

export const DEFAULTS = {
  version: 1,
  sections: ["layout:ks", "layout:ks-zen"],
  editor: "cmd-k",
  modes: {
    tmux: {
      name: "tmux", entry: "ctrl-b", sticky: false,
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
        { key: "/", label: "Search terminal", do: "terminal.search" },
        { key: ":", label: "Command palette", do: "app.palette" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        ...nav(), ...numbers(), ...modes(),
        { key: "?", label: "Edit key modes", do: "ks-keys.editor" },
      ],
    },
    vim: {
      name: "vim", entry: "", sticky: false,
      bindings: [
        ...nav(),
        { key: "s", label: "Split down", do: "pane.split direction=down" },
        { key: "v", label: "Split right", do: "pane.split direction=right" },
        { key: "q", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "c", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "o", label: "Zoom pane (only)", do: "pane.zoom" },
        { key: "n", label: "New tab", do: "tab.new" },
        { key: "t", label: "Next tab", do: "tab.next" },
        { key: "T", label: "Previous tab", do: "tab.prev" },
        { key: "m", label: "Move mode (sticky)", do: "mode:move" },
        { key: "?", label: "Edit key modes", do: "ks-keys.editor" },
      ],
    },
    move: {
      name: "move", entry: "", sticky: true,
      bindings: [
        ...nav(),
        { key: "z", label: "Zoom pane", do: "pane.zoom" },
        { key: "s", label: "Split down", do: "pane.split direction=down" },
        { key: "v", label: "Split right", do: "pane.split direction=right" },
        { key: "x", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "n", label: "Next tab", do: "tab.next" },
        { key: "p", label: "Previous tab", do: "tab.prev" },
        { key: "t", label: "Tab mode", do: "mode:tabs" },
      ],
    },
    tabs: {
      name: "tabs", entry: "", sticky: true,
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
        ...numbers(),
        { key: "m", label: "Move mode", do: "mode:move" },
        { key: "S", label: "Space mode", do: "mode:spaces" },
      ],
    },
    spaces: {
      name: "spaces", entry: "", sticky: true,
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
      ],
    },
  },
};

const clone = (x) => JSON.parse(JSON.stringify(x));
export const config = () => {
  const c = shared(KEY);
  return c?.version === 1 && c.modes ? c : clone(DEFAULTS);
};
export const save = (c) => setShared(KEY, c);
export const reset = () => setShared(KEY, clone(DEFAULTS));

// Does this key event press `key`? One character compares with what it types (so "%" and "H" work on any
// layout), without ctrl/alt/cmd; anything else with the whole chord.
export function matches(key, e) {
  if (!key) return false;
  const m = e.modifiers ?? {};
  if ([...key].length === 1) return e.key_char === key && !m.control && !m.alt && !m.platform && !m.function;
  return e.keystroke === key;
}

// "pane.split direction=right" -> { command, args }, "mode:move" -> { mode }, "send:ctrl+b" -> { send }.
export function parse(text) {
  const s = String(text ?? "").trim();
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

// Puts the entry keys (and the editor's) into keys.json's sections, replacing what ks-keys put there before
// (any action starting with "ks-keys."), and writes the file only when it changed. Herdr reloads keys.json itself.
export async function syncKeys(c = config()) {
  const file = `${appHome()}/keys.json`;
  const r = await exec("cat", [file]).catch(() => null);
  let keys = {};
  try { keys = JSON.parse(r?.stdout || "{}"); } catch { return false; }
  const before = JSON.stringify(keys);
  const want = {};
  for (const [id, m] of Object.entries(c.modes)) if (m.entry) want[m.entry] = `ks-keys.enter:${id}`;
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
