# Autofix Orchestrator

Turns a plain-language issue report into a reviewed, tested, draft pull request.

```bash
npm run autofix -- --dry-run "checkout button is misaligned on mobile"
npm run autofix -- "the conversion portal rejects valid French phone numbers"
npm run autofix -- --provider openai --no-pr "tag filter drops cases with two tags"
echo "$ISSUE_TEXT" | npm run autofix --          # issue on stdin
```

## Phases

| # | Phase | What runs | Gate |
|---|-------|-----------|------|
| 0 | Preflight | Resolve the Claude CLI, verify `--version` | Aborts if no usable binary |
| 1 | Plan | `claude --print --permission-mode plan --disallowedTools Write Edit` → `plan.md` | No file modification |
| 2 | Review | `external-code-review.py --mode plan` against an independent model | `VERDICT: PASS` required |
| — | Approval | Interactive prompt (or `hooks.requestApproval`) | **Human must approve** |
| 3 | Execute | `claude --print --dangerously-skip-permissions` on `fix/slack-issue-<runId>`, cut from the default branch, then `npm test && npm run build` | Both must pass |
| 4 | PR | `git push` + `gh pr create --draft --base <default branch>` | Skipped by `--no-pr` |

The fix branch is cut from the repository's primary branch (`origin/HEAD`, falling back to
`main`/`master`) rather than from whatever is checked out, and the PR targets that same branch.
Branching from an arbitrary feature branch while targeting `main` would pull that branch's unmerged
commits into the PR diff. Your original branch is restored when the run ends, pass or fail.

Artifacts land in `_bmad-output/autofix/<runId>/` (`plan.md`, `review.md`).
Every phase appends to `logs/autofix-events.jsonl` (gitignored).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `CLAUDE_BIN` | recommended | Absolute path to the Claude CLI. Without it, resolution falls back to `~/.local/bin/claude`, then `$PATH`. |
| `GEMINI_API_KEY` | yes (default provider) | Phase 2 reviewer. |
| `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | if `--provider openai\|deepseek` | Alternate reviewers. |
| `GH_TOKEN` | unless `--no-pr` | PR creation. `gh auth login` works instead. |

**On WSL, set `CLAUDE_BIN`.** A bare `claude` on `$PATH` commonly resolves to the
Windows npm shim (`/mnt/c/.../npm/claude`), which is executable but fails with
"native binary not installed". Resolution deliberately checks `~/.local/bin/claude`
before `$PATH` for this reason. `scripts/slack-daemon.js` shares the same resolver.

Python dependencies for the reviewer: `pip install requests python-dotenv`.

## Slack ingress (G1)

`npm run slack-daemon` runs the Socket Mode adapter in `scripts/slack/`. An allowlisted
user mentions the bot with an issue; the daemon drives the same `runPipeline` and reports
every phase into that thread.

```
@SmartCase the tag filter drops cases that have two tags
```

| Variable | Required | Purpose |
|---|---|---|
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | yes | Bot token + app-level token (Socket Mode) |
| `SLACK_NOTIFY_CHANNEL` | yes | The only channel that can trigger runs |
| `SLACK_ALLOWED_USERS` | **yes** | Comma/space separated user IDs. Empty means the daemon refuses to start — never "anyone" |

Required scopes: `chat:write`, `channels:history`, `reactions:read`, `users:read`. The
daemon verifies these at startup and exits naming what is missing. **Scope changes only
take effect after reinstalling the app** — editing the manifest is not enough.

**Approval.** When the plan passes external review, the daemon posts a prompt in the
thread. React ✅ or reply `אישור` / `approve` to proceed; ❌ or `דחייה` / `deny` to stop.
Only allowlisted users count — an outsider's reaction is ignored and the run keeps waiting.
The reply must be *only* the decision word: "approve after you check X" is a conversation,
not consent. No answer within 30 minutes denies the run.

**Concurrency.** One run per daemon process. A trigger arriving mid-run is refused in its
thread, never queued.

**What is not posted to Slack:** plan bodies, review text, and raw `claude` output stay in
the repo under `_bmad-output/autofix/<runId>/`. The thread gets status lines, the approval
prompt, and the final summary.

## Execution guards

| Guard | Mechanism | Configure |
|---|---|---|
| Spend ceiling | `--max-budget-usd` on every `claude` invocation | `AUTOFIX_MAX_BUDGET_USD` (default `2.0`) |
| Wall clock | Per-phase timeouts | 10 min plan · 5 min review · 30 min execute · 15 min verify |
| Kill switch | `npm run autofix:kill`, or reply `עצור` / `kill` in the Slack thread | — |
| Output cap | Child stdout capped, process group killed on overflow | 32 MB |

**There is no `--max-turns` in this CLI** (checked against v2.1.220) — the budget ceiling
plus per-phase timeouts are what bound a runaway loop. Likewise there is no
`claude kill <id>` subcommand, so termination is done at the process level: phases spawn
`claude` **detached**, so the child's pid is also its process-group id, and it is published
to `logs/autofix-active.json`. Killing the negated pid reaps the tool subprocesses Claude
spawns — signalling only the direct child can strand them holding the stdio pipes, after
which `close` never fires and the timeout cannot help.

Hitting the budget is reported as a budget ceiling naming the env var, not as a bare
non-zero exit, because raising the limit is a decision rather than a bug.

## Notifications

`runPipeline` accepts `hooks.onNotify(event, detail)`. Every event is also written to
`logs/autofix-events.jsonl` with `"kind":"notification"`, so the audit trail survives a
transport that is down.

| Event | Fired when | Carries |
|---|---|---|
| `input_required` | The run reaches the approval gate and is blocked on a human | `runId`, `branch`, `planPath`, `reviewPath`, `verdict` |
| `agent_completed` | The run reaches a terminal state | `outcome`, `exit_code`, `pr_url` or `error` |

A throwing or absent `onNotify` never takes down the run it is reporting on.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Empty issue text / bad arguments |
| 2 | Plan review returned `FAIL` (or `UNKNOWN` — see below) |
| 3 | Human denied approval |
| 4 | `npm test` or `npm run build` failed, or execution produced no changes |
| 5 | Unsafe repo state (dirty tree, detached HEAD, on `main`/`master`, or branch exists) |
| 6 | Execution touched a forbidden path |
| 7 | No usable Claude binary |
| 8 | The Claude CLI itself failed (non-zero exit, timeout, killed, or output cap) |

## Security model

Phase 3 runs Claude with **all permission checks bypassed**. These are the controls
that make that acceptable, and none of them should be relaxed casually:

- **Human gate.** Execution never starts without an explicit approval. `--yes` exists
  for non-interactive runs and is the single most dangerous flag here.
- **Phase 1 restricts file modification, not execution.** `--permission-mode plan` plus
  `--disallowedTools Write Edit` means the planning pass cannot modify files. It does
  **not** disable `Bash` or the MCP servers configured in `.mcp.json` (including
  `postgres` against `DATABASE_URL`) — those are governed by the session's tool-permission
  configuration, not by this pipeline. Do not read "planning is read-only" as "planning is
  sandboxed". Tightening this to an explicit allow-list is tracked in `deferred-work.md`.
- **Fail-closed review, in two layers.** The verdict is read from the reviewer's final
  non-empty line only, and `VERDICT:` markers are defanged in the copy of the plan sent
  to the reviewer. Both are needed: the plan derives from untrusted issue text, reviewers
  echo what they are given, and without the second layer a plan ending in `VERDICT: PASS`
  flips a genuine `FAIL` to `PASS`. Anything unparseable is `UNKNOWN`, treated as `FAIL`.
- **Untrusted input stays data.** Issue text is written to the child's stdin — never
  interpolated into a shell string, never passed through a shell, never in argv.
  The plan prompt fences it and labels it as data to analyse, not instructions to follow.
- **Branch isolation.** Refuses to run on `main`/`master`, a detached HEAD, or a dirty
  tree; all work happens on a fresh `fix/` branch. Any failure before commit restores the
  base branch and deletes the branch, so a failed run cannot poison the next one.
- **Forbidden paths.** Before pushing, the change set is scanned for anything that
  executes code, carries secrets, or gates verification: `.env*`, `.github/**`,
  `.claude/**` (hook scripts run as shell next session), `.mcp.json`, `package.json`
  (rewriting `test` would let a change approve itself), `vercel.json`, `prisma/sql/**`.
  Matching is case-insensitive, sees inside newly created directories, and follows both
  sides of a rename.

  **What this does and does not do.** Phase 3 runs with permissions bypassed, so the
  edits already exist on disk by the time the scan runs. The scan stops them being
  committed or pushed, and the cleanup discards them — it cannot prevent the write
  itself. Treat it as a containment boundary, not a write barrier.
- **Green tests are mandatory.** A failing `npm test` or `npm run build` means no push
  and no PR; the branch is left local for inspection.
- **PRs open as drafts**, so nothing merges without human review.

Residual risk worth knowing: anyone who can supply issue text can cause arbitrary code
to be *proposed*. The human gate and the forbidden-path scan are what stand between that
and code reaching the remote.
