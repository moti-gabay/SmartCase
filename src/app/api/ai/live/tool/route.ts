// Live Voice Mode tool relay. Live API function calls arrive at the browser;
// it forwards {name, args} here and the server executes against the fixed
// read-only tool set with the *session's* role (never a client-supplied one).
// PII values harvested from the result are returned sealed (see pii-seal.ts)
// so /api/ai/live/commit can mask them in the persisted transcript.
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { executeAssistantTool } from "@/lib/ai/assistant-tools";
import { collectPiiValues } from "@/lib/ai/pii-sanitizer";
import { sealPii } from "@/lib/ai/pii-seal";
import { createRateLimiter } from "@/lib/ai/voice-input";
import { LIVE_TOOL_CALLS_PER_MINUTE } from "@/lib/ai/live-protocol";

export const runtime = "nodejs";

const allow = createRateLimiter(LIVE_TOOL_CALLS_PER_MINUTE, 60_000);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "שגיאת תצורה" }, { status: 500 });
  if (!allow(session.user.id)) {
    return NextResponse.json({ error: "יותר מדי בקשות" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
  if (!name) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

  const started = Date.now();
  const result = await executeAssistantTool(name, args, {
    role: session.user.role,
  });
  return NextResponse.json({
    result,
    ok: !("error" in result),
    ms: Date.now() - started,
    piiSeal: sealPii(collectPiiValues(result), session.user.id, secret),
  });
}
