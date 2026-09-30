import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireStaffSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { headObject, deleteObject, MAX_UPLOAD_SIZE, ALLOWED_MIME } from "@/core/storage/s3-storage";
import { logCaseActivity } from "@/lib/activity";

// Step 3 of the upload: called after the browser has PUT the bytes to R2.
// Since a presigned PUT can't enforce size/type at the edge, we verify the object
// server-side here (HeadObject), delete + reject anything invalid, then promote the
// row to UPLOADED_PENDING_REVIEW, link the checklist item, and recompute the flag.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;
  const { session } = guard;

  try {
    const { id } = await params;
    const { checklistItemId } = await req.json().catch(() => ({}));

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { id: true, caseId: true, storageKey: true, displayName: true },
    });
    if (!doc || !doc.storageKey) return NextResponse.json({ error: "המסמך לא נמצא" }, { status: 404 });

    const head = await headObject(doc.storageKey);
    if (!head) return NextResponse.json({ error: "הקובץ לא נמצא ב-R2" }, { status: 409 });

    // Server-side enforcement (the presigned PUT itself cannot cap these).
    if (head.contentLength < 1 || head.contentLength > MAX_UPLOAD_SIZE) {
      await deleteObject(doc.storageKey).catch(() => {});
      return NextResponse.json({ error: "גודל הקובץ אינו תקין (עד 10MB)" }, { status: 409 });
    }
    if (head.contentType && !(ALLOWED_MIME as readonly string[]).includes(head.contentType)) {
      await deleteObject(doc.storageKey).catch(() => {});
      return NextResponse.json({ error: "סוג קובץ לא נתמך (PDF, JPG או PNG בלבד)" }, { status: 415 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: { status: "UPLOADED_PENDING_REVIEW", fileSize: head.contentLength },
      });

      if (typeof checklistItemId === "string" && checklistItemId) {
        await tx.caseChecklist.update({
          where: { id: checklistItemId },
          data: { documentId: id, status: "UPLOADED_PENDING_REVIEW" },
        });
        const stillMissing = await tx.caseChecklist.count({
          where: { caseId: doc.caseId, status: { in: ["MISSING", "REJECTED"] } },
        });
        await tx.case.update({ where: { id: doc.caseId }, data: { hasMissingDocuments: stillMissing > 0 } });
      }

      await logCaseActivity(
        tx,
        doc.caseId,
        "DOCUMENT_UPLOADED",
        `מסמך הועלה: ${doc.displayName}`,
        { documentId: id },
        session.user.id,
      );
    });

    revalidatePath(`/cases/${doc.caseId}`);
    revalidatePath("/documents");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[documents:confirm]", err);
    return NextResponse.json({ error: "אישור ההעלאה נכשל" }, { status: 500 });
  }
}
