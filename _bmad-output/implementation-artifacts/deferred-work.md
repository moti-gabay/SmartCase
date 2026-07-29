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
