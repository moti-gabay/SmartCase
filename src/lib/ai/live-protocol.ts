// Pure, dependency-free pieces of the assistant's Live Voice Mode (Gemini Live
// API over a browser-direct WebSocket, authorized by an ephemeral token minted
// in /api/ai/live/token). State machine, PCM conversion, and transcript →
// persisted-turn shaping live here so unit tests import them without React,
// Prisma, or the Gemini SDK.

// Native-audio Live model. Preview ids churn — this is the one exported by
// @google/genai 2.10's type docs; re-verify on SDK bumps.
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
export const LIVE_INPUT_RATE = 16_000;
export const LIVE_OUTPUT_RATE = 24_000;
// Hard session cap: client timer + token expiry both enforce it (cost bound).
export const LIVE_MAX_SESSION_MS = 10 * 60_000;
export const LIVE_SESSIONS_PER_MINUTE = 5;
export const LIVE_TOOL_CALLS_PER_MINUTE = 30;
export const LIVE_MAX_TURNS_PER_COMMIT = 20;
export const LIVE_MAX_TURN_CHARS = 4000;

export type LiveStatus =
  "IDLE" | "CONNECTING" | "LIVE" | "USER_SPEAKING" | "AI_SPEAKING" | "CLOSING" | "ERROR" | "PERMISSION_DENIED";

export interface LiveState {
  status: LiveStatus;
  error: string | null;
}

export type LiveEvent =
  | { type: "START" }
  | { type: "OPENED" }
  | { type: "DENIED" }
  | { type: "USER_SPEECH" }
  | { type: "AI_AUDIO" }
  | { type: "QUIET" } // playback drained / user went silent / interrupted
  | { type: "HANGUP" }
  | { type: "CLOSED" }
  | { type: "FAILED"; error: string };

export const LIVE_INITIAL: LiveState = { status: "IDLE", error: null };

export const LIVE_ERRORS = {
  denied: "הגישה למיקרופון נחסמה — יש לאשר אותה בהגדרות הדפדפן",
  unsupported: "הדפדפן אינו תומך בשיחה קולית",
  connect: "החיבור לשיחה הקולית נכשל — נסה שוב",
  dropped: "השיחה הקולית נותקה",
  limit: "הגעת למגבלת זמן השיחה",
} as const;

const ACTIVE: ReadonlySet<LiveStatus> = new Set(["LIVE", "USER_SPEAKING", "AI_SPEAKING"]);

export function isLiveActive(status: LiveStatus): boolean {
  return status === "CONNECTING" || ACTIVE.has(status);
}

// Inapplicable events are ignored, never thrown — WebSocket and audio
// callbacks routinely land after a hang-up.
export function liveReducer(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "START":
      return state.status === "IDLE" || state.status === "ERROR" || state.status === "PERMISSION_DENIED"
        ? { status: "CONNECTING", error: null }
        : state;
    case "OPENED":
      return state.status === "CONNECTING" ? { status: "LIVE", error: null } : state;
    case "DENIED":
      return state.status === "CONNECTING" ? { status: "PERMISSION_DENIED", error: LIVE_ERRORS.denied } : state;
    case "USER_SPEECH":
      // User speech wins over AI speech: that's barge-in.
      return ACTIVE.has(state.status) ? { status: "USER_SPEAKING", error: null } : state;
    case "AI_AUDIO":
      return state.status === "LIVE" || state.status === "AI_SPEAKING" ? { status: "AI_SPEAKING", error: null } : state;
    case "QUIET":
      return ACTIVE.has(state.status) ? { status: "LIVE", error: null } : state;
    case "HANGUP":
      return isLiveActive(state.status) ? { status: "CLOSING", error: null } : state;
    case "CLOSED":
      // An unexpected close while active surfaces as an error; after HANGUP it's the clean end.
      if (state.status === "CLOSING") return LIVE_INITIAL;
      return isLiveActive(state.status) ? { status: "ERROR", error: LIVE_ERRORS.dropped } : state;
    case "FAILED":
      return isLiveActive(state.status) || state.status === "CLOSING" ? { status: "ERROR", error: event.error } : state;
  }
}

// Float32 [-1,1] → PCM16 little-endian (Live API input format).
export function floatToPcm16(samples: ArrayLike<number>): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

export type LiveTurn = { role: "USER" | "ASSISTANT"; text: string };

// Streaming transcription fragments → turns. Consecutive same-role fragments
// are concatenated (Gemini emits word/phrase-sized pieces).
export function appendFragment(turns: LiveTurn[], role: LiveTurn["role"], fragment: string): LiveTurn[] {
  if (!fragment) return turns;
  const last = turns[turns.length - 1];
  if (last?.role === role) return [...turns.slice(0, -1), { role, text: last.text + fragment }];
  return [...turns, { role, text: fragment }];
}

// Shape a committed batch for the text-chat history, which must strictly
// alternate USER → ASSISTANT (Gemini's multi-turn API rejects two consecutive
// same-role contents). Blank turns drop, same-role runs merge, a leading
// assistant turn (greeting with no user prompt) drops, and a trailing user
// turn gets `fallback` so an ASSISTANT row always follows a USER row.
export function normalizeTurns(turns: readonly LiveTurn[], fallback: string): LiveTurn[] {
  const out: LiveTurn[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last?.role === t.role) last.text = `${last.text} ${text}`;
    else if (out.length === 0 && t.role === "ASSISTANT") continue;
    else out.push({ role: t.role, text });
  }
  if (out.length && out[out.length - 1].role === "USER") out.push({ role: "ASSISTANT", text: fallback });
  return out;
}

// Validate an untrusted commit body's turns. Returns null on any shape error.
export function parseTurns(raw: unknown): LiveTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIVE_MAX_TURNS_PER_COMMIT) return null;
  const turns: LiveTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") return null;
    const { role, text } = t as Record<string, unknown>;
    if ((role !== "USER" && role !== "ASSISTANT") || typeof text !== "string") return null;
    if (text.length > LIVE_MAX_TURN_CHARS) return null;
    turns.push({ role, text });
  }
  return turns;
}

// Spoken-mode addendum: the base prompt asks for Markdown tables, which are
// meaningless read aloud.
export const LIVE_PROMPT_ADDENDUM = `

## מצב שיחה קולית (גובר על כללי הפורמט)
- אתה מדבר בקול. ענה במשפטים קצרים וטבעיים, ללא Markdown, טבלאות או רשימות.
- כשיש נתונים רבים — סכם את העיקר והצע לפרט.`;

export function buildHistoryBlock(history: readonly LiveTurn[]): string {
  if (history.length === 0) return "";
  const lines = history.map((m) => `${m.role === "USER" ? "משתמש" : "עוזר"}: ${m.text}`);
  return `\n\n## השיחה עד כה (הקשר בלבד — אל תחזור עליה)\n${lines.join("\n")}`;
}
