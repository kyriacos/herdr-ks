# herdr-ks

My Herdr App setup: a layout called `ks`, built from the [Herdr Roundup](https://github.com/carstenlucke/herdr-roundup)
layout (v0.10.0, Apache-2.0, see `LICENSE` and `THIRD_PARTY_NOTICES.md`) with changes for working across git
worktrees and two repos. It is a separate layout with its own `ks-*` mods: an installed Herdr-Roundup
stays untouched next to it.

**[Read the guide](docs/GUIDE.md)** for a tour of everything it does and how to use it.

## What it does

**The window.** A sidebar on the left with your spaces (one per project or worktree) and below it every
agent with its status (working, done, idle). Tabs along the top, terminals in the middle, a status bar at
the bottom. A side panel on the right shows either **Files** or **Changes** for the space you're in.

**Worktrees in the sidebar.** Spaces that belong to the same repo sit together on one card: the spaces in
the main checkout first, then each worktree space with its branch underneath.

**New space + worktree in one step.** Press `cmd-shift-n` (or right-click a space, "New worktree"). Type
or edit three fields, `tab` moves between them:

1. Repository: any repo folder (pre-filled with the one you're in).
2. Branch: an existing branch is checked out; a new name creates the branch from the repo's current HEAD.
3. Folder: where the checkout goes, default `~/code/worktrees/<repo>/<branch>`; any path, `~` works.

Enter creates the worktree and opens a new space in it.

**Changes panel** (`cmd-shift-g`). Uncommitted changes with a diff and a commit box. The bar under the
title says which branch and folder you're looking at; click it to choose:

- *Follow focused terminal* (default): the folder of the terminal you're in. If that terminal left the
  repo (`cd ~`), the space's own folder is shown instead.
- A main checkout nobody is working in (on `main`/`master` with nothing uncommitted) is left out, here and in
  the Files and PRs panels, unless it's the folder you're in yourself.
- *Follow agent*: every checkout a Claude Code agent in this tab worked in this session, one section each,
  most recent first (several worktrees of one repo each count). Click a section's header to fold it. Read from its session log: the files
  it last edited and the folders its commands `cd` or `git -C` into, not the folder it was started in
  (Claude Code keeps resetting that one). Rechecked every 10s. Also a one-click **Follow agent** button on
  the bar; **Following ✕** stops it. Claude Code only; needs `python3` (macOS has one).
- Any worktree of the repo: pins the panel to it for this space.
- *Matching branch in other repos* (on by default): other repos in the same parent folder (for example
  `backend` and `web` in `~/code/acme`) that have a checkout on the same branch show as extra
  sections, so backend and frontend changes are visible together. Each repo gets its own commit button;
  the message stays after the first commit so it can be reused for the second.

Each changed file has a **Review** button (opens it in a review tab, below), and the header has **Review
branch**: the whole branch in one review tab.

- **Uncommitted | Branch | Commits**: what the list shows. Uncommitted is the working tree (with the commit
  box). Branch is everything since the branch left its base (merge-base with `origin`'s default branch).
  Commits lists the branch's commits per repo; click one for its files, "← All commits" to go back.
- **Tree | Flat**: folders you can fold, or one list. Both remembered.
- Above the diff: **Wrap** (lines wrap to the panel instead of scrolling sideways), **Expand** (the file's
  review in a floating window: one per file, several open at once, dragged by its header and left where you
  drop it; drag any corner to resize it (the opposite corner stays put, an outline shows the new size, Esc
  cancels), ⛶ fills the app window and Restore goes back, ✕ or Esc closes; expanding the same file again
  brings its window back), **Review** (in a tab), **Open file** (the file itself in a
  preview tab). Expand and Review compare the way the panel does (uncommitted, branch, or that commit). The diff under the list is
syntax highlighted. When review comments are waiting for these repos, a bar above the commit box sends them
all to the agent.

**Review tab.** A file in a tab of its own, from the Changes panel's **Review** button or the Files panel's
right-click "Review & comment":

- **Inline** or **Side by side** (removed lines left, added lines right, paired), syntax highlighted.
- Click any line to comment on it (side by side: the half you click is the old or new line); **Comment on
  file** comments on the whole file. Comments show under their line and in the column on the right.
- Enter only saves a comment; nothing goes to the agent until you send. **Send to agent** on one comment
  sends it at once; **Send N to agent…** opens the send dialog (below). Sent comments are pasted into the
  agent and submitted (`hc send`), numbered, with file, line and the code line quoted, then removed.
  The agent is the one the Changes panel follows, else the one in the shown tab, else the space's latest.
- Unchanged and untracked files open whole, so any file can be commented on.

**Send dialog** (review tab **Send N to agent…**, Changes panel **Review & send…**). Every pending comment of
that review or panel, grouped by worktree and file, each with a checkbox (all ticked to start), **Edit**
(Enter saves), **Delete** and its own **Send**; **Select all / None**; a note box for anything not tied to a
line (sent after the comments, or alone); **Send to** chips for every running agent; **Show message** previews
exactly what the agent gets. **Send selected (N)** sends the ticked ones; the dialog closes when none are left.

**Branch review** (Changes panel, **Review branch**). Everything the PR would contain, for every repo the panel
shows (backend and web together when both are on the branch): the commits since the branch left its base
(`git merge-base` with `origin`'s default branch, else main/master) plus uncommitted and untracked work.

- A file list on the left, grouped by repo, with branch, base and commit count; each file with its status,
  +/−, comment count and a ✓ once viewed ("3/17 viewed").
- **Files | Commits**: Files is the whole branch; Commits lists the branch's commits per repo (newest first,
  with "Uncommitted changes" on top when there are any). Click a commit to see only its files and diffs;
  "← All commits" goes back, Files returns to the whole branch. A comment made inside a commit is tied to it
  and reaches the agent as `file:line (in commit abc1234)`.
- **Tree | Flat**: folders you can fold, with single-child chains joined (`app/domain/scheduling`) and
  per-folder counts, or one flat list. Remembered.
- In the file list (and the commit list), click a worktree's header to fold it; Prev/Next and `J`/`K` skip
  folded worktrees.
- **Worktree bar**: **All** shows every worktree in the review in one view, grouped by project and worktree;
  click a worktree to review it alone (again for all); **+ Add worktree** lists every worktree of the repos
  next to the ones open (all backend and web worktrees, with their branches) to add; × removes one.
- **Wrap** (or `w`) wraps lines to the view; otherwise the diff scrolls sideways.
- **← Prev** / **Next →** or the keys below step through the files in the order shown; comments work as in a
  file review, and **Send N to agent** sends every comment of the review at once.
- The header names the agent comments go to ("Sends to …"). From the Changes panel while it follows an agent,
  that agent; otherwise the shown tab's, else the space's most recent one.

**Vim keys** in a review tab: `j`/`k` (or ↓/↑) move a line cursor, `ctrl-d`/`ctrl-u` half a page, `gg`/`G`
top/bottom, `}`/`{` next/previous change, `]`/`[` or `J`/`K` next/previous file (branch review), `c` or Enter
comment on the cursor line, `C` comment on the file, `s` inline/side by side, `w` wrap, `Esc` cancel a comment (or close an expanded
review).

**My PRs** (top of the sidebar, above Spaces). Every open pull request you authored on GitHub (`gh`), each
with where it stands: **CI** (✓ passing, ✕ failing with how many, ◌ running), **review** (approved, changes
requested, waiting) and **merge** (ready, needs approval, blocked, behind, conflicts); drafts are marked.
Ones that need you (failing CI, changes requested, conflicts) come first, then running ones, then ready ones.
Click a row for its **PR window** (below). Click the header to fold the section to one line (with "N need you" /
"N running"); × hides it, `cmd-shift-m` shows or hides it. A toast when a PR's CI turns red or green, it's
approved, changes are requested, or it's merged or closed. Refreshes every minute (↻ now).

**PR window** (click a PR in My PRs). The PR floating over the window, movable by its header and resizable
from its corners: state, review decision, merge state, size, branch → base; every **check** by name (failing
first); **reviews** and who's been asked; **where it lives here**: the local worktrees on its branch, with
**Go to space** for the spaces showing them, **Focus agent** for the agents working in them, and **Review**
(its diff against its base); **Open on GitHub**; and **Message the agent**, sent right away with the PR (repo, number, title, branch,
link) as context. The agent working on the PR (in one of its worktrees) is named as such and preselected;
other agents are kept apart, folded under "Other agents, not working on this PR", and picking one turns the
button into **Send anyway** with a warning. With no agent on the PR, the button becomes **Start a session &
send**: Claude Code starts in the PR's worktree (a new tab in the space showing it, else a new space) with the
message as its first task; with no local checkout, **Create worktree, start & send** makes the worktree first
(`~/code/worktrees/<repo>/<branch>`, from the local branch or `origin`).

**PRs panel** (`cmd-shift-u`, or **PRs** next to Files and Changes). The open pull requests of this
session's worktrees: the ones the Changes panel shows, so while it follows an agent, every worktree the agent
touched. Each PR shows its title and number, branch → base, draft / review state, CI checks (pass, running,
failing) and size. **Review** opens its diff against the PR's own base branch (a stacked PR shows only its own
files) in a branch review; **Review all** puts every PR in one review, one worktree each; **Open on GitHub**.
Worktrees without an open PR are listed below. Needs the GitHub CLI (`gh`) logged in; refreshes every minute.
The review compares the local worktree, so it also shows work not pushed yet.

**Files panel** (`cmd-shift-e`). The folder tree of the space with git status, search, and previews of
Markdown, PDF, images, CSV and JSON (upstream Roundup). It shows the same checkout as the Changes panel when
that one is pinned or follows an agent. When the session has several worktrees (the ones the Changes panel
shows), a **worktree bar** under the header has a chip for each (repo, folder, branch): click one to browse
it, **Auto** to follow the Changes panel / the focused terminal again. Remembered per space. Right-click a file for **Review & comment**.

**Font.** The interface uses JetBrains Mono, the same monospace as the diffs (`ui_font` on the layout).

**Speed: stale while revalidate.** GitHub answers (`gh`) are cached in `~/.config/herdr-app/data/ks-cache/`
(small JSON files shared by every mod and window). My PRs, the PRs panel and the PR window show the last
answer at once and refresh it in the background ("updating…"); My PRs also pre-fetches every PR's details
after each refresh, so a PR window opens instantly. Delete the folder to start over.

**Resume after a reboot.** A reboot (or logout) brings each terminal back as a plain shell in its last
folder; Herdr never re-runs Claude. So the tab bar records, every 20 s, which Claude Code session each agent
terminal runs (its id, the folder Claude was started in, and its title: your `/rename`, else Claude's own title,
else the first prompt), kept in Herdr's shared state so it survives the restart. Then:

- **Inside the tab:** a terminal that came back after a reboot shows a card of its last session once: title,
  folder, branch, when it ran, the first and last prompts, Claude's last reply and the files it edited. **Enter**
  resumes it, **p** picks another session there, any other key keeps the shell.
- **On the tab:** a **↻ Resume** chip (hover: which session, how long ago).
- **In the pane header:** **↻ Resume** runs `claude --resume <id>` in the session's folder; clicking the title
  shows the card again; on hover **Pick…** (Claude's own list of that folder's sessions) and **✕** (forget it).

They also show after you quit Claude yourself (✕ dismisses). Records of closed tabs go after a week.

**Closing with undo.** Closing a tab or a space asks first (the tab menu's "Ask before closing a tab" still
offers Never / While an agent works), then isn't closed for 30 s: its tabs are put away (still running), it
disappears from the tab bar and the sidebar, and a toast and a **↶ Undo** chip in the tab bar (with a countdown)
bring it back as it was; **⌘⇧T** undoes the latest. Closing a space's last tab closes the space the same way.
After 30 s it closes for real (a close due while Herdr was quit happens at the next start). Scripts can use
`herdr-app do ks-tabs.soft-close:<tab id>` and `ks-tabs.undo`.

**Key modes** (`ks-keys`, self-contained). `ctrl-;` enters service mode: a strip at the bottom shows its keys (`%` `"` split,
`h j k l` go, `x` close, `Z` zoom, `z` zen, …) and they keep working until Esc. A one-shot tmux mode (`ctrl-b`) ships off. `[` from there enters a vim normal mode
for the window (motions, counts, `gt`/`3gt`, `gg`/`G`, `ctrl-d`/`ctrl-u` scrolling, `dd`), until `i` or Esc. Sticky
move, tab and space modes too. `cmd-k` opens the editor: switch modes off, change entry keys, edit every key.
See the [guide](docs/GUIDE.md#key-modes).

**Zen mode** (`cmd-shift-z`): the tab alone, centered in a rounded frame on your theme's background (or dark), with
a slim bar (pane only, narrower / wider, settings, exit); drag its edges to resize. **Focus mode** (`cmd-shift-f`):
everything around the terminals dims until hovered, with the amount set in **Focus & zen settings** (main menu or
service `F`). **Resize mode** (service `r`): keep pressing `-` / `+`, `[` / `]`, `{` / `}` to size the panel,
sidebar or zen width.

## Set up

1. Install Herdr App from [herdr.dev](https://herdr.dev) and start it once (it creates `~/.config/herdr-app`).
2. Install the tools the script uses: `brew install jq` (`rsync` ships with macOS).
3. Clone or copy this folder, then run:

   ```sh
   cd ~/code/herdr-ks
   scripts/install.sh --switch
   ```

   It copies the layout and the `ks-*` mods into `~/.config/herdr-app`, replaces only the
   `layout:ks` section of `keys.json` (the old file is kept as `keys.json.bak-<time>`), checks
   every mod and switches the window to the layout. Nothing else in your Herdr setup is touched.
4. Optional: create `~/code/worktrees` if you want the default worktree folder (git creates it on
   the first worktree anyway).

`ctrl-shift-l` switches back to another layout. To remove it, delete `layouts/ks.*`, the
`mods/ks-*` folders and the `layout:ks` section of `keys.json` in `~/.config/herdr-app`.

## Keep it up to date

After changing things live in `~/.config/herdr-app` (by hand or with an agent), run `scripts/pull.sh` to
copy them back here, then review with `git diff` and commit.

## Where Herdr keeps things

| What | Where |
|---|---|
| Layout | `~/.config/herdr-app/layouts/ks.json` |
| Mods | `~/.config/herdr-app/mods/ks-*/` |
| Keys | `~/.config/herdr-app/keys.json`, section `layout:ks` |
| Panel sizes, hidden columns (clicks) | `~/.config/herdr-app/layouts/.state/` (not in this repo) |
| Mods' own state (Changes pins, ...) | `~/.config/herdr-app/data/<mod>/` (not in this repo) |

## Changes from upstream Roundup

Every mod is upstream's `roundup-<name>` renamed to `ks-<name>` (all references too). On top of that:

| Change | Files |
|---|---|
| Sidebar: every space in a repo's main checkout joins the repo's card, not only the first | `mods/ks-spaces/main.js` |
| New Changes panel (clone of Herdr's `changes`): checkout bar to follow focus, pin any worktree, or **Follow agent** (a Claude Code agent's real working folder, read from `~/.claude/sessions` and its session log); falls back to the space folder outside git; **matching repos**: sibling repos (same parent folder) with a checkout on the same branch show as extra sections, one commit button each | `mods/ks-changes/` (`agent_where.py` finds the agent's checkouts), layout uses it |
| New worktree dialog (clone of Herdr's `worktree`): **New space + worktree** from any repo into any folder, default `~/code/worktrees/<repo>/<branch>` | `mods/ks-worktree/`, `mods/ks-menu/main.js` |
| Panel commands `panel:files` / `panel:changes` | `mods/ks-tabs/main.js` |
| Review tab: one file or a whole branch (vs merge-base, over several repos), inline / side by side, highlighted, line and file comments sent to an agent, vim keys | `mods/ks-review/` (new) |
| Shared code: highlighter, diff model and wrapping, comment store, branch/commit/worktree git, GitHub (`gh`) and a file cache; copied into `lib/` of the mods using it by `install.sh` | `shared/` |
| Changes panel: Uncommitted / Branch / Commits, tree / flat, Wrap / Expand / Review / Open file above the diff | `mods/ks-changes/main.js` |
| Files panel: "Review & comment" menu entry; follows the Changes panel's pinned or agent checkout | `mods/ks-files/input.js`, `main.js`, `location.js` |
| Interface font JetBrains Mono | `layouts/ks.json` (`ui_font`) |
| PRs panel: open PRs of the session's worktrees, review each against its base | `mods/ks-prs/` (new), layout `prs` block, `mods/ks-tabs/main.js` |
| Send dialog: choose, edit, delete, add a note, pick the agent, preview, then send | `mods/ks-send/` (new) |
| My PRs in the sidebar: your open PRs with CI, review and merge state, foldable, hideable | `mods/ks-myprs/` (new), layout `my-prs` block |
| PR window: details, checks, reviews, its worktree / space / agent, message the agent | `mods/ks-prcard/` (new) |
| Corner resizing of floating review windows (a full-app surface follows the drag, then the window reopens at the new size) | `mods/ks-resize/` (new), `mods/ks-review/main.js` |
| Resume Claude sessions after a reboot: recorded per terminal, a card of the last session inside the terminal, ↻ Resume in the tab and the pane header | `mods/ks-tabs/main.js`, `session_of.py`, `last_session.py`, `mods/ks-pane/main.js`, `shared/sessions.js` |
| Closing tabs and spaces asks, then waits 30 s with Undo (toast, tab bar chip, ⌘⇧T) | `shared/closing.js`, `mods/ks-tabs/` (`close.js`, `main.js`), `mods/ks-pane/close.js`, `mods/ks-confirm/`, `mods/ks-menu/`, `mods/ks-spaces/` |
| Key modes: service (tmux style) / vim normal mode / sticky modes, counts and sequences, a which-key strip, an editor, and keys.json kept in step | `mods/ks-keys/` (new), layout `floating` |
| Zen mode (own layouts, theme or dark backdrop) and focus mode (dims the interface until hovered), with a settings dialog | `mods/ks-zen/` (new), `layouts/ks-zen.json`, `layouts/ks-zen-dark.json`, `shared/focus.js`, every layout mod's `render` |
| Herdr's agents list and status bar cloned, so focus mode dims them | `mods/ks-agents/`, `mods/ks-status/` (clones), layout |
| PR window: Start a session & send (and Create worktree) when no agent is on the PR | `mods/ks-prcard/main.js` |

## Keys (only while this layout shows)

| Key | Does |
|---|---|
| cmd-shift-n | New space + worktree |
| cmd-shift-e | Toggle Files panel |
| cmd-shift-g | Toggle Changes panel |
| cmd-shift-u | Toggle PRs panel |
| cmd-shift-m | Show / hide My PRs in the sidebar |
| cmd-w / cmd-shift-w | Close tab / pane (a tab asks, then can be undone for 30 s) |
| cmd-shift-t | Undo the last close (tab or space) |
| ctrl-; | Service key mode (configurable) |
| cmd-k | Key modes editor (configurable) |
| cmd-shift-z | Zen mode |
| cmd-shift-f | Focus mode |

## Upstream updates

The automatic update check is off in this layout (`mods/ks-workspace-chrome/update.js`, `due()`):
it looks for Herdr Roundup releases, and installing one updates the separate Herdr-Roundup layout, not
this one. To take improvements from a new Roundup release, clone it and compare its `mods/roundup-<name>`
with `mods/ks-<name>` here, then copy over what you want and run `scripts/install.sh`.
