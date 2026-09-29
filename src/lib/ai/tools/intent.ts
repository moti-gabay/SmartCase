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
});

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

// Staff-typed dates are "YYYY-MM-DD" in Israel local time; anchor at noon UTC
// so the calendar day never shifts across the UTC boundary.
export function parseDay(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

export function formatDay(date: Date | string): string {
  return new Date(date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}
