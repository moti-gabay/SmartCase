import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { presignDownload } from "@/core/storage/s3-storage";

// STAFF-ONLY playback of a client's recorded personal story.
//
// Deliberately NOT the portal's /api/public/conversion/[token]/story/upload
// endpoint: that one authorizes on possession of the client's bearer token, so
// reusing it here would mean either handing staff a client credential or
// widening a public route to serve authenticated callers. This route authorizes
// on the staff session instead, and resolves the storage key from the caseId —
// the two trust models stay completely separate.
//
// Mirrors /api/documents/[id]: redirect to a short-lived presigned GET so the
// audio bytes never stream through the function.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;

  const { id } = await params;
  const profile = await prisma.conversionProfile.findUnique({
    where: { caseId: id },
    select: { storyAudioKey: true },
  });
  if (!profile?.storyAudioKey) return NextResponse.json({ error: "לא נמצאה הקלטה" }, { status: 404 });

  const url = presignDownload(profile.storyAudioKey, "personal-story", null);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
