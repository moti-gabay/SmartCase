---
title: 'G1 — Slack Socket Mode Ingress for the Autofix Orchestrator'
type: 'feature'
created: '2026-07-29'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: '308c29e'
context:
  - '{project-root}/CLAUDE.md'
  - '{project-root}/scripts/autofix/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The autofix orchestrator only runs from a CLI. `scripts/slack-daemon.js` listens to Slack but fires a bare `claude -p` on *any* message from *anyone* in the channel — no allowlist, no plan, no review, no approval gate, no thread awareness.

**Approach:** Replace the daemon's freeform execution with a thread-aware adapter that binds Slack to `runPipeline(issue, hooks, options)`. Trigger only on mentions from allowlisted users; report every phase into the originating thread; satisfy `hooks.requestApproval` with a reaction or reply from an allowlisted user. The adapter owns transport and identity — all pipeline security controls stay where they are.

## Boundaries & Constraints

**Always:**
- Only allowlisted Slack user IDs (`SLACK_ALLOWED_USERS`) can trigger a run or approve one. An empty or unset allowlist disables triggering entirely — never fail open.
- The approving user must be allowlisted; the triggering user may approve their own run (single-operator office), but a non-allowlisted reaction is ignored silently.
- Every reply goes to the originating `thread_ts`, never the channel root.
- Verify required scopes at startup (`chat:write`, `channels:history`, `reactions:read`, `users:read`) and exit with the missing scope named. Do not start half-functional.
- One run at a time per process. A trigger arriving mid-run is refused in-thread, not queued.
- Approval waits have a hard timeout; on expiry the run is denied, never auto-approved.
- Bot messages, `bot_id`-bearing events, and the daemon's own posts never trigger a run.

**Ask First:**
- Widening the trigger surface beyond mentions (e.g. every channel message).
- Any change that lets a run start without an allowlisted human in the loop.

**Never:**
- Never pass Slack text to a shell. It reaches `runPipeline` as a JS string argument only.
- Never post plan bodies, review text, secrets, or raw `claude` output into Slack — status lines and the final summary only.
- Never modify `scripts/autofix/**` pipeline logic; this is an adapter.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path | Allowlisted user mentions the bot with issue text | Ack in thread; phase updates; approval prompt; on approval, run to PR; final summary with RCA + tests + PR link | N/A |
| Not allowlisted | Non-allowlisted user mentions the bot | Ignored; one audit line to JSONL; no reply that confirms the bot is listening | Silent |
| Empty issue | Mention with no text after the bot handle | Reply asking for a description | No run |
| Approval by reaction | Allowlisted user adds ✅ on the prompt message | Run proceeds | N/A |
| Denial | Allowlisted user adds ❌, or replies `deny` | Run stops; artifacts kept | Exit 3 reported in-thread |
| Approval timeout | No response within the window | Run denied and reported | Exit 3 |
| Non-allowlisted reaction | Outsider adds ✅ | Ignored; run keeps waiting | Silent |
| Concurrent trigger | Second mention while a run is active | Refused in-thread naming the active run | No second run |
| Pipeline failure | Any non-zero exit from `runPipeline` | Failure reported in-thread with exit code and reason | Logged |
| Missing scope | Token lacks `reactions:read` | Daemon exits at startup naming the scope | Exit 1 |

</frozen-after-approval>

## Code Map

- `scripts/slack-daemon.js` -- the daemon being replaced; keep its `logEvent` JSONL convention and env-var validation shape.
- `scripts/autofix/pipeline.mjs` -- `runPipeline(issue, hooks, options)`, `AutofixError`, `EXIT`; the contract this adapter binds to. Do not modify.
- `scripts/autofix/guards.mjs` -- `resolveClaudeBin()` already shared with the daemon.
- `tests/autofix-guards.test.ts` -- pattern for pure-logic tests under `node:test`.

## Tasks & Acceptance

**Execution:**
- [ ] `scripts/slack/guards.mjs` -- pure exports: `parseAllowlist(raw)`, `isAllowed(userId, allowlist)`, `extractIssueText(text, botUserId)`, `classifyReply(text)` → `'approve'|'deny'|null`, `classifyReaction(name)` → `'approve'|'deny'|null`, `REQUIRED_SCOPES` -- isolates identity and intent parsing from Slack I/O.
- [ ] `scripts/slack/daemon.mjs` -- Bolt Socket Mode app: startup scope preflight, `app_mention` handler, single-flight guard, `hooks` wiring (`onPhase`/`requestApproval`/`report`) posting to `thread_ts`, JSONL audit of every trigger, approval, denial, and refusal.
- [ ] `scripts/slack/approvals.mjs` -- pending-approval registry keyed by `thread_ts`, resolved by `reaction_added` or a threaded reply from an allowlisted user, with timeout -- keeps async gate state out of the handler.
- [ ] `scripts/slack-daemon.js` -- becomes a thin re-export of `scripts/slack/daemon.mjs` so `npm run slack-daemon` keeps working.
- [ ] `tests/slack-ingress.test.ts` -- cover every matrix row reachable from pure logic: allowlist parsing incl. empty/whitespace/fail-closed, mention stripping incl. Hebrew and multi-mention, reply/reaction classification, and rejection of bot-authored events.
- [ ] `scripts/autofix/README.md` -- add a Slack section: required scopes, `SLACK_ALLOWED_USERS`, the approval UX, and the concurrency rule.

**Acceptance Criteria:**
- Given an unset or empty `SLACK_ALLOWED_USERS`, when the daemon starts, then it refuses to start rather than accepting triggers from anyone.
- Given a run awaiting approval, when a non-allowlisted user reacts ✅, then the run stays pending and no approval is recorded.
- Given a run in progress, when a second trigger arrives, then no second pipeline starts and the second thread receives a refusal.
- Given any trigger, approval, denial, or refusal, then `logs/slack-events.jsonl` gains a line naming the user, thread, and outcome.

## Design Notes

The adapter is the only new trust boundary; the pipeline's controls are unchanged. Slack identity answers *who may ask* and *who may approve* — nothing else. Text still reaches `runPipeline` as a plain string and is fenced as untrusted data inside the plan prompt.

Single-flight is per process, which is sufficient for one daemon and closes the concurrency risk `deferred-work.md` flagged specifically for Slack-triggered runs. It is not a substitute for the repo-level lockfile still deferred there.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including `tests/slack-ingress.test.ts`.
- `npm run build` -- expected: clean.
- `node --check scripts/slack-daemon.js` and `node -e "import('./scripts/slack/daemon.mjs')"` -- expected: parse and load without a token.
- `npm run slack-daemon` with a scope-deficient token -- expected: exits naming the missing scope.
