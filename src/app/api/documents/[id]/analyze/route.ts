import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/authz";
import { analyzeAndAutomateDocument } from "@/lib/services/document-analysis";

// Step 4 of the upload, and the entry point of the dynamic document workflow:
// the client calls this after `confirm` succeeded. It is deliberately NOT part
// of the confirm transaction — a multi-second Gemini round trip has no business
// on the upload path, and firing it as a floating promise there would be worse
// still, since Vercel can freeze the function the moment the response is sent.
//
// Staff-only. This reads a case's documents and writes tasks against it, so it
// is nothing like the token-authorized public portal surface. The analysis and
// automation live in src/lib/services/document-analysis.ts (shared with the
// assistant's analyze_document action); this route only maps the outcome.

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;
  const { session } = guard;

  try {
    const { id } = await params;
    const outcome = await analyzeAndAutomateDocument(id, session.user.id);
    if (!outcome.ok) {
      const { status, error, reason } = outcome;
      return NextResponse.json(reason ? { error, reason } : { error }, { status });
    }
    // 207: at least one automation was asked for and failed while others
    // committed. The caller gets the whole picture rather than a bare 500.
    const status = outcome.result.failures.length > 0 ? 207 : 200;
    return NextResponse.json({ analysis: outcome.analysis, result: outcome.result }, { status });
  } catch (err) {
    console.error("[documents:analyze]", err);
    return NextResponse.json({ error: "ניתוח המסמך נכשל" }, { status: 500 });
  }
}
