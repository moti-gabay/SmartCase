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
