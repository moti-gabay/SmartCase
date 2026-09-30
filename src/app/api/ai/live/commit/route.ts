// Live Voice Mode persistence. The browser posts transcript turns at each
// turnComplete (and once on hang-up); they land in the same Conversation /
// ChatMessage thread as typed chat, masked by the same maskPii pipeline.
// Assistant turns are additionally masked with the exact PII values from this
// session's tool results, carried as server-sealed blobs (pii-seal.ts).
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { maskPii, type PiiTag } from "@/lib/ai/pii-sanitizer";
import { unsealPii } from "@/lib/ai/pii-seal";
import { FALLBACK_TEXT, STORED_MESSAGE_MAX_CHARS, sliceMaskSafe } from "@/lib/ai/chat-protocol";
import { normalizeTurns, parseTurns, withProposalLead } from "@/lib/ai/live-protocol";

export const runtime = "nodejs";

const MAX_SEALS = 50;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const userId = session.user.id;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "שגיאת תצורה" }, { status: 500 });

  // sendBeacon posts text/plain, so parse the raw body rather than req.json().
  const body = await req
    .text()
    .then((t) => JSON.parse(t))
    .catch(() => ({}));
  const turns = parseTurns(body.turns);
  const seals: unknown[] = Array.isArray(body.piiSeals) ? body.piiSeals : [];
  const tools: unknown[] = Array.isArray(body.toolCalls) ? body.toolCalls : [];
  if (!turns || typeof body.conversationId !== "string" || seals.length > MAX_SEALS || tools.length > MAX_SEALS) {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }
  const conversationId: string = body.conversationId;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conversation || conversation.userId !== userId) {
    return NextResponse.json({ error: "שיחה לא נמצאה" }, { status: 404 });
  }

  const known = new Map<string, PiiTag>();
  for (const seal of seals) {
    const values = unsealPii(seal, userId, secret);
    if (!values) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
    for (const [v, tag] of values) known.set(v, tag);
  }

  // Only {name, ok, ms, intentId?} — args are never persisted (see
  // pii-sanitizer.ts). intentId links a voice proposal's card into history;
  // an id that is not this user's proposal simply never rehydrates
  // (loadIntentCards filters by userId).
  const toolRecords = tools
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      name: String(t.name ?? "").slice(0, 64),
      ok: t.ok === true,
      ms: Number(t.ms) || 0,
      ...(typeof t.intentId === "string" && t.intentId.length <= 64 ? { intentId: t.intentId } : {}),
    }));

  const hasProposal = toolRecords.some((t) => "intentId" in t);
  const rows = normalizeTurns(withProposalLead(turns, hasProposal), FALLBACK_TEXT).map((t) => ({
    conversationId,
    role: t.role,
    content: sliceMaskSafe(maskPii(t.text, t.role === "ASSISTANT" ? known : undefined), STORED_MESSAGE_MAX_CHARS),
  }));
  if (rows.length === 0) return NextResponse.json({ saved: 0 });

  // Tool records attach to the batch's first assistant row. Rows are created
  // one by one (not createMany) so createdAt preserves turn order.
  const firstAssistant = rows.findIndex((r) => r.role === "ASSISTANT");
  await prisma.$transaction([
    ...rows.map((data, i) =>
      prisma.chatMessage.create({
        data: {
          ...data,
          toolCalls: i === firstAssistant && toolRecords.length ? toolRecords : undefined,
        },
      })
    ),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);
  return NextResponse.json({ saved: rows.length });
}
