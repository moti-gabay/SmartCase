# MEMORY.md

This file is an active snapshot of the current build state — architectural and feature milestones from the Phase 3 (Conversion module & client portal) and Phase 4 (portal hardening, native printing, i18n) deployments. See [CLAUDE.md](CLAUDE.md) for technical specifications and engineering invariants, and [ROLES.md](ROLES.md) for project roles & personas.

## Current build state

1. **Current App State**: SmartCase CRM currently operates as a Single-Tenant system for one office, though designed with a forward-looking SaaS vision.

2. **Multi-Language Portal**: The public client onboarding page (`/share/conversion/[token]`) supports Hebrew, English, and French using our zero-dependency local dictionary mapping. Layout direction dynamically flips between RTL and LTR seamlessly based on the locale state.

3. **Dynamic i18n Mapping**: DB-driven document checklist items are mapped and translated via stable Enum values, NEVER by raw Hebrew string parsing.

4. **Anti-Spam Guard**: The public form includes an off-screen accessible Honeypot input named `website`. Server-side validation rejects payloads containing data in this field with a 400 error.

5. **Native Printing Engine**: Absolutely NO canvas or DOM rasterization libraries (like jsPDF or html2pdf.js) are allowed in this repository — they break Hebrew typography. All document exports and branded letters leverage native browser CSS printing scoped via `@media print`.

## Phase 5 Roadmap: State-Driven Client Journey (SmartCase Wizard)

### Product Vision Shift
- Transition the public portal from a broad multi-language form into a highly sequential, single-step **User Journey / Wizard Dashboard**.
- The client should only see the exact content required for their current state, driven by a strict backend state machine (`CaseStep` enum).

### Target Implementation Steps
1. **Screen 1 & 2**: Welcome and Process Overview screens (zero input, focus on setting expectations).
2. **Screen 3 (The Wizard)**: Micro-steps for inputs (Personal, Family, Background) limiting to 5-6 fields per view.
3. **The Personal Story Module**: Support text input, document attachment, or Audio Recording (Web MediaRecorder API saved to Cloudflare R2 and transcribed via Server-side AI).
4. **References Sub-module**: Structured schema for recommenders (Name, Phone, Role) with optional file attachment.
5. **Smart Scheduling**: Dynamic slot selection linked to verified availability, triggering auto-confirmation workflows.
6. **Post-Meeting Tracker**: Shift portal into passive milestone tracking (e.g., "Awaiting Date", "Bring 3 Witnesses").
7. **Legal Escrow Fees**: Clear financial breakdown emphasizing payment is exclusively for "Office Support and Administrative Care Milestones," separated entirely from the religious conversion workflow.

## Phase 5 Core Achievements: User Management & Access Control — COMPLETED

### Phase 5 Core Achievements: User Management & Access Control (Shipped)
1. **Database Identity**: Added `UserStatus` enum (PENDING_APPROVAL, APPROVED, SUSPENDED). Reassigned all legacy users to APPROVED; new registrations default to PENDING_APPROVAL. The legacy `isActive` column is fully retired from the auth layer.
2. **Secured NextAuth Pipeline**: Enforced account gating inside the core credentials `authorize()` pipeline via custom `CredentialsSignin` subclasses, protecting against user status enumeration by validating password credentials *prior* to state exposure. (Implemented in `authorize()` rather than the `signIn` callback because that is where the `CredentialsSignin` `code` propagates reliably in `next-auth@5.0.0-beta.31`.)
3. **Throttled Session Revocation**: Implemented a 5-minute throttled database status check in the `jwt` callback. A state transition to SUSPENDED safely forces a session kill via native next-auth session store cleanup.
4. **Three-Layer Access Control**: Guarded the new `/admin/users` management portal at the Edge middleware level, the Server Component layout, and within every administrative Server Action via `requireAdmin()`.
5. **Bricked System Protection**: Enforced strict runtime database count validations preventing self-lockout (admins demoting themselves) and last-admin mitigation (bricking the system by suspending the final approved admin).
6. **Audit Logs**: Integrated immutable transaction-bound audit logging for every authorization, role, or status change.

## Process Documentation: ULTRACODE Multi-Agent Architecture — SHIPPED

Governance and submission documents for the coordinated multi-agent (Agent Teams) workflow. These are **process artifacts, not application code** — they describe how work is produced, not what the app does.

1. **[docs/adoption-plan.md](docs/adoption-plan.md)** (PR #47): Two-page executive adoption plan. Page 1 covers pilot scope (Staff Scheduling & Task Management APIs), the four agent roles (Spec & Schema Lead, Pure Core Developer, Security & RLS Auditor, Adversarial Tester), and a KPI table with six **conjunctive** exit gates. Page 2 covers the 4-week phased rollout, the risk mitigation matrix, and governance rules.

2. **[docs/final-submission.md](docs/final-submission.md)** (PR #48, corrected in #49): Consolidated submission package tying the shipped engineering slices (Staff Scheduling & MeetingSlots, Task Edit & Deletion) to the adoption plan, with a verification section recording re-executed quality gates.

3. **The 3 Immutable Governance Rules** (from the adoption plan — these bind agent work on this repo):
   - **No automated database migrations.** Agents propose migrations as reviewable artifacts; a senior engineer executes them. Reinforces the existing `db:push` + manual RLS workflow — the one change class that is not cheaply reversible.
   - **Mandatory 100% quality gate pass rate.** Full test suite (no skips), `tsc --noEmit` at zero errors, linter clean, production build succeeding. A partial pass is a failure.
   - **Session logging & immutable audit trail.** Agent attribution, tool-call history, gate results *including failures*, and human reviewer disposition. Absence of a complete trail is itself a gate failure.

4. **Gate Baseline (current)**: `npm test` → **521/521** pass, 0 skipped; `npx tsc --noEmit` → 0 errors; `npm run lint` → clean repo-wide. Use this as the regression baseline — a drop in test count is a signal, not noise. Baseline history: 322 at ULTRACODE submission → 350 (admin Server Action coverage, PR #52) → 367 (`adminDeleteUser` coverage) → 379 (notification plugin architecture) → 397 (AI provider plugin architecture) → 426 (Telegram inbound ingress) → 446 (plugin marketplace) → 453 (Telegram `/enable` `/disable`) → 464 (assistant voice input) → 485 (Live Voice Mode) → 500 (AI action framework, HITL execute gate) → 514 (Cases + Clients actions, card-typed PII) → 521 (Appointments + Documents actions, services extraction, aiValidation guard, history-start trim). Update this number in the same PR that changes the count, or the next session reads a false failure.

   Note: `npm test` now runs with `--experimental-test-module-mocks`. `tests/actions.test.ts` needs it to substitute Prisma/NextAuth/`next/cache` for the `"use server"` actions in `src/lib/actions.ts`, which take no injected ports. It is an experimental Node flag — re-verify on any Node major bump. Top-level `await` is unavailable under tsx's CJS output, so mocked modules must be imported lazily, after `mock.module` registration.
