#!/usr/bin/env bash
# Single documented entrypoint for the autofix orchestrator.
#
#   npm run autofix -- --dry-run "checkout button is misaligned on mobile"
#
# Every argument is forwarded verbatim to cli.mjs via "$@" — never re-split,
# never passed through a shell — so untrusted issue text stays inert here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# gh is only needed when a PR will actually be created.
required="node git python3"
case " $* " in
  *" --no-pr "*|*" --dry-run "*|*" --help "*|*" -h "*) ;;
  *) required="$required gh" ;;
esac

# Plain string accumulator, not an array: under `set -u`, expanding an empty
# array is an unbound-variable error on bash 3.2 (stock macOS) and 4.2.
missing=""
for tool in $required; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done

if [ -n "$missing" ]; then
  echo "error: required tool(s) not on PATH:$missing" >&2
  echo "  gh is only required when creating a PR — pass --no-pr to skip it" >&2
  exit 1
fi

exec node scripts/autofix/cli.mjs "$@"
