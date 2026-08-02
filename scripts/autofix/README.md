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
| — | Preflight | Resolve the Claude CLI, verify `--version` | Aborts if no usable binary |
| 0 | Triage | `claude --print --permission-mode plan --disallowedTools Write Edit` on the triage tier | `TRIAGE: NOT_ACTIONABLE` stops the run (exit 10); skip with `--skip-triage` |
| 1 | Plan | `claude --print --permission-mode plan --disallowedTools Write Edit` → `plan.md` | No file modification |
| 2 | Review | `external-code-review.py --mode plan` against an independent model | `VERDICT: PASS` required |
| — | Approval | Interactive prompt (or `hooks.requestApproval`) | **Human must approve** |
| 3 | Execute | `claude --print --dangerously-skip-permissions` on `fix/slack-issue-<runId>`, cut from the default branch, then `npm test && npm run build` | Both must pass |
| 4 | PR | `git push` + `gh pr create --draft --base <default branch>` | Skipped by `--no-pr` |

The fix branch is cut from the repository's primary branch (`origin/HEAD`, falling back to
`main`/`master`) rather than from whatever is checked out, and the PR targets that same branch.
Branching from an arbitrary feature branch while targeting `main` would pull that branch's unmerged
commits into the PR diff. Your original branch is restored when the run ends, pass or fail.

### Model tiers

Each Claude-invoking phase is pinned to its own model, so a run's cost profile is a property of the
pipeline rather than of whatever the operator's `claude` happens to be configured with.

| Phase | Default | Flag | Env |
|---|---|---|---|
| 0 Triage | `claude-haiku-4-5` | `--triage-model` | `AUTOFIX_TRIAGE_MODEL` |
| 1 Plan | `claude-sonnet-5` | `--plan-model` | `AUTOFIX_PLAN_MODEL` |
| 3 Execute | `claude-sonnet-5` | `--exec-model` | `AUTOFIX_EXEC_MODEL` |

Precedence is flag → env → default. An invalid id is rejected during argument validation, before the
run id or any paid call — a leading `-` would be read by the CLI as another option, and a typo would
otherwise surface minutes later as an opaque API error.

**Phase 2 has no tier here on purpose.** The plan review runs an independent vendor via
`--provider`; the gate's value is that a different model audits the plan than wrote it, so routing it
to a Claude tier would defeat it.

**Planning stays on the mid tier, not the cheap one.** `plan.md` is the contract Phase 3 executes
verbatim and a human approves — the triage tier is for the one-call classification in Phase 0, where
nothing downstream depends on the reasoning.

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

**Stopping a run.** Reply `עצור` / `kill` in the thread that started it. Only allowlisted
users can stop a run, and only from the owning thread — see "Execution guards" below for
why the address is a `runId` rather than a session id.

**What is not posted to Slack:** plan bodies, review text, and raw `claude` output stay in
the repo under `_bmad-output/autofix/<runId>/`. The thread gets status lines, the approval
prompt, and the final summary.

## Execution guards

| Guard | Mechanism | Configure |
|---|---|---|
| Spend ceiling | Cumulative **per-run** ledger; each phase is launched with the budget that is left | `AUTOFIX_MAX_BUDGET_USD` (default `2.0`) |
| Wall clock | Per-phase timeouts | 10 min plan · 5 min review · 30 min execute · 15 min verify |
| Kill switch | `npm run autofix:kill [-- <runId>]`, or reply `עצור` / `kill` in the Slack thread | — |
| Output cap | Child stdout capped, process group killed on overflow | 32 MB |

The spend ceiling lives in a single `claudeBaseArgs()` helper rather than at each call
site, so a phase cannot be added without it. An `AUTOFIX_MAX_BUDGET_USD` that is not a
finite positive number is rejected with a warning and the default is used — `Number("abc")`
is `NaN`, which stringifies to `NaN` and would reach the CLI as `--max-budget-usd NaN`,
disarming the only spend guard because of a typo.

### `AUTOFIX_MAX_BUDGET_USD` is a per-run ceiling, not a per-phase one

`--max-budget-usd` is a **per-invocation** limit. Taken at face value, a run reaching both
the plan and the execute phase could spend 2× the configured amount — not what "$2" means
to whoever set it. So the pipeline keeps a ledger for the whole run:

1. Every `claude` invocation runs with `--output-format json`, which is the only way to
   read `total_cost_usd`. This is mandatory, not a per-phase choice: a phase that reverted
   to text output would go unaccounted for and silently uncap the run.
2. After each phase the actual cost is charged to the ledger and written to
   `logs/autofix-events.jsonl` as `status:"cost"` with `run_spent_usd` / `run_remaining_usd`.
3. The next phase is launched with `--max-budget-usd <remaining>`, so the run-level number
   is the one that actually binds.
4. If the remaining balance is below the `$0.10` floor, the phase is **not launched**. The
   run aborts with exit `9` and a `budget_exhausted` notification, before spawning
   `claude -p`. Aborting after the CLI hits its own ceiling would mean paying for a phase
   that produced nothing usable.

Affordability for the execute phase is also checked *before* the approval prompt. Nothing
spends in between, but asking a human to approve a run that will immediately abort on
budget wastes the one step that requires a person.

Two failure modes this handles that a naive implementation does not:

- **A failed phase still costs money.** A budget-exhausted invocation exits 1 and *still
  emits a complete JSON envelope with a real `total_cost_usd`*. Cost is therefore charged
  on the failure path too — a ledger that only counted successes could be walked past its
  ceiling by a phase that keeps failing.
- **Unknown cost is not zero.** If an envelope is missing or unparseable, the phase is
  recorded as an *unaccounted* charge rather than as free, and the run refuses to launch
  anything further. Treating unknown as $0 is precisely how a run quietly blows its limit.

Hitting the budget is reported as a budget ceiling naming the env var, not as a bare
non-zero exit, because raising the limit is a decision rather than a bug. That detection
reads the envelope's `subtype` / `terminal_reason` fields rather than matching prose —
the previous text probe looked for `Exceeded USD budget`, which this CLI never emits (its
actual wording is `Reached maximum budget ($X)`), so every budget stop had been surfacing
as an unexplained non-zero exit.

### Two CLI features this pipeline deliberately does not use

**`--max-turns` does not exist in this CLI** (re-verified against v2.1.220 — it appears
nowhere in `claude --help`). Passing an unknown option aborts the phase before any work
happens, so adding it would break all four phases rather than bound them. The budget
ceiling plus the per-phase timeouts are what bound a runaway loop. If a future version
adds the flag, put it in `CLAUDE_BASE_ARGS` alongside `--max-budget-usd`.

**`claude kill <id>` does not exist either.** There *is* a hidden `claude stop <id>`, but
it addresses **background agent sessions** — those started with `--bg` and listed by
`claude agents --json`. Every phase here runs as a foreground `claude --print` child and
has no such session id, so `claude stop` has nothing to address. Termination is done at
the process level instead: phases spawn `claude` **detached**, so the child's pid is also
its process-group id, and the pid, phase, and `runId` are published to
`logs/autofix-active.json`. Killing the negated pid reaps the tool subprocesses Claude
spawns — signalling only the direct child can strand them holding the stdio pipes, after
which `close` never fires and the timeout cannot help.

Because there are no session ids, `autofix:kill` takes the **`runId`** as its optional
address, and it is an interlock rather than a selector: there is only ever one active run,
so naming one that does not match makes the kill **refuse** instead of stopping a
bystander. The Slack `עצור` path applies the same rule per-thread — a stop typed into an
old thread will not reach a run that started since.

```bash
npm run autofix:kill                        # stop whatever is active
npm run autofix:kill -- tag-filter-1a2b3c   # stop it only if it is this run
```

## Notifications

`runPipeline` accepts `hooks.onNotify(event, detail)`. Every event is also written to
`logs/autofix-events.jsonl` with `"kind":"notification"`, so the audit trail survives a
transport that is down.

| Event | Fired when | Carries |
|---|---|---|
| `input_required` | The run reaches the approval gate and is blocked on a human | `runId`, `branch`, `planPath`, `reviewPath`, `verdict`, `awaiting` |
| `budget_exhausted` | The remaining run budget cannot cover the next phase — fired **before** `claude -p` is spawned | `runId`, `phase`, `spent_usd`, `remaining_usd`, `budget_usd`, `reason` |
| `agent_completed` | The run reaches a terminal state | `runId`, `branch`, `outcome`, `exit_code`, `spent_usd`, `pr_url` or `error` |

A throwing or absent `onNotify` never takes down the run it is reporting on.

**Both sinks, always.** Under the Slack daemon each event lands in *two* ledgers, and
neither is derived from the other:

| Sink | Written by | Purpose |
|---|---|---|
| `logs/autofix-events.jsonl` | `runPipeline` | What the pipeline did, transport-agnostic |
| `logs/slack-events.jsonl` | `daemon.mjs` `onNotify` | What an operator was actually paged about |
| Slack thread message | `daemon.mjs` `onNotify` | The page itself |

The daemon writes its JSONL line **before** the Slack post and independently of whether
that post succeeds. Logging after a failed `chat.postMessage` would lose precisely the
events that matter most — the ones where nobody was reachable.

### G1 notification I/O matrix

| Event | Trigger point (pipeline) | `autofix-events.jsonl` | `slack-events.jsonl` | Slack thread |
|---|---|---|---|---|
| `input_required` | Phase 2 passed, before `requestApproval` | `kind:"notification"` | `kind:"notification"`, `event`, `run_id`, `awaiting` | 🔔 awaiting-approval nudge |
| `budget_exhausted` | Before spawning any phase whose cost the run cannot cover | `kind:"notification"`, `spent_usd` | `kind:"notification"`, `phase`, `spent_usd`, `remaining_usd` | 💸 budget spent, no agent launched |
| — (per-phase cost) | After every `claude` invocation | `status:"cost"`, `phase_cost_usd`, `run_spent_usd`, `run_remaining_usd` | — | — |
| `agent_completed` (success) | After the PR step | `kind:"notification"`, `pr_url` | `kind:"notification"`, `outcome:"success"`, `pr_url` | 🔔 done + PR link |
| `agent_completed` (failure) | Pipeline `catch` | `kind:"notification"`, `error` | `kind:"notification"`, `outcome:"failed"`, `exit_code` | 🔔 failed + exit code |
| kill | `עצור` / `kill` reply | — (process-level) | `kind:"kill"`, `run_id`, `killed`, `reason` | 🛑 / ⚠️ result |
| kill refused | Reply from a foreign thread or non-allowlisted user | — | `kind:"kill-refused"`, `reason` | ⚠️ (allowlisted users only) |

The daemon also stamps `runId` onto its active-run record from the first notification that
carries one, which is what lets the thread-scoped kill address a specific run.

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
| 8 | The Claude CLI itself failed (non-zero exit, timeout, killed, output cap, or a missing JSON envelope) |
| 9 | The run budget was exhausted — either a phase hit its ceiling, or too little remained to launch the next one |
| 10 | Phase 0 triage classified the report as not describing an actionable code change |

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
