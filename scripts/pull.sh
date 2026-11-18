#!/bin/sh
# The other direction: copies the live layout, ks-* mods and keys section from Herdr App back into
# this folder, after you (or an agent) changed them in ~/.config/herdr-app. Review with `git diff`.
set -eu
dst=$(cd "$(dirname "$0")/.." && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
name=ks

cp "$app/layouts/$name".* "$dst/layouts/"
for d in "$app"/mods/ks-*/; do
  rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude lib/ "$d" "$dst/mods/$(basename "$d")/"
done
jq --arg s "layout:$name" '{($s): .[$s]}' "$app/keys.json" > "$dst/keys.json"
echo "Pulled from $app"
