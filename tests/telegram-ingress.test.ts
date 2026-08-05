import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractCaseReference,
  extractMessage,
  isAuthorized,
  isKnownCommand,
  normalizeId,
  parseIntent,
  parsePluginId,
  KNOWN_COMMANDS,
  type TelegramUpdate,
} from "../scripts/telegram/guards";
import {
  formatMissingPluginId,
  formatPluginToggle,
  formatStatus,
  formatTestResult,
  formatUnknownCommand,
  parseTestSummary,
  truncateForTelegram,
  HELP_TEXT,
  TELEGRAM_MAX_MESSAGE,
} from "../scripts/telegram/responses";
import {
  createMemoryStateStore,
  disablePlugin,
  enablePlugin,
  listPlugins,
} from "../src/lib/plugins/marketplace/service";

const OWNER_CHAT = "123456789";
const OTHER_CHAT = "987654321";

function update(overrides: Record<string, unknown> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1700000000,
      text: "/status",
      chat: { id: Number(OWNER_CHAT), type: "private" },
      from: { id: Number(OWNER_CHAT), is_bot: false },
      ...overrides,
    },
  };
}

// ── Identity normalisation ───────────────────────────────────────────────────

test("normalizeId bridges Telegram's numeric ids and the string env var", () => {
  assert.equal(normalizeId(123456789), "123456789");
  assert.equal(normalizeId(" 123456789 "), "123456789");
  assert.equal(normalizeId(null), "");
  assert.equal(normalizeId(undefined), "");
  assert.equal(normalizeId(NaN), "");
  assert.equal(normalizeId({}), "");
});

// ── Authentication guard ─────────────────────────────────────────────────────

test("isAuthorized accepts the configured chat, numeric or string", () => {
  assert.equal(isAuthorized(update(), OWNER_CHAT), true);
  assert.equal(isAuthorized(update(), Number(OWNER_CHAT) as unknown as string), true);
});

test("isAuthorized rejects every other chat", () => {
  const foreign = update({ chat: { id: Number(OTHER_CHAT) }, from: { id: Number(OTHER_CHAT) } });
  assert.equal(isAuthorized(foreign, OWNER_CHAT), false);
});

test("isAuthorized fails closed when TELEGRAM_CHAT_ID is unset", () => {
  // SECURITY: an unset chat id must mean "nobody", never "every chat".
  for (const allowed of ["", "   ", null, undefined]) {
    assert.equal(isAuthorized(update(), allowed), false);
  }
});

test("isAuthorized rejects messages from other bots even in the owner chat", () => {
  const fromBot = update({ from: { id: Number(OWNER_CHAT), is_bot: true } });
  assert.equal(isAuthorized(fromBot, OWNER_CHAT), false);
});

test("isAuthorized rejects malformed and non-message updates", () => {
  assert.equal(isAuthorized(null, OWNER_CHAT), false);
  assert.equal(isAuthorized({}, OWNER_CHAT), false);
  assert.equal(isAuthorized({ edited_message: { text: "/run-tests" } }, OWNER_CHAT), false);
  assert.equal(isAuthorized(update({ text: undefined }), OWNER_CHAT), false);
  assert.equal(isAuthorized(update({ chat: undefined }), OWNER_CHAT), false);
});

test("extractMessage ignores edited_message so a processed command cannot be rewritten", () => {
  assert.equal(extractMessage({ edited_message: { text: "/run-tests", chat: { id: 1 } } }), null);
});

test("extractMessage returns normalised fields for a real message", () => {
  const parsed = extractMessage(update({ text: "  סכם את התיק  " }));
  assert.ok(parsed);
  assert.equal(parsed.chatId, OWNER_CHAT);
  assert.equal(parsed.text, "סכם את התיק");
  assert.equal(parsed.messageId, 10);
});

// ── Command parsing ──────────────────────────────────────────────────────────

test("parseIntent recognises the known commands", () => {
  for (const name of KNOWN_COMMANDS) {
    const intent = parseIntent(`/${name}`);
    assert.equal(intent.kind, "command");
    assert.equal(intent.kind === "command" && intent.name, name);
    assert.ok(isKnownCommand(name));
  }
});

test("parseIntent strips the @botname suffix Telegram adds in groups", () => {
  const intent = parseIntent("/status@smartcase_bot");
  assert.equal(intent.kind === "command" && intent.name, "status");
});

test("parseIntent lowercases the command but preserves the argument tail verbatim", () => {
  const intent = parseIntent("/Status  SC-2026-00123  שלום");
  assert.equal(intent.kind === "command" && intent.name, "status");
  assert.equal(intent.kind === "command" && intent.args, "SC-2026-00123  שלום");
});

test("parseIntent treats non-slash text as a natural-language task", () => {
  const intent = parseIntent("סכם את תיק SC-2026-00123");
  assert.equal(intent.kind, "natural");
  assert.equal(intent.kind === "natural" && intent.text, "סכם את תיק SC-2026-00123");
});

test("parseIntent reports empty for blank input", () => {
  for (const raw of ["", "   ", null, undefined, "/"]) {
    assert.equal(parseIntent(raw).kind, "empty");
  }
});

test("isKnownCommand rejects anything unlisted", () => {
  assert.equal(isKnownCommand("deploy"), false);
  assert.equal(isKnownCommand("drop-database"), false);
});

// ── /enable and /disable ─────────────────────────────────────────────────────

test("parseIntent splits /enable and /disable into the command and the plugin id", () => {
  for (const command of ["enable", "disable"] as const) {
    const intent = parseIntent(`/${command}@smartcase_bot  Slack `);
    assert.equal(intent.kind, "command");
    assert.equal(intent.kind === "command" && intent.name, command);
    assert.equal(parsePluginId(intent.kind === "command" ? intent.args : ""), "slack");
  }
});

test("parsePluginId lowercases a single well-formed id", () => {
  assert.equal(parsePluginId("openai"), "openai");
  assert.equal(parsePluginId("  Telegram  "), "telegram");
  assert.equal(parsePluginId("some-plugin-2"), "some-plugin-2");
});

test("parsePluginId rejects missing, malformed and multi-token arguments", () => {
  for (const args of ["", "   ", null, undefined, "slack openai", "slack;drop", "../etc", "שלום"]) {
    assert.equal(parsePluginId(args), null, `expected null for ${JSON.stringify(args)}`);
  }
});

test("formatMissingPluginId names the command it is coaching", () => {
  assert.match(formatMissingPluginId("disable"), /\/disable slack/);
});

test("formatPluginToggle distinguishes on from off", () => {
  assert.match(formatPluginToggle("slack", true), /🟢/);
  assert.match(formatPluginToggle("slack", false), /⚪/);
});

test("/enable and /disable drive the marketplace state the /plugins view reports", async () => {
  const store = createMemoryStateStore();
  const env = { NOTIFICATION_PROVIDER: "telegram", AI_PROVIDER: "anthropic" };
  const stateOf = async (id: string) =>
    (await listPlugins({ store, env })).find((plugin) => plugin.manifest.id === id);

  await enablePlugin("slack", { store });
  assert.equal((await stateOf("slack"))?.isEnabled, true);

  // A DB row wins over the env default — that is what makes /disable effective
  // on a plugin the deployment turned on.
  await disablePlugin("telegram", { store });
  assert.equal((await stateOf("telegram"))?.isEnabled, false);
});

test("enabling an unknown plugin id throws instead of writing a dangling row", async () => {
  const store = createMemoryStateStore();
  await assert.rejects(() => enablePlugin("not-a-plugin", { store }), /Unknown plugin/);
  assert.deepEqual(await store.list(), []);
});

// ── Case reference extraction ────────────────────────────────────────────────

test("extractCaseReference finds the canonical case number and upcases it", () => {
  assert.equal(extractCaseReference("סכם את תיק sc-2026-00123 בבקשה"), "SC-2026-00123");
});

test("extractCaseReference finds a cuid — ids in this schema are cuid, not UUID", () => {
  const id = "clx8h2k9a0000qwer1234tyui";
  assert.equal(extractCaseReference(`summarize ${id}`), id);
});

test("extractCaseReference falls back to a bare #number", () => {
  assert.equal(extractCaseReference("Summarize case #123"), "123");
  assert.equal(extractCaseReference("תיק 42"), "42");
});

test("extractCaseReference returns null when nothing is referenced", () => {
  assert.equal(extractCaseReference("מה מצב המשרד?"), null);
  assert.equal(extractCaseReference(""), null);
});

// ── Response generation ──────────────────────────────────────────────────────

test("truncateForTelegram keeps short text intact", () => {
  assert.equal(truncateForTelegram("שלום"), "שלום");
});

test("truncateForTelegram caps at the 4096-char API limit", () => {
  const output = truncateForTelegram("x".repeat(9000));
  assert.ok(output.length <= TELEGRAM_MAX_MESSAGE);
  assert.ok(output.endsWith("(truncated)"));
});

test("formatStatus renders a clean tree and a dirty one differently", () => {
  const clean = formatStatus({ branch: "main", lastCommit: "9bd0ece feat: x", dirtyFiles: 0 });
  assert.match(clean, /branch: main/);
  assert.match(clean, /tree: clean/);

  const dirty = formatStatus({ branch: "feature/x", lastCommit: "abc123 wip", dirtyFiles: 3 });
  assert.match(dirty, /3 uncommitted file\(s\)/);
});

test("parseTestSummary reads the node:test counter block", () => {
  const output = [
    "✔ some passing test (1.2ms)",
    "ℹ tests 397",
    "ℹ suites 0",
    "ℹ pass 397",
    "ℹ fail 0",
    "ℹ skipped 0",
  ].join("\n");

  const summary = parseTestSummary(output);
  assert.deepEqual(summary, { pass: 397, fail: 0, skipped: 0, total: 397 });
});

test("parseTestSummary does not count the words pass/fail inside test names", () => {
  const output = ["✔ pass 999 things when the fail 999 path is hit", "ℹ pass 2", "ℹ fail 1", "ℹ tests 3"].join("\n");
  const summary = parseTestSummary(output);
  assert.equal(summary?.pass, 2);
  assert.equal(summary?.fail, 1);
});

test("parseTestSummary returns null for a crashed run rather than implying zero failures", () => {
  assert.equal(parseTestSummary("Segmentation fault"), null);
  assert.equal(parseTestSummary(""), null);
  assert.equal(parseTestSummary(null), null);
});

test("formatTestResult reports success only when the suite and the exit code agree", () => {
  const green = formatTestResult({ pass: 397, fail: 0, skipped: 0, total: 397 }, 0);
  assert.match(green, /✅/);
  assert.match(green, /pass: 397\/397/);

  // A zero-failure summary with a non-zero exit is a broken run, not a pass.
  const mismatch = formatTestResult({ pass: 397, fail: 0, skipped: 0, total: 397 }, 1);
  assert.match(mismatch, /❌/);
});

test("formatTestResult surfaces failures with the captured tail", () => {
  const red = formatTestResult({ pass: 390, fail: 7, skipped: 0, total: 397 }, 1, "AssertionError: nope");
  assert.match(red, /❌/);
  assert.match(red, /fail: 7/);
  assert.match(red, /AssertionError: nope/);
});

test("formatTestResult flags a missing summary instead of claiming a pass", () => {
  const output = formatTestResult(null, 137, "Killed");
  assert.match(output, /❌/);
  assert.match(output, /exit code: 137/);
});

test("formatUnknownCommand names the command and includes the help text", () => {
  const output = formatUnknownCommand("deploy");
  assert.match(output, /\/deploy/);
  assert.ok(output.includes(HELP_TEXT));
});

test("HELP_TEXT lists every known command and states the read-only boundary", () => {
  for (const name of KNOWN_COMMANDS) {
    assert.ok(HELP_TEXT.includes(`/${name}`), `help text is missing /${name}`);
  }
  assert.match(HELP_TEXT, /לקריאה בלבד/);
});
