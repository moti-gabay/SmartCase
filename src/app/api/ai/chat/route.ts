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
  describeActions,
  getActionDeclarations,
  isActionTool,
  loadIntentCards,
  proposeAction,
} from "@/lib/ai/tools/registry";
import { INTENT_STATUS_NOTE } from "@/lib/ai/tools/intent";
import type { ProposedActionIntent } from "@/lib/ai/tools/types";
import type { UserRole } from "@/types";
import { collectPiiValues, maskPii, type PiiTag } from "@/lib/ai/pii-sanitizer";
import {
  FALLBACK_TEXT,
  HEARTBEAT_MS,
  HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOOL_ROUNDS,
  RATE_LIMIT_MESSAGES_PER_MINUTE,
  STORED_MESSAGE_MAX_CHARS,
  STREAM_DEADLINE_MS,
  sliceMaskSafe,
  sseEncode,
  type ChatSseEvent,
} from "@/lib/ai/chat-protocol";

// Unlock the longer serverless execution budget for AI generation (matches the
// /api/ai/** allocation in vercel.json).
export const runtime = "nodejs";
export const maxDuration = 60;

type ToolRecord = { name: string; ok: boolean; ms: number; intentId?: string };

function intentIdsOf(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((t) => (t && typeof t === "object" ? (t as ToolRecord).intentId : undefined))
    .filter((id): id is string => typeof id === "string");
}

// Full flash (not -lite): the agentic tool loop needs reliable multi-step
// function calling; the other AI features stay on flash-lite.
const CHAT_MODEL = "gemini-2.5-flash";

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
        select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  const rows = conversation ? conversation.messages.reverse() : [];
  // Proposal cards are rebuilt from the audit trail so they show the current
  // status (executed / cancelled / expired), not the proposal-time one.
  const cards = await loadIntentCards(rows.flatMap((m) => intentIdsOf(m.toolCalls)), session.user.id);
  return NextResponse.json({
    conversationId: conversation?.id ?? null,
    messages: rows.map(({ toolCalls, ...m }) => {
      const proposals = intentIdsOf(toolCalls)
        .map((id) => cards.get(id))
        .filter((c): c is ProposedActionIntent => !!c);
      return proposals.length ? { ...m, proposals } : m;
    }),
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
  // Mask before any persistence — Gemini reads this turn back from history,
  // so masking here also covers what the model sees, with no second call site.
  const sanitizedMessage = maskPii(message);

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
      data: { userId, title: sliceMaskSafe(sanitizedMessage, 80) },
      select: { id: true },
    });
    conversationId = conversation.id;
  }

  // Persist the user turn before streaming so it survives any failure below.
  await prisma.chatMessage.create({
    data: { conversationId, role: "USER", content: sliceMaskSafe(sanitizedMessage, STORED_MESSAGE_MAX_CHARS) },
  });

  // History window includes the just-persisted user turn — it is the final
  // `user` content of the request, so no separate append is needed.
  const history = await prisma.chatMessage.findMany({
    where: { conversationId },
    select: { role: true, content: true, toolCalls: true },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MESSAGES,
  });
  // Tell the model how its earlier proposals ended — otherwise it cannot know
  // whether "create the task" was approved, cancelled or left to expire.
  const historyCards = await loadIntentCards(history.flatMap((m) => intentIdsOf(m.toolCalls)), userId);
  const contents: Content[] = history.reverse().map((m) => {
    const notes = intentIdsOf(m.toolCalls)
      .map((id) => historyCards.get(id))
      .filter((c): c is ProposedActionIntent => !!c)
      .map((c) => `[הצעת פעולה: ${c.summaryHebrew} — ${INTENT_STATUS_NOTE[c.status]}]`);
    const text = notes.length ? `${m.content}\n${notes.join("\n")}` : m.content;
    return { role: m.role === "USER" ? "user" : "model", parts: [{ text }] };
  });

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
      // args is intentionally not tracked here — never persisted (see spec:
      // partial search fragments can't be reliably masked, so they're dropped
      // instead).
      const toolRecords: ToolRecord[] = [];
      // PII values seen in tool results this turn (unmasked live — staff are
      // authorized), collected only to mask persisted assistant text.
      const collectedPii = new Map<string, PiiTag>();

      try {
        send("meta", { conversationId });
        const ai = getGeminiClient();
        const config = {
          systemInstruction: buildSystemPrompt(userName, describeActions(role)),
          tools: [{ functionDeclarations: [...getToolDeclarations(role), ...getActionDeclarations(role)] }],
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
            const args = (call.args ?? {}) as Record<string, unknown>;
            let result: Record<string, unknown>;
            let intentId: string | undefined;
            if (deadlineHitMidBatch) {
              result = { error: "תם הזמן הכולל שהוקצב לבדיקה" };
            } else if (isActionTool(name)) {
              // Mutations never run here — they become a persisted proposal
              // the user must approve via /api/ai/actions/execute.
              const proposal = await proposeAction(name, args, { id: userId, role: role as UserRole }, conversationId).catch(
                (err) => {
                  console.error(`[api/ai/chat] propose ${name} failed:`, err);
                  return { modelResult: { error: "הכנת הפעולה נכשלה" } };
                }
              );
              result = proposal.modelResult;
              if ("intent" in proposal) {
                intentId = proposal.intent.intentId;
                send("proposal", proposal.intent);
              }
            } else {
              result = await executeAssistantTool(name, args, { role });
            }
            const ok = !("error" in result);
            collectPiiValues(result, collectedPii);
            toolRecords.push({ name, ok, ms: Date.now() - started, ...(intentId && { intentId }) });
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

        // A proposal with no accompanying text still needs a persisted row —
        // the card is linked to history through its toolCalls.
        if (!fullText.trim() && toolRecords.some((t) => t.intentId)) {
          fullText = "הכנתי הצעה לפעולה — אשר או בטל אותה בכרטיס.";
        } else if (!fullText.trim() && !aborted) {
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
                content: sliceMaskSafe(maskPii(fullText, collectedPii), STORED_MESSAGE_MAX_CHARS),
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
