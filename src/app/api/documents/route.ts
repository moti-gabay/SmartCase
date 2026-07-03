import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const caseId = form.get("caseId");
    const documentType = form.get("documentType");
    const checklistItemId = form.get("checklistItemId");
    const displayNameRaw = form.get("displayName");
    const file = form.get("file");

    if (typeof caseId !== "string" || typeof documentType !== "string") {
      return NextResponse.json({ error: "חסרים פרטי מסמך" }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "לא נבחר קובץ" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 10MB)" }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: "סוג קובץ לא נתמך (PDF, JPG או PNG בלבד)" }, { status: 400 });
    }

    const caseExists = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!caseExists) return NextResponse.json({ error: "התיק לא נמצא" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const displayName =
      (typeof displayNameRaw === "string" && displayNameRaw.trim()) ||
      DOCUMENT_TYPE_LABELS[documentType] ||
      documentType;

    const doc = await prisma.document.create({
      data: {
        caseId,
        uploadedById: session.user.id,
        documentType: documentType as never,
        displayName,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        fileData: buffer,
        status: "UPLOADED_PENDING_REVIEW",
      },
      select: { id: true },
    });

    // Link to a checklist item if provided.
    if (typeof checklistItemId === "string" && checklistItemId) {
      await prisma.caseChecklist.update({
        where: { id: checklistItemId },
        data: { documentId: doc.id, status: "UPLOADED_PENDING_REVIEW" },
      });
      // Recompute the case's missing-docs flag from the checklist.
      const stillMissing = await prisma.caseChecklist.count({
        where: { caseId, status: { in: ["MISSING", "REJECTED"] } },
      });
      await prisma.case.update({ where: { id: caseId }, data: { hasMissingDocuments: stillMissing > 0 } });
    }

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/documents");
    return NextResponse.json({ id: doc.id }, { status: 201 });
  } catch (err) {
    console.error("[documents:POST]", err);
    return NextResponse.json({ error: "העלאת המסמך נכשלה" }, { status: 500 });
  }
}
