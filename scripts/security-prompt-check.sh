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

for pattern in "${PATTERNS[@]}"; do
  if printf '%s' "$PROMPT" | grep -qE "$pattern"; then
    echo "SECURITY BLOCK: your prompt appears to contain a secret (matched: $pattern). Remove the key/credential and resubmit." >&2
    exit 2
  fi
done

exit 0
