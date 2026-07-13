import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { summarizeCallHebrew } from "@/lib/ai/gemini";

// Unlock the longer serverless execution budget for AI generation (matches the
// /api/ai/** allocation in vercel.json). Kept explicit so the route carries its
// own contract regardless of platform config.
export const maxDuration = 60;

// Generate-only: raw conversation notes → structured Hebrew summary. Persists
// nothing — the staff member reviews/edits, then commits via commitAiSummary.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  try {
    const { caseId, rawInput } = await req.json().catch(() => ({}));

    if (typeof caseId !== "string" || !caseId) {
      return NextResponse.json({ error: "חסר מזהה תיק" }, { status: 400 });
    }
    if (typeof rawInput !== "string" || rawInput.trim().length < 10) {
      return NextResponse.json({ error: "יש להזין טקסט שיחה לסיכום (לפחות 10 תווים)" }, { status: 400 });
    }

    const exists = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "התיק לא נמצא" }, { status: 404 });

    const summary = await summarizeCallHebrew(rawInput.trim());
    if (!summary.trim()) return NextResponse.json({ error: "יצירת הסיכום נכשלה" }, { status: 502 });

    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[ai/summary]", err);
    return NextResponse.json({ error: "יצירת הסיכום נכשלה" }, { status: 500 });
  }
}
