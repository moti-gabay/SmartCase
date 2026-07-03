import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { objectExists } from "@/core/storage/s3-storage";

// Step 3 of the upload: called after the browser has PUT/POSTed the bytes to S3.
// Verifies the object actually landed, promotes the row to UPLOADED_PENDING_REVIEW,
// links the checklist item, and recomputes the case's missing-docs flag.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  try {
    const { id } = await params;
    const { checklistItemId } = await req.json().catch(() => ({}));

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { id: true, caseId: true, storageKey: true },
    });
    if (!doc || !doc.storageKey) return NextResponse.json({ error: "המסמך לא נמצא" }, { status: 404 });

    if (!(await objectExists(doc.storageKey))) {
      return NextResponse.json({ error: "הקובץ לא נמצא ב-S3" }, { status: 409 });
    }

    await prisma.document.update({ where: { id }, data: { status: "UPLOADED_PENDING_REVIEW" } });

    if (typeof checklistItemId === "string" && checklistItemId) {
      await prisma.caseChecklist.update({
        where: { id: checklistItemId },
        data: { documentId: id, status: "UPLOADED_PENDING_REVIEW" },
      });
      const stillMissing = await prisma.caseChecklist.count({
        where: { caseId: doc.caseId, status: { in: ["MISSING", "REJECTED"] } },
      });
      await prisma.case.update({ where: { id: doc.caseId }, data: { hasMissingDocuments: stillMissing > 0 } });
    }

    revalidatePath(`/cases/${doc.caseId}`);
    revalidatePath("/documents");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[documents:confirm]", err);
    return NextResponse.json({ error: "אישור ההעלאה נכשל" }, { status: 500 });
  }
}
