// "My PRs" at the top of the sidebar: every open pull request you authored on GitHub (`gh`, logged in), with
// where each one stands: CI (passing / failing / running), review (approved / changes requested / waiting) and
// merge (ready / blocked / conflicts / behind). Ones that need you come first. Click a row to open it on GitHub.
// The header folds the section to one line (the block shrinks); × hides it; cmd-shift-m shows / hides it
// (layout.toggle my-prs). A toast when a PR's CI turns red or green, or a review lands. Refreshes every minute.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, theme, run, notify, openOverlay } from "herdr";
import * as cache from "./lib/cache.js";
import { fetchPr, prKey } from "./lib/github.js";
import { dimmed } from "./lib/focus.js";

const BLOCK = "my-prs", HEAD = 34, ROW = 50;
const QUERY = `query { search(query: "is:pr is:open author:@me archived:false", type: ISSUE, first: 40) { nodes { ... on PullRequest {
  number title url isDraft repository { nameWithOwner } headRefName baseRefName reviewDecision mergeStateStatus updatedAt
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 80) { nodes {
    ... on CheckRun { status conclusion } ... on StatusContext { state } } } } } } } } } } }`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

async function gh(args) {
  let r = await exec("gh", args).catch(() => null);
  if (!r || (r.code !== 0 && /not found|No such file/i.test(r.stderr ?? ""))) r = await exec("/opt/homebrew/bin/gh", args).catch(() => null);
  return r;
}

// One PR's state: ci "pass" | "fail" | "running" | "none" (+ counts), review, merge, and how urgent it is.
function stateOf(pr) {
  const roll = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const counts = { pass: 0, fail: 0, running: 0 };
  for (const c of roll?.contexts?.nodes ?? []) {
    const s = (c.conclusion || c.state || "").toUpperCase(), st = (c.status || "").toUpperCase();
    if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "STARTUP_FAILURE"].includes(s)) counts.fail++;
    else if ((st && st !== "COMPLETED") || ["PENDING", "EXPECTED", ""].includes(s)) counts.running++;
    else counts.pass++;
  }
  const ci = !roll ? "none" : counts.fail || ["FAILURE", "ERROR"].includes(roll.state) ? "fail" : counts.running || ["PENDING", "EXPECTED"].includes(roll.state) ? "running" : "pass";
  const review = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "waiting" }[pr.reviewDecision] ?? "none";
  const merge = { CLEAN: "ready", HAS_HOOKS: "ready", BLOCKED: "blocked", BEHIND: "behind", DIRTY: "conflicts", UNSTABLE: "unstable", DRAFT: "draft" }[pr.mergeStateStatus] ?? "checking";
  // Blocked with no approval yet: what it waits for is a review.
  const mergeShown = merge === "blocked" && (review === "none" || review === "waiting") ? "approval" : merge;
  const urgent = ci === "fail" || review === "changes" || merge === "conflicts" ? 0 : ci === "running" ? 1 : merge === "ready" && !pr.isDraft ? 2 : 3;
  return { ci, counts, review, merge: mergeShown, urgent };
}

export default class MyPrs extends View {
  init(_props, cx) {
    this.prs = []; this.error = null; this.loading = false; this.loaded = false; this.last = {};
    this.collapsed = load("collapsed", false);
    // Stale while revalidate: the last list at once (no toasts for it), then a fresh one.
    cx.spawn(async (cx) => {
      const hit = await cache.get("myprs");
      if (hit?.value && !this.loaded) {
        this.prs = hit.value.map((pr) => ({ ...pr, s: stateOf(pr) }));
        this.last = Object.fromEntries(this.prs.map((pr) => [pr.url, { ci: pr.s.ci, review: pr.s.review }]));
        this.cached = true; this.fit(); cx.notify();
      }
    });
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await gh(["api", "graphql", "-f", `query=${QUERY}`]);
      if (!r) this.error = "Couldn't run gh (GitHub CLI)";
      else if (r.code !== 0) this.error = /auth|login/i.test(r.stderr ?? "") ? "gh isn't logged in: run `gh auth login`" : (r.stderr || "gh failed").trim().split("\n")[0];
      else {
        try {
          const nodes = JSON.parse(r.stdout).data.search.nodes.filter((n) => n?.url);
          const prs = nodes.map((pr) => ({ ...pr, s: stateOf(pr) }))
            .sort((a, b) => a.s.urgent - b.s.urgent || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
          if (this.cached && !this.loaded) this.loaded = true; // the cached list counts as the first look for toasts
          this.announce(prs);
          this.prs = prs; this.error = null; this.loaded = true;
          cache.set("myprs", nodes);
          this.prefetch(prs);
        } catch (e) { this.error = "Couldn't read GitHub's answer"; }
      }
      this.loading = false; this.fit(); cx.notify();
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
      if (!this.loaded || !before) continue;
      if (before.ci !== "fail" && pr.s.ci === "fail") notify({ title: `CI failing · ${name}`, body: pr.title, level: "error", timeout: 6000 });
      else if (before.ci !== "pass" && pr.s.ci === "pass") notify({ title: `CI passing · ${name}`, body: pr.title, level: "success", timeout: 4000 });
      if (before.review !== "approved" && pr.s.review === "approved") notify({ title: `Approved · ${name}`, body: pr.title, level: "success", timeout: 5000 });
      if (before.review !== "changes" && pr.s.review === "changes") notify({ title: `Changes requested · ${name}`, body: pr.title, level: "warning", timeout: 6000 });
    }
    if (this.loaded) for (const url of Object.keys(was)) if (!now[url]) notify({ title: "PR merged or closed", body: url.replace("https://github.com/", ""), level: "info", timeout: 4000 });
    this.last = now;
  }

  // The block's height: one line folded, else the rows (up to a few, then it scrolls).
  fit() {
    const px = this.collapsed ? HEAD : HEAD + 8 + Math.max(1, Math.min(this.prs.length, 6)) * ROW;
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

  step(label, tone, t) {
    return div().flex_none().px(5).rounded(6).border_1().border_color(tone).text_size(9.5).text_color(tone).whitespace_nowrap().child(label);
  }

  row(pr, t) {
    const s = pr.s, repo = pr.repository.nameWithOwner.split("/").pop();
    const ci = { pass: [`✓ CI`, t.ansi2], fail: [`✕ CI ${s.counts.fail}`, t.ansi1], running: [`◌ CI ${s.counts.running}`, t.blocked], none: ["no CI", t.dim] }[s.ci];
    const review = { approved: ["✓ approved", t.ansi2], changes: ["✕ changes", t.ansi1], waiting: ["review", t.muted], none: ["no review", t.dim] }[s.review];
    const merge = { ready: ["ready", t.ansi2], blocked: ["blocked", t.muted], approval: ["needs approval", t.muted], behind: ["behind", t.blocked], conflicts: ["conflicts", t.ansi1], unstable: ["unstable", t.blocked], draft: ["draft", t.dim], checking: ["…", t.dim] }[s.merge];
    const mark = s.urgent === 0 ? t.ansi1 : s.urgent === 1 ? t.blocked : s.urgent === 2 ? t.ansi2 : t.dim;
    return v_flex().id(`mypr-${pr.url}`).flex_none().h(ROW - 4).mx(6).mb(4).px(8).py(4).gap(3).rounded(7).cursor_pointer()
      .border_l_2().border_color(mark).hover((st) => st.bg(t.hover)).on_click(() => this.openCard(pr))
      .child(h_flex().gap(5).items_center().text_size(11.5)
        .child(div().flex_none().text_color(t.dim).child(`${repo}#${pr.number}`))
        .child(div().flex_1().min_w(0).truncate().text_color(pr.isDraft ? t.muted : t.foreground).child(pr.title)))
      .child(h_flex().gap(4).items_center()
        .when(pr.isDraft, (e) => e.child(this.step("draft", t.dim, t)))
        .child(this.step(ci[0], ci[1], t)).child(this.step(review[0], review[1], t)).child(this.step(merge[0], merge[1], t)));
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
    return v_flex().id("myprs").size_full().min_h(0).bg(t.chrome).text_color(t.foreground)
      .child(h_flex().id("myprs-head").h(HEAD).flex_none().px(12).gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => this.toggle(cx))
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(this.collapsed ? "▸" : "▾"))
        .child(div().flex_none().text_size(12).text_color(t.muted).child("My PRs"))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(this.loaded ? `${prs.length}` : this.loading ? "…" : ""))
        .when(fail > 0, (e) => e.child(div().flex_none().px(5).rounded(6).bg(t.ansi1).text_size(10).text_color(t.background).child(`${fail} need you`)))
        .when(running > 0, (e) => e.child(div().flex_none().px(5).rounded(6).border_1().border_color(t.blocked).text_size(10).text_color(t.blocked).child(`${running} running`)))
        .child(div().flex_1())
        .child(icon("myprs-refresh", this.loading ? "…" : "↻", (cx) => this.refresh(cx)))
        .child(icon("myprs-hide", "×", () => run("layout.hide", { id: BLOCK }))))
      .when(!this.collapsed, (e) => e.child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("myprs-list").absolute().inset_0().overflow_y_scroll()
          .when(Boolean(this.error), (e) => e.child(div().px(14).py(4).text_size(11).text_color(t.ansi1).child(this.error)))
          .when(!this.error && this.loaded && !prs.length, (e) => e.child(div().px(14).py(4).text_size(11).text_color(t.dim).child("No open pull requests")))
          .children(prs.map((pr) => this.row(pr, t))))
        .child(Scrollbar.vertical("myprs-list").absolute().inset_0())));
  }
}
