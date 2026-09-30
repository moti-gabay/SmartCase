// JEV — deterministic, server-side policy layer for assistant actions. Pure
// types only. Rules run against *resolved* params (ids, ISO instants), never
// raw model args, at proposal time and again under the execute claim lock.
import type { Prisma } from "@/generated/prisma/client";
import type { ActionActor } from "@/lib/ai/tools/types";

export type JevStatus = "ALLOWED" | "BLOCKED" | "WARNING_REQUIRES_ELEVATED_APPROVAL";

export interface JevVerdict {
  ruleId: string;
  status: Exclude<JevStatus, "ALLOWED">;
  reasonHebrew: string;
  metadata?: Record<string, unknown>;
}

export interface JevResult {
  status: JevStatus;
  // Non-ALLOWED verdicts only.
  verdicts: JevVerdict[];
  // Every rule id that ran, for the audit trail.
  evaluated: string[];
}

// Both `prisma` and an interactive-transaction `tx` satisfy this port, so the
// execute-time check reads under the claim lock and tests pass a plain fake.
export type JevReader = Pick<Prisma.TransactionClient, "case" | "task" | "user" | "document">;

export interface JevContext {
  actor: ActionActor;
  db: JevReader;
  now: Date;
}

export interface JevRule<P = unknown> {
  // Stable policy id, e.g. "case.not_in_flight" — also the audit metadata key.
  id: string;
  evaluate(params: P, ctx: JevContext): Promise<JevVerdict | null>;
}

// What the card carries for a WARNING verdict.
export interface JevWarning {
  ruleId: string;
  reasonHebrew: string;
}
