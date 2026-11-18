#!/bin/sh
# Refuses secrets, personal details and private words. See AGENTS.md.
# Usage: scripts/check-leaks.sh            what is staged (the pre-commit hook)
#        scripts/check-leaks.sh --all      every tracked file
#        scripts/check-leaks.sh --history  every commit of every branch
# Private words to refuse go one per line in .private-terms (ignored by git).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
mode=${1:-staged}
bad=0
fail() { bad=1; printf '\n✗ %s\n' "$1" >&2; [ -n "${2:-}" ] && printf '%s\n' "$2" | cut -c1-200 | head -20 >&2; }

# File names that never belong here.
NAMES='(^|/)(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)[^/]*|credentials[^/]*\.json|herdr-shot\.png|shared\.json)$|\.(pem|key|p12|pfx|crt|cer|der|jks|keystore|mobileprovision|kdbx)$'
# Shapes of credentials.
SECRETS='gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-(ant-|proj-)?[A-Za-z0-9_-]{32,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY|(lin_api|glpat|npm|shpat|dop_v1)_[A-Za-z0-9_-]{20,}|(api[_-]?key|secret|token|passw(or)?d)["'"'"']? *[:=] *["'"'"'][A-Za-z0-9+/_=-]{16,}["'"'"']'
# A real home folder (placeholders: sam, name, Name, x, you, user).
me=$(id -un)
HOMES="(/Users|/home)/($me|[a-z][a-z0-9._-]+)/"
HOMES_OK='(/Users|/home)/(sam|name|x|you|user|me|runner)/'
# Email addresses, except made-up and no-reply ones.
MAILS='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
MAILS_OK='@example\.(com|org)|noreply|@[0-9]+x\.|git@github\.com'
# Third-party files, unchanged from upstream.
SKIP=':!mods/ks-files/icons :!mods/ks-files/fonts :!LICENSE :!*.svg'

scan() { # $1 = rev or --cached or "", rest = pathspecs
  rev=$1; shift
  g() { if [ "$rev" = --cached ]; then git grep --cached -I -n "$@"; elif [ -n "$rev" ]; then git grep -I -n "$@" "$rev"; else git grep -I -n "$@"; fi; }
  out=$(g -E -e "$SECRETS" -- "$@" $SKIP ':!scripts/check-leaks.sh') && fail "Looks like a credential${rev:+ ($rev)}:" "$out"
  out=$(g -E -e "$HOMES" -- "$@" $SKIP ':!scripts/check-leaks.sh' | grep -v -E "$HOMES_OK") && [ -n "$out" ] && fail "A real home folder; write ~ or \$HOME${rev:+ ($rev)}:" "$out"
  out=$(g -E -e "$MAILS" -- "$@" $SKIP ':!scripts/check-leaks.sh' | grep -v -E "$MAILS_OK") && [ -n "$out" ] && fail "An email address${rev:+ ($rev)}:" "$out"
  if [ -s .private-terms ]; then
    terms=$(grep -v -E '^[[:space:]]*(#|$)' .private-terms)
    [ -n "$terms" ] && out=$(printf '%s\n' "$terms" | g -i -F -f - -- "$@") && fail "A private word from .private-terms${rev:+ ($rev)}:" "$out"
  fi
  return 0
}

case $mode in
  staged)
    files=$(git diff --cached --name-only --diff-filter=ACMR)
    [ -z "$files" ] && exit 0
    out=$(printf '%s\n' "$files" | grep -E "$NAMES") && fail "Files that never belong in this repo:" "$out"
    imgs=$(git diff --cached --name-only --diff-filter=AM | grep -i -E '\.(png|jpe?g|gif|webp|heic|bmp|tiff?|pdf|mov|mp4)$')
    [ -n "$imgs" ] && [ "${KS_IMAGES_OK:-}" != 1 ] && fail "Pictures show what text checks cannot read. Open each one, read every word in it, then commit with KS_IMAGES_OK=1:" "$imgs"
    old_ifs=$IFS; IFS='
'
    # shellcheck disable=SC2086
    scan --cached $files
    IFS=$old_ifs ;;
  --all)
    out=$(git ls-files | grep -E "$NAMES") && fail "Files that never belong in this repo:" "$out"
    scan "" . ;;
  --history)
    out=$(git log --all --name-only --format= | sort -u | grep -E "$NAMES") && fail "Files in history that never belong in this repo:" "$out"
    for c in $(git rev-list --all); do scan "$c" .; done ;;
  *) echo "usage: $0 [--all | --history]" >&2; exit 2 ;;
esac

[ "$bad" -eq 0 ] && { [ "$mode" = staged ] || echo "check-leaks: nothing found"; exit 0; }
printf '\nSee AGENTS.md. Do not bypass this with --no-verify.\n' >&2
exit 1
