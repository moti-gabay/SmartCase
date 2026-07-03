import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { refineHebrewLetter } from "@/lib/ai/gemini";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  try {
    const { id } = await params;
    const { feedback } = await req.json();
    if (typeof feedback !== "string" || !feedback.trim()) {
      return NextResponse.json({ error: "יש להזין הערה לשיפור" }, { status: 400 });
    }

    const letter = await prisma.generatedLetter.findUnique({ where: { id }, select: { content: true } });
    if (!letter) return NextResponse.json({ error: "המכתב לא נמצא" }, { status: 404 });

    const content = await refineHebrewLetter(letter.content, feedback.trim());
    await prisma.generatedLetter.update({ where: { id }, data: { content } });

    return NextResponse.json({ content });
  } catch (err) {
    console.error("[ai/letter/refine]", err);
    return NextResponse.json({ error: "עדכון המכתב נכשל" }, { status: 500 });
  }
}
