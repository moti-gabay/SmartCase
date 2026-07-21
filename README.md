# SmartCase

SmartCase is the foundation of a proactive, multi-tenant SaaS ecosystem for law and consulting firms, spanning 7 core domains — including National Insurance, Guardianship, and Conversion — across medical, legal, and bureaucratic casework. Today it runs as a single-office Hebrew (RTL) CRM live across 2 of those domains (National Insurance disability claims, Conversion): case agents track clients, cases, required documents, and tasks, and use Claude to validate uploaded documents and draft official Hebrew letters.

UI copy, enum labels, and AI prompts are all in Hebrew. See [ROLES.md](ROLES.md) for the project roles and personas, and [CLAUDE.md](CLAUDE.md) for full technical specs and engineering invariants.

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: PostgreSQL via Prisma 7 with the `@prisma/adapter-pg` driver adapter (generated client lives at `src/generated/prisma`, not `node_modules`)
- **Auth**: NextAuth v5 (beta), Credentials provider with bcrypt, JWT sessions, split Edge/Node config
- **AI**: Google Gemini (`@google/genai`, model `gemini-2.5-flash-lite`) for Hebrew document validation and letter drafting
- **UI**: Tailwind CSS v4 + `tailwindcss-rtl`, Radix UI primitives, `react-hook-form` + Zod
- **Email**: Resend, localized per client
- **Printing/PDF**: native browser `window.print()` only — no canvas-rasterization libraries (breaks Hebrew RTL text)

## Claude Code tooling (MCP / Skills / Commands)

Team-shared, committed at repo level. Secrets are **never** committed — `.mcp.json` uses `${ENV}` placeholders expanded from the environment at launch (see `.env.example`).

**MCP servers** ([.mcp.json](.mcp.json)):

| Server | Purpose |
|---|---|
| `github` | Hosted GitHub MCP — issues, PRs, code search |
| `postgres` | Read-only queries against the app database (pooler URL) |
| `playwright` | Real-browser E2E, used for the Hebrew/RTL public-portal flows |
| `context7` | Up-to-date library docs (Next.js 16, Prisma 7, NextAuth v5) — keyless |
| `smartcase` | In-repo custom MCP server ([scripts/mcp/server.ts](scripts/mcp/server.ts)) for live DB diagnostics and test-case generation |
| `slack` | Team Slack — channel history, posting, reactions |
| `code-review-graph` | Local knowledge-graph server powering the review/refactor/debug skills below |

**Skills** ([.claude/skills/](.claude/skills/)): `review-changes`, `explore-codebase`, `debug-issue`, `refactor-safely`, `nextjs16-convention-validator` (validates code against this repo's non-standard Next.js 16 / Prisma 7 / NextAuth v5 invariants).

**Commands**: `/new-slice <desc>` ([.claude/commands/new-slice.md](.claude/commands/new-slice.md)) scaffolds a vertical feature slice through the canonical file-flow (schema → types → constants → queries → actions → i18n → routes/UI).

## Getting started

Install dependencies (requires `--legacy-peer-deps`, see [.npmrc](.npmrc)):

```bash
npm install --legacy-peer-deps
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`/`DIRECT_URL` (Prisma 7 no longer reads connection URLs from `schema.prisma`) plus any AI/email/MCP secrets you need.

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run dev          # prisma generate (predev) then next dev
npm run build         # prisma generate then next build
npm run lint          # eslint
npm test              # node:test unit tests (tests/*.test.ts)

npm run db:generate   # prisma generate → regenerates src/generated/prisma
npm run db:migrate    # prisma migrate dev
npm run db:push       # prisma db push (no migration file)
npm run db:seed       # tsx prisma/seed.ts
npm run db:studio     # prisma studio
npm run db:audit      # weekly case-audit CLI
npm run mcp:serve     # run the smartcase MCP server standalone
```
