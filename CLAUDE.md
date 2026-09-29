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

## Claude Code tooling (MCP / Skills / Commands)

Team-shared, committed at repo level. Secrets are **never** committed — `.mcp.json` uses `${ENV}` placeholders expanded from the environment at launch.

- **MCP servers** ([.mcp.json](.mcp.json)):
  - `github` — hosted MCP (`https://api.githubcopilot.com/mcp/`), auth'd via `Bearer ${GITHUB_PAT}` (fine-grained PAT, repo scope). No local process.
  - `postgres` — `@modelcontextprotocol/server-postgres` against `${DATABASE_URL}` (pooler URL is fine, read-only). That reference server is in maintenance mode; `crystaldba/postgres-mcp` is the upgrade path if you want EXPLAIN / index-health analysis for the Prisma perf work.
  - `playwright` — official `@playwright/mcp`, drives a real browser for the Hebrew/RTL public-portal E2E (no `@playwright/test` dep added).
  - `context7` — hosted Upstash MCP (`https://mcp.context7.com/mcp`), keyless. Serves up-to-date library docs (Next.js 16, Prisma 7, NextAuth v5) — the antidote to the "This is NOT the Next.js you know" drift. Add `CONTEXT7_API_KEY` via an `Authorization: Bearer` header for higher rate limits.
  - `slack` — `@modelcontextprotocol/server-slack` via npx, auth'd via `${SLACK_BOT_TOKEN}`/`${SLACK_TEAM_ID}` (bot token from a Slack app, scopes: `channels:history`, `channels:read`, `chat:write`, `reactions:write`, `users:read`, `users.profile:read`). Upstream package is archived/deprecated (Slack now ships its own hosted MCP at `mcp.slack.com`, which needs a registered OAuth app instead of a bot token) — kept here for the simpler token-based setup; revisit if it stops working.
  - `code-review-graph` — local `code-review-graph serve` (stdio), no auth. Builds an incremental Tree-sitter knowledge graph of the repo for token-efficient, context-aware code reviews and impact analysis.
- **Skill** `nextjs16-convention-validator` ([.claude/skills/](.claude/skills/nextjs16-convention-validator/SKILL.md)) — auto-loads when editing/reviewing invariant-touching code (middleware, auth, Prisma, public portal, printing, RTL, enum→i18n) and reports violations against the invariants below.
- **Command** `/new-slice <desc>` ([.claude/commands/new-slice.md](.claude/commands/new-slice.md)) — scaffolds a vertical feature slice through the canonical file-flow (schema → types → constants → queries → actions → i18n → routes/UI), runs the validator skill, then the `npm test` + `npm run build` gate.

## Structural Knowledge Graph (Graphify)

An AST-derived graph of the repo in `graphify-out/` (gitignored) — nodes are files/functions/types, edges are `calls`/`imports`/`contains`/`references`. Code extraction is deterministic Tree-sitter parsing with **no LLM and no API key**; only docs/papers/images would need one, and those are not worth extracting here. `graphify` is a local dev tool installed via `pip install graphifyy` — **not** a repo dependency, and nothing in `npm run build` or the test suite depends on it.

### Primary use cases — consult the graph *before* editing when

- Performing multi-file refactoring, or tracing a cross-cutting invariant through the files that enforce it.
- Analyzing blast radius — who calls a function or imports a module (inbound/outbound edges) before you change its signature or behavior.
- Auditing a security-critical function, or checking God Nodes and coupling gaps. This is how the `resolvePortalToken` chokepoint was confirmed to be the sole identity resolver across all 10 public-portal routes (invariant 2 below), structurally rather than by convention.
- Investigating test-coverage gaps: a high-fan-out module with no paired `tests/<name>.test.ts` is the signal. `src/lib/actions.ts` was found and closed this way.

### Execution protocol

The `graphify` binary is usually not on `PATH` — always invoke through the Python module.

```bash
python3 -m graphify query "who calls requireAdmin"   # BFS traversal from matched nodes
python3 -m graphify explain "resolvePortalToken"     # one node, its neighbors, edge directions
python3 -m graphify affected "resolvePortalToken"    # reverse traversal — blast radius
python3 -m graphify update .                         # rebuild after code changes
```

`update .` is the rebuild command. A bare `python3 -m graphify .` is **not** a valid subcommand and exits 1. Rebuild after any structural change — the graph is a snapshot, and a stale one is worse than none because it answers confidently from deleted code.

Two known rough edges: the graph exceeds the 5,000-node HTML limit, so `graph.html` is skipped unless you pass `--no-viz` or raise `GRAPHIFY_VIZ_NODE_LIMIT`; and `.sql` files contribute nothing without `pip install 'graphifyy[sql]'`, which means **[prisma/sql/enable-rls.sql](prisma/sql/enable-rls.sql) is invisible to the graph** — never treat a graph query as evidence about RLS coverage.

### Context-efficiency invariant

Prefer `graphify query` / `affected` over broad `grep -r` sweeps when the question is *structural* ("what calls this", "what breaks if I change this", "what is coupled to this"). The graph returns resolved call edges with `file:line`, which costs a fraction of the context of a recursive grep and does not invite guessing at file layout from partial matches.

This is a preference, not a prohibition. `grep` remains correct for string-literal questions the AST does not model — Hebrew UI copy, enum label text, env var names, config keys — and for any file type the extractor skips. When the two disagree, **the code wins**: verify a graph claim by opening the cited `file:line` before acting on it.

## Slack Instructions Workflow

1. **Slack command reader** — at the start of every session, or whenever asked to "check Slack," use the `slack` MCP tool (`mcp__slack__slack_get_channel_history`) to read the latest messages from the channel configured in `SLACK_NOTIFY_CHANNEL`. If the latest message contains a task, instruction, or feedback from the user, treat it as the session's main objective and execute it.
2. **Closing the loop** — continue sending the end-of-session summary as already configured via the `Stop`/`StopFailure` hooks in [.claude/settings.json](.claude/settings.json), which run [.claude/hooks/session-summary.sh](.claude/hooks/session-summary.sh).

## Architecture

### Prisma 7 + driver adapter (non-standard setup)
Prisma is generated to `src/generated/prisma` (not `node_modules`), imported via the `@/generated/prisma/client` alias. This directory is gitignored and must be regenerated after any schema change or fresh checkout — `predev` and `build` run `prisma generate` automatically, but other entrypoints (e.g. `tsx`) do not. `@ts-ignore` comments on these imports are expected until generation runs.

Connection URLs are **not** in [prisma/schema.prisma](prisma/schema.prisma) (Prisma 7 removed runtime `url`):
- **Runtime**: [src/lib/prisma.ts](src/lib/prisma.ts) constructs a `PrismaPg` adapter from `DATABASE_URL` (pooler is fine). Import the singleton `prisma` from here — never `new PrismaClient()`.
- **CLI/migrations**: [prisma.config.ts](prisma.config.ts) reads `DIRECT_URL` (fall back `DATABASE_URL`). Point `DIRECT_URL` at the direct 5432 connection, not the pooler.

There is no `prisma/migrations/` history — schema changes are pushed with `npm run db:push`, not `prisma migrate dev`. Because of this, RLS (Row Level Security) is **not** managed by Prisma's schema DSL and will never be enabled automatically. After adding any new model, manually run [prisma/sql/enable-rls.sql](prisma/sql/enable-rls.sql) (updated with the new table) against Supabase. The app's own queries are unaffected — `DATABASE_URL` connects as the table owner, which bypasses RLS by default — this only closes off Supabase's auto-generated PostgREST/GraphQL API from anonymous access.

### Auth — the three-file NextAuth v5 split
NextAuth is split so the Edge middleware never imports Node-only code:
- [auth.config.ts](auth.config.ts) — Edge-safe: route-protection `authorized` callback and `pages`, no Prisma/bcrypt. Protected prefixes: `/dashboard`, `/cases`, `/clients`.
- [auth.ts](auth.ts) — Node-only full config: Credentials provider (bcrypt + Prisma lookup), JWT strategy, and `jwt`/`session` callbacks that thread `id` and `role` onto the session.
- [middleware.ts](middleware.ts) — Edge runtime, imports only `auth.config.ts`.

**Do not import [auth.ts](auth.ts) or [src/lib/prisma.ts](src/lib/prisma.ts) from middleware or `auth.config.ts`.** `session.user.role` / `.id` are typed in [src/types/next-auth.d.ts](src/types/next-auth.d.ts).

### AI integration (Google Gemini)
[src/lib/ai/gemini.ts](src/lib/ai/gemini.ts) lazily initializes the `@google/genai` client (so the module loads without `GEMINI_API_KEY` in dev) and uses model `gemini-2.5-flash-lite`. Functions: `analyzeDocument` (image/PDF → Hebrew JSON validation), `generateHebrewLetter`, and `refineHebrewLetter` (chat-style edits). All letter output is forced to plain text via prompt + a `stripMarkdown` sanitizer. AI API routes live under `src/app/api/ai/**` and get a 60s/1GB budget in [vercel.json](vercel.json).

### AI assistant chat (staff-only, HITL actions)
`POST /api/ai/chat` ([src/app/api/ai/chat/route.ts](src/app/api/ai/chat/route.ts)) streams answers over hand-rolled SSE using `gemini-2.5-flash` (the other AI features stay on `flash-lite`) with a manual function-calling loop against a fixed, read-only tool set in [src/lib/ai/assistant-tools.ts](src/lib/ai/assistant-tools.ts) — never a SQL tool. History persists per-user in the `Conversation`/`ChatMessage` models (one rolling conversation; "שיחה חדשה" starts a fresh row). Mutations go through a Human-in-the-Loop action layer in [src/lib/ai/tools/](src/lib/ai/tools/registry.ts): a mutating tool call only *proposes* — it resolves human identifiers to ids server-side, persists an `AI_ACTION_PROPOSED` `AuditLog` row, and streams a `proposal` SSE event rendered as a confirmation card. `POST /api/ai/actions/execute` takes **only `{ intentId, decision }`**, reloads the persisted params, claims the decision once under a per-intent advisory lock, re-checks RBAC against the current role, and appends `APPROVED`/`EXECUTED`/`FAILED`/`CANCELLED`/`DENIED` audit rows. Add a domain by exporting `ActionDefinition[]` from a `*-tools.ts` file and spreading it into `ACTIONS` in the registry; execute through the same code path the UI uses. Live Voice Mode stays read-only (no action declarations) until it has card UI.
**When you ship a feature or route, update [src/lib/ai/assistant-knowledge.ts](src/lib/ai/assistant-knowledge.ts)** — it is the assistant's only grounding for "where do I find X" questions, and stale content there means either a hallucinated answer or a false "I don't know."

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
