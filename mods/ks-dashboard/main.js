// Dashboard: what you did today, this week and this month. Two faces, picked by its props:
//   - the sidebar block (no props), above Tasks: today in one line (PRs merged, lines, tasks done, Linear ids);
//     click opens the window. It also runs prompts set to run on their own ("auto") once a day.
//   - the window ({ window: true }, lib/panelwin.js: resizable, Esc or ✕ closes): Today / This week / This month,
//     each with its merged PRs, tasks done and Linear issues; the prompts (▶ runs one) and every run kept.
//   Views pick which repos it shows (All, or e.g. "Work": one GitHub org). The chosen view applies to both faces;
//   a prompt can be tied to a view of its own.
// Data and runs: ./data.js (files under <app home>/data/ks-dashboard/).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, ScrollHandle, TextView, InputState, Input } from "gpui-base";
import { exec, run, theme, props, notify, nextCommand } from "herdr";
import { dimmed } from "./lib/focus.js";
import { linearUrl, openLinear, copyLinear } from "./lib/linear.js";
import { sectionHead, sectionFrame, badge, headAction } from "./lib/section.js";
import { isWindow, initWindow, openPanelWindow, closeWindow, windowFrame, closeButton } from "./lib/panelwin.js";
import { RANGES, rangeStart, ymd, loadPrompts, savePrompts, loadRuns, removeRun, activity, lastActivity, runPrompt, loadViews, saveViews, filtered, knownRepos } from "./data.js";

const MOD = "ks-dashboard";
const num = (n) => String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const when = (ms) => { const d = new Date(ms); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm(ms)}`; };
const lines = (prs) => prs.reduce((s, p) => ({ add: s.add + (p.additions ?? 0), del: s.del + (p.deletions ?? 0) }), { add: 0, del: 0 });
const repos = (prs) => [...new Set(prs.map((p) => p.repo.split("/").pop()))];
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Today in one sentence, from the data alone.
export function sentence(a, label = "Today") {
  if (!a) return "Loading…";
  if (a.error && !a.prs?.length) return a.error;
  const l = lines(a.prs ?? []), parts = [];
  if (a.prs.length) parts.push(`merged ${plural(a.prs.length, "PR")} in ${repos(a.prs).join(", ")} (+${num(l.add)} −${num(l.del)})`);
  if (a.tasks.length) parts.push(`finished ${plural(a.tasks.length, "task")}`);
  if (a.linear.length) parts.push(`touched ${a.linear.slice(0, 4).join(", ")}${a.linear.length > 4 ? ` and ${a.linear.length - 4} more` : ""}`);
  return parts.length ? `${label} you ${parts.join(", ")}.` : `Nothing merged or finished ${label === "Today" ? "today" : label.toLowerCase()} yet.`;
}

export default class Dashboard extends View {
  init(_props, cx) {
    this.windowed = isWindow();
    this.act = {}; this.prompts = []; this.runs = []; this.range = "day"; this.sel = null; this.running = null;
    this.handle = cx.focus_handle(); this.scroll = ScrollHandle.new();
    this.views = { current: null, views: [] }; this.editing = null; this.typing = false;
    this.name = InputState.new({ placeholder: "View name, e.g. Work" });
    this.name.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.name.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.name.on("submit", (_e, cx) => this.saveView(cx));
    lastActivity().then((a) => { this.act = { ...a, ...this.act }; cx.notify(); });
    this.look("day", cx);
    this.loadLists(cx);
    if (this.windowed) {
      initWindow(this, cx, MOD);
      this.handle.focus();
      cx.timer.every(30000, (cx) => this.loadLists(cx)); // runs started from the sidebar show up
      cx.spawn(async (cx) => { for (;;) { if (await nextCommand() === "views") this.loadLists(cx); } });
    } else {
      cx.timer.every(10 * 60000, (cx) => this.look("day", cx));
      cx.timer.every(60000, (cx) => this.autoRun(cx));
      cx.timer.after(15000, (cx) => this.autoRun(cx));
      // "ks-dashboard.open" (the toast after a run, a key): the window. "ks-dashboard.run:<prompt id>": runs it.
      cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "open") this.open(); else if (c === "views") this.loadLists(cx); else if (c.startsWith("run:")) { const p = this.prompts.find((x) => x.id === c.slice(4)); if (p) this.run(p, cx); } } });
    }
  }

  look(range, cx) {
    if (this.looking?.[range]) return;
    this.looking = { ...this.looking, [range]: true }; cx.notify();
    cx.spawn(async (cx) => {
      try { this.act = { ...this.act, [range]: await activity(range) }; }
      finally { this.looking = { ...this.looking, [range]: false }; cx.notify(); }
    });
  }
  loadLists(cx) {
    cx.spawn(async (cx) => { this.views = await loadViews(); this.prompts = await loadPrompts(); this.runs = await loadRuns(); cx.notify(); });
  }

  // ---------- views ----------
  view(id = this.views.current) { return id ? this.views.views.find((v) => v.id === id) ?? null : null; }
  shown(range) { return filtered(this.act[range], this.view()); }
  storeViews(v, cx) { this.views = v; cx.notify(); saveViews(v).then(() => run("ks-dashboard.views")); }
  pickView(id, cx) { this.editing = null; this.sel = null; this.storeViews({ ...this.views, current: id }, cx); }
  editView(v, cx) {
    this.editing = { id: v?.id ?? null, repos: new Set(v?.repos ?? []) };
    this.name.set_value(v?.name ?? ""); this.sel = null; if (!v) this.name.focus(); cx.notify();
  }
  toggleRepo(r, cx) { const s = this.editing.repos; if (s.has(r)) s.delete(r); else s.add(r); cx.notify(); }
  saveView(cx) {
    const e = this.editing; if (!e) return;
    const name = this.name.value().trim() || "View", repos = [...e.repos].sort();
    if (!repos.length) { notify({ title: "Pick at least one repo or owner", level: "warning", timeout: 2500 }); return; }
    const id = e.id ?? `v${Date.now()}`;
    const views = e.id ? this.views.views.map((v) => (v.id === id ? { ...v, name, repos } : v)) : [...this.views.views, { id, name, repos }];
    this.editing = null; this.handle.focus(); this.storeViews({ current: id, views }, cx);
  }
  deleteView(cx) {
    const id = this.editing?.id; this.editing = null; this.handle.focus();
    if (!id) return cx.notify();
    this.storeViews({ current: this.views.current === id ? null : this.views.current, views: this.views.views.filter((v) => v.id !== id) }, cx);
    const ps = this.prompts.map((p) => (p.view === id ? { ...p, view: null } : p));
    if (ps.some((p, i) => p !== this.prompts[i])) { this.prompts = ps; savePrompts(ps); }
  }
  // A prompt's view: All, then each view in turn.
  cyclePromptView(p, cx) {
    const ids = [null, ...this.views.views.map((v) => v.id)], next = ids[(ids.indexOf(p.view ?? null) + 1) % ids.length];
    this.prompts = this.prompts.map((x) => (x.id === p.id ? { ...x, view: next } : x)); savePrompts(this.prompts); cx.notify();
  }

  run(p, cx) {
    if (this.running) return;
    this.running = p.id; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { run: r, whole } = await runPrompt(p);
        this.runs = await loadRuns(); this.sel = this.windowed ? r.id : this.sel;
        this.act = { ...this.act, [p.range]: whole };
        notify({ title: `${p.name}: done`, body: r.error ?? `${plural(r.prs.length, "PR")}, ${plural(r.tasks.length, "task")}`, level: r.error ? "warning" : "success", timeout: 4000, action: { name: "ks-dashboard.open" } });
      } finally { this.running = null; cx.notify(); }
    });
  }
  // Prompts with an `auto` time run once a day, the first minute after it that Herdr is open (sidebar copy only).
  autoRun(cx) {
    if (this.running) return;
    const now = new Date(), today = rangeStart("day").getTime();
    for (const p of this.prompts) {
      if (!p.auto || !/^\d\d:\d\d$/.test(p.auto)) continue;
      const [h, m] = p.auto.split(":").map(Number);
      if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) continue;
      if (this.runs.some((r) => r.prompt === p.id && r.at >= today)) continue;
      this.run(p, cx); return;
    }
  }

  open() { openPanelWindow(MOD, null); }

  render(cx) { return this.windowed ? this.renderWindow(cx) : dimmed(this, this.renderBlock(cx)); }

  // ---------- the sidebar block ----------
  renderBlock() {
    const t = theme(), a = this.shown("day"), l = lines(a?.prs ?? []), v = this.view();
    const chip = (label, tone = t.muted) => div().flex_none().px(5).rounded(6).border_1().border_color(t.border).text_size(10).text_color(tone).child(label);
    return sectionFrame(t, v_flex().id("dash").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => this.open()))
      .child(sectionHead(t, { id: "dash", title: "Dashboard", badges: this.running ? [badge(t, "running…", t.accent)] : [],
        actions: [headAction(t, "dash-open", "⤢", "Open the dashboard", () => this.open())] }))
      .child(h_flex().pl(30).pr(12).gap(5).items_center().flex_wrap()
        .child(div().text_size(11).text_color(t.dim).child(v ? `Today · ${v.name}` : "Today"))
        .when(Boolean(a), (e) => e
          .child(chip(`${plural(a.prs.length, "PR")} merged`, a.prs.length ? t.accent : t.muted))
          .when(a.prs.length > 0, (e) => e.child(chip(`+${num(l.add)} −${num(l.del)}`)))
          .when(a.tasks.length > 0, (e) => e.child(chip(`${plural(a.tasks.length, "task")} done`)))
          .when(a.linear.length > 0, (e) => e.child(chip(a.linear.slice(0, 2).join(" ") + (a.linear.length > 2 ? " …" : "")))))
        .when(!a, (e) => e.child(div().text_size(11).text_color(t.dim).child("…"))));
  }

  // ---------- the window ----------
  key(e, cx) {
    const m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    if (this.typing) { if (e.key === "escape") { this.editing = null; this.handle.focus(); cx.stop_propagation(); cx.notify(); } return; }
    const i = RANGES.findIndex(([r]) => r === this.range);
    if (e.key === "escape") { if (this.editing) this.editing = null; else if (this.sel) this.sel = null; else return closeWindow(MOD); }
    else if (e.key === "v") { const ids = [null, ...this.views.views.map((v) => v.id)]; this.pickView(ids[(ids.indexOf(this.views.current) + 1) % ids.length], cx); }
    else if (e.key === "1" || e.key === "2" || e.key === "3") this.setRange(RANGES[Number(e.key) - 1][0], cx);
    else if (e.key === "tab") this.setRange(RANGES[(i + (m.shift ? RANGES.length - 1 : 1)) % RANGES.length][0], cx);
    else if (e.key === "r") this.look(this.range, cx);
    else return;
    cx.stop_propagation(); cx.notify();
  }
  setRange(r, cx) { this.range = r; this.sel = null; this.editing = null; if (!this.act[r] || Date.now() - this.act[r].at > 5 * 60000) this.look(r, cx); cx.notify(); }

  renderWindow(cx) {
    const t = theme(), run = this.sel && this.runs.find((r) => r.id === this.sel);
    const seg = (id, label, on, act) => div().id(id).h(24).px(10).flex().items_center().rounded(5).cursor_pointer().text_size(11.5)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    const root = v_flex().id("dash-window").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(44).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Dashboard"))
        .child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
          .children(RANGES.map(([r, label], i) => seg(`rg-${r}`, label, !run && this.range === r, (cx) => this.setRange(r, cx)).tooltip(`${i + 1}`))))
        .child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
          .child(seg("vw-all", "All repos", !this.editing && !this.views.current, (cx) => this.pickView(null, cx)).tooltip("Every repo (v cycles views)"))
          .children(this.views.views.map((v) => seg(`vw-${v.id}`, v.name, this.editing ? this.editing.id === v.id : this.views.current === v.id, (cx) => (this.views.current === v.id && !this.editing ? this.editView(v, cx) : this.pickView(v.id, cx)))
            .tooltip(`${v.repos.join(", ")} · click again to edit`)))
          .child(seg("vw-new", "+", Boolean(this.editing && !this.editing.id), (cx) => this.editView(null, cx)).tooltip("New view: pick which repos it shows")))
        .child(div().flex_1())
        .child(div().id("dash-refresh").h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).text_size(11).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Look again (r)").on_click((_e, cx) => this.look(this.range, cx))
          .child(this.looking?.[this.range] ? "Looking…" : "↻"))
        .child(closeButton(t, MOD)))
      .child(h_flex().flex_1().min_h(0)
        .child(this.renderSide(t))
        .child(div().flex_1().min_w(0).h_full().relative()
          .child(v_flex().id("dash-main").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).px(18).pt(14).pb(24)
            .child(this.editing ? this.renderEditor(t) : run ? this.renderRun(run, t) : this.renderRange(t)))
          .child(Scrollbar.vertical("dash-main").absolute().inset_0())))
      .child(h_flex().h(24).flex_none().px(12).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
        .child("1 2 3 or Tab: today / week / month · v next view · r look again · Esc back, then closes"));
    return windowFrame(this, root, t, MOD);
  }

  renderSide(t) {
    const head = (label) => div().px(10).pt(12).pb(4).text_size(10.5).font_semibold().text_color(t.muted).child(label);
    return v_flex().id("dash-side").w(260).flex_none().h_full().min_h(0).overflow_y_scroll().border_r(1).border_color(t.border).bg(t.chrome).pb(12)
      .child(head("PROMPTS"))
      .children(this.prompts.map((p) => v_flex().mx(6).mb(4).p(8).gap(4).rounded(8).border_1().border_color(t.border).bg(t.background)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(p.name))
          .child(div().id(`run-${p.id}`).h(22).px(8).flex().items_center().rounded(5).text_size(11)
            .when(this.running === p.id, (e) => e.text_color(t.accent).child("Running…"))
            .when(this.running !== p.id, (e) => e.bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.85))
              .on_click((_e, cx) => { cx.stop_propagation(); this.run(p, cx); }).child("▶ Run"))))
        .child(div().text_size(10.5).text_color(t.dim).child([RANGES.find(([r]) => r === p.range)?.[1] ?? p.range, p.auto ? `runs itself at ${p.auto}` : "", "merged PRs + tasks"].filter(Boolean).join(" · ")))
        .child(h_flex().child(div().id(`pv-${p.id}`).px(6).h(18).flex().items_center().rounded(9).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Which repos this prompt covers; click for the next view")
          .on_click((_e, cx) => { cx.stop_propagation(); this.cyclePromptView(p, cx); })
          .child(this.view(p.view)?.name ?? "All repos")))))
      .child(head(`RUNS · ${this.runs.length}`))
      .when(!this.runs.length, (e) => e.child(div().px(10).text_size(11).text_color(t.dim).child("None yet: ▶ Run a prompt.")))
      .children(this.runs.slice(0, 200).map((r) => v_flex().id(`r-${r.id}`).mx(6).px(8).py(5).gap(1).rounded(6).cursor_pointer()
        .bg(this.sel === r.id ? t.selected : t.chrome).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.sel = r.id; cx.notify(); })
        .child(div().text_size(11.5).text_color(t.foreground).child(when(r.at)))
        .child(div().text_size(10.5).text_color(r.error ? t.ansi3 : t.dim).truncate().child(`${r.name}${r.view ? ` · ${r.view}` : ""} · ${plural(r.prs.length, "PR")}${r.error ? " · no summary" : ""}`))));
  }

  // Merged PRs, tasks done and Linear issues for the chosen range, under its one-line summary.
  renderRange(t) {
    const a = this.shown(this.range), label = RANGES.find(([r]) => r === this.range)[1], v = this.view();
    const today = rangeStart("day").getTime(), mine = (r) => r.range === "day" && r.at >= today && r.summary;
    const latest = this.range === "day" ? this.runs.find((r) => mine(r) && (r.view ?? null) === (v?.name ?? null)) ?? (v ? null : this.runs.find(mine)) : null;
    if (!a) return div().text_size(12).text_color(t.dim).child(this.looking?.[this.range] ? "Looking at GitHub and the board…" : "Nothing yet.");
    const l = lines(a.prs);
    // Every tile has the same three lines (an empty note keeps its line), so the row lines up.
    const tile = (label, value, note = "") => v_flex().flex_1().min_w(120).p(10).gap(2).rounded(8).border_1().border_color(t.border).bg(t.chrome)
      .child(div().text_size(10.5).text_color(t.dim).child(label)).child(div().text_size(20).font_semibold().truncate().child(value))
      .child(div().text_size(10.5).text_color(t.muted).truncate().child(note || "\u00a0"));
    const spaces = new Set(a.tasks.map((x) => x.space).filter(Boolean));
    return v_flex().gap(4)
      .child(div().text_size(10.5).text_color(t.dim).child(`${label}, since ${ymd(new Date(a.from))}${v ? ` · ${v.name}: ${v.repos.join(", ")}` : ""} · looked ${hm(a.at)}`))
      .child(div().pb(6).text_size(14).child(sentence(a, label === "Today" ? "Today" : label)))
      .when(Boolean(a.error), (e) => e.child(div().text_size(11.5).text_color(t.ansi3).child(a.error)))
      .child(h_flex().gap(8).flex_wrap()
        .child(tile("PRs merged", String(a.prs.length), repos(a.prs).join(", ")))
        .child(tile("Lines", `+${num(l.add)} −${num(l.del)}`, `${num(a.prs.reduce((n, p) => n + (p.files ?? 0), 0))} files`))
        .child(tile("Tasks done", String(a.tasks.length), spaces.size ? `in ${[...spaces].slice(0, 3).join(", ")}${spaces.size > 3 ? ` +${spaces.size - 3}` : ""}` : ""))
        .child(tile("Linear issues", String(a.linear.length), a.linear.slice(0, 3).join(", "))))
      .when(Boolean(latest), (e) => e.child(this.section(`Summary · ${latest.name} · ${hm(latest.at)}`, t))
        .child(div().p(10).rounded(8).border_1().border_color(t.border).bg(t.chrome).child(TextView.markdown("dash-today-md", latest.summary).selectable(true))))
      .child(this.section(`Merged PRs · ${a.prs.length}`, t))
      .child(this.prList(a.prs, t, "rg"))
      .child(this.section(`Tasks done · ${a.tasks.length}`, t))
      .when(!a.tasks.length, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("None in this range.")))
      .children(a.tasks.map((x) => h_flex().h(26).gap(8).items_center().text_size(12)
        .child(div().text_color(t.accent).child("✓")).child(div().flex_1().min_w(0).truncate().child(x.title || "Untitled"))
        .child(div().text_size(10.5).text_color(t.dim).child([x.space, when(x.doneAt)].filter(Boolean).join(" · ")))))
      .child(this.section(`Linear issues · ${a.linear.length}`, t))
      .child(div().pb(2).text_size(10.5).text_color(t.dim).child("Ids found in the merged PRs (titles, branches, descriptions) and done tasks. Click opens one in Linear, right-click copies it."))
      .child(h_flex().gap(6).flex_wrap().children(a.linear.map((id) => this.linearChip(id, t))));
  }

  renderRun(r, t) {
    return v_flex().gap(4)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(15).font_semibold().child(r.name))
        .child(div().flex_1())
        .child(div().id("run-del").h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).text_size(11).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.ansi1)).on_click((_e, cx) => cx.spawn(async (cx) => { await removeRun(r); this.runs = await loadRuns(); this.sel = null; cx.notify(); }))
          .child("Delete run")))
      .child(div().text_size(11).text_color(t.dim).child(`${when(r.at)}${r.view ? ` · ${r.view}` : ""} · ${RANGES.find(([x]) => x === r.range)?.[1] ?? r.range} since ${ymd(new Date(r.from))} · took ${Math.round((r.ms ?? 0) / 1000)} s`))
      .when(Boolean(r.error), (e) => e.child(div().pt(4).text_size(11.5).text_color(t.ansi3).child(r.error)))
      .when(Boolean(r.summary), (e) => e.child(div().mt(8).p(12).rounded(8).border_1().border_color(t.border).bg(t.chrome)
        .child(TextView.markdown(`dash-run-${r.id}`, r.summary).selectable(true))))
      .child(this.section(`Merged PRs · ${r.prs.length}`, t))
      .child(this.prList(r.prs, t, r.id))
      .when(r.linear?.length > 0, (e) => e.child(this.section(`Linear issues · ${r.linear.length}`, t))
        .child(h_flex().gap(6).flex_wrap().children(r.linear.map((id) => this.linearChip(id, t)))));
  }

  // A view's name and the repos it shows: a whole owner (org or user) or single repos, from what the dashboard has seen.
  renderEditor(t) {
    const e = this.editing, known = knownRepos(this.act, this.view(e.id));
    const box = (id, on, label, note, act) => h_flex().id(id).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => act(cx))
      .child(div().w(14).h(14).flex().items_center().justify_center().rounded(3).border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent : t.background)
        .text_size(10).text_color(t.solid_foreground).child(on ? "✓" : ""))
      .child(div().text_size(12.5).child(label))
      .when(Boolean(note), (x) => x.child(div().text_size(10.5).text_color(t.dim).child(note)));
    const btn = (id, label, act, solid = false) => div().id(id).h(26).px(12).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .when(solid, (x) => x.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.85)))
      .when(!solid, (x) => x.border_1().border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => act(cx)).child(label);
    return v_flex().gap(4).max_w(640)
      .child(div().text_size(15).font_semibold().child(e.id ? "Edit view" : "New view"))
      .child(div().text_size(11).text_color(t.dim).child("A view shows only the PRs, tasks and Linear issues of the repos you tick. Tasks count by their folder's repo."))
      .child(div().mt(10).h(30).px(8).flex().items_center().rounded(6).border_1().border_color(this.typing ? t.accent : t.border).bg(t.chrome)
        .child(Input.new(this.name).h_full().text_size(13).text_color(t.foreground)))
      .child(this.section("Repos", t))
      .when(!known.length, (x) => x.child(div().text_size(11.5).text_color(t.dim).child("No repos seen yet: look at This month first (3), then come back.")))
      .children(known.map(({ owner, repos }) => {
        const all = e.repos.has(`${owner}/*`);
        return v_flex().mb(6)
          .child(box(`own-${owner}`, all, `${owner}/*`, "everything under this owner, new repos included", (cx) => this.toggleRepo(`${owner}/*`, cx)))
          .child(v_flex().pl(22).children(repos.map((n) => box(`rp-${owner}/${n}`, all || e.repos.has(`${owner}/${n}`), n, all ? "in the owner" : "",
            (cx) => { if (!all) this.toggleRepo(`${owner}/${n}`, cx); }))));
      }))
      .child(h_flex().mt(14).gap(8)
        .child(btn("v-save", "Save view", (cx) => this.saveView(cx), true))
        .child(btn("v-cancel", "Cancel", (cx) => { this.editing = null; this.handle.focus(); cx.notify(); }))
        .child(div().flex_1())
        .when(Boolean(e.id), (x) => x.child(btn("v-del", "Delete view", (cx) => this.deleteView(cx)))));
  }

  section(label, t) {
    return h_flex().mt(16).mb(6).gap(8).items_center()
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(label)).child(div().flex_1().h(1).bg(t.border));
  }
  linearChip(id, t) {
    return div().id(`lin-${id}`).px(7).h(22).flex().items_center().rounded(11).border_1().border_color(t.border).text_size(11).text_color(t.foreground)
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(linearUrl(id) ? "Open in Linear (right-click copies)" : "Copy (set your Linear workspace in Settings to open it)")
      .on_click((_e, cx) => openLinear(id, null, cx)).on_mouse_down("right", (_e, cx) => copyLinear(id, cx))
      .child(linearUrl(id) ? `${id} ↗` : id);
  }
  prList(prs, t, idp) {
    if (!prs.length) return div().text_size(11.5).text_color(t.dim).child("None in this range.");
    return v_flex().gap(6).children(prs.map((p) => v_flex().id(`${idp}-pr-${p.url}`).p(9).gap(3).rounded(8).border_1().border_color(t.border).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip("Open on GitHub").on_click(() => exec("open", [p.url]).catch(() => null))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(p.title))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(hm(p.mergedAt))))
      .child(h_flex().gap(8).items_center().text_size(10.5).text_color(t.dim)
        .child(div().child(`${p.repo.split("/").pop()} #${p.number}`))
        .when(p.additions != null, (e) => e.child(div().text_color(t.ansi2).child(`+${num(p.additions)}`)).child(div().text_color(t.ansi1).child(`−${num(p.deletions)}`)))
        .when(p.files != null, (e) => e.child(div().child(plural(p.files, "file"))))
        .when(Boolean(p.branch), (e) => e.child(div().min_w(0).truncate().child(p.branch)))
        .child(div().flex_1())
        .children((p.linear ?? []).map((id) => div().px(5).rounded(5).border_1().border_color(t.border).text_color(t.muted).child(id))))));
  }
}
