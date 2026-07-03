import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { generateHebrewLetter } from "@/lib/ai/gemini";
import { CASE_TYPE_LABELS, LETTER_TYPE_LABELS, LETTER_TYPE_INSTRUCTIONS } from "@/lib/constants";

const VALID_TYPES = Object.keys(LETTER_TYPE_LABELS);

// List saved letters for a case.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

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
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  try {
    const { caseId, letterType, context } = await req.json();
    if (!caseId) return NextResponse.json({ error: "חסר מזהה תיק" }, { status: 400 });

    const type = VALID_TYPES.includes(letterType) ? letterType : "CLAIM_REQUEST";

    const c = await prisma.case.findUnique({
      where: { id: caseId },
      include: { client: true, assignedAgent: { select: { name: true } } },
    });
    if (!c) return NextResponse.json({ error: "התיק לא נמצא" }, { status: 404 });

    const content = await generateHebrewLetter({
      clientName: c.client.fullName,
      nationalId: c.client.nationalId,
      dateOfBirth: c.client.dateOfBirth.toLocaleDateString("he-IL"),
      primaryCondition: c.client.primaryCondition ?? "לא צוין",
      recognizedPercentage: c.client.recognizedPercentage ?? undefined,
      claimedPercentage: c.claimedPercentage ?? undefined,
      claimDescription: c.claimDescription ?? undefined,
      caseType: CASE_TYPE_LABELS[c.caseType] ?? c.caseType,
      caseNumber: c.caseNumber,
      agentName: c.assignedAgent?.name ?? session.user.name ?? "צוות SmartCase",
      letterTypeLabel: LETTER_TYPE_LABELS[type],
      letterPurpose: LETTER_TYPE_INSTRUCTIONS[type],
      context: typeof context === "string" && context.trim() ? context.trim() : undefined,
    });

    const title = `${LETTER_TYPE_LABELS[type]} – ${c.client.fullName}`;
    const saved = await prisma.generatedLetter.create({
      data: {
        caseId,
        createdById: session.user.id,
        letterType: type as never,
        title,
        content,
        context: typeof context === "string" && context.trim() ? context.trim() : null,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({
      id: saved.id,
      letterType: type,
      title,
      content,
      createdAt: saved.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[ai/letter]", err);
    return NextResponse.json({ error: "יצירת המכתב נכשלה" }, { status: 500 });
  }
}
