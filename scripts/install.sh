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
# Every side panel handles the keyboard the same way (ctrl-w o, z, the zoom keys): stop if one lost a piece.
"$src/scripts/check-panels.sh"
[ -d "$app" ] || { echo "$app not found: install and start Herdr App first" >&2; exit 1; }

# Mods can't import from each other: shared/ (highlighter, diff model, review comments) is copied into the
# mods that use it before they're installed. Each mod gets only the shared files it imports (from its own .js
# files, `./lib/<name>.js`), and the ones those import in turn: Herdr reloads every mod whose files change, so
# copying all of shared/ everywhere made one shared edit reload all of them. A missed import shows up in the
# herdr-app check below.
deps() {
  want=$(grep -ho '\./lib/[A-Za-z0-9_-]*\.js' "$1"*.js 2>/dev/null | sed 's|\./lib/||' | sort -u)
  while :; do
    more=$(for f in $want; do grep -ho '"\./[A-Za-z0-9_-]*\.js"' "$src/shared/$f" 2>/dev/null | tr -d '"' | sed 's|\./||'; done)
    all=$(printf '%s\n%s\n' "$want" "$more" | grep . | sort -u)
    [ "$all" = "$want" ] && break
    want=$all
  done
  echo "$want"
}
for d in "$src"/mods/ks-*/; do
  [ "$(basename "$d")" = ks-keys ] && continue  # self-contained
  need=$(deps "$d")
  mkdir -p "$d/lib"
  # Shared files it no longer uses go (the rsync below drops them from the app too).
  for f in "$d"lib/*.js; do [ -e "$f" ] || continue; echo "$need" | grep -qx "$(basename "$f")" || rm -f "$f"; done
  # -p keeps shared/'s mtimes so the rsync below skips unchanged lib files: a fresh mtime on every
  # install made rsync rewrite lib/ in every mod, and Herdr hot-reloads each mod whose files change.
  for f in $need; do cp -p "$src/shared/$f" "$d/lib/"; done
done

mkdir -p "$app/layouts" "$app/mods"
rsync -a "$src/layouts/$name".* "$app/layouts/"  # skips unchanged files, so Herdr doesn't reload the layout

for d in "$src"/mods/ks-*/; do
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json "$d" "$app/mods/$(basename "$d")/"
done

# keys.json: only the layout's own section is replaced, and only when that changes it (then a backup is kept).
# Rewriting it unchanged on every install made Herdr reload its keys and left a backup each time.
keys="$app/keys.json"
[ -f "$keys" ] || echo '{}' > "$keys"
# Entries ks-keys wrote (its entry keys, "ks-keys.*") are kept: they come from its editor, not from this repo.
cp "$keys" "$keys.new"
for s in "layout:$name"; do
  jq --slurpfile ours "$src/keys.json" --arg s "$s" \
    '. + {($s): (($ours[0][$s] // {}) + ((.[$s] // {}) | with_entries(select((.value | type) == "string" and (.value | startswith("ks-keys."))))))}' "$keys.new" > "$keys.tmp"
  mv "$keys.tmp" "$keys.new"
done
if cmp -s "$keys" "$keys.new"; then rm -f "$keys.new"
else cp "$keys" "$keys.bak-$(date +%s)"; mv "$keys.new" "$keys"; fi

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
