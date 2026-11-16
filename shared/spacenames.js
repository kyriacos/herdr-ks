// What a space is called in ks: a name you gave it (space.rename) as is, unless it only repeats its repo or folder
// ("backend", "web", "~"), which says nothing when several spaces share one; else "branch · repo" of the worktree its
// agent works in (the Changes panel publishes those per space in shared "ks.session"; "+2" when it works in more),
// else Herdr's own name (the first terminal's repo or folder) with that terminal's branch when it isn't main.
// ks-spaces looks the worktrees' branches up and keeps shared "ks.spaceNames" = { [space id]: label } current;
// everything else reads it through spaceName().
// Source of truth: shared/spacenames.js; scripts/install.sh copies it into each mod's lib/.
import { shared, agents } from "herdr";

export const NAMES = "ks.spaceNames";
const HOME = /^\/Users\/[^/]+\/?$|^\/home\/[^/]+\/?$/;
const tail = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();

// From Herdr's data alone (no git): the fallback while the worktrees' branches are looked up.
export function baseName(s) {
  if (s.named) return s.name;
  // "~": the first terminal sits at home; the space's own folder says more when it isn't home.
  const name = s.name === "~" && s.folder && !HOME.test(s.folder) ? tail(s.folder) : s.name;
  return s.branch && !["main", "master"].includes(s.branch) && s.branch !== name ? `${name} · ${s.branch}` : name;
}

export function spaceName(s) {
  if (!s) return "";
  return shared(NAMES)?.[s.id] ?? baseName(s);
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
  return tab?.named && tab.name ? tab.name : title || tab?.name || "";
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
