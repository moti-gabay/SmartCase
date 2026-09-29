import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_ERRORS,
  LIVE_INITIAL,
  LIVE_MAX_TURNS_PER_COMMIT,
  appendFragment,
  buildHistoryBlock,
  floatToPcm16,
  isLiveActive,
  liveReducer,
  normalizeTurns,
  parseTurns,
  pcm16ToFloat,
  type LiveEvent,
  type LiveState,
} from "../src/lib/ai/live-protocol";

const run = (events: LiveEvent[], from: LiveState = LIVE_INITIAL) => events.reduce(liveReducer, from);

test("happy path: IDLE → CONNECTING → LIVE → HANGUP → CLOSED → IDLE", () => {
  assert.equal(run([{ type: "START" }]).status, "CONNECTING");
  assert.equal(run([{ type: "START" }, { type: "OPENED" }]).status, "LIVE");
  const closing = run([{ type: "START" }, { type: "OPENED" }, { type: "HANGUP" }]);
  assert.equal(closing.status, "CLOSING");
  assert.deepEqual(liveReducer(closing, { type: "CLOSED" }), LIVE_INITIAL);
});

test("speaking states: AI audio, barge-in, quiet", () => {
  const live = run([{ type: "START" }, { type: "OPENED" }]);
  const ai = liveReducer(live, { type: "AI_AUDIO" });
  assert.equal(ai.status, "AI_SPEAKING");
  assert.equal(liveReducer(ai, { type: "USER_SPEECH" }).status, "USER_SPEAKING");
  assert.equal(liveReducer(ai, { type: "QUIET" }).status, "LIVE");
});

test("AI audio does not override an active user turn", () => {
  const user = run([{ type: "START" }, { type: "OPENED" }, { type: "USER_SPEECH" }]);
  assert.equal(liveReducer(user, { type: "AI_AUDIO" }), user);
});

test("unexpected close while active surfaces as dropped error", () => {
  const s = run([{ type: "START" }, { type: "OPENED" }, { type: "CLOSED" }]);
  assert.deepEqual(s, { status: "ERROR", error: LIVE_ERRORS.dropped });
});

test("permission denied only from CONNECTING, and START recovers", () => {
  const denied = run([{ type: "START" }, { type: "DENIED" }]);
  assert.equal(denied.status, "PERMISSION_DENIED");
  assert.equal(liveReducer(denied, { type: "START" }).status, "CONNECTING");
  assert.equal(liveReducer(LIVE_INITIAL, { type: "DENIED" }), LIVE_INITIAL);
});

test("late events after teardown are ignored (same reference)", () => {
  for (const e of [
    { type: "OPENED" },
    { type: "AI_AUDIO" },
    { type: "USER_SPEECH" },
    { type: "QUIET" },
    { type: "CLOSED" },
    { type: "HANGUP" },
  ] as LiveEvent[]) {
    assert.equal(liveReducer(LIVE_INITIAL, e), LIVE_INITIAL, e.type);
  }
  assert.equal(liveReducer(LIVE_INITIAL, { type: "FAILED", error: "x" }), LIVE_INITIAL);
});

test("START while active is a no-op", () => {
  const live = run([{ type: "START" }, { type: "OPENED" }]);
  assert.equal(liveReducer(live, { type: "START" }), live);
});

test("isLiveActive", () => {
  assert.equal(isLiveActive("CONNECTING"), true);
  assert.equal(isLiveActive("AI_SPEAKING"), true);
  assert.equal(isLiveActive("IDLE"), false);
  assert.equal(isLiveActive("CLOSING"), false);
});

test("PCM16 conversion clamps and round-trips within quantization error", () => {
  const input = [0, 0.5, -0.5, 1, -1, 2, -2];
  const pcm = floatToPcm16(input);
  assert.equal(pcm[3], 0x7fff);
  assert.equal(pcm[4], -0x8000);
  assert.equal(pcm[5], 0x7fff);
  assert.equal(pcm[6], -0x8000);
  const back = pcm16ToFloat(pcm);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(back[i] - input[i]) < 1e-4);
});

test("appendFragment merges same-role fragments and splits on role change", () => {
  let t = appendFragment([], "USER", "כמה ");
  t = appendFragment(t, "USER", "תיקים?");
  t = appendFragment(t, "ASSISTANT", "יש 5");
  t = appendFragment(t, "ASSISTANT", "");
  assert.deepEqual(t, [
    { role: "USER", text: "כמה תיקים?" },
    { role: "ASSISTANT", text: "יש 5" },
  ]);
});

test("normalizeTurns enforces USER→ASSISTANT alternation", () => {
  const out = normalizeTurns(
    [
      { role: "ASSISTANT", text: "שלום" }, // leading greeting dropped
      { role: "USER", text: "א" },
      { role: "USER", text: "ב" },
      { role: "ASSISTANT", text: "  " }, // blank dropped
      { role: "ASSISTANT", text: "תשובה" },
      { role: "USER", text: "עוד" }, // trailing user gets fallback
    ],
    "FALLBACK"
  );
  assert.deepEqual(out, [
    { role: "USER", text: "א ב" },
    { role: "ASSISTANT", text: "תשובה" },
    { role: "USER", text: "עוד" },
    { role: "ASSISTANT", text: "FALLBACK" },
  ]);
  assert.deepEqual(normalizeTurns([{ role: "ASSISTANT", text: "hi" }], "F"), []);
});

test("parseTurns rejects malformed or oversized input", () => {
  assert.deepEqual(parseTurns([{ role: "USER", text: "x" }]), [{ role: "USER", text: "x" }]);
  assert.equal(parseTurns([]), null);
  assert.equal(parseTurns("nope"), null);
  assert.equal(parseTurns([{ role: "SYSTEM", text: "x" }]), null);
  assert.equal(parseTurns([{ role: "USER", text: 5 }]), null);
  assert.equal(parseTurns([{ role: "USER", text: "x".repeat(4001) }]), null);
  assert.equal(parseTurns(Array(LIVE_MAX_TURNS_PER_COMMIT + 1).fill({ role: "USER", text: "x" })), null);
});

test("buildHistoryBlock", () => {
  assert.equal(buildHistoryBlock([]), "");
  const block = buildHistoryBlock([
    { role: "USER", text: "שאלה" },
    { role: "ASSISTANT", text: "תשובה" },
  ]);
  assert.match(block, /משתמש: שאלה\nעוזר: תשובה$/);
});
