// One pull request in a floating window (from My PRs): its details (CI checks by name, reviews, size, branch),
// where it lives on this Mac (the local worktrees on its branch, the spaces showing them, the agents working in
// them), and what to do: go to the space, focus the agent, review the diff against its base, open it on GitHub,
// or message the agent right away with the PR as context.
// openOverlay({ mod: "ks-prcard", kind: "window", key, props: { url, repo: "owner/name", number } }).
// Movable by its header, resizable from its corners (ks-resize), one window per PR.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar } from "gpui-base";
import { props, exec, hc, theme, run, notify, agents, spaces, panes, shared, settings, appHome, openOverlay, closeOverlay, nextCommand } from "herdr";
import { checkKind, runningColor, pillColors } from "./lib/ci.js";
import { trackActive, takeRequest, raiseStrip } from "./lib/windows.js";
import { onPasteImage, attachRow, imageLines } from "./lib/attach.js";
import { candidates, git } from "./lib/branch.js";
import * as cache from "./lib/cache.js";
import { pref, worktreePath, repoFolders, branchFolder } from "./lib/prefs.js";
import { fetchPr, prKey } from "./lib/github.js";

const same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const inside = (p, dir) => Boolean(p && dir && (same(p, dir) || p.toLowerCase().startsWith(dir.toLowerCase().replace(/\/+$/, "") + "/")));
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };


// Every checkout of `repoName` (main checkout first): from the repos next to the session's worktrees, else from the repo folders (Settings > Pull requests), two levels deep.
async function repoCheckouts(repoName) {
  const session = Object.values(shared("ks.session") ?? {}).flat().filter((w) => !w.on).map((w) => w.root);
  let list = session.length ? await candidates(session, null).catch(() => []) : [];
  if (!list.some((c) => same(c.repo, repoName))) {
    const r = await exec("sh", ["-c", 'name=$1; shift; for f in "$@"; do for d in "$f"/*/ "$f"/*/*/; do [ -d "$d.git" ] && [ "$(basename "$d")" = "$name" ] && printf "%s\\n" "${d%/}"; done; done', "sh", repoName, ...repoFolders(await home())]).catch(() => null);
    const roots = (r?.stdout ?? "").split("\n").filter(Boolean);
    if (roots.length) list = [...list, ...await candidates(roots, null).catch(() => [])];
  }
  const seen = new Set();
  return list.filter((c) => same(c.repo, repoName) && !seen.has(c.root.toLowerCase()) && seen.add(c.root.toLowerCase()));
}
const home = async () => (await exec("sh", ["-c", 'printf %s "$HOME"'])).stdout;

// Checkouts of `repoName` on `branch`.
async function localWorktrees(repoName, branch) {
  return (await repoCheckouts(repoName)).filter((c) => c.branch === branch);
}

// A worktree of the PR's branch where the new-worktree dialog would put it (<worktree folder>/<repo>/<branch>),
// from the repo's main checkout: the local branch if there is one, else the remote's. { root } or { error }.
async function makeWorktree(repoName, branch) {
  const main = (await repoCheckouts(repoName))[0]?.root;
  if (!main) return { error: `No local clone of ${repoName} in ${pref("repoFolders")}. Add its parent folder in Settings > Pull requests > Repo folders.` };
  const path = worktreePath(await home(), repoName, branch);
  const g = (args) => exec("git", ["-C", main, ...args]).catch((e) => ({ code: 1, stderr: String(e) }));
  await g(["fetch", "origin", branch]);
  const local = (await g(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  const r = await g(local ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, `origin/${branch}`]);
  return r.code === 0 ? { root: path } : { error: (r.stderr || r.stdout || "git worktree add failed").trim().slice(0, 300) };
}

// Agents working in `root`: Claude Code agents by what they touched (agent_where.py, as the Changes panel's
// Follow agent), any agent by its terminal's folder.
async function agentsIn(root) {
  const out = [];
  for (const a of agents()) {
    const pane = panes().find((p) => p.terminal === a.address);
    let hit = inside(pane?.cwd, root);
    if (!hit && (a.app === "claude-code" || /claude/i.test(a.program?.name ?? ""))) {
      const g = await hc(["get", a.address]).catch(() => null);
      let pid = null; try { pid = JSON.parse(g?.stdout ?? "{}").foreground?.pid; } catch {}
      if (pid) {
        const w = await exec("python3", ["-I", `${appHome()}/mods/ks-changes/agent_where.py`, String(pid)]).catch(() => null);
        try { hit = (JSON.parse(w?.stdout ?? "{}").roots ?? []).some((r) => same(r, root)); } catch {}
      }
    }
    if (hit) out.push({ address: a.address, title: a.title || a.address, space: a.space, space_name: a.space_name, status: a.status });
  }
  return out;
}

// Spaces showing `root`: a pane in it, or the Changes panel's session for that space has it.
function spacesWith(root) {
  const sess = shared("ks.session") ?? {}, ps = panes();
  return spaces().filter((s) => {
    const tabs = new Set(s.tabs.map((t) => t.id));
    return ps.some((p) => tabs.has(p.tab) && inside(p.cwd, root)) || (sess[s.id] ?? []).some((w) => same(w.root, root)) || inside(s.folder, root);
  }).map((s) => ({ id: s.id, name: s.name }));
}

export default class PrCard extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.url = p.url; this.repo = p.repo ?? ""; this.number = p.number; this.overlay = p.overlay ?? null; this.windowKey = p.windowKey ?? null;
    this.openProps = Object.fromEntries(Object.entries(p).filter(([k]) => k !== "overlay"));
    this.pr = null; this.error = null; this.places = null; this.target = null; this.sending = false;
    this.msg = TextareaState.new({ placeholder: "Message to the agent about this PR (sent right away, with the PR as context; cmd-v pastes an image)", rows: 3 });
    // Pictures pasted into the message go with it (their paths, for the agent to open).
    this.images = [];
    onPasteImage(this.msg, (a, cx) => { this.images.push(a); cx.notify(); }, (on, cx) => { this.pasting = on; cx.notify(); });
    // Redraw when the box goes from empty to not (the buttons depend on it).
    this.msg.on("change", (_e, cx) => { const has = Boolean(this.msg.value().trim()); if (has !== this.hasText) { this.hasText = has; cx.notify(); } });
    this.handle = cx.focus_handle(); this.handle.focus();
    // The key modes' resize keys while it has the keyboard (lib/windows.js): reopened at the new size, in px.
    if (this.windowKey) {
      trackActive(this, cx, this.windowKey, "ks-prcard");
      cx.spawn(async (cx) => {
        for (;;) {
          const c = await nextCommand();
          if (c !== "winresize") continue;
          const r = takeRequest(this, this.windowKey);
          if (!r) continue;
          const cur = this.size ?? { width: 560, height: 640 }, step = 24 * (r.dir || 1);
          const width = r.reset ? 560 : Math.max(380, Math.round(cur.width + (r.kind === "tall" ? 0 : step)));
          const height = r.reset ? 640 : Math.max(300, Math.round(cur.height + (r.kind === "wide" ? 0 : step)));
          openOverlay({ mod: "ks-prcard", kind: "window", key: this.windowKey, width, height, props: this.openProps });
          raiseStrip();
        }
      });
    }
    if (!this.url) { this.error = "No pull request"; return; }
    // Stale while revalidate: the last known PR (and where it lives) at once, then a fresh look.
    cx.spawn(async (cx) => {
      const hit = await cache.get(prKey(this.url));
      if (hit?.value?.pr && !this.fresh) {
        this.pr = hit.value.pr;
        const alive = new Set(agents().map((a) => a.address));
        if (hit.value.places) this.places = hit.value.places.map((w) => ({ ...w, agents: (w.agents ?? []).filter((a) => alive.has(a.address)) }));
        this.target = this.places?.flatMap((w) => w.agents)[0]?.address ?? null;
        cx.notify();
      }
      this.load(cx);
    });
  }

  load(cx) {
    this.updating = true; cx.notify();
    cx.spawn(async (cx) => {
      const got = await fetchPr(this.repo, this.number);
      if (got.error) { if (!this.pr) this.error = got.error; this.updating = false; cx.notify(); return; }
      this.pr = got.pr; this.fresh = true;
      cache.set(prKey(this.url), { pr: this.pr, places: this.places });
      cx.notify();
      // Where it lives here: worktrees on its branch, their spaces and agents.
      const wts = await localWorktrees(this.repo.split("/").pop(), this.pr.headRefName).catch(() => []);
      const places = [];
      for (const w of wts) places.push({ ...w, spaces: spacesWith(w.root), agents: await agentsIn(w.root).catch(() => []) });
      const keep = this.target && places.some((w) => w.agents.some((a) => a.address === this.target)) ? this.target : null;
      this.places = places;
      this.target = keep ?? places.flatMap((p) => p.agents)[0]?.address ?? null; // only ever an agent on this PR by default
      this.updating = false;
      cache.set(prKey(this.url), { pr: this.pr, places });
      cx.notify();
    });
  }

  close() { if (this.overlay) closeOverlay(this.overlay); }

  // One agent to pick: selected shows as such; `onPr` says whether it works on this PR.
  agentRow(a, onPr, note, t) {
    const on = this.target === a.address;
    return h_flex().id(`to-${a.address}`).flex_none().mt(4).px(8).py(5).gap(8).items_center().rounded(8).cursor_pointer()
      .border_1().border_color(on ? (onPr ? t.accent : t.blocked) : t.border).bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { this.target = a.address; cx.notify(); })
      .child(div().w(14).flex_none().text_size(12).text_color(on ? (onPr ? t.accent : t.blocked) : t.dim).child(on ? "◉" : "○"))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(12).truncate().child(a.title))
        .child(div().text_size(10.5).text_color(onPr ? t.ansi2 : t.dim).child(note)));
  }

  // No agent on this PR: start Claude Code with the message (and the PR) as its first task: in a new tab of the
  // space showing its worktree, else in a new space there; with no local checkout, a new worktree first.
  async startAgent(cx) {
    const text = (this.msg.value().trim() + imageLines(this.images)).trim(), pr = this.pr;
    if (!text || this.sending || !pr) return;
    this.sending = true; cx.notify();
    const repoName = this.repo.split("/").pop();
    let w = (this.places ?? [])[0];
    if (!w) {
      const made = await makeWorktree(repoName, pr.headRefName);
      if (made.error) {
        this.sending = false; cx.notify();
        return notify({ title: "Couldn't make a worktree for the PR", body: made.error, level: "error", timeout: 6000 });
      }
      w = { root: made.root, spaces: [], agents: [] };
    }
    const task = `About ${this.repo}#${pr.number} "${pr.title}" (branch ${pr.headRefName} → ${pr.baseRefName}, ${this.url}):\n\n${text}`;
    if (w.spaces[0]) run("tab.new", { name: `PR #${pr.number}`, space: w.spaces[0].id, folder: w.root, argv: ["claude"], task });
    else run("space.new", { name: `${repoName} #${pr.number}`, folder: w.root, argv: ["claude"], task });
    this.sending = false;
    this.msg.set_value(""); this.images = [];
    notify({ title: "Started a session on the PR", body: `${this.repo}#${pr.number} in ${w.root.split("/").pop()}${w.spaces[0] ? "" : " (new space)"}`, level: "success", timeout: 4000 });
    // Look again in a moment, so the new agent shows as the PR's.
    cx.timer.after(6000, (cx) => this.load(cx));
    cx.notify();
  }
  async openUrl() { await exec("open", [this.url]).catch(() => null); }
  review(w) {
    run("tab.new", { name: `PR #${this.pr.number}`, mod: "ks-review",
      props: { scope: "branch", roots: [w.root], bases: { [w.root]: `origin/${this.pr.baseRefName}` }, agent: w.agents[0]?.address ?? null, space: w.spaces[0]?.id ?? null } });
  }

  async send(cx) {
    const text = (this.msg.value().trim() + imageLines(this.images)).trim();
    if (!text || !this.target || this.sending) return;
    this.sending = true; cx.notify();
    const pr = this.pr, msg = `About ${this.repo}#${pr.number} "${pr.title}" (branch ${pr.headRefName} → ${pr.baseRefName}, ${this.url}):\n\n${text}`;
    const r = await hc(["send", this.target, msg]).catch((e) => ({ code: 1, stderr: String(e) }));
    this.sending = false;
    if (r.code === 0) { this.msg.set_value(""); this.images = []; notify({ title: "Sent to the agent", body: `${this.repo}#${pr.number}`, level: "success", timeout: 3000 }); }
    else notify({ title: "Couldn't send", body: (r.stderr || "").trim().slice(0, 200), level: "error", timeout: 5000 });
    cx.notify();
  }

  // Corner resizing, as the review windows (ks-resize reopens this window at the new size).
  grips(t) {
    const g = (corner) => div().id(`grip-${corner}`).absolute().size(14)
      .when(corner.includes("t"), (e) => e.top(0)).when(corner.includes("b"), (e) => e.bottom(0))
      .when(corner.includes("l"), (e) => e.left(0)).when(corner.includes("r"), (e) => e.right(0))
      .when(corner === "tl" || corner === "br", (e) => e.cursor_nwse_resize()).when(corner === "tr" || corner === "bl", (e) => e.cursor_nesw_resize())
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        if (!this.winRect || !this.windowKey) return;
        openOverlay({ mod: "ks-resize", kind: "window", frame: "none", key: "ks-resize", width: 1, height: 1, at: { x: 0, y: 0 },
          props: { rect: this.winRect, corner, zoom: settings().zoom || 1, reopen: { mod: "ks-prcard", key: this.windowKey, props: this.openProps } } });
      })
      .when(corner === "br", (e) => e.child(div().absolute().right(3).bottom(3).size(7).border_r_2().border_b_2().border_color(t.dim)));
    return ["tl", "tr", "bl", "br"].map(g);
  }

  render(cx) {
    const t = theme(), pr = this.pr;
    const button = (id, label, act, primary = false, enabled = true) => div().id(id).flex_none().h(24).px(9).flex().items_center().rounded(6).text_size(11)
      .bg(primary && enabled ? t.solid : t.background).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .border_1().border_color(primary && enabled ? t.solid : t.border).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => act(cx))).child(label);
    const pill = (label, tone) => { const c = pillColors(tone, t);
      return div().flex_none().px(6).py(1).rounded(8).border_1().border_color(c.border).when(Boolean(c.bg), (e) => e.bg(c.bg)).text_size(10).text_color(c.text).whitespace_nowrap().child(label); };
    const section = (title) => div().flex_none().pt(10).pb(3).text_size(11).font_semibold().text_color(t.muted).child(title);
    const root = v_flex().id("prcard").size_full().relative().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_size_change((size) => { this.size = size; })
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .when(Boolean(this.windowKey), (e) => e.on_mouse_move((ev) => { if (ev.bounds) this.winRect = ev.bounds; }));
    if (!pr) return root.child(h_flex().h(40).px(14).items_center().gap(8).border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().flex_1().font_semibold().child(`${this.repo}#${this.number ?? ""}`)).child(button("x", "✕", () => this.close())))
      .child(div().p(14).text_color(this.error ? t.ansi1 : t.dim).child(this.error ?? "Loading…"));

    const order = { fail: 0, running: 1, pass: 2, skip: 3 };
    const checks = (pr.statusCheckRollup ?? []).map((c) => ({ name: c.name || c.context || "check", kind: checkKind(c) }))
      .sort((a, b) => order[a.kind] - order[b.kind]);
    const reviews = (pr.latestReviews ?? []).map((r) => ({ who: r.author?.login ?? "?", state: r.state }));
    const asked = (pr.reviewRequests ?? []).map((r) => r.login || r.name || r.slug).filter(Boolean);
    const decision = { APPROVED: ["approved", t.ansi2], CHANGES_REQUESTED: ["changes requested", t.ansi1], REVIEW_REQUIRED: ["review required", t.muted] }[pr.reviewDecision];
    const running = checks.some((c) => c.kind === "running") && !checks.some((c) => c.kind === "fail");
    const merge = { CLEAN: ["ready to merge", t.ansi2], BLOCKED: ["blocked", t.muted], BEHIND: ["behind base", runningColor(t)], DIRTY: ["conflicts", t.ansi1],
      UNSTABLE: running ? ["waiting on CI", runningColor(t)] : ["unstable", t.ansi1], DRAFT: ["draft", t.dim] }[pr.mergeStateStatus];
    // Who works on this PR (an agent in one of its worktrees) and everyone else, kept apart so it's clear.
    const onPr = (this.places ?? []).flatMap((w) => w.agents.map((a) => ({ address: a.address, title: `${a.space_name} / ${a.title}`, where: w.root.split("/").pop() })));
    const here = new Set(onPr.map((a) => a.address));
    const others = agents().filter((a) => !here.has(a.address)).map((a) => ({ address: a.address, title: `${a.space_name} / ${a.title || a.address}` }));
    const target = onPr.find((a) => a.address === this.target) ?? others.find((a) => a.address === this.target) ?? null;
    const targetOnPr = Boolean(target && here.has(target.address));
    // With no agent on the PR, sending starts one (startAgent): where, in words.
    const noAgent = this.places !== null && !onPr.length, w0 = (this.places ?? [])[0];
    const startWhere = !noAgent ? "" : w0
      ? `Send starts Claude Code in ${w0.root.split("/").pop()} (${w0.spaces[0] ? `a new tab in space ${w0.spaces[0].name}` : "a new space"}), with your message as its first task.`
      : `No local checkout of ${pr.headRefName}: send makes a worktree in ${pref("worktreeRoot")}/${this.repo.split("/").pop()}/${branchFolder(pr.headRefName)}, opens a space there and starts Claude Code with your message.`;
    const starting = !target && noAgent;

    const body = v_flex().id("prcard-body").absolute().inset_0().overflow_y_scroll().px(14).pb(14)
      .child(h_flex().pt(10).gap(5).flex_wrap().items_center()
        .child(pr.isDraft ? pill("draft", t.dim) : pill(pr.state.toLowerCase(), t.ansi2))
        .when(Boolean(decision), (e) => e.child(pill(decision[0], decision[1])))
        .when(Boolean(merge), (e) => e.child(pill(merge[0], merge[1])))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.ansi2).child(`+${pr.additions}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${pr.deletions}`))
        .child(div().text_size(11).text_color(t.dim).child(`${pr.changedFiles} files · ${pr.commits?.length ?? 0} commits · ${ago(pr.updatedAt)}`)))
      .child(div().pt(4).text_size(11).text_color(t.dim).child(`${pr.headRefName} → ${pr.baseRefName} · by ${pr.author?.login ?? "?"}`))
      .child(section("Where it lives here"))
      .when(this.places === null, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("Looking for its worktree and agent…")))
      .when(this.places !== null && !this.places.length, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`No local checkout on ${pr.headRefName}`)))
      .children((this.places ?? []).map((w) => v_flex().id(`wt-${w.root}`).flex_none().mt(4).p(8).gap(4).rounded(8).border_1().border_color(t.border).bg(t.chrome)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(w.root))
          .child(button(`rev-${w.root}`, "Review", () => this.review(w), true)))
        .child(h_flex().gap(5).flex_wrap().items_center()
          .when(!w.spaces.length, (e) => e.child(div().text_size(11).text_color(t.dim).child("not open in a space")))
          .children(w.spaces.map((s) => button(`sp-${w.root}-${s.id}`, `Go to space ${s.name}`, () => run("space.select", { id: s.id }))))
          .when(!w.agents.length, (e) => e.child(div().text_size(11).text_color(t.dim).child("no agent in it")))
          .children(w.agents.map((a) => button(`ag-${w.root}-${a.address}`, `Focus agent · ${a.space_name} / ${a.title}`, () => run("agent.focus", { terminal: a.address })))))))
      .child(section(`Checks · ${checks.length}`))
      .when(!checks.length, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("No checks")))
      .children(checks.map((c) => h_flex().flex_none().gap(6).items_center().text_size(11.5)
        .child(div().w(14).flex_none().text_color({ fail: t.ansi1, running: runningColor(t), pass: t.ansi2, skip: t.dim }[c.kind]).child({ fail: "✕", running: "◌", pass: "✓", skip: "–" }[c.kind]))
        .child(div().flex_1().min_w(0).truncate().text_color(c.kind === "skip" ? t.dim : t.foreground).child(c.name))))
      .child(section("Reviews"))
      .when(!reviews.length && !asked.length, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("No reviews yet")))
      .children(reviews.map((r) => div().text_size(11.5).child(`${r.who}: ${r.state.toLowerCase().replace(/_/g, " ")}`)))
      .when(asked.length > 0, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`asked: ${asked.join(", ")}`)))
      .child(section("Message the agent"))
      .when(this.places === null, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("Finding the agent working on this PR…")))
      // The agent(s) on this PR: its worktree is theirs.
      .when(this.places !== null && onPr.length > 0, (e) => e.children(onPr.map((a) => this.agentRow(a, true, `on this PR · in ${a.where}`, t))))
      .when(this.places !== null && !onPr.length, (e) => e.child(v_flex().gap(4).p(8).rounded(8).border_1().border_color(t.border).bg(t.chrome)
        .child(div().text_size(11.5).text_color(t.muted).child("No agent is working on this PR."))
        .child(div().text_size(11).text_color(t.dim).child(startWhere))))
      // Everyone else, apart and folded, so a message can't go there by accident.
      .when(others.length > 0, (e) => e.child(div().id("others-toggle").pt(6).text_size(11).text_color(t.dim).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { this.showOthers = !this.showOthers; cx.notify(); })
        .child(`${this.showOthers ? "▾" : "▸"} Other agents, not working on this PR · ${others.length}`)))
      .when(Boolean(this.showOthers), (e) => e.children(others.map((a) => this.agentRow(a, false, "not on this PR", t))))
      .child(div().mt(6).p(6).rounded(8).border_1().border_color(t.border).bg(t.chrome).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Textarea.new(this.msg).w_full().text_size(12.5).text_color(t.foreground)))
      .when(this.images.length > 0 || Boolean(this.pasting), (e) => e.child(h_flex().pt(6).gap(8).items_center().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(attachRow(this.images, t, "pr-img", { onRemove: (a, cx) => { this.images = this.images.filter((x) => x.id !== a.id); cx.notify(); } }))
        .when(Boolean(this.pasting), (e) => e.child(div().text_size(11).text_color(t.dim).child("Pasting…")))))
      .child(h_flex().pt(6).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(!target ? t.dim : targetOnPr ? t.muted : t.blocked)
          .child(starting ? "Starts a new Claude Code session on this PR" : !target ? (this.places === null ? "Finding the agent…" : "Pick the agent to send to") : targetOnPr ? `To ${target.title}, the agent on this PR` : `To ${target.title}, which is not working on this PR`))
        .child(button("send", this.sending ? (starting ? "Starting…" : "Sending…") : starting ? (w0 ? "Start a session & send" : "Create worktree, start & send") : !target ? "Send" : targetOnPr ? "Send to the PR's agent" : "Send anyway",
          (cx) => (starting ? this.startAgent(cx) : this.send(cx)), true, (Boolean(target) || starting) && !this.sending && (Boolean(this.msg.value().trim()) || this.images.length > 0))));

    return root
      .child(h_flex().h(44).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().text_size(13).child(pr.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(`${this.repo}#${pr.number}${this.updating ? " · updating…" : ""}`)))
        .child(button("gh", "Open on GitHub", () => this.openUrl()))
        .child(button("x", "✕", () => this.close())))
      .child(div().flex_1().min_h(0).relative().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(body).child(Scrollbar.vertical("prcard-body").absolute().inset_0()))
      .when(Boolean(this.windowKey), (e) => e.children(this.grips(t)));
  }
}
