// Pure, dependency-free core of the intent lifecycle — audit action names,
// expiry, and status derivation from the append-only audit trail. Kept free of
// Prisma so tests/ai-actions.test.ts can import it directly.
import { z } from "zod";
import type { IntentStatus } from "@/lib/ai/tools/types";

export const INTENT_TTL_MS = 15 * 60_000;
export const RATE_LIMIT_EXECUTIONS_PER_MINUTE = 10;

// Every row about one intent shares entityType + entityId = intentId (the
// PROPOSED row's own id). Rows are only ever appended, never updated.
export const INTENT_ENTITY = "AI_ACTION";
export const AUDIT = {
  PROPOSED: "AI_ACTION_PROPOSED",
  APPROVED: "AI_ACTION_APPROVED", // claim row — written before execute runs
  EXECUTED: "AI_ACTION_EXECUTED",
  FAILED: "AI_ACTION_FAILED",
  CANCELLED: "AI_ACTION_CANCELLED",
  DENIED: "AI_ACTION_DENIED",
} as const;

// Any of these means the intent has been decided — a second decision is refused.
export const DECIDED_ACTIONS: readonly string[] = [AUDIT.APPROVED, AUDIT.CANCELLED, AUDIT.DENIED];

export const executeBodySchema = z.object({
  intentId: z.string().min(1).max(64),
  decision: z.enum(["APPROVE", "CANCEL"]),
  // Card-typed values for the proposal's humanFields (PII the model never saw).
  humanInput: z.record(z.string().max(40), z.string().max(300)).optional(),
});

// Checks card-typed input against the fields the proposal asked for: no extra
// keys, every required key present and non-blank. Blank optional values are
// dropped. Format validation is the action's humanSchema, applied after.
export function pickHumanInput(
  fields: readonly { key: string; required: boolean }[],
  input: Record<string, string> | undefined
): { values: Record<string, string> } | { error: string } {
  const allowed = new Set(fields.map((f) => f.key));
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input ?? {})) {
    if (!allowed.has(key)) return { error: "התקבל שדה לא צפוי" };
    const v = raw.trim();
    if (v) values[key] = v;
  }
  const missing = fields.find((f) => f.required && !values[f.key]);
  return missing ? { error: "יש למלא את כל שדות החובה בכרטיס" } : { values };
}

// Only Hebrew messages are user-facing copy; anything else (e.g. "Case not
// found" from a shared action) is an internal detail and gets the generic text.
export function userFacingError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : "";
  return /[\u0590-\u05FF]/.test(msg) && msg.length <= 200 ? msg : fallback;
}

export function intentExpiresAt(proposedAt: Date): Date {
  return new Date(proposedAt.getTime() + INTENT_TTL_MS);
}

export function isIntentExpired(proposedAt: Date, now: Date): boolean {
  return now.getTime() >= proposedAt.getTime() + INTENT_TTL_MS;
}

// Folds the follow-up rows of one intent into its display status. Outcome rows
// win over the APPROVED claim; a claim with no outcome (crash mid-execute) is
// reported FAILED rather than left PENDING forever.
export function deriveIntentStatus(
  followUps: { action: string; metadata?: unknown }[],
  proposedAt: Date,
  now: Date
): { status: IntentStatus; message?: string; entityHref?: string } {
  const meta = (a: string) => {
    const row = followUps.find((r) => r.action === a);
    return row ? ((row.metadata ?? {}) as { message?: string; entityHref?: string }) : null;
  };
  const executed = meta(AUDIT.EXECUTED);
  if (executed) return { status: "EXECUTED", message: executed.message, entityHref: executed.entityHref };
  const failed = meta(AUDIT.FAILED);
  if (failed) return { status: "FAILED", message: failed.message };
  if (meta(AUDIT.CANCELLED)) return { status: "CANCELLED" };
  if (meta(AUDIT.DENIED)) return { status: "DENIED" };
  if (meta(AUDIT.APPROVED)) return { status: "FAILED", message: "הביצוע לא הושלם" };
  return isIntentExpired(proposedAt, now) ? { status: "EXPIRED" } : { status: "PENDING" };
}

// One-line status note appended to model history so the next turn knows
// whether a proposal it made was actually carried out.
export const INTENT_STATUS_NOTE: Record<IntentStatus, string> = {
  PENDING: "ממתינה לאישור המשתמש",
  EXECUTED: "בוצעה לאחר אישור המשתמש",
  FAILED: "נכשלה בביצוע",
  CANCELLED: "בוטלה על ידי המשתמש",
  DENIED: "נדחתה — אין הרשאה",
  EXPIRED: "פג תוקפה ללא אישור",
};

// Safety net for a model that *says* an action awaits approval without having
// called a tool this turn (seen in manual E2E). The prompt forbids it; this
// guarantees the user is never left believing a phantom card exists.
const PENDING_CLAIM_RE = /ממתינ[הו]\s+לאישור|אשר\s+או\s+בטל|בכרטיס\s+האישור|בוצעה\s+לאחר\s+אישור/;

export function claimsPendingAction(text: string): boolean {
  return PENDING_CLAIM_RE.test(text);
}

export const PHANTOM_PROPOSAL_WARNING =
  "\n\n⚠️ לא נוצרה הצעת פעולה בתור הזה ושום דבר לא בוצע. נסח את הבקשה שוב כדי לקבל כרטיס אישור.";

// Staff-typed dates are "YYYY-MM-DD" in Israel local time; anchor at noon UTC
// so the calendar day never shifts across the UTC boundary.
export function parseDay(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

export function formatDay(date: Date | string): string {
  return new Date(date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}
