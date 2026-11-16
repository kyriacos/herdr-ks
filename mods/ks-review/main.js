// Review in a tab of its own: one file, or a whole branch (everything a PR would contain: the commits since
// the branch left its base plus uncommitted work, over one or more repos). Inline or side by side, syntax
// colored, with comments on lines or files that go to an agent one at a time or all at once.
//
// Opened with tab.new { mod: "ks-review", props }:
//   one file: { root, path, on?, agent?, space?, mode? }            (Changes "Review", Files "Review & comment")
//   a branch: { scope: "branch", roots: [root, ...], on?, agent?, space?, mode? }   (Changes "Review branch")
//
// GPUI rule that shapes this file: nothing inside a virtual list's row renderer may have a handler
// (on_click etc. throw there). So diff rows are display only; the list reports clicks with on_item_click(key),
// the element around it records which half was pressed (side by side), and the comment box and the
// comments' buttons live outside the list.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, exec, run, theme, settings, watchFolder, closeOverlay, openOverlay, shared, setShared, nextCommand } from "herdr";
import { trackActive, takeRequest, raiseStrip } from "./lib/windows.js";
import { langOf, colorsFor } from "./lib/highlight.js";
import { parseDiff, fileRows, splitRows, wrapTokens, colsFor, charWidth, longest } from "./lib/diff.js";
import * as comments from "./lib/comments.js";
import { READ, git, base, WORKTREE, readBranch, readCommits, readCommitFiles, treeRows, candidates } from "./lib/branch.js";

const MAX_LINES = 20000, ROW = 20;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const wrapLines = (text, cols = 100) => text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cols)), 0);
const where = (c) => c.line == null ? "Whole file" : `Line ${c.line}${c.side === "old" ? " (removed)" : ""}`;

export default class Review extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.branchMode = p.scope === "branch";
    this.on = p.on ?? null; this.agent = p.agent ?? null; this.space = p.space ?? null;
    this.mode = p.mode ?? load("mode", "inline"); // "inline" | "split"
    this.wrap = p.wrap ?? load("wrap", false); this.codeWidth = 0; this.maxLen = 0; this.overlay = p.overlay ?? null;
    // Shown as a floating window (Changes "Expand"): its key (one window per file), size (shares of the app
    // window) and the props to reopen it with when resized. Herdr can't resize a window, so a resize reopens
    // it at the new size under the same key, which keeps its place.
    this.windowKey = p.windowKey ?? null; this.winSize = p.winSize ?? { w: 0.7, h: 0.8 }; this.prevSize = p.prevSize ?? null;
    this.openProps = Object.fromEntries(Object.entries(p).filter(([k]) => !["overlay", "zen", "at", "from"].includes(k)));
    // Zen (ks-zen): this review in the zen window is a copy, opened with { zen: true }, the file it was on (`at`)
    // and `from` (the tab copy's id). Esc and ✕ leave zen; when it closes, the tab copy goes to the file the zen
    // copy was on.
    this.zen = Boolean(p.zen); this.id = p.from ?? `rv-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    this.wantAt = p.at ?? null; this.jumpFirst = true;
    this.repos = []; this.files = []; this.cur = null; this.viewed = new Set();
    // Branch review's left column: "files" (the whole branch) or "commits" (pick one: this.commit); tree or flat.
    this.left = p.left === "commits" ? "commits" : "files"; this.tree = load("tree", true); this.collapsed = new Set(); this.commit = null;
    this.commits = this.left === "commits" ? [] : null; // [] : read with the branch (reloadBranch)
    // Which worktrees: all included ones in one view, or one alone (this.only); more can be added.
    this.only = null; this.adding = false; this.candidates = null;
    this.foldedRepos = new Set(); // worktrees folded in the file list (click a worktree's header)
    this.rows = []; this.status = "loading"; this.composer = null; this.half = "new"; this.list = [];
    this.handle = cx.focus_handle();
    this.handle.focus(); // vim keys work as soon as the tab opens
    // A floating review takes the key modes' resize keys while it has the keyboard (lib/windows.js): - = narrower /
    // wider, _ + shorter / taller, 0 its default size.
    if (this.windowKey) trackActive(this, cx, this.windowKey, "ks-review");
    // "focus": Herdr gives this pane the keyboard (pane.go onto it, back from zen). "winresize": see above.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus" && !this.windowKey && !this.zen) { this.handle.focus(); cx.notify(); continue; }
        if (c !== "winresize" || !this.windowKey) continue;
        const r = takeRequest(this, this.windowKey);
        if (!r) continue;
        const step = 0.02 * (r.dir || 1), sz = this.winSize;
        if (r.reset) this.resizeWindow({ w: 0.7, h: 0.8 }, null);
        else this.resizeWindow({ w: sz.w + (r.kind === "tall" ? 0 : step), h: sz.h + (r.kind === "wide" ? 0 : step) });
        raiseStrip();
      }
    });
    if (!this.windowKey) this.offerZen(cx);
    this.scroll = VirtualListScrollHandle.new();
    this.cursorAt = 0; this.visible = { start: 0, end: 0 }; this.pendingG = false;
    this.input = InputState.new({ placeholder: "Your comment, then Enter" });
    this.input.on("submit", (_e, cx) => this.saveComment(cx));
    this.roots = this.branchMode ? (p.roots ?? []).filter(Boolean) : p.root ? [p.root] : [];
    this.bases = p.bases ?? {}; // root -> base ref (a PR's base branch); else origin's default
    if (!this.roots.length || (!this.branchMode && !p.path)) { this.status = "nothing"; this.error = "Nothing to review"; return; }
    if (this.branchMode) this.reloadBranch(cx, true);
    else {
      // One file, against HEAD by default; `against` (a ref: the branch's merge-base) or `commit` ({ sha, short,
      // subject }) when opened from the Changes panel's Branch or Commits view.
      this.fileAgainst = p.against ?? null; this.fileCommit = p.commit ?? null;
      this.files = [{ root: p.root, on: this.on, path: p.path, status: p.status }]; this.cur = 0; this.reloadFile(cx);
    }
    for (const root of this.roots) this.watchRoot(root, cx);
  }

  watchRoot(root, cx) {
    if (this.on) return;
    cx.spawn(async (cx) => {
      try { for (;;) { await watchFolder(root); if (!this.roots.includes(root)) return; if (this.branchMode) this.reloadBranch(cx, false); else this.reloadFile(cx); } } catch {}
    });
  }

  // Shared "ks-review.zen" = { props }: what ks-zen opens when zen is asked for while a review tab has the keyboard
  // (the review you're in, on the file you're on). Kept current every 300 ms by the copy that has the keyboard.
  offerZen(cx) {
    cx.timer.every(300, () => {
      const o = shared("ks-review.zen");
      // Back from zen: the tab copy picks up where the zen copy was.
      if (!this.zen && o?.fromZen && o.props?.from === this.id && !shared("ks-zen.state")?.win && o.n !== this.synced) {
        this.synced = o.n; const at = o.props.at, pr = o.props;
        if (pr.mode && pr.mode !== this.mode) this.mode = pr.mode;
        if (pr.wrap != null) this.wrap = pr.wrap;
        const i = at ? this.files.findIndex((f) => f.root === at.root && f.path === at.path) : -1;
        if (i >= 0 && i !== this.cur) this.select(i, cx); else cx.notify();
      }
      if (!this.handle.is_focused()) return;
      const f = this.file();
      const props = { ...this.openProps, mode: this.mode, wrap: this.wrap, from: this.id, ...(f ? { at: { root: f.root, path: f.path } } : {}) };
      const was = o?.props;
      if (!was || JSON.stringify(was) !== JSON.stringify(props) || Boolean(o.fromZen) !== this.zen) setShared("ks-review.zen", { props, fromZen: this.zen, n: Date.now() });
    });
  }
  leaveZen() { run("ks-zen.toggle"); }

  // ---------- changes (the runs of added / removed lines) in this file ----------
  changeStarts() { return this.list.reduce((out, it, i) => (this.isChange(it) && !this.isChange(this.list[i - 1]) ? [...out, i] : out), []); }
  // Which change the cursor is in or after (1-based; 0 above the first), and how many.
  changeAt() {
    const s = this.changeStarts();
    return { n: s.filter((i) => i <= this.cursorAt).length, of: s.length };
  }
  nextChange(dir, cx) {
    const s = this.changeStarts();
    const i = dir > 0 ? s.find((i) => i > this.cursorAt) : [...s].reverse().find((i) => i < this.cursorAt);
    if (i != null) { this.moveCursor(i, cx); this.scroll.scroll_to_item(i, "center"); }
  }

  file() { return this.cur == null ? null : this.files[this.cur] ?? null; }
  repoOf(f) { return this.repos.find((r) => r.root === f?.root) ?? null; }

  // ---------- loading ----------
  reloadBranch(cx, first) {
    if (this.loadingList) return;
    this.loadingList = true;
    cx.spawn(async (cx) => {
      try {
        const repos = [];
        for (const root of this.roots) { try { repos.push(await readBranch(root, this.on, this.bases[root] ?? null)); } catch {} }
        const keep = this.file() ?? this.wantAt;
        this.repos = repos;
        if (this.commits) this.commits = (await Promise.all(repos.map((r) => readCommits(r).catch(() => [])))).flat();
        if (this.commit) {
          // Looking at one commit: its files stay; uncommitted ones may have changed.
          if (this.commit.sha === WORKTREE) this.files = await readCommitFiles(this.commit).catch(() => this.files);
        } else this.files = this.visibleFiles();
        const at = keep ? this.files.findIndex((f) => f.root === keep.root && f.path === keep.path) : -1;
        if (at >= 0) this.cur = at;
        else if (this.files.length) { this.cur = 0; }
        else { this.cur = null; this.rows = []; this.status = "empty"; }
        if (this.cur != null && (first || at < 0)) { this.viewed.add(this.keyOf(this.file())); }
        this.error = null;
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loadingList = false; cx.notify(); if (this.cur != null) this.reloadFile(cx); }
    });
  }

  reloadFile(cx) {
    const f = this.file();
    if (!f || this.loadingFile) return;
    this.loadingFile = true;
    const want = this.keyOf(f);
    cx.spawn(async (cx) => {
      try {
        const lang = langOf(f.path), repo = this.repoOf(f);
        let against, shown = null;
        if (this.commit && this.commit.sha !== WORKTREE) shown = this.commit.sha;
        else if (this.commit) against = ["HEAD"];
        else if (repo) against = repo.mb ? [repo.mb] : ["--cached"];
        else if (this.fileCommit && this.fileCommit.sha !== WORKTREE) shown = this.fileCommit.sha;
        else if (this.fileAgainst) against = [this.fileAgainst];
        else {
          const head = await git(f.root, f.on, ["rev-parse", "--verify", "HEAD"]);
          against = head.code === 0 ? ["HEAD"] : ["--cached"];
        }
        if (!repo && this.singleBranch === undefined) {
          const br = await git(f.root, f.on, ["branch", "--show-current"]);
          this.singleBranch = br.code === 0 ? br.stdout.trim() || "detached HEAD" : null;
        }
        const opts = ["--no-color", "--no-ext-diff", "--no-textconv", "-U100000"];
        const d = shown ? await git(f.root, f.on, ["show", "--format=", ...opts, shown, "--", f.path])
          : await git(f.root, f.on, ["diff", ...against, ...opts, "--", f.path]);
        const lines = d.code === 0 ? d.stdout.replace(/\n$/, "").split("\n") : [];
        const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
        let rows, status;
        if (firstHunk >= 0) { rows = parseDiff(lines.slice(firstHunk, firstHunk + MAX_LINES), lang); status = "changed"; }
        else {
          // No diff: untracked (all new), deleted, or unchanged (all context).
          if (shown) { rows = []; status = f.status === "D" ? "deleted" : "binary"; if (this.keyOf(this.file()) === want) { this.rows = rows; this.status = status; this.error = null; } return; }
          const tracked = (await git(f.root, f.on, ["ls-files", "--error-unmatch", "--", f.path])).code === 0;
          const r = await exec("head", ["-c", "2000000", `${f.root}/${f.path}`], { on: f.on });
          if (r.code !== 0) { rows = []; status = f.status === "D" ? "deleted" : "unreadable"; }
          else if (r.stdout.includes("\0")) { rows = []; status = "binary"; }
          else { rows = fileRows(r.stdout.split("\n").slice(0, MAX_LINES).join("\n"), lang, tracked ? " " : "+"); status = tracked ? "unchanged" : "new"; }
        }
        if (this.keyOf(this.file()) === want) { this.rows = rows; this.maxLen = longest(rows); this.status = status; this.error = null; }
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loadingFile = false; cx.notify(); if (this.keyOf(this.file()) !== want) this.reloadFile(cx); }
    });
  }

  keyOf(f) { return f ? `${this.commit?.sha ?? ""}\n${f.root}\n${f.path}` : ""; }

  // ---------- left column: files / commits, tree / flat ----------
  setLeft(view, cx) {
    if (view === this.left && !this.commit) return;
    this.left = view;
    if (this.commit) this.leaveCommit(cx);
    if (view === "commits" && !this.commits) cx.spawn(async (cx) => {
      this.commits = (await Promise.all(this.repos.map((r) => readCommits(r).catch(() => [])))).flat(); cx.notify();
    });
    cx.notify();
  }
  openCommit(c, cx) {
    this.commit = c; this.files = []; this.cur = null; this.rows = []; this.status = "loading"; this.composer = null; cx.notify();
    cx.spawn(async (cx) => {
      const files = await readCommitFiles(c).catch(() => []);
      if (this.commit !== c) return;
      this.files = files;
      if (files.length) this.select(0, cx); else { this.status = "empty"; cx.notify(); }
    });
  }
  leaveCommit(cx) {
    this.commit = null; this.composer = null;
    this.files = this.visibleFiles();
    this.cur = this.files.length ? 0 : null; this.rows = []; this.status = this.files.length ? "loading" : "empty";
    if (this.cur != null) this.reloadFile(cx);
    cx.notify();
  }
  setTree(on, cx) { this.tree = on; save("tree", on); cx.notify(); }
  foldRepo(root, cx) { if (this.foldedRepos.has(root)) this.foldedRepos.delete(root); else this.foldedRepos.add(root); cx.notify(); }
  // Next / previous file, skipping worktrees folded in the list.
  step(dir, cx) {
    for (let i = (this.cur ?? (dir > 0 ? -1 : this.files.length)) + dir; i >= 0 && i < this.files.length; i += dir) {
      if (!this.foldedRepos.has(this.files[i].root)) { this.select(i, cx); return; }
    }
  }

  // ---------- which worktrees ----------
  visibleRepos() { return this.only ? this.repos.filter((r) => r.root === this.only) : this.repos; }
  visibleFiles() { return this.visibleRepos().flatMap((r) => r.files.map((f) => ({ ...f, root: r.root, on: r.on }))); }
  label(r) { const wt = base(r.root); return wt.toLowerCase() === (r.name ?? "").toLowerCase() ? r.name : `${r.name} · ${wt}`; }
  setOnly(root, cx) {
    this.only = this.only === root ? null : root;
    if (this.commit) { this.leaveCommit(cx); return; }
    this.files = this.visibleFiles(); this.cur = this.files.length ? 0 : null; this.rows = []; this.status = this.files.length ? "loading" : "empty";
    if (this.cur != null) this.reloadFile(cx);
    cx.notify();
  }
  addRoot(root, cx) {
    if (!this.roots.some((r) => r.toLowerCase() === root.toLowerCase())) { this.roots = [...this.roots, root]; this.watchRoot(root, cx); }
    this.adding = false; this.only = null; this.reloadBranch(cx, false); cx.notify();
  }
  removeRoot(root, cx) {
    if (this.roots.length < 2) return;
    this.roots = this.roots.filter((r) => r !== root);
    if (this.only === root) this.only = null;
    if (this.commit?.root === root) this.commit = null;
    this.reloadBranch(cx, false); cx.notify();
  }
  toggleAdding(cx) {
    this.adding = !this.adding;
    if (this.adding && !this.candidates) cx.spawn(async (cx) => { this.candidates = await candidates(this.roots, this.on).catch(() => []); cx.notify(); });
    cx.notify();
  }

  worktreeBar(t) {
    const chip = (id, label, on, act, x) => h_flex().id(id).flex_none().h(22).pl(8).pr(x ? 4 : 8).gap(4).items_center().rounded(11).cursor_pointer().text_size(11)
      .bg(on ? t.selected : t.chrome).border_1().border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label)
      .when(Boolean(x), (e) => e.child(div().id(`${id}-x`).px(3).rounded(6).text_color(t.dim).hover((s) => s.text_color(t.ansi1))
        .on_click((_e, cx) => { cx.stop_propagation(); x(cx); }).child("×")));
    const bar = h_flex().id("worktrees").flex_none().px(12).py(5).gap(6).items_center().border_b(1).border_color(t.border).overflow_x_scroll()
      .child(chip("wt-all", `All · ${this.repos.length}`, !this.only, (cx) => this.only && this.setOnly(this.only, cx)))
      .children(this.repos.map((r) => chip(`wt-${r.root}`, `${this.label(r)} · ${r.branch ?? ""} · ${r.files.length}`, this.only === r.root,
        (cx) => this.setOnly(r.root, cx), this.repos.length > 1 ? (cx) => this.removeRoot(r.root, cx) : null)))
      .child(chip("wt-add", this.adding ? "Close" : "+ Add worktree", this.adding, (cx) => this.toggleAdding(cx)));
    if (!this.adding) return [bar];
    const have = new Set(this.roots.map((r) => r.toLowerCase()));
    const list = (this.candidates ?? []).filter((c) => !have.has(c.root.toLowerCase()));
    const byRepo = new Map();
    for (const c of list) (byRepo.get(c.repo) ?? byRepo.set(c.repo, []).get(c.repo)).push(c);
    return [bar, v_flex().id("wt-candidates").flex_none().max_h(260).overflow_y_scroll().border_b(1).border_color(t.border).bg(t.raised).py(4)
      .when(this.candidates === null, (e) => e.child(div().px(14).py(6).text_size(11).text_color(t.dim).child("Finding worktrees…")))
      .when(this.candidates !== null && !list.length, (e) => e.child(div().px(14).py(6).text_size(11).text_color(t.dim).child("No other worktrees next to these repos")))
      .children([...byRepo].flatMap(([repo, cs]) => [
        div().px(14).pt(6).pb(2).text_size(11).font_semibold().text_color(t.muted).child(repo),
        ...cs.map((c) => h_flex().id(`cand-${c.root}`).flex_none().mx(6).px(8).h(26).gap(8).items_center().rounded(6).cursor_pointer().text_size(11.5)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.addRoot(c.root, cx))
          .child(div().flex_none().child(c.branch)).child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(c.root))),
      ]))];
  }
  commitTag() {
    const c = this.commit ?? this.fileCommit;
    return c && c.sha !== WORKTREE ? c.short : null;
  }

  select(i, cx) {
    if (i == null || i < 0 || i >= this.files.length) return;
    this.cur = i; this.composer = null; this.rows = []; this.status = "loading"; this.cursorAt = 0; this.jumpFirst = true;
    this.viewed.add(this.keyOf(this.file()));
    this.reloadFile(cx); cx.notify();
  }

  // ---------- floating window: size ----------
  resizeWindow(size, prev = this.prevSize) {
    if (!this.windowKey) return;
    const w = Math.max(0.3, Math.min(1, size.w)), h = Math.max(0.3, Math.min(1, size.h));
    setShared("ks-review.window", { w, h });
    openOverlay({ mod: "ks-review", kind: "window", key: this.windowKey, width: w, height: h,
      props: { ...this.openProps, mode: this.mode, wrap: this.wrap, winSize: { w, h }, prevSize: prev } });
  }
  grow(by) { this.resizeWindow({ w: this.winSize.w + by, h: this.winSize.h + by }); }
  // A corner grip pressed: ks-resize takes the drag over the whole app and reopens this window at the new size.
  startResize(corner) {
    if (!this.windowKey || !this.winRect) return;
    openOverlay({ mod: "ks-resize", kind: "window", frame: "none", key: "ks-resize", width: 1, height: 1, at: { x: 0, y: 0 },
      props: { rect: this.winRect, corner, zoom: settings().zoom || 1,
        reopen: { mod: "ks-review", key: this.windowKey, props: { ...this.openProps, mode: this.mode, wrap: this.wrap } } } });
  }
  grips(t) {
    const g = (corner) => div().id(`grip-${corner}`).absolute().size(14)
      .when(corner.includes("t"), (e) => e.top(0)).when(corner.includes("b"), (e) => e.bottom(0))
      .when(corner.includes("l"), (e) => e.left(0)).when(corner.includes("r"), (e) => e.right(0))
      .when(corner === "tl" || corner === "br", (e) => e.cursor_nwse_resize()).when(corner === "tr" || corner === "bl", (e) => e.cursor_nesw_resize())
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.startResize(corner); })
      .when(corner === "br", (e) => e.child(div().absolute().right(3).bottom(3).size(7).border_r_2().border_b_2().border_color(t.dim)));
    return ["tl", "tr", "bl", "br"].map(g);
  }
  toggleMax() {
    if (this.prevSize) this.resizeWindow(this.prevSize, null);
    else this.resizeWindow({ w: 1, h: 1 }, this.winSize);
  }

  setMode(mode, cx) { this.mode = mode; save("mode", mode); this.cursorAt = 0; cx.notify(); }

  // ---------- vim keys ----------
  // j/k ↓/↑ line · ctrl-d/ctrl-u half page · gg/G top/bottom · n/N (or p, }/{) next/previous change · ]/[ or J/K next/previous
  // file (branch review) · c or Enter comment on the line · C comment on the file · s inline/side by side · Esc cancel.
  isChange(it) {
    return Boolean(it && ((it.t === "code" && it.r.kind !== " ") || (it.t === "pair" && (it.left !== it.right))));
  }
  moveCursor(to, cx) {
    const n = this.list.length;
    if (!n) return;
    this.cursorAt = Math.max(0, Math.min(n - 1, to));
    // Scroll only when the cursor nears an edge of what's on screen (the list's renderer records that).
    const { start, end } = this.visible;
    if (this.cursorAt < start + 2 || this.cursorAt > end - 3 || end <= start) this.scroll.scroll_to_item(this.cursorAt, "center");
    cx.notify();
  }
  commentAtCursor(cx) {
    const it = this.list[this.cursorAt];
    if (it?.t === "code") this.clickRow(it.key, cx);
    else if (it?.t === "pair") { this.half = it.right ? "new" : "old"; this.clickRow(it.key, cx); }
  }
  vimKey(e, cx) {
    const k = e.key, m = e.modifiers ?? {}, shift = Boolean(m.shift), page = Math.max(5, Math.floor((this.visible.end - this.visible.start) / 2) || 20);
    const is = (lower, upper) => (shift && k === lower) || k === upper;
    let handled = true;
    if (m.platform || m.alt) return false;
    if (m.control) {
      if (k === "d") this.moveCursor(this.cursorAt + page, cx);
      else if (k === "u") this.moveCursor(this.cursorAt - page, cx);
      else handled = false;
    } else if (k === "g" && !shift) {
      if (this.pendingG) { this.pendingG = false; this.moveCursor(0, cx); } else { this.pendingG = true; return true; }
    } else if (is("g", "G")) this.moveCursor(this.list.length - 1, cx);
    else if ((k === "j" && !shift) || k === "down") this.moveCursor(this.cursorAt + 1, cx);
    else if ((k === "k" && !shift) || k === "up") this.moveCursor(this.cursorAt - 1, cx);
    else if (is("]", "}") || (k === "n" && !shift)) this.nextChange(1, cx);
    else if (is("[", "{") || is("n", "N") || (k === "p" && !shift)) this.nextChange(-1, cx);
    else if (this.branchMode && (k === "]" || is("j", "J"))) this.step(1, cx);
    else if (this.branchMode && (k === "[" || is("k", "K"))) this.step(-1, cx);
    else if ((k === "c" && !shift) || k === "enter") this.commentAtCursor(cx);
    else if (is("c", "C")) this.openComposer({ line: null, side: null, code: "" }, cx);
    else if (k === "s" && !shift) this.setMode(this.mode === "split" ? "inline" : "split", cx);
    else if (k === "w" && !shift) this.setWrap(!this.wrap, cx);
    else if (k === "escape" && this.zen) this.leaveZen();
    else if (k === "escape" && this.overlay) closeOverlay(this.overlay);
    else handled = false;
    this.pendingG = false;
    return handled;
  }

  // ---------- comments ----------
  // The check before sending: every pending comment of this review in a dialog (ks-send).
  openSend() {
    openOverlay({ mod: "ks-send", kind: "dialog", width: 0.62, height: 0.82,
      props: { roots: this.roots, path: this.branchMode ? null : this.file()?.path ?? null, agent: this.agent, space: this.space } });
  }
  branchOf(f) { return this.repoOf(f)?.branch ?? this.singleBranch ?? null; }
  // A comment belongs to the version it was written on: the branch (no commit) or one commit.
  fileComments() { const f = this.file(); return f ? comments.of(f.root, f.path).filter((c) => (c.commit ?? null) === this.commitTag()) : []; }
  allComments() { return comments.all().filter((c) => this.roots.includes(c.root) && (this.branchMode || c.path === this.file()?.path)); }

  openComposer(anchor, cx) { // { line, side, code } | { line: null } for the whole file
    this.composer = anchor; this.input.set_value(""); this.input.focus(); cx.notify();
  }
  closeComposer(cx) { this.composer = null; this.handle.focus(); cx.notify(); }
  saveComment(cx) {
    const text = this.input.value().trim(), f = this.file();
    if (!text || !this.composer || !f) return;
    comments.add({ root: f.root, branch: this.branchOf(f), path: f.path, ...this.composer, text, ...(this.commitTag() ? { commit: this.commitTag() } : {}) });
    this.closeComposer(cx);
  }

  // A diff row was clicked (on_item_click): comment on its line. Side by side, the half pressed decides.
  clickRow(key, cx) {
    const item = this.list.find((it) => it.key === key);
    if (!item) return;
    if (item.t === "code") {
      const r = item.r, side = r.kind === "-" ? "old" : "new";
      this.openComposer({ line: side === "old" ? r.old : r.new, side, code: r.text }, cx);
    } else if (item.t === "pair") {
      let row = this.half === "old" ? item.left : item.right, side = this.half;
      if (!row) { row = item.left ?? item.right; side = row === item.left ? "old" : "new"; }
      if (row) this.openComposer({ line: side === "old" ? row.old : row.new, side, code: row.text }, cx);
    }
  }

  // ---------- diff rows ----------
  items() {
    const list = this.fileComments(), out = [];
    for (const c of list.filter((c) => c.line == null)) out.push({ t: "comment", c, key: `c-${c.id}` });
    const at = (side, line) => list.filter((c) => c.line === line && c.side === side);
    const after = (anchors) => { for (const [side, line] of anchors) if (line != null) for (const c of at(side, line)) out.push({ t: "comment", c, key: `c-${c.id}` }); };
    if (this.mode === "split") {
      splitRows(this.rows).forEach((p, i) => {
        if (p.hunk) { out.push({ t: "hunk", text: p.hunk.text, key: `h-${i}` }); return; }
        out.push({ t: "pair", left: p.left, right: p.right, key: `p-${i}` });
        after([["old", p.left && p.left !== p.right ? p.left.old : null], ["new", p.right?.new ?? null]]);
      });
    } else {
      this.rows.forEach((r, i) => {
        if (r.kind === "@") { out.push({ t: "hunk", text: r.text, key: `h-${i}` }); return; }
        out.push({ t: "code", r, key: `r-${i}` });
        after([r.kind === "-" ? ["old", r.old] : ["new", r.new]]);
      });
    }
    return out;
  }

  // Wrap: lines cut to the width (on_size_change measures it); else one line each and the list scrolls sideways.
  setWrap(on, cx) { this.wrap = on; save("wrap", on); cx.notify(); }
  cols(split) {
    const w = this.codeWidth || 900;
    return split ? colsFor((w - 4) / 2, 12, 66) : colsFor(w, 12, 124);
  }
  linesOf(row, split) { return row ? (this.wrap ? wrapTokens(row, this.cols(split)) : null) : null; }
  minWidth() {
    const text = this.maxLen * charWidth(12) + 24;
    return this.mode === "split" ? 2 * (66 + text) + 4 : 124 + text;
  }
  height(item) {
    if (item.t === "comment") return 30 + 17 * wrapLines(item.c.text);
    if (!this.wrap) return ROW;
    if (item.t === "code") return ROW * this.linesOf(item.r, false).length;
    if (item.t === "pair") return ROW * Math.max(1, this.linesOf(item.left, true)?.length ?? 1, this.linesOf(item.right, true)?.length ?? 1);
    return ROW;
  }
  // The text of a line: one row of colored spans, or (wrapping) a column of them.
  text(row, split, colors, t) {
    const lines = this.linesOf(row, split);
    if (!lines) return this.spans(row.tokens, row.text, colors, t);
    return [v_flex().flex_1().min_w(0).children(lines.map((l) => h_flex().h(ROW).flex_none()
      .children(l.map((k) => div().flex_none().whitespace_nowrap().text_color(colors[k.kind] ?? t.foreground).child(k.text)))))];
  }

  spans(tokens, text, colors, t) {
    if (!tokens) return [div().flex_none().whitespace_nowrap().child(text || " ")];
    return tokens.map((k) => div().flex_none().whitespace_nowrap().text_color(colors[k.kind] ?? t.foreground).child(k.text));
  }

  marked(side, line) { return Boolean(this.composer && line != null && this.composer.line === line && this.composer.side === side); }

  cell(row, side, colors, t) {
    const n = row ? (side === "old" ? row.old : row.new) : null;
    const bg = this.marked(side, n) ? t.accent + "33" : row?.kind === "+" ? t.ansi2 + "1c" : row?.kind === "-" ? t.ansi1 + "1c" : null;
    return h_flex().flex_1().min_w(0).h_full().items_start().overflow_hidden().when(Boolean(bg), (e) => e.bg(bg)).when(!row, (e) => e.bg(t.raised))
      .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(n == null ? "" : String(n)))
      .child(div().w(14).flex_none().text_color(row?.kind === "+" ? t.ansi2 : t.ansi1).child(row?.kind === "+" ? "+" : row?.kind === "-" ? "−" : ""))
      .children(row ? this.text(row, true, colors, t) : []);
  }

  renderItem(item, t, colors) {
    if (item.t === "hunk") return div().w_full().h(ROW).px(12).flex().items_center().bg(t.raised).text_color(t.dim).truncate().child(item.text);
    if (item.t === "pair") return h_flex().w_full().h(this.height(item)).cursor_pointer()
      .child(this.cell(item.left, "old", colors, t)).child(div().w(1).h_full().bg(t.border)).child(this.cell(item.right, "new", colors, t));
    if (item.t === "code") {
      const r = item.r, side = r.kind === "-" ? "old" : "new", n = side === "old" ? r.old : r.new;
      const bg = this.marked(side, n) ? t.accent + "33" : r.kind === "+" ? t.ansi2 + "1c" : r.kind === "-" ? t.ansi1 + "1c" : null;
      return h_flex().w_full().h(this.height(item)).items_start().cursor_pointer().when(Boolean(bg), (e) => e.bg(bg))
        .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(r.old == null ? "" : String(r.old)))
        .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(r.new == null ? "" : String(r.new)))
        .child(div().w(14).flex_none().text_color(r.kind === "+" ? t.ansi2 : t.ansi1).child(r.kind === "+" ? "+" : r.kind === "-" ? "−" : ""))
        .children(this.text(r, false, colors, t));
    }
    // comment, display only (its buttons are in the side column)
    const c = item.c;
    return div().w_full().h(this.height(item)).pl(102).pr(16).py(3).child(
      v_flex().size_full().px(10).py(4).gap(1).rounded(6).border_l_2().border_color(t.accent).bg(t.raised)
        .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(where(c)))
        .child(div().text_size(12.5).text_color(t.foreground).child(c.text)));
  }

  // ---------- outside the list ----------
  composerBar(t) {
    return h_flex().flex_none().px(12).py(8).gap(8).items_center().border_t(1).border_color(t.border).bg(t.chrome)
      .when(Boolean(this.overlay), (e) => e.on_mouse_down("left", (_e, cx) => cx.stop_propagation()))
      .child(div().flex_none().text_size(11.5).text_color(t.accent).child(where(this.composer)))
      .child(div().flex_1().h(32).px(10).flex().items_center().rounded(7).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().id("composer-save").h(32).px(12).flex().items_center().rounded(7).bg(t.solid).text_color(t.solid_foreground).text_size(12).cursor_pointer()
        .on_click((_e, cx) => this.saveComment(cx)).child("Comment"))
      .child(div().id("composer-cancel").h(32).px(10).flex().items_center().rounded(7).text_color(t.dim).text_size(12).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.closeComposer(cx)).child("Cancel"));
  }

  commentsColumn(t, mine) {
    const link = (id, label, act, tone) => div().id(id).px(6).py(1).rounded(4).cursor_pointer().text_color(tone).hover((s) => s.bg(t.hover)).on_click(act).child(label);
    return v_flex().id("comments-col").w(280).flex_none().border_l(1).border_color(t.border).bg(t.chrome).overflow_y_scroll()
      .child(h_flex().h(34).flex_none().px(12).items_center().border_b(1).border_color(t.border).text_size(12).font_semibold()
        .child(div().flex_1().child(`This file · ${mine.length}`)))
      .when(!mine.length, (e) => e.child(div().p(12).text_size(11.5).text_color(t.dim).child("Click any line to comment on it. Comments stay until you send them to the agent.")))
      .children(mine.map((c) => v_flex().id(`cc-${c.id}`).flex_none().mx(8).mt(8).p(8).gap(4).rounded(7).border_1().border_color(t.border).bg(t.background)
        .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(where(c)))
        .when(Boolean(c.code), (e) => e.child(div().text_size(11).text_color(t.dim).truncate().child(c.code.trim())))
        .child(div().text_size(12).text_color(t.foreground).child(c.text))
        .child(h_flex().gap(2).justify_end().text_size(11)
          .child(link(`send-${c.id}`, "Send to agent", () => comments.send([c], this.agent, this.space), t.accent))
          .child(link(`del-${c.id}`, "Delete", (_e, cx) => { comments.remove(c.id); cx.notify(); }, t.dim)))));
  }

  // One file row (tree: indented by depth, name only; flat: folder dimmed then name).
  fileRow(f, depth, t) {
    const i = this.files.findIndex((x) => x.root === f.root && x.path === f.path), on = i === this.cur;
    const tag = this.commitTag(), n = comments.of(f.root, f.path).filter((c) => (c.commit ?? null) === tag).length;
    const seen = this.viewed.has(this.keyOf(this.files[i]));
    const parts = f.path.split("/"), name = parts.pop();
    return h_flex().id(`file-${this.commit?.sha ?? ""}-${f.root}-${f.path}`).h(26).flex_none().mx(4).px(6).gap(6).items_center().rounded(6).cursor_pointer().text_size(11.5)
      .when(on, (e) => e.bg(t.selected)).when(!on, (e) => e.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.select(i, cx); this.handle.focus(); })
      .when(depth != null, (e) => e.pl(6 + depth * 14))
      .child(div().w(10).flex_none().text_color(seen ? t.ansi2 : t.dim).child(seen ? "✓" : "·"))
      .child(div().w(12).flex_none().text_size(10.5).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : t.blocked).child(f.status))
      .child(depth != null ? div().flex_1().min_w(0).truncate().child(name)
        : h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().flex_none().child(name)))
      .when(n > 0, (e) => e.child(div().flex_none().px(5).rounded(8).bg(t.accent).text_size(10).text_color(t.background).child(`● ${n}`)))
      .when(f.add > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child(`−${f.del}`)));
  }

  // One repo's files, tree or flat.
  fileRows(files, rootKey, t, out) {
    if (!this.tree) { for (const f of files) out.push(this.fileRow(f, null, t)); return; }
    for (const r of treeRows(files, this.collapsed, rootKey)) {
      if (r.t === "file") { out.push(this.fileRow(r.f, r.depth, t)); continue; }
      out.push(h_flex().id(`dir-${r.key}`).h(24).flex_none().mx(4).pl(6 + r.depth * 14).pr(6).gap(5).items_center().rounded(6).cursor_pointer()
        .text_size(11.5).text_color(t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { if (this.collapsed.has(r.key)) this.collapsed.delete(r.key); else this.collapsed.add(r.key); cx.notify(); })
        .child(div().w(10).flex_none().text_color(t.dim).child(r.open ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().child(r.name))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${r.c}`))
        .when(r.a > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi2).child(`+${r.a}`)))
        .when(r.d > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.ansi1).child(`−${r.d}`))));
    }
  }

  // Branch review's left column: Files | Commits, Tree | Flat, then the branch's files grouped by repo, the
  // commit list, or one commit's files. Plain list: rows may have handlers here (unlike the diff list).
  fileList(t) {
    const seg = (id, label, on, act) => div().id(id).h(22).px(8).flex().items_center().rounded(5).cursor_pointer().text_size(11)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).on_click((_e, cx) => act(cx)).child(label);
    const out = [];
    const showingFiles = this.left === "files" || Boolean(this.commit);
    if (this.left === "files" && !this.commit) {
      for (const r of this.visibleRepos()) {
        const folded = this.foldedRepos.has(r.root);
        out.push(v_flex().id(`repo-${r.root}`).flex_none().mx(4).mt(6).px(6).pt(4).pb(4).gap(1).rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.foldRepo(r.root, cx))
          .child(h_flex().gap(6).items_center().text_size(12)
            .child(div().w(10).flex_none().text_color(t.dim).child(folded ? "▸" : "▾"))
            .child(div().font_semibold().truncate().child(this.label(r))).child(div().text_color(t.dim).child(`${r.files.length}`)))
          .child(div().text_size(10.5).text_color(t.dim).truncate().child(`${r.branch ?? ""}${r.base ? ` vs ${r.base}` : ""} · ${r.commits} commit${r.commits === 1 ? "" : "s"}`)));
        if (folded) continue;
        if (!r.files.length) out.push(div().px(18).py(2).text_size(11).text_color(t.dim).child("No changes on this branch"));
        this.fileRows(this.files.filter((f) => f.root === r.root), r.root, t, out);
      }
    } else if (this.commit) {
      const c = this.commit, repo = this.repoOf(c);
      out.push(div().id("back-commits").mx(6).mt(8).px(6).py(3).rounded(5).cursor_pointer().text_size(11).text_color(t.accent).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.leaveCommit(cx)).child("← All commits"));
      out.push(v_flex().flex_none().px(10).pt(4).pb(6).gap(1)
        .child(div().text_size(12).font_semibold().child(c.subject))
        .child(div().text_size(10.5).text_color(t.dim).truncate().child(c.sha === WORKTREE ? `${repo?.name ?? ""} · not committed yet` : `${repo?.name ?? ""} · ${c.short} · ${c.author} · ${c.when}`)));
      if (!this.files.length && this.status !== "loading") out.push(div().px(18).py(2).text_size(11).text_color(t.dim).child("No files in this commit"));
      this.fileRows(this.files, `${c.sha}\n${c.root}`, t, out);
    } else {
      if (!this.commits) out.push(div().p(12).text_size(11).text_color(t.dim).child("Reading commits…"));
      for (const r of this.visibleRepos()) {
        const list = (this.commits ?? []).filter((c) => c.root === r.root);
        if (!this.commits) break;
        const folded = this.foldedRepos.has(r.root);
        out.push(h_flex().id(`crepo-${r.root}`).flex_none().mx(4).mt(6).px(6).py(4).gap(6).items_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.foldRepo(r.root, cx)).text_size(12)
          .child(div().w(10).flex_none().text_color(t.dim).child(folded ? "▸" : "▾"))
          .child(div().flex_1().min_w(0).font_semibold().truncate().child(`${this.label(r)}${r.base ? ` · since ${r.base}` : ""}`))
          .child(div().flex_none().text_color(t.dim).child(`${list.length}`)));
        if (folded) continue;
        if (!list.length) out.push(div().px(18).py(2).text_size(11).text_color(t.dim).child("No commits on this branch yet"));
        for (const c of list) out.push(v_flex().id(`commit-${r.root}-${c.sha}`).flex_none().mx(4).px(8).py(5).gap(1).rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.openCommit(c, cx))
          .child(div().text_size(11.5).truncate().text_color(c.sha === WORKTREE ? t.accent : t.foreground).child(c.subject))
          .child(div().text_size(10.5).text_color(t.dim).truncate().child(c.sha === WORKTREE ? "not committed yet" : `${c.short} · ${c.author} · ${c.when}`)));
      }
    }
    const done = this.files.filter((f) => this.viewed.has(this.keyOf(f))).length;
    return v_flex().id("file-list").w(320).flex_none().border_r(1).border_color(t.border).bg(t.chrome)
      .child(h_flex().h(34).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
          .child(seg("left-files", "Files", this.left === "files", (cx) => this.setLeft("files", cx)))
          .child(seg("left-commits", "Commits", this.left === "commits", (cx) => this.setLeft("commits", cx))))
        .when(showingFiles, (e) => e.child(h_flex().gap(1).p(1).rounded(6).border_1().border_color(t.border)
          .child(seg("view-tree", "Tree", this.tree, (cx) => this.setTree(true, cx)))
          .child(seg("view-flat", "Flat", !this.tree, (cx) => this.setTree(false, cx)))))
        .child(div().flex_1())
        .when(showingFiles, (e) => e.child(div().text_size(10.5).text_color(t.dim).child(`${done}/${this.files.length}`))))
      .child(v_flex().id("file-list-rows").flex_1().min_h(0).overflow_y_scroll().pb(10).children(out));
  }

  render(cx) {
    const t = theme(), colors = colorsFor(t), f = this.file(), mine = this.fileComments(), every = this.allComments();
    const items = this.list = this.items();
    // A file just opened: the cursor starts on its first change (once its rows are in).
    if (this.jumpFirst && this.status !== "loading" && items.length) {
      this.jumpFirst = false;
      const first = this.changeStarts()[0];
      if (first != null && this.cursorAt === 0) { this.cursorAt = first; this.scroll.scroll_to_item(first, "center"); }
    }
    const ch = this.changeAt();
    const agent = comments.pickAgent(this.agent, this.space);
    const tab = (id, label) => div().id(`mode-${id}`).h(24).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(11.5)
      .bg(this.mode === id ? t.selected : t.chrome).text_color(this.mode === id ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { if (this.overlay) cx.stop_propagation(); })
      .on_click((_e, cx) => this.setMode(id, cx)).child(label);
    const button = (id, label, act, primary, enabled = true) => div().id(id).h(26).px(10).flex().items_center().rounded(6).text_size(11.5)
      .bg(primary ? t.solid : t.chrome).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground).border_1().border_color(primary ? t.solid : t.border)
      .on_mouse_down("left", (_e, cx) => { if (this.overlay) cx.stop_propagation(); })
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => act(cx))).child(label);
    const fileState = this.error ? this.error : !f ? (this.status === "empty" ? (this.commit ? "No files in this commit" : "No changes on this branch") : this.status === "loading" ? "Loading…" : "Nothing to review")
      : this.status === "loading" ? "Loading…" : this.status === "binary" ? "Binary file" : this.status === "deleted" ? "File deleted on this branch" : this.status === "unreadable" ? "Can't read this file" : null;
    const note = { changed: (this.commit ?? this.fileCommit) ? ((this.commit ?? this.fileCommit).sha === WORKTREE ? "not committed yet" : `changes in commit ${(this.commit ?? this.fileCommit).short}`) : this.branchMode || this.fileAgainst ? "changes on this branch" : "changes against HEAD", unchanged: "no changes · whole file", new: "new file" }[this.status] ?? "";
    const sizes = items.map((i) => this.height(i));
    const code = div().id("review-code").flex_1().min_w(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
      // Which half a press landed on (side by side); the row's own click comes after, through on_item_click.
      .on_mouse_down("left", (e) => { const w = e.bounds?.size?.width ?? 0; this.half = w && e.local_position.x < w / 2 ? "old" : "new"; this.handle.focus(); })
      .on_size_change((size, cx) => { const w = size.width / (settings().zoom || 1); if (Math.abs(w - this.codeWidth) > 2) { this.codeWidth = w; cx.notify(); } })
      // Not wrapping: the rows are as wide as the longest line and scroll sideways.
      .child(div().id("review-x").absolute().inset_0().when(!this.wrap, (e) => e.overflow_x_scrollbar())
        .child(div().h_full().when(this.wrap, (e) => e.w_full()).when(!this.wrap, (e) => e.min_w(this.minWidth())).child(v_virtual_list(`review-rows-${this.cur ?? 0}`, items.length, sizes.every((h) => h === ROW) ? ROW : sizes,
        (i) => items[i].key, (range) => {
          this.visible = range; // for the vim cursor's scrolling; a plain field, not state
          return items.slice(range.start, range.end).map((it, j) => {
            const here = range.start + j === this.cursorAt;
            return h_flex().w_full().h(this.height(it)).overflow_hidden()
              .child(div().w(3).h_full().flex_none().when(here, (e) => e.bg(t.accent)))
              .child(div().flex_1().min_w(0).when(here, (e) => e.bg(t.selected)).child(this.renderItem(it, t, colors)));
          });
        })
        .size_full().track_scroll(this.scroll).on_item_click((key, cx) => { this.cursorAt = items.findIndex((it) => it.key === key); this.clickRow(key, cx); }))))
      .child(Scrollbar.vertical(`review-rows-${this.cur ?? 0}`).absolute().inset_0());
    const repoLine = f ? `${base(f.root)} · ${this.branchOf(f) ?? ""} · ${note}` : "";
    const head = this.branchMode
      ? (this.commit ? (this.commit.sha === WORKTREE ? "Uncommitted changes" : `${this.commit.short} · ${this.commit.subject}`)
        : `Branch review · ${[...new Set(this.visibleRepos().map((r) => r.branch).filter(Boolean))].join(", ") || "no branch"}`)
      : f?.path ?? "";
    return v_flex().id("review").size_full().relative().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      // A floating window's rect in window points (for the corner grips), from the pointer passing over it.
      .when(Boolean(this.windowKey), (e) => e.on_mouse_move((ev) => { if (ev.bounds) this.winRect = ev.bounds; }))
      .on_key_down((e, cx) => {
        if (this.composer) { if (e.key === "escape") { this.closeComposer(cx); cx.stop_propagation(); } return; }
        if (this.vimKey(e, cx)) cx.stop_propagation();
      })
      .child(h_flex().h(44).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border).bg(t.chrome)
        .child(v_flex().min_w(0).flex_1()
          .child(div().truncate().font_semibold().text_size(13).child(head))
          .child(div().truncate().text_size(11).text_color(t.dim).child(this.branchMode ? (f ? `${f.path} · ${repoLine}` : "") : repoLine)))
        // This file's changes: where you are, previous / next (n / N).
        .when(ch.of > 0, (e) => e.child(h_flex().gap(4).items_center()
          .child(button("prev-change", "↑", (cx) => this.nextChange(-1, cx), false, ch.n > 1 || (ch.n === 1 && this.cursorAt > this.changeStarts()[0])))
          .child(div().min_w(70).text_center().text_size(11.5).text_color(t.muted).child(ch.n ? `Change ${ch.n} of ${ch.of}` : `${ch.of} change${ch.of === 1 ? "" : "s"}`))
          .child(button("next-change", "↓", (cx) => this.nextChange(1, cx), false, ch.n < ch.of))))
        .when(this.branchMode, (e) => e
          .child(button("prev-file", "← File", (cx) => this.step(-1, cx), false, (this.cur ?? 0) > 0))
          .child(button("next-file", "File →", (cx) => this.step(1, cx), false, this.cur != null && this.cur < this.files.length - 1)))
        .child(h_flex().gap(2).p(2).rounded(8).bg(t.chrome).border_1().border_color(t.border).child(tab("inline", "Inline")).child(tab("split", "Side by side")))
        .child(button("wrap", this.wrap ? "Wrap ✓" : "Wrap", (cx) => this.setWrap(!this.wrap, cx)))
        .child(button("comment-file", "Comment on file", (cx) => this.openComposer({ line: null, side: null, code: "" }, cx), false, Boolean(f)))
        .child(button("send-all", every.length ? `Send ${every.length} to agent…` : "No comments", () => this.openSend(), every.length > 0, every.length > 0))
        .when(Boolean(this.windowKey), (e) => e
          .child(button("win-max", this.prevSize ? "Restore" : "⛶", () => this.toggleMax())))
        .when(Boolean(this.overlay) && !this.zen, (e) => e.child(button("close-overlay", "✕", () => closeOverlay(this.overlay)))))
      .child(h_flex().h(22).flex_none().px(14).items_center().text_size(10.5).text_color(t.dim).border_b(1).border_color(t.border)
        .child(div().flex_1().child(this.branchMode ? "j/k move · n/N next/previous change · J/K or ]/[ next file · c comment · C file comment · s side by side · w wrap" : "j/k move · n/N next/previous change · c comment · C file comment · s side by side · w wrap"))
        .child(div().child(agent ? `Sends to ${agent.title}` : "No agent running")))
      .when(this.branchMode, (e) => e.children(this.worktreeBar(t)))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .when(Boolean(this.overlay), (e) => e.on_mouse_down("left", (_e, cx) => cx.stop_propagation()))
        .when(this.branchMode, (e) => e.child(this.fileList(t)))
        .child(fileState ? div().flex_1().p(16).text_color(this.error ? t.ansi1 : t.dim).child(fileState) : code)
        .child(this.commentsColumn(t, mine)))
      .when(Boolean(this.composer), (e) => e.child(this.composerBar(t)))
      .when(Boolean(this.windowKey), (e) => e.children(this.grips(t)));
  }
}
