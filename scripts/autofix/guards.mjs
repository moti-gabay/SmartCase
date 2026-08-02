// Pure decision logic for the autofix orchestrator.
//
// Everything here is deterministic and dependency-injected so it can be unit
// tested without touching the filesystem, git, or the network. The I/O shell
// lives in pipeline.mjs — keep it out of this file.

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Paths a fix branch must never touch.
 *
 * Over-blocking is cheap (the run aborts and a human looks) while under-blocking
 * hands an autonomous agent a privilege-escalation path, so this list is
 * deliberately broader than "files related to the fix". Every entry is here
 * because it either executes code, carries secrets, or gates the verification
 * that decides whether the change is safe to ship:
 *
 *   .claude/**   hook scripts run as shell at the end of the next session
 *   .mcp.json    MCP server definitions + credential placeholders
 *   package.json rewriting the `test` script lets a change approve itself
 *   .github/**   CI runs with repository credentials
 *
 * Matching is case-insensitive: git is case-sensitive but macOS/Windows
 * filesystems are not, so `.ENV` must not slip past a lowercase comparison.
 */
const FORBIDDEN_MATCHERS = [
  { label: "env file", test: (p) => p.split("/").some((seg) => seg.startsWith(".env")) },
  { label: "CI workflow", test: (p) => p === ".github" || p.startsWith(".github/") },
  // Nested too: Claude Code honours directory-scoped .claude/, so a settings or
  // hooks file anywhere in the tree is a live config-injection vector.
  { label: "agent config", test: (p) => p === ".claude" || p.startsWith(".claude/") || p.includes("/.claude/") || p.endsWith("/.claude") },
  { label: "MCP config", test: (p) => p === ".mcp.json" },
  { label: "build/verification config", test: (p) => p === "package.json" || p === "package-lock.json" || p === "vercel.json" },
  { label: "RLS SQL", test: (p) => p.startsWith("prisma/sql/") },
];

const defaultIsExecutable = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve the Claude CLI binary.
 *
 * Order is deliberate: an explicit CLAUDE_BIN wins, then the Linux-native
 * install, and only then $PATH. On WSL $PATH commonly resolves `claude` to the
 * Windows npm shim, which is executable but non-functional — so PATH is the
 * last resort, never the first.
 *
 * @param {Record<string, string|undefined>} [env] only CLAUDE_BIN, PATH and HOME are read
 * @param {{isExecutable?: (p: string) => boolean, home?: string}} [deps]
 * @returns {{path: string|null, source: string|null, tried: string[]}}
 */
export function resolveClaudeBin(env = process.env, deps = {}) {
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const home = deps.home ?? env.HOME ?? homedir();
  const tried = [];

  const candidates = [];
  if (env.CLAUDE_BIN) candidates.push({ path: env.CLAUDE_BIN, source: "CLAUDE_BIN" });
  candidates.push({ path: join(home, ".local", "bin", "claude"), source: "local-install" });
  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) {
    candidates.push({ path: join(dir, "claude"), source: "PATH" });
  }

  for (const candidate of candidates) {
    tried.push(candidate.path);
    if (isExecutable(candidate.path)) return { ...candidate, tried };
  }
  return { path: null, source: null, tried };
}

/**
 * Validate the per-invocation spend ceiling.
 *
 * `Number(process.env.X ?? 2.0)` yields NaN for anything non-numeric, and NaN
 * stringifies to "NaN" — which reaches the CLI as `--max-budget-usd NaN` and
 * either aborts the phase or, worse, is ignored, silently removing the only
 * spend guard. A typo in an env var must not disarm the ceiling, so anything
 * that is not a finite positive number falls back to the default.
 *
 * @returns {{value: number, ok: boolean}} — ok is false when the raw value was rejected.
 */
export function parseBudgetUsd(raw, fallback = 2.0) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { value: fallback, ok: true };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { value: fallback, ok: false };
  return { value, ok: true };
}

/**
 * Parse the envelope emitted by `claude --print --output-format json`.
 *
 * Verified against CLI v2.1.220. The envelope is a single JSON object carrying
 * `result` (the assistant's text), `total_cost_usd`, `subtype`, and
 * `terminal_reason`. Two properties of it drive the design here:
 *
 *   - A **failed** run still emits a full, valid envelope on stdout, with a real
 *     `total_cost_usd`. Budget exhaustion exits 1 but has already spent money,
 *     so the cost must be charged to the run ledger on the failure path too —
 *     charging only on success would let a run exceed its ceiling by repeatedly
 *     failing.
 *   - `total_cost_usd` is the CLI's own accounting, including cache reads and
 *     writes. Do not attempt to re-derive it from `usage` token counts.
 *
 * Fail-soft on shape: a missing or unparseable cost yields `costUsd: null`,
 * which callers must treat as "unknown spend", never as zero.
 *
 * @returns {{ok: boolean, result: string, costUsd: number|null, subtype: string|null,
 *            terminalReason: string|null, numTurns: number|null, errors: string[], parsed: boolean}}
 */
export function parseClaudeResult(stdout) {
  const empty = {
    ok: false,
    result: "",
    costUsd: null,
    subtype: null,
    terminalReason: null,
    numTurns: null,
    errors: [],
    parsed: false,
  };

  const text = String(stdout ?? "").trim();
  if (!text) return empty;

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    // Not JSON at all — a text-format phase, or output the CLI never framed.
    // Surface the raw text so the caller can still use it, but flag it unparsed
    // so no cost is silently assumed.
    return { ...empty, result: text };
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ...empty, result: text };
  }

  const rawCost = envelope.total_cost_usd;
  const costUsd = typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;

  return {
    // is_error is the CLI's own verdict; absent means "no error reported".
    ok: envelope.is_error !== true,
    result: typeof envelope.result === "string" ? envelope.result : "",
    costUsd,
    subtype: typeof envelope.subtype === "string" ? envelope.subtype : null,
    terminalReason: typeof envelope.terminal_reason === "string" ? envelope.terminal_reason : null,
    numTurns: typeof envelope.num_turns === "number" ? envelope.num_turns : null,
    errors: Array.isArray(envelope.errors) ? envelope.errors.filter((e) => typeof e === "string") : [],
    parsed: true,
  };
}

/**
 * Cumulative spend ledger for one autofix run.
 *
 * `--max-budget-usd` is a **per-invocation** ceiling: a run that reaches both the
 * plan and execute phases can spend up to 2× the configured limit, and that is
 * not what an operator setting a $2 budget expects. The ledger makes the limit
 * mean what it says by tracking spend across phases and handing each subsequent
 * invocation only the budget that is actually left.
 *
 * An unknown cost (`null`, i.e. an unparseable envelope) is deliberately charged
 * as `unknownCharges` rather than zero. Treating unknown as free is the failure
 * mode that lets a run quietly blow through its ceiling, so callers can refuse
 * to continue once any spend is unaccounted for.
 */
export function createBudgetLedger(totalUsd, { minPhaseUsd = 0.1 } = {}) {
  let spent = 0;
  let unknownCharges = 0;
  const phases = [];

  return {
    /**
     * @param {number|null} costUsd Charge a phase. null means "spent an unknown amount".
     * @param {string|null} [phase]
     */
    charge(costUsd, phase = null) {
      if (typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0) {
        spent += costUsd;
        phases.push({ phase, costUsd });
      } else {
        unknownCharges += 1;
        phases.push({ phase, costUsd: null });
      }
      return this;
    },
    spent: () => Number(spent.toFixed(6)),
    unknownCharges: () => unknownCharges,
    phases: () => phases.slice(),
    total: () => totalUsd,
    /** Never negative: an overspend reports zero remaining, not a negative ceiling. */
    remaining: () => Number(Math.max(0, totalUsd - spent).toFixed(6)),
    /**
     * Is there enough left to be worth launching another phase?
     *
     * Below the floor the invocation would abort mid-thought and still be
     * billed, so refusing before spawning is both cheaper and clearer than
     * letting the CLI hit its own ceiling.
     *
     * @param {string|null} [phase]
     * @returns {{ok: boolean, remaining: number, reason: string|null}}
     */
    canAfford(phase = null) {
      const remaining = Number(Math.max(0, totalUsd - spent).toFixed(6));
      if (unknownCharges > 0) {
        return {
          ok: false,
          remaining,
          reason: `spend for ${unknownCharges} earlier phase(s) could not be accounted for`,
        };
      }
      if (remaining < minPhaseUsd) {
        return {
          ok: false,
          remaining,
          reason: `only $${remaining} of the $${totalUsd} run budget remains${phase ? ` before ${phase}` : ""} (floor $${minPhaseUsd})`,
        };
      }
      return { ok: true, remaining, reason: null };
    },
  };
}

/**
 * Model tier defaults, one per phase.
 *
 * Deliberately *not* the 3.5-era ids (`claude-3-5-haiku-20241022`,
 * `claude-3-5-sonnet-20241022`): both are retired — Sonnet 3.5 on 2025-10-28 and
 * Haiku 3.5 on 2026-02-19 — and `claude --model` on a retired id fails the phase
 * at launch. These are their current-generation equivalents. Override per run
 * with the CLI flags or the AUTOFIX_*_MODEL env vars if you need a different tier.
 *
 *   triage   cheapest tier — one classification call, no code written
 *   plan     the read-only plan is the contract Phase 3 executes and a human
 *            approves, so it stays on the mid tier rather than the cheap one
 *   execute  writes code under --dangerously-skip-permissions
 */
export const DEFAULT_MODEL_TIERS = Object.freeze({
  triage: "claude-haiku-4-5",
  plan: "claude-sonnet-5",
  execute: "claude-sonnet-5",
});

export const MODEL_TIER_ENV = Object.freeze({
  triage: "AUTOFIX_TRIAGE_MODEL",
  plan: "AUTOFIX_PLAN_MODEL",
  execute: "AUTOFIX_EXEC_MODEL",
});

/**
 * Is `name` safe to hand to `claude --model`?
 *
 * The value can reach us from CI env, so the same argv-injection hazard as
 * `--base-ref` applies: a leading dash is read by the CLI as another option.
 * Beyond that, model ids are `[a-z0-9.-]` by construction — anything else is a
 * typo that would otherwise surface minutes later as an opaque API 404.
 */
export function isValidModelId(name) {
  const id = String(name ?? "");
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

/**
 * Resolve the per-phase model map from defaults ← env ← explicit overrides.
 *
 * Precedence is deliberate: an explicit CLI flag beats the environment, which
 * beats the built-in default. An invalid value is rejected here — before the run
 * id, the artifact directory, or a single paid call — rather than being passed
 * through to fail mid-phase.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {{triage?: string, plan?: string, execute?: string}} [overrides]
 * @returns {{models: {triage: string, plan: string, execute: string}, invalid: Array<{phase: string, value: string, source: string}>}}
 */
export function resolveModelTiers(env = process.env, overrides = {}) {
  const models = {};
  const invalid = [];

  for (const phase of ["triage", "plan", "execute"]) {
    const candidates = [
      { value: overrides[phase], source: `--${phase === "execute" ? "exec" : phase}-model` },
      { value: env[MODEL_TIER_ENV[phase]], source: MODEL_TIER_ENV[phase] },
    ];
    const picked = candidates.find((c) => c.value !== undefined && c.value !== null && String(c.value).trim() !== "");

    if (!picked) {
      models[phase] = DEFAULT_MODEL_TIERS[phase];
      continue;
    }
    const value = String(picked.value).trim();
    if (!isValidModelId(value)) {
      invalid.push({ phase, value, source: picked.source });
      models[phase] = DEFAULT_MODEL_TIERS[phase];
      continue;
    }
    models[phase] = value;
  }

  return { models, invalid };
}

/**
 * Read the Phase 0 triage classification from the FINAL non-empty line.
 *
 * Same last-line anchoring as parseVerdict, and for the same reason: the triage
 * prompt embeds untrusted issue text, and a model routinely echoes the tail of
 * the document it was given.
 *
 * Unlike parseVerdict this fails **open** — UNKNOWN is not NOT_ACTIONABLE.
 * Triage is a cost optimiser, not a safety gate; the real gates are the external
 * plan review and the human approval further down. A garbled classification that
 * silently discarded a genuine bug report would be a far worse failure than one
 * that wastes a planning pass, so callers treat UNKNOWN as "proceed".
 *
 * @returns {'ACTIONABLE'|'NOT_ACTIONABLE'|'UNKNOWN'}
 */
export function parseTriageVerdict(text) {
  const lines = String(text ?? "").split("\n");
  let lastLine = "";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) {
      lastLine = lines[i].trim();
      break;
    }
  }
  if (!lastLine || lastLine.startsWith("```") || lastLine.startsWith(">")) return "UNKNOWN";

  const cleaned = lastLine.replace(/^#{1,6}\s*/, "");
  const match = cleaned.match(/^\**TRIAGE\**\s*:\s*\**\s*(ACTIONABLE|NOT_ACTIONABLE)\**\s*\.?$/i);
  if (!match) return "UNKNOWN";
  return match[1].toUpperCase();
}

/**
 * Defang `TRIAGE:` markers in untrusted issue text before it enters the triage
 * prompt — the counterpart to neutralizeVerdictMarkers for Phase 0. Without it a
 * report ending in `TRIAGE: NOT_ACTIONABLE` can be echoed back as the model's own
 * closing line and abort the run before anyone reads it.
 */
export function neutralizeTriageMarkers(text) {
  return String(text ?? "").replace(/TRIAGE(\s*):/gi, "TRIAGE$1․");
}

/**
 * Extract a branch name from a symbolic ref.
 *
 * `git symbolic-ref refs/remotes/origin/HEAD` yields `refs/remotes/origin/main`;
 * we want just `main`. Returns null for anything unrecognisable so the caller
 * can fall back rather than build a branch name out of garbage.
 */
export function parseDefaultBranchRef(ref) {
  const match = String(ref ?? "").trim().match(/^refs\/remotes\/[^/]+\/(.+)$/);
  return match ? match[1] : null;
}

/**
 * Is `name` safe to hand to git as a branch name?
 *
 * This gates `--base-ref`, whose value reaches the orchestrator from a CI job
 * that derived it from a PR's `headRefName` — i.e. from a branch name an
 * outside contributor chose. Two distinct hazards:
 *
 *   1. Argv injection. A ref beginning with `-` is read by git as an option,
 *      not an operand: `git fetch origin --upload-pack=...` runs a command.
 *      Nothing downstream uses `--` consistently enough to rely on, so the
 *      leading dash is rejected here instead.
 *   2. Ref-name grammar. git-check-ref-format's rules — no `..`, no ` ~^:?*[\`,
 *      no ASCII control characters, no `.lock` suffix, no leading/trailing or
 *      doubled `/`, no trailing dot. An invalid name would fail later anyway,
 *      but as an opaque git error several minutes into a paid run.
 *
 * Returns a boolean rather than throwing so the caller owns the error message.
 */
export function isValidGitRef(name) {
  const ref = String(name ?? "");
  if (!ref || ref.length > 255) return false;
  if (ref.startsWith("-")) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(ref)) return false;
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{")) return false;
  if (ref.startsWith("/") || ref.endsWith("/")) return false;
  if (ref.endsWith(".") || ref.endsWith(".lock")) return false;
  if (ref.split("/").some((segment) => segment.startsWith(".") || segment.endsWith(".lock"))) return false;
  return true;
}

/** FNV-1a 32-bit — small, dependency-free, and stable across runs. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * ASCII-only slug safe for a git ref. Hebrew issue text strips to empty, which
 * is expected — runIdFor appends a hash, so uniqueness never depends on the slug.
 */
export function slugify(text, maxLength = 32) {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "issue";
}

/** Stable per (issue, timestamp) — same inputs always yield the same run. */
export function runIdFor(issueText, nowIso) {
  return `${slugify(issueText)}-${fnv1a(`${issueText} ${nowIso}`)}`;
}

export function branchNameFor(runId) {
  return `fix/slack-issue-${runId}`;
}

/**
 * Read the reviewer's verdict from the FINAL non-empty line only.
 *
 * Anchoring to the last line — rather than the last `VERDICT:` match anywhere in
 * the response — is a security property, not a style choice. The reviewer prompt
 * embeds the audited plan verbatim, and the plan is derived from untrusted issue
 * text. A "last match wins" scan lets a plan ending in `VERDICT: PASS` override a
 * reviewer that actually returned FAIL, because models routinely echo the tail of
 * the document they were given. Only the reviewer's own closing line counts.
 *
 * Fail-closed: anything else — a missing, truncated, fenced, or quoted verdict —
 * returns UNKNOWN, and callers must treat UNKNOWN as FAIL.
 *
 * @returns {'PASS'|'FAIL'|'UNKNOWN'}
 */
export function parseVerdict(reviewMarkdown) {
  const lines = String(reviewMarkdown ?? "").split("\n");
  let lastLine = "";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) {
      lastLine = lines[i].trim();
      break;
    }
  }
  // Reject fenced or quoted lines outright — a verdict inside ``` or > is an
  // illustration or a quotation of the plan, never the reviewer's conclusion.
  if (!lastLine || lastLine.startsWith("```") || lastLine.startsWith(">")) return "UNKNOWN";

  // Tolerate markdown heading markers: reviewers routinely emit "## VERDICT: PASS".
  // This does not weaken either safety property — it is still the final line only,
  // and VERDICT: markers are still defanged in the plan before the reviewer sees
  // it — while a heading prefix alone was turning genuine verdicts into UNKNOWN.
  const cleaned = lastLine.replace(/^#{1,6}\s*/, "");

  const match = cleaned.match(/^\**VERDICT\**\s*:\s*\**\s*(PASS|FAIL)\**\s*\.?$/i);
  if (!match) return "UNKNOWN";
  return match[1].toUpperCase();
}

/**
 * Defang `VERDICT:` markers in text that is about to be embedded in the
 * reviewer's prompt.
 *
 * The plan is derived from untrusted issue text, and reviewers routinely echo
 * the document they were given. Without this, a plan ending in `VERDICT: PASS`
 * can appear as the reviewer's own closing line and flip a real FAIL to PASS —
 * defeating the entire Phase 2 gate. Anchoring the parser to the last line is
 * necessary but not sufficient; the marker must not survive into the prompt at
 * all. The plan.md kept for the human is left pristine — only the reviewer's
 * copy is neutralised.
 */
export function neutralizeVerdictMarkers(text) {
  return String(text ?? "").replace(/VERDICT(\s*):/gi, "VERDICT$1․");
}

/** @returns {Array<{path: string, reason: string}>} — empty means the diff is safe to push. */
export function findForbiddenPaths(changedPaths) {
  const findings = [];
  for (const raw of changedPaths ?? []) {
    const path = String(raw).trim().replace(/^\.\//, "");
    if (!path) continue;
    const probe = path.toLowerCase();
    const hit = FORBIDDEN_MATCHERS.find((matcher) => matcher.test(probe));
    if (hit) findings.push({ path, reason: hit.label });
  }
  return findings;
}

/**
 * Parse `git status --porcelain -z --untracked-files=all` into plain paths.
 *
 * Three porcelain behaviours defeat naive `line.slice(3)` parsing, and each one
 * is a way for a forbidden file to pass the scan unseen:
 *   - untracked directories collapse to `?? dir/` unless -uall is passed
 *   - renames appear as `R  old -> new` (NUL-separated as old\0new with -z)
 *   - non-ASCII paths are octal-escaped and quoted unless core.quotePath=false
 * Caller must pass `-z`, `-uall`, and `-c core.quotePath=false`.
 */
export function parsePorcelainZ(raw) {
  const entries = String(raw ?? "").split("\0").filter(Boolean);
  const paths = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // Rename/copy emits the source path as its own following NUL-delimited
    // field; record both sides so neither end escapes the scan.
    if (status[0] === "R" || status[0] === "C") {
      i += 1;
      if (entries[i]) paths.push(entries[i]);
    }
  }
  return paths;
}
