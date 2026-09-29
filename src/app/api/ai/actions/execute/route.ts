// Human-in-the-Loop execution gate for assistant actions. The body carries only
// { intentId, decision } — the params that run are the ones persisted when the
// proposal was made, so the browser can never alter what was approved.
//
// Decision is claimed exactly once: a per-intent advisory lock serializes
// concurrent clicks, and the audit trail (append-only) is the state. RBAC is
// re-checked against the *current* session role, not the proposal-time one.
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { getAction, loadIntent } from "@/lib/ai/tools/registry";
import {
  AUDIT,
  DECIDED_ACTIONS,
  INTENT_ENTITY,
  RATE_LIMIT_EXECUTIONS_PER_MINUTE,
  executeBodySchema,
  isIntentExpired,
  pickHumanInput,
  userFacingError,
} from "@/lib/ai/tools/intent";
import type { ActionActor } from "@/lib/ai/tools/types";
import type { UserRole } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const INVALID = "הנתונים שהתקבלו אינם תקינים";

function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const actor: ActionActor = { id: session.user.id, role: session.user.role as UserRole };

  const parsed = executeBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });
  const { intentId, decision, humanInput } = parsed.data;

  const intent = await loadIntent(intentId);
  // Foreign intents are indistinguishable from missing ones.
  if (!intent || intent.userId !== actor.id) {
    return NextResponse.json({ error: "הפעולה לא נמצאה" }, { status: 404 });
  }
  const def = getAction(intent.meta.tool);
  if (!def) return NextResponse.json({ error: "הפעולה אינה נתמכת עוד" }, { status: 410 });

  const ip = clientIp(req);
  const audit = (action: string, metadata: Record<string, unknown> = {}) => ({
    userId: actor.id,
    action,
    entityType: INTENT_ENTITY,
    entityId: intentId,
    metadata: { tool: def.name, ...metadata },
    ipAddress: ip,
  });

  // Card-typed values are checked before the decision is claimed, so a typo
  // is a fixable 400 and does not burn the intent.
  let human: Record<string, string | undefined> = {};
  if (decision === "APPROVE") {
    const picked = pickHumanInput(intent.meta.humanFields ?? [], humanInput);
    if ("error" in picked) return NextResponse.json({ error: picked.error }, { status: 400 });
    if (def.humanSchema) {
      const valid = def.humanSchema.safeParse(picked.values);
      if (!valid.success) {
        return NextResponse.json({ error: valid.error.issues[0]?.message ?? INVALID }, { status: 400 });
      }
      human = valid.data;
    }
  }

  if (decision === "APPROVE") {
    const recent = await prisma.auditLog.count({
      where: { userId: actor.id, action: AUDIT.APPROVED, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent >= RATE_LIMIT_EXECUTIONS_PER_MINUTE) {
      return NextResponse.json({ error: "יותר מדי פעולות — המתן דקה" }, { status: 429 });
    }
  }

  // Claim the decision. Returns the refusal (if any) computed under the lock.
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${intentId}))) AS l`;
    const decided = await tx.auditLog.count({
      where: { entityType: INTENT_ENTITY, entityId: intentId, action: { in: [...DECIDED_ACTIONS] } },
    });
    if (decided > 0) return { status: 409, error: "הפעולה כבר טופלה" } as const;
    if (decision === "CANCEL") {
      await tx.auditLog.create({ data: audit(AUDIT.CANCELLED) });
      return { cancelled: true } as const;
    }
    if (isIntentExpired(intent.createdAt, new Date())) {
      return { status: 410, error: "תוקף ההצעה פג — בקש מהעוזר להציע שוב" } as const;
    }
    if (!(def.roles as readonly string[]).includes(actor.role)) {
      await tx.auditLog.create({ data: audit(AUDIT.DENIED, { role: actor.role }) });
      return { status: 403, error: "אין לך הרשאה לבצע פעולה זו" } as const;
    }
    await tx.auditLog.create({ data: audit(AUDIT.APPROVED) });
    return { approved: true } as const;
  });

  if ("error" in claim) return NextResponse.json({ error: claim.error }, { status: claim.status });
  if ("cancelled" in claim) return NextResponse.json({ ok: true, status: "CANCELLED" });

  // Outside the claim transaction: execute paths own their own writes and
  // revalidation. The APPROVED row already blocks any replay.
  try {
    const params = def.paramsSchema.parse(intent.meta.params);
    const result = await def.execute(params as never, actor, human);
    await prisma.auditLog.create({
      data: audit(result.ok ? AUDIT.EXECUTED : AUDIT.FAILED, {
        message: result.message,
        entityHref: result.entityHref,
        params: intent.meta.params as object,
        // Key names only — the human-typed values are PII and stay out of the log.
        humanFields: Object.keys(human),
      }),
    });
    return NextResponse.json(
      { ok: result.ok, status: result.ok ? "EXECUTED" : "FAILED", message: result.message, entityHref: result.entityHref },
      { status: result.ok ? 200 : 422 }
    );
  } catch (err) {
    console.error(`[api/ai/actions/execute] ${def.name} failed:`, err);
    await prisma.auditLog
      .create({ data: audit(AUDIT.FAILED, { message: userFacingError(err, "שגיאת מערכת") }) })
      .catch((e) => console.error("[api/ai/actions/execute] audit failed:", e));
    return NextResponse.json(
      { ok: false, status: "FAILED", message: userFacingError(err, "הביצוע נכשל") },
      { status: 500 }
    );
  }
}
