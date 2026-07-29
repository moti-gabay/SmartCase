# Deferred Work

- source_spec: `spec-case-tagging-ui.md`
  summary: Tag add/remove is a read-modify-write on the Case.tags Json column with no transaction/lock — concurrent mutations can drop a tag.
  evidence: Adversarial review confirmed no optimistic guard; tolerable at single-office scale but should get a `$transaction` + `FOR UPDATE` before multi-tenant SaaS.

- source_spec: `spec-case-tagging-ui.md`
  summary: JSONL tag-audit sink (`logs/case-events.jsonl` under cwd) is ephemeral/no-op on Vercel serverless — align with the Phase 5 DB-backed transaction-bound audit model.
  evidence: Frozen spec intent mandates `createJsonlAuditWriter()`; the non-fatal wrapper prevents crashes but production audit lines don't persist across invocations.

- source_spec: `spec-case-tagging-ui.md`
  summary: Tag popover a11y polish — `role="dialog"`, `aria-expanded` on trigger, focus move/restore, Enter-to-submit on the label input.
  evidence: Round-2 review; Escape-close and swatch aria-labels shipped, full dialog semantics did not.

- source_spec: `spec-case-tagging-ui.md`
  summary: `filterCasesByTags` maxPerCategory charges a case to the first matching tag in insertion order (order-dependent, untested property).
  evidence: Pre-existing engine behavior from #12, surfaced by review; unused by the current UI.

- source_spec: none
  summary: Slack ingress rewiring — make `scripts/slack-daemon.js` thread-aware (capture `thread_ts`, reply in-thread), add a trigger-user allowlist, and dispatch to the autofix orchestrator instead of a bare `claude -p`, including the reaction-based plan approval gate.
  evidence: Split from the "autonomous Slack issue-resolution architecture" intent. The orchestrator (plan → multi-model review → isolated execution → PR) is independently shippable and testable from the CLI; the Slack adapter is a thin layer over its `runPipeline(issue, hooks)` boundary and ships separately.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: Phase 1 "read-only" planning disallows only Write and Edit — Bash, MultiEdit, NotebookEdit, and every MCP tool (postgres against DATABASE_URL, slack, playwright) remain available to a planning agent handling untrusted issue text.
  evidence: Review round 1. The README calls Phase 1 "read-only by construction" and the security model rests on that claim; whether `--permission-mode plan` independently blocks Bash was not verified. Needs either an explicit allow-list (`--allowedTools Read Grep Glob`) or a verified statement of what plan mode actually permits.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: PR base branch is whatever was checked out, and `main`/`master` are refused — so a PR can never target main, and the fix is built on a possibly stale local base with no fetch/rebase against origin.
  evidence: Review round 1. Design tension inside the frozen spec: "refuse to run on main" plus "base = current branch" are individually reasonable and jointly mean the intended Slack-triggered flow has no path to a main-targeting PR. Needs a human decision on the intended base-branch policy.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: Issue text flows into the run id, the branch name, and the JSONL log — so client-identifying words from a Hebrew support report can be pushed to origin and persisted locally.
  evidence: Review round 1. This app handles medical/legal PII; a branch name is public once pushed. Consider a hash-only branch name and logging a digest of the issue rather than its text.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: No mutual exclusion between concurrent autofix runs in the same working tree; interleaved checkouts and `git add -A` can make one run commit another's edits.
  evidence: Review round 1. Harmless for single-operator CLI use, but the deferred Slack ingress makes concurrent triggers likely. Needs an exclusive lockfile before Phase 3.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: SIGKILL on timeout targets only the direct child; detached grandchildren holding the stdio pipes can keep 'close' from firing, so the promise never settles despite the timeout.
  evidence: Review round 1. Requires `spawn(..., {detached: true})` plus `process.kill(-pid)` to kill the whole process group.
