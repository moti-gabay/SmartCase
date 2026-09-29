import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_ERRORS,
  VOICE_INITIAL,
  baseMime,
  classifyMediaError,
  createRateLimiter,
  hasAudioSignature,
  parseDictationResult,
  rms,
  SPEECH_RMS_THRESHOLD,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from "../src/lib/ai/voice-input";

const run = (events: VoiceEvent[], from: VoiceState = VOICE_INITIAL) => events.reduce(voiceReducer, from);

test("happy path: IDLE → REQUESTING → LISTENING → PROCESSING → IDLE", () => {
  assert.equal(run([{ type: "START" }]).status, "REQUESTING_PERMISSIONS");
  assert.equal(run([{ type: "START" }, { type: "GRANTED" }]).status, "LISTENING");
  assert.equal(run([{ type: "START" }, { type: "GRANTED" }, { type: "STOP" }]).status, "PROCESSING");
  assert.deepEqual(run([{ type: "START" }, { type: "GRANTED" }, { type: "STOP" }, { type: "DONE" }]), VOICE_INITIAL);
});

test("denied permission lands in PERMISSION_DENIED with a hint, and can retry", () => {
  const denied = run([{ type: "START" }, { type: "DENIED" }]);
  assert.deepEqual(denied, { status: "PERMISSION_DENIED", error: VOICE_ERRORS.denied });
  assert.deepEqual(voiceReducer(denied, { type: "START" }), { status: "REQUESTING_PERMISSIONS", error: null });
});

test("transcription failure → ERROR, and START clears the error", () => {
  const failed = run([{ type: "START" }, { type: "GRANTED" }, { type: "STOP" }, { type: "FAILED", error: "x" }]);
  assert.deepEqual(failed, { status: "ERROR", error: "x" });
  assert.equal(voiceReducer(failed, { type: "START" }).error, null);
});

test("out-of-order events are ignored (late async callbacks)", () => {
  assert.equal(voiceReducer(VOICE_INITIAL, { type: "GRANTED" }), VOICE_INITIAL);
  assert.equal(voiceReducer(VOICE_INITIAL, { type: "STOP" }), VOICE_INITIAL);
  assert.equal(voiceReducer(VOICE_INITIAL, { type: "DONE" }), VOICE_INITIAL);
  assert.equal(voiceReducer(VOICE_INITIAL, { type: "FAILED", error: "x" }), VOICE_INITIAL);
  const listening = run([{ type: "START" }, { type: "GRANTED" }]);
  assert.equal(voiceReducer(listening, { type: "START" }), listening);
  assert.equal(voiceReducer(listening, { type: "DONE" }), listening);
});

test("CANCEL always resets, and is a no-op reference when already idle", () => {
  assert.deepEqual(run([{ type: "START" }, { type: "GRANTED" }, { type: "CANCEL" }]), VOICE_INITIAL);
  assert.equal(voiceReducer(VOICE_INITIAL, { type: "CANCEL" }), VOICE_INITIAL);
});

test("classifyMediaError maps getUserMedia rejections", () => {
  assert.deepEqual(classifyMediaError("NotAllowedError"), { type: "DENIED" });
  assert.deepEqual(classifyMediaError("SecurityError"), { type: "DENIED" });
  assert.deepEqual(classifyMediaError("NotFoundError"), { type: "FAILED", error: VOICE_ERRORS.noMic });
  assert.deepEqual(classifyMediaError(undefined), { type: "FAILED", error: VOICE_ERRORS.failed });
});

test("baseMime strips codec parameters", () => {
  assert.equal(baseMime("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(baseMime("Audio/MP4"), "audio/mp4");
  assert.equal(baseMime(""), "");
});

test("createRateLimiter caps per key within the window", () => {
  const allow = createRateLimiter(2, 60_000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 1), true);
  assert.equal(allow("a", 2), false);
  assert.equal(allow("b", 2), true); // keys are independent
  assert.equal(allow("a", 60_001), true); // window slid past the first hit
});

test("hasAudioSignature accepts real containers and rejects arbitrary bytes", () => {
  const b = (...xs: number[]) => new Uint8Array([...xs, 0, 0, 0, 0, 0, 0, 0, 0]);
  const s = (str: string) => [...str].map((c) => c.charCodeAt(0));
  assert.equal(hasAudioSignature(b(0x1a, 0x45, 0xdf, 0xa3)), true); // webm
  assert.equal(hasAudioSignature(b(...s("OggS"))), true);
  assert.equal(hasAudioSignature(b(0, 0, 0, 0x20, ...s("ftypM4A "))), true); // Safari mp4
  assert.equal(hasAudioSignature(b(...s("RIFF"), 0, 0, 0, 0, ...s("WAVE"))), true);
  assert.equal(hasAudioSignature(b(...s("ID3"))), true);
  assert.equal(hasAudioSignature(b(0xff, 0xfb)), true); // mp3 frame sync
  assert.equal(hasAudioSignature(b(...s("RIFF"), 0, 0, 0, 0, ...s("AVI "))), false);
  assert.equal(hasAudioSignature(b(...s("%PDF"))), false);
  assert.equal(hasAudioSignature(new Uint8Array(0)), false);
});

test("parseDictationResult only trusts an explicit has_speech=true verdict", () => {
  assert.equal(parseDictationResult('{"has_speech":true,"text":"שלום"}'), "שלום");
  assert.equal(parseDictationResult('{"has_speech":false,"text":"המצאה"}'), "");
  assert.equal(parseDictationResult('{"text":"no verdict"}'), "");
  assert.equal(parseDictationResult('{"has_speech":true,"text":7}'), "");
  assert.equal(parseDictationResult("not json"), "");
  assert.equal(parseDictationResult(undefined), "");
});

test("rms: silence is below the speech gate, a speech-level tone is above", () => {
  assert.equal(rms([]), 0);
  assert.equal(rms(new Float32Array(2048)), 0);
  assert.ok(Math.abs(rms([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-9);
  const tone = Float32Array.from({ length: 2048 }, (_, i) => 0.2 * Math.sin(i / 5));
  assert.ok(rms(tone) > SPEECH_RMS_THRESHOLD);
  const hiss = Float32Array.from({ length: 2048 }, (_, i) => 0.005 * Math.sin(i));
  assert.ok(rms(hiss) < SPEECH_RMS_THRESHOLD);
});
