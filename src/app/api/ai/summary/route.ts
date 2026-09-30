import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/authz";
import { generateCallSummary } from "@/lib/services/summaries";

// Unlock the longer serverless execution budget for AI generation (matches the
// /api/ai/** allocation in vercel.json). Kept explicit so the route carries its
// own contract regardless of platform config.
export const maxDuration = 60;

// Generate-only: raw conversation notes → structured Hebrew summary. Persists
// nothing — the staff member reviews/edits, then commits via commitAiSummary.
export async function POST(req: Request) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;

  try {
    const { caseId, rawInput } = await req.json().catch(() => ({}));

    if (typeof caseId !== "string" || !caseId) {
      return NextResponse.json({ error: "חסר מזהה תיק" }, { status: 400 });
    }
    const outcome = await generateCallSummary(caseId, typeof rawInput === "string" ? rawInput : "");
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ summary: outcome.summary });
  } catch (err) {
    console.error("[ai/summary]", err);
    return NextResponse.json({ error: "יצירת הסיכום נכשלה" }, { status: 500 });
  }
}
