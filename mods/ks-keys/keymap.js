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
//   "resize focus=wide by=1"       what you're in (zen window, split pane, else the pane against the side panel)
//                                  bigger: focus=size both ways, wide sideways, tall up and down; reset=true back
//                                  to its default (zen centered, a split even)
//   "resize id=panel by=24"        a layout block bigger (negative: smaller), px; id=auto: zen width, else the
//                                  side panel when it shows, else the sidebar
import { exec, appHome, shared, setShared } from "herdr";

export const KEY = "ks-keys.config";

// Commands that open a dialog, a picker or a search: a sticky mode leaves before them, so they get the keyboard.
export const EXITS = new Set(["tab.rename", "space.rename", "app.palette", "mod.open", "terminal.search", "ks-keys.editor",
  "ks-zen.settings", "ks-tabs.close", "ks-tabs.close-space", "space.new", "app.help"]);
export const VERSION = 16;

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
// Vim's ctrl-w window commands: one key after ctrl-w (5 ctrl-w + : counts after the prefix), in the window mode and,
// as ctrl-w sequences, in vim's normal mode.
const windowKeys = [
  ...go,
  { key: "ctrl-h", label: "Go left", do: "pane.go direction=left" },
  { key: "ctrl-j", label: "Go down", do: "pane.go direction=down" },
  { key: "ctrl-k", label: "Go up", do: "pane.go direction=up" },
  { key: "ctrl-l", label: "Go right", do: "pane.go direction=right" },
  ...swap,
  { key: "s", label: "Split down", do: "pane.split direction=down" },
  { key: "ctrl-s", label: "Split down", do: "pane.split direction=down" },
  { key: "v", label: "Split right", do: "pane.split direction=right" },
  { key: "ctrl-v", label: "Split right", do: "pane.split direction=right" },
  { key: "n", label: "New pane (split down)", do: "pane.split direction=down" },
  { key: "c", label: "Close pane", do: "ks-tabs.close-pane" },
  { key: "q", label: "Close pane", do: "ks-tabs.close-pane" },
  { key: "o", label: "Zoom pane over its tab", do: "pane.zoom" },
  { key: "ctrl-o", label: "Zoom pane over its tab", do: "pane.zoom" },
  { key: "O", label: "Zoom pane over the window", do: "ks-zen.zoom" },
  { key: "+", label: "Taller (what you're in)", do: "resize focus=tall by=1" },
  { key: "-", label: "Shorter (what you're in)", do: "resize focus=tall by=-1" },
  { key: ">", label: "Wider (what you're in)", do: "resize focus=wide by=1" },
  { key: "<", label: "Narrower (what you're in)", do: "resize focus=wide by=-1" },
  { key: "=", label: "Default size (split even, zen centered)", do: "resize focus=size reset=true" },
  { key: "T", label: "New tab", do: "tab.new" },
  { key: "g t", label: "Next tab", do: "tab.next" },
  { key: "g T", label: "Previous tab", do: "tab.prev" },
  { key: "z", label: "Zen mode", do: "ks-zen.toggle" },
  { key: "f", label: "Focus mode", do: "ks-zen.focus" },
  { key: "u", label: "Undo close", do: "ks-tabs.undo" },
  { key: ":", label: "Command palette", do: "app.palette" },
];
const tabNumbers = Array.from({ length: 9 }, (_, i) => ({ key: String(i + 1), label: `Tab ${i + 1}`, do: `tab.select index=${i + 1}` }));

export const DEFAULTS = {
  version: VERSION,
  sections: ["layout:ks"],
  editor: "cmd-k",
  delay: 1000, // ms before the key strip shows (it catches keys at once)
  modes: {
    // Service mode: entered with ctrl-;, its keys work until Esc (a key that opens something to type into, such as
    // rename or the palette, leaves it first).
    service: {
      name: "service", entry: "ctrl-;", sticky: true, counts: true, off: false,
      bindings: [
        { key: "%", label: "Split right", do: "pane.split direction=right" },
        { key: "\"", label: "Split down", do: "pane.split direction=down" },
        { key: "x", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "z", label: "Zoom pane over its tab", do: "pane.zoom" },
        { key: "c", label: "New tab", do: "tab.new" },
        { key: "n", label: "Next tab", do: "tab.next" },
        { key: "p", label: "Previous tab", do: "tab.prev" },
        { key: "&", label: "Close tab", do: "ks-tabs.close" },
        { key: ",", label: "Rename tab", do: "tab.rename" },
        { key: "$", label: "Rename space", do: "space.rename" },
        { key: "(", label: "Previous space", do: "space.prev" },
        { key: ")", label: "Next space", do: "space.next" },
        { key: "N", label: "Next space", do: "space.next" },
        { key: "P", label: "Previous space", do: "space.prev" },
        { key: "o", label: "Zoom pane over its tab", do: "pane.zoom" },
        { key: "O", label: "Zoom pane over the window", do: "ks-zen.zoom" },
        { key: "a", label: "Next agent", do: "agent.next" },
        { key: "s", label: "Pick a space", do: "mod.open name=picker" },
        { key: "/", label: "Search terminal", do: "terminal.search" },
        { key: ":", label: "Command palette", do: "app.palette" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        { key: "Z", label: "Zen mode", do: "ks-zen.toggle" },
        { key: "f", label: "Focus mode", do: "ks-zen.focus" },
        ...go, ...swap, ...tabNumbers,
        { key: "F", label: "Focus & zen settings", do: "ks-zen.settings" },
        { key: ".", label: "herdr-ks settings", do: "mod.open name=ks-settings" },
        { key: "r", label: "Resize mode (sticky)", do: "mode:resize" },
        { key: "-", label: "Narrower (what you're in)", do: "resize focus=wide by=-1" },
        { key: "=", label: "Wider (what you're in)", do: "resize focus=wide by=1" },
        { key: "_", label: "Shorter (what you're in)", do: "resize focus=tall by=-1" },
        { key: "+", label: "Taller (what you're in)", do: "resize focus=tall by=1" },
        { key: "<", label: "Shorter (what you're in)", do: "resize focus=tall by=-1" },
        { key: ">", label: "Taller (what you're in)", do: "resize focus=tall by=1" },
        { key: "0", label: "Default size (zen centered, split even)", do: "resize focus=size reset=true" },
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
        { key: "z", label: "Zoom pane over its tab", do: "pane.zoom" },
        { key: "Z", label: "Zoom pane over the window", do: "ks-zen.zoom" },
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
    // Vim's ctrl-w: one window command, then back to the terminal. Switched on with "Vim keys" (it takes ctrl-w,
    // a shell's delete-word: ctrl-w twice still sends it, and alt-backspace deletes a word too).
    window: {
      name: "window (ctrl-w)", entry: "ctrl-w", sticky: false, counts: true, off: true,
      bindings: [
        ...windowKeys,
        { key: "N", label: "Vim normal mode", do: "mode:vim" },
        { key: "escape", label: "Cancel", do: "leave" },
      ],
    },
    // A normal mode for the window: motions, counts and sequences, until i / Esc. "Vim keys" gives it its own key,
    // ctrl-\ (as neovim's ctrl-\ ctrl-n leaves a terminal for normal mode).
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
        { key: "o", label: "Zoom pane over its tab", do: "pane.zoom" },
        { key: "O", label: "Zoom pane over the window", do: "ks-zen.zoom" },
        { key: "d d", label: "Close pane", do: "ks-tabs.close-pane" },
        { key: "d t", label: "Close tab", do: "ks-tabs.close" },
        { key: "t", label: "New tab", do: "tab.new" },
        { key: "r", label: "Rename tab", do: "tab.rename" },
        { key: "u", label: "Undo close", do: "ks-tabs.undo" },
        { key: "z z", label: "Zen mode", do: "ks-zen.toggle" },
        { key: ":", label: "Command palette", do: "app.palette" },
        ...windowKeys.filter((b) => !b.key.includes(" ")).map((b) => ({ ...b, key: `ctrl-w ${b.key}` })),
        { key: "i", label: "Back to the terminal", do: "leave" },
        { key: "a", label: "Back to the terminal", do: "leave" },
        { key: "q", label: "Back to the terminal", do: "leave" },
      ],
    },
    move: {
      name: "move", entry: "", sticky: true, counts: true,
      bindings: [
        ...go, ...swap,
        { key: "z", label: "Zoom pane over its tab", do: "pane.zoom" },
        { key: "Z", label: "Zoom pane over the window", do: "ks-zen.zoom" },
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
    // Keep pressing: - / = shorter / taller (zen, else My PRs), shift (_ / +) narrower / wider (zen, else the side
    // panel, else the sidebar); [ ] the sidebar, { } the panel.
    resize: {
      name: "resize", entry: "", sticky: true, counts: true, off: false,
      bindings: [
        { key: "-", label: "Narrower (what you're in)", do: "resize focus=wide by=-1" },
        { key: "=", label: "Wider (what you're in)", do: "resize focus=wide by=1" },
        { key: "_", label: "Shorter (what you're in)", do: "resize focus=tall by=-1" },
        { key: "+", label: "Taller (what you're in)", do: "resize focus=tall by=1" },
        { key: ",", label: "Narrower (what you're in)", do: "resize focus=wide by=-1" },
        { key: ".", label: "Wider (what you're in)", do: "resize focus=wide by=1" },
        { key: "<", label: "Shorter (what you're in)", do: "resize focus=tall by=-1" },
        { key: ">", label: "Taller (what you're in)", do: "resize focus=tall by=1" },
        { key: "0", label: "Default size (zen centered, split even)", do: "resize focus=size reset=true" },
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
  // Version 5: service mode stays on until Esc (it also swapped z / Z, undone in version 8).
  if ((old.version ?? 0) < 5 && c.modes.service) {
    const sv = c.modes.service;
    sv.sticky = true;
    const z = sv.bindings.find((b) => b.key === "z"), Z = sv.bindings.find((b) => b.key === "Z");
    if (z?.do === "pane.zoom" && Z?.do === "ks-zen.toggle") { z.key = "Z"; Z.key = "z"; }
  }
  // Version 8: z zooms the pane again and Z is zen (version 5 had them the other way round), when unchanged.
  if ((old.version ?? 0) < 8 && c.modes.service) {
    const sv = c.modes.service, z = sv.bindings.find((b) => b.key === "z"), Z = sv.bindings.find((b) => b.key === "Z");
    if (z?.do === "ks-zen.toggle" && Z?.do === "pane.zoom") { z.key = "Z"; Z.key = "z"; }
  }
  // Version 7: - / = resize vertically, _ / + horizontally (they were one "smaller / larger").
  if ((old.version ?? 0) < 7) for (const id of ["service", "resize"]) {
    const mine = c.modes[id];
    if (!mine) continue;
    mine.bindings = mine.bindings.filter((b) => !(["-", "=", "+", "_"].includes(b.key) && /^resize /.test(b.do)));
  }
  // Version 11: the plain key one way, Shift the other: - = narrower / wider, _ + shorter / taller (and , . / < >),
  // 0 the default size; all on what you're in. Older resize keys on these go.
  if ((old.version ?? 0) < 11) for (const id of ["service", "resize"]) {
    const mine = c.modes[id];
    if (!mine) continue;
    mine.bindings = mine.bindings.filter((b) => !(["-", "=", "+", "_", "<", ">", "v", "^", ",", ".", "0"].includes(b.key) && /^resize /.test(b.do)));
  }
  // Version 16: service o / O zoom (over its tab / the window) like ctrl-w and vim; next agent moves to a, and N / P
  // go to the next / previous space. An o that still runs next agent gives way (the merge below adds the rest).
  if ((old.version ?? 0) < 16 && c.modes.service) {
    const sv = c.modes.service;
    sv.bindings = sv.bindings.filter((b) => !(b.key === "o" && b.do === "agent.next"));
  }
  for (const [id, m] of Object.entries(DEFAULTS.modes)) {
    if (!c.modes[id]) { c.modes[id] = clone(m); continue; }
    const mine = c.modes[id];
    for (const k of ["off", "counts"]) if (mine[k] === undefined) mine[k] = m[k];
    const taken = new Set(mine.bindings.map((b) => tokens(b.key).join(" ")));
    for (const b of m.bindings) if (!taken.has(tokens(b.key).join(" "))) mine.bindings.push(clone(b));
  }
  // Version 15: zoom keys say which zoom they are (plain: over its tab; capital O / Z and ⌘⌥⇧↩: over the window).
  if ((old.version ?? 0) < 15) for (const m of Object.values(c.modes)) for (const b of m.bindings ?? []) {
    if (b.do === "pane.zoom" && /^Zoom pane( \(only\))?$/.test(b.label)) b.label = "Zoom pane over its tab";
  }
  // Version 14: the strip waits 1 s (500 ms felt too short); an older default goes up, a chosen one stays.
  if (c.delay === undefined || ((old.version ?? 0) < 14 && c.delay === 500)) c.delay = DEFAULTS.delay;
  // Zen is a window now, not a layout: its key sections go.
  c.sections = [...new Set([...(c.sections ?? []).filter((x) => !/^layout:ks-zen/.test(x)), ...DEFAULTS.sections])];
  c.version = VERSION;
  return c;
}
// "Vim keys": ctrl-w window commands anywhere, and ctrl-\\ into vim's normal mode. On when both are reachable.
export const VIM_ENTRY = "ctrl-\\";
export const vimKeys = (c = config()) => usable(c, "window") && Boolean(c.modes.vim?.entry) && usable(c, "vim");
export function setVimKeys(c, on) {
  if (c.modes.window) c.modes.window.off = !on;
  if (c.modes.vim) { c.modes.vim.off = false; c.modes.vim.entry = on ? (c.modes.vim.entry || VIM_ENTRY) : ""; }
  // Another mode on the same key gives it up.
  if (on) for (const [id, m] of Object.entries(c.modes)) if ((id !== "window" && m.entry === c.modes.window?.entry) || (id !== "vim" && m.entry === c.modes.vim?.entry)) m.entry = "";
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
