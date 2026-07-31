# Slack Triage — C0BJLPS50LE — 2026-07-30

**Result:** 1 genuine support query found (the first in 12 scans). Not yet handled by the daemon —
it arrived while the daemon's Socket Mode connection was dead.

## Query

**ts `1785401203`** (08:46:43 UTC) · from `U0BJQM1TC2D` · mentions `<@U0BLAGG25QA>` (smartcase_bot)

> תיאור התקלה: כאשר נכנסים לתוך תיק ספציפי במערכת, ניסיון להוסיף משימה חדשה לאותו תיק נכשל/אינו מתאפשר.
> התנהגות צפויה: משתמש שנמצא בתוך תצוגת תיק צריך להיות מסוגל ליצור משימה חדשה המשוייכת אוטומטית ל-ID של התיק הנוכחי.

**Classification:** bug report, backoffice (not public portal). Well-formed — states observed
behaviour, expected behaviour, and analysis constraints (check the component and API endpoint, check
whether `caseId` is threaded through the form/payload/route params, require input validation and
error handling, do not regress general task creation, run the tests).

**Escalation tag:** none needed — this is exactly the shape the autofix pipeline is built for, and the
reporter is the sole allowlisted operator. Route it through the daemon rather than answering by hand.

**Related earlier post:** ts `1785400615` (08:36:55) — the same text pasted as a blockquote, before
the bot was added to the channel at `1785400634`. Superseded by `1785401203`; no action.

## Why the daemon did not pick it up

| Time (UTC) | Event |
|---|---|
| 08:18:00 | Daemon started, Socket Mode connected |
| — | 14 × `A pong wasn't received from the server before the timeout of 5000ms` → WebSocket dead |
| 08:36:55 | First (blockquote) post — bot not yet in channel |
| 08:37:14 | Bot added to the channel |
| 08:46:43 | **Real mention posted — daemon socket already dead, event never delivered** |
| 09:07:55 | Daemon restarted; `reactions:read` now granted (approval: reaction or reply) |

`logs/slack-events.jsonl` contains only `daemon-start` lines — no `trigger`, no `trigger-ignored`.
Confirms non-delivery rather than rejection. **Socket Mode does not replay events missed while
disconnected**, so the mention is unrecoverable from the daemon's side; it must be re-posted.

## Diagnosis posted in-thread (reply ts `1785403738`)

Investigated against the codebase rather than answering from the report alone. The reporter's
hypothesis — "`caseId` isn't passed properly in the Form / Payload / Route params" — is close but not
the defect.

**Root cause:** `src/components/cases/tasks-panel.tsx:129` — the "הוסף משימה חדשה" button is a bare
`<button>` with no `onClick`, no `<form>`, no `action`. Decorative markup. Nothing fires, so there is
no error and no payload to inspect; the click is a no-op.

**Prerequisite, not cause:** `TasksPanelProps` (lines 90–92) accepts only `tasks`. `caseId` never
reaches the component — it stops at `case-detail-view.tsx:142` (`<TasksPanel tasks={caseData.tasks} />`).
So threading `caseId` is step one of the fix, not the bug itself.

**Server side is already complete** — no new endpoint needed. `createTask()` at `src/lib/actions.ts:70`
takes `{ caseId, title, description?, priority, dueDate?, assignedToId? }`, validates with
`createTaskSchema` (Zod), derives `createdById` from the session rather than the input (correct
trust boundary), and revalidates both `/tasks` and `/cases/{id}`. `Task.caseId` is a required FK with
`onDelete: Cascade` and an index (`prisma/schema.prisma:418`).

**Second defect found, not reported:** `handleToggle` (line 98) mutates local `useState` only and never
calls `toggleTaskStatus` from `actions.ts:43`. Completing a task appears to work and silently reverts
on reload. Same file, same root cause (a view component never wired to the server) — should ship in the
same PR.

**Recommended scope:** thread `caseId` through props → add form calling `createTask` → wire
`handleToggle` to `toggleTaskStatus` with optimistic update and rollback → `npm test` + `npm run build`.

## Action items

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Re-post the mention in `C0BJLPS50LE` so the restarted daemon receives it | Moti | **Open** |
| 2 | Daemon has no liveness supervision — a dead WebSocket fails silently and looks healthy | — | **Open**, see below |
| 3 | `reactions:read` now granted; reaction-based approval live | Moti | **Done** |
| 4 | `SLACK_CI_WEBHOOK_URL` still unset — summaries continue landing in the support channel | Moti | Open |
| 5 | `npm run build` fails on pre-existing `next/font/google` error, so the pipeline's verify gate will block a PR on any run | — | Open |

### Item 2 — the real defect this test exposed

The daemon logged 14 pong timeouts and kept running with a dead socket. Nothing surfaced that as a
failure: the process stayed alive, the startup banner still scrolled above, and both the operator and
I read it as "connected and listening" for roughly 30 minutes while it was deaf. G1 needs:

- a `disconnected`/`reconnect` handler that logs to JSONL, so loss of connection is auditable;
- a visible warning (channel post or non-zero exit) rather than silent WARN lines;
- consideration of exiting on repeated pong failure so a process supervisor restarts it.

This is a genuine gap in the spec's I/O matrix — it has no row for "transport dies mid-session".
