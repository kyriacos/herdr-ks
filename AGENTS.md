# Working in this repo

Rules for anyone changing herdr-ks, agents first. This repo is a tool for other people to install: it must
never carry anything from the machine, the employer or the projects it was built next to.

## Never commit

- **Credentials**: API keys, tokens, passwords, cookies, session IDs, private keys, certificates, keystores,
  `.env` files, `.npmrc` / `.netrc`, cloud or `gh` config. Not in code, comments, docs, tests or commit messages.
- **People and organisations**: real names, usernames, email addresses, employer, client, vendor or partner
  names, account or ticket numbers. The only identity allowed is the repo owner's GitHub handle in this repo's
  own URL.
- **Work content**: names of private repos, branches, PRs, tickets, database tables, internal hosts or URLs,
  and anything copied from an agent session, a note, a task or a terminal.
- **Machine details**: absolute home paths (`/Users/<name>/...`, `/home/<name>/...`), hostnames, IP addresses.
  Write `~` or `$HOME`.
- **Live state**: nothing from `~/.config/herdr-app/data/`, `shared.json` or `layouts/.state/` (notes, tasks,
  attachments, caches, session logs). `scripts/pull.sh` copies only the layout, the `ks-*` mods and the
  `layout:ks` keys section; check `git diff` after it anyway.

## Examples and placeholders

When a comment, a doc or a placeholder needs an example, invent it. Use these and nothing real:

| For | Use |
|---|---|
| a person or branch owner | `sam` |
| a company or parent folder | `acme`, `~/code/acme` |
| repos | `backend`, `web` |
| a branch | `search-filters`, `sam/search-filters` |
| a source folder | `app/domain/scheduling` |
| a host or email | `example.com`, `sam@example.com` |

## Screenshots and other binaries

A screenshot of a live window shows PR titles, branch names, notes, agent tasks and paths. Text scanners do
not read pictures, and a deleted picture stays in git history.

- Take screenshots only of a window staged for it: demo spaces, demo repos, empty Notes, Tasks and My PRs.
- Open every image and read all the text in it before staging it. If you are an agent, show it to the
  person and wait for a yes.
- `herdr-app shot` writes `herdr-shot.png` into the current folder. It is ignored by git; never force-add it.
- The hook stops new images unless the commit is run with `KS_IMAGES_OK=1`, which means "I looked at them".

## Before every commit

1. `git config core.hooksPath .githooks` once per clone. The pre-commit hook then runs
   `scripts/check-leaks.sh` on what is staged.
2. Read `git diff --cached` yourself. The script catches known shapes, not everything.
3. Stage files by name. No `git add -A` or `git add .`; no `git add -f` on an ignored file.
4. Never pass `--no-verify`. If the check is wrong, fix the check in the same commit and say why.
5. Private words the check should refuse (employer, clients, project code names) go one per line in
   `.private-terms`, which is ignored by git. Never write those words anywhere that is tracked, this file
   included.

`scripts/check-leaks.sh --all` checks every tracked file, `--history` every commit.

## If something sensitive got in

Stop and tell the person at once; do not push. A credential is rotated first, whatever else happens. Removing
the file in a new commit is not enough: it has to be taken out of history (`git filter-repo`) and force-pushed,
which is the person's call to make.

## How the repo works

- `shared/*.js` is the source of truth for code several mods use. `scripts/install.sh` copies it into each
  mod's `lib/`, which git ignores. Edit `shared/`, never a `lib/` copy; run `scripts/install.sh` (or copy
  `shared/*.js` into the mod's `lib/`) before `herdr-app check`.
- `scripts/install.sh` installs into `~/.config/herdr-app`; `herdr-app check <mod folder>` loads one mod and
  reports errors. Run it on every mod you touch.
- New settings go in `shared/prefs.js` (`DEFAULTS`) with a control in `mods/ks-settings/main.js`. No
  hard-coded personal folders: a default that fits anyone, and a setting.
- A release is a tag `vX.Y.Z` with a GitHub release, and the same number in `layouts/ks.json` (`"version"`).
  The logo menu's update check reads the releases of this repo.
- Third-party code keeps its notice: add a row to `THIRD_PARTY_NOTICES.md` when you bring any in.
- Update `README.md` and `docs/GUIDE.md` with the change, in plain words.
