# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

SmartCase is a Hebrew (RTL) CRM for managing Israeli National Insurance (ביטוח לאומי) disability claims. Case agents track clients, cases, required documents, tasks, and use Claude to validate uploaded documents and draft official Hebrew letters. UI copy, enum labels, and AI prompts are all in Hebrew.

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

There is no test runner configured.

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
