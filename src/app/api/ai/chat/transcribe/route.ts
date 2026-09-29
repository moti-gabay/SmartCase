// Staff-only dictation for the AI assistant drawer: a short recorded clip in,
// plain transcript out. Stateless by design — nothing is persisted and the
// transcript is returned unmasked so the agent can edit it; PII masking happens
// once, at the /api/ai/chat send chokepoint, like any typed message.
import { NextResponse } from "next/server";
import { Type } from "@google/genai";
import { auth } from "@/../auth";
import { getGeminiClient } from "@/lib/ai/gemini";
import { TRANSCRIPTION_MODEL, normalizeTranscript } from "@/lib/ai/transcription";
import { ALLOWED_AUDIO_MIME } from "@/core/storage/s3-storage";
import { MAX_MESSAGE_CHARS } from "@/lib/ai/chat-protocol";
import {
  VOICE_MAX_BYTES,
  VOICE_RATE_LIMIT_PER_MINUTE,
  baseMime,
  buildDictationPrompt,
  createRateLimiter,
  hasAudioSignature,
  parseDictationResult,
} from "@/lib/ai/voice-input";

export const runtime = "nodejs";
export const maxDuration = 60;

const allow = createRateLimiter(VOICE_RATE_LIMIT_PER_MINUTE, 60_000);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  if (!allow(session.user.id)) {
    return NextResponse.json({ error: "יותר מדי הקלטות — נסה שוב בעוד רגע" }, { status: 429 });
  }

  // Reject oversized bodies before buffering the multipart payload.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > VOICE_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "ההקלטה ארוכה מדי" }, { status: 413 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "לא התקבלה הקלטה" }, { status: 400 });
  }
  if (audio.size > VOICE_MAX_BYTES) {
    return NextResponse.json({ error: "ההקלטה ארוכה מדי" }, { status: 413 });
  }
  const mimeType = baseMime(audio.type);
  if (!(ALLOWED_AUDIO_MIME as readonly string[]).includes(mimeType)) {
    return NextResponse.json({ error: "סוג קובץ שמע לא נתמך" }, { status: 415 });
  }

  const bytes = Buffer.from(await audio.arrayBuffer());
  if (!hasAudioSignature(bytes)) {
    return NextResponse.json({ error: "סוג קובץ שמע לא נתמך" }, { status: 415 });
  }

  try {
    const response = await getGeminiClient().models.generateContent({
      model: TRANSCRIPTION_MODEL,
      contents: [
        { inlineData: { mimeType, data: bytes.toString("base64") } },
        { text: buildDictationPrompt() },
      ],
      // has_speech is ordered first so the model commits to a speech/no-speech
      // verdict before generating any text — prompt rules alone did not stop
      // it inventing a sentence for silent audio.
      config: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { has_speech: { type: Type.BOOLEAN }, text: { type: Type.STRING } },
          required: ["has_speech", "text"],
          propertyOrdering: ["has_speech", "text"],
        },
      },
    });
    const raw = parseDictationResult(response.text);
    const text = normalizeTranscript(raw)?.slice(0, MAX_MESSAGE_CHARS) ?? "";
    return NextResponse.json({ text });
  } catch {
    // Deliberately no transcript/audio in logs — it is raw, unmasked PII.
    console.error("[ai/chat/transcribe] Gemini transcription failed");
    return NextResponse.json({ error: "התמלול נכשל" }, { status: 502 });
  }
}
