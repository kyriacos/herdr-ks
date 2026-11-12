#!/bin/sh
# Installs this folder into Herdr App: the ks layout, its ks-* mods and its keys section.
# Adapted from herdr-roundup's scripts/sync.sh. Real copies, not symlinks: Herdr doesn't load a mod's SVGs
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
for m in ks-changes ks-review ks-send; do
  mkdir -p "$src/mods/$m/lib" && cp "$src"/shared/*.js "$src/mods/$m/lib/"
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
jq --slurpfile ours "$src/keys.json" --arg s "layout:$name" '. + {($s): ($ours[0][$s] // {})}' "$keys" > "$keys.tmp"
mv "$keys.tmp" "$keys"

for d in "$app"/mods/ks-*/; do herdr-app check "$d"; done
[ "${1:-}" = "--switch" ] && herdr-app do layout.switch "{\"name\":\"$name\"}" >/dev/null

status=$(herdr-app status) || { echo "Installed, but herdr-app status failed: is Herdr App running?" >&2; exit 1; }
errors=$(printf '%s\n' "$status" | jq '.errors | length')
[ "$errors" -eq 0 ] || { printf '%s\n' "$status" | jq '.errors'; exit 1; }
echo "Installed into $app"
