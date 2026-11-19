# herdr-ks guide

What you get with the `ks` layout for [Herdr App](https://herdr.dev), and how to use each part. The README
covers setup; [CONTRIBUTING.md](../CONTRIBUTING.md) covers how the repo is built; this is the tour.

`ks` is built for one way of working: several coding agents (Claude Code first, Codex and others too), each in its own git worktree, often across
two repos (a backend and a frontend) at once, with you reviewing their work and sending feedback back to them.

- [The window](#the-window)
- [Spaces, worktrees and new worktrees](#spaces-worktrees-and-new-worktrees)
- [Changes panel](#changes-panel)
- [Files panel](#files-panel)
- [Reviewing: files, branches, several worktrees](#reviewing)
- [Comments and sending them to an agent](#comments-and-sending-them-to-an-agent)
- [Floating review windows](#floating-review-windows)
- [Notes](#notes)
- [Tasks](#tasks)
- [Dashboard](#dashboard)
- [Pull requests: My PRs, the PR window, the PRs panel](#pull-requests)
- [Resuming sessions after a reboot](#resuming-sessions-after-a-reboot)
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

The interface font is whatever you pick in Herdr's Settings (the layout sets none); JetBrains Mono matches the diffs.

## Spaces, worktrees and new worktrees

- **Space names** come from the worktree its agent works in: `search-filters · backend + web` (the branch first,
  then the repos on it; `+2` for other worktrees), or `herdr-ks · main` on main. Under the name: what the agent is
  working on (its tab's name, else its title) and git's ↑ ↓ ±. A name you give a space (right-click → Rename) is
  kept, unless it only repeats the repo or folder (`backend`, `web`, `~`). The worktrees are the ones the Changes
  panel has seen the agent use, plus the folders the agents run in; a space nobody has looked at yet keeps
  Herdr's name until then.

- Spaces of the same repo sit together on one card in the sidebar: main checkout first, then each worktree
  with its branch.
- **New space + worktree** (`cmd-shift-n`, or right-click a space → New worktree): pick a repo (any folder),
  a branch (existing, or a new name created from HEAD) and where the checkout goes (default
  `~/code/worktrees/<repo>/<branch>`, the folder is set in Settings > Spaces & agents). Enter creates the worktree and opens a space in it.
- A main checkout nobody works in (on `main`/`master`, nothing uncommitted) is left out of the panels, unless
  it's the folder you're in.

## Changes panel

`cmd-shift-g`. What changed, with a highlighted diff and a commit box.

**Search** (the box under Uncommitted / Branch / Commits, or `/`): every word must appear in a file's path; the
list, the counts and `j`/`k` follow it, and folders with a match open. In Commits it narrows the commits by
subject, sha or author. Enter opens the first match, Esc clears, ✕ too.

**Which checkout it shows** (the bar under the title):

| Choice | Shows |
|---|---|
| Follow focused terminal (default) | The folder of the terminal you're in |
| **Follow agent** | Every checkout the tab's agent worked in this session, most recent first, one foldable section each. Claude Code and Codex: read from the session log (files it edited, folders it `cd`/`git -C`'d into). Any other agent: where its process and its commands are right now. Rechecked every 10 s |
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

- **Compared with** the branch it was made from: of your recent branches, the one it has the fewest commits beyond
  (a branch stacked on a feature branch is compared with that feature; a fresh one with `main`), else origin's
  default. Click **vs main ▾** under a repo in the file list to pick any other branch (type to filter, Enter picks
  the first); **Default** goes back. A PR opened from the PRs panel uses the PR's own base.
- **On `main` itself** there's nothing to compare, so **Commits** (here and in the Changes panel) lists the last 30
  commits instead, each one reviewable; any unpushed commits come first as usual.

- File list grouped by repo, with status, +/−, comment count and a ✓ once viewed ("3/17 viewed").
- **Files | Commits**: the whole branch, or one commit at a time.
- **Tree | Flat**, foldable repo groups.
- **Worktree bar**: **All** puts every worktree in one view grouped by project; click one to review it alone;
  **+ Add worktree** adds any worktree of the repos involved; × removes one.

**Moving between changes:** a file opens with the cursor on its first change. The header shows **Change 2 of 5**
with **↑** / **↓** to the previous / next change in that file, and **← File** / **File →** for the previous / next
file (branch review).

**Zoom and zen:** two zooms, each the same on every pane. **Over its tab** (`cmd-shift-enter`, `ctrl-w o`, service `o`/`z`,
tmux / move `z`, vim `o`, the pane header's Zoom): the other panes in the tab hide, the sidebar and side panel stay.
**Over the window** (`cmd-shift-alt-enter`, `ctrl-w O`, service `O`, tmux / move `Z`, vim `O`, the pane menu's "Zoom over the
window"): the sidebar and side panel hide too. A pane alone in its tab stays as it is with the tab-level keys; use the window-level ones to hide the sidebar and panel.
Zooming again brings everything back. A zoomed pane's header shows **⤢ Zoomed · N hidden** (click it to
unzoom) and its tab shows **⤢**.
**Zen** (`cmd-shift-z`, service `Z`, vim `zz`) opens the review in the zen window, on the file you were on; Esc or
Exit leaves zen, and the review tab moves to the file you ended on.

**Vim keys in a review:**

| Key | Does |
|---|---|
| `j` / `k` (↓ / ↑) | Move the line cursor |
| `ctrl-d` / `ctrl-u` | Half a page |
| `gg` / `G` | Top / bottom |
| `n` / `N` (or `p`), `}` / `{` | Next / previous change in this file |
| `]` / `[`, `J` / `K` | Next / previous file |
| `c` or Enter | Comment on the cursor line |
| `C` | Comment on the file |
| `s` | Inline / side by side |
| `w` | Wrap |
| Esc | Cancel a comment, close an expanded review, or leave zen |

## Comments and sending them to an agent

- Click a line (or press `c`) to comment; **Comment on file** for the whole file. Enter only saves.
- Nothing reaches an agent until you send. **Send to agent** on one comment sends it alone.
- **Send N to agent…** opens the **send dialog**: every pending comment grouped by worktree and file, each with
  a checkbox, Edit, Delete and Send; a note for anything not tied to a line; **Send to** chips for every running
  agent; **Show message** previews exactly what the agent gets; **Send selected**.
- The agent receives numbered comments with file, line (and commit) and the code line quoted, then they're
  removed from the list. The target is named in the header ("Sends to …").

**Pictures:** with an image on the clipboard (a screenshot, say), `cmd-v` in a comment box, the send dialog's note,
or a PR window's message attaches it; it shows as a thumbnail (× removes it). The agent gets each picture's full
path in the message and opens it. A comment can be just a picture. The same `cmd-v` in a task's description or
comment, or in a note being edited, adds the picture to its attachments.

## Floating review windows

**Expand** opens a file's review floating over the window. Several can be open at once, one per file.

- Drag by the header to move it; it stays where dropped.
- **Drag any corner to resize**: an outline shows the new size, the opposite corner stays put, Esc cancels.
- ⛶ fills the app window, Restore goes back; ✕ or Esc closes.

Switching layouts closes floating windows (a Herdr rule).

## Processes under an agent

An agent's row in **Agents** shows **N procs** when something runs under it (accent when one serves a port). Click
it to expand: each process with its command (launcher prefixes like `uv run` dropped), the folder it runs in, its
ports (click one to open `http://localhost:<port>`), how long it has run, CPU when busy, and **■** to stop it (click
twice; it stops everything under that command). MCP servers fold into one line (hover for the list). Looked at every
5 s while expanded, every 15 s otherwise. `ks-agents.procs` toggles the focused agent's list (bind it in the key
modes editor).

## Notes

A scratchpad in the side panel: **Notes** in the tab bar, or `cmd-shift-j`. **⤢** (or `z`) opens them in a window of
its own, every note in a grid of equal squares; drag its corners (or use the key modes' resize keys) and it keeps that size.

- **This space** shows the notes written in the space you're in; **All** shows every note. Closing a space keeps
  its notes (marked closed); a new space in the same folder picks them up again.
- **Search** (`/`): every word must appear in the note or its space's name; Esc clears it.
- In **All**: **Grouped** (`gs`) turns grouping by space on or off; the space chips narrow it to one space.
- Every note shows which space it's in (hover the tag for what its agent was working on); the space header shows
  that too, live while the space is open, and the last one seen once it's closed.
- **+ New** (or `n`) starts a note in this space. It's saved as you type; the first line is its title. **Done** or
  Esc stops editing; a note left empty goes away.
- **Delete** (or `x`) removes one, with **Undo** (or `u`) for a few seconds.
- Keys in the panel: `j`/`k`, `gg`/`G`, Enter or `o` to edit, `a` This space / All, `/` search, `gs` grouping, `h`/`l`/Esc to leave.
- **Attachments:** drop files from Finder onto a note to attach them, or onto the list for a new note carrying them.
  While editing, **Attach…** picks files and **Paste image** adds a copied picture. Pictures show as thumbnails; a
  click opens any attachment. Copies are kept in `data/ks-attach/`, so moving the original doesn't break them.
- Stored in `~/.config/herdr-app/data/ks-notes.json` (plain JSON, one entry per note with its space's name and folder).

## Tasks

A kanban board and a Today list: **Tasks** in the tab bar, or `cmd-shift-k`. **Here / All** (`s`): the panel
shows this space's tasks (made in it, or in its worktrees), the board window every space's.

**In the sidebar**, above My PRs: what's in progress now (the board's Doing column, every space, up to three),
with how many are planned for today and how many agents proposed. Click a task to open it, the header for the
board on all spaces; the chevron folds it.

**⤢** (or `z`) opens the board in a
window of its own; drag its corners to resize it (or use the key modes' resize keys), and it keeps that size.

- **Board:** columns of your own. **+ Column** adds one; click a column's name (or `r`) to rename it, with **‹ ›**
  to move it and **Delete** (a column with tasks hands them to the first other column). Drag a card to another
  column or between two cards, or use `H`/`L` (to the column left / right) and `J`/`K` (up / down).
- **Today:** what you plan to do today, then the backlog (everything else that isn't done). The **☀** on a card
  (or `t`) moves it between the two; dragging works here too. The board's last column counts as done, and its tasks
  leave both lists.
- **A task** (click it, or Enter) opens in a window you can move and resize by its corners; every task opens at the
  last size. It has its title, description, column, Today, attachments, and its **Activity**: the
  comments and everything that happened to it (created, moved, renamed, added to today, attached, started, done),
  with who did it, oldest first. `ks-task show ID` prints the same. Drop files onto
  it, or **Add files…** / **Paste image**; write a comment and **Comment** (or `cmd-enter`). Esc closes it.
  It opens with the description ready to type in (the title, for a task with none). **Tab** / **shift-Tab** move
  through everything: title, the column pills, Today, description, Add files, Paste image, the comment box,
  Comment, Delete. On a button or pill (ringed in the accent colour), Enter or Space presses it. Enter in the title
  goes to the description.
- **Work on a task.** When an agent starts a task (`ks-task start`, from its own terminal), the card shows it:
  **● agent working**, **agent needs you** or **agent waiting for you**; click it to go to that agent. The card
  also shows the task's PRs (number and state: open, draft, merged, closed; click opens it), its Linear ids and
  the agent's branch. In the task's window, **Work** has the agent with **Focus agent** and its screen as it
  changes (**Hide screen** / **Show screen**), the PRs with their titles, the Linear issues, and the worktree
  (click copies the path). PRs come from `ks-task link`, GitHub PR links in the description or comments, and the
  PR of the agent's branch, looked up with `gh`. Linear ids come from links, the title, the description and the
  branch; one with a link opens it, others copy the id.
- **Subagents.** When the agent on a task is Claude Code and hands work to subagents, the ones for that task show
  too: **◆ <what it's doing>** on the card, and under **Subagents** in the window (working or finished, how long
  ago). Click one to watch it: a subagent has no terminal, so the window shows what it said and the commands it
  ran lately, read from its transcript. **Focus agent** goes to the session that runs it. A subagent counts as the
  task's when its prompt has the task's id, it ran `ks-task start` on it, or it shares a Linear id or several
  title words with it. PRs a subagent opened show on the task too.
- **Right-click a card** to talk to an agent about it: **Ask about it: <agent>** (the task's space's agent first,
  then up to three others) shows that agent and pastes the task's reference into its prompt, not sent, so you type
  what you want to discuss and press Enter. The reference reads `Task <id> "<title>" from my board (ks-task show
  <id> for the details)`, and the agent reads the rest with `ks-task`. **Copy reference** puts it on the
  clipboard instead; **Open** opens the task. A task's window has **Ask agent** too.
- Drop files onto a card to attach them to that task, or onto a column or list for a new task carrying them.
- **New tasks:** `n` opens a box right under the selected task, `N` one at the end of its list (or column), and
  **+ Add task** at the end of each list does the same. Type and Enter: the task is saved and selected, so the next
  Enter opens it for details. Esc cancels. Not while you're typing in a box.
- **Undo / redo:** every change on the board or in Today (moves, today on / off, adding, deleting, columns): `u` /
  `U`, `cmd-z` / `cmd-shift-z`, or **↶ ↷** in the header. A card's **×** deletes it, with Undo.
- Keys: `j`/`k`, `gg`/`G`, `h`/`l` between columns, Enter/`o` open, `n`/`N` new below / at the end, `t` today, `x` delete, `u`/`U` undo / redo,
  `b` Today / Board, `z` the window.
- **Agents:** any Claude session can use the `ks-task` command (the `ks-tasks` skill tells it how). Ask it to "add a
  task", "track this", "what's on my board"; it also proposes follow-ups it notices. What an agent adds on its own
  arrives **proposed**: at the top of Today, with ✓ Accept (`a`) and ✕ Dismiss (`x`), and the tab bar's button
  shows "Tasks · N new" with a notification. Tasks you asked it to add land directly. An agent can `start` only an
  accepted task (it moves to Doing, marked with its name), leaves progress `comment`s, and marks it `done`.
  `ks-task --help` lists everything; it works from any terminal too.
- Stored in `~/.config/herdr-app/data/ks-tasks.json`, attachments in `data/ks-attach/` (neither is in the repo).

## Dashboard

What you did today, this week and this month. **In the sidebar**, at the top: today in one line (PRs merged,
lines added and removed, tasks done, Linear issue ids). Click it for the window (resizable, Esc or ✕ closes).

- **Today / This week / This month** (`1` `2` `3`, or Tab): a one-line summary, tiles (PRs merged, lines, tasks
  done, Linear issues), then the merged PRs (repo, number, size, branch, merge time, Linear ids; click opens it
  on GitHub), the tasks finished on the board, and the Linear issue ids (click copies). `r` looks again.
- **Views** (the header, beside the ranges): which repos the dashboard shows. **All repos**, or a view of your
  own: **+** opens a new one, with a name and every owner and repo it has seen ticked or not. `acme/*` takes a
  whole owner (a GitHub org or user), new repos included; or tick single repos, such as `acme/web`. A view keeps
  only its PRs, the tasks whose folder is in one of its repos, and their Linear ids. Click a view to show it,
  click it again to edit or delete it; `v` steps through them. The sidebar line follows the view you pick. Repos
  show up in the editor once the dashboard has seen them, so look at This month first.
- **Linear issues** are the ids found in your merged PRs (titles, branch names, descriptions) and done tasks, such
  as `ENG-123` or a branch `sam/eng-123-search-filters`. Nothing is read from Linear itself.
- **Prompts** (left): **▶ Run** gathers the prompt's range and hands it, with the prompt's text, to `claude -p`
  (no tools, not saved as a session) for a written summary. It starts with one: **Daily: what I merged**, today's
  merged PRs with what each changed and why, grouped by repo, and possible follow-ups. It also runs on its own
  once a day after 18:00 while Herdr is open. Today's latest summary shows under Today.
- **Runs** (left): every run kept, newest first: when, which prompt, how many PRs. Click one for its summary and
  the PRs it covered; **Delete run** removes it. Each prompt has a view chip (**All repos** at first): click it
  to tie the prompt to a view, so its runs cover only those repos. Without `claude` a run keeps the data and says why there's no
  summary.
- Prompts are in `~/.config/herdr-app/data/ks-dashboard/prompts.json` (`id`, `name`, `range`: day, week or month,
  `text`, `auto`: a time like `"18:00"` or null, `view`: a view's id or null), views in `views.json`, runs in
  `runs/`. Edit the file to change or add prompts.
- Needs `gh` signed in; summaries need Claude Code (`claude`).

## Pull requests

Needs the GitHub CLI (`gh`) logged in.

**My PRs** (sidebar, above Spaces): every open PR you authored, with CI (✓, ✕ with count, ◌ running), review
(approved, changes requested, waiting) and merge state (ready, needs approval, blocked, behind, conflicts).
Ones needing you come first. Click the header to fold it, × to hide, `cmd-shift-m` to show or hide. Toasts when
CI turns red or green, a review lands, or a PR is merged or closed.

- **CI colours:** yellow while checks are still running (and "waiting on CI" instead of GitHub's "unstable"), red
  only when a check actually failed. Cancelled and skipped checks (a run superseded by a newer push) don't count.
- **Updates:** every minute, every 20 s while a PR's CI is running, 30 s after a failed look, and straight away
  after the Mac wakes. A look that hangs gives up after 20 s. When the list is older than a minute and a half, the
  header shows its age (`3m`, red if the last look failed); ↻ or `r` looks now. The PRs panel follows the same pace.

**PR window** (click a PR): details, every check, reviews, and **where it lives here**: its local worktrees,
**Go to space**, **Focus agent**, **Review** (its diff against its base), **Open on GitHub**. **Message the
agent** sends your note with the PR as context; the agent on that PR is named and preselected, other agents
are folded away under "Other agents, not working on this PR" (**Send anyway**). With no agent on it, the
button reads **Start a session & send**: Claude Code starts in the PR's worktree (a new tab in the space showing
it, else a new space) with your message as its first task. With no local checkout of the branch, it reads
**Create worktree, start & send** and makes the worktree first (`~/code/worktrees/<repo>/<branch>` unless you changed the folder; slashes in the branch become dashes, as in
the New worktree dialog). The repo's clone is looked for next to the repos your session already has open, then
in the folders listed in Settings > Pull requests > Repo folders (default `~/code`, comma-separated, two
levels deep). If it says "No local clone", add the clone's parent folder there.
Movable, resizable from the corners.

**PRs panel** (`cmd-shift-u`): open PRs of the session's worktrees with CI, review state and size; **Review**
(against the PR's own base, so a stacked PR shows only its files), **Review all**, **Open on GitHub**, and
worktrees without a PR.

## Resuming sessions after a reboot

A reboot or logout brings every terminal back as a plain shell in its last folder; Herdr never re-runs the agent.
`ks` remembers which Claude Code or Codex session each terminal ran (id, the folder it was started in, its
title) and offers it back. The card is for Claude Code sessions; a Codex session gets the Resume buttons:

- **Inside the terminal**, once, after a reboot: a card with the session's title, folder, branch, when it ran,
  the first and last prompts, Claude's last reply and the files it edited. **Enter** resumes, **p** picks
  another session in that folder, any other key keeps the shell.
- **On the tab**: a **↻ Resume** chip (hover for the session and when it ran).
- **In the pane header**: **↻ Resume** runs `claude --resume <id>` (`codex resume <id>` for Codex, which has
  no card) in the right folder; the title shows the
  card again; on hover **Pick…** and **✕** (forget it).

These also show after you quit Claude yourself; ✕ dismisses. Quitting and reopening only the Herdr app keeps
agents running, so nothing needs resuming then.

## Closing with undo

Closing a tab or a space asks first, then doesn't really close it for **30 seconds**: its tabs keep running,
put away, and it disappears from the tab bar and sidebar.

- Undo from the toast, the **↶ Undo** chip in the tab bar (with a countdown), or **⌘⇧T** (latest close).
- Closing a space's last tab closes the space the same way.
- **A space with more than one tab** always asks first (whatever the settings), naming its tabs, and waits at
  least **10 minutes** before closing for real, so there's time to notice and undo.
- After 30 s it closes for real; one due while Herdr was quit closes at the next start.
- The tab and pane menus' "Ask before closing" offer Never / While something runs in it / Always. "Something"
  is any agent (idle at its prompt too) or any program running in its terminals: a dev server, a build, a
  background job (`&`). Only a shell waiting at its prompt closes without asking. The dialog lists what runs.

## Key modes

Key chords as modes, in the self-contained `ks-keys` mod. Everything works as usual until you press a mode's key;
then a strip at the bottom of the window shows that mode's keys and catches what you type next. It works the same
in a Claude Code terminal: Herdr takes the key before the terminal sees it.

- **The strip shows only keys that work where you are:** no swap with one pane, no tab 7 with three tabs, no next
  space with one space, no terminal keys in a review or panel, and in zen only zen's own keys. A hidden key pressed
  anyway says why in the strip.
- **Service mode** is sticky: once in, its keys keep working until Esc. A key that opens something to type into
  (rename, new space, palette, the space picker, search, a close confirmation, the editors) leaves it first.
- **Sticky** modes in general (service, vim, move, resize, tabs, spaces): keys repeat until Esc (or a "leave" key
  such as `i` or `q`). If something else takes the keyboard (a click elsewhere), the strip takes it back, so Esc
  always closes the strip first; it closes itself when it can't get it back within 5 seconds.
- **One-shot** (`ctrl-w`, tmux): one key, then back to the terminal. The strip closes after 5 seconds with no key,
  or as soon as you click elsewhere.
- **Counts** (vim, move): digits first repeat a key (`3l`) or fill it in (`3gt` goes to tab 3).
- **Sequences**: a key can be several keys (`g t`, `d d`, `g g`); typing the start waits for the rest.
- Pressing a mode's entry key again sends it on to the terminal.
- Any mode can be switched **off**: its key, and every key that leads to it, go away.

**Vim keys** (Settings → Keys & modes, or the switch at the top of the editor's mode list) make the vim bindings
work anywhere, not only from service mode:

- `ctrl-w` then one window command, as in vim: `h j k l` (or `ctrl-h` …) go, `H J K L` swap, `s`/`v` split,
  `n` new pane, `c`/`q` close, `o` zoom over the tab, `O` over the window, `+`/`-` taller/shorter, `>`/`<` wider/narrower, `=` default size (all on
  what you're in), `T` new tab, `gt`/`gT` tabs, `z` zen, `f` focus mode, `u` undo close, `:` palette, `N` vim
  normal mode. A count after the prefix repeats it (`ctrl-w 5 +`).
- `ctrl-\` enters vim's normal mode directly (as neovim's `ctrl-\ ctrl-n`); there `ctrl-w …` works too.
- It takes `ctrl-w` from the shell and Claude (delete a word): press `ctrl-w` twice to send it, or use
  `alt-backspace`. Both keys can be changed in the editor.

**The strip waits.** The keys work as soon as you enter a mode, but the strip only appears after a 1 s pause, and
each key starts the wait again, so a combo you know never shows it. Change it in Settings → Keys & modes
(at once, 0,5 s, 1 s, 1,5 s, 2,5 s).

**Every side panel in a window.** Files, Changes, PRs, Notes and Tasks each have a **⤢** in their header: the panel
opens in a window of its own, resizable from its corners or with the key modes' resize keys, and it keeps its size.
The keys are the same everywhere: `z` in a panel opens its window and `z` in the window closes it; the window-level
zoom keys (`cmd-shift-enter`, `ctrl-w o`, service `o` / `z`) do the same whenever a panel or its window has the
keyboard. Esc or ✕ closes the window.

**Panels with vim keys.** `h`/`l` (service, vim normal mode) or `ctrl-w h`/`ctrl-w l` move the keyboard into the side
panels; a focused panel gets an accent border. In every panel: `j`/`k` move, `gg`/`G` first/last, `ctrl-d`/`ctrl-u`
half a page, Enter/`o` open, `h`/`l` leave towards that side, Esc back to the terminal.

- **Changes:** `j`/`k` walk the files and show each diff. `l` or Tab moves into the diff, which has a line cursor:
  `j`/`k`, `gg`/`G`, `ctrl-d`/`ctrl-u`/`ctrl-f`/`ctrl-b`/`ctrl-e`/`ctrl-y`, `}`/`{` next/previous hunk, `H`/`L`
  30 lines, `J`/`K` next/previous file, `h`/Esc back to the list. Also Enter/`o` review the file in a tab, `e` in
  a window, `O` the file itself, `1`/`2`/`3` uncommitted/branch/commits, `t` tree, `w` wrap, `c` the commit
  message, `R` review the branch, Backspace back to the commits.
- **Files:** `j k h l` as the arrows (`l` opens a folder, `h` closes it or goes to its parent), `gg`/`G`, `o` open,
  `/` search.
- **PRs:** Enter/`o` review, `O` on GitHub, `R` review all, `r` refresh. **My PRs:** Enter/`o` the PR window,
  `r` refresh, Space fold.
- **Review tabs and windows** already had vim keys (see Reviewing).

**Shipped modes:**

| Mode | Enter with | Keys |
|---|---|---|
| service (sticky) | `ctrl-;` | `%` split right, `"` split down, `x` close pane, `z`/`o` zoom pane over its tab, `O` over the window, `c` new tab, `n`/`p` next/previous tab, `1`–`9` tab, `&` close tab, `,` rename tab, `$` rename space, `(`/`)` or `P`/`N` previous/next space, `h j k l` / arrows go to a pane, `H J K L` swap panes, `a` next agent, `s` pick a space, `/` search, `:` palette, `u` undo close, `Z` zen, `f` focus mode, `F` focus & zen settings, `.` all settings, `-`/`=` narrower/wider and `_`/`+` shorter/taller (what you're in), `0` default size, `r` resize mode, `[` vim mode, `m` move mode, `t` tab mode, `S` space mode, `?` editor, Esc out |
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

`cmd-shift-z` (or service `Z`, vim `zz`, main menu **Zen mode**). The terminal (or [review](#reviewing)) you're in, alone in a floating
window over everything, on a backdrop that covers the rest. Both are windows over your layout, so zen wears
whatever theme is showing.

- **Backdrop:** opaque (default) or translucent, where the sidebar and panels show through like glass and the
  tab area behind zen stays solid so the terminal doesn't show twice. Theme color or dark. Set in the settings.
- **The window:** drag its title bar to move it, its corners to resize it; **Narrower** / **Wider**, **⚙** and
  **Exit** in its bar. Clicking the backdrop brings it back in front. Its size is remembered.
- `cmd-shift-z` again (or Exit) closes it. Switching layouts closes it too.
- While zen is open the space shows a blank "zen" tab, so your tab's terminal is drawn only in zen (at zen's size);
  closing zen removes it and brings your tab back.
- In zen the key strip shows only what works there: zen itself, focus mode, resizing (`-` / `=` / `_` / `+` / `0`),
  settings and the editor. Tab, space, agent and pane keys would change what's behind zen, so they're hidden (pressed
  anyway, the strip says why). The strip stays in front.
- Zen opens 64% as wide as the window (Narrower / Wider and settings change it).

## Focus mode

`cmd-shift-f` (or service `f`, main menu **Focus mode**). Everything around your terminals dims until you point at
it: My PRs, spaces, agents, the sidebar's header and footer, the tab bar, the side panel, the status bar, and the
headers of panes that don't have the keyboard. Herdr gives mods no way to dim a terminal's own text, so the text
inside inactive panes keeps its brightness.

The amount is set in the [settings](#settings) (− / + in 5% steps, or 20 / 35 / 50 / 70%; it changes live).

## Settings

Every ks setting in one panel, like Herdr's Settings: the **⚙** at the right of the tab bar, the main menu's
**herdr-ks settings…**, `cmd-shift-,`, or service `.`. Changes apply at once, and each has a line saying what it
does. Layout choices are kept in Herdr's shared state and put back after a reinstall.

| Section | What you can change |
|---|---|
| Layout | Side panel left or right (the sidebar's sections include Dashboard); which side panels get a tab bar button; the sidebar's sections shown or hidden, and their order (↑ ↓); reset to the defaults |
| Tasks | Panel starts on this space or all; how many tasks the sidebar lists; toasts for agents' proposals |
| Notes | Panel starts on this space or all |
| Spaces & agents | Name spaces by repo and branch; what each agent works on under its space; the processes chip under agents |
| Focus mode | On / off, how visible dimmed parts stay |
| Zen mode | Open it, backdrop opaque or translucent (and how much), theme color or dark, size |
| Keys & modes | Every mode with its key, the shortcuts, and the key modes editor |
| Tabs & closing | Ask before closing a tab / a pane (never, while something runs in it, always), how long a close can be undone (10–120 s) |
| Claude sessions (Codex sessions too) | Show the last session's card after a reboot; forget every remembered session |
| Pull requests | My PRs shown or hidden, its notifications on or off |
| Panels | Hide idle main checkouts |
| Storage | GitHub cache: clear inactive entries or everything, auto-clear after 3, 7 (default), 14 or 30 days, or never |
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
| `cmd-shift-j` | Notes panel |
| `cmd-shift-k` | Tasks panel |
| `cmd-w` / `cmd-shift-w` | Close the focused pane (its tab too when it's the last pane, and the space when it's the last tab) / close the tab (asks, with undo) |
| `cmd-shift-t` | Undo the last close |
| `ctrl-;` | Service mode (configurable) |
| `cmd-shift-z` | Zen mode |
| `cmd-shift-enter` | Zoom the pane over its tab only (sidebar and side panel stay) |
| `cmd-shift-alt-enter` | Zoom the pane over the whole window (other panes, sidebar and side panel hidden) |
| `cmd-shift-f` | Focus mode |
| `cmd-shift-,` | herdr-ks settings |
| `cmd-k` | Key modes editor (configurable) |

Herdr's own keys still apply (`cmd-t` new tab, `cmd-d` split, `cmd-1`…`9` tabs, `cmd-alt-arrows` panes, …).

## Speed and caching

GitHub answers are cached in `~/.config/herdr-app/data/ks-cache/` and shown at once, then refreshed in the
background ("updating…"). My PRs pre-fetches each PR's details so a PR window opens instantly. Reading the cache
takes milliseconds against 1–2 s per `gh` call.

Entries in use refresh every few minutes. Ones not refreshed for 7 days are deleted on their own, at start and
every 6 hours (Settings → Storage: 3, 7, 14, 30 days or never). **Clear inactive** there removes merged or closed
PRs, PRs not in My PRs that nobody opened in a day, and PRs panel lists not used in a day (a new one is kept each
time the set of open spaces changes). **Clear everything** starts over.

## Where things are kept

| What | Where |
|---|---|
| Layout, mods, keys | `~/.config/herdr-app/` (`layouts/ks.json`, `mods/ks-*`, `keys.json` section `layout:ks`) |
| Settings, choices, pending comments, session records, pending closes, key modes | Herdr's shared state, `~/.config/herdr-app/shared.json` |
| GitHub cache | `~/.config/herdr-app/data/ks-cache/` |
| Dashboard prompts and runs | `~/.config/herdr-app/data/ks-dashboard/` |
| This repo | install with `scripts/install.sh [--switch]`, copy back live edits with `scripts/pull.sh` |

## Troubleshooting

- **A mod doesn't pick up a change**: switch layouts and back (`main` → `ks`) to restart the mods; a pane mod
  in an open tab needs that tab reopened.
- **Light theme looks broken in Claude Code** (heavy red/green diff rows, unreadable gray text): Claude Code
  has its own theme. Run `/theme` in Claude and pick a light one (or set `"theme": "light"` in
  `~/.claude/settings.json`). Its auto theme can't tell Herdr's background, so pick it explicitly.
- **Follow agent shows nothing**: it needs `python3`. Claude Code and Codex are read from their session logs;
  another agent is followed only by where its process is now, so it must be inside a git checkout.
- **PR features empty**: `gh auth status` must be logged in.
