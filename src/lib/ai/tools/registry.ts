// Registry of every mutating assistant action, plus the server-owned intent
// lifecycle (propose → load). Plain server module — MUST NOT become
// "use server": `proposeAction` trusts the actor it is handed.
//
// Adding a domain = one `*-tools.ts` file exporting ActionDefinition[] and one
// spread into ACTIONS below. Declarations, RBAC, the prompt catalog and the
// execute route all derive from this list.
import type { FunctionDeclaration } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { TASK_ACTIONS } from "@/lib/ai/tools/tasks-tools";
import { CASE_ACTIONS } from "@/lib/ai/tools/cases-tools";
import { CLIENT_ACTIONS } from "@/lib/ai/tools/clients-tools";
import { APPOINTMENT_ACTIONS } from "@/lib/ai/tools/appointments-tools";
import { DOCUMENT_ACTIONS } from "@/lib/ai/tools/docs-tools";
import { AI_ACTIONS } from "@/lib/ai/tools/ai-tools";
import { USER_ACTIONS } from "@/lib/ai/tools/users-tools";
import { AUDIT, INTENT_ENTITY, JEV_ENTITY, deriveIntentStatus, intentExpiresAt } from "@/lib/ai/tools/intent";
import { blockedReason, evaluateJev, toWarnings } from "@/lib/jev/engine";
import type { JevResult } from "@/lib/jev/types";
import type { ActionActor, ActionDefinition, DisplayParam, HumanField, ProposedActionIntent } from "@/lib/ai/tools/types";

const ACTIONS: readonly ActionDefinition<never>[] = [
  ...TASK_ACTIONS,
  ...CASE_ACTIONS,
  ...CLIENT_ACTIONS,
  ...APPOINTMENT_ACTIONS,
  ...DOCUMENT_ACTIONS,
  ...AI_ACTIONS,
  ...USER_ACTIONS,
] as ActionDefinition<never>[];
const BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));

export function getAction(name: string): ActionDefinition<never> | undefined {
  return BY_NAME.get(name);
}

export function isActionTool(name: string): boolean {
  return BY_NAME.has(name);
}

export function getActionDeclarations(role: string): FunctionDeclaration[] {
  return ACTIONS.filter((a) => (a.roles as readonly string[]).includes(role)).map((a) => a.declaration);
}

// Compact catalog for the system prompt, filtered by role so the model never
// learns about actions it could not have approved anyway.
export function describeActions(role: string): string {
  return ACTIONS.filter((a) => (a.roles as readonly string[]).includes(role))
    .map((a) => `- ${a.name}: ${a.declaration.description} (חובה: ${(a.declaration.parameters?.required ?? []).join(", ") || "—"})`)
    .join("\n");
}

interface ProposalMeta {
  tool: string;
  // The model's validated args, kept so history can replay the real call —
  // replaying `args: {}` taught the model to call action tools with no args.
  // Never contains card-typed PII (not a model param; see the registry test).
  args?: Record<string, unknown>;
  domain: string;
  verb: string;
  params: unknown;
  summaryHebrew: string;
  displayParams: DisplayParam[];
  humanFields?: HumanField[];
  destructive: boolean;
  conversationId: string | null;
  // Proposal-time JEV evaluation — this PROPOSED row is its audit record.
  jev?: JevResult;
}

// Validates + resolves model args and persists the proposal. Returns the card
// payload for the UI and the (id-free) result the model sees.
export async function proposeAction(
  name: string,
  rawArgs: unknown,
  actor: ActionActor,
  conversationId: string | null
): Promise<{ intent: ProposedActionIntent; modelResult: Record<string, unknown> } | { modelResult: Record<string, unknown> }> {
  const def = getAction(name);
  if (!def) return { modelResult: { error: "כלי לא מוכר" } };
  if (!(def.roles as readonly string[]).includes(actor.role)) {
    return { modelResult: { error: "אין לך הרשאה לבצע פעולה זו" } };
  }
  const parsed = def.argsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      modelResult: {
        error: "פרמטרים חסרים או לא תקינים — שאל את המשתמש",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 5),
      },
    };
  }
  const resolved = await def.resolve(parsed.data, actor);
  if ("error" in resolved) return { modelResult: { ...resolved } };

  const jev = await evaluateJev(def.jevRules as never, resolved.params as never, { actor, db: prisma, now: new Date() });
  if (jev.status === "BLOCKED") {
    const reason = blockedReason(jev);
    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: AUDIT.JEV_BLOCKED,
        entityType: JEV_ENTITY,
        entityId: def.name,
        metadata: JSON.parse(JSON.stringify({ tool: def.name, phase: "PROPOSE", args: parsed.data, verdicts: jev.verdicts, evaluated: jev.evaluated })),
      },
    });
    return {
      modelResult: {
        error: reason,
        blocked: true,
        note: "הפעולה נחסמה ע״י מדיניות המערכת ולא הוצג כרטיס. הסבר למשתמש את הסיבה ואל תנסה שוב באותם פרמטרים.",
      },
    };
  }
  const warnings = toWarnings(jev);

  const meta: ProposalMeta = {
    tool: def.name,
    args: parsed.data as Record<string, unknown>,
    domain: def.domain,
    verb: def.verb,
    params: resolved.params,
    summaryHebrew: resolved.summaryHebrew,
    displayParams: resolved.displayParams,
    humanFields: resolved.humanFields,
    destructive: !!def.destructive,
    conversationId,
    jev: jev.evaluated.length ? jev : undefined,
  };
  const row = await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: AUDIT.PROPOSED,
      entityType: INTENT_ENTITY,
      entityId: def.name,
      metadata: JSON.parse(JSON.stringify(meta)),
    },
    select: { id: true, createdAt: true },
  });
  return {
    intent: {
      intentId: row.id,
      tool: def.name,
      domain: def.domain,
      action: def.verb,
      summaryHebrew: resolved.summaryHebrew,
      displayParams: resolved.displayParams,
      humanFields: resolved.humanFields,
      destructive: !!def.destructive,
      warnings: warnings.length ? warnings : undefined,
      expiresAt: intentExpiresAt(row.createdAt).toISOString(),
      status: "PENDING",
    },
    modelResult: {
      status: "PENDING_APPROVAL",
      summary: resolved.summaryHebrew,
      note: resolved.humanFields?.length
        ? "הפעולה לא בוצעה. הוצג למשתמש כרטיס אישור עם שדות שעליו למלא בעצמו (פרטים מזהים) — אמור לו למלא אותם בכרטיס ולאשר. אל תבקש ממנו לכתוב אותם בצ'אט."
        : "הפעולה לא בוצעה. הוצג למשתמש כרטיס אישור — אמור לו בקצרה לאשר או לבטל בכרטיס, ואל תטען שהפעולה בוצעה.",
      ...(warnings.length && { warnings: warnings.map((w) => w.reasonHebrew), warningNote: "בכרטיס מוצגות אזהרות מדיניות שהמשתמש חייב לאשר במפורש — הזכר זאת בקצרה." }),
    },
  };
}

export interface LoadedIntent {
  id: string;
  userId: string | null;
  createdAt: Date;
  meta: ProposalMeta;
}

export async function loadIntent(intentId: string): Promise<LoadedIntent | null> {
  const row = await prisma.auditLog.findFirst({
    where: { id: intentId, action: AUDIT.PROPOSED, entityType: INTENT_ENTITY },
    select: { id: true, userId: true, createdAt: true, metadata: true },
  });
  return row ? { id: row.id, userId: row.userId, createdAt: row.createdAt, meta: row.metadata as unknown as ProposalMeta } : null;
}

// Server-side card: the UI payload plus the model args for history replay.
// Strip `args` before anything leaves the server.
export type IntentCard = ProposedActionIntent & { args?: Record<string, unknown> };

export function toClientCard(card: IntentCard): ProposedActionIntent {
  const out = { ...card };
  delete out.args;
  return out;
}

// Rebuilds card payloads (with current status) for chat history hydration.
export async function loadIntentCards(intentIds: string[], userId: string): Promise<Map<string, IntentCard>> {
  const out = new Map<string, IntentCard>();
  if (intentIds.length === 0) return out;
  const [proposals, followUps] = await Promise.all([
    prisma.auditLog.findMany({
      where: { id: { in: intentIds }, action: AUDIT.PROPOSED, userId },
      select: { id: true, createdAt: true, metadata: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: INTENT_ENTITY, entityId: { in: intentIds }, action: { not: AUDIT.PROPOSED } },
      select: { entityId: true, action: true, metadata: true },
    }),
  ]);
  const now = new Date();
  for (const p of proposals) {
    const meta = p.metadata as unknown as ProposalMeta;
    const state = deriveIntentStatus(followUps.filter((f) => f.entityId === p.id), p.createdAt, now);
    out.set(p.id, {
      intentId: p.id,
      tool: meta.tool,
      domain: meta.domain as ProposedActionIntent["domain"],
      action: meta.verb as ProposedActionIntent["action"],
      summaryHebrew: meta.summaryHebrew,
      displayParams: meta.displayParams,
      humanFields: meta.humanFields,
      destructive: meta.destructive,
      warnings: meta.jev ? toWarnings(meta.jev) : undefined,
      expiresAt: intentExpiresAt(p.createdAt).toISOString(),
      status: state.status,
      resultMessage: state.message,
      entityHref: state.entityHref,
      args: meta.args,
    });
  }
  return out;
}
