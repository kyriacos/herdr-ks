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
- [Key modes (service and vim)](#key-modes)
- [Zen mode](#zen-mode)
- [Focus mode](#focus-mode)
- [Settings](#settings)
- [Resizing from the keyboard](#resizing-from-the-keyboard)
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

Key chords as modes, in the self-contained `ks-keys` mod. Everything works as usual until you press a mode's key;
then a strip at the bottom of the window shows that mode's keys and catches what you type next. It works the same
in a Claude Code terminal: Herdr takes the key before the terminal sees it.

- **Service mode** is sticky: once in, its keys keep working until Esc. A key that opens something to type into
  (rename, new space, palette, the space picker, search, a close confirmation, the editors) leaves it first.
- **Sticky** modes in general (service, vim, move, resize, tabs, spaces): keys repeat until Esc (or a "leave" key
  such as `i` or `q`).
- **One-shot** (tmux): one key, then back to the terminal.
- **Counts** (vim, move): digits first repeat a key (`3l`) or fill it in (`3gt` goes to tab 3).
- **Sequences**: a key can be several keys (`g t`, `d d`, `g g`); typing the start waits for the rest.
- Pressing a mode's entry key again sends it on to the terminal.
- Any mode can be switched **off**: its key, and every key that leads to it, go away.

**Vim keys** (Settings → Keys & modes, or the switch at the top of the editor's mode list) make the vim bindings
work anywhere, not only from service mode:

- `ctrl-w` then one window command, as in vim: `h j k l` (or `ctrl-h` …) go, `H J K L` swap, `s`/`v` split,
  `n` new pane, `c`/`q` close, `o` zoom, `+`/`-` taller/shorter, `>`/`<` wider/narrower, `=` default size (all on
  what you're in), `T` new tab, `gt`/`gT` tabs, `z` zen, `f` focus mode, `u` undo close, `:` palette, `N` vim
  normal mode. A count after the prefix repeats it (`ctrl-w 5 +`).
- `ctrl-\` enters vim's normal mode directly (as neovim's `ctrl-\ ctrl-n`); there `ctrl-w …` works too.
- It takes `ctrl-w` from the shell and Claude (delete a word): press `ctrl-w` twice to send it, or use
  `alt-backspace`. Both keys can be changed in the editor.

**Shipped modes:**

| Mode | Enter with | Keys |
|---|---|---|
| service (sticky) | `ctrl-;` | `%` split right, `"` split down, `x` close pane, `z` zoom pane, `c` new tab, `n`/`p` next/previous tab, `1`–`9` tab, `&` close tab, `,` rename tab, `$` rename space, `(`/`)` previous/next space, `h j k l` / arrows go to a pane, `H J K L` swap panes, `o` next agent, `s` pick a space, `/` search, `:` palette, `u` undo close, `Z` zen, `f` focus mode, `F` focus & zen settings, `.` all settings, `-`/`=` narrower/wider and `_`/`+` shorter/taller (what you're in), `0` default size, `r` resize mode, `[` vim mode, `m` move mode, `t` tab mode, `S` space mode, `?` editor, Esc out |
| tmux (one key, off) | `ctrl-b` once switched on | `%` `"` split, `x` close pane, `z` zoom, `c` `n` `p` tabs, `&` close tab, `,` `$` rename, `(` `)` spaces, `o` next agent, `s` pick a space, `h j k l` go, `1`–`9`, `[` vim mode |
| window (one key, vim keys) | `ctrl-w` | see **Vim keys** above |
| vim (normal mode for the window) | service `[`, `ctrl-\` with vim keys | `h j k l` pane, `H J K L` swap, `gt`/`gT` or `w`/`b` next/previous tab, `3gt` tab 3, `}`/`{` next/previous space, `3gs` space 3, `ctrl-d`/`ctrl-u` half page, `ctrl-f`/`ctrl-b` page, `ctrl-e`/`ctrl-y` line, `gg`/`G` top/bottom of the scrollback, `/` search, `s`/`v` split, `o` zoom, `dd` close pane, `dt` close tab, `t` new tab, `r` rename, `u` undo close, `zz` zen, `:` palette, `ctrl-w …` window commands, `i`/`a`/`q`/Esc back to the terminal |
| move (sticky) | service `m` | `h j k l` go, `H J K L` swap, `z` zoom, `s`/`v` split, `x` close, `n`/`p` tabs, `t` tab mode, `q`/Enter done |
| resize (sticky) | service `r` | see [Resizing from the keyboard](#resizing-from-the-keyboard) |
| tabs (sticky) | service `t` | `h`/`l` previous/next, `H`/`L` move the tab, `1`–`9`, `c` new, `x` close, `r` rename, `u` undo |
| spaces (sticky) | service `S` | `j`/`k` next/previous, `1`–`9`, `n` new, `w` new + worktree, `r` rename, `x` close, `u` undo |

**The editor** (`cmd-k`, `?` in service mode, or the main menu's **Key modes…**): add, rename, delete or switch off
modes; set each one's entry key (empty: reached only from another mode); make it sticky or take counts; add, edit
or remove keys. A key is a typed character (`%`, `H`), a chord (`ctrl-d`, `left`) or a sequence (`g t`). What it
does is text:

| Text | Does |
|---|---|
| `pane.split direction=right` | A Herdr command with arguments (`herdr-app commands` lists them all) |
| `ks-tabs.undo` | A mod's command |
| `mode:move` | Switch to another mode |
| `leave` | Back to the terminal |
| `send:ctrl+c` | Press keys in the focused terminal |
| `tab.shift by=-1` | Move the shown tab left (1: right) |

A key can also have a **with a count** action, `#` being the count (`tab.select index=#`). **Save** writes the
entry keys into `keys.json` (and keeps them there, even after a reinstall); the rest lives in Herdr's shared state.
**Reset to defaults** brings the shipped modes back.

## Zen mode

`cmd-shift-z` (or service `Z`, vim `zz`, main menu **Zen mode**). The terminal you're in, alone in a floating
window over everything, on a backdrop that covers the rest. Both are windows over your layout, so zen wears
whatever theme is showing.

- **Backdrop:** opaque (default) or translucent, where the sidebar and panels show through like glass and the
  tab area behind zen stays solid so the terminal doesn't show twice. Theme color or dark. Set in the settings.
- **The window:** drag its title bar to move it, its corners to resize it; **Narrower** / **Wider**, **⚙** and
  **Exit** in its bar. Clicking the backdrop brings it back in front. Its size is remembered.
- `cmd-shift-z` again (or Exit) closes it. Switching layouts closes it too.
- While zen is open the space shows a blank "zen" tab, so your tab's terminal is drawn only in zen (at zen's size);
  closing zen removes it and brings your tab back.
- In zen, service mode's pane keys (`h j k l`, splits, zoom, swap) do nothing: zen shows one terminal. `-` / `+` / `=`
  resize and center it, and the key strip stays in front.

## Focus mode

`cmd-shift-f` (or service `f`, main menu **Focus mode**). Everything around your terminals dims until you point at
it: My PRs, spaces, agents, the sidebar's header and footer, the tab bar, the side panel, the status bar, and the
headers of panes that don't have the keyboard. Herdr gives mods no way to dim a terminal's own text, so the text
inside inactive panes keeps its brightness.

The amount is set in the [settings](#settings) (− / + in 5% steps, or 20 / 35 / 50 / 70%; it changes live).

## Settings

Every ks setting in one panel, like Herdr's Settings: the **⚙** at the right of the tab bar, the main menu's
**herdr-ks settings…**, `cmd-shift-,`, or service `.`. Changes apply at once.

| Section | What you can change |
|---|---|
| Focus mode | On / off, how visible dimmed parts stay |
| Zen mode | Open it, backdrop opaque or translucent (and how much), theme color or dark, size |
| Keys & modes | Every mode with its key, the shortcuts, and the key modes editor |
| Tabs & closing | Ask before closing a tab / a pane (never, while an agent works, always), how long a close can be undone (10–120 s) |
| Claude sessions | Show the last session's card after a reboot; forget every remembered session |
| Pull requests | My PRs shown or hidden, its notifications on or off |
| Panels | Hide idle main checkouts |
| Storage | Clear the GitHub cache |
| About | The guide |

## Resizing from the keyboard

In service mode (and in the sticky **resize** mode, service `r`) the resize keys act on **what you're in**: a floating
window (a review or PR window) when it had the keyboard, else the zen window when it's open, else the pane you're in
along its split, else (a lone pane) the pane against the side panel.
The plain key goes one way, the same key with Shift the other; the strip shows which thing they act on.

| Key | Does |
|---|---|
| `-` / `=` | Narrower / wider |
| `_` / `+` (Shift) | Shorter / taller |
| `,` / `.` and `<` / `>` (Shift) | The same pair again in resize mode (in service mode `,` `.` rename and open settings, so only `<` `>`) |
| `0` | Default size: a floating window's default, zen centered, a split even, the side panel to its default width |

Each press is the same small step both ways (2% of the window in zen, 4% of the split); repeated presses build on the
last one, so they don't jump. A count repeats a key in resize mode (`5=`). Resize mode also has fixed targets: `[` / `]`
(or `h` / `l`) the sidebar, `{` / `}` the side panel, `j` / `k` My PRs. `q`, Enter or Esc ends it. A lone pane has nothing
above or below it, so `_` / `+` do nothing there.

## All keys

Only while the `ks` layout shows.

| Key | Does |
|---|---|
| `cmd-shift-n` | New space + worktree |
| `cmd-shift-e` / `cmd-shift-g` / `cmd-shift-u` | Files / Changes / PRs panel |
| `cmd-shift-m` | Show or hide My PRs |
| `cmd-w` / `cmd-shift-w` | Close tab (asks, 30 s undo) / close pane |
| `cmd-shift-t` | Undo the last close |
| `ctrl-;` | Service mode (configurable) |
| `cmd-shift-z` | Zen mode |
| `cmd-shift-f` | Focus mode |
| `cmd-shift-,` | herdr-ks settings |
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
| Settings, choices, pending comments, session records, pending closes, key modes | Herdr's shared state, `~/.config/herdr-app/shared.json` |
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
