import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { ALLOWED_MIME, MAX_UPLOAD_SIZE, buildStorageKey, presignUpload } from "@/core/storage/s3-storage";

const schema = z.object({
  caseId: z.string().min(1),
  documentType: z.string().refine((t) => t in DOCUMENT_TYPE_LABELS, "סוג מסמך לא תקין"),
  fileName: z.string().min(1),
  fileSize: z.number().int().min(1).max(MAX_UPLOAD_SIZE),
  mimeType: z.enum(ALLOWED_MIME as unknown as [string, ...string[]]),
  displayName: z.string().optional(),
  checklistItemId: z.string().optional(),
});

// Step 1 of the direct-to-S3 upload: validate, create a PENDING_UPLOAD placeholder
// row, and return a short-lived presigned POST for the browser to upload straight to S3.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "נתוני מסמך לא תקינים" }, { status: 400 });
    }
    const { caseId, documentType, fileName, fileSize, mimeType, displayName, checklistItemId } = parsed.data;

    const caseExists = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!caseExists) return NextResponse.json({ error: "התיק לא נמצא" }, { status: 404 });

    const doc = await prisma.document.create({
      data: {
        caseId,
        uploadedById: session.user.id,
        documentType: documentType as never,
        displayName: displayName?.trim() || DOCUMENT_TYPE_LABELS[documentType] || documentType,
        fileName,
        fileSize,
        mimeType,
        status: "PENDING_UPLOAD",
      },
      select: { id: true },
    });

    const key = buildStorageKey(caseId, doc.id, fileName);
    await prisma.document.update({ where: { id: doc.id }, data: { storageKey: key } });

    const upload = presignUpload(key, mimeType);
    void checklistItemId; // linked at confirm time

    return NextResponse.json({ documentId: doc.id, upload }, { status: 201 });
  } catch (err) {
    console.error("[documents:POST]", err);
    return NextResponse.json({ error: "יצירת ההעלאה נכשלה" }, { status: 500 });
  }
}
