#!/usr/bin/env bash
# PreToolUse security gate — blocks Bash commands that target .env files.
# Input: stdin JSON ({"tool_name": "Bash", "tool_input": {"command": "..."}}).
# Matches any `.env` / `.env.*` / `*.env` reference regardless of the reading
# vehicle (cat, sed, node -e, pipes, redirects) by scanning the raw command text.
# Exit 2 = block tool call (stderr shown to user). Exit 0 = clean / not Bash.
set -euo pipefail

INPUT="$(cat)"
TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ "$TOOL" = "Bash" ] || exit 0
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$COMMAND" ] || exit 0

log_block() {
  # Append audit event; never let logging failure prevent the block (exit 2).
  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  mkdir -p "$repo_root/logs" || return 0
  jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg cmd "$COMMAND" \
    --arg user "${USER:-$(id -un)}" \
    --arg branch "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    '{timestamp: $ts, event: "ENV_FILE_ACCESS_BLOCKED", rule: "BASH_ENV_FILE", command: $cmd, user: $user, branch: $branch}' \
    >> "$repo_root/logs/security-audit.jsonl" || true
}

# `.env` as a path token: matches .env, .env.local, ./config/.env, prod.env —
# but not NODE_ENV, environment, .envrc (trailing \b requires a non-word char after "env").
if printf '%s' "$COMMAND" | grep -qiE '\.env\b'; then
  log_block
  echo "SECURITY BLOCK: this Bash command references a .env file. Environment files contain secrets and are off-limits to all tools by policy (see permissions.deny in .claude/settings.json)." >&2
  exit 2
fi

exit 0
