// Staff-only AI assistant chat. POST streams the answer over SSE while running
// a bounded Gemini function-calling loop against the read-only tool set; GET
// returns the user's latest (rolling) conversation for drawer hydration.
import { NextResponse } from "next/server";
import {
  FunctionCallingConfigMode,
  type Content,
  type FunctionCall,
  type Part,
} from "@google/genai";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { getGeminiClient } from "@/lib/ai/gemini";
import { buildSystemPrompt } from "@/lib/ai/assistant-prompt";
import { executeAssistantTool, getToolDeclarations } from "@/lib/ai/assistant-tools";
import {
  HEARTBEAT_MS,
  HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOOL_ROUNDS,
  RATE_LIMIT_MESSAGES_PER_MINUTE,
  STORED_MESSAGE_MAX_CHARS,
  STREAM_DEADLINE_MS,
  sseEncode,
  type ChatSseEvent,
} from "@/lib/ai/chat-protocol";

// Unlock the longer serverless execution budget for AI generation (matches the
// /api/ai/** allocation in vercel.json).
export const runtime = "nodejs";
export const maxDuration = 60;

// Full flash (not -lite): the agentic tool loop needs reliable multi-step
// function calling; the other AI features stay on flash-lite.
const CHAT_MODEL = "gemini-2.5-flash";

// Persisted whenever the model produced no usable answer (failure or empty
// output) so an ASSISTANT row always follows the USER row it responds to —
// otherwise the next turn's history has two consecutive "user" contents,
// which Gemini's multi-turn API isn't built to handle.
const FALLBACK_TEXT = "מצטער, אירעה שגיאה ולא הצלחתי לענות. נסה לשלוח את השאלה שוב.";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      messages: {
        select: { id: true, role: true, content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  return NextResponse.json({
    conversationId: conversation?.id ?? null,
    messages: conversation ? conversation.messages.reverse() : [],
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const userId = session.user.id;
  const role = session.user.role;
  const userName = session.user.name ?? "משתמש";

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "יש להזין הודעה (עד 4000 תווים)" }, { status: 400 });
  }

  const recentCount = await prisma.chatMessage.count({
    where: {
      role: "USER",
      conversation: { userId },
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (recentCount >= RATE_LIMIT_MESSAGES_PER_MINUTE) {
    return NextResponse.json({ error: "יותר מדי הודעות — נסה שוב בעוד רגע" }, { status: 429 });
  }

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
      data: { userId, title: message.slice(0, 80) },
      select: { id: true },
    });
    conversationId = conversation.id;
  }

  // Persist the user turn before streaming so it survives any failure below.
  await prisma.chatMessage.create({
    data: { conversationId, role: "USER", content: message.slice(0, STORED_MESSAGE_MAX_CHARS) },
  });

  // History window includes the just-persisted user turn — it is the final
  // `user` content of the request, so no separate append is needed.
  const history = await prisma.chatMessage.findMany({
    where: { conversationId },
    select: { role: true, content: true },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MESSAGES,
  });
  const contents: Content[] = history
    .reverse()
    .map((m) => ({ role: m.role === "USER" ? "user" : "model", parts: [{ text: m.content }] }));

  let aborted = false;
  req.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // enqueue throws once the client has disconnected — swallow, the abort
      // flag stops the loop at the next checkpoint.
      const send = (event: ChatSseEvent, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseEncode(event, data)));
        } catch {
          /* client gone */
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* client gone */
        }
      }, HEARTBEAT_MS);

      const deadline = Date.now() + STREAM_DEADLINE_MS;
      let fullText = "";
      const toolRecords: { name: string; args: unknown; ok: boolean; ms: number }[] = [];

      try {
        send("meta", { conversationId });
        const ai = getGeminiClient();
        const config = {
          systemInstruction: buildSystemPrompt(userName),
          tools: [{ functionDeclarations: getToolDeclarations(role) }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          temperature: 0.3,
        };

        for (let round = 0; round < MAX_TOOL_ROUNDS && !aborted; round++) {
          const response = await ai.models.generateContentStream({ model: CHAT_MODEL, contents, config });
          const calls: FunctionCall[] = [];
          const modelParts: Part[] = [];
          for await (const chunk of response) {
            if (aborted) break;
            if (chunk.text) {
              fullText += chunk.text;
              send("delta", { text: chunk.text });
            }
            modelParts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
            if (chunk.functionCalls?.length) calls.push(...chunk.functionCalls);
          }
          if (aborted || calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS - 1 || Date.now() > deadline) {
            const note = "\n\nלא הצלחתי להשלים את הבדיקה בזמן שהוקצב — נסה לשאול שאלה ממוקדת יותר.";
            fullText += note;
            send("delta", { text: note });
            break;
          }

          // Echo the model turn (incl. its functionCall parts) verbatim, then
          // answer each call with a functionResponse part in a user turn.
          contents.push({ role: "model", parts: modelParts });
          const responseParts: Part[] = [];
          // Every functionCall must get a matching functionResponse (Gemini's
          // turn structure requires it), so a deadline hit mid-batch still
          // answers the remaining calls — just with a synthetic timeout
          // result instead of actually running them — rather than skipping
          // them outright.
          let deadlineHitMidBatch = false;
          for (const call of calls) {
            const name = call.name ?? "";
            send("tool", { name, status: "start" });
            const started = Date.now();
            if (!deadlineHitMidBatch && Date.now() > deadline) deadlineHitMidBatch = true;
            const result = deadlineHitMidBatch
              ? { error: "תם הזמן הכולל שהוקצב לבדיקה" }
              : await executeAssistantTool(name, (call.args ?? {}) as Record<string, unknown>, { role });
            const ok = !("error" in result);
            toolRecords.push({ name, args: call.args ?? {}, ok, ms: Date.now() - started });
            send("tool", { name, status: "end", ok });
            responseParts.push({ functionResponse: { name, response: result } });
          }
          contents.push({ role: "user", parts: responseParts });

          if (deadlineHitMidBatch) {
            const note = "\n\nלא הצלחתי להשלים את הבדיקה בזמן שהוקצב — נסה לשאול שאלה ממוקדת יותר.";
            fullText += note;
            send("delta", { text: note });
            break;
          }
        }

        if (!fullText.trim() && !aborted) {
          fullText = FALLBACK_TEXT;
          send("error", { message: "לא התקבלה תשובה — נסה שוב" });
        }
      } catch (err) {
        console.error("[api/ai/chat] stream failed:", err);
        if (!fullText.trim() && !aborted) fullText = FALLBACK_TEXT;
        send("error", { message: "אירעה שגיאה — נסה שוב" });
      } finally {
        clearInterval(heartbeat);
        // Persist whatever text accumulated — runs on success, error, and
        // client disconnect alike, so history survives all three.
        if (fullText.trim()) {
          try {
            const saved = await prisma.chatMessage.create({
              data: {
                conversationId,
                role: "ASSISTANT",
                content: fullText.slice(0, STORED_MESSAGE_MAX_CHARS),
                toolCalls: toolRecords.length ? JSON.parse(JSON.stringify(toolRecords)) : undefined,
              },
              select: { id: true },
            });
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { updatedAt: new Date() },
            });
            send("done", { messageId: saved.id });
          } catch (err) {
            console.error("[api/ai/chat] persist failed:", err);
            send("error", { message: "התשובה לא נשמרה" });
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
