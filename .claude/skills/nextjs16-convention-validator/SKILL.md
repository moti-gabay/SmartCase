---
name: nextjs16-convention-validator
description: >-
  Validate code against SmartCase's non-standard Next.js 16 / Prisma 7 / NextAuth v5
  invariants. Use BEFORE writing or reviewing any code that touches middleware, auth,
  Prisma access, the public portal, printing/PDF, RTL layout, or the enum→label→i18n
  chain. Triggers: editing middleware.ts, auth.config.ts, auth.ts, src/lib/prisma.ts,
  src/app/api/public/**, src/lib/print.ts, adding a schema enum, or any PDF/RTL work.
---

# SmartCase Convention Validator

This repo is deliberately non-standard: Next.js 16, Prisma 7 (driver adapter, generated
out-of-tree), NextAuth v5 beta, Hebrew RTL, and an unauthenticated public portal. Several
invariants were established *after hitting a real bug or an adversarial test* — do not
"modernize" past them. The authoritative source is the **"Engineering invariants"** section
of `CLAUDE.md`; this skill is the fast checklist. When in doubt, re-read that section and
`AGENTS.md`.

## How to run

Scan the target files or the current diff against the rules below. For each rule, look for
the **flag** pattern; if found, report it. Report findings as a list of
`path:line — [invariant N] <what's wrong> → <fix>`. If nothing matches, say the diff is
clean and name which invariants you checked.

## Rules

### 1. Middleware stays `middleware.ts` (Edge)
- **Flag**: a root `proxy.ts`, or a rename/migration of `middleware.ts` → `proxy.ts`.
- **Why**: on the current `next-auth@5.0.0-beta.31`, `proxy.ts` was silently *not registered*
  as route protection — `/dashboard` became publicly reachable (200 instead of 307→/login).
- **Fix**: keep it `middleware.ts` at repo root using the Edge `middleware` convention.

### 2. Auth three-file split
- **Flag**: `auth.config.ts` importing Prisma, bcrypt, or any Node-only module; `middleware.ts`
  importing anything other than `auth.config.ts`; `auth.ts` or `src/lib/prisma.ts` imported
  from `middleware.ts` or `auth.config.ts`.
- **Fix**: `auth.config.ts` = Edge-safe (`authorized` callback + `pages` only). `auth.ts` =
  Node-only full config (Credentials + bcrypt + Prisma, JWT/session callbacks).
  `middleware.ts` imports only `auth.config.ts`.

### 3. Prisma singleton + generated client
- **Flag**: `new PrismaClient()` anywhere outside `src/lib/prisma.ts`; DB `url` added back into
  `prisma/schema.prisma`.
- **Fix**: import the `prisma` singleton from `src/lib/prisma.ts` (built from `PrismaPg` +
  `DATABASE_URL`). Imports from `@/generated/prisma/client` are expected (gitignored, regenerated
  by `npm run db:generate`); `@ts-ignore` on those imports is expected until generation runs.

### 4. Public portal security model
- **Flag** (any of):
  - a public route reading `caseId`/`clientId`/checklist id from the request **body** instead of
    resolving it server-side from the token via `resolvePortalToken` (`src/lib/queries.ts`);
  - a honeypot check that returns a distinct/identifiable message (must reuse the **generic**
    validation error — the DOM field is `name/id="website"`, serialized to body key `honeypot`);
  - public/unauthenticated mutation logic placed in `"use server"` `src/lib/actions.ts` instead
    of a Route Handler under `src/app/api/public/**`;
  - identity fields (name, national ID) made editable in a public portal;
  - field-level encryption on the portal token, or a token narrower than `crypto.randomBytes(32)`.
- **Fix**: resolve every id from the token server-side; keep public-mutation logic in
  `src/app/api/public/**/route.ts`; identity fields read-only; tokens = raw 256-bit bearer
  secrets stored as a unique column, revoked by rotation/expiry.

### 5. Native Hebrew printing — no rasterization
- **Flag**: importing/installing `jsPDF`, `html2pdf.js`, `html2canvas`, or any
  canvas-rasterization PDF lib; a single shared print class instead of the two distinct
  `.print-summary` / `.print-letter`.
- **Fix**: use `printSection(target)` from `src/lib/print.ts` (tags `<body data-print-target>`,
  calls `window.print()`); `globals.css` scopes visibility per-class; `PrintLetterhead` is the
  print-only header. "Download PDF" means a scoped `window.print()`, not client-side serialization.

### 6. RTL-first layout
- **Flag**: physical CSS directions (`ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`,
  `border-l`, `border-r`, `text-left`/`text-right`) in new layout code; assuming first-in-DOM = left.
- **Fix**: logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `border-s`, `border-e`, `text-start`,
  `text-end`). Root is `<html dir="rtl" lang="he">`; in flex, first-in-DOM = **right** side.

### 7. Enum → Hebrew label → i18n chain
- **Flag**: a new enum value in `prisma/schema.prisma` without a matching union in
  `src/types/index.ts` and label/color entries in `src/lib/constants.ts`; portal-facing
  translations (`en`/`fr`) keyed by matching/parsing the Hebrew string instead of the stable
  enum identifier.
- **Fix**: schema enum → union in `src/types/index.ts` → `*_LABELS` (Hebrew) + `*_COLORS`/`*_DOT`
  in `src/lib/constants.ts`. In `src/lib/i18n/**`, translate DB-sourced labels by their enum
  value; Hebrew `displayName` stays the source of truth for `he`.

### 8. "This is NOT the Next.js you know" reflex
- **Flag**: use of a Next.js 16 API/convention from memory without checking the local docs.
- **Fix**: read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific
  code; heed deprecation notices. Assume APIs, conventions, and file structure differ from training
  data.

## Output

- Violations found → list each as `path:line — [invariant N] problem → fix`, most severe first.
- Clean → state it plainly and list the invariant numbers you verified against.
