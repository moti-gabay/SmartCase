---
title: 'PII Masking / Sanitization Hook for AI Chat'
type: 'feature'
created: '2026-07-22'
status: 'in-progress'
review_loop_iteration: 1
baseline_commit: '843da8685e6b3da6a8ce4bb4a59c304a7abc1270'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The staff AI chat persists raw user prompts and assistant answers (which relay client PII from tool results) into `ChatMessage`/`Conversation`, so national IDs, phones, emails, names, and addresses accumulate permanently in chat-history logs; accidentally typed PII in free-text prompts also reaches Gemini unnecessarily.

**Approach:** Add a pure utility module `src/lib/ai/pii-sanitizer.ts` (pattern-based masking for Israeli national IDs / phones / emails + exact-value masking for names/addresses collected from tool results) and apply it selectively in `/api/ai/chat`: mask free-text user input before it is persisted (and therefore before Gemini sees it via history), leave live tool results unmasked in-flight, mask assistant text at persistence time, and strip `args` entirely (not mask) from persisted `toolCalls` records.

## Boundaries & Constraints

**Always:**
- Selective masking model (human-approved, revised after review_loop_iteration 1): (1) user free-text is pattern-masked before persistence/Gemini; (2) tool results flow to Gemini **unmasked** during the live turn — staff are authorized; (3) assistant text written to `ChatMessage.content` is masked via pattern + exact-value matching; (4) `toolCalls` JSON persists only `{ name, ok, ms }` per call — `args` is never written to the DB, masked or otherwise, closing the partial-search-fragment leak without heuristic matching.
- Masking replaces values with Hebrew tags: `[תז_ממוסכת]`, `[טלפון_ממוסך]`, `[אימייל_ממוסך]`, `[שם_ממוסך]`, `[כתובת_ממוסכת]`.
- Israeli ID detection must validate the official checksum so 5–9-digit non-ID numbers (case numbers, amounts) are not masked.
- Sanitizer is pure, dependency-free, and lives in `src/lib/ai/pii-sanitizer.ts` — importable from route handlers without side effects.
- Mask **before** the `STORED_MESSAGE_MAX_CHARS` slice, never after (slicing first could split a match across the cut).
- `assistant-tools.ts` executors and their `select` whitelists stay untouched.

**Ask First:**
- Any change that would mask tool results in-flight (breaks staff utility — explicitly rejected).
- Extending masking to non-chat AI features (`generateHebrewLetter`, `analyzeDocument`) — out of scope now.

**Never:**
- No third-party PII/NLP libraries; regex + exact string matching only.
- No name detection via heuristics/NLP — names and addresses are masked only as exact strings collected from the current turn's tool results. Partial fragments and model paraphrases of a name in free text (`fullText`) are an accepted, documented residual limitation — not masked, not blocking.
- No schema changes, no retroactive migration of existing stored messages.
- No persisting `args` (raw or masked) in `toolCalls` — field is dropped entirely, not sanitized.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid Israeli ID in text | checksum-valid 7-9 digit run, e.g. `"תבדוק ת\"ז 200000008"` | ID replaced with `[תז_ממוסכת]` | N/A |
| Checksum-invalid 9 digits | `"תיק מספר 123456789"` | Unchanged — not an ID | N/A |
| All-zero digit run | `"0000000"` | Unchanged — explicit guard against the checksum's trivial all-zero pass | N/A |
| Israeli phone formats | `050-1234567`, `0501234567`, `+972-50-1234567`, `03-6123456` | Each replaced with `[טלפון_ממוסך]` | N/A |
| Email | `moshe@example.co.il` | `[אימייל_ממוסך]` | N/A |
| Known exact values | text contains `fullName`/address string collected from tool results | Replaced with `[שם_ממוסך]` / `[כתובת_ממוסכת]` | N/A |
| Overlapping matches | known value that also matches a pattern | Masked once, no nested/double tags | N/A |
| No PII | plain Hebrew question | Returned unchanged (same reference semantics fine) | N/A |
| Empty / non-string in collected values | `null`, `""`, numbers in tool results | Skipped silently, never throws | Sanitizer never throws; on internal error return input unchanged |
| Partial/paraphrased name | tool call arg `"כהן"` (surname fragment of harvested `"יוסי כהן"`), or assistant text `"מר כהן"` | `args` never persisted (dropped per constraint); free-text fragment left unmasked — documented limitation, not a defect | N/A |
| Deeply nested tool result | recursive/nested object passed to `collectPiiValues` | Traversal stops at a bounded depth, never overflows | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/ai/pii-sanitizer.ts` — NEW: pure sanitizer (pattern masking, checksum, exact-value masking, tool-result PII collection)
- `src/app/api/ai/chat/route.ts` — integration point: mask user message pre-persist; collect PII values from tool results in the function-calling loop; mask `fullText` pre-persist; strip `args` from `toolRecords` before persistence
- `src/lib/ai/chat-protocol.ts` — read-only reference: `STORED_MESSAGE_MAX_CHARS` ordering constraint
- `src/lib/ai/assistant-tools.ts` — read-only reference: shape of tool results (`fullName`, `phone`, `nationalId`, `addressCity` keys) for the collector
- `tests/pii-sanitizer.test.ts` — NEW: unit tests via `node:test`/`tsx` (repo convention: pure logic only)

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/ai/pii-sanitizer.ts` — create: `isValidIsraeliId(digits)` (official checksum, with an explicit all-zero-digit-run guard since an all-zero run always passes the checksum trivially); `maskPii(text, knownValues?)` applying email → phone → ID patterns then exact known-value replacement (longest-first to avoid partial overlap); `collectPiiValues(result, into?, depth?)` recursively harvesting `fullName`, `phone`, `nationalId`, `email`, `addressCity`, `address` string values from a tool-result object into a `Map<value, tag>`, bounded to a fixed max recursion depth — because regex cannot detect Hebrew names/cities, only exact echo of tool-sourced values
- [x] `src/app/api/ai/chat/route.ts` — integrate: mask `message` with `maskPii` before `chatMessage.create` (user turn); accumulate `collectPiiValues(result)` per tool call in the loop; in the `finally` persist block, apply `maskPii(fullText, collected)` before the `STORED_MESSAGE_MAX_CHARS` slice, trimming any trailing partial `[...]` tag left by the slice boundary; build `toolRecords` for persistence as `{ name, ok, ms }` only — `args` is never added to the persisted record
- [x] `tests/pii-sanitizer.test.ts` — create: cover every I/O-matrix row incl. checksum true/false vectors, all-zero guard, all phone formats, overlap/no-double-mask, bounded recursion depth, never-throws
- [x] Verification gate — run commands below; report `All checks passed cleanly` before asking to commit

**Acceptance Criteria:**
- Given a staff prompt containing a checksum-valid ID and a phone number, when the turn completes, then the stored USER row contains `[תז_ממוסכת]`/`[טלפון_ממוסך]` and no raw values.
- Given a turn where `search_clients` returned a client, when the assistant echoes the exact name/phone in its answer, then the live SSE stream shows real values but the stored ASSISTANT row contains only mask tags.
- Given any tool call in a turn, when the turn is persisted, then the corresponding `toolCalls` JSON entry contains only `name`, `ok`, `ms` — no `args` key.
- Given a prompt with a case number that fails the ID checksum, when sanitized, then the number is preserved unchanged.
- Given an all-zero digit run (e.g. `"0000000"`), when sanitized, then it is left unchanged.
- Given tool results with `null`/missing PII fields, when collected, then no error is thrown and masking proceeds with whatever was found.

## Spec Change Log

- **2026-07-22, review_loop_iteration 1 (intent_gap):** Adversarial review (Blind Hunter + Edge Case Hunter) found that exact-match-only masking (mandated by the `Never: No name detection via heuristics/NLP` constraint) cannot satisfy the original acceptance criterion promising `toolCalls` JSON contains "only mask tags" — partial search fragments (e.g. `args.query: "כהן"`) and paraphrased assistant mentions bypass exact-value matching entirely. **Amended:** `toolCalls.args` is now dropped from persistence entirely (never written, masked or not) rather than masked — this fully closes the tool-call leak without heuristic matching. Assistant/user free-text paraphrase/fragment leakage is accepted as a documented residual limitation (Moti's explicit decision) rather than solved. **KEEP:** the selective model itself (pattern-mask user input, leave live tool results unmasked, mask persisted assistant text) — validated as correct in review_loop_iteration 1, not in question. Also folded in three low-severity `patch`-category findings from the same review round (all-zero checksum false-positive, `collectPiiValues` recursion depth bound now explicit in signature, mask-then-slice trailing-tag trim) since they're cheap, non-controversial, and would otherwise resurface on the next review pass.

## Design Notes

Trade-off accepted by Moti: pattern-masking the user prompt means a staff member who types a raw national ID cannot have the model search by it (the model sees the tag, not the digits). Search by name/phone-fragment via tools still works. The user turn is persisted *before* history is read back for Gemini, so masking at that single point covers both storage and the model payload — no second call site.

Trade-off accepted by Moti (review_loop_iteration 1): dropping `toolCalls.args` means chat history loses the literal search term staff used for a query (e.g. can no longer see they searched `"כהן"` vs `"יוסי כהן"` when auditing later) — only that a call happened, whether it succeeded, and how long it took. Partial name fragments typed directly into free-text chat messages, or paraphrased by the assistant in its own answer, are not masked — accepted as out of scope for this iteration rather than solved via fuzzy/heuristic matching.

## Verification

**Commands:**
- `npm test` — expected: all tests pass incl. new `tests/pii-sanitizer.test.ts`
- `npx tsc --noEmit` — expected: zero errors
- `npx eslint src/lib/ai/pii-sanitizer.ts src/app/api/ai/chat/route.ts tests/pii-sanitizer.test.ts` — expected: zero errors (lint scoped to touched files per repo convention)
