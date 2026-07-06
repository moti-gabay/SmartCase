# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md
@ROLES.md
@MEMORY.md

## What this is

SmartCase is the foundation of a proactive, multi-tenant SaaS ecosystem for law and consulting firms, spanning 7 core domains — including National Insurance, Guardianship, and Conversion — across medical, legal, and bureaucratic casework. Today it runs as a single-office Hebrew (RTL) CRM live across 2 of those domains (National Insurance disability claims, Conversion); case agents track clients, cases, required documents, and tasks, and use Claude to validate uploaded documents and draft official Hebrew letters. UI copy, enum labels, and AI prompts are all in Hebrew.

See [ROLES.md](ROLES.md) for the project roles & personas (the user, the business stakeholder, and Claude's behavioral guardrails on this project).

## Commands

```bash
npm run dev          # prisma generate (predev) then next dev
npm run build        # prisma generate then next build
npm run lint         # eslint

npm run db:generate  # prisma generate → regenerates src/generated/prisma
npm run db:migrate   # prisma migrate dev
npm run db:push      # prisma db push (no migration file)
npm run db:seed      # tsx prisma/seed.ts
npm run db:studio    # prisma studio
```

Dependencies must be installed with `npm install --legacy-peer-deps` (see [.npmrc](.npmrc)) — `@auth/prisma-adapter` under-declares its Prisma 7 peer range. Vercel uses the same install flag ([vercel.json](vercel.json)).

Unit tests use Node's built-in runner (`node:test`) via `tsx` — no extra deps. Run `npm test` (executes `tests/*.test.ts`). Coverage is the pure/deterministic logic: `src/lib/utils.ts`, the native `src/core/storage/s3-storage.ts` signer, and `src/lib/constants.ts` integrity. DB queries, API routes, and React components are covered by manual E2E, not unit tests.

## Architecture

### Prisma 7 + driver adapter (non-standard setup)
Prisma is generated to `src/generated/prisma` (not `node_modules`), imported via the `@/generated/prisma/client` alias. This directory is gitignored and must be regenerated after any schema change or fresh checkout — `predev` and `build` run `prisma generate` automatically, but other entrypoints (e.g. `tsx`) do not. `@ts-ignore` comments on these imports are expected until generation runs.

Connection URLs are **not** in [prisma/schema.prisma](prisma/schema.prisma) (Prisma 7 removed runtime `url`):
- **Runtime**: [src/lib/prisma.ts](src/lib/prisma.ts) constructs a `PrismaPg` adapter from `DATABASE_URL` (pooler is fine). Import the singleton `prisma` from here — never `new PrismaClient()`.
- **CLI/migrations**: [prisma.config.ts](prisma.config.ts) reads `DIRECT_URL` (fall back `DATABASE_URL`). Point `DIRECT_URL` at the direct 5432 connection, not the pooler.

### Auth — the three-file NextAuth v5 split
NextAuth is split so the Edge middleware never imports Node-only code:
- [auth.config.ts](auth.config.ts) — Edge-safe: route-protection `authorized` callback and `pages`, no Prisma/bcrypt. Protected prefixes: `/dashboard`, `/cases`, `/clients`.
- [auth.ts](auth.ts) — Node-only full config: Credentials provider (bcrypt + Prisma lookup), JWT strategy, and `jwt`/`session` callbacks that thread `id` and `role` onto the session.
- [middleware.ts](middleware.ts) — Edge runtime, imports only `auth.config.ts`.

**Do not import [auth.ts](auth.ts) or [src/lib/prisma.ts](src/lib/prisma.ts) from middleware or `auth.config.ts`.** `session.user.role` / `.id` are typed in [src/types/next-auth.d.ts](src/types/next-auth.d.ts).

### AI integration (Google Gemini)
[src/lib/ai/gemini.ts](src/lib/ai/gemini.ts) lazily initializes the `@google/genai` client (so the module loads without `GEMINI_API_KEY` in dev) and uses model `gemini-2.5-flash-lite`. Functions: `analyzeDocument` (image/PDF → Hebrew JSON validation), `generateHebrewLetter`, and `refineHebrewLetter` (chat-style edits). All letter output is forced to plain text via prompt + a `stripMarkdown` sanitizer. AI API routes live under `src/app/api/ai/**` and get a 60s/1GB budget in [vercel.json](vercel.json).

### UI conventions
- **RTL-first**: root `<html dir="rtl" lang="he">` with the Rubik font; `tailwindcss-rtl` is installed. Use logical properties (`border-e`, `ms-*`, `pe-*`) rather than left/right so RTL flips correctly. In flex layouts, first-in-DOM = right side.
- **Enum → Hebrew labels** live in [src/lib/constants.ts](src/lib/constants.ts) (`CASE_STATUS_LABELS`, `CASE_TYPE_LABELS`, color/dot maps, `PIPELINE_COLUMNS`, etc.). When you add an enum value in the schema, add its label + color entries here and the matching union in [src/types/index.ts](src/types/index.ts).
- Route groups: `src/app/(auth)/` (login/register) and `src/app/(dashboard)/` (app shell with sidebar).

### Data layer status
Dashboard/cases/clients pages currently render from mock data (`src/lib/mock-*.ts`), while the Prisma schema, auth, and register API route are wired to the real database. When building features, prefer moving pages onto `prisma` queries rather than extending the mock files.

## Engineering invariants (do not violate)

These were established deliberately, several after hitting a real bug or running a live adversarial test. Don't "clean up" or "modernize" past them without re-reading why.

### 1. Middleware stays `middleware.ts` (Edge), not `proxy.ts`
[middleware.ts](middleware.ts) (repo root) must keep running on the **Edge runtime** via the `middleware` file convention. **Do not rename/migrate it to Next.js 16's `proxy.ts` convention.** This was tried and reverted in this exact repo: with the current NextAuth v5 beta (`next-auth@^5.0.0-beta.31`), `proxy.ts` was silently **not registered as route-protection at all** — `/dashboard` became publicly reachable with no session (verified: unauth request returned `200` instead of a `307` to `/login`). Revisit only after confirming a `next-auth` version that documents `proxy.ts` support, and re-verify with a real unauthenticated request before trusting it.

### 2. Public portal security model
The pattern behind `/share/conversion/[token]` and `/api/public/conversion/[token]/*` is the template for any future unauthenticated surface:
- **Tokens are bearer secrets, not "encrypted" values**: generate with `crypto.randomBytes(32)` (256-bit), store the raw token directly as a unique DB column, and treat possession of it as sole authorization. Don't reach for field-level encryption on the token — it adds nothing since only the server ever validates it; entropy + expiry + rotate-to-revoke is what actually matters.
- **Every public route resolves `caseId`/`clientId` from the token server-side** (see `resolvePortalToken` in [src/lib/queries.ts](src/lib/queries.ts)) — **never from a client-supplied id in the request body.** This is the specific control that was adversarially tested and confirmed to block cross-case access (a presign request using another case's checklist item id was rejected with 400; a cross-case checklist-link attempt left the foreign case's row untouched).
- **Honeypot**: public forms include an off-screen field named `website` (see `conversion-portal-view.tsx`). If it arrives non-empty, the route rejects with the same generic validation error used for real validation failures (no distinct "bot detected" message) — never skip the check and never make the rejection message identifiable as honeypot-specific.
- **Public-mutation logic lives in the Route Handler itself, not in the shared `"use server"` `src/lib/actions.ts`.** Any file marked `"use server"` turns its exports into network-invokable Server Actions the moment they're imported into a client component — a function that trusts a caller-supplied `caseId`/`clientId` (as an unauthenticated portal submission must) must never risk being wired up that way later. Keep that class of logic in a plain route file under `src/app/api/public/**` where there is no ambiguity about the trust boundary.
- Identity fields (name, national ID) are **read-only** in any public portal — only contact/family fields are client-editable, so a leaked link can never be used to alter the legal identity record.

### 3. i18n dictionary pattern (`src/lib/i18n/`)
Zero-dependency, plain-object dictionaries (see [src/lib/i18n/conversion-portal.ts](src/lib/i18n/conversion-portal.ts)) — no i18n library, no localized routing. Each locale is typed as `typeof he`, so TypeScript fails the build if `en`/`fr` are missing a key. **Translate dynamic, DB-sourced labels (e.g. document checklist names) by their stable enum identifier (`DocumentType`), never by matching/parsing the Hebrew string itself** — the Hebrew `displayName` from the DB remains the source of truth for `he`; `en`/`fr` are a separate lookup keyed off the enum value, so they keep working even if the Hebrew label copy is edited later.

### 4. RTL Hebrew printing/PDF — no rasterization libraries
**Do not install `jsPDF`, `html2pdf.js`, `html2canvas`, or any canvas-rasterization PDF library for Hebrew content.** They render through a re-rasterized DOM snapshot that has well-documented breakage with RTL text, Hebrew ligatures, and custom web fonts — exactly what this app is. Always use the native browser print pipeline instead: `src/lib/print.ts`'s `printSection(target)` tags `<body data-print-target>` and calls `window.print()`; `globals.css` scopes visibility to `.print-summary` / `.print-letter` (two distinct classes, not one shared class, because both regions can be mounted in the DOM simultaneously and a shared class would print them stacked on top of each other); `PrintLetterhead` supplies the branded, print-only header. A "Download PDF" button means "trigger a correctly-scoped `window.print()`," not "render to canvas and serialize a PDF client-side."
