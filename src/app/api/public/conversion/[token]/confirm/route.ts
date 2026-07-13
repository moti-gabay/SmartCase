import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import { headObject, deleteObject, MAX_UPLOAD_SIZE, ALLOWED_MIME } from "@/core/storage/s3-storage";
import { logCaseActivity } from "@/lib/activity";

// PUBLIC, UNAUTHENTICATED. Mirrors the internal confirm route's HeadObject
// validation, but every id (document, checklist item) is cross-checked against
// the case resolved from the token — never trusted from the request body alone.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

  try {
    const { documentId, checklistItemId } = await req.json().catch(() => ({}));
    if (typeof documentId !== "string") return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, caseId: true, storageKey: true, displayName: true },
    });
    if (!doc || doc.caseId !== resolved.caseId || !doc.storageKey) {
      return NextResponse.json({ error: "המסמך לא נמצא" }, { status: 404 });
    }

    const head = await headObject(doc.storageKey);
    if (!head) return NextResponse.json({ error: "הקובץ לא נמצא באחסון" }, { status: 409 });

    if (head.contentLength < 1 || head.contentLength > MAX_UPLOAD_SIZE) {
      await deleteObject(doc.storageKey).catch(() => {});
      return NextResponse.json({ error: "גודל הקובץ אינו תקין (עד 10MB)" }, { status: 409 });
    }
    if (head.contentType && !(ALLOWED_MIME as readonly string[]).includes(head.contentType)) {
      await deleteObject(doc.storageKey).catch(() => {});
      return NextResponse.json({ error: "סוג קובץ לא נתמך (PDF, JPG או PNG בלבד)" }, { status: 415 });
    }

    // The checklist link is validated against the token-resolved case before the
    // write, so its caseId match is settled outside the transaction. The doc is
    // already confirmed to belong to resolved.caseId above.
    let linkChecklist = false;
    if (typeof checklistItemId === "string" && checklistItemId) {
      const item = await prisma.caseChecklist.findUnique({ where: { id: checklistItemId }, select: { caseId: true } });
      linkChecklist = !!item && item.caseId === resolved.caseId;
    }

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { status: "UPLOADED_PENDING_REVIEW", fileSize: head.contentLength },
      });

      if (linkChecklist) {
        await tx.caseChecklist.update({
          where: { id: checklistItemId },
          data: { documentId, status: "UPLOADED_PENDING_REVIEW" },
        });
        const stillMissing = await tx.caseChecklist.count({
          where: { caseId: resolved.caseId, status: { in: ["MISSING", "REJECTED"] } },
        });
        await tx.case.update({ where: { id: resolved.caseId }, data: { hasMissingDocuments: stillMissing > 0 } });
      }

      // Client-side upload → no staff user (userId null); tagged via metadata.
      await logCaseActivity(
        tx,
        resolved.caseId,
        "DOCUMENT_UPLOADED",
        `מסמך הועלה על ידי הלקוח: ${doc.displayName}`,
        { documentId, via: "portal" },
        null,
      );
    });

    revalidatePath(`/cases/${resolved.caseId}`);
    revalidatePath("/documents");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/conversion/confirm]", err);
    return NextResponse.json({ error: "אישור ההעלאה נכשל" }, { status: 500 });
  }
}
