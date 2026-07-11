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
