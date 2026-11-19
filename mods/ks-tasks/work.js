// What a task is tied to, for its card and its window:
//   - the agent working on it: `ks-task start` keeps the agent's terminal in `worker` ({ terminal, folder, branch });
//     while that terminal lives, agents() gives its status (working, blocked, done, idle);
//   - its pull requests: links added with `ks-task link`, GitHub PR URLs in its description or comments, and the
//     PR of the worker's branch (gh pr list --head, looked up in the background, kept a few minutes);
//   - its Linear issues: links, and ids in its title, description or branch (ENG-123, sam/eng-123-search-filters);
//   - its worktree: the worker's folder and branch, else where the task was made.
// Looked-up PRs bump `rev()`, so a view that shows them can redraw when it changes.
import { agents, hc } from "herdr";
import { gh } from "./lib/github.js";

// The agent on a task: the terminal `ks-task start` kept; for a task started before that (or whose terminal has
// gone), a live agent whose title is the task's assignee (ks-task writes the agent's title there).
const clean = (s) => String(s ?? "").replace(/^[\s✳⠂⠐*·]+|[\s✳⠂⠐*·…]+$/g, "");
export function agentOf(x) {
  if (!x) return null;
  const list = agents(), t = x.worker?.terminal;
  const kept = t ? list.find((a) => a.address === t) : null;
  if (kept) return kept;
  const who = clean(x.assignee);
  if (!who) return null;
  return list.filter((a) => clean(a.title) === who).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0] ?? null;
}
// A status's words and theme colour.
export const STATUS = { working: ["working", "accent"], blocked: ["needs you", "ansi3"], done: ["waiting for you", "ansi2"], idle: ["idle", "muted"] };
export const agentName = (a) => `${a.space_name} / ${a.title || a.address}`;

// ---------- Linear ----------
const NOT_LINEAR = /^(UTF|ISO|SHA|RFC|CVE|GMT|UTC|HTTP|TLS|X)-/;
const ids = (text) => [...String(text ?? "").matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)].map((m) => m[1]).filter((id) => !NOT_LINEAR.test(id));
// [{ id, url }]: url when a link gave one (clicking then opens it; otherwise it copies the id).
export function linearOf(x) {
  const out = new Map();
  for (const l of x.links ?? []) if (l.kind === "linear") out.set(l.label, l.url);
  const branch = String(worktreeOf(x).branch ?? "").toUpperCase().replace(/[/_]/g, " ");
  for (const id of [...ids(x.title), ...ids(x.body), ...ids(branch)]) if (!out.has(id)) out.set(id, null);
  return [...out].map(([id, url]) => ({ id, url }));
}

// ---------- worktree ----------
export function worktreeOf(x) {
  const w = x.worker ?? {};
  return { folder: w.folder || x.folder || "", branch: w.branch || x.source?.branch || "" };
}
export const tilde = (p) => String(p ?? "").replace(/^\/(Users|home)\/[^/]+/, "~");

// ---------- pull requests ----------
const PR_URL = /https:\/\/github\.com\/([^/\s)]+\/[^/\s)]+)\/pull\/(\d+)/g;
const found = new Map(); // key → { at, busy, pr: { url, number, title, state, isDraft, repo } | null }
let revN = 0;
export const rev = () => revN;
const queue = [];
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const { key, args, cwd } = queue.shift();
      const r = await gh(args, cwd).catch(() => null);
      let pr = null;
      try { const v = JSON.parse(r?.stdout ?? "null"); pr = Array.isArray(v) ? v[0] ?? null : v; } catch {}
      if (pr) pr.repo = (pr.url?.match(/github\.com\/[^/]+\/([^/]+)/) ?? [])[1] ?? "";
      found.set(key, { at: Date.now(), busy: false, pr });
      revN++;
    }
  } finally { pumping = false; }
}
const FIELDS = "number,title,url,state,isDraft";
// A PR from the cache; looked up (again) when missing, or when open and older than 5 minutes.
function cached(key, args, cwd) {
  const c = found.get(key);
  const stale = !c || (!c.busy && Date.now() - c.at > 5 * 60000 && (!c.pr || c.pr.state === "OPEN"));
  if (stale) { found.set(key, { at: c?.at ?? 0, busy: true, pr: c?.pr ?? null }); queue.push({ key, args, cwd }); pump(); }
  return found.get(key)?.pr ?? null;
}
// The task's PRs: [{ url, label, number, title, state, isDraft }] (state "" until gh has answered).
export function prsOf(x) {
  const urls = new Map();
  for (const l of x.links ?? []) if (l.kind === "pr") urls.set(l.url, l);
  for (const text of [x.body, ...(x.comments ?? []).map((c) => c.text)]) {
    for (const m of String(text ?? "").matchAll(PR_URL)) if (!urls.has(m[0])) urls.set(m[0], { url: m[0] });
  }
  const out = new Map();
  for (const url of urls.keys()) {
    const pr = cached(url, ["pr", "view", url, "--json", FIELDS]), m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
    out.set(url, { url, number: Number(m?.[2]), repo: m?.[1] ?? "", title: pr?.title ?? "", state: pr?.state ?? "", isDraft: pr?.isDraft ?? false });
  }
  const w = worktreeOf(x);
  if (w.folder && w.branch && !/^(main|master|develop|HEAD)$/.test(w.branch)) {
    const pr = cached(`${w.folder}|${w.branch}`, ["pr", "list", "--head", w.branch, "--state", "all", "--limit", "1", "--json", FIELDS], w.folder);
    if (pr && !out.has(pr.url)) out.set(pr.url, pr);
  }
  return [...out.values()];
}
export const prTone = (p) => (p.isDraft ? "dim" : { OPEN: "ansi2", MERGED: "ansi5", CLOSED: "ansi1" }[p.state] ?? "muted");
export const prState = (p) => (p.isDraft && p.state === "OPEN" ? "draft" : String(p.state || "…").toLowerCase());

// ---------- the agent's screen ----------
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|[\x00-\x08\x0b-\x1f\x7f]/g;
// Its last `n` lines of screen (blank ones at the end dropped), or null when it can't be read.
export async function screen(terminal, n = 14) {
  const r = await hc(["read", terminal]).catch(() => null);
  if (!r || r.code !== 0) return null;
  const lines = r.stdout.replace(ANSI, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(-n).join("\n");
}
