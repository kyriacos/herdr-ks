// "My PRs" at the top of the sidebar: every open pull request you authored on GitHub (`gh`, logged in), with
// where each one stands: CI (passing / failing / running), review (approved / changes requested / waiting) and
// merge (ready / blocked / conflicts / behind). Ones that need you come first. Click a row to open it on GitHub.
// The header folds the section to one line (the block shrinks); × hides it; cmd-shift-m shows / hides it
// (layout.toggle my-prs). A toast when a PR's CI turns red or green, or a review lands. Refreshes every minute,
// every 20 s while a PR's CI is running, 30 s after a failed look, and at once after the Mac wakes (see `due`).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, ScrollHandle } from "gpui-base";
import { exec, theme, run, notify, openOverlay } from "herdr";
import * as cache from "./lib/cache.js";
import { summarize, runningColor, pillColors } from "./lib/ci.js";
import { fetchPr, prKey } from "./lib/github.js";
import { dimmed } from "./lib/focus.js";
import { pref } from "./lib/prefs.js";
import { takeFocus, listKey, watchFocus, focusedNow } from "./lib/panelkeys.js";
import { sectionHead, sectionFrame, badge, headAction, SECTION_HEAD } from "./lib/section.js";

const BLOCK = "my-prs", HEAD = SECTION_HEAD + 1, ROW = 50, DRAFTS = 14;
const QUERY = `query { search(query: "is:pr is:open author:@me archived:false", type: ISSUE, first: 40) { nodes { ... on PullRequest {
  number title url isDraft repository { nameWithOwner } headRefName baseRefName reviewDecision mergeStateStatus updatedAt
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 80) { nodes {
    ... on CheckRun { status conclusion } ... on StatusContext { state } } } } } } } } } } }`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// gh gets 20 s: a stuck call (network gone after sleep) must not hold up the next look.
async function gh(args) {
  const o = { timeout: 20000 };
  let r = await exec("gh", args, o).catch(() => null);
  if (!r || (r.code !== 0 && /not found|No such file/i.test(r.stderr ?? ""))) r = await exec("/opt/homebrew/bin/gh", args, o).catch(() => null);
  return r;
}
const ago = (ms) => (ms < 90000 ? "" : ms < 3600000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 3600000)}h`);

// What needs you first; drafts at the bottom.
const byNeed = (a, b) => Number(Boolean(a.isDraft)) - Number(Boolean(b.isDraft)) || a.s.urgent - b.s.urgent || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
const since = (iso) => { const m = (Date.now() - Date.parse(iso ?? "")) / 60000; return !(m >= 0) ? "" : m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

// One PR's state: ci "pass" | "fail" | "running" | "none" (+ counts), review, merge, and how urgent it is.
function stateOf(pr) {
  // Each check decides (lib/ci.js), not the rollup's own state: GitHub can count a cancelled run as a failure.
  const roll = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const { ci, counts } = roll ? summarize(roll.contexts?.nodes) : { ci: "none", counts: { pass: 0, fail: 0, running: 0 } };
  const review = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "waiting" }[pr.reviewDecision] ?? "none";
  const merge = { CLEAN: "ready", HAS_HOOKS: "ready", BLOCKED: "blocked", BEHIND: "behind", DIRTY: "conflicts", UNSTABLE: "unstable", DRAFT: "draft" }[pr.mergeStateStatus] ?? "checking";
  // Blocked with no approval yet: what it waits for is a review.
  // Unstable is GitHub's word for checks not passing yet: while they run, that's waiting on CI, not a problem.
  const mergeShown = merge === "blocked" && (review === "none" || review === "waiting") ? "approval"
    : merge === "unstable" && ci === "running" ? "waitci" : merge;
  const urgent = ci === "fail" || review === "changes" || merge === "conflicts" ? 0 : ci === "running" ? 1 : merge === "ready" && !pr.isDraft ? 2 : 3;
  return { ci, counts, review, merge: mergeShown, urgent };
}

export default class MyPrs extends View {
  init(_props, cx) {
    this.prs = []; this.error = null; this.loading = false; this.loaded = false; this.last = {};
    this.collapsed = load("collapsed", false);
    // Vim keys (lib/panelkeys.js): j/k, gg/G, Enter/o opens the PR, r refresh, h/l/Esc leave.
    this.handle = cx.focus_handle(); this.scroll = ScrollHandle.new(); this.cursor = 0; this.pageRows = 6;
    takeFocus(this, cx, "ks-myprs"); watchFocus(this, cx, "ks-myprs");
    // Stale while revalidate: the last list at once (no toasts for it), then a fresh one.
    cx.spawn(async (cx) => {
      const hit = await cache.get("myprs");
      if (hit?.value && !this.loaded) {
        this.prs = hit.value.map((pr) => ({ ...pr, s: stateOf(pr) })).sort(byNeed);
        this.last = Object.fromEntries(this.prs.map((pr) => [pr.url, { ci: pr.s.ci, review: pr.s.review }]));
        this.cached = true; this.fit(); cx.notify();
      }
    });
    this.doneAt = 0; this.startedAt = 0;
    this.refresh(cx);
    // A tick every 10 s asks whether a look is due, rather than one timer a minute: the pace follows CI, and a tick
    // after the Mac slept finds the last look long ago and looks at once. It also keeps the "3m" age current.
    cx.timer.every(10000, (cx) => {
      if (this.loading && Date.now() - this.startedAt > 45000) this.loading = false; // a look that never came back
      if (!this.loading && Date.now() - this.doneAt >= this.due()) this.refresh(cx);
      else cx.notify();
    });
  }

  // How long after the last look the next one is due.
  due() {
    if (this.error) return 30000;
    return this.prs.some((p) => p.s.ci === "running") ? 20000 : 60000;
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true; this.startedAt = Date.now(); cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await gh(["api", "graphql", "-f", `query=${QUERY}`]);
        if (!r) this.error = "Couldn't run gh (GitHub CLI)";
        else if (r.code !== 0) this.error = /auth|login/i.test(r.stderr ?? "") ? "gh isn't logged in: run `gh auth login`" : (r.stderr || "gh failed").trim().split("\n")[0];
        else {
          try {
            const nodes = JSON.parse(r.stdout).data.search.nodes.filter((n) => n?.url);
            const prs = nodes.map((pr) => ({ ...pr, s: stateOf(pr) }))
              .sort(byNeed);
            if (this.cached && !this.loaded) this.loaded = true; // the cached list counts as the first look for toasts
            this.announce(prs);
            this.prs = prs; this.error = null; this.loaded = true;
            cache.set("myprs", nodes);
            this.prefetch(prs);
          } catch (e) { this.error = "Couldn't read GitHub's answer"; }
        }
      } finally { this.loading = false; this.doneAt = Date.now(); this.fit(); cx.notify(); }
    });
  }

  // Each PR's details into the cache in the background, so its window opens at once (only stale ones).
  prefetch(prs) {
    if (this.prefetching) return;
    this.prefetching = true;
    (async () => {
      for (const pr of prs) {
        const hit = await cache.get(prKey(pr.url));
        if (cache.age(hit) < 120000) continue;
        const got = await fetchPr(pr.repository.nameWithOwner, pr.number);
        if (got.pr) await cache.set(prKey(pr.url), { pr: got.pr, places: hit?.value?.places ?? null });
      }
    })().finally(() => { this.prefetching = false; });
  }

  // Toasts for what changed since the last look (not on the first one).
  announce(prs) {
    const was = this.last, now = {};
    for (const pr of prs) {
      const name = `${pr.repository.nameWithOwner.split("/").pop()}#${pr.number}`, before = was[pr.url];
      now[pr.url] = { ci: pr.s.ci, review: pr.s.review };
      if (!this.loaded || !before || !pref("prToasts")) continue; // toasts can be off (settings)
      if (before.ci !== "fail" && pr.s.ci === "fail") notify({ title: `CI failing · ${name}`, body: pr.title, level: "error", timeout: 6000 });
      else if (before.ci !== "pass" && pr.s.ci === "pass") notify({ title: `CI passing · ${name}`, body: pr.title, level: "success", timeout: 4000 });
      if (before.review !== "approved" && pr.s.review === "approved") notify({ title: `Approved · ${name}`, body: pr.title, level: "success", timeout: 5000 });
      if (before.review !== "changes" && pr.s.review === "changes") notify({ title: `Changes requested · ${name}`, body: pr.title, level: "warning", timeout: 6000 });
    }
    if (this.loaded && pref("prToasts")) for (const url of Object.keys(was)) if (!now[url]) notify({ title: "PR merged or closed", body: url.replace("https://github.com/", ""), level: "info", timeout: 4000 });
    this.last = now;
  }

  // The block's height: one line folded, else the rows (up to a few, then it scrolls).
  fit() {
    const shown = Math.min(this.prs.length, 6), drafts = this.prs.slice(1, shown).some((p, i) => p.isDraft && !this.prs[i].isDraft);
    const px = this.collapsed ? HEAD : HEAD + 8 + Math.max(1, shown) * ROW + (drafts ? DRAFTS : 0);
    if (px !== this.px) { this.px = px; run("layout.resize", { id: BLOCK, px }); }
  }
  toggle(cx) { this.collapsed = !this.collapsed; save("collapsed", this.collapsed); this.fit(); cx.notify(); }

  async openUrl(url) {
    const r = await exec("open", [url]).catch(() => null);
    if (!r || r.code !== 0) notify({ title: "Couldn't open the browser", body: url, level: "warning", timeout: 4000 });
  }

  // The PR in a floating window (ks-prcard): details, its worktree / space / agent, a message to the agent.
  openCard(pr) {
    const key = `ks-prcard:${pr.url}`;
    openOverlay({ mod: "ks-prcard", kind: "window", key, width: 560, height: 640,
      props: { url: pr.url, repo: pr.repository.nameWithOwner, number: pr.number, windowKey: key } });
  }

  // A row: a dot for how much it needs you, repo#number, the title and how long since it moved, then its states as
  // badges. Drafts sort last, under a "Drafts" line.
  row(pr, t) {
    const i = this.prs.indexOf(pr), firstDraft = pr.isDraft && i > 0 && !this.prs[i - 1]?.isDraft;
    return v_flex().flex_none().h(ROW + (firstDraft ? DRAFTS : 0))
      .when(firstDraft, (e) => e.child(h_flex().h(DRAFTS).mx(14).gap(6).items_center()
        .child(div().flex_none().text_size(9.5).text_color(t.dim).child(`Drafts · ${this.prs.length - i}`))
        .child(div().flex_1().h(1).bg(t.border + "80"))))
      .when(!firstDraft && i > 0, (e) => e.child(div().h(1).mx(14).bg(t.border + "59")))
      .when(!firstDraft && i === 0, (e) => e.child(div().h(1)))
      .child(this.card(pr, t));
  }

  // Its states as badges: checks, review, merge, each with words; what's wrong in red (stronger), what's waiting
  // in amber, what's fine in green, nothing-yet quiet.
  marks(pr, t) {
    const s = pr.s, run = runningColor(t);
    const ci = { fail: [`✕ ${s.counts.fail} failing`, t.ansi1, true], running: [`◌ ${s.counts.running} running`, run], pass: ["✓ CI", t.ansi2], none: ["no CI", t.dim] }[s.ci];
    const review = { approved: ["✓ approved", t.ansi2], changes: ["✕ changes", t.ansi1, true], waiting: ["in review", t.muted], none: ["no review", t.dim] }[s.review];
    const merge = pr.isDraft ? ["draft", t.dim] : { ready: ["ready", t.ansi2], conflicts: ["✕ conflicts", t.ansi1, true], behind: ["↓ behind", run], unstable: ["✕ unstable", t.ansi1, true],
      approval: ["needs approval", t.muted], blocked: ["blocked", t.muted], waitci: ["waiting on CI", run], checking: null }[s.merge];
    return [ci, review, merge].filter(Boolean);
  }

  card(pr, t) {
    const s = pr.s, repo = pr.repository.nameWithOwner.split("/").pop();
    const dot = pr.isDraft ? t.dim : s.urgent === 0 ? t.ansi1 : s.urgent === 1 ? runningColor(t) : s.urgent === 2 ? t.ansi2 : t.dim;
    const on = focusedNow(this, "ks-myprs") && this.prs[this.cursor] === pr;
    return h_flex().id(`mypr-${pr.url}`).flex_none().h(ROW - 2).mx(6).px(8).gap(9).items_center().rounded(8).cursor_pointer()
      .when(on, (e) => e.bg(t.selected ?? t.hover)).hover((st) => st.bg(t.hover)).on_click(() => this.openCard(pr))
      .child(div().flex_none().size(7).rounded(4).when(pr.isDraft, (e) => e.border_1().border_color(t.dim)).when(!pr.isDraft, (e) => e.bg(dot)))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_none().text_size(11).text_color(t.dim).child(`${repo}#${pr.number}`))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(pr.isDraft ? t.muted : t.foreground).child(pr.title))
          .child(div().flex_none().text_size(10).text_color(t.dim).child(since(pr.updatedAt))))
        .child(h_flex().gap(4).items_center().text_size(10.5).text_color(t.muted).overflow_hidden()
          .children(this.marks(pr, t).map(([label, tone, strong]) => badge(t, label, tone, strong)))));
  }

  // ks: focus mode dims this until hovered (lib/focus.js).
  render(cx) { return dimmed(this, this.renderInner(cx)); }

  renderInner(cx) {
    const t = theme(), prs = this.prs;
    const fail = prs.filter((p) => p.s.ci === "fail" || p.s.review === "changes" || p.s.merge === "conflicts").length;
    const running = prs.filter((p) => p.s.ci === "running").length;
    const icon = (id, label, act) => div().id(id).flex_none().size(20).flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_size(11).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(label);
    return sectionFrame(t, v_flex().id("myprs").size_full().min_h(0).bg(t.chrome).text_color(t.foreground)).track_focus(this.handle)
      .on_key_down((e, cx) => {
        const before = this.cursor;
        if (!listKey(this, e, prs.length, (i) => this.openCard(prs[i]), (k) => {
          if (k === "r") { this.refresh(cx); return true; }
          if (k === "space") { this.toggle(cx); return true; }
          return false;
        })) return;
        if (this.cursor !== before) this.scroll.scroll_to_item(this.cursor);
        cx.stop_propagation(); cx.notify();
      })
      .child(sectionHead(t, { id: "myprs", title: "My PRs", count: this.loaded ? prs.length : this.loading ? "…" : "",
        collapsed: this.collapsed, onToggle: (cx) => this.toggle(cx), onClick: (cx) => this.toggle(cx),
        badges: [fail > 0 && badge(t, `${fail} need you`, t.ansi1, true), running > 0 && badge(t, `${running} running`, runningColor(t))].filter(Boolean),
        actions: [
          // How old the list is, once that's more than a minute and a half (a look failing, or the Mac asleep).
          ...(!this.loading && this.doneAt > 0 && ago(Date.now() - this.doneAt) ? [div().flex_none().text_size(10).text_color(this.error ? t.ansi1 : t.dim).child(ago(Date.now() - this.doneAt))] : []),
          headAction(t, "myprs-refresh", this.loading ? "…" : "↻", "Look again (r)", (cx) => this.refresh(cx)),
          headAction(t, "myprs-hide", "×", "Hide (cmd-shift-m shows it)", () => run("layout.hide", { id: BLOCK })),
        ] }))
      .when(!this.collapsed, (e) => e.child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("myprs-list").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll)
          .when(Boolean(this.error), (e) => e.child(div().px(14).py(4).text_size(11).text_color(t.ansi1).child(this.error)))
          .when(!this.error && this.loaded && !prs.length, (e) => e.child(div().px(14).py(4).text_size(11).text_color(t.dim).child("No open pull requests")))
          .children(prs.map((pr) => this.row(pr, t))))
        .child(Scrollbar.vertical("myprs-list").absolute().inset_0())));
  }
}
