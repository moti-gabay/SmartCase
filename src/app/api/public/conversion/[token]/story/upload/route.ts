import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import {
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_SIZE,
  baseMimeType,
  buildStoryAudioKey,
  deleteObject,
  headObject,
  objectUrl,
  presignDownload,
  presignUpload,
} from "@/core/storage/s3-storage";

// PUBLIC, UNAUTHENTICATED. Voice recording for the PERSONAL_STORY step.
// Deliberately a Route Handler and NOT a "use server" action: an unauthenticated
// caller drives it, so it must never be exportable as a Server Action.
//
// Trust rule, identical to the other public routes: the case is resolved from
// the token via resolvePortalToken() and the storage key is BUILT server-side
// from that caseId — the client never supplies a key, a caseId or a profile id,
// so there is no cross-case surface at all. The three verbs are:
//   POST   → create the ConversionProfile (lazily) + hand back a presigned PUT
//   PATCH  → confirm after the browser PUT: HeadObject validates real size/type,
//            then the key is persisted and any previous recording is deleted
//   GET    → short-lived presigned playback URL for the stored recording
//
// Size/type cannot be enforced at presign time (R2 has no POST-policy and the
// presigned PUT signs host only), so PATCH is the real gate — an oversized or
// non-audio object is deleted from the bucket and never persisted.

const NOT_FOUND = "קישור לא תקין או שפג תוקפו";
const INVALID = "נתוני ההקלטה אינם תקינים";

const presignSchema = z.object({
  // Honeypot field — must arrive empty. See conversion-portal-view.tsx.
  honeypot: z.string().optional(),
  fileName: z.string().trim().min(1).max(200),
  fileSize: z.number().int().min(1).max(MAX_AUDIO_SIZE),
  mimeType: z
    .string()
    .transform(baseMimeType)
    .refine((m) => (ALLOWED_AUDIO_MIME as readonly string[]).includes(m), { message: "unsupported audio type" }),
});

const confirmSchema = z.object({
  honeypot: z.string().optional(),
  // Echoed back from the POST response; validated below to be exactly the key
  // this route would have issued for this case, so it can never point elsewhere.
  storageKey: z.string().min(1),
});

// The profile row is created lazily on first portal submit; a client who reaches
// the story step before that gets one created here rather than an error.
async function resolveProfile(token: string) {
  const resolved = await resolvePortalToken(token);
  if (!resolved) return null;
  const profile = await prisma.conversionProfile.upsert({
    where: { caseId: resolved.caseId },
    update: {},
    create: { caseId: resolved.caseId },
    select: { id: true, storyAudioKey: true },
  });
  return { caseId: resolved.caseId, profile };
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await resolveProfile(token);
  if (!owner) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const parsed = presignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });
  const { fileName, mimeType, honeypot } = parsed.data;
  // Honeypot tripped — same generic message as a real validation failure.
  if (honeypot) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const stamp = Date.now();
    const key = buildStoryAudioKey(owner.caseId, stamp, fileName);
    const upload = presignUpload(key, mimeType);
    return NextResponse.json({ storageKey: key, upload }, { status: 201 });
  } catch (err) {
    console.error("[public/conversion/story/upload:POST]", err);
    return NextResponse.json({ error: "יצירת ההעלאה נכשלה" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await resolveProfile(token);
  if (!owner) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });
  const { storageKey, honeypot } = parsed.data;
  if (honeypot) return NextResponse.json({ error: INVALID }, { status: 400 });

  // Re-derive the key's shape rather than trusting it: it must sit under this
  // case's own story prefix, so a key belonging to another case (or to the
  // document tree) is rejected before any storage or DB access.
  const prefix = `cases/${owner.caseId}/story/`;
  if (!storageKey.startsWith(prefix) || storageKey.includes("..")) {
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }

  try {
    const head = await headObject(storageKey);
    if (!head) return NextResponse.json({ error: "ההקלטה לא נמצאה באחסון" }, { status: 409 });

    if (head.contentLength < 1 || head.contentLength > MAX_AUDIO_SIZE) {
      await deleteObject(storageKey).catch(() => {});
      return NextResponse.json({ error: "ההקלטה ארוכה מדי (עד 25MB)" }, { status: 409 });
    }
    if (head.contentType && !(ALLOWED_AUDIO_MIME as readonly string[]).includes(baseMimeType(head.contentType))) {
      await deleteObject(storageKey).catch(() => {});
      return NextResponse.json({ error: "סוג קובץ אינו נתמך להקלטה" }, { status: 415 });
    }

    const previousKey = owner.profile.storyAudioKey;
    await prisma.conversionProfile.update({
      where: { id: owner.profile.id },
      data: {
        storyAudioKey: storageKey,
        storyAudioUrl: objectUrl(storageKey),
        // A new recording invalidates any transcript of the previous take.
        storyTranscript: null,
        storyTranscriptionStatus: "PENDING",
      },
    });

    // Best-effort cleanup of the replaced take — the DB already points at the
    // new object, so a failed delete leaves an orphan, never a broken record.
    if (previousKey && previousKey !== storageKey) {
      await deleteObject(previousKey).catch(() => {});
    }

    revalidatePath(`/cases/${owner.caseId}`);
    return NextResponse.json({ ok: true, storageKey });
  } catch (err) {
    console.error("[public/conversion/story/upload:PATCH]", err);
    return NextResponse.json({ error: "שמירת ההקלטה נכשלה" }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  try {
    const profile = await prisma.conversionProfile.findUnique({
      where: { caseId: resolved.caseId },
      select: { storyAudioKey: true },
    });
    if (!profile?.storyAudioKey) return NextResponse.json({ error: "לא נמצאה הקלטה" }, { status: 404 });

    return NextResponse.json({ url: presignDownload(profile.storyAudioKey, "story-recording", null) });
  } catch (err) {
    console.error("[public/conversion/story/upload:GET]", err);
    return NextResponse.json({ error: "טעינת ההקלטה נכשלה" }, { status: 500 });
  }
}
