// The sidebar's Tasks: above My PRs, what's being worked on now (the board's in-progress column, every space), up
// to three, with how many are planned for today and how many agents proposed. A task opens its window; the header
// opens the board window on all spaces. Folds to one line (the chevron), and sizes its block to fit.
// Reads <app home>/data/ks-tasks.json (ks-tasks writes it): every 5 s, and at once when shared "ks-tasks.rev" moves.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, theme, run, shared, setShared, openOverlay, settings } from "herdr";
import { dimmed } from "./lib/focus.js";
import { pref } from "./lib/prefs.js";
import { sectionHead, sectionFrame, badge, headAction, SECTION_HEAD } from "./lib/section.js";

const BLOCK = "now-tasks", HEAD = SECTION_HEAD + 1, ROW = 40;
const max = () => Math.max(1, Math.min(8, pref("nowTasksMax") ?? 3)); // how many it lists (settings)
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
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
    this.data = { columns: [], tasks: [] }; this.collapsed = load("collapsed", false); this.rev = null;
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
  fit() {
    const v = this.view(), MAX = max(), rows = Math.min(v.now.length, MAX);
    const px = this.collapsed ? HEAD : HEAD + (rows ? rows * ROW + (v.now.length > MAX ? 20 : 0) + 6 : 22);
    if (px !== this.px) { this.px = px; run("layout.resize", { id: BLOCK, px }); }
  }
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
    openOverlay({ mod: "ks-tasks", kind: "window", key: `ks-task-${id}`, width, height, ...(at ? { at } : {}), props: { task: id } });
  }

  render(cx) { return dimmed(this, this.renderInner(cx)); }

  renderInner(cx) {
    const r = shared("ks-tasks.rev") ?? 0;
    if (r !== this.rev) { if (this.rev !== null) this.read(cx); this.rev = r; }
    const t = theme(), v = this.view(), MAX = max();
    if (this.lastMax !== MAX) { this.lastMax = MAX; this.fit(); }
    return sectionFrame(t, v_flex().id("nowtasks").size_full().min_h(0).bg(t.chrome).text_color(t.foreground))
      .child(sectionHead(t, { id: "nowtasks", title: "Tasks", collapsed: this.collapsed, onToggle: (cx) => this.toggle(cx),
        onClick: () => this.openBoard(), tip: "Open the board, all spaces",
        badges: [v.now.length > 0 && badge(t, `${v.now.length} doing`, t.accent, true), v.today > 0 && badge(t, `${v.today} today`, t.muted), v.proposed > 0 && badge(t, `${v.proposed} new`, t.accent)].filter(Boolean),
        actions: [headAction(t, "nowtasks-open", "⤢", "Open the board", () => this.openBoard())] }))
      .when(!this.collapsed, (e) => e
        .when(!v.now.length, (e) => e.child(div().px(14).h(22).flex().items_center().text_size(11).text_color(t.dim)
          .child(v.open ? "Nothing in progress" : "No tasks yet")))
        .children(v.now.slice(0, MAX).map((x) => v_flex().id(`nt-${x.id}`).h(ROW).flex_none().mx(6).px(8).justify_center().gap(1).rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(() => this.openTask(x.id))
          .child(h_flex().gap(6).items_center()
            .child(div().size(6).flex_none().rounded(3).bg(t.accent))
            .child(div().flex_1().min_w(0).truncate().text_size(12).child(x.title || "Untitled"))
            .when(Boolean(x.today), (e) => e.child(div().flex_none().text_size(10).text_color(t.accent).child("☀"))))
          .child(div().pl(12).text_size(10.5).text_color(t.dim).truncate()
            .child([x.assignee ? `@ ${x.assignee}` : "", String(x.spaceName ?? "").replace(/\s*·\s*$/, ""), ago(x.updated)].filter(Boolean).join(" · ")))))
        .when(v.now.length > MAX, (e) => e.child(div().id("nt-more").px(14).h(20).flex().items_center().text_size(10.5).text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click(() => this.openBoard()).child(`+${v.now.length - MAX} more on the board`))));
  }
}
