import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import { canAdvance, isClientAdvanceable, nextStep, type JourneySnapshot } from "@/lib/portal/journey";
import type { CaseStep } from "@/types";

// PUBLIC, UNAUTHENTICATED. Advances the case's portal journey by exactly one
// step. No request body is read — there is nothing client-supplied to trust:
// the case is resolved from the token, the current step comes from the DB, and
// the guard validates DB state (not a payload). Idempotent per state: calling
// again after a successful advance simply validates the NEW current step.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

  try {
    const c = await prisma.case.findUnique({
      where: { id: resolved.caseId },
      select: {
        portalStep: true,
        client: { select: { phone: true, email: true, addressCity: true } },
        conversionProfile: {
          select: { communityName: true, sponsoringRabbi: true, personalStory: true },
        },
        checklist: {
          where: { template: { isMandatory: true } },
          select: { status: true },
        },
      },
    });
    if (!c) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

    const step = c.portalStep as CaseStep;
    if (!isClientAdvanceable(step)) {
      return NextResponse.json(
        { error: "לא ניתן להתקדם בשלב זה", code: step === "TRACKING" ? "JOURNEY_COMPLETE" : "STAFF_ONLY_TRANSITION" },
        { status: 409 }
      );
    }

    const snapshot: JourneySnapshot = {
      client: c.client,
      profile: c.conversionProfile,
      mandatoryChecklist: c.checklist,
    };
    const check = canAdvance(step, snapshot);
    if (!check.ok) {
      return NextResponse.json({ error: "השלב הנוכחי טרם הושלם", code: check.reason }, { status: 409 });
    }

    const next = nextStep(step);
    if (!next) {
      return NextResponse.json({ error: "לא ניתן להתקדם בשלב זה", code: "JOURNEY_COMPLETE" }, { status: 409 });
    }

    await prisma.case.update({ where: { id: resolved.caseId }, data: { portalStep: next } });

    revalidatePath(`/cases/${resolved.caseId}`);
    revalidatePath("/cases");
    return NextResponse.json({ step: next });
  } catch (err) {
    console.error("[public/conversion/advance]", err);
    return NextResponse.json({ error: "העדכון נכשל" }, { status: 500 });
  }
}
