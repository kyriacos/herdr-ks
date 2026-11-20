// What a task is tied to, for its card and its window:
//   - the agent working on it: `ks-task start` keeps the agent's terminal in `worker` ({ terminal, folder, branch });
//     while that terminal lives, agents() gives its status (working, blocked, done, idle);
//   - its pull requests: links added with `ks-task link`, GitHub PR URLs in its description or comments, and the
//     PR of the worker's branch (gh pr list --head, looked up in the background, kept a few minutes);
//   - its Linear issues: links, and ids in its title, description or branch (ENG-123, sam/eng-123-search-filters);
//   - its worktree: the worker's folder and branch, else where the task was made.
//   - the agent's subagents (Claude Code): read from the session's transcripts by `ks-task subagents`; the ones
//     for this task are those whose prompt names the task's id, that ran `ks-task start` on it, or that share a
//     Linear id or several title words with it. A subagent has no terminal: its window shows what it does.
// Looked-up PRs and subagents bump `rev()`, so a view that shows them can redraw when it changes.
import { agents, hc, exec } from "herdr";
import { gh } from "./lib/github.js";
import { learnLinear, linearUrl, linearTitle } from "./lib/linear.js";

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
// [{ id, url, title }]: url when a link gave one or the workspace is known (clicking opens it; otherwise it copies
// the id); title when one was seen (lib/linear.js learns them from PRs).
export function linearOf(x) {
  const out = new Map();
  for (const l of x.links ?? []) if (l.kind === "linear") { out.set(l.label, l.url); learnLinear(l.url); }
  learnLinear(x.body);
  const branch = String(worktreeOf(x).branch ?? "").toUpperCase().replace(/[/_]/g, " ");
  for (const id of [...ids(x.title), ...ids(x.body), ...ids(branch)]) if (!out.has(id)) out.set(id, null);
  return [...out].map(([id, url]) => ({ id, url: linearUrl(id, url), title: linearTitle(id) }));
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
      if (pr) {
        pr.repo = (pr.url?.match(/github\.com\/[^/]+\/([^/]+)/) ?? [])[1] ?? "";
        // Linear's GitHub bot comments "ENG-123 Title": learned for the cards (lib/linear.js), then dropped.
        learnLinear(pr.body); for (const c of pr.comments ?? []) learnLinear(c.body);
        delete pr.body; delete pr.comments;
      }
      found.set(key, { at: Date.now(), busy: false, pr });
      revN++;
    }
  } finally { pumping = false; }
}
const FIELDS = "number,title,url,state,isDraft,body,comments";
// A PR from the cache; looked up (again) when missing, or when open and older than 5 minutes.
function cached(key, args, cwd) {
  const c = found.get(key);
  const stale = !c || (!c.busy && Date.now() - c.at > 5 * 60000 && (!c.pr || c.pr.state === "OPEN"));
  if (stale) { found.set(key, { at: c?.at ?? 0, busy: true, pr: c?.pr ?? null }); queue.push({ key, args, cwd }); pump(); }
  return found.get(key)?.pr ?? null;
}
// The task's PRs: [{ url, label, number, title, state, isDraft }] (state "" until gh has answered). `more`: PR URLs
// from elsewhere (its subagents).
export function prsOf(x, more = []) {
  const urls = new Map();
  for (const u of more) urls.set(u, { url: u });
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

// ---------- subagents ----------
// An agent's Claude session id: its terminal's foreground process, then ~/.claude/sessions/<pid>.json.
const sessions = new Map(); // address → { at, id }
async function sessionOf(address) {
  const c = sessions.get(address);
  if (c && Date.now() - c.at < 60000) return c.id;
  let id = null;
  try {
    const pid = JSON.parse((await hc(["get", address, "--json"])).stdout)?.foreground?.pid;
    if (pid) {
      const r = await exec("sh", ["-c", 'cat "$HOME/.claude/sessions/$1.json"', "sh", String(pid)]);
      id = JSON.parse(r.stdout)?.sessionId ?? null;
    }
  } catch {}
  sessions.set(address, { at: Date.now(), id });
  return id;
}
const subs = new Map(); // address → { at, busy, list }
// The agent's subagents (running, or finished within the hour), newest first; refreshed when older than `maxAge`.
export function subagentsOf(a, maxAge = 10000) {
  if (!a) return [];
  const c = subs.get(a.address);
  if (!c || (!c.busy && Date.now() - c.at > maxAge)) {
    subs.set(a.address, { at: c?.at ?? 0, busy: true, list: c?.list ?? [] });
    (async () => {
      let list = c?.list ?? [];
      try {
        const id = await sessionOf(a.address);
        if (id) {
          const r = await exec("sh", ["-c", 'PATH="$HOME/.local/bin:$PATH" exec ks-task subagents "$1"', "sh", id]);
          if (r.code === 0) list = JSON.parse(r.stdout);
        } else list = [];
      } catch {}
      const changed = JSON.stringify(list) !== JSON.stringify(c?.list ?? []);
      subs.set(a.address, { at: Date.now(), busy: false, list });
      if (changed) revN++;
    })();
  }
  return subs.get(a.address).list;
}
const STOP = new Set("the and for with from that this when should what into then than have your user users them they".split(" "));
const words = (t) => new Set(String(t ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)));
// This task's subagents among the agent's: [{ ...subagent, why }].
export function subagentsFor(x, a, maxAge) {
  const lin = new Set(linearOf(x).map((l) => l.id)), title = words(x.title);
  return subagentsOf(a, maxAge).flatMap((s) => {
    const text = `${s.description}\n${s.prompt}`;
    if (x.worker?.subagent === s.id) return [{ ...s, why: "started it" }];
    if (x.id && text.includes(x.id)) return [{ ...s, why: "given the task" }];
    if (ids(text).some((id) => lin.has(id))) return [{ ...s, why: "same Linear issue" }];
    const shared = [...words(`${s.description} ${s.prompt.slice(0, 600)}`)].filter((w) => title.has(w));
    return shared.length >= Math.min(3, title.size) && shared.length >= 2 ? [{ ...s, why: `about ${shared.slice(0, 3).join(", ")}` }] : [];
  });
}
