import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import { ALLOWED_MIME, MAX_UPLOAD_SIZE, buildStorageKey, presignUpload } from "@/core/storage/s3-storage";

// PUBLIC, UNAUTHENTICATED. The only credential is the token in the URL. The
// caseId is derived server-side from the token — a checklistItemId is required
// (rather than a free-form documentType) and is verified to belong to that same
// case, so a portal visitor can only ever upload against their own case's
// checklist rows, never an arbitrary document type or another case's item.
const schema = z.object({
  checklistItemId: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().min(1).max(MAX_UPLOAD_SIZE),
  mimeType: z.enum(ALLOWED_MIME as unknown as [string, ...string[]]),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "נתוני מסמך לא תקינים" }, { status: 400 });
    const { checklistItemId, fileName, fileSize, mimeType } = parsed.data;

    const item = await prisma.caseChecklist.findUnique({
      where: { id: checklistItemId },
      select: { caseId: true, template: { select: { documentType: true, displayName: true } } },
    });
    if (!item || item.caseId !== resolved.caseId) {
      return NextResponse.json({ error: "פריט מסמך לא תקין" }, { status: 400 });
    }

    const doc = await prisma.document.create({
      data: {
        caseId: resolved.caseId,
        // uploadedById intentionally omitted — public portal, no session.
        documentType: item.template.documentType,
        displayName: item.template.displayName,
        fileName,
        fileSize,
        mimeType,
        status: "PENDING_UPLOAD",
      },
      select: { id: true },
    });

    const key = buildStorageKey(resolved.caseId, doc.id, fileName);
    await prisma.document.update({ where: { id: doc.id }, data: { storageKey: key } });
    const upload = presignUpload(key, mimeType);

    return NextResponse.json({ documentId: doc.id, upload }, { status: 201 });
  } catch (err) {
    console.error("[public/conversion/presign]", err);
    return NextResponse.json({ error: "יצירת ההעלאה נכשלה" }, { status: 500 });
  }
}
