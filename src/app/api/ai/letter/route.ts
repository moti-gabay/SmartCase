import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { generateLetter } from "@/lib/services/letters";

// List saved letters for a case.
export async function GET(req: Request) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;

  const caseId = new URL(req.url).searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ letters: [] });

  const letters = await prisma.generatedLetter.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({
    letters: letters.map((l) => ({
      id: l.id,
      letterType: l.letterType,
      title: l.title,
      content: l.content,
      context: l.context,
      createdAt: l.createdAt.toISOString(),
      createdByName: l.createdBy?.name ?? null,
    })),
  });
}

// Generate a letter with Claude and save it.
export async function POST(req: Request) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;

  try {
    const { caseId, letterType, context } = await req.json();
    if (!caseId) return NextResponse.json({ error: "חסר מזהה תיק" }, { status: 400 });

    const letter = await generateLetter({
      caseId,
      letterType,
      context: typeof context === "string" ? context : undefined,
      actor: { id: guard.session.user.id, name: guard.session.user.name },
    });
    if (!letter) return NextResponse.json({ error: "התיק לא נמצא" }, { status: 404 });

    return NextResponse.json({
      id: letter.id,
      letterType: letter.letterType,
      title: letter.title,
      content: letter.content,
      createdAt: letter.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[ai/letter]", err);
    return NextResponse.json({ error: "יצירת המכתב נכשלה" }, { status: 500 });
  }
}
