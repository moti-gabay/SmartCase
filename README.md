# SmartCase

SmartCase is the foundation of a proactive, multi-tenant SaaS ecosystem for law and consulting firms, spanning 7 core domains — including National Insurance, Guardianship, and Conversion — across medical, legal, and bureaucratic casework. Today it runs as a single-office Hebrew (RTL) CRM live across 2 of those domains (National Insurance disability claims, Conversion): case agents track clients, cases, required documents, and tasks, and use Claude to validate uploaded documents and draft official Hebrew letters.

UI copy, enum labels, and AI prompts are all in Hebrew. See [ROLES.md](ROLES.md) for the project roles and personas, [CLAUDE.md](CLAUDE.md) for full technical specs and engineering invariants, and [CONTRACT.md](CONTRACT.md) for the Team Agent Responsibility Contract (ARC) governing AI-agent autonomy in this repo.

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: PostgreSQL via Prisma 7 with the `@prisma/adapter-pg` driver adapter (generated client lives at `src/generated/prisma`, not `node_modules`)
- **Auth**: NextAuth v5 (beta), Credentials provider with bcrypt, JWT sessions, split Edge/Node config
- **AI**: Google Gemini (`@google/genai`, model `gemini-2.5-flash-lite`) for Hebrew document validation and letter drafting; the staff-only assistant chat (`gemini-2.5-flash`) runs all user/tool content through a PII sanitization hook ([src/lib/ai/pii-sanitizer.ts](src/lib/ai/pii-sanitizer.ts)) before it reaches the model
- **UI**: Tailwind CSS v4 + `tailwindcss-rtl`, Radix UI primitives, `react-hook-form` + Zod
- **Email**: Resend, localized per client
- **Printing/PDF**: native browser `window.print()` only — no canvas-rasterization libraries (breaks Hebrew RTL text)
- **Case tagging**: pure client-safe add/remove/filter engine ([src/lib/case-tagger.ts](src/lib/case-tagger.ts)) over a typed tag model ([src/types/case-tags.ts](src/types/case-tags.ts)), with an injectable server-only JSONL audit sink; surfaced in the UI as case badges, filter chips, and an inline tag editor
- **Testing**: Node's built-in runner (`node:test`) via `tsx` — `npm test` covers the pure/deterministic logic (utils, constants integrity, S3 signer, PII sanitizer, chat protocol, i18n locale, journey, case tagger). DB queries, API routes, and React components are covered by manual E2E

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

**Slash commands used during development** — repo-defined commands/skills under `.claude/commands/` and `.claude/skills/`, plus the built-in Claude Code commands this project's workflow leans on:

| Command | Type | Purpose |
|---|---|---|
| `/new-slice <desc>` | repo command ([.claude/commands/new-slice.md](.claude/commands/new-slice.md)) | Scaffolds a vertical feature slice through the canonical file-flow (schema → types → constants → queries → actions → i18n → routes/UI), then runs the validator skill + `npm test`/`npm run build` gate |
| `/review-changes` | repo skill ([.claude/skills/review-changes/](.claude/skills/review-changes/)) | Risk-scored review of a diff via `code-review-graph` — change detection, affected flows, test-coverage gaps |
| `/explore-codebase` | repo skill | Navigates repo structure/relationships using the `code-review-graph` knowledge graph |
| `/debug-issue` | repo skill | Graph-powered root-cause tracing for a bug report |
| `/refactor-safely` | repo skill | Dependency-aware refactor planning before touching shared code |
| `/nextjs16-convention-validator` | repo skill | Checks code against this repo's non-standard Next.js 16 / Prisma 7 / NextAuth v5 invariants (auto-loads on middleware/auth/Prisma/public-portal/printing/RTL changes) |
| `/code-review` | built-in | Multi-angle bug-hunting review of the working diff (this repo's day-to-day PR review) |

`/code-review ultra` (or its alias `/ultrareview`) runs the same review as a billed, multi-agent cloud job — useful before merging riskier changes.

The [BMAD-METHOD](https://github.com/bmad-method) framework is also installed under `.claude/skills/` (`bmad-*`), adding agent personas (analyst, architect, PM, dev, UX designer, tech writer, etc.) and workflow skills for planning, spec/PRD authoring, story-driven dev, and adversarial code review — invoked by name (e.g. "talk to Winston") or by skill trigger phrase (e.g. "create a spec", "run a retrospective").

**Hooks** ([.claude/settings.json](.claude/settings.json)) — an active, multi-layered guardrail system (see [CONTRACT.md](CONTRACT.md) §3):

| Hook | Script | Purpose |
|---|---|---|
| `PreToolUse` (Bash) | [scripts/security-bash-env-check.sh](scripts/security-bash-env-check.sh) | Hard-blocks any Bash command that would read, print, or leak `.env` files or environment secrets |
| `UserPromptSubmit` | [scripts/security-prompt-check.sh](scripts/security-prompt-check.sh) | Scans prompts for pasted secrets before they reach the model |
| `SessionStart` | inline | Announces the current working branch (branching discipline: never work on `main`) |
| `Stop` / `StopFailure` | [.claude/hooks/session-summary.sh](.claude/hooks/session-summary.sh) | Posts an end-of-session summary to Slack |

Permission `allow`/`ask`/`deny` rules are committed alongside the hooks in the same settings file.

**Other automation**:

- [.github/workflows/claude-pr-review-and-fix.yml](.github/workflows/claude-pr-review-and-fix.yml) — Claude Code PR review-and-fix job. **Manual only** (`workflow_dispatch` with a validated `pr_number`); automatic `pull_request` triggers are deliberately commented out. Pushing fixes back requires write access to the PR head branch, so it only works for PRs from branches within this repo, not forks.
- [scripts/external-code-review.py](scripts/external-code-review.py) — second-opinion review of the current git diff via an external model (OpenAI / Gemini / DeepSeek), printed and saved as Markdown. The diff leaves the machine — never run it against changes containing secrets or client PII.
- [scripts/slack-daemon.js](scripts/slack-daemon.js) (`npm run slack-daemon`) — two-way bridge that turns a message in `SLACK_NOTIFY_CHANNEL` into a Claude Code run, with an append-only JSONL event log under `logs/`.

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
npm run db:seed-test  # tsx scripts/create-test-case.ts (single test case, for MCP/dev use)
npm run db:studio     # prisma studio
npm run db:audit      # weekly case-audit CLI
npm run mcp:serve     # run the smartcase MCP server standalone
npm run slack-daemon  # Slack → Claude Code bridge daemon
```
