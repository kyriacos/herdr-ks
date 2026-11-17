// Tasks: a kanban board and a Today list, in the side panel (cmd-shift-k, the tab bar's Tasks) and, larger, in a
// window of its own (⤢, or B in the panel). One mod, three faces, picked by its props:
//   - the panel (no props): Today / Board;
//   - the board window ({ board: true }): the same, full size;
//   - a task ({ task: id }): a dialog with its title, description, column, Today, attachments and comments.
//
// Board: columns you add, rename, reorder and delete; drag a card onto another column (or between two cards), or
// H / L (move to the column left / right), J / K (up / down in its column).
// Today: what you mean to do today, then the backlog (everything else not done). t (or the card's ☀) moves a task
// between the two; dragging works here too. A task in the board's last column counts as done and leaves both lists.
// Attachments (lib/attach.js): drop files from Finder onto a card (that task), onto a column or a list (a new task),
// or onto a task's dialog; the dialog also picks files and pastes a copied picture.
//
// Stored in <app home>/data/ks-tasks.json ({ columns: [{ id, name }], tasks: [{ id, title, body, column, today,
// order, space, spaceName, folder, created, updated, doneAt, comments: [{ id, text, at }], attachments: [...] }] }).
// Every change reads the file, applies itself and writes it back (so the panel, the window and a task's dialog never
// undo each other), then bumps shared "ks-tasks.rev" so the other copies read it again at once.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, ScrollHandle, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { exec, appHome, spaces, theme, settings, props, openOverlay, closeOverlay, shared, setShared, nextCommand } from "herdr";
import { trackActive, takeRequest, raiseStrip } from "./lib/windows.js";
import { dimmed } from "./lib/focus.js";
import { spaceName } from "./lib/spacenames.js";
import { takeFocus, watchFocus, focusedNow, leave } from "./lib/panelkeys.js";
import { addPaths, pickAndAdd, pasteImage, attachRow, dropFiles } from "./lib/attach.js";

const FILE = () => `${appHome()}/data/ks-tasks.json`;
const REV = "ks-tasks.rev";
const BOARD = "ks-tasks-board"; // the board window's overlay key
const COLUMNS = [{ id: "backlog", name: "Backlog" }, { id: "todo", name: "To do" }, { id: "doing", name: "Doing" }, { id: "done", name: "Done" }];
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const uid = (p) => `${p}${Date.now().toString(36)}${Math.round(Math.random() * 1e5).toString(36)}`;
const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = new Date(ms);
  return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
};
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

async function readAll() {
  const r = await exec("cat", [FILE()]).catch(() => null);
  if (!r || r.code !== 0 || !r.stdout.trim()) return { columns: COLUMNS.map((c) => ({ ...c })), tasks: [] };
  try { const d = JSON.parse(r.stdout); return { columns: d.columns?.length ? d.columns : COLUMNS.map((c) => ({ ...c })), tasks: d.tasks ?? [] }; } catch { return null; }
}
async function writeAll(d) {
  const body = JSON.stringify({ columns: d.columns, tasks: d.tasks }, null, 1);
  await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1.tmp" && mv "$1.tmp" "$1"', "sh", FILE(), body]).catch(() => null);
}

// The changes, as functions of the data (applied to the view's copy at once, then to the file's).
const find = (d, id) => d.tasks.find((x) => x.id === id);
const doneCol = (d) => d.columns[d.columns.length - 1]?.id;
const inCol = (d, col) => d.tasks.filter((x) => x.column === col).sort((a, b) => a.order - b.order);
// An order between the task before `before` and `before` (end of the list when null).
function orderAt(list, before, skip) {
  const l = list.filter((x) => x.id !== skip), i = before ? l.findIndex((x) => x.id === before) : -1;
  if (i < 0) return (l.length ? l[l.length - 1].order : 0) + 1;
  return i === 0 ? l[0].order - 1 : (l[i - 1].order + l[i].order) / 2;
}
const ops = {
  create: (task) => (d) => { if (!find(d, task.id)) d.tasks.push(task); },
  patch: (id, fields) => (d) => { const x = find(d, id); if (x) Object.assign(x, fields, { updated: Date.now() }); },
  move: (id, col, before) => (d) => {
    const x = find(d, id); if (!x || !d.columns.some((c) => c.id === col)) return;
    x.order = orderAt(inCol(d, col), before, id);
    if (x.column !== col) { x.column = col; x.doneAt = col === doneCol(d) ? Date.now() : null; }
    x.updated = Date.now();
  },
  // Today / backlog: `today` on or off, placed before `before` in that list.
  plan: (id, today, before, list) => (d) => {
    const x = find(d, id); if (!x) return;
    x.today = today; x.order = orderAt(list.map((y) => find(d, y.id) ?? y), before, id);
    if (x.column === doneCol(d)) { x.column = d.columns[today && d.columns[1] ? 1 : 0].id; x.doneAt = null; }
    x.updated = Date.now();
  },
  remove: (id) => (d) => { d.tasks = d.tasks.filter((x) => x.id !== id); },
  attach: (id, list) => (d) => { const x = find(d, id); if (x) { x.attachments = [...(x.attachments ?? []), ...list.filter((a) => !(x.attachments ?? []).some((b) => b.id === a.id))]; x.updated = Date.now(); } },
  unattach: (id, aid) => (d) => { const x = find(d, id); if (x) x.attachments = (x.attachments ?? []).filter((a) => a.id !== aid); },
  comment: (id, c) => (d) => { const x = find(d, id); if (x && !(x.comments ?? []).some((y) => y.id === c.id)) { x.comments = [...(x.comments ?? []), c]; x.updated = Date.now(); } },
  uncomment: (id, cid) => (d) => { const x = find(d, id); if (x) x.comments = (x.comments ?? []).filter((c) => c.id !== cid); },
  addColumn: (col) => (d) => { if (!d.columns.some((c) => c.id === col.id)) d.columns.push(col); },
  renameColumn: (id, name) => (d) => { const c = d.columns.find((x) => x.id === id); if (c) c.name = name; },
  shiftColumn: (id, by) => (d) => {
    const i = d.columns.findIndex((x) => x.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= d.columns.length) return;
    [d.columns[i], d.columns[j]] = [d.columns[j], d.columns[i]];
  },
  // A column with tasks gives them to the first other column.
  removeColumn: (id) => (d) => {
    if (d.columns.length < 2) return;
    d.columns = d.columns.filter((x) => x.id !== id);
    for (const x of d.tasks) if (x.column === id) x.column = d.columns[0].id;
  },
};

export default class Tasks extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.data = { columns: COLUMNS.map((c) => ({ ...c })), tasks: [] }; this.loaded = false;
    this.chain = Promise.resolve(); this.rev = shared(REV) ?? 0;
    this.handle = cx.focus_handle();
    this.taskId = p.task ?? null; this.board = Boolean(p.board);
    if (this.taskId) this.initTask(cx); else this.initList(cx);
    this.reload(cx);
    cx.timer.every(3000, (cx) => { if (!this.busy) this.reload(cx); });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      const d = await readAll();
      if (!d) { this.error = "ks-tasks.json couldn't be read; nothing is written until it's fixed"; cx.notify(); return; }
      if (this.busy) return;
      this.data = d; this.loaded = true; this.error = null;
      if (this.taskId) this.syncTask();
      cx.notify();
    });
  }
  // One change: on this copy now, then on the file (read fresh, so nothing another copy wrote is lost).
  apply(op, cx) {
    if (this.error) return;
    op(this.data); cx.notify();
    this.busy = true;
    this.chain = this.chain.then(async () => {
      const d = await readAll();
      if (!d) return;
      op(d); await writeAll(d);
      this.rev = Date.now(); setShared(REV, this.rev);
    }).catch(() => null).finally(() => { this.busy = false; });
  }
  // Another copy wrote: read again (render is called for every shared write).
  checkRev(cx) {
    const r = shared(REV) ?? 0;
    if (r !== this.rev && !this.busy) { this.rev = r; this.reload(cx); }
  }

  newTask(fields) {
    const sp = spaces().find((s) => s.active), now = Date.now();
    return { id: uid("t"), title: "", body: "", column: this.data.columns[0]?.id, today: false, order: now, space: sp?.id ?? null,
      spaceName: sp ? spaceName(sp) : "", folder: sp?.folder ?? null, created: now, updated: now, doneAt: null, comments: [], attachments: [], ...fields };
  }
  openTask(id) {
    openOverlay({ mod: "ks-tasks", kind: "dialog", key: `ks-task-${id}`, width: 680, height: 720, props: { task: id } });
  }
  // The board window: its last size (px, from dragging a corner or the key modes' resize keys), else 64% x 66%.
  openBoard(size = load("boardSize", null), at = null) {
    const p = { board: true };
    openOverlay({ mod: "ks-tasks", kind: "window", key: BOARD, width: size?.width ?? 0.64, height: size?.height ?? 0.66, ...(at ? { at } : {}), props: p });
  }

  // ===================================================================================================================
  // Panel and board window

  initList(cx) {
    // "today" | "board"; the window remembers its own (it opens on the board).
    this.viewKey = this.board ? "boardView" : "view"; this.view = load(this.viewKey, this.board ? "board" : "today");
    this.scroll = ScrollHandle.new(); this.boardScroll = ScrollHandle.new();
    this.cur = { col: 0, row: 0 }; this.row = 0;
    this.drag = null; this.over = null;
    this.adding = null; // the column (or "@today", "@backlog") whose add box is open
    this.add = InputState.new({ placeholder: "A task, Enter adds it" });
    this.add.on("submit", (_e, cx) => this.submitAdd(cx));
    this.add.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.add.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.renaming = null; this.confirmDelete = null;
    this.colName = InputState.new({ placeholder: "Column name" });
    this.colName.on("submit", (_e, cx) => this.doneRename(cx));
    this.colName.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.colName.on("blur", (_e, cx) => { this.typing = false; if (this.renaming) this.doneRename(cx); });
    this.undo = null;
    if (!this.board) { takeFocus(this, cx, "ks-tasks", (c, cx) => this.command(c, cx)); watchFocus(this, cx, "ks-tasks", () => this.typing); }
    else {
      this.handle.focus(); cx.timer.after(150, () => this.handle.focus());
      // Resizable like the review and PR windows: the key modes' resize keys while it has the keyboard (lib/windows.js),
      // and its corners (ks-resize reopens it at the new size). Either way the size is kept for next time.
      trackActive(this, cx, BOARD, "ks-tasks");
      cx.spawn(async (cx) => {
        for (;;) {
          if ((await nextCommand()) !== "winresize") continue;
          const r = takeRequest(this, BOARD);
          if (!r) continue;
          const cur = this.size ?? { width: 1100, height: 700 }, step = 40 * (r.dir || 1);
          const size = r.reset ? null : { width: Math.max(560, Math.round(cur.width + (r.kind === "tall" ? 0 : step))), height: Math.max(360, Math.round(cur.height + (r.kind === "wide" ? 0 : step))) };
          save("boardSize", size); this.openBoard(size); raiseStrip();
        }
      });
    }
  }
  command(c, cx) {
    if (c === "board") this.openBoard();
    else if (c === "new") { this.setView(this.view, cx); this.startAdd(this.view === "today" ? "@today" : this.data.columns[this.cur.col]?.id, cx); }
  }
  setView(v, cx) { this.view = v; save(this.viewKey, v); this.adding = null; cx.notify(); }

  // Today: what's for today, then the backlog, neither done. Each sorted by order.
  lists() {
    const d = this.data, done = doneCol(d), open = d.tasks.filter((x) => x.column !== done).sort((a, b) => a.order - b.order);
    return { today: open.filter((x) => x.today), backlog: open.filter((x) => !x.today), done: d.tasks.filter((x) => x.column === done).length };
  }
  flat() { const l = this.lists(); return [...l.today, ...l.backlog]; }
  selected() {
    if (this.view === "today") return this.flat()[this.row] ?? null;
    const c = this.data.columns[this.cur.col];
    return c ? inCol(this.data, c.id)[this.cur.row] ?? null : null;
  }

  startAdd(where, cx) { if (!where) return; this.adding = where; this.add.set_value(""); this.add.focus(); cx.notify(); }
  submitAdd(cx) {
    const title = this.add.value().trim(), where = this.adding;
    if (!title || !where) { this.adding = null; this.handle.focus(); cx.notify(); return; }
    const fields = where === "@today" ? { today: true, column: this.data.columns[1]?.id ?? this.data.columns[0]?.id } : where === "@backlog" ? { column: this.data.columns[0]?.id } : { column: where };
    const list = where.startsWith("@") ? this.lists()[where.slice(1)] : inCol(this.data, where);
    this.apply(ops.create(this.newTask({ title, ...fields, order: (list.length ? list[list.length - 1].order : 0) + 1 })), cx);
    this.add.set_value(""); // stays open for the next one
  }
  // Files dropped on a list or column: a new task, called after the first file, carrying them.
  dropNew(where, paths, cx) {
    cx.spawn(async (cx) => {
      const atts = await addPaths(paths);
      if (!atts.length) return;
      const fields = where === "@today" ? { today: true, column: this.data.columns[1]?.id ?? this.data.columns[0]?.id } : where === "@backlog" ? {} : { column: where };
      this.apply(ops.create(this.newTask({ title: atts[0].name.replace(/\.[^.]+$/, ""), attachments: atts, ...fields })), cx);
    });
  }
  dropOn(task, paths, cx) {
    cx.spawn(async (cx) => { const atts = await addPaths(paths); if (atts.length) this.apply(ops.attach(task.id, atts), cx); });
  }
  remove(task, cx) {
    // Undo for 8 s; after that its attachment copies go too.
    if (this.undo) dropFiles(this.undo.task.attachments);
    this.undo = { task: JSON.parse(JSON.stringify(task)), until: Date.now() + 8000 };
    this.apply(ops.remove(task.id), cx);
    const mine = this.undo;
    cx.timer.after(8100, (cx) => { if (this.undo === mine) { dropFiles(mine.task.attachments); this.undo = null; } cx.notify(); });
  }
  restore(cx) { if (!this.undo) return; this.apply(ops.create(this.undo.task), cx); this.undo = null; }
  toggleToday(task, cx) {
    const l = this.lists(), to = !task.today;
    this.apply(ops.plan(task.id, to, null, to ? l.today : l.backlog), cx);
  }

  // Columns: rename in place (click the name), ‹ › move, Delete (twice when it has tasks).
  startRename(col, cx) { this.renaming = col.id; this.colName.set_value(col.name); this.colName.focus(); cx.notify(); }
  doneRename(cx) {
    const id = this.renaming, name = this.colName.value().trim();
    this.renaming = null;
    if (id && name) this.apply(ops.renameColumn(id, name), cx);
    this.handle.focus(); cx.notify();
  }
  addColumn(cx) {
    const col = { id: uid("c"), name: "New column" };
    this.apply(ops.addColumn(col), cx);
    this.cur = { col: this.data.columns.length - 1, row: 0 };
    this.startRename(col, cx);
  }

  // ---------- dragging ----------
  // A press on a card arms a drag; it starts once the pointer moved a few pixels (a plain click opens the task).
  // While dragging, the card or column under the pointer says where it would land (this.over = { where, before }).
  pressCard(task, e) { this.drag = { id: task.id, x: e.position.x, y: e.position.y, moved: false }; }
  moveRoot(e, cx) {
    const g = this.drag;
    if (!g || g.moved) return;
    if (Math.abs(e.position.x - g.x) + Math.abs(e.position.y - g.y) > 6) { g.moved = true; cx.notify(); }
  }
  overCard(where, list, task, e, cx) {
    if (!this.drag?.moved) return;
    const lower = e.bounds && e.local_position ? e.local_position.y > e.bounds.height / 2 : false;
    const i = list.findIndex((x) => x.id === task.id), before = lower ? list[i + 1]?.id ?? null : task.id;
    this.cardAt = `${e.position.x},${e.position.y}`;
    if (this.over?.where !== where || this.over?.before !== before) { this.over = { where, before }; cx.notify(); }
  }
  overList(where, e, cx) {
    if (!this.drag?.moved || this.cardAt === `${e.position.x},${e.position.y}`) return;
    if (this.over?.where !== where || this.over?.before !== null) { this.over = { where, before: null }; cx.notify(); }
  }
  release(cx) {
    const g = this.drag, o = this.over;
    this.drag = null; this.over = null;
    if (!g?.moved) return;
    this.justDragged = true; cx.timer.after(80, () => { this.justDragged = false; });
    if (o) {
      if (o.where === "@today" || o.where === "@backlog") this.apply(ops.plan(g.id, o.where === "@today", o.before, this.lists()[o.where.slice(1)]), cx);
      else this.apply(ops.move(g.id, o.where, o.before), cx);
    }
    cx.notify();
  }
  clickCard(task, cx) { if (this.justDragged || this.drag?.moved) return; this.openTask(task.id); }

  // ---------- keys ----------
  key(e, cx) {
    if (this.typing) {
      if (e.key === "escape") { if (this.renaming) { this.renaming = null; } this.adding = null; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    // Shift+letter reads as the capital (e.key can be the lowercase letter with shift held).
    const m = e.modifiers ?? {}, k = m.shift && /^[a-z]$/.test(e.key) ? e.key.toUpperCase() : e.key, sel = this.selected();
    if (m.platform || m.alt || m.control) return;
    if (this.drag && k === "escape") { this.drag = null; this.over = null; cx.stop_propagation(); cx.notify(); return; }
    const today = this.view === "today", flat = today ? this.flat() : null;
    const col = this.data.columns[this.cur.col], list = col ? inCol(this.data, col.id) : [];
    const go = (r) => { if (today) this.row = Math.max(0, Math.min(flat.length - 1, r)); else this.cur.row = Math.max(0, Math.min(list.length - 1, r)); };
    const goCol = (c) => { this.cur.col = Math.max(0, Math.min(this.data.columns.length - 1, c)); this.cur.row = Math.min(this.cur.row, Math.max(0, inCol(this.data, this.data.columns[this.cur.col].id).length - 1)); };
    const at = today ? this.row : this.cur.row;
    if (k === "j" || k === "down") go(at + 1);
    else if (k === "k" || k === "up") go(at - 1);
    else if (k === "g" && this.__g) { this.__g = false; go(0); }
    else if (k === "g") { this.__g = true; cx.timer.after(600, () => { this.__g = false; }); cx.stop_propagation(); return; }
    else if (k === "G") go(1e9);
    else if ((k === "enter" || k === "o") && sel) this.openTask(sel.id);
    else if (k === "n") this.startAdd(today ? "@today" : col?.id, cx);
    else if (k === "t" && sel) this.toggleToday(sel, cx);
    else if (k === "x" && sel) this.remove(sel, cx);
    else if (k === "u") this.restore(cx);
    else if (k === "b" || k === "tab") this.setView(today ? "board" : "today", cx);
    else if (k === "B" && !this.board) this.openBoard();
    else if (!today && (k === "l" || k === "right") && this.cur.col < this.data.columns.length - 1) goCol(this.cur.col + 1);
    else if (!today && (k === "h" || k === "left") && this.cur.col > 0) goCol(this.cur.col - 1);
    else if (!today && (k === "L" || k === "H") && sel) {
      const to = this.data.columns[this.cur.col + (k === "L" ? 1 : -1)];
      if (to) { this.apply(ops.move(sel.id, to.id, null), cx); goCol(this.cur.col + (k === "L" ? 1 : -1)); this.cur.row = inCol(this.data, to.id).length - 1; }
    }
    else if (!today && (k === "J" || k === "K") && sel) {
      const i = list.findIndex((x) => x.id === sel.id), before = k === "J" ? list[i + 2]?.id ?? null : list[i - 1]?.id;
      if (k === "K" && i === 0) return;
      this.apply(ops.move(sel.id, col.id, before), cx); go(at + (k === "J" ? 1 : -1));
    }
    else if (!today && k === "r" && col) this.startRename(col, cx);
    else if (!this.board && (k === "h" || k === "escape")) { leave("left"); }
    else if (!this.board && k === "l") { leave("right"); }
    else if (this.board && k === "escape") { closeOverlay(props().overlay); }
    else return;
    cx.stop_propagation(); cx.notify();
  }

  // ---------- drawing ----------
  card(task, t, where, list, at) {
    const dragging = this.drag?.moved && this.drag.id === task.id;
    const done = task.column === doneCol(this.data), n = (task.comments ?? []).length, files = task.attachments ?? [];
    const pics = files.filter((a) => a.kind === "image").slice(0, 3);
    const lineBefore = this.over?.where === where && this.over.before === task.id && this.drag?.id !== task.id;
    const meta = [];
    const colName = this.view === "today" ? this.data.columns.find((c) => c.id === task.column)?.name : null;
    if (colName) meta.push(colName);
    if (n) meta.push(plural(n, "comment"));
    if (files.length) meta.push(plural(files.length, "file"));
    return v_flex().flex_none()
      .when(lineBefore, (e) => e.child(div().h(2).mx(2).mb(4).rounded(1).bg(t.accent)))
      .child(v_flex().id(`card-${task.id}`).p(9).gap(5).rounded(8).border_1()
        .border_color(at ? t.accent : t.border).bg(t.background).cursor_pointer().opacity(dragging ? 0.4 : 1)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (e) => this.pressCard(task, e))
        .on_mouse_move((e, cx) => this.overCard(where, list, task, e, cx))
        .on_click((_e, cx) => this.clickCard(task, cx))
        .on_drop((e, cx) => { cx.stop_propagation(); this.droppedOn = true; cx.timer.after(100, () => { this.droppedOn = false; }); this.dropOn(task, e.paths, cx); })
        .child(h_flex().gap(6).items_start()
          .child(div().flex_1().min_w(0).text_size(12.5).text_color(done ? t.muted : t.foreground).child(task.title || "Untitled"))
          .child(div().id(`today-${task.id}`).flex_none().px(5).rounded(5).text_size(10.5).cursor_pointer()
            .border_1().border_color(task.today ? t.accent : t.border).text_color(task.today ? t.accent : t.dim)
            .bg(task.today ? t.accent + "1f" : t.background)
            .tooltip(task.today ? "On today's list (t takes it off)" : "Add to today (t)")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.toggleToday(task, cx); }).child(task.today ? "☀ Today" : "☀")))
        .when(pics.length > 0, (e) => e.child(attachRow(pics, t, `cp-${task.id}`)))
        .when(meta.length > 0 || Boolean(task.spaceName), (e) => e.child(h_flex().gap(6).items_center().text_size(10.5).text_color(t.dim)
          .when(Boolean(task.spaceName), (e) => e.child(div().flex_none().px(5).rounded(5).border_1().border_color(t.border).max_w(140).truncate().text_color(t.muted).child(task.spaceName)))
          .child(div().flex_1().min_w(0).truncate().child(meta.join(" · "))))));
  }

  addBox(where, t) {
    if (this.adding !== where) {
      return div().id(`add-${where}`).flex_none().h(28).px(8).flex().items_center().rounded(6).text_size(11.5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.startAdd(where, cx)).child("+ Add task");
    }
    return div().flex_none().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.accent).bg(t.chrome)
      .child(Input.new(this.add).h_full().text_size(12).text_color(t.foreground));
  }

  // A list that takes drops (today, backlog, a column): an accent end line while a card would land at its end.
  dropList(where, list, t, at) {
    const endLine = this.over?.where === where && this.over.before === null && this.drag?.moved;
    return v_flex().gap(6)
      .on_mouse_move((e, cx) => this.overList(where, e, cx))
      .on_drop((e, cx) => { cx.stop_propagation(); if (!this.droppedOn) this.dropNew(where, e.paths, cx); })
      .children(list.map((x, i) => this.card(x, t, where, list, at === i)))
      .when(Boolean(endLine), (e) => e.child(div().h(2).mx(2).rounded(1).bg(t.accent)))
      .child(this.addBox(where, t));
  }

  renderToday(t, focused) {
    const l = this.lists(), at = focused ? this.row : -1;
    const head = (label, n, hint) => h_flex().flex_none().mt(10).mb(2).gap(6).items_center().text_size(11)
      .child(div().font_semibold().text_color(t.muted).child(label)).child(div().text_color(t.dim).child(String(n)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(hint));
    return v_flex().id("tasks-today").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).px(10).pb(16)
      .child(head("Today", l.today.length, l.today.length ? "" : "nothing planned yet"))
      .child(this.dropList("@today", l.today, t, at))
      .child(head("Backlog", l.backlog.length, "☀ or t: do it today"))
      .child(this.dropList("@backlog", l.backlog, t, at - l.today.length))
      .when(l.done > 0, (e) => e.child(div().mt(12).text_size(10.5).text_color(t.dim).child(`${plural(l.done, "task")} done (in ${this.data.columns[this.data.columns.length - 1]?.name})`)));
  }

  column(c, i, t, focused, W) {
    const list = inCol(this.data, c.id), on = focused && this.cur.col === i, renaming = this.renaming === c.id;
    const small = (id, label, act, tone = t.muted, tip = null) => div().id(id).flex_none().px(5).rounded(4).text_size(11).text_color(tone).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).when(Boolean(tip), (e) => e.tooltip(tip)).on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(label);
    const deleting = this.confirmDelete === c.id;
    return v_flex().id(`col-${c.id}`).flex_none().w(W).h_full().min_h(0).rounded(9).bg(t.chrome).border_1().border_color(on ? t.accent + "88" : t.border)
      .child(h_flex().flex_none().h(36).px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(!renaming, (e) => e
          .child(div().id(`colname-${c.id}`).flex_1().min_w(0).truncate().font_semibold().text_size(12).cursor_pointer()
            .tooltip("Click to rename (r)").on_click((_e, cx) => this.startRename(c, cx)).child(c.name))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(String(list.length))))
        .when(renaming, (e) => e
          .child(div().flex_1().h(24).px(6).flex().items_center().rounded(5).border_1().border_color(t.accent).bg(t.background)
            .child(Input.new(this.colName).h_full().text_size(12).text_color(t.foreground)))
          .child(small(`cl-${c.id}`, "‹", (cx) => this.apply(ops.shiftColumn(c.id, -1), cx), t.muted, "Move left"))
          .child(small(`cr-${c.id}`, "›", (cx) => this.apply(ops.shiftColumn(c.id, 1), cx), t.muted, "Move right"))
          .when(this.data.columns.length > 1, (e) => e.child(small(`cd-${c.id}`, deleting ? (list.length ? `Delete, ${list.length} to ${this.data.columns.find((x) => x.id !== c.id).name}?` : "Delete?") : "Delete", (cx) => {
            if (!deleting) { this.confirmDelete = c.id; cx.timer.after(4000, (cx) => { this.confirmDelete = null; cx.notify(); }); cx.notify(); return; }
            this.renaming = null; this.confirmDelete = null; this.apply(ops.removeColumn(c.id), cx); this.cur.col = 0; this.handle.focus();
          }, t.ansi1)))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id(`colbody-${c.id}`).absolute().inset_0().overflow_y_scroll().p(8)
          .child(this.dropList(c.id, list, t, on ? this.cur.row : -1))));
  }

  renderBoard(t, focused) {
    const W = this.board ? 290 : 236;
    return h_flex().id("tasks-board").absolute().inset_0().overflow_x_scroll().track_scroll(this.boardScroll).p(10).gap(10).items_start()
      .children(this.data.columns.map((c, i) => this.column(c, i, t, focused, W)))
      .child(div().id("col-add").flex_none().w(W * 0.6).h(36).flex().items_center().justify_center().rounded(9).border_1().border_color(t.border)
        .text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.addColumn(cx)).child("+ Column"));
  }

  // Corner grips (the board window): ks-resize draws the outline while you drag and reopens the window at that size.
  grips(t) {
    const g = (corner) => div().id(`grip-${corner}`).absolute().size(14)
      .when(corner.includes("t"), (e) => e.top(0)).when(corner.includes("b"), (e) => e.bottom(0))
      .when(corner.includes("l"), (e) => e.left(0)).when(corner.includes("r"), (e) => e.right(0))
      .when(corner === "tl" || corner === "br", (e) => e.cursor_nwse_resize()).when(corner === "tr" || corner === "bl", (e) => e.cursor_nesw_resize())
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        if (!this.winRect) return;
        openOverlay({ mod: "ks-resize", kind: "window", frame: "none", key: "ks-resize", width: 1, height: 1, at: { x: 0, y: 0 },
          props: { rect: this.winRect, corner, zoom: settings().zoom || 1, reopen: { mod: "ks-tasks", key: BOARD, props: { board: true } } } });
      })
      .when(corner === "br", (e) => e.child(div().absolute().right(3).bottom(3).size(7).border_r_2().border_b_2().border_color(t.dim)));
    return ["tl", "tr", "bl", "br"].map(g);
  }

  renderList(cx) {
    this.checkRev(cx);
    const t = theme(), focused = this.board ? this.handle.is_focused() || this.typing : focusedNow(this, "ks-tasks", () => this.typing);
    const seg = (id, label, on, act) => div().id(id).h(22).px(8).flex().items_center().rounded(5).cursor_pointer().text_size(11)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    const btn = (id, label, act, tip) => div().id(id).h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).text_size(11).text_color(t.muted)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => act(cx)).child(label);
    const l = this.lists(), undoing = this.undo && Date.now() < this.undo.until;
    return v_flex().id("tasks").size_full().min_h(0).rounded(this.board ? 0 : 10).overflow_hidden().bg(t.background)
      .border_1().border_color(!this.board && focused ? t.accent : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_move((e, cx) => { if (this.board && e.bounds) this.winRect = e.bounds; this.moveRoot(e, cx); })
      .on_mouse_up("left", (_e, cx) => this.release(cx))
      .when(this.board, (e) => e.relative()
        .on_size_change((size) => { if (size?.width && (size.width !== this.size?.width || size.height !== this.size?.height)) { this.size = size; save("boardSize", { width: Math.round(size.width), height: Math.round(size.height) }); } })
        .children(this.grips(t)))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(this.board ? "Tasks board" : "Tasks"))
        .child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
          .child(seg("v-today", `Today · ${l.today.length}`, this.view === "today", (cx) => this.setView("today", cx)))
          .child(seg("v-board", "Board", this.view === "board", (cx) => this.setView("board", cx))))
        .child(div().flex_1())
        .when(!this.board, (e) => e.child(btn("tasks-big", "⤢", () => this.openBoard(), "Open the board in a window (B)")))
        .child(div().id("tasks-new").h(24).px(9).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(11).cursor_pointer()
          .hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.startAdd(this.view === "today" ? "@today" : this.data.columns[this.cur.col]?.id, cx)).child("+ New"))
        .when(this.board, (e) => e.child(div().id("board-x").size(26).flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted)
          .hover((s) => s.bg(t.hover)).tooltip("Close (Esc)").on_click(() => closeOverlay(props().overlay)).child("✕"))))
      .when(Boolean(undoing), (e) => e.child(h_flex().flex_none().mx(8).mt(8).px(10).h(28).gap(8).items_center().rounded(7).bg(t.accent + "1f").text_size(11.5).text_color(t.accent)
        .child(div().flex_1().truncate().child(`Deleted "${this.undo.task.title || "Untitled"}"`))
        .child(div().id("tasks-undo").px(6).rounded(4).cursor_pointer().font_semibold().hover((s) => s.bg(t.accent + "3a")).on_click((_e, cx) => this.restore(cx)).child("Undo (u)"))))
      .when(Boolean(this.error), (e) => e.child(div().p(12).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(div().flex_1().min_h(0).relative()
        .child(this.view === "today" ? this.renderToday(t, focused) : this.renderBoard(t, focused))
        .when(this.view === "today", (e) => e.child(Scrollbar.vertical("tasks-today").absolute().inset_0())))
      .child(h_flex().flex_none().h(24).px(12).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim).truncate()
        .child(this.view === "today" ? "j/k move · Enter open · t today · n new · x delete · b board · drop files on a card or list"
          : "h/l j/k move · H/L to column · J/K reorder · r rename column · drag cards · drop files"));
  }

  // ===================================================================================================================
  // A task's dialog

  initTask(cx) {
    this.title = InputState.new({ placeholder: "Task title" });
    this.title.on("change", (_e, cx) => this.typed("title", this.title.value(), cx));
    this.body = TextareaState.new({ placeholder: "Details, links, anything. Saved as you type.", rows: 4 });
    this.body.set_auto_grow(3, 14);
    this.body.on("change", (_e, cx) => this.typed("body", this.body.value(), cx));
    this.note = TextareaState.new({ placeholder: "Add a comment (cmd-enter)", rows: 2 });
    this.note.set_auto_grow(2, 8);
    this.scroll = ScrollHandle.new();
    this.seeded = false; this.working = null;
    this.handle.focus();
  }
  task() { return find(this.data, this.taskId); }
  // First load: the fields get the task's text (later reloads leave what you're typing alone).
  syncTask() {
    const x = this.task();
    if (!x || this.seeded) return;
    this.seeded = true; this.title.set_value(x.title ?? ""); this.body.set_value(x.body ?? "");
    if (!x.title) this.title.focus();
  }
  typed(field, value, cx) {
    if (!this.seeded) return;
    const gen = (this.gen = (this.gen ?? 0) + 1);
    const x = this.task(); if (x) x[field] = value;
    this.dirty = true; cx.notify();
    cx.timer.after(600, (cx) => { if (gen === this.gen) { this.dirty = false; this.apply(ops.patch(this.taskId, { [field]: value }), cx); } });
  }
  attachWith(cx, label, get) {
    this.working = label; cx.notify();
    cx.spawn(async (cx) => {
      const r = await get();
      const list = Array.isArray(r) ? r : r ? [r] : [];
      this.working = list.length || label !== "Pasting…" ? null : "No picture on the clipboard";
      if (this.working) cx.timer.after(2500, (cx) => { this.working = null; cx.notify(); });
      if (list.length) this.apply(ops.attach(this.taskId, list), cx);
      cx.notify();
    });
  }
  sendComment(cx) {
    const text = this.note.value().trim();
    if (!text) return;
    this.apply(ops.comment(this.taskId, { id: uid("m"), text, at: Date.now() }), cx);
    this.note.set_value("");
  }

  renderTask(cx) {
    this.checkRev(cx);
    const t = theme(), x = this.task();
    const close = () => closeOverlay(props().overlay);
    if (!x) {
      return v_flex().size_full().p(20).gap(10).bg(t.background).text_color(t.foreground).track_focus(this.handle)
        .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
        .child(div().text_size(13).text_color(t.dim).child(this.loaded ? "This task was deleted." : "Loading…"));
    }
    const d = this.data, mono = settings().font_family ?? "JetBrains Mono";
    const pill = (id, label, on, act, tone = t.accent) => div().id(id).h(24).px(9).flex().items_center().rounded(12).text_size(11).cursor_pointer()
      .border_1().border_color(on ? tone : t.border).bg(on ? tone + "1f" : t.background).text_color(on ? tone : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    const btn = (id, label, act, tone = t.muted) => div().id(id).h(26).px(10).flex().items_center().rounded(6).border_1().border_color(t.border)
      .text_size(11.5).text_color(tone).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => act(cx)).child(label);
    const section = (label, extra = null) => h_flex().mt(14).mb(6).gap(8).items_center()
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(label)).child(div().flex_1().h(1).bg(t.border)).when(Boolean(extra), (e) => e.child(extra));
    const comments = [...(x.comments ?? [])].sort((a, b) => a.at - b.at);
    return v_flex().id("task").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_drop((e, cx) => this.attachWith(cx, "Adding…", () => addPaths(e.paths)))
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (e.key === "escape") { close(); cx.stop_propagation(); return; }
        if (e.key === "enter" && m.platform && this.note.value().trim()) { this.sendComment(cx); cx.stop_propagation(); }
      })
      .child(h_flex().flex_none().h(44).px(16).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).bg(t.chrome)
          .child(Input.new(this.title).h_full().text_size(14).font_semibold().text_color(t.foreground)))
        .child(div().id("task-x").size(26).flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click(() => close()).child("✕")))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("task-body").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).px(16).pt(12).pb(20)
          .child(h_flex().flex_wrap().gap(6).items_center()
            .children(d.columns.map((c) => pill(`tc-${c.id}`, c.name, x.column === c.id, (cx) => this.apply(ops.move(x.id, c.id, null), cx))))
            .child(div().w(8))
            .child(pill("tt", x.today ? "☀ Today" : "☀ Add to today", Boolean(x.today), (cx) => this.apply(ops.patch(x.id, { today: !x.today }), cx))))
          .child(h_flex().mt(8).gap(8).text_size(10.5).text_color(t.dim)
            .when(Boolean(x.spaceName), (e) => e.child(div().px(5).rounded(5).border_1().border_color(t.border).text_color(t.muted).child(x.spaceName)))
            .child(div().child(`created ${ago(x.created)} · updated ${ago(x.updated)}${this.dirty ? " · saving…" : ""}`)))
          .child(section("Description"))
          .child(div().rounded(6).border_1().border_color(t.border).bg(t.chrome).px(8).py(6)
            .child(Textarea.new(this.body).w_full().text_size(12.5).text_color(t.foreground).font_family(mono)))
          .child(section(`Attachments${(x.attachments ?? []).length ? ` · ${(x.attachments ?? []).length}` : ""}`,
            h_flex().gap(6)
              .child(btn("ta-pick", "Add files…", (cx) => this.attachWith(cx, "Choosing…", pickAndAdd)))
              .child(btn("ta-paste", "Paste image", (cx) => this.attachWith(cx, "Pasting…", pasteImage)))))
          .when(Boolean(this.working), (e) => e.child(div().mb(6).text_size(11).text_color(t.dim).child(this.working)))
          .child((x.attachments ?? []).length
            ? attachRow(x.attachments, t, `ta-${x.id}`, { big: true, onRemove: (a, cx) => { this.apply(ops.unattach(x.id, a.id), cx); dropFiles([a]); } })
            : div().h(56).flex().items_center().justify_center().rounded(8).border_1().border_color(t.border).text_size(11.5).text_color(t.dim)
              .child("Drop files here, or Add files / Paste image"))
          .child(section(`Comments${comments.length ? ` · ${comments.length}` : ""}`))
          .children(comments.map((c) => v_flex().id(`cm-${c.id}`).mb(8).p(9).gap(4).rounded(8).border_1().border_color(t.border).bg(t.chrome)
            .child(h_flex().gap(6).text_size(10.5).text_color(t.dim).child(div().flex_1().child(ago(c.at)))
              .child(div().id(`cmx-${c.id}`).px(5).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.apply(ops.uncomment(x.id, c.id), cx)).child("Delete")))
            .child(div().text_size(12.5).text_color(t.foreground).child(c.text))))
          .child(div().rounded(6).border_1().border_color(t.border).bg(t.chrome).px(8).py(6)
            .child(Textarea.new(this.note).w_full().text_size(12.5).text_color(t.foreground)))
          .child(h_flex().mt(6).gap(8).items_center()
            .child(div().flex_1())
            .child(div().id("cm-send").h(26).px(10).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(11.5).cursor_pointer()
              .hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.sendComment(cx)).child("Comment"))))
        .child(Scrollbar.vertical("task-body").absolute().inset_0()))
      .child(h_flex().flex_none().h(40).px(16).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(10.5).text_color(t.dim).child("Esc closes · drop files anywhere here to attach"))
        .child(btn("task-del", this.confirmDel ? "Delete for good?" : "Delete task", (cx) => {
          if (!this.confirmDel) { this.confirmDel = true; cx.timer.after(4000, (cx) => { this.confirmDel = false; cx.notify(); }); cx.notify(); return; }
          dropFiles(x.attachments); this.apply(ops.remove(x.id), cx); close();
        }, t.ansi1)));
  }

  render(cx) {
    if (this.taskId) return this.renderTask(cx);
    return this.board ? this.renderList(cx) : dimmed(this, this.renderList(cx));
  }
}
