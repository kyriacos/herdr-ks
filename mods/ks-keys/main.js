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
import { props, run, theme, openOverlay, closeOverlay, nextCommand, shared, setShared, spaces, focused, hc, exec, appHome, settings, notify, layout } from "herdr";
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

// `resize id=<node> by=<px>`: a layout block (sidebar, panel, my-prs) bigger or smaller. id=auto: in zen the tab's
// width, else the side panel when it shows, else the sidebar.
function resize(id, by) {
  const root = layout();
  if (id === "auto") {
    if (shared("ks-zen.state")?.win) return run(by > 0 ? "ks-zen.wider" : "ks-zen.narrower");
    const panel = findNode(root, "panel");
    id = panel && !panel.hidden ? "panel" : "sidebar";
  }
  const n = findNode(root, id);
  if (!n || n.hidden || n.size?.px == null) return;
  run("layout.resize", { id, px: Math.round(Math.max(n.min ?? 120, Math.min(n.max ?? 1400, n.size.px + by))) });
}

async function openMode(id) {
  const c = km.config(), m = c.modes[id];
  if (!m || m.off) return;
  if (shared(OPEN)) closeOverlay(shared(OPEN));
  const shown = shownBindings(m).filter((b) => !b.do.startsWith("mode:") || km.usable(c, b.do.slice(5).trim())).length;
  const zoom = settings().zoom || 1, win = await windowSize();
  // Header, the rows of keys, the footer line, padding; at most what the window has room for.
  const room = win ? Math.floor(win.h / zoom) - 90 : 700;
  const height = Math.min(room, PAD * 2 + 26 + 8 + Math.ceil(shown / COLS) * ROW + 8 + 18 + 6);
  const at = win ? { x: Math.round(win.w / 2 - (W * zoom) / 2), y: Math.max(0, Math.round(win.h - height * zoom - 40)) } : undefined;
  setShared(OPEN, openOverlay({ mod: "ks-keys", kind: "popup", width: W, height, ...(at ? { at } : {}), props: { mode: id } }));
}

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
        else if (command === "editor") openEditor();
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
    this.flash = null;
    this.seq = [];    // the keys of a sequence typed so far ("g" of "g t")
    this.count = "";  // digits typed before a key (counts modes)
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(200, () => this.handle.focus());
  }

  async close() {
    const p = props() ?? {};
    if (p.mode && shared(OPEN) === p.overlay) setShared(OPEN, null);
  }

  leave() { closeOverlay(props().overlay); }

  // Runs a binding: its `count` action when a count was typed (# = the count), else `do`, repeated count times.
  act(b, cx, count = null) {
    const m = km.config().modes[this.mode];
    const a = km.parse(count && b.count ? b.count : b.do, count);
    if (a.leave) return this.leave();
    // Another mode: reopened at that mode's size.
    if (a.mode) {
      if (km.usable(km.config(), a.mode)) openMode(a.mode);
      else { this.flash = `${a.mode} mode is off`; cx.notify(); }
      return;
    }
    // A one-shot mode closes before running; a sticky one before a command that opens something to type into
    // (rename, palette, a confirm), so that gets the keyboard.
    const exits = !m.sticky || b.exit || km.EXITS.has(a.command);
    if (exits) this.leave();
    const times = count && !b.count && !String(b.do).includes("#") ? Math.min(count, 50) : 1;
    for (let n = 0; n < times; n++) {
      if (a.send) {
        const t = focused()?.terminal;
        if (t) hc(["keys", t, ...a.send]);
      } else if (a.command === "ks-keys.editor") { openEditor(); return; }
      else if (a.command === "resize") resize(a.args.id ?? "auto", a.args.by ?? 24);
      else if (a.command === "tab.shift") {
        const sp = spaces().find((s) => s.active), i = sp?.tabs.findIndex((t) => t.active) ?? -1;
        if (i >= 0) run("tab.move", { id: sp.tabs[i].id, index: Math.max(1, Math.min(sp.tabs.length, i + 1 + (a.args.by ?? 1))) });
      } else if (a.command) run(a.command, a.args);
    }
    if (!exits) { this.flash = `${count ? count + "× " : ""}${b.label}`; cx.notify(); }
  }

  key(e, cx) {
    const m = km.config().modes[this.mode];
    if (!m) return this.leave();
    if (km.isModifier(e)) return;
    if (e.keystroke === "escape") {
      // Esc first drops a half-typed sequence or count, then leaves.
      if (this.seq.length || this.count) { this.seq = []; this.count = ""; this.flash = null; cx.notify(); return; }
      return this.leave();
    }
    // The mode's own entry key again: on to the terminal (pressed twice sends it).
    if (m.entry && e.keystroke === m.entry) {
      this.leave();
      const t = focused()?.terminal;
      if (t) hc(["keys", t, km.hcKey(m.entry)]);
      return;
    }
    const tok = km.token(e);
    if (m.counts && !this.seq.length && /^[0-9]$/.test(tok) && (this.count || tok !== "0")) {
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
    if (!m.sticky) return this.leave();
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
    return v_flex().id("mode").track_focus(this.handle).size_full().p(PAD).gap(8).bg(t.popover)
      .on_key_down((e, cx) => { cx.stop_propagation(); this.key(e, cx); })
      .child(h_flex().gap(8).items_center()
        .child(div().px(7).h(20).flex().items_center().rounded(5).bg(t.accent).text_color(t.solid_foreground ?? t.background).text_size(11).font_semibold().child(m.name.toUpperCase()))
        .child(div().text_size(11.5).text_color(t.muted).child(m.sticky ? `sticky: keys repeat until esc${m.counts ? " · counts: 3j, 2gt" : ""}` : "one key"))
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
