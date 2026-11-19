---
name: ks-tasks
description: The user's local task board (the Tasks panel of their ks Herdr App layout), driven with the `ks-task` command. Use it when the user asks to add, track, list, update or finish tasks, "keep track of this", "make a task for", "what's on my board", or to note follow-ups; and on your own to propose follow-up work you notice but won't do now (bugs, TODOs, out-of-scope fixes, open questions), to say when you start and finish a task from the board, and to leave progress notes on it. Local tracking, separate from Linear.
---

# Local tasks (ks-task)

The user keeps a local kanban board in Herdr App (Tasks panel: Today, Backlog, columns). `ks-task` reads and
writes it. It's for local tracking: what agents are doing, follow-ups, and things that might not be in Linear yet.
It is not Linear, and doesn't replace it.

## Proposing vs adding

- Tasks you add arrive **proposed**: the user sees them at the top of the panel and accepts or dismisses them.
  That's the default, and it's right for anything you thought of yourself.
- When the user *asks* you to add a task ("add a task to…", "track this"), add it with `--direct` so it lands as
  a real task straight away.
- Never accept or start a proposed task on your own. `ks-task accept ID` only when the user says so.

## Commands

```sh
ks-task add "Short imperative title" --body "Why, where (file:line), what done looks like"   # proposed
ks-task add "Title" --direct [--today] [--column "To do"]                                    # user asked for it
ks-task list                     # open tasks (proposed marked); --all, --mine (this repo), --proposed, --json, search words
ks-task show ID                  # details, comments, attachment paths
ks-task start ID                 # move to the in-progress column, as yours (refused while still proposed);
                                 # run it from your own terminal and worktree: the board shows you on the card
ks-task link ID URL...           # the PR you opened, the Linear issue: shown on the card and in the task
ks-task comment ID "progress note"
ks-task done ID "what was done, PR link"
ks-task move ID "Column" | update ID --title/--body/--today | attach ID path... | accept ID | dismiss ID | columns
```

IDs can be shortened to a unique prefix. `ks-task --help` lists everything.

## When the user hands you a task

A message like `Task t… "Title" from my board (ks-task show t… for the details)` is a reference the user pasted
from the board to talk about that task. Run `ks-task show ID` first to read its description, comments and
attachments, then answer what they asked. Don't `start` it unless they ask you to work on it.

## How to use it well

- **Before adding, list or search** (`ks-task list words from the title`) so you don't duplicate. The same open
  title twice is ignored anyway.
- **Titles:** short and imperative ("Handle expired broker tokens in refresh"). Put the detail in `--body`: the
  why, where in the code, and what done looks like. Mention a Linear issue id if there is one.
- **Propose sparingly:** real follow-ups the user would want to know about, not every small thought. Group
  related items into one task.
- **Working from the board:** when the user points you at a task, `ks-task show ID`, then `start` it, leave a
  `comment` at real milestones (not every step), `link` the PR as soon as you open it (and the Linear issue's
  URL when you have it), and `done` with a short summary when finished.
- **Handing a task to a subagent:** put the task id in the subagent's prompt (`Board task tm4k…`) and have it
  run `ks-task start ID` itself, and `ks-task link ID <url>` for the PRs it opens. The board then shows that
  subagent on the card and what it's doing in the task's window.
- **When unsure** whether something belongs in Linear or here, ask; or propose it here and say so.
- Tell the user briefly what you added or changed, with the ids, e.g. "Proposed 2 tasks: tm4k… (token refresh),
  tm4l… (flaky broker test)."
- Never put secrets, credentials or client personal data (names, account numbers, IDs) in tasks, comments or
  attachments.
