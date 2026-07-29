import { test } from "node:test";
import assert from "node:assert/strict";

// @ts-ignore -- plain ESM module, no type declarations
import {
  resolveClaudeBin,
  slugify,
  runIdFor,
  branchNameFor,
  parseVerdict,
  findForbiddenPaths,
} from "../scripts/autofix/guards.mjs";

const WINDOWS_SHIM = "/mnt/c/Users/yeder/AppData/Roaming/npm/claude";
const LOCAL_BIN = "/home/moti/.local/bin/claude";

/** Fake executability check: only the listed paths are runnable. */
const only = (...paths: string[]) => ({ isExecutable: (p: string) => paths.includes(p), home: "/home/moti" });

test("resolveClaudeBin prefers CLAUDE_BIN over everything else", () => {
  const env = { CLAUDE_BIN: "/opt/claude", PATH: "/usr/bin", HOME: "/home/moti" };
  const result = resolveClaudeBin(env, only("/opt/claude", LOCAL_BIN));
  assert.equal(result.path, "/opt/claude");
  assert.equal(result.source, "CLAUDE_BIN");
});

test("resolveClaudeBin prefers the local install over a PATH shim", () => {
  // The exact WSL failure this guard exists for: the shim is executable but broken.
  const env = { PATH: "/mnt/c/Users/yeder/AppData/Roaming/npm", HOME: "/home/moti" };
  const result = resolveClaudeBin(env, only(LOCAL_BIN, WINDOWS_SHIM));
  assert.equal(result.path, LOCAL_BIN);
  assert.equal(result.source, "local-install");
});

test("resolveClaudeBin falls back to PATH when no local install exists", () => {
  const env = { PATH: "/usr/local/bin:/usr/bin", HOME: "/home/moti" };
  const result = resolveClaudeBin(env, only("/usr/bin/claude"));
  assert.equal(result.path, "/usr/bin/claude");
  assert.equal(result.source, "PATH");
});

test("resolveClaudeBin reports every candidate it tried when nothing is usable", () => {
  const env = { CLAUDE_BIN: "/nope/claude", PATH: "/usr/bin", HOME: "/home/moti" };
  const result = resolveClaudeBin(env, only());
  assert.equal(result.path, null);
  assert.equal(result.source, null);
  assert.deepEqual(result.tried, ["/nope/claude", LOCAL_BIN, "/usr/bin/claude"]);
});

test("resolveClaudeBin tolerates an unset PATH", () => {
  const result = resolveClaudeBin({ HOME: "/home/moti" }, only(LOCAL_BIN));
  assert.equal(result.path, LOCAL_BIN);
});

test("slugify produces git-ref-safe ASCII", () => {
  assert.equal(slugify("Checkout button is MISALIGNED on mobile!"), "checkout-button-is-misaligned-on");
  assert.equal(slugify("  ...trailing--- "), "trailing");
});

test("slugify falls back for Hebrew and other non-ASCII issue text", () => {
  // Office staff report issues in Hebrew; the slug strips to empty and the run
  // id's hash carries uniqueness instead.
  assert.equal(slugify("כפתור התשלום לא עובד"), "issue");
  assert.equal(slugify(""), "issue");
  assert.equal(slugify(null), "issue");
});

test("slugify neutralises path traversal and ref-breaking characters", () => {
  for (const hostile of ["../../etc/passwd", "a@{b}c", "x..y", "-- ; rm -rf /", "feat/..\\..\\win"]) {
    const slug = slugify(hostile);
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `unsafe slug from ${hostile}: ${slug}`);
  }
});

test("runIdFor is deterministic per issue+timestamp and varies otherwise", () => {
  const a = runIdFor("button broken", "2026-07-29T10:00:00Z");
  assert.equal(a, runIdFor("button broken", "2026-07-29T10:00:00Z"));
  assert.notEqual(a, runIdFor("button broken", "2026-07-29T10:00:01Z"));
  assert.notEqual(a, runIdFor("button fixed", "2026-07-29T10:00:00Z"));
});

test("runIdFor distinguishes Hebrew issues that share an empty slug", () => {
  const a = runIdFor("כפתור התשלום לא עובד", "2026-07-29T10:00:00Z");
  const b = runIdFor("הטופס לא נשלח", "2026-07-29T10:00:00Z");
  assert.notEqual(a, b);
  assert.match(branchNameFor(a), /^fix\/slack-issue-issue-[a-z0-9]+$/);
});

test("branchNameFor yields a valid git ref", () => {
  const branch = branchNameFor(runIdFor("Checkout is broken", "2026-07-29T10:00:00Z"));
  assert.match(branch, /^fix\/slack-issue-[a-z0-9-]+$/);
  assert.ok(!branch.includes(".."));
  assert.ok(!/[~^:?*[\s]/.test(branch));
});

test("parseVerdict reads PASS and FAIL", () => {
  assert.equal(parseVerdict("Looks fine.\n\nVERDICT: PASS"), "PASS");
  assert.equal(parseVerdict("Critical issue found.\n\nVERDICT: FAIL"), "FAIL");
  assert.equal(parseVerdict("**VERDICT:** PASS"), "PASS");
  assert.equal(parseVerdict("verdict: pass"), "PASS");
});

test("parseVerdict takes the last verdict when the rubric is echoed", () => {
  // Models often restate "output VERDICT: PASS or VERDICT: FAIL" before deciding.
  assert.equal(parseVerdict("I must output VERDICT: PASS or VERDICT: FAIL.\n\nVERDICT: FAIL"), "FAIL");
});

test("parseVerdict fails closed on missing or malformed verdicts", () => {
  // UNKNOWN must never be treated as approval by the caller.
  assert.equal(parseVerdict("The plan looks good to me."), "UNKNOWN");
  assert.equal(parseVerdict(""), "UNKNOWN");
  assert.equal(parseVerdict(null), "UNKNOWN");
  assert.equal(parseVerdict("VERDICT: MAYBE"), "UNKNOWN");
  assert.equal(parseVerdict("Findings...\n\nVERDI"), "UNKNOWN");
});

test("findForbiddenPaths flags secrets, CI, agent config, and RLS SQL", () => {
  const findings = findForbiddenPaths([
    "src/lib/utils.ts",
    ".env",
    ".env.local",
    ".github/workflows/review.yml",
    ".claude/settings.json",
    "prisma/sql/enable-rls.sql",
  ]);
  assert.deepEqual(
    findings.map((f: { path: string }) => f.path),
    [".env", ".env.local", ".github/workflows/review.yml", ".claude/settings.json", "prisma/sql/enable-rls.sql"]
  );
});

test("findForbiddenPaths catches nested env files and ./ prefixes", () => {
  const findings = findForbiddenPaths(["./.env.production", "config/.env.staging"]);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f: { reason: string }) => f.reason === "env file"));
});

test("findForbiddenPaths returns empty for a clean change set", () => {
  assert.deepEqual(findForbiddenPaths(["src/app/page.tsx", "tests/utils.test.ts"]), []);
  assert.deepEqual(findForbiddenPaths([]), []);
  assert.deepEqual(findForbiddenPaths(undefined), []);
});

test("findForbiddenPaths does not flag lookalike safe paths", () => {
  // .environment/ and .githubby/ are not the protected paths.
  assert.deepEqual(findForbiddenPaths(["src/.claude/settings.json", "docs/github/ci.md"]), []);
});
