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

missing=()
for tool in node git python3 gh; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "error: required tool(s) not on PATH: ${missing[*]}" >&2
  echo "  node/git/python3 are required; gh is required unless you pass --no-pr" >&2
  exit 1
fi

exec node scripts/autofix/cli.mjs "$@"
