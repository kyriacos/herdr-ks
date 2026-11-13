// Git for reviews: a branch measured against its base (merge-base with origin's default branch), its commits,
// one commit's files, and tree rows for a file list. Used by the Changes panel and the review tab.
// Source of truth: shared/branch.js; scripts/install.sh copies it into each mod's lib/.
import { exec } from "herdr";

export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const base = (p) => p.replace(/\/+$/, "").split("/").pop();
export const git = (root, on, args) => exec("git", [...READ, ...args], { cwd: root, on });

// The branch a repo's work is measured against: origin's default branch, else main/master (remote, then local).
export async function baseRef(root, on) {
  const head = await git(root, on, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if ((await git(root, on, ["rev-parse", "--verify", "--quiet", ref])).code === 0) return ref;
  }
  return null;
}

// One repo's branch: { root, on, name, branch, base, mb, commits, files: [{ path, status, add, del, fresh }] }.
export async function readBranch(root, on, refOverride = null) {
  const br = await git(root, on, ["branch", "--show-current"]);
  const branch = br.code === 0 ? br.stdout.trim() || "detached HEAD" : null;
  const ref = refOverride ?? await baseRef(root, on);
  let mb = null;
  if (ref) { const m = await git(root, on, ["merge-base", "HEAD", ref]); if (m.code === 0) mb = m.stdout.trim(); }
  if (!mb) { const h = await git(root, on, ["rev-parse", "--verify", "HEAD"]); mb = h.code === 0 ? h.stdout.trim() : null; }
  const commits = mb ? Number((await git(root, on, ["rev-list", "--count", `${mb}..HEAD`])).stdout.trim()) || 0 : 0;
  const against = mb ? [mb] : ["--cached"];
  const names = await git(root, on, ["diff", ...against, "--name-status", "-z", "--no-renames"]);
  const stats = await git(root, on, ["diff", ...against, "--numstat", "-z", "--no-renames"]);
  const files = new Map();
  const ns = names.stdout.split("\0");
  for (let i = 0; i + 1 < ns.length; i += 2) if (ns[i]) files.set(ns[i + 1], { path: ns[i + 1], status: ns[i][0], add: 0, del: 0, fresh: false });
  for (const entry of stats.stdout.split("\0")) {
    const [a, d, ...rest] = entry.split("\t"), path = rest.join("\t"), f = files.get(path);
    if (f) { f.add = Number(a) || 0; f.del = Number(d) || 0; }
  }
  const untracked = await git(root, on, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const path of untracked.stdout.split("\0").filter(Boolean)) if (!files.has(path)) files.set(path, { path, status: "A", add: 0, del: 0, fresh: true });
  const main = (await git(root, on, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
  return { root, on, name: base(main.endsWith("/.git") ? main.slice(0, -5) : root), branch, base: ref, mb, commits,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

export const WORKTREE = "WORKTREE"; // the "Uncommitted changes" entry of the commit list

// A repo's commits on the branch, newest first, with an "Uncommitted changes" entry on top when there is any.
export async function readCommits(repo) {
  const { root, on, mb } = repo, out = [];
  const dirty = await git(root, on, ["status", "--porcelain"]);
  if (dirty.code === 0 && dirty.stdout.trim()) out.push({ root, on, sha: WORKTREE, short: "", subject: "Uncommitted changes", when: "now", author: "" });
  if (!mb) return out;
  const log = await git(root, on, ["log", "--no-color", "--format=%H%x09%h%x09%cr%x09%an%x09%s", `${mb}..HEAD`]);
  for (const line of log.stdout.split("\n").filter(Boolean)) {
    const [sha, short, when, author, ...subject] = line.split("\t");
    out.push({ root, on, sha, short, when, author, subject: subject.join("\t") });
  }
  return out;
}

// The files one commit changed (or the uncommitted ones), like readBranch's.
export async function readCommitFiles(c) {
  const { root, on, sha } = c, files = new Map();
  const range = sha === WORKTREE ? ["diff", "HEAD"] : ["show", "--format=", sha];
  const names = await git(root, on, [...range, "--name-status", "-z", "--no-renames"]);
  const stats = await git(root, on, [...range, "--numstat", "-z", "--no-renames"]);
  const ns = names.stdout.replace(/^\0+/, "").split("\0");
  for (let i = 0; i + 1 < ns.length; i += 2) if (ns[i]) files.set(ns[i + 1], { path: ns[i + 1], status: ns[i][0], add: 0, del: 0, fresh: false });
  for (const entry of stats.stdout.split("\0")) {
    const [a, d, ...rest] = entry.split("\t"), path = rest.join("\t").replace(/^\n/, ""), f = files.get(path);
    if (f) { f.add = Number(a) || 0; f.del = Number(d) || 0; }
  }
  if (sha === WORKTREE) {
    const untracked = await git(root, on, ["ls-files", "--others", "--exclude-standard", "-z"]);
    for (const path of untracked.stdout.split("\0").filter(Boolean)) if (!files.has(path)) files.set(path, { path, status: "A", add: 0, del: 0, fresh: true });
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ ...f, root, on }));
}

// Tree rows for one repo's files (sorted by path, so depth-first order matches the flat order): folders with
// their totals, single-child folder chains joined ("app/domain/scheduling"), collapsed ones skipped.
export function treeRows(files, collapsed, rootKey) {
  const top = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/"); parts.pop();
    let node = top;
    for (const part of parts) { if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] }); node = node.dirs.get(part); }
    node.files.push(f);
  }
  const totals = (n) => { let c = n.files.length, a = n.files.reduce((x, f) => x + f.add, 0), d = n.files.reduce((x, f) => x + f.del, 0);
    for (const k of n.dirs.values()) { const t = totals(k); c += t.c; a += t.a; d += t.d; } return { c, a, d }; };
  const out = [];
  const walk = (node, prefix, depth) => {
    const entries = [...[...node.dirs].map(([name, n]) => ({ name, n })), ...node.files.map((f) => ({ name: f.path.split("/").pop(), f }))]
      .sort((x, y) => x.name.localeCompare(y.name));
    for (const e of entries) {
      if (e.f) { out.push({ t: "file", f: e.f, depth }); continue; }
      let name = e.name, n = e.n;
      while (n.files.length === 0 && n.dirs.size === 1) { const [k, v] = [...n.dirs][0]; name += "/" + k; n = v; }
      const path = prefix + name, key = `${rootKey}\n${path}`, t = totals(n);
      out.push({ t: "dir", path, name, depth, key, open: !collapsed.has(key), ...t });
      if (!collapsed.has(key)) walk(n, path + "/", depth + 1);
    }
  };
  walk(top, "", 0);
  return out;
}

// Worktrees a review could add: every checkout of every repo in the folders that hold the given roots' repos
// (e.g. all backend and web worktrees when backend and web sit side by side). [{ root, repo, branch }].
export async function candidates(roots, on) {
  const parents = new Set(), out = [], seen = new Set();
  for (const root of roots) {
    const c = await git(root, on, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (c.code !== 0) continue;
    const main = c.stdout.trim().replace(/\/\.git$/, "");
    parents.add(main.replace(/\/[^/]+$/, ""));
  }
  for (const parent of parents) {
    const r = await exec("sh", ["-c", 'for d in "$1"/*/; do [ -d "$d.git" ] && printf "%s\\n" "${d%/}"; done', "sh", parent], { on }).catch(() => null);
    for (const repo of (r?.stdout ?? "").split("\n").filter(Boolean)) {
      const list = await git(repo, on, ["worktree", "list", "--porcelain"]);
      for (const block of (list.code === 0 ? list.stdout : "").split(/\n\n+/)) {
        const lines = block.split("\n"), path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
        if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable")) || seen.has(path.toLowerCase())) continue;
        seen.add(path.toLowerCase());
        out.push({ root: path, repo: base(repo), branch: lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "detached" });
      }
    }
  }
  return out;
}
