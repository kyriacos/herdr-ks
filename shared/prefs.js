// ks preferences set in the settings panel (ks-settings), read by the mods they change. Shared state "ks.prefs".
// Source of truth: shared/prefs.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared } from "herdr";

export const KEY = "ks.prefs";
export const DEFAULTS = {
  undoSeconds: 30,     // how long a closed tab or space can be brought back
  resumeCard: true,    // after a reboot, show the last Claude session's card in its terminal
  hideIdleMain: true,  // panels leave out a main checkout on main/master with nothing changed
  prToasts: true,      // My PRs: a toast when CI turns, a review lands, a PR merges
  // Layout (applied by lib/arrange.js)
  panelSide: "right",  // the side panel: "right" or "left" of the terminals
  sidebarOrder: ["dashboard", "now-tasks", "my-prs", "spaces", "agents"], // the sidebar's sections, top to bottom
  panelButtons: ["files", "changes", "prs", "notes", "tasks"], // side panels with a button in the tab bar
  // Mods
  nowTasksMax: 3,      // sidebar Tasks: how many in-progress tasks it lists
  taskToasts: true,    // a toast when an agent proposes a task
  tasksAll: false,     // the Tasks panel starts on every space's tasks (else this space's)
  notesAll: false,     // the Notes panel starts on every space's notes (else this space's)
  autoSpaceNames: true, // spaces called "branch · repo" of the worktree their agent works in
  spaceTaskLine: true, // under each space, what its agent works on
  worktreeRoot: "~/code/worktrees", // new worktrees go to <this>/<repo>/<branch>
  repoFolders: "~/code", // where your clones live, comma-separated; looked through two levels deep
  cacheDays: 7,        // the GitHub cache drops entries not refreshed for this many days (0: never)
  linearWorkspace: "", // Linear issue ids open at linear.app/<this>/issue/<id> ("" : learned from the last Linear link)
  agentProcs: true,    // the Agents list's "N procs" chip and the process lookups behind it
};
export const prefs = () => ({ ...DEFAULTS, ...(shared(KEY) ?? {}) });
export const pref = (k) => prefs()[k];
// A typed folder as a full path (~ is the home folder), without a trailing slash.
export const expandHome = (p, home) => { const s = String(p ?? "").trim().replace(/\/+$/, ""); return s === "~" ? home : s.startsWith("~/") ? home + s.slice(1) : s; };
// The worktree folder as a full path.
export const worktreeRoot = (home) => expandHome(pref("worktreeRoot"), home) || expandHome(DEFAULTS.worktreeRoot, home);
// A branch as a folder name: "sam/search-filters" -> "sam-search-filters".
export const branchFolder = (branch) => String(branch ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
// Where a new worktree of `repo` on `branch` goes. The New worktree dialog and the PR window both use it.
export const worktreePath = (home, repo, branch) => `${worktreeRoot(home)}/${repo}/${branchFolder(branch)}`;
// The folders clones are looked for in, as full paths.
export const repoFolders = (home) => {
  const list = String(pref("repoFolders") || DEFAULTS.repoFolders).split(",").map((p) => expandHome(p, home)).filter(Boolean);
  return list.length ? list : [expandHome(DEFAULTS.repoFolders, home)];
};
export const setPref = (k, v) => setShared(KEY, { ...(shared(KEY) ?? {}), [k]: v });
