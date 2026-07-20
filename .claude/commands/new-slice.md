---
description: Scaffold a new SmartCase feature slice (backoffice + optional public portal) following repo conventions and invariants.
argument-hint: <slice name / short description>
---

Scaffold a new vertical feature **slice** for SmartCase: `$ARGUMENTS`

A "slice" is a thin end-to-end increment (see the Slice 1–7 git history). Follow the repo's
canonical file-flow and engineering invariants exactly. Do not over-build — minimum code that
ships the slice, matching existing style.

## Step 1 — Plan the two layers

Per `ROLES.md`, default to structuring the solution into:
- **Internal backoffice automation** — dashboards, triggers, status trackers for the office team.
- **Secure client portal** — low-friction, multi-language public forms for the end user.

State which layers this slice needs. If it's ambiguous whether a public portal surface is
involved, **ask** before scaffolding — the security model differs sharply between the two.

## Step 2 — Walk the canonical file-flow

Touch only what the slice needs, in this order. Keep changes surgical.

1. **`prisma/schema.prisma`** — new model or enum value. After editing, remind the user to run
   `npm run db:generate` (and `npm run db:migrate` for a schema change) — the generated client
   under `src/generated/prisma` is gitignored and won't exist otherwise.
2. **`src/types/index.ts`** — mirror any new enum as a string-union `type`; add DTO interfaces.
3. **`src/lib/constants.ts`** — `*_LABELS` (Hebrew) plus companion `*_COLORS` / `*_DOT` maps for
   every new enum value. This is a build-breaking contract with i18n — don't skip it.
4. **`src/lib/queries.ts`** — read-side Prisma functions returning the `src/types` DTOs. Import
   the `prisma` singleton from `src/lib/prisma.ts` (never `new PrismaClient()`).
5. **`src/lib/actions.ts`** — write-side `"use server"` actions: Zod-validated, `auth()`-gated,
   `revalidatePath` after mutation. **Never** put unauthenticated/portal logic here — any
   `"use server"` export becomes a network-invokable Server Action.
6. **`src/lib/i18n/conversion-portal.ts`** — if portal-facing, add `en`/`fr` keys by stable enum
   identifier, never by parsing the Hebrew string.
7. **`src/app/api/public/**/route.ts`** — any unauthenticated mutation lives here: resolve
   `caseId`/`clientId` from the token via `resolvePortalToken`, include the `website`→`honeypot`
   check (generic error), keep identity fields read-only.
8. **`src/components/<domain>/*.tsx`** and the `page.tsx` / `route.ts` wiring — RTL-first, logical
   CSS properties only.

## Step 3 — Validate

Run the **`nextjs16-convention-validator`** skill against the diff before finishing. Fix any
flagged invariant violations.

## Step 4 — Verify gate

Run `npm test` and `npm run build`. Report the actual results — if either fails, surface the
output and fix before declaring done.

## Step 5 — Commit message (do not commit unless asked)

Suggest a message matching the repo's history style, e.g.:
`feat: implement Slice N <one-line description of the slice>`
