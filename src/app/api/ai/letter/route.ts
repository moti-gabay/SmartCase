import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { generateHebrewLetter } from "@/lib/ai/claude";
import { CASE_TYPE_LABELS } from "@/lib/constants";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  try {
    const { caseId } = await req.json();
    if (!caseId) {
      return NextResponse.json({ error: "חסר מזהה תיק" }, { status: 400 });
    }

    const c = await prisma.case.findUnique({
      where: { id: caseId },
      include: { client: true, assignedAgent: { select: { name: true } } },
    });
    if (!c) {
      return NextResponse.json({ error: "התיק לא נמצא" }, { status: 404 });
    }

    const letter = await generateHebrewLetter({
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
    });

    return NextResponse.json({ letter });
  } catch (err) {
    console.error("[ai/letter]", err);
    return NextResponse.json({ error: "יצירת המכתב נכשלה" }, { status: 500 });
  }
}
