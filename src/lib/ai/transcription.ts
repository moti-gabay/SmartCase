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
import { MAX_AUDIO_SIZE } from "@/core/storage/s3-storage";

// Gemini accepts inline audio up to a total request size of ~20MB, and base64
// inflates bytes by ~33%, so ~14MB of raw bytes is the practical inline ceiling.
// Anything above it goes through the Files API instead (upload → reference by
// URI → delete), which is why the portal's 25MB recording cap is now fully
// transcribable rather than partly out of reach.
export const INLINE_AUDIO_LIMIT = 14 * 1024 * 1024; // 14 MB of raw bytes

// Beyond this nothing is attempted — it matches the portal's own upload cap, so
// an object bigger than this did not come from the recorder.
export const MAX_TRANSCRIBABLE_SIZE = MAX_AUDIO_SIZE;

// A row is claimed by flipping it to PROCESSING. If the function dies mid-item
// (serverless timeout, deploy mid-flight) that flip is never completed, and
// without a sweep the recording would sit there forever. 15 minutes is far
// beyond the worst realistic single-item runtime, so a row older than that is
// stranded, not in flight.
export const STALE_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

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

// How a given recording has to reach the model. EMPTY/TOO_LARGE are terminal —
// the caller fails the row instead of calling Gemini at all.
export type UploadStrategy = "EMPTY" | "INLINE" | "FILES_API" | "TOO_LARGE";

export function selectUploadStrategy(byteLength: number): UploadStrategy {
  if (byteLength <= 0) return "EMPTY";
  if (byteLength <= INLINE_AUDIO_LIMIT) return "INLINE";
  if (byteLength <= MAX_TRANSCRIBABLE_SIZE) return "FILES_API";
  return "TOO_LARGE";
}

// Cutoff for the stale-claim sweep: rows that entered PROCESSING before this
// instant are considered abandoned.
export function staleClaimCutoff(now: Date, timeoutMs: number = STALE_CLAIM_TIMEOUT_MS): Date {
  return new Date(now.getTime() - timeoutMs);
}

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface PendingRecording {
  profileId: string;
  caseId: string;
  storyAudioKey: string;
}

// A file parked in Gemini's temporary storage. `name` is the handle used to
// delete it again; `uri` is what the generate call references.
export interface UploadedAudioFile {
  name: string;
  uri: string;
}

// The Files API path, kept as its own port group so the core can own the
// upload → transcribe → delete lifecycle (and prove the delete happens).
export interface FilesApiPort {
  upload: (bytes: Uint8Array, mimeType: string) => Promise<UploadedAudioFile>;
  transcribeFromUri: (uri: string, mimeType: string) => Promise<string | null>;
  remove: (name: string) => Promise<void>;
}

export interface TranscriptionPorts {
  // Profiles with a recording still awaiting transcription, oldest first.
  listPending: (limit: number) => Promise<PendingRecording[]>;
  // PROCESSING rows older than the cutoff → PENDING. Returns how many were
  // released, purely for the batch summary.
  resetStaleClaims: (before: Date) => Promise<number>;
  // PENDING → PROCESSING, guarded on the current status. false = someone else
  // already claimed it.
  claim: (profileId: string) => Promise<boolean>;
  // Raw audio bytes from storage. Null when the object is gone.
  fetchAudio: (key: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  // Small recordings: base64 straight into the request.
  transcribeInline: (bytes: Uint8Array, mimeType: string) => Promise<string | null>;
  // Large recordings (INLINE_AUDIO_LIMIT..MAX_TRANSCRIBABLE_SIZE).
  files: FilesApiPort;
  finish: (profileId: string, status: TranscriptionStatus, transcript: string | null) => Promise<void>;
  // Injected so tests can pin the stale-claim cutoff.
  now?: () => Date;
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
  staleReleased: number;
  outcomes: TranscriptionOutcome[];
}

// ── Batch runner ──────────────────────────────────────────────────────────────

// Large recordings: park the audio in Gemini's temporary file storage, reference
// it by URI, then ALWAYS delete it. The finally block is the point of this
// function — an upload that survives a failed transcription is a private
// recording left sitting in a third party's storage, so cleanup must not depend
// on the happy path being taken. A failed delete is logged, never rethrown: it
// must not turn a successful transcription into a failed row.
async function transcribeViaFilesApi(
  bytes: Uint8Array,
  mimeType: string,
  ports: TranscriptionPorts
): Promise<string | null> {
  const file = await ports.files.upload(bytes, mimeType);
  try {
    return await ports.files.transcribeFromUri(file.uri, mimeType);
  } finally {
    await ports.files.remove(file.name).catch((err) => {
      ports.logError?.(`[transcription] failed to delete uploaded file ${file.name}`, err);
    });
  }
}

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

    const strategy = selectUploadStrategy(audio.bytes.byteLength);
    if (strategy === "EMPTY" || strategy === "TOO_LARGE") {
      await ports.finish(item.profileId, "FAILED", null);
      return { ...base, status: "FAILED", reason: strategy === "EMPTY" ? "AUDIO_EMPTY" : "AUDIO_TOO_LARGE" };
    }

    const raw =
      strategy === "INLINE"
        ? await ports.transcribeInline(audio.bytes, audio.mimeType)
        : await transcribeViaFilesApi(audio.bytes, audio.mimeType, ports);
    const transcript = normalizeTranscript(raw);
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
  // Sweep first, so rows released this pass are eligible for the very same
  // batch instead of waiting for the next invocation. A failing sweep must not
  // block transcription of the healthy queue.
  const now = ports.now?.() ?? new Date();
  let staleReleased = 0;
  try {
    staleReleased = await ports.resetStaleClaims(staleClaimCutoff(now));
  } catch (err) {
    ports.logError?.("[transcription] stale-claim sweep failed", err);
  }

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
    staleReleased,
    outcomes,
  };
}
