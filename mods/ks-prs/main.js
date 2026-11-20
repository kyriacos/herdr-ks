// Open pull requests of the worktrees in scope, picked in the header (s cycles):
//   - Agent: the worktrees the focused agent (else the last one focused here) went into or edited this session;
//     ks-changes' agent_where.py reads its session log, as an agent launched in ~/code/acme often works in
//     ~/code/acme-worktrees/search-filters;
//   - Tab: every agent's in the shown tab, and its other terminals' folders;
//   - Space: every agent's in the shown space, and what the Changes panel shows (shared "ks.session").
// With nothing found, the focused terminal's repo. In Tab and Space each PR names the agents it came from. Each PR: title, branch -> base, draft and review state, CI checks, size; Review opens its diff
// against its base in ks-review, Open shows it on GitHub. Uses `gh` (GitHub CLI, logged in).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, ScrollHandle } from "gpui-base";
import { spaces, panes, agents, focused, exec, hc, shared, theme, run, notify, appHome } from "herdr";
import * as cache from "./lib/cache.js";
import { summarize, runningColor, pillColors } from "./lib/ci.js";
import { dimmed } from "./lib/focus.js";
import { segment } from "./lib/segment.js";
import { takeFocus, listKey, watchFocus, focusedNow, toStrip } from "./lib/panelkeys.js";
import { isWindow, initWindow, windowCommand, zoomCommand, zoomKey, windowFrame, headerButton } from "./lib/panelwin.js";

const FIELDS = "number,title,state,url,baseRefName,headRefName,isDraft,reviewDecision,additions,deletions,changedFiles,statusCheckRollup,author";
const base = (p) => p.replace(/\/+$/, "").split("/").pop();

// gh gets 20 s: a stuck call (network gone after sleep) must not hold up the next look.
async function gh(args, cwd) {
  const o = { cwd, timeout: 20000 };
  let r = await exec("gh", args, o).catch(() => null);
  if (!r || (r.code !== 0 && /not found|No such file/i.test(r.stderr ?? ""))) r = await exec("/opt/homebrew/bin/gh", args, o).catch(() => null);
  return r;
}

// CI from statusCheckRollup: { pass, fail, pending } (lib/ci.js decides what counts as failed).
function checks(rollup) {
  const { counts } = summarize(rollup);
  return { pass: counts.pass, fail: counts.fail, pending: counts.running };
}

// The worktrees an agent went into or edited this session, most recent first; looked up in the background,
// again when older than 20 s. `then` runs when the list changes.
const touched = new Map(); // terminal address -> { at, busy, dirs }
function agentDirs(a, cx, then) {
  const c = touched.get(a.address);
  if (!c || (!c.busy && Date.now() - c.at > 20000)) {
    touched.set(a.address, { at: c?.at ?? 0, busy: true, dirs: c?.dirs ?? [] });
    cx.spawn(async (cx) => {
      let dirs = c?.dirs ?? [];
      try {
        const pid = JSON.parse((await hc(["get", a.address])).stdout)?.foreground?.pid;
        if (pid) {
          const args = ["-I", `${appHome()}/mods/ks-changes/agent_where.py`, String(pid)];
          // Herdr's own PATH may not have Homebrew's python3: fall back to macOS's.
          let w = await exec("python3", args).catch(() => null);
          if (!w || w.code !== 0) w = await exec("/usr/bin/python3", args).catch(() => null);
          if (w?.code === 0) { const o = JSON.parse(w.stdout); dirs = o.touched ?? o.roots ?? []; }
        }
      } catch {}
      const changed = JSON.stringify(dirs) !== JSON.stringify(c?.dirs ?? []);
      touched.set(a.address, { at: Date.now(), busy: false, dirs });
      if (changed) then(cx);
    });
  }
  return touched.get(a.address).dirs;
}

// The worktrees in scope: [{ root, on, from: [agent names] }], the most relevant first.
const SCOPES = [["agent", "Agent"], ["tab", "Tab"], ["space", "Space"]];
const clean = (s) => String(s ?? "").replace(/^[\s✳⠂⠐*·]+|[\s✳⠂⠐*·…]+$/g, "");
function sessionRoots(view, cx, then) {
  const space = spaces().find((s) => s.active), f = focused(), all = agents().filter((a) => a.space === space?.id);
  const tab = f?.tab ?? all[0]?.tab;
  const mine = all.find((a) => a.address === f?.terminal);
  if (mine) view.lastAgent = mine.address;
  const out = new Map();
  const add = (root, from) => { const r = out.get(root) ?? { root, on: null, from: [] }; if (from && !r.from.includes(from)) r.from.push(from); out.set(root, r); };
  const name = (a) => (view.scope === "space" && a.tab !== tab ? `${a.tab_name} · ` : "") + (clean(a.title) || a.address);
  let shown;
  if (view.scope === "agent") {
    const a = mine ?? all.find((x) => x.address === view.lastAgent) ?? all.find((x) => x.tab === tab);
    shown = a ? [a] : [];
  } else shown = all.filter((a) => view.scope === "space" || a.tab === tab)
    .sort((a, b) => (b.address === f?.terminal) - (a.address === f?.terminal) || (b.tab === tab) - (a.tab === tab));
  for (const a of shown) {
    const dirs = agentDirs(a, cx, then);
    if (dirs.length) for (const root of dirs) add(root, name(a));
    else { const p = panes().find((x) => x.pane === a.pane); if (p?.cwd) add(p.cwd, name(a)); }
  }
  if (view.scope === "tab") for (const p of panes()) if (p.tab === tab && p.terminal && p.cwd && !p.status) add(p.cwd, null);
  if (view.scope === "space") for (const r of (space ? shared("ks.session")?.[space.id] : null) ?? []) if (!r.on) add(r.root, null);
  if (out.size) return [...out.values()];
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const cwd = pane?.cwd || f?.cwd || space?.folder;
  return cwd ? [{ root: cwd, on: null, from: [] }] : [];
}

const loadScope = () => { try { const v = localStorage.getItem("ks-prs.scope"); return SCOPES.some(([k]) => k === v) ? v : "tab"; } catch { return "tab"; } };

export default class Prs extends View {
  init(_props, cx) {
    this.prs = []; this.without = []; this.loading = false; this.error = null; this.key = null;
    this.scope = loadScope(); this.lastAgent = null;
    // Vim keys (lib/panelkeys.js): j/k, gg/G, Enter/o review, g o / O on GitHub, r refresh, h/l/Esc leave.
    this.handle = cx.focus_handle(); this.scroll = ScrollHandle.new(); this.cursor = 0; this.pageRows = 4;
    // In its own window (lib/panelwin.js), or the panel; z / the zoom keys go between the two.
    if (isWindow()) initWindow(this, cx, "ks-prs");
    else { takeFocus(this, cx, "ks-prs", (c) => zoomCommand(this, c, "ks-prs")); watchFocus(this, cx, "ks-prs"); }
    this.doneAt = 0; this.startedAt = 0;
    this.refresh(cx);
    // GitHub once a minute, every 20 s while a PR's checks are running, 30 s after a failed look; a 10 s tick asks
    // whether one is due, so a look also happens at once after the Mac wakes.
    cx.timer.every(10000, (cx) => {
      if (this.loading && Date.now() - this.startedAt > 60000) this.loading = false; // a look that never came back
      const due = this.error ? 30000 : this.prs.some((p) => p.checks?.pending) ? 20000 : 60000;
      if (!this.loading && Date.now() - this.doneAt >= due) this.refresh(cx, true);
    });
  }

  refresh(cx, force = false) {
    const roots = sessionRoots(this, cx, (cx) => this.refresh(cx)), key = JSON.stringify([this.scope, roots.map((r) => [r.root, r.from])]);
    if (this.loading || (!force && key === this.key)) return;
    this.key = key; this.loading = true; this.startedAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        // Stale while revalidate: the last list for these worktrees at once, then a fresh one.
        const hit = await cache.get(`prs:${key}`);
        if (hit?.value && this.key === key) { this.prs = hit.value.prs ?? []; this.without = hit.value.without ?? []; cx.notify(); }
        const prs = [], without = [], seen = new Map();
        let error = null;
        for (const { root, from } of roots) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root }).catch(() => null);
          if (!top || top.code !== 0) continue;
          const dir = top.stdout.trim();
          const br = await exec("git", ["branch", "--show-current"], { cwd: dir }).catch(() => null);
          const branch = br?.code === 0 ? br.stdout.trim() : "";
          if (!branch) { without.push({ root: dir, branch: "detached" }); continue; }
          const r = await gh(["pr", "view", branch, "--json", FIELDS], dir);
          if (!r) { error = "Couldn't run gh (GitHub CLI)"; break; }
          if (r.code !== 0) {
            if (/auth|login/i.test(r.stderr ?? "")) { error = "gh isn't logged in: run `gh auth login`"; break; }
            without.push({ root: dir, branch }); continue;
          }
          try {
            const pr = JSON.parse(r.stdout);
            const had = seen.get(pr.url);
            if (had) { for (const n of from) if (!had.from.includes(n)) had.from.push(n); continue; }
            // A merged or closed PR's worktree is an old one the agent passed through: left out.
            if (pr.state !== "OPEN") continue;
            const repo = (await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir })).stdout.trim().replace(/\/\.git$/, "");
            const item = { ...pr, root: dir, repo: base(repo), checks: checks(pr.statusCheckRollup), from: [...from] };
            seen.set(pr.url, item); prs.push(item);
          } catch { without.push({ root: dir, branch }); }
        }
        if (this.key === key) { this.prs = prs; this.without = without; this.error = error; }
        if (!error) cache.set(`prs:${key}`, { prs, without });
      } finally { this.loading = false; this.doneAt = Date.now(); cx.notify(); }
    });
  }

  setScope(k, cx) {
    if (this.scope === k) return;
    this.scope = k; this.cursor = 0;
    try { localStorage.setItem("ks-prs.scope", k); } catch {}
    this.refresh(cx); cx.notify();
  }

  review(list) {
    if (!list.length) return;
    const space = spaces().find((s) => s.active)?.id;
    const bases = Object.fromEntries(list.map((p) => [p.root, `origin/${p.baseRefName}`]));
    run("tab.new", { name: list.length === 1 ? `PR #${list[0].number}` : `${list.length} PRs`, mod: "ks-review",
      props: { scope: "branch", roots: list.map((p) => p.root), bases, space } });
  }

  async openUrl(url) {
    const r = await exec("open", [url]).catch(() => null);
    if (!r || r.code !== 0) notify({ title: "Couldn't open the browser", body: url, level: "warning", timeout: 4000 });
  }

  card(pr, t) {
    const badge = (label, color) => { const c = pillColors(color, t);
      return div().flex_none().px(6).py(1).rounded(8).border_1().border_color(c.border).when(Boolean(c.bg), (e) => e.bg(c.bg)).text_size(10).text_color(c.text).child(label); };
    const review = { APPROVED: ["approved", t.ansi2], CHANGES_REQUESTED: ["changes requested", t.ansi1], REVIEW_REQUIRED: ["review required", t.muted] }[pr.reviewDecision];
    const c = pr.checks, ci = c.fail ? [`${c.fail} failing`, t.ansi1] : c.pending ? [`${c.pending} running`, runningColor(t)] : c.pass ? ["checks pass", t.ansi2] : null;
    const button = (id, label, act, primary) => div().id(id).flex_none().h(24).px(9).flex().items_center().rounded(6).cursor_pointer().text_size(11)
      .bg(primary ? t.solid : t.background).text_color(primary ? t.solid_foreground : t.foreground).border_1().border_color(primary ? t.solid : t.border)
      .hover((s) => s.opacity(0.85)).on_click(act).child(label);
    const at = focusedNow(this, "ks-prs") && this.prs[this.cursor] === pr;
    return v_flex().id(`pr-${pr.url}`).flex_none().mx(8).mt(8).p(10).gap(5).rounded(8).border_1().border_color(at ? t.accent : t.border).bg(t.background)
      .child(h_flex().gap(6).items_start()
        .child(div().flex_none().text_size(12).text_color(t.dim).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).text_size(12.5).font_semibold().child(pr.title)))
      .child(div().text_size(11).text_color(t.dim).truncate().child(`${pr.repo} · ${pr.headRefName} → ${pr.baseRefName} · ${base(pr.root)}`))
      .when(this.scope !== "agent" && pr.from?.length > 0, (e) => e.child(div().text_size(11).text_color(t.muted).truncate().child(`◆ ${pr.from.join(", ")}`)))
      .child(h_flex().gap(5).items_center().flex_wrap()
        .child(pr.isDraft ? badge("draft", t.muted) : badge("open", t.ansi2))
        .when(Boolean(review), (e) => e.child(badge(review[0], review[1])))
        .when(Boolean(ci), (e) => e.child(badge(ci[0], ci[1])))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.ansi2).child(`+${pr.additions}`))
        .child(div().text_size(11).text_color(t.ansi1).child(`−${pr.deletions}`))
        .child(div().text_size(11).text_color(t.dim).child(`${pr.changedFiles} files`)))
      .child(h_flex().gap(6).justify_end()
        .child(button(`open-${pr.url}`, "Open on GitHub", () => this.openUrl(pr.url)))
        .child(button(`review-${pr.url}`, "Review", () => this.review([pr]), true)));
  }

  // ks: focus mode dims this until hovered (lib/focus.js).
  render(cx) { return this.windowed ? windowFrame(this, this.renderInner(cx), theme(), "ks-prs") : dimmed(this, this.renderInner(cx)); }

  renderInner(cx) {
    this.refresh(cx); // follows the session's worktrees as they change
    const t = theme();
    return v_flex().id("prs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(focusedNow(this, "ks-prs") ? t.accent : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const before = this.cursor, prs = this.prs;
        if (toStrip(e)) { cx.stop_propagation(); return; } // a key strip opening: its key, not this panel's
        if (zoomKey(this, e, "ks-prs")) { cx.stop_propagation(); return; }
        if (!listKey(this, e, prs.length, (i) => this.review([prs[i]]), (k) => {
          if (k === "r") { this.refresh(cx, true); return true; }
          if (k === "s") { const i = SCOPES.findIndex(([x]) => x === this.scope); this.setScope(SCOPES[(i + 1) % SCOPES.length][0], cx); return true; }
          if (k === "O" && prs[this.cursor]) { this.openUrl(prs[this.cursor].url); return true; }
          if (k === "R" && prs.length) { this.review(prs); return true; }
          return false;
        })) return;
        if (this.cursor !== before) this.scroll.scroll_to_item(this.cursor + (this.error ? 1 : 0));
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.prs.length} open`))
        .child(h_flex().gap(2).tooltip("Whose worktrees: the agent's, the tab's or the space's (s)")
          .children(SCOPES.map(([k, label]) => segment(t, `prs-scope-${k}`, label, this.scope === k, (cx) => this.setScope(k, cx)))))
        .child(div().flex_1())
        .child(div().id("prs-refresh").h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).text_size(11).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx, true)).child(this.loading ? (this.prs.length ? "Updating…" : "…") : "Refresh"))
        .when(this.prs.length > 1, (e) => e.child(div().id("prs-review-all").h(24).px(8).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground)
          .text_size(11).cursor_pointer().on_click(() => this.review(this.prs)).child("Review all")))
        .child(headerButton(this, t, "ks-prs")))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("prs-list").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).pb(10)
          .when(Boolean(this.error), (e) => e.child(div().p(12).text_size(12).text_color(t.ansi1).child(this.error)))
          .when(!this.error && this.loading && !this.prs.length, (e) => e.child(div().p(12).text_size(12).text_color(t.dim).child("Looking for pull requests…")))
          .when(!this.error && !this.loading && !this.prs.length, (e) => e.child(div().p(12).text_size(12).text_color(t.dim).child(`No open pull requests in ${{ agent: "this agent's", tab: "this tab's", space: "this space's" }[this.scope]} worktrees`)))
          .children(this.prs.map((pr) => this.card(pr, t)))
          .when(this.without.length > 0, (e) => e.child(v_flex().mx(8).mt(12).gap(2)
            .child(div().text_size(11).font_semibold().text_color(t.muted).child(`Worktrees without an open PR · ${this.without.length}`))
            .children(this.without.map((w) => div().text_size(11).text_color(t.dim).truncate()
              .child(`${base(w.root)} · ${w.branch}${w.closed ? ` · #${w.number} ${w.closed}` : ""}`))))))
        .child(Scrollbar.vertical("prs-list").absolute().inset_0()));
  }
}
