# Contributing

How herdr-ks is put together and how to change it. Read [AGENTS.md](AGENTS.md) first: it says what must never
be committed here. For what the layout does, see the [guide](docs/GUIDE.md).

## The loop

```sh
git config core.hooksPath .githooks   # once: turns on the leak check
# edit files here
scripts/install.sh                    # copy into Herdr App and check every mod
```

- `scripts/install.sh [--switch]` installs the layout, the mods, the keys, the `ks-task` command and its
  skill. It fails if any mod has an error.
- `herdr-app check mods/<name>` loads one mod and reports what is wrong.
- `scripts/pull.sh` goes the other way: after editing live in `~/.config/herdr-app`, it copies the layout,
  the mods and the keys back here. Read `git diff` before committing.
- A mod that does not pick up a change: switch layouts and back.

## What is in the repo

| Path | What |
|---|---|
| `layouts/ks.json` | The layout: which mods show where, and its `version` |
| `layouts/ks.png` | The preview picture |
| `keys.json` | The layout's keys (section `layout:ks`) |
| `mods/ks-*/` | One folder per mod: `main.js`, `mod.json`, its icons and scripts |
| `shared/` | Code several mods use. `install.sh` copies it into each mod's `lib/`, which git ignores. Edit `shared/`, never `lib/` |
| `bin/ks-task`, `skills/ks-tasks/` | The task board's command and the skill that teaches agents to use it |
| `scripts/` | `install.sh`, `pull.sh`, `check-leaks.sh` |
| `docs/GUIDE.md` | The user guide |

## The mods

| Mod | What it draws or does |
|---|---|
| `ks-workspace-chrome` | Logo, name, menu and the update check |
| `ks-spaces` | Spaces in the sidebar, grouped by repo and worktree |
| `ks-agents` | The agents list, with the processes under each agent |
| `ks-myprs`, `ks-nowtasks` | Sidebar sections: your open PRs, tasks in progress |
| `ks-tabs` | The tab bar, panel buttons, closing with undo, session records (`session_of.py`: Claude Code and Codex) |
| `ks-pane` | A terminal's header and its menu, with Resume |
| `ks-status` | The status bar |
| `ks-files`, `ks-preview` | The Files panel and file previews |
| `ks-changes` | The Changes panel (`agent_where.py` finds where an agent works: Claude Code, Codex, or any process) |
| `ks-review`, `ks-send` | Review tabs and windows, and the dialog that sends comments to an agent |
| `ks-prs`, `ks-prcard` | The PRs panel and the PR window |
| `ks-notes`, `ks-tasks` | The Notes and Tasks panels |
| `ks-worktree` | The New worktree dialog |
| `ks-menu`, `ks-confirm` | The command menu and the confirm dialog |
| `ks-keys` | Key modes and their editor (self-contained: no `lib/`) |
| `ks-zen`, `ks-resize` | Zen and focus mode, resizing of floating windows |
| `ks-settings` | The settings panel |

In `shared/`: `prefs.js` (settings and their defaults), `branch.js` and `diff.js` (git), `github.js` and
`ci.js` (`gh`), `cache.js`, `comments.js`, `highlight.js`, `sessions.js`, `closing.js`, `focus.js`,
`windows.js` and `panelwin.js` (floating windows), `panelkeys.js`, `arrange.js`, `attach.js`, `spacenames.js`.

## Where Herdr keeps things

| What | Where |
|---|---|
| Layout, mods, keys | `~/.config/herdr-app/` (`layouts/ks.json`, `mods/ks-*/`, `keys.json` section `layout:ks`) |
| Settings, pending comments, session records | `~/.config/herdr-app/shared.json` |
| Notes, tasks, attachments, the GitHub cache | `~/.config/herdr-app/data/` |
| Panel sizes, hidden columns | `~/.config/herdr-app/layouts/.state/` |

None of the last three belongs in this repo.

## Rules of thumb

- A new setting goes in `shared/prefs.js` (`DEFAULTS`) with a control in `mods/ks-settings/main.js`. No
  hard-coded personal folders.
- Update `README.md` (short) and `docs/GUIDE.md` (complete) with the change.
- Code from elsewhere keeps its notice: add a row to `THIRD_PARTY_NOTICES.md`.
- Scripts can drive the layout: `herdr-app do ks-tabs.soft-close:<tab id>`, `ks-tabs.undo`,
  `ks-tabs.panel:files`; `herdr-app commands` lists them all.

## Releases

A release is a tag `vX.Y.Z` with a GitHub release, and the same number in `layouts/ks.json` (`"version"`).
The logo menu's update check reads this repo's releases.
