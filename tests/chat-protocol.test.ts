import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sseEncode,
  clampLimit,
  capToolResult,
  TOOL_RESULT_MAX_CHARS,
} from "../src/lib/ai/chat-protocol";

test("sseEncode produces a single well-formed SSE frame", () => {
  assert.equal(sseEncode("delta", { text: "שלום" }), 'event: delta\ndata: {"text":"שלום"}\n\n');
});

test("sseEncode keeps data on one line even with newlines in the payload", () => {
  const frame = sseEncode("delta", { text: "a\nb" });
  const lines = frame.split("\n");
  assert.equal(lines.length, 4); // event, data, "", "" (trailing \n\n)
  assert.equal(lines[1], 'data: {"text":"a\\nb"}');
});

test("clampLimit clamps to [1, max] and falls back on junk", () => {
  assert.equal(clampLimit(5), 5);
  assert.equal(clampLimit(99), 20); // capped at max
  assert.equal(clampLimit(7.9), 7); // truncated, not rounded
  assert.equal(clampLimit(0), 10); // below 1 → fallback
  assert.equal(clampLimit(-3), 10);
  assert.equal(clampLimit("12"), 10); // strings are not coerced
  assert.equal(clampLimit(undefined), 10);
  assert.equal(clampLimit(NaN), 10);
  assert.equal(clampLimit(50, 30, 15), 30); // custom max/fallback
});

test("capToolResult passes small results through untouched", () => {
  const result = { results: [{ a: 1 }] };
  assert.equal(capToolResult(result), result); // same reference, no copy
});

test("capToolResult truncates oversized results with an explicit flag", () => {
  const big = { data: "x".repeat(TOOL_RESULT_MAX_CHARS + 100) };
  const capped = capToolResult(big);
  assert.equal(capped.truncated, true);
  assert.equal(typeof capped.data, "string");
  assert.equal((capped.data as string).length, TOOL_RESULT_MAX_CHARS);
});

test("trimToUserStart: history always opens on a user turn", async () => {
  const { trimToUserStart } = await import("../src/lib/ai/chat-protocol");
  const call = { role: "model", parts: [{ functionCall: { name: "x" } }] };
  const resp = { role: "user", parts: [{ functionResponse: { name: "x" } }] };
  const text = { role: "model", parts: [{ text: "ok" }] };
  const user = { role: "user", parts: [{ text: "q" }] };
  // A window opening mid-replay drops the model turns AND the orphaned
  // functionResponse (a "user" turn Gemini rejects without its call).
  assert.deepEqual(trimToUserStart([text, call, resp, text, user]), [user]);
  assert.deepEqual(trimToUserStart([resp, text, user, call, resp, text]), [user, call, resp, text]);
  assert.deepEqual(trimToUserStart([user, text]), [user, text]);
  assert.deepEqual(trimToUserStart([text]), []);
});
