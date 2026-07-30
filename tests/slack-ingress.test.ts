import { test } from "node:test";
import assert from "node:assert/strict";

// @ts-ignore -- plain ESM modules, no type declarations
import {
  parseAllowlist,
  isAllowed,
  extractIssueText,
  classifyReply,
  classifyReaction,
  shouldTrigger,
  missingScopes,
  missingOptionalScopes,
  REQUIRED_SCOPES,
} from "../scripts/slack/guards.mjs";
// @ts-ignore -- plain ESM module, no type declarations
import { createApprovalRegistry } from "../scripts/slack/approvals.mjs";

const BOT = "U0BLAGG25QA";
const OWNER = "U0BJQM1TC2D";
const OUTSIDER = "U0DEADBEEF";
const ALLOW = parseAllowlist(OWNER);

test("parseAllowlist accepts raw ids, mention syntax, and mixed separators", () => {
  const list = parseAllowlist(`<@${OWNER}>, U0ABCDEF123  U0FFFFFFFF`);
  assert.equal(list.size, 3);
  assert.ok(list.has(OWNER));
  assert.ok(list.has("U0ABCDEF123"));
});

test("parseAllowlist is case-insensitive", () => {
  assert.ok(parseAllowlist("u0bjqm1tc2d").has(OWNER));
});

test("parseAllowlist fails closed on empty input", () => {
  // SECURITY: an unset allowlist must mean "nobody", never "everybody".
  for (const raw of ["", "   ", ",, ,", null, undefined]) {
    assert.equal(parseAllowlist(raw).size, 0);
    assert.equal(isAllowed(OWNER, parseAllowlist(raw)), false);
  }
});

test("isAllowed rejects unknown users and missing ids", () => {
  assert.equal(isAllowed(OWNER, ALLOW), true);
  assert.equal(isAllowed(OUTSIDER, ALLOW), false);
  assert.equal(isAllowed(undefined, ALLOW), false);
  assert.equal(isAllowed(OWNER, null), false);
});

test("extractIssueText strips bot mentions anywhere in the message", () => {
  assert.equal(extractIssueText(`<@${BOT}> the tag filter is broken`, BOT), "the tag filter is broken");
  assert.equal(extractIssueText(`hey <@${BOT}> please look at the portal`, BOT), "hey please look at the portal");
  assert.equal(extractIssueText(`<@${BOT}|smartcase> fix it`, BOT), "fix it");
});

test("extractIssueText preserves Hebrew and unescapes Slack entities", () => {
  assert.equal(extractIssueText(`<@${BOT}> כפתור התשלום לא עובד`, BOT), "כפתור התשלום לא עובד");
  assert.equal(extractIssueText(`<@${BOT}> a &amp; b &lt;tag&gt;`, BOT), "a & b <tag>");
});

test("extractIssueText returns empty for a bare mention", () => {
  assert.equal(extractIssueText(`<@${BOT}>`, BOT), "");
  assert.equal(extractIssueText(`  <@${BOT}>   `, BOT), "");
  assert.equal(extractIssueText(null, BOT), "");
});

test("classifyReply understands Hebrew and English decisions", () => {
  for (const yes of ["אישור", "מאושר", "approve", "yes", "y", "OK"]) assert.equal(classifyReply(yes), "approve", yes);
  for (const no of ["דחייה", "לא", "deny", "reject", "cancel", "n"]) assert.equal(classifyReply(no), "deny", no);
});

test("classifyReply returns null for ordinary chatter", () => {
  // Ordinary thread talk must not be read as consent.
  for (const text of ["", "  ", "looks interesting", "מה קורה", null]) {
    assert.equal(classifyReply(text), null, JSON.stringify(text));
  }
});

test("classifyReply requires the whole message to be the decision", () => {
  // SECURITY: a qualified sentence is a conversation, not consent. Prefix
  // matching would have read each of these as approval.
  for (const text of ["approve only after you check the migration", "yes but not the schema part", "אישור רק אחרי בדיקה"]) {
    assert.equal(classifyReply(text), null, text);
  }
  // Trailing punctuation and whitespace are still fine.
  assert.equal(classifyReply("approve!"), "approve");
  assert.equal(classifyReply("  אישור  "), "approve");
});

test("classifyReply handles Hebrew, which an ASCII word boundary silently breaks", () => {
  // Regression guard: /^(אישור)\b/ never matches — \b is ASCII-only, so the
  // gate would wait out its timeout instead of approving.
  assert.equal(classifyReply("אישור"), "approve");
  assert.equal(classifyReply("דחייה"), "deny");
});

test("classifyReaction maps the usual approve/deny emoji", () => {
  assert.equal(classifyReaction("white_check_mark"), "approve");
  assert.equal(classifyReaction("+1::skin-tone-3"), "approve");
  assert.equal(classifyReaction("x"), "deny");
  assert.equal(classifyReaction("-1"), "deny");
  assert.equal(classifyReaction("eyes"), null);
  assert.equal(classifyReaction(null), null);
});

test("shouldTrigger runs only for an allowlisted user with issue text", () => {
  const ok = shouldTrigger({ user: OWNER, text: `<@${BOT}> portal is down` }, { botUserId: BOT, allowlist: ALLOW });
  assert.deepEqual(ok, { run: true, reason: "ok" });
});

test("shouldTrigger refuses non-allowlisted users", () => {
  const result = shouldTrigger({ user: OUTSIDER, text: `<@${BOT}> delete everything` }, { botUserId: BOT, allowlist: ALLOW });
  assert.deepEqual(result, { run: false, reason: "not-allowlisted" });
});

test("shouldTrigger never reacts to bot or self authored events", () => {
  // A bot replying to bots is how an infinite trigger loop starts.
  const base = { user: OWNER, text: `<@${BOT}> fix` };
  assert.equal(shouldTrigger({ ...base, bot_id: "B123" }, { botUserId: BOT, allowlist: ALLOW }).reason, "bot-authored");
  assert.equal(shouldTrigger({ ...base, subtype: "bot_message" }, { botUserId: BOT, allowlist: ALLOW }).reason, "bot-authored");
  assert.equal(shouldTrigger({ user: BOT, text: "hello" }, { botUserId: BOT, allowlist: ALLOW }).reason, "self-authored");
});

test("shouldTrigger refuses an empty issue and malformed events", () => {
  assert.equal(shouldTrigger({ user: OWNER, text: `<@${BOT}>` }, { botUserId: BOT, allowlist: ALLOW }).reason, "empty-issue");
  assert.equal(shouldTrigger(null, { botUserId: BOT, allowlist: ALLOW }).reason, "malformed-event");
});

test("shouldTrigger fails closed when the allowlist is empty", () => {
  const result = shouldTrigger({ user: OWNER, text: `<@${BOT}> fix` }, { botUserId: BOT, allowlist: new Set() });
  assert.equal(result.run, false);
});

test("missingScopes names exactly what the token lacks", () => {
  assert.deepEqual(missingScopes(REQUIRED_SCOPES.join(",")), []);
  assert.deepEqual(missingScopes("channels:history,chat:write"), ["users:read"]);
  assert.deepEqual(missingScopes(""), REQUIRED_SCOPES);
});

test("reactions:read is optional, and reactions:write does not substitute for it", () => {
  // The real grant from the reinstalled app: reactions:write, not reactions:read.
  // reactions:write lets a bot ADD reactions; only reactions:read delivers
  // reaction_added events. The daemon must still start, with the ✅ path off.
  const granted = "channels:history,chat:write,users:read,users.profile:read,channels:read,reactions:write";
  assert.deepEqual(missingScopes(granted), [], "must not block startup");
  assert.deepEqual(
    missingOptionalScopes(granted).map((m: { scope: string }) => m.scope),
    ["reactions:read"]
  );
});

test("missingOptionalScopes is empty once reactions:read is granted", () => {
  assert.deepEqual(missingOptionalScopes([...REQUIRED_SCOPES, "reactions:read"].join(",")), []);
});

test("approval registry resolves on an allowlisted reaction", async () => {
  const reg = createApprovalRegistry();
  const pending = reg.wait("T1", { allowlist: ALLOW, promptTs: "P1" });
  assert.equal(reg.handleReaction({ itemTs: "P1", threadTs: "T1", user: OWNER, reaction: "white_check_mark" }), true);
  assert.equal(await pending, true);
  assert.equal(reg.size(), 0);
});

test("approval registry ignores reactions from non-allowlisted users", async () => {
  // SECURITY: an outsider must not be able to approve autonomous execution.
  const reg = createApprovalRegistry();
  const pending = reg.wait("T2", { allowlist: ALLOW, promptTs: "P2" });
  assert.equal(reg.handleReaction({ itemTs: "P2", threadTs: "T2", user: OUTSIDER, reaction: "white_check_mark" }), false);
  assert.equal(reg.isPending("T2"), true, "run must still be waiting");

  reg.handleReaction({ itemTs: "P2", threadTs: "T2", user: OWNER, reaction: "x" });
  assert.equal(await pending, false);
});

test("approval registry resolves on a threaded reply", async () => {
  const reg = createApprovalRegistry();
  const pending = reg.wait("T3", { allowlist: ALLOW, promptTs: "P3" });
  reg.handleReply({ threadTs: "T3", user: OWNER, text: "אישור" });
  assert.equal(await pending, true);
});

test("approval registry ignores chatter and foreign threads", async () => {
  const reg = createApprovalRegistry();
  const pending = reg.wait("T4", { allowlist: ALLOW, promptTs: "P4" });
  assert.equal(reg.handleReply({ threadTs: "T4", user: OWNER, text: "one sec" }), false);
  assert.equal(reg.handleReply({ threadTs: "OTHER", user: OWNER, text: "approve" }), false);
  assert.equal(reg.isPending("T4"), true);

  reg.handleReply({ threadTs: "T4", user: OWNER, text: "deny" });
  assert.equal(await pending, false);
});

test("approval registry denies on timeout rather than approving", async () => {
  // SECURITY: silence is not consent.
  const reg = createApprovalRegistry({ timeoutMs: 20 });
  const decision = await reg.wait("T5", { allowlist: ALLOW, promptTs: "P5" });
  assert.equal(decision, false);
  assert.equal(reg.size(), 0);
});

test("approval registry reports the resolving actor and decision", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const reg = createApprovalRegistry({ onResolved: (r: Record<string, unknown>) => seen.push(r) });
  const pending = reg.wait("T6", { allowlist: ALLOW, promptTs: "P6" });
  reg.handleReaction({ itemTs: "P6", threadTs: "T6", user: OWNER, reaction: "x" });
  await pending;
  assert.deepEqual(seen, [{ threadTs: "T6", decision: "deny", actor: OWNER }]);
});
