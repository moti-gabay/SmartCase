// Pure, dependency-free pieces of assistant-chat voice input: the recorder
// state machine, request budgets, the dictation prompt, and a per-user rate
// limiter. Kept free of React/Prisma/Gemini so unit tests import them directly.

// ~60s of Opus at MediaRecorder's default bitrate is well under 1MB; 2MB leaves
// headroom for Safari's AAC/mp4 without letting the route become an upload sink.
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_DURATION_MS = 60_000;
export const VOICE_RATE_LIMIT_PER_MINUTE = 10;

// Peak RMS a recording must reach to be sent at all (~-34 dBFS). Normal speech
// peaks well above 0.05; a quiet room sits under 0.01. This gate is the real
// defense against hallucinated transcripts — in E2E, Gemini returned a fluent
// invented sentence (or echoed its own prompt) for pure silence regardless of
// prompt wording, so silent clips must never reach the model.
export const SPEECH_RMS_THRESHOLD = 0.02;

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export type VoiceStatus =
  | "IDLE"
  | "REQUESTING_PERMISSIONS"
  | "LISTENING"
  | "PROCESSING"
  | "ERROR"
  | "PERMISSION_DENIED";

export interface VoiceState {
  status: VoiceStatus;
  error: string | null;
}

export type VoiceEvent =
  | { type: "START" }
  | { type: "GRANTED" }
  | { type: "DENIED" }
  | { type: "STOP" }
  | { type: "CANCEL" }
  | { type: "DONE" }
  | { type: "FAILED"; error: string };

export const VOICE_INITIAL: VoiceState = { status: "IDLE", error: null };

export const VOICE_ERRORS = {
  denied: "הגישה למיקרופון נחסמה — יש לאשר אותה בהגדרות הדפדפן",
  unsupported: "הדפדפן אינו תומך בהקלטת קול",
  noMic: "לא נמצא מיקרופון זמין",
  empty: "לא זוהה דיבור בהקלטה",
  failed: "התמלול נכשל — נסה שוב",
} as const;

// Events that don't apply to the current status are ignored rather than
// throwing — async callbacks (onstop, fetch) can land after a CANCEL.
export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "START":
      return state.status === "IDLE" || state.status === "ERROR" || state.status === "PERMISSION_DENIED"
        ? { status: "REQUESTING_PERMISSIONS", error: null }
        : state;
    case "GRANTED":
      return state.status === "REQUESTING_PERMISSIONS" ? { status: "LISTENING", error: null } : state;
    case "DENIED":
      return state.status === "REQUESTING_PERMISSIONS"
        ? { status: "PERMISSION_DENIED", error: VOICE_ERRORS.denied }
        : state;
    case "STOP":
      return state.status === "LISTENING" ? { status: "PROCESSING", error: null } : state;
    case "DONE":
      return state.status === "PROCESSING" ? VOICE_INITIAL : state;
    case "FAILED":
      return state.status === "REQUESTING_PERMISSIONS" ||
        state.status === "LISTENING" ||
        state.status === "PROCESSING"
        ? { status: "ERROR", error: event.error }
        : state;
    case "CANCEL":
      return state.status === "IDLE" && !state.error ? state : VOICE_INITIAL;
  }
}

// getUserMedia rejection → state event. NotAllowedError covers both a user
// "Block" and a Permissions-Policy/insecure-context refusal; SecurityError is
// the older spelling some browsers still use.
export function classifyMediaError(name: string | undefined): VoiceEvent {
  if (name === "NotAllowedError" || name === "SecurityError") return { type: "DENIED" };
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { type: "FAILED", error: VOICE_ERRORS.noMic };
  }
  return { type: "FAILED", error: VOICE_ERRORS.failed };
}

// MediaRecorder reports e.g. "audio/webm;codecs=opus" — the allowlist is
// keyed on the bare type.
export function baseMime(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

// Container signature check. Gemini will "transcribe" arbitrary bytes into a
// fluent, invented sentence (observed in E2E: 1KB of random data labelled
// audio/webm came back as a plausible Hebrew question), so anything that is not
// a real audio container is rejected before it reaches the model.
export function hasAudioSignature(bytes: Uint8Array): boolean {
  const at = (offset: number, sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (str: string) => [...str].map((c) => c.charCodeAt(0));
  return (
    at(0, [0x1a, 0x45, 0xdf, 0xa3]) || // WebM / Matroska (EBML)
    at(0, ascii("OggS")) ||
    at(4, ascii("ftyp")) || // MP4 / M4A (Safari)
    (at(0, ascii("RIFF")) && at(8, ascii("WAVE"))) ||
    at(0, ascii("ID3")) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) // MPEG frame sync
  );
}

export function buildDictationPrompt(): string {
  // Deliberately no framing about what the speaker is doing: telling the
  // model it is "a question for an AI assistant" made it invent exactly such
  // a question for silent clips.
  return `תמלל את קובץ השמע המצורף בדיוק כפי שנאמר בו.

כללים מחייבים:
- תמלל בשפה שבה דובר (עברית, אנגלית, או שילוב של שתיהן). אל תתרגם.
- תמלל אך ורק את מה שנאמר. אל תענה על השאלה, אל תוסיף ואל תסכם.
- כתוב מספרים בספרות.
- קודם קבע אם יש בהקלטה דיבור אנושי שנשמע בבירור (has_speech). אם אין — has_speech=false ו-text ריק. לעולם אל תנחש ואל תמציא מילים.
- החזר טקסט רגיל בלבד, ללא סימוני עיצוב.`;
}

// Model JSON → transcript. Anything malformed, or a has_speech=false verdict,
// collapses to "" (the client's "no speech detected" path) — never to the
// raw model output, which may be an invented sentence.
export function parseDictationResult(raw: string | null | undefined): string {
  try {
    const parsed = JSON.parse(raw ?? "");
    return parsed?.has_speech === true && typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

// Fixed-window-per-key limiter. In-memory, so on serverless it is a
// per-instance best effort — enough to stop a runaway client loop from
// burning Gemini quota; the chat route's DB-backed limit still gates sends.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}
