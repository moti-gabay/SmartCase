import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/authz";
import { refineLetter } from "@/lib/services/letters";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;

  try {
    const { id } = await params;
    const { feedback } = await req.json();
    if (typeof feedback !== "string" || !feedback.trim()) {
      return NextResponse.json({ error: "יש להזין הערה לשיפור" }, { status: 400 });
    }

    const content = await refineLetter(id, feedback);
    if (content === null) return NextResponse.json({ error: "המכתב לא נמצא" }, { status: 404 });

    return NextResponse.json({ content });
  } catch (err) {
    console.error("[ai/letter/refine]", err);
    return NextResponse.json({ error: "עדכון המכתב נכשל" }, { status: 500 });
  }
}
