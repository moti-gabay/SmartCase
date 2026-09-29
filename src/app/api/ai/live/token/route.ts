// Live Voice Mode handshake. Vercel functions can't hold a WebSocket (and a
// Live session outlives the 60s budget), so the browser connects to Gemini
// directly — authorized by a single-use ephemeral token minted here after the
// staff session check. The session config (model, prompt, read-only tools) is
// locked into the token, so a leaked token can open one session within a
// minute and cannot reconfigure it. GEMINI_API_KEY never leaves the server.
import { NextResponse } from "next/server";
import { Modality } from "@google/genai";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { getGeminiClient } from "@/lib/ai/gemini";
import { buildSystemPrompt } from "@/lib/ai/assistant-prompt";
import { getToolDeclarations } from "@/lib/ai/assistant-tools";
import { HISTORY_MESSAGES } from "@/lib/ai/chat-protocol";
import { createRateLimiter } from "@/lib/ai/voice-input";
import {
  LIVE_MAX_SESSION_MS,
  LIVE_MODEL,
  LIVE_PROMPT_ADDENDUM,
  LIVE_SESSIONS_PER_MINUTE,
  buildHistoryBlock,
} from "@/lib/ai/live-protocol";

export const runtime = "nodejs";

const allow = createRateLimiter(LIVE_SESSIONS_PER_MINUTE, 60_000);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const userId = session.user.id;
  const role = session.user.role;
  if (!allow(userId)) {
    return NextResponse.json({ error: "יותר מדי ניסיונות — נסה שוב בעוד רגע" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  let conversationId: string;
  if (typeof body.conversationId === "string" && body.conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: body.conversationId },
      select: { userId: true },
    });
    if (!conversation || conversation.userId !== userId) {
      return NextResponse.json({ error: "שיחה לא נמצאה" }, { status: 404 });
    }
    conversationId = body.conversationId;
  } else {
    const conversation = await prisma.conversation.create({
      data: { userId, title: "שיחה קולית" },
      select: { id: true },
    });
    conversationId = conversation.id;
  }

  // Already-masked persisted turns — seeds context so voice continues the text thread.
  const history = await prisma.chatMessage.findMany({
    where: { conversationId },
    select: { role: true, content: true },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MESSAGES,
  });
  const systemInstruction =
    buildSystemPrompt(session.user.name ?? "משתמש") +
    LIVE_PROMPT_ADDENDUM +
    buildHistoryBlock(history.reverse().map((m) => ({ role: m.role, text: m.content })));

  try {
    const now = Date.now();
    const token = await getGeminiClient().authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + LIVE_MAX_SESSION_MS).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction,
            tools: [{ functionDeclarations: getToolDeclarations(role) }],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    if (!token.name) throw new Error("empty token");
    return NextResponse.json({
      token: token.name,
      conversationId,
      model: LIVE_MODEL,
    });
  } catch (err) {
    console.error("[api/ai/live/token] mint failed:", err);
    return NextResponse.json({ error: "החיבור לשיחה הקולית נכשל — נסה שוב" }, { status: 502 });
  }
}
