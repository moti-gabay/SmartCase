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

- source_spec: none
  summary: Route `.claude/hooks/session-summary.sh` output to a dedicated `#smartcase-ci` channel so `SLACK_NOTIFY_CHANNEL` stays a human support surface — address alongside the G1 ingress work.
  evidence: Six triage scans of C0BJLPS50LE on 2026-07-29 found 2 human messages against 36 bot session summaries (~95% noise) over ~26h. The `790d26e` fingerprint dedupe stopped byte-identical repeats but not volume, since each commit produces a distinct summary. The noise makes the channel unscannable for a human and forces any automated reader to filter almost everything it fetches — which the deferred G1 ingress would have to do on every event.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: Phase 1 "read-only" planning disallows only Write and Edit — Bash, MultiEdit, NotebookEdit, and every MCP tool (postgres against DATABASE_URL, slack, playwright) remain available to a planning agent handling untrusted issue text.
  evidence: Review round 1. Docs corrected 2026-07-29 to state plainly that Phase 1 restricts file modification only, and that Bash/MCP are governed by session tool-permission config rather than by this pipeline — the misleading "read-only by construction" claim is gone. The hardening itself is still open: needs an explicit allow-list (`--allowedTools Read Grep Glob`) or a verified statement of what `--permission-mode plan` actually permits.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: RESOLVED 2026-07-29 — PRs now target the repository's primary branch and fix branches are cut from it after a fetch, with the operator's original branch restored on exit.
  evidence: Review round 1 flagged that "refuse to run on main" plus "base = current branch" jointly made a main-targeting PR impossible. Human decided PRs must target main; implemented via `resolveDefaultBranch()` (origin/HEAD → main → master).

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: Issue text flows into the run id, the branch name, and the JSONL log — so client-identifying words from a Hebrew support report can be pushed to origin and persisted locally.
  evidence: Review round 1. This app handles medical/legal PII; a branch name is public once pushed. Consider a hash-only branch name and logging a digest of the issue rather than its text.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: No mutual exclusion between concurrent autofix runs in the same working tree; interleaved checkouts and `git add -A` can make one run commit another's edits.
  evidence: Review round 1. Harmless for single-operator CLI use, but the deferred Slack ingress makes concurrent triggers likely. Needs an exclusive lockfile before Phase 3.

- source_spec: `spec-slack-autofix-orchestrator.md`
  summary: SIGKILL on timeout targets only the direct child; detached grandchildren holding the stdio pipes can keep 'close' from firing, so the promise never settles despite the timeout.
  evidence: Review round 1. Requires `spawn(..., {detached: true})` plus `process.kill(-pid)` to kill the whole process group.
