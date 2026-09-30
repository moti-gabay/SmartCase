// Live Voice Mode tool relay. Live API function calls arrive at the browser;
// it forwards {name, args} here and the server runs them with the *session's*
// user and role (never a client-supplied one).
//
// Read tools execute directly. Action tools only PROPOSE: proposeAction
// persists an AI_ACTION_PROPOSED row and the card payload goes back to the
// drawer. Nothing here can execute or approve a proposal — that happens only
// in /api/ai/actions/execute, called from the card's click handler, so voice
// can never approve (tests/live-voice-actions.test.ts pins this).
//
// PII values harvested from read results are returned sealed (see pii-seal.ts)
// so /api/ai/live/commit can mask them in the persisted transcript.
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { executeAssistantTool } from "@/lib/ai/assistant-tools";
import { isActionTool, proposeAction } from "@/lib/ai/tools/registry";
import type { UserRole } from "@/types";
import { collectPiiValues } from "@/lib/ai/pii-sanitizer";
import { sealPii } from "@/lib/ai/pii-seal";
import { createRateLimiter } from "@/lib/ai/voice-input";
import { LIVE_TOOL_CALLS_PER_MINUTE } from "@/lib/ai/live-protocol";

export const runtime = "nodejs";

const allow = createRateLimiter(LIVE_TOOL_CALLS_PER_MINUTE, 60_000);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "שגיאת תצורה" }, { status: 500 });
  if (!allow(session.user.id)) {
    return NextResponse.json({ error: "יותר מדי בקשות" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
  if (!name) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

  const started = Date.now();

  if (isActionTool(name)) {
    // The conversation id only tags the proposal; it is trusted solely if it
    // belongs to this user.
    let conversationId: string | null = null;
    if (typeof body.conversationId === "string" && body.conversationId) {
      const owned = await prisma.conversation.findFirst({
        where: { id: body.conversationId, userId: session.user.id },
        select: { id: true },
      });
      conversationId = owned?.id ?? null;
    }
    const proposal = await proposeAction(
      name,
      args,
      { id: session.user.id, role: session.user.role as UserRole },
      conversationId
    ).catch((err) => {
      console.error(`[api/ai/live/tool] propose ${name} failed:`, err);
      return { modelResult: { error: "הכנת הפעולה נכשלה" } as Record<string, unknown> };
    });
    // Action args/results carry no read-tool PII to harvest; an empty seal
    // keeps the commit payload shape uniform.
    return NextResponse.json({
      result: proposal.modelResult,
      ok: !("error" in proposal.modelResult),
      ms: Date.now() - started,
      intent: "intent" in proposal ? proposal.intent : undefined,
      piiSeal: sealPii(new Map(), session.user.id, secret),
    });
  }

  const result = await executeAssistantTool(name, args, {
    role: session.user.role,
  });
  return NextResponse.json({
    result,
    ok: !("error" in result),
    ms: Date.now() - started,
    piiSeal: sealPii(collectPiiValues(result), session.user.id, secret),
  });
}
