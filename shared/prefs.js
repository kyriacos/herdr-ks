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
  sidebarOrder: ["now-tasks", "my-prs", "spaces", "agents"], // the sidebar's sections, top to bottom
  panelButtons: ["files", "changes", "prs", "notes", "tasks"], // side panels with a button in the tab bar
  // Mods
  nowTasksMax: 3,      // sidebar Tasks: how many in-progress tasks it lists
  taskToasts: true,    // a toast when an agent proposes a task
  tasksAll: false,     // the Tasks panel starts on every space's tasks (else this space's)
  notesAll: false,     // the Notes panel starts on every space's notes (else this space's)
  autoSpaceNames: true, // spaces called "branch · repo" of the worktree their agent works in
  spaceTaskLine: true, // under each space, what its agent works on
  worktreeRoot: "~/code/worktrees", // new worktrees go to <this>/<repo>/<branch>
  agentProcs: true,    // the Agents list's "N procs" chip and the process lookups behind it
};
export const prefs = () => ({ ...DEFAULTS, ...(shared(KEY) ?? {}) });
export const pref = (k) => prefs()[k];
// The worktree folder as a full path (~ is the home folder).
export const worktreeRoot = (home) => {
  const p = String(pref("worktreeRoot") || DEFAULTS.worktreeRoot).trim().replace(/\/+$/, "") || DEFAULTS.worktreeRoot;
  return p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p;
};
export const setPref = (k, v) => setShared(KEY, { ...(shared(KEY) ?? {}), [k]: v });
