// What a space is called in ks: the name you gave it (a rename started from ks, see "names you gave" below); else
// what its agents work on: their Linear issue (from their branches and their tasks; "+N" more in the space's list),
// else "branch · repo" of the worktree they work in (the Changes panel publishes those per space in shared
// "ks.session"); else Herdr's folder name with its terminal's branch. Names other tools give (Cockpit, Herdr's
// folder names) are ignored.
// ks-spaces looks the worktrees and issues up and keeps shared "ks.spaceNames" = { [space id]: label } and
// "ks.spaceItems" = { [space id]: [{ kind: "issue" | "task", ... }] } current; everything else reads spaceName().
// Source of truth: shared/spacenames.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, agents, spaces, run } from "herdr";

export const NAMES = "ks.spaceNames";
export const ITEMS = "ks.spaceItems";
const HOME = /^\/Users\/[^/]+\/?$|^\/home\/[^/]+\/?$/;
const tail = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();

// From Herdr's data alone (no git): the fallback while the worktrees' branches are looked up.
export function baseName(s) {
  // Its folder (Herdr's own name may be another tool's): "~" at home.
  const name = s.folder ? (HOME.test(s.folder) ? "~" : tail(s.folder)) : s.name;
  return s.branch && !["main", "master"].includes(s.branch) && s.branch !== name ? `${name} · ${s.branch}` : name;
}

export function spaceName(s) {
  if (!s) return "";
  return givenSpace(s.id) ?? shared(NAMES)?.[s.id] ?? baseName(s);
}

// A given name that only repeats a repo of its worktrees, or its folder: worth replacing.
export function generic(s, trees) {
  const n = String(s.name ?? "").toLowerCase();
  return n === "~" || n === tail(s.folder).toLowerCase() || trees.some((t) => t.repo.toLowerCase() === n || tail(t.root).toLowerCase() === n);
}
// A branch without its owner prefix: "sam/search-filters" -> "search-filters".
const short = (b) => String(b ?? "").split("/").pop();

// What the space's agent works on: its tab's name when someone (or the agent) named it, else the agent's title.
export function spaceTask(s) {
  const crew = agents().filter((a) => a.space === s?.id);
  if (!crew.length) return "";
  const a = crew.find((x) => x.focused) ?? [...crew].sort((x, y) => y.seq - x.seq)[0];
  const tab = s.tabs?.find((t) => t.id === a.tab);
  const title = String(a.title ?? "").replace(/^[⠀-⣿✳⠂⠐*·\s]+/, "").trim();
  return (tab && givenTab(tab.id)) || title || tab?.name || "";
}

// The label for worktrees [{ root, repo, branch }] (looked up by ks-spaces): the first one off main, "branch · repo";
// repos on that same branch join it ("search-filters · backend + web"), other worktrees count as "+n". On main:
// "repo · main".
export function labelFor(trees) {
  if (!trees.length) return null;
  const main = trees.find((t) => !["main", "master"].includes(t.branch)) ?? trees[0], b = short(main.branch);
  const same = [...new Set(trees.filter((t) => short(t.branch) === b).map((t) => t.repo))];
  const more = new Set(trees.filter((t) => short(t.branch) !== b).map((t) => `${t.repo}\n${t.branch}`)).size;
  // Off main the branch is what tells spaces apart, so it goes first (the sidebar cuts the end off a long name).
  const repos = same.join(" + "), plus = more > 0 ? ` +${more}` : "";
  return !b || ["main", "master"].includes(b) ? `${repos} · ${b || tail(main.root)}${plus}` : `${b} · ${repos}${plus}`;
}

// ---------- names you gave ----------
// Only a name typed after a rename started from ks (menus, key modes, double-clicks) counts as yours: shared
// "ks.givenNames" = { spaces: { id: name }, tabs: { id: name } }. Every other name (Herdr's folder name, Cockpit's,
// another tool's) is ignored, and ks shows its own: a space by its Linear issue or worktree (ks-spaces), a tab by
// its agent's title. "Reset to automatic" in a space's or tab's menu forgets yours.
export const GIVEN = "ks.givenNames";
const RENAMING = "ks.renaming";
const given = () => shared(GIVEN) ?? { spaces: {}, tabs: {} };
export const givenSpace = (id) => given().spaces?.[id] ?? null;
export const givenTab = (id) => given().tabs?.[id] ?? null;
function setGiven(kind, id, name) {
  const g = given(), list = { ...(g[kind] ?? {}) };
  if (name) list[id] = name; else delete list[id];
  setShared(GIVEN, { ...g, [kind]: list });
}
export const resetName = (kind, id) => setGiven(kind === "tab" ? "tabs" : "spaces", id, null);

// A rename is starting (run("space.rename" | "tab.rename", args) from ks): what's named now, to compare once Herdr's
// dialog closes. No id: the active space, or its active tab.
export function markRename(command, args = {}) {
  const kind = command === "space.rename" ? "spaces" : command === "tab.rename" ? "tabs" : null;
  if (!kind) return;
  const sp = spaces(), act = sp.find((s) => s.active);
  const id = args.id ?? (kind === "spaces" ? act?.id : act?.tabs.find((t) => t.active)?.id);
  const now = kind === "spaces" ? sp.find((s) => s.id === id)?.name : sp.flatMap((s) => s.tabs).find((t) => t.id === id)?.name;
  if (id) setShared(RENAMING, { kind, id, before: now ?? "", at: Date.now() });
}
export function renameWith(command, args = {}) { markRename(command, args); run(command, args); }

// Called every second by ks-spaces: a marked rename whose name changed becomes yours (cleared back to Herdr's
// default, it stops being yours). Given up after 5 minutes.
export function noteRename() {
  const r = shared(RENAMING);
  if (!r) return;
  if (Date.now() - r.at > 300000) { setShared(RENAMING, null); return; }
  const sp = spaces();
  const item = r.kind === "spaces" ? sp.find((s) => s.id === r.id) : sp.flatMap((s) => s.tabs).find((t) => t.id === r.id);
  if (!item) { setShared(RENAMING, null); return; }
  if (item.name === r.before) return;
  setShared(RENAMING, null);
  setGiven(r.kind, r.id, item.named && item.name ? item.name : null);
}

// A tab's label: the name you gave it, else its agent's title as it is now (the focused one, else the latest),
// else Herdr's name, else `fallback` (its program).
const cleanTitle = (s) => String(s ?? "").replace(/^[⠀-⣿✳⠂⠐*·\s]+|[\s✳⠂⠐*·…]+$/g, "").trim();
export function tabLabel(tab, fallback = "") {
  if (!tab) return fallback;
  const mine = givenTab(tab.id);
  if (mine) return mine;
  const crew = agents().filter((a) => a.tab === tab.id);
  const a = crew.find((x) => x.focused) ?? [...crew].sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0))[0];
  const title = cleanTitle(a?.title);
  if (title && !/^claude( code)?$/i.test(title)) return title;
  return /^tb\d+$/.test(tab.name ?? "") || /^\d+$/.test(tab.name ?? "") ? fallback || tab.name : tab.name || fallback;
}

// ---------- Linear issues ----------
const NOT_LINEAR = /^(UTF|ISO|SHA|RFC|CVE|GMT|UTC|HTTP|TLS|X)-/;
// Linear ids in a text or a branch ("sam/eng-123-search-filters" -> ENG-123). With `known` team keys (those
// seen in Linear links), only theirs.
export function linearIds(text, known = []) {
  const up = String(text ?? "").toUpperCase().replace(/[/_]/g, " ");
  return [...new Set([...up.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)].map((m) => m[1]))]
    .filter((id) => !NOT_LINEAR.test(id) && (!known.length || known.includes(id.split("-")[0])));
}
// "ENG-123 · Search filters" (the title as learned, else the branch's words after the id).
export function issueLabel(issue) {
  return issue.title ? `${issue.id} · ${issue.title}` : issue.id;
}
