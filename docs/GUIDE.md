# herdr-ks guide

What you get with the `ks` layout for [Herdr App](https://herdr.dev), and how to use each part. The README
covers setup and the list of files changed from upstream; this is the tour.

`ks` is built for one way of working: several Claude Code agents, each in its own git worktree, often across
two repos (a backend and a frontend) at once, with you reviewing their work and sending feedback back to them.

- [The window](#the-window)
- [Spaces, worktrees and new worktrees](#spaces-worktrees-and-new-worktrees)
- [Changes panel](#changes-panel)
- [Files panel](#files-panel)
- [Reviewing: files, branches, several worktrees](#reviewing)
- [Comments and sending them to an agent](#comments-and-sending-them-to-an-agent)
- [Floating review windows](#floating-review-windows)
- [Pull requests: My PRs, the PR window, the PRs panel](#pull-requests)
- [Resuming Claude sessions after a reboot](#resuming-claude-sessions-after-a-reboot)
- [Closing with undo](#closing-with-undo)
- [Key modes (tmux and vim style)](#key-modes)
- [All keys](#all-keys)
- [Speed and caching](#speed-and-caching)
- [Where things are kept](#where-things-are-kept)
- [Troubleshooting](#troubleshooting)

## The window

| Area | What it shows |
|---|---|
| Sidebar, top | **My PRs**: your open GitHub pull requests and where each stands |
| Sidebar, middle | **Spaces**: one per project or worktree, a repo's worktrees grouped on one card |
| Sidebar, bottom | **Agents**: every agent with its status (working, needs you, done, idle) |
| Top bar | Tabs of the current space, **↻ Resume** and **↶ Undo** chips when they apply, **+**, and the **Files / Changes / PRs** panel buttons |
| Middle | The tab's terminals; each pane has a header with its name, id, folder and agent status |
| Right | The side panel: Files, Changes or PRs, remembered per space |
| Bottom | Status bar |

The interface font is JetBrains Mono, the same as the diffs.

## Spaces, worktrees and new worktrees

- Spaces of the same repo sit together on one card in the sidebar: main checkout first, then each worktree
  with its branch.
- **New space + worktree** (`cmd-shift-n`, or right-click a space → New worktree): pick a repo (any folder),
  a branch (existing, or a new name created from HEAD) and where the checkout goes (default
  `~/code/worktrees/<repo>/<branch>`). Enter creates the worktree and opens a space in it.
- A main checkout nobody works in (on `main`/`master`, nothing uncommitted) is left out of the panels, unless
  it's the folder you're in.

## Changes panel

`cmd-shift-g`. What changed, with a highlighted diff and a commit box.

**Which checkout it shows** (the bar under the title):

| Choice | Shows |
|---|---|
| Follow focused terminal (default) | The folder of the terminal you're in |
| **Follow agent** | Every checkout the tab's Claude Code agent worked in this session, most recent first, one foldable section each. Read from its session log (files it edited, folders it `cd`/`git -C`'d into), rechecked every 10 s |
| A worktree | Pinned for this space |
| Matching branch in other repos (on) | Sibling repos (same parent folder) on the same branch show as extra sections, each with its own commit button |

**Switches:** Uncommitted / Branch (everything since the branch left its base) / Commits (pick one), and
Tree / Flat.

**Above the diff:** Wrap, Expand (a [floating window](#floating-review-windows)), Review (a review tab),
Open file. **Review branch** opens the whole branch. When comments are waiting, a bar sends them.

## Files panel

`cmd-shift-e`. The folder tree with git status, search, and previews of Markdown, PDF, images, CSV and JSON.
It follows the Changes panel when that one is pinned or follows an agent. With several worktrees in the
session, a **worktree bar** has a chip for each (repo, folder, branch); **Auto** follows the Changes panel
again. Right-click a file → **Review & comment**.

## Reviewing

**One file** (Review in the Changes panel, or Review & comment in Files): inline or side by side, syntax
highlighted, Wrap, horizontal scroll. Unchanged and untracked files open whole, so you can comment on any file.

**A whole branch** (Review branch): everything the PR would contain, for every repo the panel shows, plus
uncommitted work.

- File list grouped by repo, with status, +/−, comment count and a ✓ once viewed ("3/17 viewed").
- **Files | Commits**: the whole branch, or one commit at a time.
- **Tree | Flat**, foldable repo groups.
- **Worktree bar**: **All** puts every worktree in one view grouped by project; click one to review it alone;
  **+ Add worktree** adds any worktree of the repos involved; × removes one.

**Vim keys in a review:**

| Key | Does |
|---|---|
| `j` / `k` (↓ / ↑) | Move the line cursor |
| `ctrl-d` / `ctrl-u` | Half a page |
| `gg` / `G` | Top / bottom |
| `}` / `{` | Next / previous change |
| `]` / `[`, `J` / `K` | Next / previous file |
| `c` or Enter | Comment on the cursor line |
| `C` | Comment on the file |
| `s` | Inline / side by side |
| `w` | Wrap |
| Esc | Cancel a comment, or close an expanded review |

## Comments and sending them to an agent

- Click a line (or press `c`) to comment; **Comment on file** for the whole file. Enter only saves.
- Nothing reaches an agent until you send. **Send to agent** on one comment sends it alone.
- **Send N to agent…** opens the **send dialog**: every pending comment grouped by worktree and file, each with
  a checkbox, Edit, Delete and Send; a note for anything not tied to a line; **Send to** chips for every running
  agent; **Show message** previews exactly what the agent gets; **Send selected**.
- The agent receives numbered comments with file, line (and commit) and the code line quoted, then they're
  removed from the list. The target is named in the header ("Sends to …").

## Floating review windows

**Expand** opens a file's review floating over the window. Several can be open at once, one per file.

- Drag by the header to move it; it stays where dropped.
- **Drag any corner to resize**: an outline shows the new size, the opposite corner stays put, Esc cancels.
- ⛶ fills the app window, Restore goes back; ✕ or Esc closes.

Switching layouts closes floating windows (a Herdr rule).

## Pull requests

Needs the GitHub CLI (`gh`) logged in.

**My PRs** (sidebar, above Spaces): every open PR you authored, with CI (✓, ✕ with count, ◌ running), review
(approved, changes requested, waiting) and merge state (ready, needs approval, blocked, behind, conflicts).
Ones needing you come first. Click the header to fold it, × to hide, `cmd-shift-m` to show or hide. Toasts when
CI turns red or green, a review lands, or a PR is merged or closed.

**PR window** (click a PR): details, every check, reviews, and **where it lives here**: its local worktrees,
**Go to space**, **Focus agent**, **Review** (its diff against its base), **Open on GitHub**. **Message the
agent** sends your note with the PR as context; the agent on that PR is named and preselected, other agents
are folded away under "Other agents, not working on this PR" (**Send anyway**). With no agent on it, the
button reads **Start a session & send**: Claude Code starts in the PR's worktree (a new tab in the space showing
it, else a new space) with your message as its first task. With no local checkout of the branch, it reads
**Create worktree, start & send** and makes the worktree first (`~/code/worktrees/<repo>/<branch>`).
Movable, resizable from the corners.

**PRs panel** (`cmd-shift-u`): open PRs of the session's worktrees with CI, review state and size; **Review**
(against the PR's own base, so a stacked PR shows only its files), **Review all**, **Open on GitHub**, and
worktrees without a PR.

## Resuming Claude sessions after a reboot

A reboot or logout brings every terminal back as a plain shell in its last folder; Herdr never re-runs Claude.
`ks` remembers which Claude Code session each terminal ran (id, the folder it was started in, its title) and
offers it back:

- **Inside the terminal**, once, after a reboot: a card with the session's title, folder, branch, when it ran,
  the first and last prompts, Claude's last reply and the files it edited. **Enter** resumes, **p** picks
  another session in that folder, any other key keeps the shell.
- **On the tab**: a **↻ Resume** chip (hover for the session and when it ran).
- **In the pane header**: **↻ Resume** runs `claude --resume <id>` in the right folder; the title shows the
  card again; on hover **Pick…** and **✕** (forget it).

These also show after you quit Claude yourself; ✕ dismisses. Quitting and reopening only the Herdr app keeps
agents running, so nothing needs resuming then.

## Closing with undo

Closing a tab or a space asks first, then doesn't really close it for **30 seconds**: its tabs keep running,
put away, and it disappears from the tab bar and sidebar.

- Undo from the toast, the **↶ Undo** chip in the tab bar (with a countdown), or **⌘⇧T** (latest close).
- Closing a space's last tab closes the space the same way.
- After 30 s it closes for real; one due while Herdr was quit closes at the next start.
- The tab menu's "Ask before closing a tab" still offers Never / While an agent works / Always.

## Key modes

Key chords as modes, in the `ks-keys` mod. A key enters a mode; a strip at the bottom of the window shows that
mode's keys and catches the next one.

- **One-shot modes** (tmux, vim): one key and out.
- **Sticky modes** (move, tabs, spaces): keys repeat until Esc, Enter or `q`, so `h h l` walks between panes.
- Pressing the mode's entry key again sends it on to the terminal (`ctrl-b ctrl-b` sends `ctrl-b`, as in tmux).
- Modes can switch to each other (`m`, `t`, `S` from tmux).

**Shipped modes:**

| Mode | Enter with | Keys |
|---|---|---|
| tmux | `ctrl-b` | `%` split right, `"` split down, `x` close pane, `z` zoom, `c` new tab, `n`/`p` next/previous tab, `1`–`9` tab, `&` close tab, `,` rename tab, `$` rename space, `(`/`)` previous/next space, `h j k l` and arrows go to a pane, `H J K L` swap panes, `o` next agent, `s` pick a space, `/` search, `:` palette, `u` undo close, `m` move mode, `t` tab mode, `S` space mode, `?` editor |
| vim | off (set e.g. `ctrl-w`) | `h j k l` go, `H J K L` swap, `s`/`v` split down/right, `q`/`c` close, `o` zoom, `n` new tab, `t`/`T` next/previous tab, `m` move mode |
| move (sticky) | from tmux `m` | `h j k l` go, `H J K L` swap, `z` zoom, `s`/`v` split, `x` close, `n`/`p` tabs, `t` tab mode |
| tabs (sticky) | from tmux `t` | `h`/`l` previous/next, `H`/`L` move the tab, `1`–`9`, `c` new, `x` close, `r` rename, `u` undo |
| spaces (sticky) | from tmux `S` | `j`/`k` next/previous, `1`–`9`, `n` new, `w` new + worktree, `r` rename, `x` close, `u` undo |

**The editor** (`cmd-k`, or `?` in tmux mode) changes all of it: add, rename or delete modes, set each mode's
entry key (empty: reached only from another mode), make it sticky, and add, edit or remove keys. A key is a
typed character (`%`, `H`) or a chord (`ctrl-x`, `left`). What a key does is written as text:

| Text | Does |
|---|---|
| `pane.split direction=right` | A Herdr command with arguments (`herdr-app commands` lists them all) |
| `ks-tabs.undo` | A mod's command |
| `mode:move` | Switch to another mode |
| `send:ctrl+c` | Press keys in the focused terminal |
| `tab.shift by=-1` | Move the shown tab left (1: right) |

**Save** writes the entry keys into `keys.json` for the `ks` (and `ks-zen`) layouts; the rest is kept in
Herdr's shared state. **Reset to defaults** brings the shipped modes back.

Note: Claude Code uses `ctrl-b` itself (background tasks). In `ks` the prefix catches it first; press it
twice to send it through, or pick another entry key (`ctrl-a`, `ctrl-space`) in the editor.

## All keys

Only while the `ks` layout shows.

| Key | Does |
|---|---|
| `cmd-shift-n` | New space + worktree |
| `cmd-shift-e` / `cmd-shift-g` / `cmd-shift-u` | Files / Changes / PRs panel |
| `cmd-shift-m` | Show or hide My PRs |
| `cmd-w` / `cmd-shift-w` | Close tab (asks, 30 s undo) / close pane |
| `cmd-shift-t` | Undo the last close |
| `ctrl-b` | tmux mode (configurable) |
| `cmd-k` | Key modes editor (configurable) |

Herdr's own keys still apply (`cmd-t` new tab, `cmd-d` split, `cmd-1`…`9` tabs, `cmd-alt-arrows` panes, …).

## Speed and caching

GitHub answers are cached in `~/.config/herdr-app/data/ks-cache/` and shown at once, then refreshed in the
background ("updating…"). My PRs pre-fetches each PR's details so a PR window opens instantly. Reading the cache
takes milliseconds against 1–2 s per `gh` call. Delete the folder to start over.

## Where things are kept

| What | Where |
|---|---|
| Layout, mods, keys | `~/.config/herdr-app/` (`layouts/ks.json`, `mods/ks-*`, `keys.json` section `layout:ks`) |
| Choices, pending comments, session records, pending closes, key modes | Herdr's shared state, `~/.config/herdr-app/shared.json` |
| GitHub cache | `~/.config/herdr-app/data/ks-cache/` |
| This repo | install with `scripts/install.sh [--switch]`, copy back live edits with `scripts/pull.sh` |

## Troubleshooting

- **A mod doesn't pick up a change**: switch layouts and back (`main` → `ks`) to restart the mods; a pane mod
  in an open tab needs that tab reopened.
- **Light theme looks broken in Claude Code** (heavy red/green diff rows, unreadable gray text): Claude Code
  has its own theme. Run `/theme` in Claude and pick a light one (or set `"theme": "light"` in
  `~/.claude/settings.json`). Its auto theme can't tell Herdr's background, so pick it explicitly.
- **Follow agent shows nothing**: Claude Code only, and it needs `python3`.
- **PR features empty**: `gh auth status` must be logged in.
