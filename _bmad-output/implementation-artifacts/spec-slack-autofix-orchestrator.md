---
title: 'Autonomous Issue-Resolution Orchestrator (plan → review → execute → PR)'
type: 'feature'
created: '2026-07-29'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'c3c5288'
context:
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no path from a plain-language issue report to a reviewed, tested pull request. `scripts/slack-daemon.js` fires a bare `claude -p` with no plan, no review, no branch isolation, no test gate, and no PR — and it invokes `claude` off `$PATH`, which on this machine resolves to a broken Windows shim.

**Approach:** A CLI-driven four-phase pipeline — read-only planning, independent multi-model plan review, human-approved isolated execution on a `fix/` branch, then PR creation — exposed as `runPipeline(issue, hooks)` so a Slack adapter can later drive it without changes. Untrusted issue text is data at every hop, never shell input.

## Boundaries & Constraints

**Always:**
- Issue text is untrusted. Pass it via `execFile` argv or a temp file — never string-interpolated into a shell command, never `eval`.
- Resolve the Claude binary explicitly: `CLAUDE_BIN` env → `~/.local/bin/claude` → `$PATH`. Verify it responds to `--version` before Phase 1; abort with a clear error otherwise.
- Phase 1 is read-only: `--permission-mode plan`, plus `--disallowedTools Write Edit`.
- Phase 3 refuses to run unless the working tree is clean and HEAD is not `main`.
- After Phase 3, diff the branch and abort before PR if it touches `.env*`, `.github/**`, `.claude/settings.json`, or `prisma/sql/**`.
- Every phase appends a JSONL line to `logs/autofix-events.jsonl` (matching `slack-daemon.js` style; `logs/*.jsonl` is gitignored).
- Each phase has a hard timeout; on timeout kill the child and fail the run.

**Ask First:**
- Phase 3 never starts without an explicit approval from `hooks.requestApproval(plan, review)`. CLI default is an interactive stdin prompt; `--yes` bypasses it and must be opt-in.
- Widening the forbidden-path list, or making the PR non-draft by default.

**Never:**
- No Slack/Express/webhook code in this spec — ingress is deferred (`deferred-work.md`).
- Never push to or commit on `main`. Never force-push. Never open a PR when `npm test` or `npm run build` failed.
- Never write API keys or full `claude` stdout into the JSONL log or the PR body.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path | Issue text; clean tree; reviewer PASS; approval granted; tests pass | `plan.md` + `review.md` under `_bmad-output/autofix/<runId>/`; branch `fix/slack-issue-<runId>`; draft PR; summary returned via `hooks.report` | N/A |
| Reviewer FAIL | Phase 2 verdict is FAIL | Stop after Phase 2; report the reviewer's findings; no branch, no PR | Exit 2 |
| Approval denied | `requestApproval` returns false | Stop before Phase 3; artifacts retained | Exit 3 |
| Tests fail | Phase 3 edits applied but `npm test`/`npm run build` non-zero | No push, no PR; report the failing command + last stderr lines; branch left local for inspection | Exit 4 |
| Dirty tree / on `main` | Uncommitted changes or HEAD is `main` at Phase 3 | Abort before any mutation | Exit 5 |
| Forbidden path touched | Branch diff includes `.env` or `.github/**` | Abort before push; name the offending paths | Exit 6 |
| Claude binary unusable | `CLAUDE_BIN` unset and PATH shim is broken | Abort in preflight naming the tried paths | Exit 7 |
| Empty/whitespace issue | `""` | Refuse before Phase 1 | Exit 1 |

</frozen-after-approval>

## Code Map

- `scripts/slack-daemon.js` -- existing ingress; JSONL-logging and `execFile` conventions to mirror. Also carries the latent bare-`claude` break this pass fixes.
- `scripts/external-code-review.py` -- multi-provider (openai/gemini/deepseek) reviewer; `PROVIDERS`, `request_review`, `save_report` are reused as-is. Currently diff-only.
- `scripts/mcp/`, `scripts/case-audit.ts` -- precedent for script layout under `scripts/`.
- `tests/*.test.ts` -- `node:test` + `tsx`; pure-logic-only convention.
- `.gitignore:55` -- `logs/*.jsonl` already ignored.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/autofix/guards.mjs` -- pure, dependency-free exports: `resolveClaudeBin(env, fs)`, `slugify(text)`, `runIdFor(text, nowIso)`, `branchNameFor(runId)`, `parseVerdict(reviewMarkdown)` → `'PASS'|'FAIL'|'UNKNOWN'`, `findForbiddenPaths(changedPaths)` -- isolates every decision worth testing from the I/O shell.
- [x] `scripts/autofix/pipeline.mjs` -- exports `runPipeline(issueText, hooks)` running Phases 1–4 via `execFile`; `hooks` = `{ onPhase, requestApproval, report }` with CLI defaults. Writes `plan.md`/`review.md` to `_bmad-output/autofix/<runId>/` and appends to `logs/autofix-events.jsonl`.
- [x] `scripts/autofix/cli.mjs` -- argv parsing (`--provider`, `--yes`, `--no-pr`, `--dry-run`), reads issue from argv or stdin, maps exit codes per the matrix.
- [x] `scripts/autofix/autofix.sh` -- bash wrapper: `set -euo pipefail`, cd to repo root, preflight `git`/`gh`/`node`/`python3`, `exec node scripts/autofix/cli.mjs "$@"` -- gives a single documented entrypoint.
- [x] `scripts/external-code-review.py` -- add `--mode {diff,plan}` and `--plan-file`; in `plan` mode swap `SYSTEM_PROMPT` for a plan-audit rubric (RCA soundness, security/PII, architecture fit, test coverage) that must end with a literal `VERDICT: PASS` or `VERDICT: FAIL` line. Default stays `diff` -- no behavior change for existing callers.
- [x] `tests/autofix-guards.test.ts` -- cover every `guards.mjs` export against the I/O matrix rows (binary resolution order, verdict parsing incl. `UNKNOWN`, forbidden-path detection, slug/branch determinism and injection-hostile input).
- [x] `scripts/slack-daemon.js` -- replace the bare `execFile("claude", …)` with `resolveClaudeBin()` from `guards.mjs` and fail loudly (log + `say`) when no usable binary is found -- closes the latent break where `$PATH` resolves to a non-functional shim.
- [x] `package.json` -- add `"autofix": "bash scripts/autofix/autofix.sh"`.
- [x] `scripts/autofix/README.md` -- required env (`CLAUDE_BIN`, `GEMINI_API_KEY`/`OPENAI_API_KEY`, `GH_TOKEN` or `gh auth login`), exit-code table, and the security model.

**Acceptance Criteria:**
- Given `--dry-run`, when the pipeline runs, then it prints the resolved binary, runId, branch name, and provider, and makes zero git/network mutations.
- Given a run that reaches Phase 4, when the PR is created, then the body contains RCA, solution summary, and test results, and contains no API keys or raw `claude` stdout.
- Given any non-zero exit, when the run ends, then `logs/autofix-events.jsonl` has a terminal line for that runId with `status`, `phase`, and `exit_code`.
- Given `runPipeline` is imported with custom `hooks`, when it runs, then it never reads stdin or writes to stdout directly — all human interaction flows through `hooks`.

## Spec Change Log

- **2026-07-29 — pre-implementation, human-directed.** Slack triage found `scripts/slack-daemon.js` calls bare `execFile("claude", …)`; on this machine `$PATH` resolves to a Windows npm shim that errors "native binary not installed". Never exercised (`logs/slack-events.jsonl` absent), so it is latent, not observed-failing. Human folded the fix into this pass: Code Map "Do not modify" lifted, one task added reusing `resolveClaudeBin()`. Avoids shipping an orchestrator that resolves the binary correctly while the sibling daemon beside it still cannot start. KEEP: `resolveClaudeBin` stays a `guards.mjs` export with injected `env`/`fs` so both callers share one tested resolution order.

## Design Notes

Phase boundary contract — the shape a future Slack adapter binds to:

```js
await runPipeline(issueText, {
  onPhase: (n, name, detail) => {},               // progress
  requestApproval: async (plan, review, meta) => true,  // gate before Phase 3
  report: async (summary) => {},                  // final RCA + tests + PR link
}, { provider: "gemini", createPr: true, dryRun: false });
```

`parseVerdict` scans for the last `VERDICT:` line and returns `UNKNOWN` when absent; `UNKNOWN` is treated as FAIL (fail-closed) so a truncated or malformed reviewer response can never green-light execution.

## Verification

**Commands:**
- `npm test` -- expected: all tests pass, including `tests/autofix-guards.test.ts`.
- `npm run build` -- expected: clean Next build (no app-code regression).
- `npm run lint` -- expected: no new errors in `scripts/autofix/**`.
- `npm run autofix -- --dry-run "checkout button is misaligned on mobile"` -- expected: prints resolved binary/runId/branch, exits 0, no branch created (`git status` clean, `git branch` unchanged).
- `python3 scripts/external-code-review.py --mode plan --plan-file <fixture> --dry-run` -- expected: reports plan-mode selection without calling the API.
