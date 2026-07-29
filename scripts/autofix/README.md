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
| 1 | Plan | `claude --print --permission-mode plan --disallowedTools Write Edit` → `plan.md` | Read-only by construction |
| 2 | Review | `external-code-review.py --mode plan` against an independent model | `VERDICT: PASS` required |
| — | Approval | Interactive prompt (or `hooks.requestApproval`) | **Human must approve** |
| 3 | Execute | `claude --print --dangerously-skip-permissions` on `fix/slack-issue-<runId>`, then `npm test && npm run build` | Both must pass |
| 4 | PR | `git push` + `gh pr create --draft` | Skipped by `--no-pr` |

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

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Empty issue text / bad arguments |
| 2 | Plan review returned `FAIL` (or `UNKNOWN` — see below) |
| 3 | Human denied approval |
| 4 | `npm test` or `npm run build` failed, or execution produced no changes |
| 5 | Unsafe repo state (dirty tree, or on `main`/`master`) |
| 6 | Execution touched a forbidden path |
| 7 | No usable Claude binary |

## Security model

Phase 3 runs Claude with **all permission checks bypassed**. These are the controls
that make that acceptable, and none of them should be relaxed casually:

- **Human gate.** Execution never starts without an explicit approval. `--yes` exists
  for non-interactive runs and is the single most dangerous flag here.
- **Fail-closed review.** A missing, truncated, or malformed verdict parses as
  `UNKNOWN` and is treated as `FAIL`. A broken reviewer response cannot approve anything.
- **Untrusted input stays data.** Issue text is written to the child's stdin — never
  interpolated into a shell string, never passed through a shell, never in argv.
  The plan prompt fences it and labels it as data to analyse, not instructions to follow.
- **Branch isolation.** Refuses to run on `main`/`master` or with a dirty tree; all work
  happens on a fresh `fix/` branch.
- **Forbidden paths.** Before pushing, the change set is scanned; any hit on `.env*`,
  `.github/**`, `.claude/settings.json`, or `prisma/sql/**` aborts the run. This is what
  stops a compromised or manipulated plan from rewriting CI, secrets, or RLS setup.
- **Green tests are mandatory.** A failing `npm test` or `npm run build` means no push
  and no PR; the branch is left local for inspection.
- **PRs open as drafts**, so nothing merges without human review.

Residual risk worth knowing: anyone who can supply issue text can cause arbitrary code
to be *proposed*. The human gate and the forbidden-path scan are what stand between that
and code reaching the remote.
