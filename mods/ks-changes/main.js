// Roundup's Changes panel, cloned from Herdr's `changes` (0.1.15) and extended:
// - a checkout bar: follow the focused terminal, pin any worktree of the repo, or follow an agent
//   (Claude Code: its real working folder, read from its session log, not where it was launched);
// - matching repos: sibling repos (same parent folder as the main checkout) with a checkout on the
//   same branch show as extra sections, each with its own commit, so backend + web work side by side.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, hc, watchFolder, theme, settings, home, appHome, run, shared, setShared, openOverlay } from "herdr";
import { langOf, colorsFor } from "./lib/highlight.js";
import { parseDiff, wrapTokens, colsFor } from "./lib/diff.js";
import { WORKTREE, readBranch, readCommits, readCommitFiles, treeRows } from "./lib/branch.js";
import * as comments from "./lib/comments.js";
import { dimmed } from "./lib/focus.js";
import { pref } from "./lib/prefs.js";

// ---------- stored choices (this mod's localStorage) ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// space id -> { path } (a pinned checkout) | { agent } (a terminal address to follow)
let pins = load("pins", {});
for (const [k, v] of Object.entries(pins)) if (typeof v === "string") pins[k] = { path: v }; // older form
let pairing = load("pairing", true);
// Matching repos pair a feature branch (backend and web on the same branch). Everything sits on main, so a default
// branch never pairs.
const DEFAULT_BRANCHES = ["main", "master", "develop", "trunk"];

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const tilde = (p) => { const h = home(); return h && p && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : p; };
const same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase()); // macOS: /Users/Name is /Users/name
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));


// ---------- where to look ----------
// Claude Code agents in the shown tab, the focused one first.
function tabAgents() {
  const f = focused(), ps = panes();
  const isAgent = (p) => p.terminal && (p.program?.key === "claude" || p.app === "claude-code" || /claude/i.test(p.program?.name ?? ""));
  return ps.filter((p) => p.tab === f?.tab && isAgent(p)).sort((a, b) => (b.pane === f?.pane) - (a.pane === f?.pane));
}

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const pin = space ? pins[space.id] ?? null : null;
  const fallback = space?.folder || null;
  if (pin?.path) return { mode: "pinned", cwd: pin.path, on, fallback: null, space: space.id };
  if (pin?.agent) return { mode: "agent", agent: pin.agent, cwd: null, on, fallback, space: space.id };
  return { mode: "focus", cwd: pane?.cwd || f?.cwd || fallback, on, fallback, space: space?.id ?? null };
}
const key = () => JSON.stringify([location(), pairing]);

// Where a Claude Code agent works now: the checkouts it last edited files in or cd'd into, one per repo,
// most recent first (agent_where.py reads its session log; see there for why its recorded cwd isn't enough).
// { roots: [...], cwd } or null when it can't be told.
async function agentRoots(address) {
  const r = await hc(["get", address]).catch(() => null);
  if (!r || r.code !== 0) return null;
  let info; try { info = JSON.parse(r.stdout); } catch { return null; }
  const pid = info.foreground?.pid;
  if (!pid) return null;
  const args = ["-I", `${appHome()}/mods/ks-changes/agent_where.py`, String(pid)];
  // Herdr's own PATH may not have Homebrew's python3: fall back to macOS's.
  let w = await exec("python3", args).catch(() => null);
  if (!w || w.code !== 0) w = await exec("/usr/bin/python3", args).catch(() => null);
  if (!w || w.code !== 0) return null;
  try { return JSON.parse(w.stdout); } catch { return null; }
}

// The checkout shown, handed to the Files panel (shared "ks.focus": space id -> { root, on }) while this
// panel is pinned or follows an agent; following focus, the entry goes and Files follows focus too.
function handOver(section) {
  const loc = location();
  if (!loc.space) return;
  const all = shared("ks.focus") ?? {}, cur = all[loc.space] ?? null;
  const want = loc.mode !== "focus" && section ? { root: section.root, on: section.on ?? null } : null;
  if (JSON.stringify(cur) === JSON.stringify(want)) return;
  const next = { ...all };
  if (want) next[loc.space] = want; else delete next[loc.space];
  setShared("ks.focus", next);
}

// The worktrees this panel shows, per space (shared "ks.session": space id -> [{ root, on }]), for the PRs panel.
function publishSession(sections) {
  const loc = location();
  if (!loc.space) return;
  const all = shared("ks.session") ?? {}, want = sections.map((s) => ({ root: s.root, on: s.on ?? null }));
  if (JSON.stringify(all[loc.space] ?? null) === JSON.stringify(want)) return;
  setShared("ks.session", { ...all, [loc.space]: want });
}

// ---------- git ----------
const git = (root, on, args) => exec("git", [...READ, ...args], { cwd: root, on });

async function mainOf(root, on) {
  const r = await git(root, on, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0) return root;
  const c = r.stdout.trim();
  return c.endsWith("/.git") ? c.slice(0, -5) : c;
}

async function checkoutsOf(root, on) {
  const r = await git(root, on, ["worktree", "list", "--porcelain"]).catch(() => null);
  const list = [];
  for (const block of (r?.code === 0 ? r.stdout : "").split(/\n\n+/)) {
    const lines = block.split("\n"), path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    list.push({ path, branch, main: list.length === 0 });
  }
  return list;
}

// One repo's uncommitted changes.
async function readSection(root, on) {
  const status = await git(root, on, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  if (status.code !== 0) throw new Error(status.stderr);
  const head = await git(root, on, ["rev-parse", "--verify", "HEAD"]);
  const br = await git(root, on, ["branch", "--show-current"]);
  const main = await mainOf(root, on);
  const stats = {};
  const results = head.code === 0 ? [await git(root, on, ["diff", "HEAD", "--numstat", "-z", "--no-renames"])]
    : [await git(root, on, ["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(root, on, ["diff", "--numstat", "-z", "--no-renames"])];
  for (const result of results) {
    if (result.code !== 0) throw new Error(result.stderr);
    for (const entry of result.stdout.split("\0")) {
      const [a, d, ...parts] = entry.split("\t");
      if (!parts.length) continue;
      const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
      stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
    }
  }
  const files = [], entries = status.stdout.split("\0").filter(Boolean);
  for (const entry of entries.slice(0, 1000)) {
    const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
    const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
    const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
    files.push({ path, status: s, fresh, ...(stats[path] ?? { add: 0, del: 0 }) });
  }
  return { root, on, main, name: base(main), branch: br.code === 0 ? (br.stdout.trim() || "detached HEAD") : null, hasHead: head.code === 0, files, limited: entries.length > 1000 };
}

// Sibling repos of `main` (same parent folder) with a checkout on `branch`: their folders. Local only.
const partnerCache = new Map(); // `${main}|${branch}` -> { at, paths }
async function partners(main, branch, root) {
  if (!branch || branch === "detached HEAD") return [];
  const k = `${main}|${branch}`, hit = partnerCache.get(k);
  if (hit && Date.now() - hit.at < 60000) return hit.paths;
  const parent = main.replace(/\/[^/]+\/?$/, "");
  const r = await exec("sh", ["-c", 'for d in "$1"/*/; do [ -e "$d.git" ] && printf "%s\\n" "${d%/}"; done', "sh", parent]).catch(() => null);
  const paths = [];
  for (const sib of (r?.stdout ?? "").split("\n").filter(Boolean)) {
    if (same(sib, main)) continue;
    // A sibling can itself be a worktree (of this repo or another): skip this checkout and repeats.
    const c = (await checkoutsOf(sib, null)).find((x) => x.branch === branch);
    if (c && !same(c.path, root) && !paths.some((p) => same(p, c.path))) paths.push(c.path);
    if (paths.length >= 3) break;
  }
  partnerCache.set(k, { at: Date.now(), paths });
  return paths;
}

export default class Changes extends View {
  init(_props, cx) {
    this.sections = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.watched = new Set();
    // What the list shows: "working" (uncommitted), "branch" (vs the merge-base) or "commits" (pick one); tree or flat.
    this.scope = load("scope", "working"); this.tree = load("tree", true); this.collapsed = new Set();
    this.picked = null; this.pickedFiles = []; this.wrap = load("wrap", false); this.diffPx = 0;
    this.folded = new Set(); // worktrees folded in the list (click a worktree's header)
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.message.trim());
      this.message = this.input.value();
      if (had !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => { if (this.sections.filter((s) => s.files.length).length === 1) this.commit(this.sections.find((s) => s.files.length), cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.watched.has(root)) return;
    this.watched.add(root);
    const context = this.context;
    cx.spawn(async (cx) => {
      try {
        while (this.watched.has(root) && this.context === context) {
          await watchFolder(root);
          if (this.watched.has(root) && this.context === context) this.refresh(cx);
        }
      } catch {}
      this.watched.delete(root);
    });
  }

  reset(context) {
    this.context = context; this.sections = []; this.open = null; this.checkouts = null; this.picking = false;
    this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null;
    this.watched = new Set(); this.closed = false; this.agentAt = null; this.picked = null; this.pickedFiles = [];
  }

  // ---------- scope: uncommitted / branch / commits ----------
  filesOf(s) {
    if (this.scope === "branch") return s.branchInfo?.files ?? [];
    if (this.scope === "commits") return this.picked && this.picked.root === s.root ? this.pickedFiles : [];
    return s.files;
  }
  setScope(scope, cx) {
    if (scope === this.scope && !this.picked) return;
    this.scope = scope; save("scope", scope);
    this.picked = null; this.pickedFiles = []; this.open = null; this.closed = false; this.setLines([]);
    this.loading = false; this.refresh(cx); cx.notify();
  }
  openCommit(c, cx) {
    this.picked = c; this.pickedFiles = []; this.open = null; this.closed = false; this.setLines([]); cx.notify();
    const context = this.context;
    cx.spawn(async (cx) => {
      const files = await readCommitFiles(c).catch(() => []);
      if (this.picked !== c) return;
      this.pickedFiles = files;
      const s = this.sections.find((x) => x.root === c.root);
      if (files.length && s) { this.open = { root: c.root, path: files[0].path }; try { await this.load(this.open, context); } catch {} }
      cx.notify();
    });
  }
  leaveCommit(cx) { this.picked = null; this.pickedFiles = []; this.open = null; this.setLines([]); cx.notify(); }
  setTree(on, cx) { this.tree = on; save("tree", on); cx.notify(); }
  setWrap(on, cx) { this.wrap = on; save("wrap", on); cx.notify(); }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const loc = location(), context = key();
    if (context !== this.context) this.reset(context);
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        let cwd = loc.cwd;
        if (loc.mode === "agent") {
          const where = await agentRoots(loc.agent);
          if (!where) throw new Error("Can't tell where that agent works (only Claude Code agents are supported)");
          this.agentAt = where.roots[0] ?? where.cwd;
          if (!where.roots.length) throw new Error(`That agent isn't working in a git repository (${tilde(where.cwd ?? "?")})`);
          // Every checkout it works in is a section; matching repos on the same branch come after, once each.
          const sections = [];
          for (const root of where.roots) { try { sections.push(await readSection(root, null)); } catch {} }
          if (pairing && sections[0] && !DEFAULT_BRANCHES.includes(sections[0].branch)) {
            for (const p of await partners(sections[0].main, sections[0].branch, sections[0].root)) {
              if (sections.some((s) => same(s.root, p))) continue;
              // A repo the agent already works in keeps the agent's checkout, not the matching one.
              try { const s = await readSection(p, null); if (!sections.some((x) => same(x.main, s.main))) sections.push(s); } catch {}
            }
          }
          await this.show(sections, context, cx); return;
        }
        if (!cwd) { this.sections = []; this.error = null; return; }
        let top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on: loc.on });
        // The focused terminal wandered out of git (cd ~): show the space's own folder instead.
        if (top.code !== 0 && loc.mode === "focus" && loc.fallback && loc.fallback !== cwd) top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: loc.fallback, on: loc.on });
        if (key() !== context) return;
        if (top.code !== 0) { this.sections = []; this.open = null; this.setLines([]); this.error = `Not a git repository: ${tilde(cwd)}`; return; }
        const first = await readSection(top.stdout.trim(), loc.on);
        const sections = [first];
        if (pairing && !loc.on && !DEFAULT_BRANCHES.includes(first.branch)) {
          for (const p of await partners(first.main, first.branch, first.root)) {
            try { sections.push(await readSection(p, null)); } catch {}
          }
        }
        await this.show(sections, context, cx);
      } catch (e) { if (key() === context) { this.sections = []; this.error = String(e.message ?? e); } }
      finally { this.loading = false; cx.notify(); }
    });
  }

  // Shows read sections (still the same place), watches them and keeps or picks the open diff.
  async show(sections, context, cx) {
    if (key() !== context) return;
    // A main checkout nobody is working in (on main/master, nothing uncommitted) isn't shown, unless it's all
    // there is, or it's the folder you're in yourself (following focus). Files and PRs read this list too.
    const loc = location(), idle = (x) => pref("hideIdleMain") && ["main", "master"].includes(x.branch) && !x.files.length;
    const kept = sections.filter((x, i) => !idle(x) || (i === 0 && loc.mode !== "agent"));
    // All idle: just the first (where you or the agent are), not every one of them.
    sections = kept.length ? kept : sections.slice(0, 1);
    if (this.scope !== "working") for (const s of sections) {
      s.branchInfo = await readBranch(s.root, s.on).catch(() => null);
      if (this.scope === "commits") s.commitList = s.branchInfo ? await readCommits(s.branchInfo).catch(() => []) : [];
    }
    if (this.picked?.sha === WORKTREE) this.pickedFiles = await readCommitFiles(this.picked).catch(() => this.pickedFiles);
    if (key() !== context) return;
    this.sections = sections; this.error = null;
    handOver(sections[0]);
    publishSession(sections);
    for (const s of sections) if (!s.on) this.watch(s.root, cx);
    const all = sections.flatMap((s) => this.filesOf(s).map((f) => ({ s, f })));
    if (this.open && !all.some(({ s, f }) => s.root === this.open.root && f.path === this.open.path)) { this.open = null; this.setLines([]); }
    if (!this.open && !this.closed && all.length) this.open = { root: all[0].s.root, path: all[0].f.path };
    if (this.open) {
      try { await this.load(this.open, context); }
      catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
    }
  }

  async load(open, context) {
    const s = this.sections.find((x) => x.root === open.root), file = s && this.filesOf(s).find((f) => f.path === open.path);
    if (!file) return;
    // Uncommitted (and a commit list's "Uncommitted changes"): against HEAD. Branch: against the merge-base.
    // A commit: what it changed (git show).
    let range = ["diff", ...(s.hasHead ? ["HEAD"] : [])];
    if (this.scope === "branch") range = ["diff", ...(s.branchInfo?.mb ? [s.branchInfo.mb] : [])];
    if (this.scope === "commits" && this.picked && this.picked.sha !== WORKTREE) range = ["show", "--format=", this.picked.sha];
    let lines;
    if (file.fresh || (this.scope === "working" && !s.hasHead && file.status === "A")) {
      const r = await exec("head", ["-c", "400000", `${s.root}/${file.path}`], { on: s.on }).catch(() => null);
      const text = r?.code === 0 ? r.stdout : null;
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.replace(/\n$/, "").split("\n").slice(0, 1500).map((l) => `+${l}`)];
      }
    } else {
      const r = await git(s.root, s.on, [...range, "--no-ext-diff", "--no-textconv", "--no-color", "--", file.path]);
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : file.status === "D" ? "File deleted" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === open) this.setLines(lines.slice(0, 1500).map((line) => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line), langOf(file.path));
  }

  // A diff gets highlighted rows (lib/diff.js); anything else (a message) shows as plain lines.
  setLines(lines, lang = null) {
    this.rows = lines[0]?.startsWith("@@") ? parseDiff(lines, lang) : lines.map((text) => ({ kind: "", text }));
    this.diffWidth = Math.max(300, ...this.rows.map((row) => (row.text.length + 1) * 7 + 50));
  }

  pick(s, path, cx) {
    const was = this.open && this.open.root === s.root && this.open.path === path;
    this.open = was ? null : { root: s.root, path }; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context, open = this.open;
    if (open) cx.spawn(async (cx) => {
      try { await this.load(open, context); }
      catch (e) { if (key() === context && this.open === open) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(s, cx) {
    if (!s || !this.sections.includes(s) || !this.message.trim() || this.busy || this.loading || this.context !== key()) return;
    const context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: s.root, on: s.on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        // Keep the message while another section still has changes: the same message often fits both.
        if (key() === context && !this.sections.some((x) => x !== s && x.files.length)) { this.message = ""; this.input.set_value(""); }
        if (key() === context) this.note = null;
      } catch (e) { if (key() === context) this.note = `Commit in ${s.name} failed: ${e.message ?? e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  // ---------- the checkout picker ----------
  togglePicker(cx) {
    if (this.picking) { this.picking = false; cx.notify(); return; }
    const s = this.sections[0];
    this.picking = true; this.checkouts = null; cx.notify();
    if (!s) { this.checkouts = []; return; }
    const context = this.context;
    cx.spawn(async (cx) => {
      const list = await checkoutsOf(s.root, s.on);
      if (this.context === context) { this.checkouts = list; cx.notify(); }
    });
  }

  choose(pin, cx) {
    const { space } = location();
    if (!space) return;
    if (pin) pins[space] = pin; else delete pins[space];
    save("pins", pins);
    this.picking = false;
    this.refresh(cx);
    cx.notify();
  }

  followAgent(cx) {
    const a = tabAgents()[0];
    if (a) this.choose({ agent: a.terminal }, cx);
  }

  togglePairing(cx) {
    pairing = !pairing; save("pairing", pairing);
    this.refresh(cx); cx.notify();
  }

  checkoutBar(t) {
    const loc = location(), first = this.sections[0], agent = tabAgents()[0];
    const following = loc.mode === "agent";
    const mode = loc.mode === "pinned" ? "pinned" : following ? `follows agent ${loc.agent}` : "follows focus";
    const tone = loc.mode === "focus" ? t.dim : t.accent;
    const bar = h_flex().h(30).flex_none().pl(14).pr(6).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
      .child(h_flex().id("checkout").flex_1().min_w(0).h_full().gap(6).items_center().cursor_pointer().on_click((_e, cx) => this.togglePicker(cx))
        .child(div().flex_none().font_medium().text_color(loc.mode === "focus" ? t.foreground : t.accent).child(first?.branch ?? "—"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(first ? tilde(first.root) : following && this.agentAt ? tilde(this.agentAt) : "no repository"))
        .child(div().flex_none().text_size(10).text_color(tone).child(`${mode} ▾`)))
      .when(Boolean(agent) && !following, (el) => el.child(h_flex().id("follow-agent").flex_none().h(22).px(8).rounded(6).items_center()
        .border_1().border_color(t.border).text_size(10.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.followAgent(cx)).child("Follow agent")))
      .when(following, (el) => el.child(h_flex().id("unfollow-agent").flex_none().h(22).px(8).rounded(6).items_center()
        .bg(t.selected).text_size(10.5).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.choose(null, cx)).child("Following ✕")));
    if (!this.picking) return [bar];
    const item = (id, label, sub, active, act) => h_flex().id(id).h(36).flex_none().px(14).gap(8).items_center().cursor_pointer()
      .when(active, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(12).truncate().child(label))
        .child(div().text_size(10.5).text_color(t.dim).truncate().child(sub)));
    const rows = [item("pick-follow", "Follow focused terminal", "the folder of the terminal you're in", loc.mode === "focus", (cx) => this.choose(null, cx))];
    for (const a of tabAgents()) rows.push(item(`pick-agent-${a.terminal}`, `Follow agent ${a.title || a.terminal}`, "where this Claude Code agent works now, even in another worktree", following && loc.agent === a.terminal, (cx) => this.choose({ agent: a.terminal }, cx)));
    for (const c of this.checkouts ?? []) rows.push(item(`pick-${c.path}`, c.main ? `${c.branch ?? "detached"} (main checkout)` : c.branch ?? "detached", tilde(c.path), loc.mode === "pinned" && same(c.path, first?.root), (cx) => this.choose({ path: c.path }, cx)));
    rows.push(item("pick-pairing", `Matching branch in other repos: ${pairing ? "on" : "off"}`, "sibling repos with a checkout on the same branch show below", false, (cx) => this.togglePairing(cx)));
    return [bar, v_flex().id("checkout-list").flex_none().max_h(300).overflow_y_scroll().border_b(1).border_color(t.border).bg(t.raised)
      .children(rows).when(this.checkouts === null, (e) => e.child(div().px(14).py(8).text_size(11).text_color(t.dim).child("Reading worktrees…")))];
  }

  // Display only: a virtual list's rows may not have handlers. Wrapping: the line in rows of `cols` characters.
  diffRow(row, t, colors, cols) {
    const { kind, text, tokens } = row, n = kind === "-" ? row.old : row.new;
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    const span = (k) => div().flex_none().whitespace_nowrap().text_color(colors[k.kind] ?? t.foreground).child(k.text);
    const lines = cols && kind ? wrapTokens(row, cols) : null;
    return h_flex().w_full().h(20 * (lines?.length ?? 1)).flex_none().items_start().when(kind === "+", (e) => e.bg(t.ansi2 + "1c")).when(kind === "-", (e) => e.bg(t.ansi1 + "1c"))
      .child(div().w(34).h(20).flex_none().pr(6).text_right().text_color(t.dim).child(n == null ? "" : String(n)))
      .child(div().w(12).h(20).flex_none().text_color(kind === "+" ? t.ansi2 : t.ansi1).child(kind === "+" ? "+" : kind === "-" ? "−" : ""))
      .children(lines ? [v_flex().flex_1().min_w(0).children(lines.map((l) => h_flex().h(20).flex_none().children(l.map(span))))]
        : tokens ? tokens.map(span) : [div().flex_none().whitespace_nowrap().text_color(t.dim).child(text || " ")]);
  }

  // The whole branch (everything a PR would contain) of every repo shown here, in one review tab.
  openBranchReview() {
    const loc = location(), secs = this.sections;
    if (!secs.length) return;
    run("tab.new", { name: `review ${secs[0].branch ?? "branch"}`, mod: "ks-review",
      props: { scope: "branch", roots: secs.map((s) => s.root), on: secs[0].on, agent: loc.mode === "agent" ? loc.agent : null, space: loc.space } });
  }

  // A file in the review mod, compared the way this panel compares it now (uncommitted, branch, one commit).
  reviewProps(s, path) {
    const loc = location(), f = this.filesOf(s).find((x) => x.path === path);
    return { root: s.root, path, on: s.on, status: f?.status, agent: loc.mode === "agent" ? loc.agent : null, space: loc.space,
      against: this.scope === "branch" ? s.branchInfo?.mb ?? null : null, commit: this.scope === "commits" ? this.picked : null, wrap: this.wrap };
  }
  openReview(s, path) {
    run("tab.new", { name: `review ${path.split("/").pop()}`, mod: "ks-review", props: this.reviewProps(s, path) });
  }
  // Expanded: the file's review in a floating window, one per file (several can be open), movable by its
  // header, sized with its − / + / ⛶ (the last size is remembered). Expanding the same file again brings its
  // window back in its place.
  expand(s, path) {
    const size = shared("ks-review.window") ?? { w: 0.7, h: 0.8 }, key = `ks-review:${s.root}:${path}`;
    openOverlay({ mod: "ks-review", kind: "window", key, width: size.w, height: size.h,
      props: { ...this.reviewProps(s, path), windowKey: key, winSize: size } });
  }
  // The file itself (as it is now) in a preview tab.
  openFile(s, path) {
    run("tab.new", { name: path.split("/").pop(), mod: "ks-preview", props: { file: `${s.root}/${path}`, on: s.on ?? null } });
  }

  // tree: indented by depth with the name only; flat: folder dimmed, then the name.
  fileRow(s, f, t, depth = null) {
    const parts = f.path.split("/"), name = parts.pop();
    const on = this.open && this.open.root === s.root && this.open.path === f.path;
    const n = comments.countOf(s.root, f.path);
    return h_flex().id(`change-${this.scope}-${s.root}-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .when(depth != null, (e) => e.pl(8 + depth * 14))
      .when(on, (e) => e.bg(t.selected)).hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.pick(s, f.path, cx))
      .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" || f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
      .child(depth != null ? div().flex_1().min_w(0).truncate().child(name)
        : h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
      .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
      .when(n > 0, (e) => e.child(div().px(5).rounded(8).bg(t.accent).text_size(10).text_color(t.background).child(`● ${n}`)))
      .child(div().id(`review-${this.scope}-${s.root}-${f.path}`).px(6).py(1).rounded(5).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
        .hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.openReview(s, f.path); }).child("Review"));
  }

  filesInto(s, files, t, out, rootKey) {
    if (!this.tree) { for (const f of files) out.push(this.fileRow(s, f, t)); return; }
    for (const r of treeRows(files, this.collapsed, rootKey)) {
      if (r.t === "file") { out.push(this.fileRow(s, r.f, t, r.depth)); continue; }
      out.push(h_flex().id(`dir-${this.scope}-${r.key}`).h(24).flex_none().pl(8 + r.depth * 14).pr(8).gap(6).items_center().rounded(7).cursor_pointer()
        .text_size(12).text_color(t.muted).hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { if (this.collapsed.has(r.key)) this.collapsed.delete(r.key); else this.collapsed.add(r.key); cx.notify(); })
        .child(div().w(12).flex_none().text_color(t.dim).child(r.open ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().child(r.name))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${r.c}`))
        .when(r.a > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`+${r.a}`)))
        .when(r.d > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child(`−${r.d}`))));
    }
  }

  scopeBar(t) {
    const seg = (id, label, on, act) => div().id(id).h(22).px(8).flex().items_center().rounded(5).cursor_pointer().text_size(11)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).hover((st) => st.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    const showingFiles = this.scope !== "commits" || Boolean(this.picked);
    return h_flex().h(32).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
        .child(seg("scope-working", "Uncommitted", this.scope === "working", (cx) => this.setScope("working", cx)))
        .child(seg("scope-branch", "Branch", this.scope === "branch", (cx) => this.setScope("branch", cx)))
        .child(seg("scope-commits", "Commits", this.scope === "commits", (cx) => this.setScope("commits", cx))))
      .child(div().flex_1())
      .when(showingFiles, (e) => e.child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
        .child(seg("view-tree", "Tree", this.tree, (cx) => this.setTree(true, cx)))
        .child(seg("view-flat", "Flat", !this.tree, (cx) => this.setTree(false, cx)))));
  }

  // Above the diff: the open file and what to do with it.
  diffBar(t) {
    const s = this.open && this.sections.find((x) => x.root === this.open.root);
    if (!s) return [];
    const path = this.open.path;
    const button = (id, label, act, on = false) => div().id(id).flex_none().h(22).px(7).flex().items_center().rounded(5).cursor_pointer().text_size(10.5)
      .bg(on ? t.selected : t.background).border_1().border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.muted)
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => act(cx)).child(label);
    return [h_flex().h(30).flex_none().px(10).gap(5).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(path))
      .child(button("diff-wrap", "Wrap", (cx) => this.setWrap(!this.wrap, cx), this.wrap))
      .child(button("diff-expand", "Expand", () => this.expand(s, path)))
      .child(button("diff-review", "Review", () => this.openReview(s, path)))
      .child(button("diff-open", "Open file", () => this.openFile(s, path)))];
  }

  // ks: focus mode dims this until hovered (lib/focus.js).
  render(cx) { return dimmed(this, this.renderInner(cx)); }

  renderInner(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), secs = this.sections, multi = secs.length > 1;
    const files = secs.flatMap((s) => this.filesOf(s));
    const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
    const listRows = [];
    let listHeight = 12;
    const push = (el, h) => { listRows.push(el); listHeight += h; };
    for (const s of secs) {
      const info = s.branchInfo, shown = this.filesOf(s);
      if (this.scope === "commits" && this.picked && this.picked.root !== s.root) continue;
      const folded = this.folded.has(s.root);
      if (multi || this.scope !== "working") push(v_flex().id(`sec-${s.root}`).flex_none().px(8).pt(4).pb(4).mt(listRows.length ? 4 : 0).gap(1)
        .rounded(7).cursor_pointer().hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { if (this.folded.has(s.root)) this.folded.delete(s.root); else this.folded.add(s.root); cx.notify(); })
        .child(h_flex().gap(6).items_center().text_size(11)
          .child(div().w(10).flex_none().text_color(t.dim).child(folded ? "▸" : "▾"))
          .child(div().flex_none().font_semibold().text_color(t.foreground).child(s.name))
          .child(div().flex_none().text_color(t.muted).child(s.branch ?? ""))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(s.root)))
          .child(div().flex_none().text_color(t.dim).child(this.scope === "commits" && !this.picked ? "" : `${shown.length}`)))
        .when(this.scope !== "working" && Boolean(info), (e) => e.child(div().text_size(10.5).text_color(t.dim).truncate()
          .child(`${info?.base ? `vs ${info.base}` : "no base branch"} · ${info?.commits ?? 0} commit${info?.commits === 1 ? "" : "s"}`))), this.scope === "working" ? 30 : 44);
      if (folded && (multi || this.scope !== "working")) continue;
      if (this.scope === "commits" && !this.picked) {
        const list = s.commitList ?? [];
        if (!list.length) push(div().px(30).h(22).flex_none().text_size(11).text_color(t.dim).child(s.commitList ? "No commits on this branch yet" : "Reading commits…"), 22);
        for (const c of list) push(v_flex().id(`commit-${s.root}-${c.sha}`).flex_none().px(10).py(4).gap(1).rounded(7).cursor_pointer()
          .hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.openCommit(c, cx))
          .child(div().text_size(12).truncate().text_color(c.sha === WORKTREE ? t.accent : t.foreground).child(c.subject))
          .child(div().text_size(10.5).text_color(t.dim).truncate().child(c.sha === WORKTREE ? "not committed yet" : `${c.short} · ${c.author} · ${c.when}`)), 40);
        continue;
      }
      if (this.scope === "commits" && this.picked) {
        push(div().id("back-commits").flex_none().px(8).py(3).rounded(6).cursor_pointer().text_size(11).text_color(t.accent).hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => this.leaveCommit(cx)).child(`← All commits · ${this.picked.short ? `${this.picked.short} ` : ""}${this.picked.subject}`), 24);
      }
      const before = listRows.length;
      this.filesInto(s, shown, t, listRows, `${this.scope}\n${this.picked?.sha ?? ""}\n${s.root}`);
      listHeight += (listRows.length - before) * 28;
      const none = this.scope === "working" ? "No uncommitted changes" : this.scope === "branch" ? "No changes on this branch" : "No files in this commit";
      if (!shown.length && (multi || this.scope !== "working")) push(div().px(30).h(22).flex_none().text_size(11).text_color(t.dim).child(none), 22);
      if (s.limited && this.scope === "working") push(div().px(8).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files"), 20);
    }
    const empty = this.error || (this.loading && !secs.length ? "Loading changes…" : secs.length ? "No uncommitted changes" : "No folder");
    const can = Boolean(this.message.trim()) && !this.busy && !this.loading;
    const commitButton = (s, label) => div().id(`commit-${s.root}`).h(32).px(12).flex().flex_none().items_center().rounded(8)
      .bg(can ? t.solid : t.raised).text_color(can ? t.solid_foreground : t.dim).text_size(12).when(can, (e) => e.cursor_pointer())
      .on_click((_e, cx) => this.commit(s, cx)).child(label);
    const dirty = secs.filter((s) => s.files.length), colors = colorsFor(t);
    const pending = comments.all().filter((c) => secs.some((s) => s.root === c.root)), loc = location();
    const agent = comments.pickAgent(loc.mode === "agent" ? loc.agent : null, loc.space);
    // Wrapping needs the diff's width (on_size_change, in window pixels); rows then take as many lines as they wrap to.
    const cols = this.wrap && this.diffPx ? colsFor(this.diffPx, 11, 34 + 12 + 10) : null;
    const sizes = cols ? this.rows.map((r) => (r.kind && r.kind !== "@" ? 20 * wrapTokens(r, cols).length : 20)) : 20;
    const list = v_virtual_list(`changes-diff-${this.wrap ? "w" : "n"}`, this.rows.length, sizes, (i) => String(i),
      (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t, colors, cols))).size_full();
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); } })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${files.length} files${multi ? ` · ${secs.length} repos` : ""}`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))
        .when(secs.length > 0, (e) => e.child(div().id("review-branch").ml(4).h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
          .text_size(11).text_color(t.foreground).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click(() => this.openBranchReview()).child("Review branch"))))
      .children(this.checkoutBar(t))
      .child(this.scopeBar(t))
      .child(div().flex_1().min_h(44).max_h(Math.max(listHeight, 44)).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(listRows)
          .when(!secs.length, (e) => e.child(div().p(8).text_color(this.error ? t.ansi1 : t.dim).child(empty))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .children(this.diffBar(t))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .on_size_change((size, cx) => { const w = size.width / (settings().zoom || 1); if (Math.abs(w - this.diffPx) > 2) { this.diffPx = w; if (this.wrap) cx.notify(); } })
        .child(this.wrap ? div().size_full().child(list)
          : div().id("changes-diff-x").size_full().overflow_x_scrollbar().child(div().w_full().min_w(this.diffWidth).h_full().child(list)))
        .child(Scrollbar.vertical(`changes-diff-${this.wrap ? "w" : "n"}`).viewport_from_layout().absolute().inset_0())
        .when(!this.open && files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      // Review comments on these repos (made in review tabs), all at once to the agent.
      .when(pending.length > 0, (e) => e.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().border_t(1).border_color(t.border).bg(t.raised).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().child(`${pending.length} review comment${pending.length === 1 ? "" : "s"} · ${agent ? `to ${agent.title}` : "no agent running"}`))
        .child(div().id("send-comments").h(26).px(10).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
          .on_click(() => openOverlay({ mod: "ks-send", kind: "dialog", width: 0.62, height: 0.82,
            props: { roots: secs.map((s) => s.root), agent: loc.mode === "agent" ? loc.agent : null, space: loc.space } })).child("Review & send…"))))
      // Committing only makes sense for uncommitted changes.
      .when(this.scope === "working", (e) => e.child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .children(this.busy ? [div().h(32).px(12).flex().items_center().text_size(12).text_color(t.dim).child("Committing…")]
          : dirty.length > 1 ? dirty.map((s) => commitButton(s, `Commit ${s.name}`))
          : [commitButton(dirty[0] ?? secs[0] ?? { root: "none", name: "" }, "Commit")])));
  }
}
