#!/bin/sh
# Installs this folder into Herdr App: the ks layout, its ks-* mods and its keys section.
# Real copies, not symlinks: Herdr doesn't load a mod's SVGs
# through a symlink. Other mods, layouts and key sections in the app are left alone.
# Usage: scripts/install.sh [--switch]   (--switch also shows the layout)
set -eu
src=$(cd "$(dirname "$0")/.." && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
name=ks

command -v jq >/dev/null || { echo "needs jq (brew install jq)" >&2; exit 1; }
command -v rsync >/dev/null || { echo "needs rsync" >&2; exit 1; }
[ -d "$app" ] || { echo "$app not found: install and start Herdr App first" >&2; exit 1; }

# Mods can't import from each other: shared/ (highlighter, diff model, review comments) is copied into the
# mods that use it before they're installed.
for d in "$src"/mods/ks-*/; do
  [ "$(basename "$d")" = ks-keys ] && continue  # self-contained
  mkdir -p "$d/lib" && cp "$src"/shared/*.js "$d/lib/"
done

mkdir -p "$app/layouts" "$app/mods"
cp "$src/layouts/$name".* "$app/layouts/"

for d in "$src"/mods/ks-*/; do
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json "$d" "$app/mods/$(basename "$d")/"
done

# keys.json: only the layout's own section is replaced (a backup is kept).
keys="$app/keys.json"
[ -f "$keys" ] || echo '{}' > "$keys"
cp "$keys" "$keys.bak-$(date +%s)"
# Entries ks-keys wrote (its entry keys, "ks-keys.*") are kept: they come from its editor, not from this repo.
for s in "layout:$name"; do
  jq --slurpfile ours "$src/keys.json" --arg s "$s" \
    '. + {($s): (($ours[0][$s] // {}) + ((.[$s] // {}) | with_entries(select((.value | type) == "string" and (.value | startswith("ks-keys."))))))}' "$keys" > "$keys.tmp"
  mv "$keys.tmp" "$keys"
done

# Commands (bin/: ks-task) linked into ~/.local/bin, and Claude Code skills (skills/: ks-tasks) copied into
# ~/.claude/skills, so every agent session can use them.
mkdir -p "$HOME/.local/bin"
for f in "$src"/bin/*; do [ -f "$f" ] && chmod +x "$f" && ln -sf "$f" "$HOME/.local/bin/$(basename "$f")"; done
for d in "$src"/skills/*/; do [ -d "$d" ] && mkdir -p "$HOME/.claude/skills" && rsync -a --delete "$d" "$HOME/.claude/skills/$(basename "$d")/"; done

for d in "$app"/mods/ks-*/; do herdr-app check "$d"; done
[ "${1:-}" = "--switch" ] && herdr-app do layout.switch "{\"name\":\"$name\"}" >/dev/null

status=$(herdr-app status) || { echo "Installed, but herdr-app status failed: is Herdr App running?" >&2; exit 1; }
errors=$(printf '%s\n' "$status" | jq '.errors | length')
[ "$errors" -eq 0 ] || { printf '%s\n' "$status" | jq '.errors'; exit 1; }
echo "Installed into $app"
