// Where things go in the ks layout, from the settings panel (lib/prefs.js): the side panel left or right of the
// terminals, and the order of the sidebar's sections. Applied to the live layout with layout.set, which keeps every
// node as it is (sizes, hidden or shown) and only reorders; nothing happens when it's already arranged. ks-tabs runs
// it at start (so a reinstall, which brings back the repo's layout, gets your arrangement again) and ks-settings when
// a choice changes. Showing or hiding a section is Herdr's own layout.show / layout.hide, kept by Herdr.
// Source of truth: shared/arrange.js; scripts/install.sh copies it into each mod's lib/.
import { layout, run } from "herdr";
import { prefs } from "./prefs.js";

// The sidebar's sections: [layout id, name, what it is].
export const SIDEBAR = [
  ["now-tasks", "Tasks now", "What's in progress on the task board, every space; opens the board."],
  ["my-prs", "My PRs", "Your open GitHub pull requests with CI, review and merge state."],
  ["spaces", "Spaces", "Your spaces, named by repo and branch, with what each agent works on."],
  ["agents", "Agents", "Every agent session, by space, with the processes running under it."],
];
// The side panels: [id, name, what it is]. Files and Changes can also be switched off in Herdr's own settings.
export const PANELS = [
  ["files", "Files", "The worktree's files, with a preview. ⌘⇧E."],
  ["changes", "Changes", "What changed, with diffs, search, review and commit. ⌘⇧G."],
  ["prs", "PRs", "Open pull requests for the worktrees in this space. ⌘⇧U."],
  ["notes", "Notes", "A scratchpad per space, with attachments. ⌘⇧J."],
  ["tasks", "Tasks", "Kanban board and Today list, with agents' proposals. ⌘⇧K."],
];

const find = (n, id) => { if (n?.id === id) return n; for (const c of n?.children ?? []) { const f = find(c, id); if (f) return f; } return null; };

// The tree as the preferences want it (a copy), or null when it already is.
export function arranged(tree, p = prefs()) {
  const want = JSON.parse(JSON.stringify(tree));
  let changed = false;
  const body = find(want, "work-body");
  if (body?.children) {
    const panel = body.children.find((c) => c.id === "panel"), rest = body.children.filter((c) => c.id !== "panel");
    if (panel) {
      const next = p.panelSide === "left" ? [panel, ...rest] : [...rest, panel];
      if (next.some((c, i) => c !== body.children[i])) { body.children = next; changed = true; }
    }
  }
  const lists = find(want, "sidebar-lists");
  if (lists?.children) {
    const order = p.sidebarOrder ?? [];
    const rank = (c) => { const i = order.indexOf(c.id); return i < 0 ? order.length : i; };
    const next = [...lists.children].sort((a, b) => rank(a) - rank(b));
    if (next.some((c, i) => c !== lists.children[i])) { lists.children = next; changed = true; }
  }
  return changed ? want : null;
}

export function arrange() {
  const tree = layout();
  if (!tree) return false;
  const want = arranged(tree);
  if (want) run("layout.set", { layout: want });
  return Boolean(want);
}
export const node = (id) => find(layout(), id);
