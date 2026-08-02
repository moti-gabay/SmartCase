import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INLINE_AUDIO_LIMIT,
  MAX_TRANSCRIBABLE_SIZE,
  STALE_CLAIM_TIMEOUT_MS,
  TRANSCRIPTION_BATCH_SIZE,
  audioMimeFromKey,
  buildTranscriptionPrompt,
  normalizeTranscript,
  runTranscriptionBatch,
  selectUploadStrategy,
  staleClaimCutoff,
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
  filesUploaded: string[];
  filesRemoved: string[];
  sweptBefore: Date[];
}

// Fake ports with per-item overrides, so each test states only what it changes.
function makePorts(
  pending: PendingRecording[],
  overrides: Partial<TranscriptionPorts> = {}
): { ports: TranscriptionPorts; rec: Recorded } {
  const rec: Recorded = {
    claims: [], finishes: [], transcribed: [], filesUploaded: [], filesRemoved: [], sweptBefore: [],
  };
  const ports: TranscriptionPorts = {
    listPending: async (limit) => pending.slice(0, limit),
    resetStaleClaims: async (before) => { rec.sweptBefore.push(before); return 0; },
    claim: async (profileId) => { rec.claims.push(profileId); return true; },
    fetchAudio: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" }),
    transcribeInline: async (_bytes, mimeType) => { rec.transcribed.push(mimeType); return "הסיפור האישי שלי"; },
    files: {
      upload: async (_bytes, mimeType) => { rec.filesUploaded.push(mimeType); return { name: "files/abc", uri: "gs://files/abc" }; },
      transcribeFromUri: async (_uri, mimeType) => { rec.transcribed.push(mimeType); return "תמלול מקובץ גדול"; },
      remove: async (name) => { rec.filesRemoved.push(name); },
    },
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

test("audio beyond the portal's own upload cap fails without reaching the model", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: new Uint8Array(MAX_TRANSCRIBABLE_SIZE + 1), mimeType: "audio/webm" }),
    transcribeInline: async () => { throw new Error("oversized audio must never reach Gemini"); },
    files: {
      upload: async () => { throw new Error("oversized audio must never be uploaded"); },
      transcribeFromUri: async () => null,
      remove: async () => {},
    },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "AUDIO_TOO_LARGE");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

test("a zero-byte object fails as empty rather than being transcribed", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: new Uint8Array(0), mimeType: "audio/webm" }),
    transcribeInline: async () => { throw new Error("empty audio must never reach Gemini"); },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "AUDIO_EMPTY");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

test("an empty model response fails the item and never overwrites with an empty string", async () => {
  const { ports, rec } = makePorts([item(1)], { transcribeInline: async () => "   \n  " });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "EMPTY_TRANSCRIPT");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

test("a thrown model error is contained: the item fails, the rest of the batch still runs", async () => {
  // Items are processed sequentially, so the call counter identifies the item.
  let call = 0;
  const { ports, rec } = makePorts([item(1), item(2), item(3)], {
    transcribeInline: async () => {
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
  assert.deepEqual(result, { processed: 0, completed: 0, failed: 0, skipped: 0, staleReleased: 0, outcomes: [] });
  assert.deepEqual(rec.claims, []);
});

test("the detected MIME type is what reaches the model", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/mp4" }),
  });
  await runTranscriptionBatch(ports);
  assert.deepEqual(rec.transcribed, ["audio/mp4"]);
});

// ── upload strategy ────────────────────────────────────────────────────────────

test("selectUploadStrategy splits the size range at the inline and portal limits", () => {
  assert.equal(selectUploadStrategy(0), "EMPTY");
  assert.equal(selectUploadStrategy(-1), "EMPTY");
  assert.equal(selectUploadStrategy(1), "INLINE");
  assert.equal(selectUploadStrategy(INLINE_AUDIO_LIMIT), "INLINE");
  assert.equal(selectUploadStrategy(INLINE_AUDIO_LIMIT + 1), "FILES_API");
  assert.equal(selectUploadStrategy(MAX_TRANSCRIBABLE_SIZE), "FILES_API");
  assert.equal(selectUploadStrategy(MAX_TRANSCRIBABLE_SIZE + 1), "TOO_LARGE");
});

test("the whole portal recording range is transcribable — no gap above the inline limit", () => {
  // The regression this guards: recordings between the two limits used to fail
  // outright, which is exactly what the Files API path exists to fix.
  assert.ok(INLINE_AUDIO_LIMIT < MAX_TRANSCRIBABLE_SIZE);
  assert.equal(selectUploadStrategy(Math.floor((INLINE_AUDIO_LIMIT + MAX_TRANSCRIBABLE_SIZE) / 2)), "FILES_API");
});

// ── Files API path ─────────────────────────────────────────────────────────────

const large = () => new Uint8Array(INLINE_AUDIO_LIMIT + 1024);

test("a large recording goes through upload → transcribe-by-uri → delete", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: large(), mimeType: "audio/mp4" }),
    transcribeInline: async () => { throw new Error("large audio must not be inlined"); },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].status, "COMPLETED");
  assert.deepEqual(rec.filesUploaded, ["audio/mp4"]);
  assert.deepEqual(rec.transcribed, ["audio/mp4"]);
  assert.deepEqual(rec.filesRemoved, ["files/abc"], "the uploaded file must be deleted after success");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "COMPLETED", transcript: "תמלול מקובץ גדול" }]);
});

test("the uploaded file is deleted even when transcription throws", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: large(), mimeType: "audio/webm" }),
    files: {
      upload: async () => ({ name: "files/leak-me", uri: "gs://files/leak-me" }),
      transcribeFromUri: async () => { throw new Error("gemini exploded mid-transcription"); },
      remove: async (name) => { rec.filesRemoved.push(name); },
    },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].status, "FAILED");
  assert.equal(result.outcomes[0].reason, "TRANSCRIPTION_ERROR");
  assert.deepEqual(rec.filesRemoved, ["files/leak-me"], "a private recording must never be left in Gemini storage");
});

test("the uploaded file is deleted even when the model returns nothing usable", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: large(), mimeType: "audio/webm" }),
    files: {
      upload: async () => ({ name: "files/empty", uri: "gs://files/empty" }),
      transcribeFromUri: async () => "  ",
      remove: async (name) => { rec.filesRemoved.push(name); },
    },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].reason, "EMPTY_TRANSCRIPT");
  assert.deepEqual(rec.filesRemoved, ["files/empty"]);
});

test("a failed cleanup does not turn a successful transcription into a failure", async () => {
  const logged: string[] = [];
  const { ports } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: large(), mimeType: "audio/webm" }),
    files: {
      upload: async () => ({ name: "files/stuck", uri: "gs://files/stuck" }),
      transcribeFromUri: async () => "תמלול תקין",
      remove: async () => { throw new Error("delete failed"); },
    },
    logError: (message) => logged.push(message),
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].status, "COMPLETED");
  assert.equal(logged.length, 1, "the orphaned file must be logged");
});

test("an upload failure fails the item without attempting a delete", async () => {
  const { ports, rec } = makePorts([item(1)], {
    fetchAudio: async () => ({ bytes: large(), mimeType: "audio/webm" }),
    files: {
      upload: async () => { throw new Error("upload rejected"); },
      transcribeFromUri: async () => { throw new Error("must not transcribe"); },
      remove: async (name) => { rec.filesRemoved.push(name); },
    },
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.outcomes[0].status, "FAILED");
  assert.deepEqual(rec.filesRemoved, [], "nothing was uploaded, so there is nothing to delete");
  assert.deepEqual(rec.finishes, [{ profileId: "p1", status: "FAILED", transcript: null }]);
});

// ── stale-claim sweep ──────────────────────────────────────────────────────────

test("staleClaimCutoff subtracts the timeout from the current instant", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(staleClaimCutoff(now).toISOString(), "2026-08-02T11:45:00.000Z");
  assert.equal(STALE_CLAIM_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(staleClaimCutoff(now, 60_000).toISOString(), "2026-08-02T11:59:00.000Z");
});

test("the sweep runs before the queue is read, using the injected clock", async () => {
  const order: string[] = [];
  const now = new Date("2026-08-02T12:00:00.000Z");
  const { ports, rec } = makePorts([item(1)], {
    now: () => now,
    resetStaleClaims: async (before) => { order.push("sweep"); rec.sweptBefore.push(before); return 2; },
    listPending: async () => { order.push("list"); return [item(1)]; },
  });

  const result = await runTranscriptionBatch(ports);
  assert.deepEqual(order, ["sweep", "list"], "released rows must be eligible for this same batch");
  assert.deepEqual(rec.sweptBefore.map((d) => d.toISOString()), ["2026-08-02T11:45:00.000Z"]);
  assert.equal(result.staleReleased, 2);
});

test("a failing sweep is logged but never blocks the healthy queue", async () => {
  const logged: string[] = [];
  const { ports } = makePorts([item(1)], {
    resetStaleClaims: async () => { throw new Error("db unreachable"); },
    logError: (message) => logged.push(message),
  });

  const result = await runTranscriptionBatch(ports);
  assert.equal(result.completed, 1, "the batch must still transcribe what it can");
  assert.equal(result.staleReleased, 0);
  assert.equal(logged.length, 1);
});

test("an empty queue still reports what the sweep released", async () => {
  const { ports } = makePorts([], { resetStaleClaims: async () => 3 });
  const result = await runTranscriptionBatch(ports);
  assert.deepEqual(result, { processed: 0, completed: 0, failed: 0, skipped: 0, staleReleased: 3, outcomes: [] });
});
