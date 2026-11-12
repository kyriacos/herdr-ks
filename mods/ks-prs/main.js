// Open pull requests for this session's worktrees: the ones the Changes panel shows (it publishes them per space
// in shared "ks.session"; following an agent, every worktree the agent touched), else the focused
// terminal's repo. Each PR: title, branch -> base, draft and review state, CI checks, size; Review opens its diff
// against its base in ks-review, Open shows it on GitHub. Uses `gh` (GitHub CLI, logged in).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, shared, theme, run, notify } from "herdr";

const FIELDS = "number,title,state,url,baseRefName,headRefName,isDraft,reviewDecision,additions,deletions,changedFiles,statusCheckRollup,author";
const base = (p) => p.replace(/\/+$/, "").split("/").pop();

async function gh(args, cwd) {
  let r = await exec("gh", args, { cwd }).catch(() => null);
  if (!r || (r.code !== 0 && /not found|No such file/i.test(r.stderr ?? ""))) r = await exec("/opt/homebrew/bin/gh", args, { cwd }).catch(() => null);
  return r;
}

// CI from statusCheckRollup: { pass, fail, pending }.
function checks(rollup) {
  const out = { pass: 0, fail: 0, pending: 0 };
  for (const c of rollup ?? []) {
    const state = (c.conclusion || c.state || "").toUpperCase(), status = (c.status || "").toUpperCase();
    if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "STARTUP_FAILURE"].includes(state)) out.fail++;
    else if ((status && status !== "COMPLETED") || ["PENDING", "EXPECTED", ""].includes(state)) out.pending++;
    else out.pass++;
  }
  return out;
}

// The worktrees to look at: what the Changes panel published for the shown space, else the focused terminal's.
function sessionRoots() {
  const space = spaces().find((s) => s.active);
  const published = space ? shared("ks.session")?.[space.id] : null;
  if (published?.length) return published.filter((r) => !r.on);
  const f = focused(), pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const cwd = pane?.cwd || f?.cwd || space?.folder;
  return cwd ? [{ root: cwd, on: null }] : [];
}

export default class Prs extends View {
  init(_props, cx) {
    this.prs = []; this.without = []; this.loading = false; this.error = null; this.key = null;
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx, true)); // GitHub: once a minute is plenty
  }

  refresh(cx, force = false) {
    const roots = sessionRoots(), key = JSON.stringify(roots.map((r) => r.root));
    if (this.loading || (!force && key === this.key)) return;
    this.key = key; this.loading = true;
    cx.spawn(async (cx) => {
      const prs = [], without = [], seen = new Set();
      let error = null;
      for (const { root } of roots) {
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
          if (seen.has(pr.url)) continue;
          seen.add(pr.url);
          if (pr.state !== "OPEN") { without.push({ root: dir, branch, closed: pr.state.toLowerCase(), number: pr.number }); continue; }
          const repo = (await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir })).stdout.trim().replace(/\/\.git$/, "");
          prs.push({ ...pr, root: dir, repo: base(repo), checks: checks(pr.statusCheckRollup) });
        } catch { without.push({ root: dir, branch }); }
      }
      if (this.key === key) { this.prs = prs; this.without = without; this.error = error; }
      this.loading = false; cx.notify();
    });
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
    const badge = (label, color) => div().flex_none().px(6).py(1).rounded(8).border_1().border_color(color).text_size(10).text_color(color).child(label);
    const review = { APPROVED: ["approved", t.ansi2], CHANGES_REQUESTED: ["changes requested", t.ansi1], REVIEW_REQUIRED: ["review required", t.muted] }[pr.reviewDecision];
    const c = pr.checks, ci = c.fail ? [`${c.fail} failing`, t.ansi1] : c.pending ? [`${c.pending} running`, t.blocked] : c.pass ? ["checks pass", t.ansi2] : null;
    const button = (id, label, act, primary) => div().id(id).flex_none().h(24).px(9).flex().items_center().rounded(6).cursor_pointer().text_size(11)
      .bg(primary ? t.solid : t.background).text_color(primary ? t.solid_foreground : t.foreground).border_1().border_color(primary ? t.solid : t.border)
      .hover((s) => s.opacity(0.85)).on_click(act).child(label);
    return v_flex().id(`pr-${pr.url}`).flex_none().mx(8).mt(8).p(10).gap(5).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().gap(6).items_start()
        .child(div().flex_none().text_size(12).text_color(t.dim).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).text_size(12.5).font_semibold().child(pr.title)))
      .child(div().text_size(11).text_color(t.dim).truncate().child(`${pr.repo} · ${pr.headRefName} → ${pr.baseRefName} · ${base(pr.root)}`))
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

  render(cx) {
    this.refresh(cx); // follows the session's worktrees as they change
    const t = theme();
    return v_flex().id("prs").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.prs.length} open`))
        .child(div().flex_1())
        .child(div().id("prs-refresh").h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).text_size(11).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx, true)).child(this.loading ? "…" : "Refresh"))
        .when(this.prs.length > 1, (e) => e.child(div().id("prs-review-all").h(24).px(8).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground)
          .text_size(11).cursor_pointer().on_click(() => this.review(this.prs)).child("Review all"))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("prs-list").absolute().inset_0().overflow_y_scroll().pb(10)
          .when(Boolean(this.error), (e) => e.child(div().p(12).text_size(12).text_color(t.ansi1).child(this.error)))
          .when(!this.error && this.loading && !this.prs.length, (e) => e.child(div().p(12).text_size(12).text_color(t.dim).child("Looking for pull requests…")))
          .when(!this.error && !this.loading && !this.prs.length, (e) => e.child(div().p(12).text_size(12).text_color(t.dim).child("No open pull requests for this session's worktrees")))
          .children(this.prs.map((pr) => this.card(pr, t)))
          .when(this.without.length > 0, (e) => e.child(v_flex().mx(8).mt(12).gap(2)
            .child(div().text_size(11).font_semibold().text_color(t.muted).child(`Worktrees without an open PR · ${this.without.length}`))
            .children(this.without.map((w) => div().text_size(11).text_color(t.dim).truncate()
              .child(`${base(w.root)} · ${w.branch}${w.closed ? ` · #${w.number} ${w.closed}` : ""}`))))))
        .child(Scrollbar.vertical("prs-list").absolute().inset_0()));
  }
}
