// ks-keys: key chords as modes. A key bound in keys.json (ctrl-; by default) enters a mode; the mode shows its
// keys at the bottom of the window (which-key style) and catches the next key: one key and out, or, in a sticky
// mode (move, tabs, spaces), key after key until Esc. Pressing the entry key again inside sends it on to the
// terminal (ctrl-; ctrl-; sends ctrl-;, as tmux's prefix twice). Self-contained: keymap.js has the defaults and the keys.json sync, the
// editor (cmd-k, or ? in a mode) changes all of it, kept in shared state "ks-keys.config".
//
// One mod, three roles, by props:
// - none: the copy floating in the layout (it draws nothing). It receives `enter:<mode>` and `editor` from
//   keys.json, opens the mode popup or the editor, and keeps keys.json in step with the config.
// - { mode }: the mode popup (a popup overlay at the bottom center, holding the keyboard).
// - { editor: true }: the editor (a dialog).
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, run, theme, openOverlay, closeOverlay, nextCommand, shared, setShared, spaces, focused, hc, exec, appHome, settings, notify, layout, panes } from "herdr";
import * as km from "./keymap.js";

const OPEN = "ks-keys.open"; // the mode popup's overlay id, so a second entry key replaces it
// The popup: four columns of keys (CELL wide, GAP apart) inside PAD on each side.
const COLS = 4, CELL = 198, GAP = 4, PAD = 12, ROW = 24;
const W = COLS * CELL + (COLS - 1) * GAP + PAD * 2 + 4;

async function windowSize() {
  const r = await exec("cat", [`${appHome()}/window.json`]).catch(() => null);
  try { const b = JSON.parse(r.stdout).bounds; return { w: b[2], h: b[3] }; } catch { return null; }
}

// Arrow keys repeat h/j/k/l: shown once.
const ARROWS = new Set(["left", "right", "up", "down"]);
const shownBindings = (m) => m.bindings.filter((b) => !(ARROWS.has(b.key) && m.bindings.some((o) => o !== b && o.label === b.label && !ARROWS.has(o.key))));
const keyLabel = (k) => km.tokens(k).map(one).join(" ");
const one = (k) => ({ left: "←", right: "→", up: "↑", down: "↓", enter: "⏎", escape: "esc", space: "␣" }[k] ?? k.replace(/^ctrl-/, "⌃").replace(/^cmd-/, "⌘").replace(/^alt-/, "⌥").replace(/^shift-/, "⇧"));

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = findNode(c, id); if (f) return f; }
  return null;
}

// `resize id=<node> by=<px>`: a layout block (sidebar, panel, my-prs) bigger or smaller.
// id=auto (vertical): in zen the window's height, else My PRs' height.
// id=wide (horizontal): in zen the window's width, else the side panel when it shows, else the sidebar.
// --- resizing the pane you're in ---
// Herdr has no pane-resize command, but layout.resize takes a pane's id: its weight against its siblings in the tab's
// split tree (read from Herdr's document over hc connect).
async function tabTree(tabId) {
  const req = JSON.stringify({ id: 1, method: "doc.get", params: { name: "herdr-app" } });
  const r = await exec("sh", ["-c", 'H=$(command -v hc || echo "$HOME/.local/bin/hc"); printf "%s\\n" "$1" | "$H" connect', "sh", req], { timeout: 5000 }).catch(() => null);
  let doc = null;
  for (const line of (r?.stdout ?? "").split("\n")) { try { const j = JSON.parse(line); if (j.id === 1) { doc = j; break; } } catch {} }
  for (const sp of doc?.result?.value?.spaces ?? []) for (const t of sp.tabs ?? []) if (t.id === tabId) return t.root;
  return null;
}
function pathTo(node, id, acc = []) {
  if (node?.id === id) return [...acc, node];
  for (const c of node?.children ?? []) { const p = pathTo(c, id, [...acc, node]); if (p) return p; }
  return null;
}
// The pane's share of its nearest split (`axis`: "row" for width, "column" for height, null for either) grows by
// `delta` (0.05 = 5% of the split), its siblings giving or taking in proportion; `reset` evens the split out.
// False when the pane isn't in such a split (a lone pane), so the caller can resize something else.
// The weights the last resize set, per split: Herdr animates a resize, so reading them back right after gives a
// value on the way, and steps would come out uneven. Repeated presses build on what was set instead.
let lastSplit = null; // { parent, weights: { id: w }, at }
async function resizePane(paneId, delta, axis = null, reset = false) {
  const p = paneId && panes().find((x) => x.pane === paneId);
  if (!p) return false;
  const root = await tabTree(p.tab), path = root && pathTo(root, paneId);
  if (!path) return false;
  for (let i = path.length - 2; i >= 0; i--) {
    const parent = path[i], child = path[i + 1], kids = parent.children ?? [];
    if (kids.length < 2 || (axis && parent.type !== axis)) continue;
    if (reset) {
      for (const c of kids) run("layout.resize", { id: c.id, weight: 1 });
      lastSplit = { parent: parent.id, weights: Object.fromEntries(kids.map((c) => [c.id, 1])), at: Date.now() };
      return true;
    }
    const recent = lastSplit && lastSplit.parent === parent.id && Date.now() - lastSplit.at < 5000 && kids.every((c) => c.id in lastSplit.weights);
    const ws = kids.map((c) => (recent ? lastSplit.weights[c.id] : c.size?.weight ?? 1)), total = ws.reduce((a, b) => a + b, 0), at = kids.indexOf(child);
    const share = ws[at] / total, next = Math.max(0.1, Math.min(0.9, share + delta));
    // Weights keep their total: the pane gets `next` of it, the others share the rest as before.
    const weights = {};
    kids.forEach((c, j) => { weights[c.id] = Math.round((j === at ? next * total : (ws[j] * (1 - next)) / (1 - share)) * 1000) / 1000; });
    for (const [id, weight] of Object.entries(weights)) run("layout.resize", { id, weight });
    lastSplit = { parent: parent.id, weights, at: Date.now() };
    return true;
  }
  return false;
}

// The width a block has in the ks layout file (its default), or null.
async function defaultPx(id) {
  const r = await exec("cat", [`${appHome()}/layouts/ks.json`]).catch(() => null);
  try { return findNode(JSON.parse(r.stdout), id)?.size?.px ?? null; } catch { return null; }
}

// resize id=size: smaller / larger as a whole; reset=true back to the default (and centered, for zen). In zen it's the
// zen window; otherwise the pane you're in when the tab is split (= evens the split), else the side panel when it
// shows, else the sidebar.
// "resize focus=size|wide|tall by=±1" and "resize focus=size reset=true": the - + < > v ^ = keys. They act on what
// you're in: the zen window when it's open; else the pane you're in, along its nearest split (wide: a side-by-side
// split, tall: a stacked one, size: either); else, for a lone pane, the pane grows by shrinking the side panel (or the
// sidebar when the panel is hidden). = puts it back: zen to its default size, centered; a split even; the panel to
// the layout's width. Returns what to show in the strip.
async function resizeFocused(kind, dir, reset, pane, win = null) {
  // A floating window you were in (review, PR): it resizes itself (see shared/windows.js in the repo).
  if (win?.key) {
    setShared("ks.windowResize", { key: win.key, kind, dir, reset: Boolean(reset), n: Date.now() });
    run(`${win.mod}.winresize`);
    return reset ? "Window: default size" : `Window ${{ size: dir > 0 ? "larger" : "smaller", wide: dir > 0 ? "wider" : "narrower", tall: dir > 0 ? "taller" : "shorter" }[kind]}`;
  }
  if (shared("ks-zen.state")?.win) {
    if (reset) return run("ks-zen.reset"), "Zen: default size, centered";
    const cmd = { size: dir > 0 ? "grow" : "shrink", wide: dir > 0 ? "wider" : "narrower", tall: dir > 0 ? "taller" : "shorter" }[kind];
    return run(`ks-zen.${cmd}`), `Zen ${cmd}`;
  }
  const axis = kind === "wide" ? "row" : kind === "tall" ? "column" : null;
  if (await resizePane(pane, dir * 0.04, axis, reset)) return reset ? "Split evened out" : `Pane ${dir > 0 ? "larger" : "smaller"}`;
  if (kind === "tall") return "No split above or below to resize";
  const root = layout(), panel = findNode(root, "panel"), id = panel && !panel.hidden ? "panel" : "sidebar";
  if (reset) { const px = await defaultPx(id); if (px) run("layout.resize", { id, px }); return `${id === "panel" ? "Panel" : "Sidebar"}: default width`; }
  resize(id, -dir * 32);
  return `Pane ${dir > 0 ? "wider" : "narrower"} (${id} ${dir > 0 ? "narrower" : "wider"})`;
}

async function resize(id, by, pane = null) {
  const root = layout(), zen = shared("ks-zen.state")?.win;
  if (id === "auto") {
    if (zen) return run(by > 0 ? "ks-zen.taller" : "ks-zen.shorter");
    if (await resizePane(pane, by > 0 ? 0.05 : -0.05, "column")) return;
    id = "my-prs";
  } else if (id === "wide") {
    if (zen) return run(by > 0 ? "ks-zen.wider" : "ks-zen.narrower");
    if (await resizePane(pane, by > 0 ? 0.05 : -0.05, "row")) return;
    const panel = findNode(root, "panel");
    id = panel && !panel.hidden ? "panel" : "sidebar";
  }
  const n = findNode(root, id);
  if (!n || n.hidden || n.size?.px == null) return;
  run("layout.resize", { id, px: Math.round(Math.max(n.min ?? 40, Math.min(n.max ?? 1400, n.size.px + by))) });
}

// Commands that act on a pane or a terminal: while the strip holds the keyboard no pane has it, so they get the
// pane you were in (followed as you move) explicitly.
const PANE_ARG = new Set(["pane.zoom", "pane.split", "pane.swap", "pane.close"]);
const TERMINAL_ARG = new Set(["terminal.scroll"]);

// The strip is sized for the largest mode (modes switch inside it, it isn't reopened) and draws its own panel at
// the bottom of a frameless popup, so a short mode is a short panel.
function stripHeight(c, room) {
  const rows = Math.max(...Object.values(c.modes).filter((m) => !m.off).map((m) =>
    Math.ceil(shownBindings(m).filter((b) => !b.do.startsWith("mode:") || km.usable(c, b.do.slice(5).trim())).length / COLS)));
  return Math.min(room, PAD * 2 + 26 + 8 + rows * ROW + 8 + 18 + 6);
}

// `keep` reopens the strip on top again (in zen, the zen window can come over it): the same pane and message.
async function openMode(id, keep = null) {
  const c = km.config(), m = c.modes[id];
  if (!m || m.off) return;
  // The pane you're in, before the strip takes the keyboard.
  const f = keep ?? focused();
  // A floating window that had the keyboard (review, PR): the resize keys go to it (shared "ks.activeWindow").
  const floating = keep ? keep.window ?? null : shared("ks.activeWindow") ?? null;
  // Reopening (keep) replaces the strip by its key: closing it first would hand the keyboard away.
  if (!keep && shared(OPEN)) closeOverlay(shared(OPEN));
  const zoom = settings().zoom || 1, win = await windowSize();
  const room = win ? Math.floor(win.h / zoom) - 90 : 700;
  const height = stripHeight(c, room);
  const at = win ? { x: Math.round(win.w / 2 - (W * zoom) / 2), y: Math.max(0, Math.round(win.h - height * zoom - 40)) } : undefined;
  // A window, not a popup: Herdr closes popups on Esc itself, and that Esc could then reach the terminal behind
  // (Claude takes it as "interrupt" and redraws). A window leaves every key to this mod.
  setShared(OPEN, openOverlay({ mod: "ks-keys", kind: "window", key: "ks-keys-mode", frame: "none", width: W, height, ...(at ? { at } : {}),
    props: { mode: id, pane: f?.pane ?? null, terminal: f?.terminal ?? null, window: floating, flash: keep?.flash ?? null, shown: Boolean(keep) } }));
}
// The open strip's mode and pane, for ks-zen's "raise" (shared "ks-keys.live").
const LIVE = "ks-keys.live";
const PANEL = "ks.panelFocus"; // the side panel pane.go moved to while the strip was open (shared/panelkeys.js)
// Zen is open (its terminal, or for a review in zen, its pane): pane commands don't act on the tab behind it.
const zenTerminal = () => { const z = shared("ks-zen.state"); return z?.win ? z.terminal ?? z.pane ?? "zen" : null; };

const openEditor = () => openOverlay({ mod: "ks-keys", kind: "dialog", width: 860, height: 640, props: { editor: true } });

export default class Keys extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.mode) return this.initMode(p, cx);
    if (p.editor) return this.initEditor(cx);
    // The floating copy: keeps keys.json holding the entry keys (it only writes when they're missing or changed,
    // so a reinstall that drops them gets them back within seconds).
    let busy = false;
    const sync = async () => {
      if (busy) return;
      busy = true;
      try { await km.syncKeys(); } catch (e) { console.log("ks-keys: keys.json sync failed", String(e)); }
      busy = false;
    };
    cx.spawn(async () => sync());
    cx.timer.every(3000, () => { sync(); });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("enter:")) openMode(command.slice(6));
        // ks-zen reopened its window over the strip: the strip comes back on top, same mode and pane.
        else if (command === "raise") { const live = shared(LIVE); if (shared(OPEN) && live?.mode) openMode(live.mode, live); }
        else if (command === "editor") openEditor();
        // The strip closed after a move: the keyboard goes where Herdr's focus is (a pane), or to the side panel
        // you moved to.
        else if (command === "refocus" || command.startsWith("refocus:")) {
          const panel = command.startsWith("refocus:") ? command.slice(8) : null;
          cx.timer.after(80, () => {
            if (shared(OPEN) || zenTerminal()) return;
            if (panel) { run(`${panel}.focus`); return; }
            const f = focused();
            if (f?.pane) run("pane.focus", { pane: f.pane });
          });
        }
        // How long the strip waits before it shows (ms), from the settings panel.
        else if (command.startsWith("delay:")) { const c = km.config(); c.delay = Math.max(0, Number(command.slice(6)) || 0); km.save(c); }
        // "Vim keys" on or off (the settings panel's switch): ctrl-w window commands, ctrl-\\ vim normal mode.
        else if (command === "vim:on" || command === "vim:off") {
          const on = command === "vim:on";
          km.save(km.setVimKeys(km.config(), on));
          sync();
          notify({ title: on ? "Vim keys on" : "Vim keys off", body: on ? "ctrl-w then h j k l s v o c + - < > = (ctrl-w twice: delete a word). ctrl-\\: vim normal mode, i or esc to leave." : "ctrl-w and ctrl-\\ go to the terminal again.", level: "info", timeout: 5000 });
        }
        cx.notify();
      }
    });
  }

  render(cx) {
    const p = props() ?? {};
    if (p.mode) return this.renderMode(cx);
    if (p.editor) return this.renderEditor(cx);
    return div();
  }

  // --- the mode popup ---

  initMode(p, cx) {
    this.mode = p.mode;
    this.pane = p.pane ?? null;         // the pane you were in (pane commands get it explicitly)
    this.terminal = p.terminal ?? null;
    this.window = p.window ?? null; // { key, mod }: a floating window the resize keys act on
    this.flash = p.flash ?? null;
    this.seq = [];    // the keys of a sequence typed so far ("g" of "g t")
    this.count = "";  // digits typed before a key (counts modes)
    this.leaving = false;
    this.openedAt = Date.now(); // a panel reached after this gets the keyboard when the strip closes
    // Which-key style: the strip catches keys at once but shows only once you pause for the delay (shared config,
    // default 1 s); every key typed meanwhile starts the wait again, so a combo never shows it. A message shows it.
    this.shown = Boolean(p.flash) || Boolean(p.shown) || (km.config().delay ?? 1000) <= 0;
    this.showGen = 0;
    this.deferShow(cx);
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(200, () => this.handle.focus());
    this.publish();
  }

  deferShow(cx) {
    if (this.shown) return;
    const gen = ++this.showGen, delay = km.config().delay ?? 1000;
    cx.timer.after(delay, () => { if (!this.leaving && gen === this.showGen) { this.shown = true; cx.notify(); } });
  }

  publish() { setShared(LIVE, { mode: this.mode, pane: this.pane, terminal: this.terminal, window: this.window, flash: this.flash }); }

  async close() {
    const p = props() ?? {};
    if (p.mode && shared(OPEN) === p.overlay) { setShared(OPEN, null); setShared(LIVE, null); }
  }

  // Closes the strip; the keyboard goes back to what had it (`refocus` is kept for callers, unused now).
  leave(refocus = true) {
    this.leaving = true;
    closeOverlay(props().overlay);
    // You moved onto a side panel while the strip had the keyboard: the panel gets it now.
    const mark = shared(PANEL), panel = mark?.at >= (this.openedAt ?? Infinity) ? mark.mod : null;
    if (shared(OPEN) === props().overlay) setShared(OPEN, null);
    // Closing the window gives the keyboard back to what had it before: after a move that's the old pane while
    // Herdr's focus is on the new one, and neither shows the focus border. The floating copy (this window is gone
    // by then) puts the keyboard where Herdr's focus is, a moment later. Not in zen (pane.focus would switch to
    // the terminal's tab instead of zen), nor after a key that opened something to type into.
    if (panel) run(`ks-keys.refocus:${panel}`);
    else if (refocus && this.moved && !zenTerminal()) run("ks-keys.refocus");
  }

  // Leaving on a key: the strip keeps the keyboard until that key is released, so neither it (Esc, i, q) nor its
  // release reaches the terminal behind. A fallback closes it anyway if the release is missed.
  // Claude Code asks terminals for key releases (Kitty keyboard protocol), and a released Esc reads like an Esc: so
  // the strip closes only after the release was handled here, a moment later, never while the key is down.
  leaveOnRelease(cx, refocus = true) {
    if (this.leaving) return;
    this.leaving = true; this.releaseWanted = true; this.refocus = refocus;
    cx.timer.after(1500, () => { if (this.releaseWanted) { this.releaseWanted = false; this.leave(this.refocus); } });
  }
  keyUp(cx) {
    if (!this.releaseWanted) return;
    this.releaseWanted = false;
    cx.timer.after(60, () => this.leave(this.refocus));
  }

  // Runs a binding: its `count` action when a count was typed (# = the count), else `do`, repeated count times.
  act(b, cx, count = null) {
    const m = km.config().modes[this.mode];
    const a = km.parse(count && b.count ? b.count : b.do, count);
    if (a.leave) return this.leaveOnRelease(cx);
    // Another mode: reopened at that mode's size.
    // Another mode: switched here, in the same strip (reopening it lost the keyboard).
    if (a.mode) {
      if (km.usable(km.config(), a.mode)) { this.mode = a.mode; this.seq = []; this.count = ""; this.flash = null; this.publish(); }
      else { this.flash = `${a.mode} mode is off`; this.shown = true; }
      cx.notify();
      return;
    }
    // The pane you're in now: Herdr's focus when it says (it moves with pane.go), else the one you entered from.
    const f = focused();
    if (f?.pane) { this.pane = f.pane; this.terminal = f.terminal ?? this.terminal; }
    if (PANE_ARG.has(a.command) && this.pane && a.args.pane === undefined) a.args.pane = this.pane;
    if (TERMINAL_ARG.has(a.command) && this.terminal && a.args.terminal === undefined) a.args.terminal = this.terminal;
    // In zen there's one terminal, in a window: pane commands would act on the tab under it (and move the keyboard
    // to the same terminal there, at another size). They do nothing here.
    if (zenTerminal() && (PANE_ARG.has(a.command) || a.command === "pane.go")) {
      this.flash = "Not in zen (one pane)"; this.shown = true; cx.notify(); return;
    }
    // A one-shot mode closes before running; a sticky one before a command that opens something to type into
    // (rename, palette, a confirm), so that gets the keyboard.
    if (a.command && !/^resize\b/.test(a.command)) this.moved = true;
    const exits = !m.sticky || b.exit || km.EXITS.has(a.command);
    if (exits) this.leaveOnRelease(cx, !(b.exit || km.EXITS.has(a.command)));
    const times = count && !b.count && !String(b.do).includes("#") ? Math.min(count, 50) : 1;
    for (let n = 0; n < times; n++) {
      if (a.send) {
        const t = focused()?.terminal;
        if (t) hc(["keys", t, ...a.send]);
      } else if (a.command === "ks-keys.editor") { openEditor(); return; }
      else if (a.command === "resize" && a.args.focus) {
        resizeFocused(a.args.focus, Math.sign(a.args.by ?? 1) || 1, Boolean(a.args.reset), this.pane, this.window)
          .then((msg) => { if (msg && !this.leaving) { this.flash = msg; this.shown = true; cx.notify(); } }).catch(() => {});
      }
      else if (a.command === "resize") resize(a.args.id ?? "auto", a.args.by ?? 24, this.pane);
      // ks-zen zooms: a pane in a split as Herdr does, a pane alone in its tab (a review) over the whole window.
      else if (a.command === "pane.zoom") run(`ks-zen.zoom:${a.args.pane ?? ""}`);
      else if (a.command === "pane.go") { setShared(PANEL, null); run("pane.go", a.args); const g = focused(); if (g?.pane) { this.pane = g.pane; this.terminal = g.terminal ?? null; } }
      else if (a.command === "tab.shift") {
        const sp = spaces().find((s) => s.active), i = sp?.tabs.findIndex((t) => t.active) ?? -1;
        if (i >= 0) run("tab.move", { id: sp.tabs[i].id, index: Math.max(1, Math.min(sp.tabs.length, i + 1 + (a.args.by ?? 1))) });
      } else if (a.command) run(a.command, a.args);
    }
    if (!exits) {
      this.flash = `${count ? count + "× " : ""}${b.label}`; cx.notify();
      // Commands like pane.go or zen's resize move the keyboard: a sticky mode takes it back, so it stays on until Esc.
      cx.timer.after(150, () => { if (!this.leaving) this.handle.focus(); });
      cx.timer.after(500, () => { if (!this.leaving) this.handle.focus(); });
    }
  }

  key(e, cx) {
    this.deferShow(cx);
    if (this.leaving) return; // on the way out: nothing more goes anywhere
    const m = km.config().modes[this.mode];
    if (!m) return this.leaveOnRelease(cx);
    if (km.isModifier(e)) return;
    if (e.keystroke === "escape") {
      // Esc first drops a half-typed sequence or count, then leaves.
      if (this.seq.length || this.count) { this.seq = []; this.count = ""; this.flash = null; cx.notify(); return; }
      return this.leaveOnRelease(cx);
    }
    // The mode's own entry key again: on to the terminal (pressed twice sends it).
    if (m.entry && e.keystroke === m.entry) {
      this.leaveOnRelease(cx);
      const t = focused()?.terminal;
      if (t) hc(["keys", t, km.hcKey(m.entry)]);
      return;
    }
    const tok = km.token(e);
    // A digit starts a count, unless the mode has a key for it (service: 1-9 pick a tab, 0 the default size).
    const digitBound = m.bindings.some((b) => km.tokens(b.key)[0] === tok);
    if (m.counts && !this.seq.length && /^[0-9]$/.test(tok) && !digitBound && (this.count || tok !== "0")) {
      this.count += tok; this.flash = this.count; cx.notify(); return;
    }
    const seq = [...this.seq, tok];
    const starts = m.bindings.filter((b) => { const k = km.tokens(b.key); return k.length >= seq.length && seq.every((x, i) => k[i] === x); });
    const exact = starts.find((b) => km.tokens(b.key).length === seq.length);
    const longer = starts.some((b) => km.tokens(b.key).length > seq.length);
    const run = (b, cx) => { const count = this.count ? Number(this.count) : null; this.seq = []; this.count = ""; this.act(b, cx, count); };
    if (exact && !longer) return run(exact, cx);
    if (starts.length) {
      this.seq = seq; this.flash = `${this.count}${seq.join(" ")}…`; cx.notify();
      // Both a key and the start of a longer one: the key alone, if nothing follows soon.
      if (exact) { const at = seq.join(" "); cx.timer.after(700, (cx) => { if (this.seq.join(" ") === at) run(exact, cx); }); }
      return;
    }
    this.seq = []; this.count = "";
    if (!m.sticky) return this.leaveOnRelease(cx);
    this.flash = `No key ${seq.join(" ")} here`;
    cx.notify();
  }

  renderMode(cx) {
    const t = theme(), m = km.config().modes[this.mode];
    if (!m) return div();
    const cfg = km.config();
    const list = shownBindings(m).filter((b) => !b.do.startsWith("mode:") || km.usable(cfg, b.do.slice(5).trim()));
    const cell = (b, i) => h_flex().id(`b-${i}`).w(CELL).h(ROW).flex_none().gap(8).items_center().px(6).rounded(5).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.act(b, cx))
      .child(div().min_w(34).h(18).px(5).flex().items_center().justify_center().rounded(4).bg(t.accent + "26").text_color(t.accent).text_size(11.5).font_semibold().child(keyLabel(b.key)))
      .child(div().flex_1().truncate().text_size(11.5).text_color(b.do.startsWith("mode:") ? t.accent : t.foreground).child(b.label));
    return v_flex().id("mode-wrap").track_focus(this.handle).size_full().justify_end()
      .on_key_down((e, cx) => { cx.stop_propagation(); this.key(e, cx); })
      .on_key_up((_e, cx) => { cx.stop_propagation(); this.keyUp(cx); })
      // A press on the strip's background would drag the window: it stays put.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(this.shown, (el) => el.child(this.panel(t, m, list, cell)));
  }

  // What - + < > v ^ = act on right now, in words, for the strip's header (modes that have those keys).
  resizeTarget() {
    if (this.window?.key) return `the ${this.window.mod === "ks-prcard" ? "PR" : "review"} window`;
    if (shared("ks-zen.state")?.win) return "the zen window";
    const me = panes().find((p) => p.pane === this.pane);
    if (me && panes().filter((p) => p.tab === me.tab).length > 1) return "this pane, in its split";
    const panel = findNode(layout(), "panel");
    return `this pane, against the ${panel && !panel.hidden ? "side panel" : "sidebar"}`;
  }

  panel(t, m, list, cell) {
    const resizes = m.bindings.some((b) => /^resize focus=/.test(b.do));
    return v_flex().id("mode").w_full().max_h_full().p(PAD).gap(8).bg(t.popover).rounded(10).border_1().border_color(t.border).shadow_lg()
      .child(h_flex().gap(8).items_center()
        .child(div().px(7).h(20).flex().items_center().rounded(5).bg(t.accent).text_color(t.solid_foreground ?? t.background).text_size(11).font_semibold().child(m.name.toUpperCase()))
        .child(div().text_size(11.5).text_color(t.muted).child(m.sticky ? `sticky: keys repeat until esc${m.counts ? " · counts: 3j, 2gt" : ""}` : "one key"))
        .when(resizes, (el) => el.child(div().px(6).h(20).flex().items_center().rounded(5).bg(t.hover).text_size(11).text_color(t.foreground)
          .child(`- = narrower / wider · shift: _ + shorter / taller · 0 default · ${this.resizeTarget()}`)))
        .child(div().flex_1())
        .when(Boolean(this.flash), (el) => el.child(div().text_size(11.5).text_color(t.accent).child(this.flash))))
      .child(div().id("keys").flex_1().min_h(0).overflow_y_scroll()
        .child(div().w(COLS * CELL + (COLS - 1) * GAP).flex().flex_wrap().gap_x(GAP).children(list.map(cell))))
      .child(div().text_size(10.5).text_color(t.dim).child(`esc leave${m.entry ? ` · ${keyLabel(m.entry)} again: send it to the terminal` : ""} · ? or ${keyLabel(km.config().editor || "cmd-k")}: edit`));
  }

  // --- the editor ---

  initEditor(cx) {
    this.cfg = JSON.parse(JSON.stringify(km.config()));
    this.sel = Object.keys(this.cfg.modes)[0];
    this.row = null; // the binding being edited (index), or "new"
    this.inputs = null;
    this.dirty = false;
    this.modeInputs();
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // Shows another mode (`keep`: false drops the shown one's typed name and entry, when it was deleted or reset).
  pick(id, keep = true) {
    if (keep) this.applyMode();
    this.sel = id; this.row = null; this.inputs = null;
    this.modeInputs();
  }

  input(value, placeholder) {
    const s = InputState.new({ value: value ?? "", placeholder });
    s.on("change", (_e, cx) => cx.notify());
    return s;
  }

  modeInputs() {
    const m = this.cfg.modes[this.sel];
    this.mi = { name: this.input(m.name, "name"), entry: this.input(m.entry, "none: entered from another mode") };
  }

  editRow(i) {
    const b = i === "new" ? { key: "", label: "", do: "", count: "" } : this.cfg.modes[this.sel].bindings[i];
    this.row = i;
    this.inputs = { key: this.input(b.key, "a character, a chord (ctrl-d, left) or a sequence (g t)"), label: this.input(b.label, "what it does"), do: this.input(b.do, "pane.split direction=right · mode:move · leave · send:ctrl+c"), count: this.input(b.count ?? "", "with a count (optional): tab.select index=#") };
    this.inputs.key.focus();
  }

  applyRow() {
    const b = { key: km.tokens(this.inputs.key.value()).join(" "), label: this.inputs.label.value().trim(), do: this.inputs.do.value().trim() };
    const count = this.inputs.count.value().trim();
    if (count) b.count = count;
    if (!b.key || !b.do) return;
    const list = this.cfg.modes[this.sel].bindings;
    if (this.row === "new") list.push({ ...b, label: b.label || b.do }); else list[this.row] = { ...b, label: b.label || b.do };
    this.row = null; this.inputs = null; this.dirty = true;
  }

  applyMode() {
    const m = this.cfg.modes[this.sel];
    if (!this.mi || !m) return;
    m.name = this.mi.name.value().trim() || m.name;
    m.entry = this.mi.entry.value().trim();
  }

  saveAll() {
    this.applyMode();
    if (this.inputs) this.applyRow();
    // One entry key per mode at most, and none twice.
    const seen = new Set();
    for (const m of Object.values(this.cfg.modes)) { if (m.entry && seen.has(m.entry)) m.entry = ""; if (m.entry) seen.add(m.entry); }
    km.save(this.cfg);
    this.dirty = false;
    notify({ title: "Key modes saved", body: "Entry keys are written to keys.json.", level: "info", timeout: 3000 });
  }

  renderEditor(cx) {
    const t = theme(), cfg = this.cfg, m = cfg.modes[this.sel];
    const btn = (id, text, primary, act) => h_flex().id(id).h(28).px(12).items_center().rounded(7).border_1()
      .border_color(primary ? t.solid ?? t.accent : t.input).bg(primary ? t.solid ?? t.accent : t.raised)
      .text_color(primary ? t.solid_foreground ?? t.background : t.foreground).text_size(12).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click((_e, cx) => { act(); cx.notify(); }).child(text);
    const field = (state, w) => Input.new(state).w(w).h(30).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12);
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);
    const modesList = v_flex().w(190).gap(2).pr(10).border_r(1).border_color(t.border)
      .child(h_flex().id("vimkeys").h(30).px(8).mb(8).gap(6).items_center().rounded(7).border_1()
        .border_color(km.vimKeys(cfg) ? t.accent : t.input).text_size(12).text_color(km.vimKeys(cfg) ? t.accent : t.muted).cursor_pointer()
        .tooltip("ctrl-w window commands anywhere (h j k l, s v, o, c, + - < > =), ctrl-\\ into vim's normal mode")
        .on_click((_e, cx) => { this.applyMode(); km.setVimKeys(cfg, !km.vimKeys(cfg)); this.pick(this.sel, false); this.dirty = true; cx.notify(); })
        .child(km.vimKeys(cfg) ? "■ Vim keys" : "□ Vim keys"))
      .child(div().pb(6).text_size(11).text_color(t.dim).child("Modes"))
      .children(Object.entries(cfg.modes).map(([id, x]) => h_flex().id(`m-${id}`).h(30).px(8).gap(6).items_center().rounded(6)
        .bg(id === this.sel ? t.selected : t.popover).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.pick(id); cx.notify(); })
        .child(div().flex_1().truncate().text_size(12.5).child(x.name))
        .child(div().text_size(10.5).text_color(x.off ? t.dim : x.entry ? t.accent : t.dim).child(x.off ? "off" : x.entry ? keyLabel(x.entry) : x.sticky ? "sticky" : "—"))))
      .child(div().h(8))
      .child(btn("m-add", "+ New mode", false, () => {
        let n = 1; while (cfg.modes[`mode${n}`]) n++;
        this.applyMode(); cfg.modes[`mode${n}`] = { name: `mode ${n}`, entry: "", sticky: true, counts: false, bindings: [{ key: "q", label: "Done", do: "leave" }] }; this.pick(`mode${n}`, false); this.dirty = true;
      }))
      .child(div().h(14))
      .child(label("Open this editor"))
      .child(div().text_size(12).child(keyLabel(cfg.editor || "—")))
      .child(div().h(8))
      .child(label("Key sections"))
      .child(div().text_size(10.5).text_color(t.muted).child((cfg.sections ?? []).join(", ")));
    const rows = m.bindings.map((b, i) => h_flex().id(`r-${i}`).h(26).px(6).gap(10).items_center().rounded(5)
      .bg(this.row === i ? t.selected : t.popover).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.editRow(i); cx.notify(); })
      .child(div().w(56).text_size(11.5).font_semibold().text_color(t.accent).child(keyLabel(b.key)))
      .child(div().w(190).truncate().text_size(11.5).child(b.label))
      .child(div().flex_1().truncate().text_size(11).text_color(t.muted).font_family("JetBrains Mono").child(b.do))
      .child(div().id(`rx-${i}`).px(5).text_size(11).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); m.bindings.splice(i, 1); if (this.row === i) { this.row = null; this.inputs = null; } this.dirty = true; cx.notify(); }).child("✕")));
    const editing = this.inputs && v_flex().gap(6).p(10).rounded(8).border_1().border_color(t.accent).bg(t.raised)
      .child(h_flex().gap(8)
        .child(v_flex().gap(3).child(label("Key")).child(field(this.inputs.key, 120)))
        .child(v_flex().gap(3).child(label("Label")).child(field(this.inputs.label, 200)))
        .child(v_flex().flex_1().gap(3).child(label("Does")).child(field(this.inputs.do, 300))))
      .child(h_flex().gap(8).child(v_flex().flex_1().gap(3).child(label("With a count (# is the count; empty: repeat the key)")).child(field(this.inputs.count, 400))))
      .child(h_flex().gap(8).justify_end()
        .child(btn("e-cancel", "Cancel", false, () => { this.row = null; this.inputs = null; }))
        .child(btn("e-ok", this.row === "new" ? "Add key" : "Apply", true, () => this.applyRow())));
    const detail = v_flex().flex_1().min_w(0).pl(12).gap(8)
      .child(h_flex().gap(10).items_end()
        .child(v_flex().gap(3).child(label("Name")).child(field(this.mi.name, 140)))
        .child(v_flex().gap(3).child(label("Entry key (keys.json spelling)")).child(field(this.mi.entry, 230)))
        .child(h_flex().id("sticky").h(30).px(10).gap(6).items_center().rounded(7).border_1().border_color(m.sticky ? t.accent : t.input)
          .text_size(12).text_color(m.sticky ? t.accent : t.muted).cursor_pointer()
          .on_click((_e, cx) => { m.sticky = !m.sticky; this.dirty = true; cx.notify(); })
          .child(m.sticky ? "■ Sticky" : "□ Sticky"))
        .child(h_flex().id("off").h(30).px(10).gap(6).items_center().rounded(7).border_1().border_color(m.off ? t.input : t.accent)
          .text_size(12).text_color(m.off ? t.muted : t.accent).cursor_pointer()
          .on_click((_e, cx) => { m.off = !m.off; this.dirty = true; cx.notify(); })
          .child(m.off ? "□ On" : "■ On"))
        .child(h_flex().id("counts").h(30).px(10).gap(6).items_center().rounded(7).border_1().border_color(m.counts ? t.accent : t.input)
          .text_size(12).text_color(m.counts ? t.accent : t.muted).cursor_pointer()
          .on_click((_e, cx) => { m.counts = !m.counts; this.dirty = true; cx.notify(); })
          .child(m.counts ? "■ Counts" : "□ Counts"))
        .child(div().flex_1())
        .child(btn("m-del", "Delete mode", false, () => { if (Object.keys(cfg.modes).length > 1) { delete cfg.modes[this.sel]; this.pick(Object.keys(cfg.modes)[0], false); this.dirty = true; } })))
      .child(div().text_size(10.5).text_color(t.dim).child("On: off removes the mode, its entry key and every key that leads to it. Entry key: e.g. ctrl-;, ctrl-a, ctrl-space. Empty: reached only from another mode (mode:<id>). Sticky: keys repeat until esc. Counts: digits first repeat a key (3j) or fill its count action (3gt). A key can be a sequence: g t."))
      .child(h_flex().gap(10).px(6).pt(4).child(div().w(56).text_size(10.5).text_color(t.dim).child("Key")).child(div().w(190).text_size(10.5).text_color(t.dim).child("Label")).child(div().flex_1().text_size(10.5).text_color(t.dim).child("Does")))
      .child(v_flex().id("rows").flex_1().min_h(0).overflow_y_scroll().children(rows))
      .when(Boolean(editing), (el) => el.child(editing))
      .when(!editing, (el) => el.child(h_flex().child(btn("r-add", "+ Add key", false, () => this.editRow("new")))));
    return v_flex().id("editor").track_focus(this.handle).size_full().min_h(0).p(16).gap(12).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.keystroke === "escape" && !this.inputs) { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().gap(10)
        .child(div().text_size(15).font_semibold().child("Key modes"))
        .child(div().text_size(11.5).text_color(t.dim).child(this.dirty ? "unsaved changes" : ""))
        .child(div().flex_1())
        .child(btn("reset", "Reset to defaults", false, () => { this.cfg = JSON.parse(JSON.stringify(km.DEFAULTS)); this.pick(Object.keys(this.cfg.modes)[0], false); this.dirty = true; }))
        .child(btn("close", "Close", false, () => closeOverlay(props().overlay)))
        .child(btn("save", "Save", true, () => this.saveAll())))
      .child(h_flex().flex_1().min_h(0).items_start().child(modesList).child(detail));
  }
}
