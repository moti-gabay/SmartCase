#!/usr/bin/env bash
# UserPromptSubmit security gate — blocks prompts containing leaked secrets.
# Input priority: $CLAUDE_USER_PROMPT > argv > stdin JSON ({"prompt": "..."}).
# Exit 2 = block prompt (Claude Code blocking code; stderr shown to user). Exit 0 = clean.
set -euo pipefail

if [ -n "${CLAUDE_USER_PROMPT:-}" ]; then
  PROMPT="$CLAUDE_USER_PROMPT"
elif [ $# -gt 0 ]; then
  PROMPT="$*"
else
  INPUT="$(cat)"
  PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)"
  [ -n "$PROMPT" ] || PROMPT="$INPUT"
fi

PATTERNS=(
  'AKIA[0-9A-Z]{16}'                      # AWS access key
  'ASIA[0-9A-Z]{16}'                      # AWS temporary key
  'postgres(ql)?://[^[:space:]]+:[^[:space:]]+@'  # Postgres conn string with credentials
  'mongodb\+srv://[^[:space:]]+'          # MongoDB Atlas conn string
  'mysql://[^[:space:]]+:[^[:space:]]+@'  # MySQL conn string with credentials
  'sk-[a-zA-Z0-9_-]{20,}'                 # Anthropic / OpenAI API key
  'xoxb-[0-9A-Za-z-]+'                    # Slack bot token
  'xapp-[0-9A-Za-z-]+'                    # Slack app token
  'BEGIN[[:space:]]+([A-Z]+[[:space:]]+)?PRIVATE[[:space:]]+KEY'  # SSH/RSA/EC private key
)
# Rule name per pattern (same order as PATTERNS) — logged to the audit trail.
RULES=(
  'AWS_KEY'
  'AWS_KEY'
  'DB_CONNECTION'
  'DB_CONNECTION'
  'DB_CONNECTION'
  'API_KEY'
  'SLACK_TOKEN'
  'SLACK_TOKEN'
  'PRIVATE_KEY'
)

log_block() {
  # Append audit event; never let logging failure prevent the block (exit 2).
  local rule="$1" repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  mkdir -p "$repo_root/logs" || return 0
  jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg rule "$rule" \
    --arg user "${USER:-$(id -un)}" \
    --arg branch "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    '{timestamp: $ts, event: "SECRET_LEAK_BLOCKED", rule: $rule, user: $user, branch: $branch}' \
    >> "$repo_root/logs/security-audit.jsonl" || true
}

for i in "${!PATTERNS[@]}"; do
  if printf '%s' "$PROMPT" | grep -qE "${PATTERNS[$i]}"; then
    log_block "${RULES[$i]}"
    echo "SECURITY BLOCK: your prompt appears to contain a secret (matched: ${PATTERNS[$i]}). Remove the key/credential and resubmit." >&2
    exit 2
  fi
done

exit 0
