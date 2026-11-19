// ks-dashboard's data: what you did over a day, a week or a month (merged PRs from gh, tasks done from the board,
// the Linear issue ids those mention), the prompts you can run over it, and every run kept.
//
// Files under <app home>/data/ks-dashboard/:
//   prompts.json   [{ id, name, range: "day" | "week" | "month", source: "merged-prs", text, auto: "HH:MM" | null,
//                    view: a view id | null (all repos) }]
//   runs/<id>.json { id, prompt, name, range, from, at, ms, prs, tasks, linear, summary, error }
//   activity.json  the last look at each range ({ day: { at, from, prs, tasks, linear } }), shown at once on open.
//   views.json     { current: id | null, views: [{ id, name, repos: ["acme/*", "sam/web"] }] }: which repos a view shows.
//                  "acme/*" is a whole owner (a GitHub org or user), "sam/web" one repo. null (All) shows everything.
// A run gathers the range's data, then hands it with the prompt's text to `claude -p` (no tools, nothing saved
// as a session) for the summary. Without claude the run keeps the data and says why there's no summary.
import { exec, appHome } from "herdr";
import { gh } from "./lib/github.js";

const DIR = () => `${appHome()}/data/ks-dashboard`;
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Where a range starts (local time): today at 00:00, this week's Monday, the 1st of this month.
export function rangeStart(range, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (range === "month") d.setDate(1);
  return d;
}
export const RANGES = [["day", "Today"], ["week", "This week"], ["month", "This month"]];

export const DEFAULT_PROMPTS = [{
  id: "daily-merged",
  name: "Daily: what I merged",
  range: "day",
  source: "merged-prs",
  auto: "18:00",
  text: "Summarise what I shipped from these merged pull requests. Start with two lines on the day overall. Then, grouped by repo, one bullet per PR: what changed and why it matters, in plain words, with its Linear issue id when it has one. End with anything that looks like follow-up work. Be brief and concrete, no filler.",
}];

async function readJson(path, fallback) {
  const r = await exec("cat", [path]).catch(() => null);
  if (!r || r.code !== 0 || !r.stdout.trim()) return fallback;
  try { return JSON.parse(r.stdout); } catch { return fallback; }
}
async function writeJson(path, value) {
  const body = JSON.stringify(value, null, 1);
  await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1.tmp" && mv "$1.tmp" "$1"', "sh", path, body]).catch(() => null);
}

export async function loadPrompts() {
  const list = await readJson(`${DIR()}/prompts.json`, null);
  if (Array.isArray(list) && list.length) return list;
  await writeJson(`${DIR()}/prompts.json`, DEFAULT_PROMPTS);
  return DEFAULT_PROMPTS;
}

export const savePrompts = (list) => writeJson(`${DIR()}/prompts.json`, list);

// Every run, newest first (each file read once and kept by its name).
const seen = new Map();
export async function loadRuns() {
  const r = await exec("sh", ["-c", 'ls -1 "$1"/runs/*.json 2>/dev/null', "sh", DIR()]).catch(() => null);
  const files = (r?.stdout ?? "").split("\n").filter(Boolean);
  for (const f of files) if (!seen.has(f)) { const run = await readJson(f, null); if (run) seen.set(f, run); }
  for (const f of [...seen.keys()]) if (!files.includes(f)) seen.delete(f);
  return [...seen.values()].sort((a, b) => b.at - a.at);
}
export async function removeRun(run) {
  await exec("rm", ["-f", `${DIR()}/runs/${run.id}.json`]).catch(() => null);
  seen.delete(`${DIR()}/runs/${run.id}.json`);
}

// Linear issue ids a PR mentions (title, branch, body): ENG-123, WEB-45. A few look-alikes left out.
const NOT_LINEAR = /^(UTF|ISO|SHA|RFC|CVE|GMT|UTC|HTTP|TLS|X)-/;
export function linearIds(...texts) {
  const out = new Set();
  for (const t of texts) for (const m of String(t ?? "").matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)) if (!NOT_LINEAR.test(m[1])) out.add(m[1]);
  return [...out];
}
// Same, but branch names are lower case: eng-123-fix-thing.
const branchIds = (b) => linearIds(String(b ?? "").toUpperCase().replace(/[/_]/g, " "));

// Your PRs merged since `from` (a Date), each with its size, branch and Linear ids. Details per PR are kept in
// memory by URL (a merged PR doesn't change).
const details = new Map();
export async function mergedPrs(from) {
  const r = await gh(["search", "prs", "--author=@me", "--merged", `--merged-at=>=${ymd(from)}`, "--limit", "200",
    "--json", "number,title,url,repository,closedAt,body"]);
  if (!r) return { error: "Couldn't run gh (GitHub CLI)" };
  if (r.code !== 0) return { error: (r.stderr || "gh search failed").trim().split("\n")[0] };
  let list = [];
  try { list = JSON.parse(r.stdout); } catch { return { error: "gh gave something unreadable" }; }
  list = list.filter((p) => new Date(p.closedAt) >= from);
  const prs = [];
  for (const p of list) {
    let d = details.get(p.url);
    if (!d) {
      const v = await gh(["pr", "view", p.url, "--json", "additions,deletions,changedFiles,mergedAt,headRefName,baseRefName"]);
      try { d = JSON.parse(v?.stdout ?? ""); details.set(p.url, d); } catch { d = {}; }
    }
    const body = String(p.body ?? "");
    prs.push({
      number: p.number, title: p.title, url: p.url, repo: p.repository?.nameWithOwner ?? "",
      mergedAt: Date.parse(d.mergedAt ?? p.closedAt), additions: d.additions ?? null, deletions: d.deletions ?? null,
      files: d.changedFiles ?? null, branch: d.headRefName ?? "", base: d.baseRefName ?? "",
      linear: [...new Set([...linearIds(p.title, body), ...branchIds(d.headRefName)])],
      body: body.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1200),
    });
  }
  prs.sort((a, b) => b.mergedAt - a.mergedAt);
  return { prs };
}

// The repo ("owner/name") a folder's git origin points at, kept per folder. "" when it has none.
const folderRepos = new Map();
async function folderRepo(folder) {
  if (!folder) return "";
  if (folderRepos.has(folder)) return folderRepos.get(folder);
  const r = await exec("git", ["-C", folder, "remote", "get-url", "origin"]).catch(() => null);
  const m = String(r?.stdout ?? "").trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  const repo = r?.code === 0 && m ? m[1] : "";
  folderRepos.set(folder, repo);
  return repo;
}

// Tasks moved to the board's last column since `from`, each with the repo of its folder.
export async function tasksDone(from) {
  const d = await readJson(`${appHome()}/data/ks-tasks.json`, null);
  if (!d?.tasks) return [];
  const done = d.columns?.[d.columns.length - 1]?.id;
  return d.tasks.filter((x) => x.column === done && (x.doneAt ?? x.updated ?? 0) >= from.getTime())
    .map((x) => ({ id: x.id, title: x.title, doneAt: x.doneAt ?? x.updated, folder: x.folder ?? "", space: String(x.spaceName ?? "").replace(/\s*·\s*$/, "") }))
    .sort((a, b) => b.doneAt - a.doneAt);
}
async function withRepos(tasks) {
  for (const x of tasks) x.repo = await folderRepo(x.folder);
  return tasks;
}

// ---------- views: which repos to show ----------
export async function loadViews() {
  const v = await readJson(`${DIR()}/views.json`, null);
  return { current: v?.current ?? null, views: Array.isArray(v?.views) ? v.views : [] };
}
export const saveViews = (v) => writeJson(`${DIR()}/views.json`, v);
const lc = (s) => String(s ?? "").toLowerCase();
export function inView(view, repo) {
  if (!view) return true;
  const r = lc(repo);
  return (view.repos ?? []).some((pat) => { const p = lc(pat); return p.endsWith("/*") ? r.startsWith(p.slice(0, -1)) : r === p; });
}
// A range's activity cut down to a view: its PRs, the tasks whose folder is in one of its repos, their Linear ids.
export function filtered(a, view) {
  if (!a || !view) return a;
  const prs = a.prs.filter((p) => inView(view, p.repo)), tasks = a.tasks.filter((x) => x.repo && inView(view, x.repo));
  return { ...a, prs, tasks, linear: linearOf(prs, tasks) };
}
const linearOf = (prs, tasks) => [...new Set(prs.flatMap((p) => p.linear).concat(tasks.flatMap((t) => linearIds(t.title))))].sort();
// Every owner and repo seen in the kept activity, for picking a view's repos: [{ owner, repos: [name] }].
export function knownRepos(act, view) {
  const all = new Set([...(view?.repos ?? []).filter((r) => !r.endsWith("/*"))]);
  for (const a of Object.values(act ?? {})) { for (const p of a?.prs ?? []) if (p.repo) all.add(p.repo); for (const x of a?.tasks ?? []) if (x.repo) all.add(x.repo); }
  for (const r of view?.repos ?? []) if (r.endsWith("/*")) all.add(r);
  const owners = new Map();
  for (const r of all) { // one entry per owner and repo whatever the case (a folder's remote may spell it otherwise)
    const [o, n] = r.split("/"), k = lc(o);
    if (!owners.has(k)) owners.set(k, { owner: o, names: new Map() });
    if (n && n !== "*" && !owners.get(k).names.has(lc(n))) owners.get(k).names.set(lc(n), n);
  }
  return [...owners.values()].sort((a, b) => lc(a.owner).localeCompare(lc(b.owner))).map(({ owner, names }) => ({ owner, repos: [...names.values()].sort() }));
}

// A range's activity: { at, from, prs, tasks, linear, error }. Kept, so the next open shows it at once.
export async function activity(range) {
  const from = rangeStart(range);
  const [got, tasks] = await Promise.all([mergedPrs(from), tasksDone(from).then(withRepos)]);
  const prs = got.prs ?? [], linear = linearOf(prs, tasks);
  const out = { at: Date.now(), from: from.getTime(), prs, tasks, linear, error: got.error ?? null };
  const all = await readJson(`${DIR()}/activity.json`, {});
  await writeJson(`${DIR()}/activity.json`, { ...all, [range]: out });
  return out;
}
export const lastActivity = () => readJson(`${DIR()}/activity.json`, {});

async function claude(text) {
  const args = ["-p", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--output-format", "text", text];
  const r = await exec("sh", ["-c", 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" exec claude "$@"', "sh", ...args], { timeout: 300000 }).catch((e) => ({ code: 1, stderr: String(e) }));
  if (r.code !== 0) return { error: (r.stderr || r.stdout || "claude failed").trim().split("\n").slice(-1)[0].slice(0, 300) };
  return { summary: r.stdout.trim() };
}

// Runs a prompt: the range's data (cut to the prompt's view, if it has one), then the summary. Saved under runs/;
// resolves to the run and the whole, uncut activity.
export async function runPrompt(p) {
  const t0 = Date.now(), whole = await activity(p.range);
  const view = p.view ? (await loadViews()).views.find((v) => v.id === p.view) ?? null : null;
  const a = filtered(whole, view);
  const run = { id: `r${t0}`, prompt: p.id, name: p.name, view: view?.name ?? null, range: p.range, from: a.from, at: t0, prs: a.prs, tasks: a.tasks, linear: a.linear, summary: "", error: a.error };
  if (!a.error) {
    const data = {
      range: `${p.range} starting ${ymd(new Date(a.from))}`,
      merged_prs: a.prs.map(({ body, ...rest }) => ({ ...rest, mergedAt: new Date(rest.mergedAt).toISOString(), description: body })),
      tasks_done: a.tasks.map((x) => x.title),
    };
    if (!a.prs.length && !a.tasks.length) run.summary = "Nothing merged or finished in this range yet.";
    else {
      const got = await claude(`${p.text}\n\nUse only the data below; write Markdown.\n\n${JSON.stringify(data)}`);
      run.summary = got.summary ?? ""; run.error = got.error ? `No summary: ${got.error}` : null;
    }
  }
  run.ms = Date.now() - t0;
  await writeJson(`${DIR()}/runs/${run.id}.json`, run);
  return { run, whole };
}
