#!/usr/bin/env bash
# Session summary hook — Stop / StopFailure. Never fails the CLI: all output paths swallow errors.
set -uo pipefail

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "Stop"')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT="$(pwd)"

# Guard: on plain Stop (includes /clear, resume, compact), skip no-op stops —
# only write when the working tree is dirty or the session actually touched files/ran commands.
if [ "$EVENT" != "StopFailure" ]; then
  HAS_GIT_CHANGES=$(git status --porcelain 2>/dev/null | head -c1)
  HAS_ACTIVITY="false"
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    COUNT=$(jq -rs '[.[] | select(.message.content? != null) | .message.content[]? | select(.type=="tool_use" and (.name=="Write" or .name=="Edit" or .name=="Bash"))] | length' "$TRANSCRIPT" 2>/dev/null)
    if [ -n "${COUNT:-}" ] && [ "$COUNT" -gt 0 ] 2>/dev/null; then
      HAS_ACTIVITY="true"
    fi
  fi
  if [ -z "$HAS_GIT_CHANGES" ] && [ "$HAS_ACTIVITY" = "false" ]; then
    exit 0
  fi
fi

OUT_DIR="$REPO_ROOT/_bmad-output/session-summaries"
mkdir -p "$OUT_DIR" 2>/dev/null

TS=$(date +%Y%m%d-%H%M%S)
OUT_FILE="$OUT_DIR/summary-$TS.md"
LAST_FILE="$REPO_ROOT/LAST_SESSION_SUMMARY.md"

{
  echo "# Session Summary — $TS"
  echo
  echo "**Event:** $EVENT  "
  echo "**Session:** $SESSION_ID  "
  echo "**Branch:** $(git branch --show-current 2>/dev/null || echo unknown)"
  echo

  if [ "$EVENT" = "StopFailure" ] && [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    echo "## Last executed command"
    echo '```'
    jq -rs '[.[] | select(.message.content? != null) | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command] | last // "n/a"' "$TRANSCRIPT" 2>/dev/null
    echo '```'
    echo
    echo "## Last tool error"
    echo '```'
    jq -rs '[.[] | select(.tool_use_result? != null and (.tool_use_result | tostring | contains("error")))] | last | tostring // "n/a"' "$TRANSCRIPT" 2>/dev/null
    echo '```'
    echo
  fi

  echo "## Files modified (working tree)"
  git status --porcelain 2>/dev/null | sed 's/^/- /'
  echo
  echo "## Diff stat"
  echo '```'
  git diff HEAD --stat 2>/dev/null
  echo '```'
  echo
  echo "## Commits this branch (last 10)"
  git log -10 --oneline 2>/dev/null
  echo

  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    echo "## Tool usage this session"
    jq -rs '[.[] | select(.message.content? != null) | .message.content[]? | select(.type=="tool_use") | .name] | group_by(.) | map("\(length)x \(.[0])") | .[]' "$TRANSCRIPT" 2>/dev/null
  fi
} > "$OUT_FILE" 2>/dev/null

cp "$OUT_FILE" "$LAST_FILE" 2>/dev/null

# --- Slack notification (best-effort, never fails the hook) ---
notify_slack() {
  # Pull Slack config from the environment, falling back to .env (not auto-loaded by hooks).
  local webhook="${SLACK_WEBHOOK_URL:-}"
  local token="${SLACK_BOT_TOKEN:-}"
  local channel="${SLACK_NOTIFY_CHANNEL:-}"
  local envfile="$REPO_ROOT/.env"

  if [ -z "$webhook" ] && [ -f "$envfile" ]; then
    webhook=$(grep -m1 '^SLACK_WEBHOOK_URL=' "$envfile" | cut -d= -f2- | tr -d '"' )
  fi
  if [ -z "$token" ] && [ -f "$envfile" ]; then
    token=$(grep -m1 '^SLACK_BOT_TOKEN=' "$envfile" | cut -d= -f2- | tr -d '"')
  fi
  if [ -z "$channel" ] && [ -f "$envfile" ]; then
    channel=$(grep -m1 '^SLACK_NOTIFY_CHANNEL=' "$envfile" | cut -d= -f2- | tr -d '"')
  fi

  command -v curl >/dev/null 2>&1 || return 0

  local branch commits status_lines
  branch=$(git branch --show-current 2>/dev/null || echo unknown)
  commits=$(git log -3 --oneline 2>/dev/null)
  status_lines=$(git status --porcelain 2>/dev/null | head -20)

  local header
  if [ "$EVENT" = "StopFailure" ]; then
    header=":x: *SmartCase session ended with a failure* (branch \`$branch\`)"
  else
    header=":white_check_mark: *SmartCase session summary* (branch \`$branch\`)"
  fi

  local text
  text=$(printf '%s\n\n*Modified files:*\n```\n%s\n```\n\n*Recent commits:*\n```\n%s\n```' \
    "$header" "${status_lines:-none}" "${commits:-none}")

  if [ -n "$webhook" ]; then
    curl -sS -m 8 -X POST -H 'Content-type: application/json' \
      --data "$(jq -n --arg text "$text" '{text: $text}')" \
      "$webhook" >/dev/null 2>&1 || true
  elif [ -n "$token" ] && [ -n "$channel" ]; then
    curl -sS -m 8 -X POST -H "Authorization: Bearer $token" -H 'Content-type: application/json' \
      --data "$(jq -n --arg ch "$channel" --arg text "$text" '{channel: $ch, text: $text}')" \
      "https://slack.com/api/chat.postMessage" >/dev/null 2>&1 || true
  fi
  return 0
}

notify_slack

echo "{\"systemMessage\": \"Session summary saved: _bmad-output/session-summaries/summary-$TS.md\"}"
exit 0
