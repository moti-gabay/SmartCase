import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INLINE_AUDIO_LIMIT,
  TRANSCRIPTION_BATCH_SIZE,
  audioMimeFromKey,
  buildTranscriptionPrompt,
  isInlineable,
  normalizeTranscript,
  runTranscriptionBatch,
  type PendingRecording,
  type TranscriptionPorts,
} from "../src/lib/ai/transcription";
import type { TranscriptionStatus } from "../src/types";

// ── pure helpers ───────────────────────────────────────────────────────────────

test("audioMimeFromKey maps the extensions the recorder actually writes", () => {
  assert.equal(audioMimeFromKey("cases/c1/story/1-story.webm"), "audio/webm");
  assert.equal(audioMimeFromKey("cases/c1/story/1-story.m4a"), "audio/mp4");
  assert.equal(audioMimeFromKey("cases/c1/story/1-story.ogg"), "audio/ogg");
  assert.equal(audioMimeFromKey("cases/c1/story/1-story.WAV"), "audio/wav");
});

test("audioMimeFromKey falls back to webm for an unknown or missing extension", () => {
  assert.equal(audioMimeFromKey("cases/c1/story/recording"), "audio/webm");
  assert.equal(audioMimeFromKey("cases/c1/story/take.xyz"), "audio/webm");
});

test("normalizeTranscript strips fences, a leading label and trailing space", () => {
  assert.equal(normalizeTranscript("```\nשלום עולם\n```"), "שלום עולם");
  assert.equal(normalizeTranscript("תמלול: הסיפור שלי"), "הסיפור שלי");
  assert.equal(normalizeTranscript("שורה   \n\n\n\nשורה שנייה"), "שורה\n\nשורה שנייה");
});

test("normalizeTranscript returns null for anything empty — never an empty transcript", () => {
  for (const raw of [null, undefined, "", "   ", "\n\n", "```\n\n```", "תמלול:  "]) {
    assert.equal(normalizeTranscript(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test("isInlineable rejects empty and oversized audio, accepts the boundary", () => {
  assert.equal(isInlineable(0), false);
  assert.equal(isInlineable(1), true);
  assert.equal(isInlineable(INLINE_AUDIO_LIMIT), true);
  assert.equal(isInlineable(INLINE_AUDIO_LIMIT + 1), false);
});

test("the prompt forbids invention and asks for plain Hebrew text", () => {
  const prompt = buildTranscriptionPrompt();
  assert.match(prompt, /אין להוסיף/);
  assert.match(prompt, /\[לא ברור\]/);
  assert.match(prompt, /טקסט רגיל בלבד/);
});

// ── batch runner ───────────────────────────────────────────────────────────────

interface Recorded {
  claims: string[];
  finishes: { profileId: string; status: TranscriptionStatus; transcript: string | null }[];
  transcribed: string[];
}

// Fake ports with per-item overrides, so each test states only what it changes.
function makePorts(
  pending: PendingRecording[],
  overrides: Partial<TranscriptionPorts> = {}
): { ports: TranscriptionPorts; rec: Recorded } {
  const rec: Recorded = { claims: [], finishes: [], transcribed: [] };
  const ports: TranscriptionPorts = {
    listPending: async (limit) => pending.slice(0, limit),
    claim: async (profileId) => { rec.claims.push(profileId); return true; },
    fetchAudio: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" }),
    transcribe: async (bytes, mimeType) => { rec.transcribed.push(mimeType); return "הסיפור האישי שלי"; },
    finish: async (profileId, status, transcript) => { rec.finishes.push({ profileId, status, transcript }); },
    logError: () => {},
    ...overrides,
  };
  return { ports, rec };
}

const item = (n: number): PendingRecording => ({
  profileId: `p${n}`,
  caseId: `c${n}`,
  storyAudioKey: `cases/c${n}/story/1-story.webm`,
});

test("a successful batch claims, transcribes and completes every recording", async () => {
  const { ports, rec } = makePorts([item(1), item(2)]);
  const result = await runTranscriptionBatch(ports);

  assert.deepEqual(result.outcomes.map((o) => o.status), ["COMPLETED", "COMPLETED"]);
  assert.deepEqual(rec.claims, ["p1", "p2"]);
  assert.deepEqual(rec.finishes, [
    { profileId: "p1", status: "COMPLETED", transcript: "הסיפור האישי שלי" },
    { profileId: "p2", status: "COMPLETED", transcript: "הסיפור האישי שלי" },
  ]);
  assert.deepEqual(
    { processed: result.processed, completed: result.completed, failed: result.failed, skipped: result.skipped },
    { processed: 2, completed: 2, failed: 0, skipped: 0 }
  );
});

test("a lost claim skips the item without touching storage, the model or the row", async () => {
  const { ports, rec } = makePorts([item(1)], {
    claim: async () => false,
    fetchAudio: async () => { throw new Error("must not fetch an unclaimed recording"); },
  });

  const result = await runTranscriptionBatch(ports);
  assert.deepEqual(result.outcomes, [{ profileId: "p1", caseId: "c1", status: "SKIPPED", reason: "ALREADY_CLAIMED" }]);
  assert.equal(result.skipped, 1);
  // The winning invocation owns the row; the loser must not write to it at all.
  assert.deepEqual(rec.finishes, []);
});

test("a missing storage object fails the item rather than writing an empty transcript", async () => {
  const { ports, rec } = makePorts([item(1)], { fetchAudio: async () => null });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "AUDIO_NOT_FOUND");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

test("audio too large to inline fails explicitly instead of being sent to the model", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: new Uint8Array(INLINE_AUDIO_LIMIT + 1), mimeType: "audio/webm" }),
    transcribe: async () => { throw new Error("oversized audio must never reach Gemini"); },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "AUDIO_TOO_LARGE_TO_INLINE");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

test("an empty model response fails the item and never overwrites with an empty string", async () => {
  const { ports, rec } = makePorts([item(1)], { transcribe: async () => "   \n  " });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "EMPTY_TRANSCRIPT");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

test("a thrown model error is contained: the item fails, the rest of the batch still runs", async () => {
  // Items are processed sequentially, so the call counter identifies the item.
  let call = 0;
  const { ports, rec } = makePorts([item(1), item(2), item(3)], {
    transcribe: async () => {
      call += 1;
      if (call === 2) throw new Error("gemini exploded");
      return "תמלול תקין";
    },
  });

  const result = await runTranscriptionBatch(ports);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["COMPLETED", "FAILED", "COMPLETED"]);
  assert.equal(result.outcomes[1].reason, "TRANSCRIPTION_ERROR");
  assert.deepEqual(rec.finishes.map((f) => f.status), ["COMPLETED", "FAILED", "COMPLETED"]);
});

test("a failure while writing FAILED does not abort the batch", async () => {
  const { ports } = makePorts([item(1), item(2)], {
    fetchAudio: async () => null,
    finish: async () => { throw new Error("db unreachable"); },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.processed, 2);
  assert.equal(result.failed, 2);
});

test("the batch honours its limit and the default batch size", async () => {
  const many = [item(1), item(2), item(3), item(4), item(5)];
  const { ports } = makePorts(many);

  assert.equal((await runTranscriptionBatch(ports, 2)).processed, 2);
  assert.equal((await runTranscriptionBatch(ports)).processed, TRANSCRIPTION_BATCH_SIZE);
});

test("an empty queue is a no-op, not an error", async () => {
  const { ports, rec } = makePorts([]);
  const result = await runTranscriptionBatch(ports);
  assert.deepEqual(result, { processed: 0, completed: 0, failed: 0, skipped: 0, outcomes: [] });
  assert.deepEqual(rec.claims, []);
});

test("the detected MIME type is what reaches the model", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/mp4" }),
  });
  await runTranscriptionBatch(ports);
  assert.deepEqual(rec.transcribed, ["audio/mp4"]);
});
