# SmartCase

SmartCase is the foundation of a proactive, multi-tenant SaaS ecosystem for law and consulting firms, spanning 7 core domains — including National Insurance, Guardianship, and Conversion — across medical, legal, and bureaucratic casework. Today it runs as a single-office Hebrew (RTL) CRM live across 2 of those domains (National Insurance disability claims, Conversion): case agents track clients, cases, required documents, and tasks, and use Claude to validate uploaded documents and draft official Hebrew letters.

UI copy, enum labels, and AI prompts are all in Hebrew. See [Documentation](#documentation) for the full map — [CLAUDE.md](CLAUDE.md) for technical specs and engineering invariants, [ROLES.md](ROLES.md) for roles and personas, [CONTRACT.md](CONTRACT.md) for the Team Agent Responsibility Contract (ARC), and [docs/adoption-plan.md](docs/adoption-plan.md) for the multi-agent workflow this repo is developed under.

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: Supabase PostgreSQL via Prisma 7 with the `@prisma/adapter-pg` driver adapter (generated client lives at `src/generated/prisma`, not `node_modules`). Connection URLs are **not** in `schema.prisma` — runtime reads `DATABASE_URL` (pooler is fine) through the adapter, while the CLI reads `DIRECT_URL` (port 5432, not the pooler). There is no `prisma/migrations/` history: schema changes ship via `npm run db:push`, so RLS is never enabled automatically — after adding a model, run [prisma/sql/enable-rls.sql](prisma/sql/enable-rls.sql) manually against Supabase to close off its auto-generated PostgREST/GraphQL API
- **Typed JSON columns**: evolving, AI-shaped payloads are stored as Prisma `Json` rather than flattened into columns — `Case.tags`, `Document.aiValidation`, and the conversion journey's `intake` — because in each case *the shape is the contract*, owned by a Zod/TypeScript schema in application code (e.g. `src/lib/ai/story-intake-schema.ts`). Each such column pairs with explicit status / timestamp fields rather than reusing `updatedAt`, so staleness is answerable
- **Auth**: NextAuth v5 (beta), Credentials provider with bcrypt, JWT sessions, split Edge/Node config
- **AI**: Google Gemini (`@google/genai`, model `gemini-2.5-flash-lite`) for Hebrew document validation and letter drafting; the staff-only assistant chat (`gemini-2.5-flash`) runs all user/tool content through a PII sanitization hook ([src/lib/ai/pii-sanitizer.ts](src/lib/ai/pii-sanitizer.ts)) before it reaches the model
- **UI**: Tailwind CSS v4 + `tailwindcss-rtl`, Radix UI primitives, `react-hook-form` + Zod
- **Validation**: Zod schemas are the contract boundary — authored once and shared across form resolvers, server actions, route handlers, and the typed JSON columns above. Partial-patch mutations get their own schema (e.g. `updateTaskSchema`) so an absent field means "untouched", never "null"
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

### Multi-agent architecture (BMAD + ULTRACODE)

The [BMAD-METHOD](https://github.com/bmad-method) framework is installed under `.claude/skills/` (`bmad-*`), adding agent personas (analyst, architect, PM, dev, UX designer, tech writer, etc.) and workflow skills for planning, spec/PRD authoring, story-driven dev, and adversarial code review — invoked by name (e.g. "talk to Winston") or by skill trigger phrase (e.g. "create a spec", "run a retrospective").

**Subagent routing principles** — how work is allocated across agents on this repo:

- **Contract-first, then fan out.** A schema/spec agent runs to completion and its Zod/TypeScript contract is *frozen* before any implementation agent starts. Parallel agents consume the contract; they never renegotiate it mid-flight. This is what makes concurrent work safe rather than merely fast.
- **One concern per agent.** Roles are narrow and separately evaluated — spec & schema, pure core logic (Ports & Adapters, no I/O), security & RLS audit, adversarial testing. A generalist agent asked to do all four does none of them accountably.
- **Model tier follows task shape.** Architecture and planning route to the strongest reasoning tier; mechanical implementation to a mid tier; deterministic validation gates to the cheapest. Tier is set per-agent, not per-session.
- **Adversarial verification over self-report.** A finding is not accepted because the agent that produced it is confident. Test/security agents hold veto authority on merge, and the quality gate is machine-enforced rather than agent-attested.
- **Escalate, don't guess.** Ambiguity in a contract is surfaced back to a human, not silently resolved — a plausible wrong resolution is more expensive than a blocked branch.

The adoption plan formalizing this workflow — pilot scope, KPIs, risk matrix, and the three governance rules binding agent work here — is in [docs/adoption-plan.md](docs/adoption-plan.md) (see [Documentation](#documentation)).

**Hooks** ([.claude/settings.json](.claude/settings.json)) — an active, multi-layered guardrail system (see [CONTRACT.md](CONTRACT.md) §3):

| Hook | Script | Purpose |
|---|---|---|
| `PreToolUse` (Bash) | [scripts/security-bash-env-check.sh](scripts/security-bash-env-check.sh) | Hard-blocks any Bash command that would read, print, or leak `.env` files or environment secrets |
| `UserPromptSubmit` | [scripts/security-prompt-check.sh](scripts/security-prompt-check.sh) | Scans prompts for pasted secrets before they reach the model |
| `SessionStart` | inline | Announces the current working branch (branching discipline: never work on `main`) |
| `Stop` / `StopFailure` | [.claude/hooks/session-summary.sh](.claude/hooks/session-summary.sh) | Posts an end-of-session summary to Slack |

Permission `allow`/`ask`/`deny` rules are committed alongside the hooks in the same settings file.

**Other automation**:

- [.github/workflows/claude-pr-review-and-fix.yml](.github/workflows/claude-pr-review-and-fix.yml) — Claude Code PR review-and-fix job. **Manual dispatch only** (`workflow_dispatch` with a validated `pr_number`); automatic `pull_request` triggers are deliberately commented out so no PR is ever reviewed-and-mutated without a human initiating it. Run it from the Actions tab or `gh workflow run claude-pr-review-and-fix.yml -f pr_number=<N>`. Pushing fixes back requires write access to the PR head branch, so it only works for PRs from branches within this repo, not forks.

- [scripts/external-code-review.py](scripts/external-code-review.py) — second-opinion review of the current git diff via an **external** provider, printed to stdout and saved as timestamped Markdown under `_bmad-output/reviews/`. Deliberately outside the Claude toolchain: a reviewer from the same model family as the author shares its blind spots.

  | Provider | Default model | Key |
  |---|---|---|
  | `gemini` (default) | `gemini-2.5-flash-lite` | `GEMINI_API_KEY` |
  | `openai` | per `--model` | `OPENAI_API_KEY` |
  | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |

  ```bash
  python3 scripts/external-code-review.py                              # gemini, current diff
  python3 scripts/external-code-review.py --provider openai --model gpt-4o-mini
  ```

  ⚠️ **The diff leaves the machine.** Never run this against changes containing secrets or client PII — this repo handles medical and legal case data, and these providers are not covered by any processing agreement here.
- [scripts/slack-daemon.js](scripts/slack-daemon.js) (`npm run slack-daemon`) — two-way bridge that turns a message in `SLACK_NOTIFY_CHANNEL` into a Claude Code run, with an append-only JSONL event log under `logs/`.

## Documentation

| Document | What it covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Technical specs and the engineering invariants that must not be "modernized" past (Edge middleware, public-portal security model, i18n pattern, no-rasterization printing) |
| [ROLES.md](ROLES.md) | Project roles and personas — the developer, the business stakeholder, and Claude's behavioral guardrails |
| [CONTRACT.md](CONTRACT.md) | Team Agent Responsibility Contract (ARC) governing AI-agent autonomy in this repo |
| [MEMORY.md](MEMORY.md) | Active build-state snapshot, loaded into every session's context |
| [docs/adoption-plan.md](docs/adoption-plan.md) | **Agent Teams adoption plan** — two-page executive plan for the ULTRACODE coordinated multi-agent workflow: pilot scope and boundaries, the four agent roles, a KPI table with six conjunctive exit gates, a 4-week phased rollout, the risk/mitigation matrix, and the three governance rules (no automated DB migrations · 100% quality-gate pass rate · session logging and immutable audit trail) |
| [docs/final-submission.md](docs/final-submission.md) | **Final submission package** — consolidates the shipped engineering slices (staff scheduling & MeetingSlots, task edit & deletion) against the adoption plan, with a verification section recording re-executed quality gates (322/322 tests, clean `tsc --noEmit`, clean lint) |

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
