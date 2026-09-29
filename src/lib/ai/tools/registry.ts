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
import { AUDIT, INTENT_ENTITY, deriveIntentStatus, intentExpiresAt } from "@/lib/ai/tools/intent";
import type { ActionActor, ActionDefinition, DisplayParam, ProposedActionIntent } from "@/lib/ai/tools/types";

const ACTIONS: readonly ActionDefinition<never>[] = [...TASK_ACTIONS] as ActionDefinition<never>[];
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
  domain: string;
  verb: string;
  params: unknown;
  summaryHebrew: string;
  displayParams: DisplayParam[];
  destructive: boolean;
  conversationId: string | null;
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

  const meta: ProposalMeta = {
    tool: def.name,
    domain: def.domain,
    verb: def.verb,
    params: resolved.params,
    summaryHebrew: resolved.summaryHebrew,
    displayParams: resolved.displayParams,
    destructive: !!def.destructive,
    conversationId,
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
      destructive: !!def.destructive,
      expiresAt: intentExpiresAt(row.createdAt).toISOString(),
      status: "PENDING",
    },
    modelResult: {
      status: "PENDING_APPROVAL",
      summary: resolved.summaryHebrew,
      note: "הפעולה לא בוצעה. הוצג למשתמש כרטיס אישור — אמור לו בקצרה לאשר או לבטל בכרטיס, ואל תטען שהפעולה בוצעה.",
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

// Rebuilds card payloads (with current status) for chat history hydration.
export async function loadIntentCards(intentIds: string[], userId: string): Promise<Map<string, ProposedActionIntent>> {
  const out = new Map<string, ProposedActionIntent>();
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
      destructive: meta.destructive,
      expiresAt: intentExpiresAt(p.createdAt).toISOString(),
      status: state.status,
      resultMessage: state.message,
      entityHref: state.entityHref,
    });
  }
  return out;
}
