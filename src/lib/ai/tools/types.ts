// Contract for the assistant's Human-in-the-Loop action layer. Pure types only.
//
// A mutating tool never writes when the model calls it. The call produces a
// ProposedActionIntent that is persisted server-side (src/lib/ai/tools/registry.ts)
// and rendered as a confirmation card. Only an explicit human click on
// /api/ai/actions/execute runs `execute` — with params reloaded from the DB,
// never from the client.
import type { FunctionDeclaration } from "@google/genai";
import type { z } from "zod";
import type { UserRole } from "@/types";
import type { JevRule, JevWarning } from "@/lib/jev/types";

export type ActionDomain =
  | "DASHBOARD"
  | "CASES"
  | "CLIENTS"
  | "TASKS"
  | "DOCUMENTS"
  | "AI"
  | "APPOINTMENTS"
  | "USERS";

export type ActionVerb = "CREATE" | "READ" | "UPDATE" | "DELETE" | "GENERATE" | "EXECUTE";

export interface ActionActor {
  id: string;
  role: UserRole;
}

// [Hebrew label, display value] — order is the order the card renders.
export type DisplayParam = [string, string];

// A value the human types into the card (never the model) — PII that
// maskPii hides from the LLM, e.g. national ID / phone / email. Values travel
// only in the approval request and are validated by the action's humanSchema.
export interface HumanField {
  key: string;
  label: string;
  required: boolean;
  inputType: "text" | "tel" | "email";
  hint?: string;
}

export type ResolveResult<P> =
  | { params: P; summaryHebrew: string; displayParams: DisplayParam[]; humanFields?: HumanField[] }
  // `candidates` lets the model ask the user to disambiguate instead of guessing.
  | { error: string; candidates?: string[] };

export interface ExecResult {
  ok: boolean;
  message: string;
  entityHref?: string;
}

export interface ActionDefinition<P = unknown> {
  name: string;
  domain: ActionDomain;
  verb: Exclude<ActionVerb, "READ">;
  // RBAC — checked at proposal AND again at execution (role may change between).
  roles: readonly UserRole[];
  destructive?: boolean;
  declaration: FunctionDeclaration;
  // Validates raw model args; human identifiers (case number, names) only.
  argsSchema: z.ZodType;
  // Args → resolved internal ids + Hebrew preview. Must not write.
  resolve(args: unknown, actor: ActionActor): Promise<ResolveResult<P>>;
  // Re-validates the params reloaded from the proposal row before execution.
  paramsSchema: z.ZodType<P>;
  // Validates human-typed values; every key optional here — which keys are
  // required is decided per proposal by the humanFields resolve returned.
  humanSchema?: z.ZodType<Record<string, string | undefined>>;
  // Deterministic policy rules (src/lib/jev/) — run on the resolved params at
  // proposal time and again under the claim lock at execution.
  jevRules?: readonly JevRule<P>[];
  execute(params: P, actor: ActionActor, human: Record<string, string | undefined>): Promise<ExecResult>;
}

// What the chat stream sends to the drawer, and what history rehydrates.
export interface ProposedActionIntent {
  intentId: string;
  tool: string;
  domain: ActionDomain;
  action: ActionVerb;
  summaryHebrew: string;
  displayParams: DisplayParam[];
  humanFields?: HumanField[];
  destructive: boolean;
  // JEV warnings the approver must acknowledge on the card.
  warnings?: JevWarning[];
  expiresAt: string;
  status: IntentStatus;
  resultMessage?: string;
  entityHref?: string;
}

export type IntentStatus = "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED" | "DENIED" | "EXPIRED" | "BLOCKED";
