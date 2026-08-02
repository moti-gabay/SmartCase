// Hebrew transcription of clients' recorded personal stories (Phase 5).
//
// Structured as a pure core + injected ports so the batch logic is unit-testable
// without Prisma, R2 or Gemini: runTranscriptionBatch() takes everything it
// touches as a dependency. The real wiring lives in
// src/app/api/ai/transcribe/route.ts.
//
// Claiming is the important part: a profile is moved PENDING → PROCESSING with
// the status itself in the WHERE clause, so two overlapping invocations (a cron
// firing while someone clicks the manual trigger) can never transcribe the same
// recording twice — the loser's claim matches zero rows and it skips on.

import type { TranscriptionStatus } from "@/types";

// Gemini accepts inline audio up to a total request size of ~20MB, and base64
// inflates bytes by ~33%. The portal caps recordings at 25MB, so a long one can
// legitimately exceed what inlining can carry — those are failed explicitly with
// a logged reason rather than silently dropped. Moving to the Files API is the
// fix when it starts happening in practice.
export const INLINE_AUDIO_LIMIT = 14 * 1024 * 1024; // 14 MB of raw bytes

// How many recordings one invocation handles. Three, not more: each item is a
// multi-second Gemini round trip run sequentially, and the route's Vercel budget
// is 60s (see the src/app/api/ai/** entry in vercel.json). A leftover queue is
// simply drained by the next invocation.
export const TRANSCRIPTION_BATCH_SIZE = 3;

export const TRANSCRIPTION_MODEL = "gemini-2.5-flash";

// Extension → MIME, for when HeadObject gives us nothing usable. Mirrors the
// portal's ALLOWED_AUDIO_MIME and the extensions the recorder writes.
const EXTENSION_MIME: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function audioMimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? "audio/webm";
}

export function buildTranscriptionPrompt(): string {
  return `אתה מתמלל מקצועי של הקלטות בעברית.

לפניך הקלטת קול של לקוח המספר את סיפורו האישי בהליך גיור.

תמלל את ההקלטה במלואה לעברית תקנית.

כללים מחייבים:
- תמלל אך ורק את מה שנאמר בפועל. אין להוסיף, לפרש, לסכם או להשלים דברים שלא נאמרו.
- שמור על גוף ראשון ועל ניסוח הדובר, כולל שמות ומקומות כפי שנהגו.
- אם קטע אינו ברור, סמן אותו כ-[לא ברור] במקום לנחש.
- אם ההקלטה ריקה או שאין בה דיבור, החזר טקסט ריק.
- החזר טקסט רגיל בלבד, ללא סימוני עיצוב, ללא כותרות, וללא חותמות זמן.`;
}

// Gemini occasionally wraps output in code fences or prefixes it with a
// "תמלול:" style header despite the prompt; strip that and normalize spacing.
// Returns null when nothing usable came back, which the caller treats as FAILED
// rather than writing an empty transcript over a real recording.
export function normalizeTranscript(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\s*```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/^\s*(תמלול|transcript)\s*:\s*/i, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function isInlineable(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= INLINE_AUDIO_LIMIT;
}

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface PendingRecording {
  profileId: string;
  caseId: string;
  storyAudioKey: string;
}

export interface TranscriptionPorts {
  // Profiles with a recording still awaiting transcription, oldest first.
  listPending: (limit: number) => Promise<PendingRecording[]>;
  // PENDING → PROCESSING, guarded on the current status. false = someone else
  // already claimed it.
  claim: (profileId: string) => Promise<boolean>;
  // Raw audio bytes from storage. Null when the object is gone.
  fetchAudio: (key: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  transcribe: (bytes: Uint8Array, mimeType: string) => Promise<string | null>;
  finish: (profileId: string, status: TranscriptionStatus, transcript: string | null) => Promise<void>;
  // Injected so tests assert on failures without noise on the console.
  logError?: (message: string, err?: unknown) => void;
}

export interface TranscriptionOutcome {
  profileId: string;
  caseId: string;
  status: TranscriptionStatus | "SKIPPED";
  reason?: string;
}

export interface BatchResult {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  outcomes: TranscriptionOutcome[];
}

// ── Batch runner ──────────────────────────────────────────────────────────────

// One recording end to end. Every failure path is contained here so a single bad
// object (deleted, oversized, model error) can never abort the rest of the batch.
async function transcribeOne(item: PendingRecording, ports: TranscriptionPorts): Promise<TranscriptionOutcome> {
  const base = { profileId: item.profileId, caseId: item.caseId };

  const claimed = await ports.claim(item.profileId);
  if (!claimed) return { ...base, status: "SKIPPED", reason: "ALREADY_CLAIMED" };

  try {
    const audio = await ports.fetchAudio(item.storyAudioKey);
    if (!audio) {
      await ports.finish(item.profileId, "FAILED", null);
      return { ...base, status: "FAILED", reason: "AUDIO_NOT_FOUND" };
    }

    if (!isInlineable(audio.bytes.byteLength)) {
      await ports.finish(item.profileId, "FAILED", null);
      return { ...base, status: "FAILED", reason: "AUDIO_TOO_LARGE_TO_INLINE" };
    }

    const transcript = normalizeTranscript(await ports.transcribe(audio.bytes, audio.mimeType));
    if (!transcript) {
      await ports.finish(item.profileId, "FAILED", null);
      return { ...base, status: "FAILED", reason: "EMPTY_TRANSCRIPT" };
    }

    await ports.finish(item.profileId, "COMPLETED", transcript);
    return { ...base, status: "COMPLETED" };
  } catch (err) {
    ports.logError?.(`[transcription] profile ${item.profileId} failed`, err);
    // Best-effort: if even the FAILED write throws, the row stays PROCESSING and
    // is picked up by the stale-claim sweep rather than blocking the batch.
    await ports.finish(item.profileId, "FAILED", null).catch(() => {});
    return { ...base, status: "FAILED", reason: "TRANSCRIPTION_ERROR" };
  }
}

// Sequential on purpose: Gemini rate limits are the binding constraint, and a
// batch of five is not worth the added failure modes of parallel fan-out.
export async function runTranscriptionBatch(
  ports: TranscriptionPorts,
  limit: number = TRANSCRIPTION_BATCH_SIZE
): Promise<BatchResult> {
  const pending = await ports.listPending(limit);
  const outcomes: TranscriptionOutcome[] = [];

  for (const item of pending) {
    outcomes.push(await transcribeOne(item, ports));
  }

  return {
    processed: outcomes.length,
    completed: outcomes.filter((o) => o.status === "COMPLETED").length,
    failed: outcomes.filter((o) => o.status === "FAILED").length,
    skipped: outcomes.filter((o) => o.status === "SKIPPED").length,
    outcomes,
  };
}
