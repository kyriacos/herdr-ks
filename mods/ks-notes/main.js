// Notes: a scratchpad in the side panel (cmd-shift-j, the tab bar's Notes). Every note belongs to the space it was
// written in, kept by that space's id, name and folder, so notes outlive their space: close a space and its notes are
// still here, under All, marked closed; open a space in the same folder again and they show as its own.
// "This space" shows the shown space's notes, "All" every note: grouped by space (a switch), or narrowed to one space
// with the space chips. The search box matches a note's text and its space's name, in either view. Every note shows
// which space it's in.
//
// Stored in <app home>/data/ks-notes.json ({ notes: [{ id, text, space, spaceName, folder, created, updated }] }),
// written a moment after you stop typing, and read again when another copy of this mod changed it.
// Vim keys (lib/panelkeys.js): j/k, gg/G, Enter/o edit, n new, x delete (u undoes), a this space / all, / search,
// g s grouping on / off, h/l/Esc leave.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, ScrollHandle, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { exec, appHome, spaces, theme, settings } from "herdr";
import { dimmed } from "./lib/focus.js";
import { takeFocus, listKey, watchFocus, focusedNow } from "./lib/panelkeys.js";

const FILE = () => `${appHome()}/data/ks-notes.json`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = new Date(ms);
  return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
};
const tilde = (p) => (p ? p.replace(/^\/Users\/[^/]+/, "~") : "");

async function readNotes() {
  const r = await exec("cat", [FILE()]).catch(() => null);
  if (!r || r.code !== 0 || !r.stdout.trim()) return { notes: [], stamp: "" };
  try { return { notes: JSON.parse(r.stdout).notes ?? [], stamp: r.stdout.length + ":" + r.stdout.slice(-64) }; } catch { return { notes: null, stamp: "" }; }
}
async function writeNotes(notes) {
  const body = JSON.stringify({ notes }, null, 1);
  await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1.tmp" && mv "$1.tmp" "$1"', "sh", FILE(), body]).catch(() => null);
  return body.length + ":" + body.slice(-64);
}

export default class Notes extends View {
  init(_props, cx) {
    this.notes = []; this.loaded = false; this.editing = null; this.all = load("all", false); this.undo = null;
    this.handle = cx.focus_handle(); this.scroll = ScrollHandle.new(); this.cursor = 0; this.pageRows = 8;
    this.editor = TextareaState.new({ placeholder: "Write anything. It's saved as you type.", rows: 6 });
    this.editor.set_auto_grow(4, 18);
    this.editor.on("change", (_e, cx) => this.typed(cx));
    // Search (both views), grouping by space and one space picked (All).
    this.grouped = load("grouped", true); this.only = null; this.searching = false;
    this.search = InputState.new({ placeholder: "Search notes  (/)" });
    this.search.on("change", (_e, cx) => { this.cursor = 0; cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    this.search.on("submit", (_e, cx) => { this.handle.focus(); cx.notify(); });
    takeFocus(this, cx, "ks-notes"); watchFocus(this, cx, "ks-notes", () => this.editing !== null || this.searching);
    this.reload(cx);
    // Another copy (another window's panel) may have written: read again when the file changed and nothing is unsaved.
    cx.timer.every(3000, (cx) => { if (!this.dirty) this.reload(cx, true); });
  }

  reload(cx, quiet = false) {
    cx.spawn(async (cx) => {
      const { notes, stamp } = await readNotes();
      if (notes === null) { this.error = "ks-notes.json couldn't be read; nothing is written until it's fixed"; cx.notify(); return; }
      if (quiet && stamp === this.stamp) return;
      this.stamp = stamp; this.notes = notes; this.loaded = true; this.error = null;
      cx.notify();
    });
  }

  persist(cx) {
    if (this.error) return;
    this.dirty = false;
    cx.spawn(async () => { this.stamp = await writeNotes(this.notes); });
  }
  // Saved a moment after the last key.
  typed(cx) {
    const n = this.notes.find((x) => x.id === this.editing);
    if (!n) return;
    n.text = this.editor.value(); n.updated = Date.now(); this.dirty = true;
    const gen = (this.gen = (this.gen ?? 0) + 1);
    cx.timer.after(700, (cx) => { if (gen === this.gen) this.persist(cx); });
    cx.notify();
  }

  space() { return spaces().find((s) => s.active) ?? null; }
  // A note is this space's when it was written in it, or in a space with the same folder that's gone now.
  mine(n, sp) { return Boolean(sp && (n.space === sp.id || (n.folder && n.folder === sp.folder && !spaces().some((s) => s.id === n.space)))); }
  shown() {
    const sp = this.space(), q = this.search.value().trim().toLowerCase();
    let list = this.all ? this.notes : this.notes.filter((n) => this.mine(n, sp));
    if (this.all && this.only) list = list.filter((n) => (n.space ?? "none") === this.only);
    // Every word must appear, in the text or the space's name.
    if (q) list = list.filter((n) => { const hay = `${n.text ?? ""}\n${this.spaceLabel(n)}`.toLowerCase(); return q.split(/\s+/).every((w) => hay.includes(w)); });
    return this.order([...list]);
  }
  // Newest first; grouped (All): by space, open spaces first, each group by its newest note. The list keys walk this order.
  order(list) {
    list.sort((a, b) => b.updated - a.updated);
    if (!this.all || !this.grouped) return list;
    const groups = new Map();
    for (const n of list) { const k = n.space ?? "none"; (groups.get(k) ?? groups.set(k, []).get(k)).push(n); }
    const open = (k) => spaces().some((s) => s.id === k);
    return [...groups].sort((a, b) => Number(open(b[0])) - Number(open(a[0])) || b[1][0].updated - a[1][0].updated).flatMap(([, ns]) => ns);
  }
  // The spaces that have notes, for the chips: open ones first. [{ key, label, open, count }].
  noteSpaces() {
    const m = new Map();
    for (const n of this.notes) {
      const k = n.space ?? "none", e = m.get(k) ?? { key: k, label: this.spaceLabel(n), open: spaces().some((s) => s.id === k), count: 0, at: 0 };
      e.count++; e.at = Math.max(e.at, n.updated); m.set(k, e);
    }
    return [...m.values()].sort((a, b) => Number(b.open) - Number(a.open) || b.at - a.at);
  }
  setGrouped(on, cx) { this.grouped = on; save("grouped", on); cx.notify(); }

  create(cx) {
    const sp = this.space(), now = Date.now();
    const n = { id: `n${now.toString(36)}${Math.round(Math.random() * 1e4)}`, text: "", space: sp?.id ?? null, spaceName: sp?.name ?? "No space", folder: sp?.folder ?? null, created: now, updated: now };
    this.notes.unshift(n); this.persist(cx);
    this.edit(n, cx);
  }
  edit(n, cx) {
    this.editing = n.id; this.editor.set_value(n.text ?? ""); this.editor.focus();
    this.cursor = Math.max(0, this.shown().findIndex((x) => x.id === n.id));
    cx.notify();
  }
  doneEditing(cx) {
    const n = this.notes.find((x) => x.id === this.editing);
    this.editing = null;
    // An empty note goes away when you leave it.
    if (n && !n.text.trim()) this.notes = this.notes.filter((x) => x !== n);
    this.persist(cx); this.handle.focus(); cx.notify();
  }
  remove(n, cx) {
    this.undo = { note: n, until: Date.now() + 8000 };
    this.notes = this.notes.filter((x) => x.id !== n.id);
    if (this.editing === n.id) this.editing = null;
    this.persist(cx); this.handle.focus(); cx.notify();
    cx.timer.after(8100, (cx) => cx.notify());
  }
  restore(cx) {
    if (!this.undo) return;
    this.notes.unshift(this.undo.note); this.undo = null; this.persist(cx); cx.notify();
  }
  setAll(on, cx) { this.all = on; save("all", on); this.cursor = 0; if (!on) this.only = null; cx.notify(); }

  // Live names: a note's space name follows a rename while the space is open.
  spaceLabel(n) {
    const live = spaces().find((s) => s.id === n.space);
    return live ? live.name : n.spaceName || "No space";
  }

  card(n, t, at) {
    const editing = this.editing === n.id, closed = n.space && !spaces().some((s) => s.id === n.space);
    const text = (n.text ?? "").trim(), first = text.split("\n")[0] || "Empty note", rest = text.split("\n").slice(1).join("\n").trim();
    const link = (id, label, act, tone) => div().id(id).px(6).py(1).rounded(4).cursor_pointer().text_size(11).text_color(tone)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(label);
    return v_flex().id(`note-${n.id}`).flex_none().mx(8).mt(8).p(10).gap(4).rounded(8).border_1()
      .border_color(editing || at ? t.accent : t.border).bg(t.background)
      .when(!editing, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.edit(n, cx)))
      .child(h_flex().gap(6).items_center().text_size(10.5).text_color(t.dim)
        // Which space it's in, always (grouped, the group header says it too).
        .child(div().flex_none().px(5).rounded(5).border_1().border_color(t.border).max_w(170).truncate()
          .text_color(closed ? t.dim : t.muted).child(`${this.spaceLabel(n)}${closed ? " · closed" : ""}`))
        .child(div().flex_1().min_w(0).truncate().child(ago(n.updated)))
        .child(link(`del-${n.id}`, "Delete", (cx) => this.remove(n, cx), t.dim)))
      .when(editing, (e) => e
        .child(div().rounded(6).border_1().border_color(t.border).bg(t.chrome).px(8).py(6)
          .child(Textarea.new(this.editor).w_full().text_size(12.5).text_color(t.foreground).font_family(settings().font_family ?? "JetBrains Mono")))
        .child(h_flex().gap(6).items_center().text_size(10.5).text_color(t.dim)
          .child(div().flex_1().child(this.dirty ? "Saving…" : "Saved"))
          .child(link(`done-${n.id}`, "Done", (cx) => this.doneEditing(cx), t.accent))))
      .when(!editing, (e) => e
        .child(div().text_size(12.5).font_semibold().text_color(text ? t.foreground : t.dim).child(first))
        .when(Boolean(rest), (e) => e.child(div().text_size(12).text_color(t.muted).max_h(96).overflow_hidden().child(rest))));
  }

  render(cx) { return dimmed(this, this.renderInner(cx)); }

  renderInner(cx) {
    const t = theme(), list = this.shown(), sp = this.space();
    const seg = (id, label, on, act) => div().id(id).h(22).px(8).flex().items_center().rounded(5).cursor_pointer().text_size(11)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    // Grouped (All): a header before each space's notes (shown() already put them in that order).
    const rows = [], focusedList = focusedNow(this, "ks-notes");
    let last;
    for (const n of list) {
      const k = n.space ?? "none";
      if (this.all && this.grouped && k !== last) {
        const open = spaces().some((s) => s.id === k);
        rows.push(h_flex().flex_none().mx(10).mt(12).gap(6).items_center().text_size(11)
          .child(div().font_semibold().text_color(open ? t.muted : t.dim).child(this.spaceLabel(n)))
          .when(!open, (e) => e.child(div().px(5).rounded(5).border_1().border_color(t.border).text_size(10).text_color(t.dim).child("closed")))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(n.folder))));
        last = k;
      }
      rows.push(this.card(n, t, focusedList && list[this.cursor] === n));
    }
    const chip = (id, label, on, act) => div().id(id).flex_none().h(22).px(8).flex().items_center().rounded(11).cursor_pointer().text_size(11)
      .bg(on ? t.selected : t.chrome).border_1().border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    const q = this.search.value().trim();
    const undoing = this.undo && Date.now() < this.undo.until;
    return v_flex().id("notes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(focusedNow(this, "ks-notes", () => this.editing !== null || this.searching) ? t.accent : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (this.editing !== null) { if (e.key === "escape") { this.doneEditing(cx); cx.stop_propagation(); } return; }
        if (this.searching) { // typing a search: Esc clears it (again: back to the list), Enter goes to the list
          if (e.key === "escape") { if (this.search.value()) this.search.set_value(""); else this.handle.focus(); cx.stop_propagation(); cx.notify(); }
          return;
        }
        if (e.key === "/" ) { this.search.focus(); cx.stop_propagation(); return; }
        if (e.key === "s" && this.__g) { this.__g = false; this.setGrouped(!this.grouped, cx); cx.stop_propagation(); return; }
        if (!listKey(this, e, list.length, (i) => this.edit(list[i], cx), (k) => {
          if (k === "n") { this.create(cx); return true; }
          if (k === "x" && list[this.cursor]) { this.remove(list[this.cursor], cx); return true; }
          if (k === "u") { this.restore(cx); return true; }
          if (k === "a") { this.setAll(!this.all, cx); return true; }
          return false;
        })) return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Notes"))
        .child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
          .child(seg("notes-here", "This space", !this.all, (cx) => this.setAll(false, cx)))
          .child(seg("notes-all", `All · ${this.notes.length}`, this.all, (cx) => this.setAll(true, cx))))
        .child(div().flex_1())
        .child(div().id("notes-new").h(24).px(9).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(11).cursor_pointer()
          .hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.create(cx)).child("+ New")))
      // Search, and (All) grouping and the space chips.
      .child(v_flex().flex_none().px(10).py(6).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().h(26).px(8).flex().items_center().rounded(6).border_1().border_color(this.searching ? t.accent : t.border).bg(t.chrome)
            .child(Input.new(this.search).h_full().text_size(11.5).text_color(t.foreground)))
          .when(Boolean(q), (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${list.length} found`)))
          .when(this.all, (e) => e.child(div().id("notes-group").flex_none().h(24).px(8).flex().items_center().rounded(6).cursor_pointer().text_size(11)
            .border_1().border_color(this.grouped ? t.accent : t.border).text_color(this.grouped ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.setGrouped(!this.grouped, cx)).child(this.grouped ? "Grouped ✓" : "Grouped"))))
        .when(!this.all, (e) => e.child(div().text_size(10.5).text_color(t.dim).truncate()
          .child(sp ? `${sp.name}${sp.folder ? ` · ${tilde(sp.folder)}` : ""}` : "No space open")))
        .when(this.all && this.noteSpaces().length > 1, (e) => e.child(h_flex().id("notes-spaces").gap(5).items_center().overflow_x_scroll()
          .child(chip("ns-all", "All spaces", !this.only, (cx) => { this.only = null; this.cursor = 0; cx.notify(); }))
          .children(this.noteSpaces().map((x) => chip(`ns-${x.key}`, `${x.label}${x.open ? "" : " · closed"} · ${x.count}`, this.only === x.key,
            (cx) => { this.only = this.only === x.key ? null : x.key; this.cursor = 0; cx.notify(); }))))))
      .when(Boolean(undoing), (e) => e.child(h_flex().flex_none().mx(8).mt(8).px(10).h(28).gap(8).items_center().rounded(7).bg(t.accent + "1f").text_size(11.5).text_color(t.accent)
        .child(div().flex_1().truncate().child("Note deleted"))
        .child(div().id("notes-undo").px(6).rounded(4).cursor_pointer().font_semibold().hover((s) => s.bg(t.accent + "3a")).on_click((_e, cx) => this.restore(cx)).child("Undo"))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("notes-list").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).pb(12)
          .when(Boolean(this.error), (e) => e.child(div().p(12).text_size(12).text_color(t.ansi1).child(this.error)))
          .when(this.loaded && !list.length, (e) => e.child(div().p(14).text_size(12).text_color(t.dim)
            .child(q ? `No note matches "${q}"` : this.all ? "No notes yet. + New writes one for the space you're in." : "No notes for this space yet. + New (or n) starts one; they stay after the space is closed, under All.")))
          .children(rows))
        .child(Scrollbar.vertical("notes-list").absolute().inset_0()));
  }
}
