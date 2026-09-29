// Pure, dependency-free pieces of the AI assistant chat: SSE wire encoding,
// arg clamping, and result capping. Kept out of assistant-tools.ts so unit
// tests can import them without pulling in the Prisma client.

// Hard budgets — together they bound the whole tool loop well under the 60s
// serverless ceiling for /api/ai/** (vercel.json).
export const MAX_TOOL_ROUNDS = 5;
export const MAX_MESSAGE_CHARS = 4000;
export const TOOL_RESULT_MAX_CHARS = 4000;
export const TOOL_TIMEOUT_MS = 10_000;
export const STREAM_DEADLINE_MS = 55_000;
export const HEARTBEAT_MS = 15_000;
export const HISTORY_MESSAGES = 20;
export const STORED_MESSAGE_MAX_CHARS = 8000;
export const RATE_LIMIT_MESSAGES_PER_MINUTE = 10;

// Persisted whenever the model produced no usable answer (failure or empty
// output) so an ASSISTANT row always follows the USER row it responds to —
// otherwise the next turn's history has two consecutive "user" contents,
// which Gemini's multi-turn API isn't built to handle.
export const FALLBACK_TEXT = "מצטער, אירעה שגיאה ולא הצלחתי לענות. נסה לשלוח את השאלה שוב.";

// Slice to maxLen, then strip a trailing unclosed "[...]" mask-tag fragment
// the cut could otherwise leave behind (masking can inflate length near the
// boundary, e.g. a 9-digit id becoming the longer "[תז_ממוסכת]" tag).
export function sliceMaskSafe(text: string, maxLen: number): string {
  return text.slice(0, maxLen).replace(/\[[^\]]*$/, "");
}

export type ChatSseEvent = "meta" | "delta" | "tool" | "done" | "error";

// `event: <type>\ndata: <one-line JSON>\n\n` — JSON.stringify never emits raw
// newlines, so one data line is always enough.
export function sseEncode(event: ChatSseEvent, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Model-supplied `limit` arg → safe integer within [1, max].
export function clampLimit(raw: unknown, max = 20, fallback = 10): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

// Cap a tool result before it goes back to the model as a functionResponse.
// Oversized payloads are returned as a sliced JSON string with an explicit
// truncation flag so the model knows the data is partial.
export function capToolResult(
  result: Record<string, unknown>,
  maxChars = TOOL_RESULT_MAX_CHARS
): Record<string, unknown> {
  const json = JSON.stringify(result);
  if (json.length <= maxChars) return result;
  return { truncated: true, note: "התוצאה קוצצה — בקש סינון מדויק יותר", data: json.slice(0, maxChars) };
}
