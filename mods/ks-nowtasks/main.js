// The sidebar's Tasks: above My PRs, what's being worked on now (the board's in-progress column, every space), up
// to three, with how many are planned for today and how many agents proposed. A task opens its window; the header
// opens the board window on all spaces. Folds to one line (the chevron), and sizes its block to fit.
// Reads <app home>/data/ks-tasks.json (ks-tasks writes it): every 5 s, and at once when shared "ks-tasks.rev" moves.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, theme, run, shared, setShared, openOverlay, settings, layout } from "herdr";
import { dimmed } from "./lib/focus.js";
import { pref } from "./lib/prefs.js";
import { sectionHead, sectionFrame, badge, headAction, SECTION_HEAD, SB } from "./lib/section.js";

const BLOCK = "now-tasks", HEAD = SECTION_HEAD + 1, ROW = 40;
const max = () => Math.max(1, Math.min(8, pref("nowTasksMax") ?? 3)); // how many it lists (settings)
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const findNode = (n, id) => (!n ? null : n.id === id ? n : (n.children ?? []).reduce((f, c) => f ?? findNode(c, id), null));
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

// The in-progress column: one called Doing / In progress / Working / Active, else the one before the last (done).
function doingCol(cols) {
  return cols.find((c) => /doing|progress|working|active/i.test(c.name)) ?? cols[Math.max(0, cols.length - 2)];
}

export default class NowTasks extends View {
  init(_props, cx) {
    this.data = { columns: [], tasks: [] }; this.collapsed = load("collapsed", false); this.userPx = load("heldPx", null); this.rev = null;
    this.read(cx);
    cx.timer.every(5000, (cx) => this.read(cx));
  }

  read(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("cat", [`${appHome()}/data/ks-tasks.json`]).catch(() => null);
      try { const d = JSON.parse(r?.stdout || "{}"); this.data = { columns: d.columns ?? [], tasks: d.tasks ?? [] }; } catch { return; }
      this.fit(); cx.notify();
    });
  }

  view() {
    const { columns, tasks } = this.data, done = columns[columns.length - 1]?.id, doing = doingCol(columns)?.id;
    const open = tasks.filter((x) => x.column !== done);
    const now = doing && doing !== done ? open.filter((x) => x.column === doing && !x.proposed).sort((a, b) => b.updated - a.updated) : [];
    return { now, today: open.filter((x) => x.today && !x.proposed && x.column !== doing).length, proposed: open.filter((x) => x.proposed).length, open: open.length };
  }

  // The block's height: the header, and one row per task shown (plus a "more" line).
  // How many it lists: as many as fit when you've dragged it to a height of your own, else the setting.
  limit() { return this.userPx ? Math.max(1, Math.floor((this.userPx - HEAD - 26) / ROW)) : max(); }
  // Its height: what you dragged it to (kept), else just enough for what it lists.
  fit() {
    const v = this.view(), MAX = this.limit(), rows = Math.min(v.now.length, MAX);
    const px = this.collapsed ? HEAD : this.userPx ?? HEAD + (rows ? rows * ROW + (v.now.length > MAX ? 20 : 0) + 6 : 22);
    if (px !== this.px) { this.px = px; this.resizedAt = Date.now(); run("layout.resize", { id: BLOCK, px }); }
  }
  // The block was dragged to another height: keep it, and list as many as fit.
  // Dragged to another height? The layout's size for this block is what we last asked for unless someone dragged
  // its edge (a squeeze by the blocks around it doesn't change it). Then keep that height.
  sized(cx) {
    const px = findNode(layout(), BLOCK)?.size?.px;
    if (this.collapsed || !this.px || !px || Math.abs(px - this.px) <= 2 || Date.now() - (this.resizedAt ?? 0) < 1500) return;
    this.userPx = Math.max(HEAD + ROW, Math.round(px)); this.px = this.userPx; save("heldPx", this.userPx); this.fit(); cx.notify();
  }
  unsize(cx) { this.userPx = null; save("heldPx", null); this.fit(); cx.notify(); }
  toggle(cx) { this.collapsed = !this.collapsed; save("collapsed", this.collapsed); this.fit(); cx.notify(); }

  // The board window, on all spaces (its own choice of view is kept).
  openBoard() {
    const size = shared("ks-tasks.boardSize");
    openOverlay({ mod: "ks-tasks", kind: "window", key: "ks-tasks-board", width: size?.width ?? 0.64, height: size?.height ?? 0.66, props: { board: true, all: true } });
  }
  // The same as ks-tasks' openTaskWindow: a resizable window at the last size used.
  openTask(id) {
    const s = shared("ks-tasks.taskSize"), width = s?.width ?? 680, height = s?.height ?? 720;
    let at;
    try { const v = window.viewport_size(), z = settings().zoom || 1; at = { x: Math.max(0, Math.round((v.width - width * z) / 2)), y: Math.max(0, Math.round((v.height - height * z) / 2)) }; } catch {}
    openOverlay({ mod: "ks-tasks", kind: "window", key: `ks-task-${id}`, width, height, ...(at ? { at } : {}), props: { task: id, opened: Date.now() } });
  }

  render(cx) { return dimmed(this, this.renderInner(cx)); }

  renderInner(cx) {
    const r = shared("ks-tasks.rev") ?? 0;
    if (r !== this.rev) { if (this.rev !== null) this.read(cx); this.rev = r; }
    const t = theme(), v = this.view(), MAX = this.limit();
    if (this.lastMax !== MAX) { this.lastMax = MAX; this.fit(); }
    return sectionFrame(t, v_flex().id("nowtasks").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).on_size_change((_s, cx) => this.sized(cx)))
      .child(sectionHead(t, { id: "nowtasks", title: "Tasks", collapsed: this.collapsed, onToggle: (cx) => this.toggle(cx),
        onClick: () => this.openBoard(), tip: "Open the board, all spaces",
        badges: [v.now.length > 0 && badge(t, `${v.now.length} doing`, t.accent, true), v.today > 0 && badge(t, `${v.today} today`, t.muted), v.proposed > 0 && badge(t, `${v.proposed} new`, t.accent)].filter(Boolean),
        actions: [
          ...(this.userPx ? [headAction(t, "nowtasks-fit", "↕", "Fit to the tasks again (you dragged it to this height)", (cx) => this.unsize(cx))] : []),
          headAction(t, "nowtasks-open", "⤢", "Open the board", () => this.openBoard())] }))
      .when(!this.collapsed, (e) => e
        .when(!v.now.length, (e) => e.child(div().px(14).h(22).flex().items_center().text_size(11).text_color(t.dim)
          .child(v.open ? "Nothing in progress" : "No tasks yet")))
        .children(v.now.slice(0, MAX).map((x) => v_flex().id(`nt-${x.id}`).h(ROW).flex_none().mx(SB.inset).px(SB.pad).justify_center().gap(2).rounded(SB.radius).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(() => this.openTask(x.id))
          .child(h_flex().gap(6).items_center()
            .child(div().size(6).flex_none().rounded(3).bg(t.accent))
            .child(div().flex_1().min_w(0).truncate().text_size(SB.title).font_medium().child(x.title || "Untitled"))
            .when(Boolean(x.today), (e) => e.child(div().flex_none().text_size(10).text_color(t.accent).child("☀"))))
          .child(div().pl(12).text_size(SB.detail).text_color(t.dim).truncate()
            .child([x.assignee ? `@ ${x.assignee}` : "", String(x.spaceName ?? "").replace(/\s*·\s*$/, ""), ago(x.updated)].filter(Boolean).join(" · ")))))
        .when(v.now.length > MAX, (e) => e.child(div().id("nt-more").px(SB.inset + SB.pad).h(20).flex().items_center().text_size(SB.detail).text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click(() => this.openBoard()).child(`+${v.now.length - MAX} more on the board`))));
  }
}
