#!/bin/sh
# Every side panel (the mods in layouts/ks.json's panel-body) has to handle the keyboard the same way, or ctrl-w o,
# z and the zoom keys stop being reliable on it. This checks each one has the pieces (shared/panelkeys.js,
# shared/panelwin.js, shared/windows.js):
#   focus   marks itself the moment it gets the keyboard (takeFocus / gotFocus)
#   watch   keeps the mark current as the keyboard comes and goes (watchFocus)
#   strip   hands keys typed while a key strip opens to the strip, before its own keys (toStrip)
#   zoom    opens its window on "zoom" / z, closes it on "unzoom" (zoomCommand, or its own "zoom" / "unzoom")
#   claim   its window takes the keyboard when it opens (claim / initWindow)
#   back    its window hands the keyboard back to the panel when it closes (backToPanel / closeWindow, or
#           lib/panelwin.js's zoomCommand, which closes through closeWindow)
# Run by scripts/install.sh; exits 1 with what's missing.
set -eu
src=$(cd "$(dirname "$0")/.." && pwd)
mods=$(jq -r '.. | objects | select(.id? == "panel-body") | .children[]? | .content.mod // empty' "$src/layouts/ks.json")
fail=0
need() { # mod, label, pattern
  grep -Eq "$3" "$src/mods/$1/main.js" || { echo "check-panels: $1 has no $2 ($3)" >&2; fail=1; }
}
for m in $mods; do
  case "$m" in ks-*) ;; *) continue ;; esac  # Herdr's own panels aren't ours to check
  need "$m" focus 'takeFocus\(|gotFocus\('
  need "$m" watch 'watchFocus\('
  need "$m" strip 'toStrip\('
  need "$m" zoom '"zoom"|zoomCommand'
  need "$m" unzoom '"unzoom"|zoomCommand'
  need "$m" claim 'claim\(|initWindow\('
  need "$m" back 'backToPanel|closeWindow|zoomCommand'  # zoomCommand: lib/panelwin.js closes through closeWindow
done
[ "$fail" -eq 0 ] && echo "check-panels: $(echo $mods | wc -w | tr -d ' ') panels ok"
exit "$fail"
