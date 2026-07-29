# Slack Triage — C0BJLPS50LE

**Scanned:** 2026-07-29 | **Window:** last 40 messages (ts `1785231705` → `1785324546`, ~25h)
**Result:** 0 unanswered support queries.

**Re-scan (same day, later):** no change. Newest message still `1785324546`; no new human queries.
Thread `1785239425` moved 1 → 3 replies, all authored by this triage pass. Action items below unchanged.

## Channel composition

| Type | Count |
|---|---|
| Bot `session-summary` posts (B0BJLB7K7HV) | 34 |
| Human queries (U0BJQM1TC2D) | 2 |
| Join events | 1 |
| Bot thread answers (SmartCase Bot, U0BLAGG25QA) | 2 |

Signal-to-noise is ~5%. Every human query in the window already has a substantive threaded answer.

## Query triage

### Q1 — `1785239425` · "תן לי סיכום על הpr האחרון"
- **Status:** ANSWERED (`1785239942`) — PR #22 summary, merged, 6 commits / 7 files / +150−58.
- **Escalation tag:** none.
- **Open caveats raised in that answer:** 2 (both now closed — see Action items).

### Q2 — `1785238587` · "תן לי עדכון על הפיצרים החדשים שנוספו למערכת"
- **Status:** ANSWERED (`1785239013`) — tagging engine (Phase 4), user management (Phase 5), security/infra, quality.
- **Escalation tag:** none.
- **Stale detail:** answer stated "54/54 טסטים עוברים". Actual count today is **79/79**. Cosmetic drift, not a defect.

## Action items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Verify full test suite + production build on merged PR #22 (prior answer ran only `tsc --noEmit` + scoped eslint) | **CLOSED — pass** | `npm test` → 79/79 pass, 0 fail, 2.8s. `npm run build` → clean, all routes emitted. |
| 2 | Verify the session-summary dedupe fix (`790d26e`) actually suppresses the flood | **CLOSED — holding** | Pre-fix window: ~30 byte-identical summaries in ~1h. Post-fix window (`1785240052` onward): 3 posts in ~24h, each with distinct branch/content. Flood stopped. Caveat: the 3 post-fix posts differ in content, so an *identical*-content repeat has not been directly exercised — the fingerprint path is inferred, not proven. |
| 3 | Slack bot token is missing scopes documented in CLAUDE.md | **OPEN — needs human** | `slack_get_user_profile` returned `missing_scope`: needed `users.profile:read`, **provided only `channels:history,chat:write`**. CLAUDE.md claims `channels:read`, `reactions:write`, `users:read`, `users.profile:read` are granted. They are not. |
| 4 | `scripts/slack-daemon.js` invokes bare `execFile("claude", …)` | **OPEN — latent break, never exercised** | `claude` on `$PATH` resolves to `/mnt/c/Users/yeder/AppData/Roaming/npm/claude`, which errors: "native binary not installed". Working binary is `/home/moti/.local/bin/claude` (v2.1.220). `logs/slack-events.jsonl` **does not exist** — the daemon has never processed a message, so there are no failed runs to count. The break is real but latent: the first message it ever handles will fail. Note the two threaded answers came from a *different* bot (`SmartCase Bot` / `A0BLAGG73PC`), not from this daemon (`B0BJLB7K7HV`). |
| 5 | Channel is 95% bot noise | **OPEN — proposal** | Dedupe stopped identical repeats but not volume. Suggest routing `session-summary.sh` output to a separate `#smartcase-ci` channel so `SLACK_NOTIFY_CHANNEL` stays a human support surface. Needs your call. |

## Consequences for in-flight work

Items 3 and 4 both land on the deferred **Slack ingress** goal (`deferred-work.md`) and on the active
`spec-slack-autofix-orchestrator.md` draft:

- Item 4 is already handled in the spec — `resolveClaudeBin()` with `CLAUDE_BIN` → `~/.local/bin/claude` → `$PATH`, plus a preflight `--version` check.
- Item 3 is **not** yet handled and blocks the deferred ingress work: the planned reaction-based approval gate needs `reactions:read`/`reactions:write`, and the trigger allowlist needs `users:read`. Neither scope is currently granted.
