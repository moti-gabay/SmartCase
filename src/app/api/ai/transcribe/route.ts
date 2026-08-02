import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { presignDownload } from "@/core/storage/s3-storage";
import { getGeminiClient } from "@/lib/ai/gemini";
import {
  TRANSCRIPTION_BATCH_SIZE,
  TRANSCRIPTION_MODEL,
  audioMimeFromKey,
  buildTranscriptionPrompt,
  runTranscriptionBatch,
  type TranscriptionPorts,
} from "@/lib/ai/transcription";

// Transcription worker: drains the queue of recordings sitting at PENDING.
//
// Two ways in, because it needs to run unattended AND be kickable by hand:
//   - a staff session (manual "transcribe now" from the office), or
//   - Authorization: Bearer ${CRON_SECRET}, which is what Vercel Cron sends.
// Both are checked here; there is no unauthenticated path. If CRON_SECRET is
// unset, the bearer branch is disabled entirely rather than defaulting open.
async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const session = await auth();
  return !!session?.user;
}

// Real ports: Prisma for the queue, R2 for the bytes, Gemini for the words.
const ports: TranscriptionPorts = {
  listPending: async (limit) => {
    const rows = await prisma.conversionProfile.findMany({
      where: { storyTranscriptionStatus: "PENDING", storyAudioKey: { not: null } },
      select: { id: true, caseId: true, storyAudioKey: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    return rows.map((r) => ({ profileId: r.id, caseId: r.caseId, storyAudioKey: r.storyAudioKey! }));
  },

  // The status is part of the WHERE, so this is an atomic claim: count === 1
  // means we won it, 0 means another invocation got there first.
  claim: async (profileId) => {
    const res = await prisma.conversionProfile.updateMany({
      where: { id: profileId, storyTranscriptionStatus: "PENDING" },
      data: { storyTranscriptionStatus: "PROCESSING" },
    });
    return res.count === 1;
  },

  // Read through a short-lived presigned GET rather than adding a body-signing
  // path to the storage layer — same signer the staff playback route uses.
  fetchAudio: async (key) => {
    const res = await fetch(presignDownload(key, "story", null));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const headerType = res.headers.get("content-type");
    const mimeType = headerType && headerType.startsWith("audio/") ? headerType : audioMimeFromKey(key);
    return { bytes, mimeType };
  },

  transcribe: async (bytes, mimeType) => {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: TRANSCRIPTION_MODEL,
      contents: [
        { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
        { text: buildTranscriptionPrompt() },
      ],
      config: { maxOutputTokens: 8192 },
    });
    return response.text ?? null;
  },

  finish: async (profileId, status, transcript) => {
    const updated = await prisma.conversionProfile.update({
      where: { id: profileId },
      data: { storyTranscriptionStatus: status, storyTranscript: transcript },
      select: { caseId: true },
    });
    // The staff panel reads the transcript from the server component, so the
    // case page has to be revalidated for the result to actually show up.
    revalidatePath(`/cases/${updated.caseId}`);
  },

  logError: (message, err) => console.error(message, err),
};

export async function POST(req: Request) {
  if (!(await authorize(req))) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  try {
    const result = await runTranscriptionBatch(ports, TRANSCRIPTION_BATCH_SIZE);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai/transcribe]", err);
    return NextResponse.json({ error: "התמלול נכשל" }, { status: 500 });
  }
}
