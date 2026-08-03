import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import { logCaseActivity } from "@/lib/activity";
import { SLOT_MIN_LEAD_MS } from "@/lib/portal/journey";

// PUBLIC, UNAUTHENTICATED. Books one published meeting slot for the case behind
// the token (SCHEDULE_MEETING).
//
// Trust rule, identical to every other public route: the case is resolved from
// the token via resolvePortalToken(), never from the body. The body carries only
// a slotId, and that id is used solely inside a WHERE already pinned to
// "published and not yet booked" — so a crafted id for someone else's booked
// slot matches zero rows and 409s rather than stealing it.
//
// Deliberately a Route Handler and NOT a "use server" action: it trusts a
// caller-supplied row id, so it must never become network-invokable from a
// client component (engineering invariant #2).

const schema = z.object({
  // Honeypot — must arrive empty. See conversion-portal-view.tsx.
  honeypot: z.string().optional(),
  slotId: z.string().min(1),
});

const INVALID = "נתוני הטופס אינם תקינים";
const NOT_FOUND = "קישור לא תקין או שפג תוקפו";
const TAKEN = "המועד נתפס בינתיים. בחרו מועד אחר.";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  // A filled honeypot fails with the SAME generic message as a real validation
  // error — never a distinguishable "bot detected" response.
  if (!parsed.success || (parsed.data.honeypot ?? "") !== "") {
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }
  const { slotId } = parsed.data;

  try {
    const caseId = resolved.caseId;
    // The client's list can be minutes stale, so the lead-time rule is re-checked
    // here against the server's own clock. Only this answer counts.
    const earliest = new Date(Date.now() + SLOT_MIN_LEAD_MS);

    const booked = await prisma.$transaction(async (tx) => {
      // Rebooking releases the case's previous slot first — bookedCaseId is
      // unique, so the claim below would otherwise collide with it. A slot the
      // office created for a court hearing (isPublished: false) is not the
      // client's to release, and is left alone.
      await tx.meetingSlot.updateMany({
        where: { bookedCaseId: caseId, isPublished: true },
        data: { bookedCaseId: null, bookedAt: null },
      });

      // The claim. Every precondition lives in the WHERE, so two clients racing
      // for the last slot cannot both win: the loser's updateMany matches zero
      // rows because bookedCaseId is no longer null.
      const claim = await tx.meetingSlot.updateMany({
        where: {
          id: slotId,
          isPublished: true,
          bookedCaseId: null,
          startsAt: { gte: earliest },
        },
        data: { bookedCaseId: caseId, bookedAt: new Date() },
      });
      if (claim.count === 0) return null;

      const slot = await tx.meetingSlot.findUnique({
        where: { id: slotId },
        select: { id: true, startsAt: true, durationMinutes: true, location: true },
      });
      if (!slot) return null;

      await logCaseActivity(
        tx,
        caseId,
        "MEETING_SCHEDULED",
        `הלקוח קבע פגישה ל-${slot.startsAt.toISOString().slice(0, 16).replace("T", " ")}.`,
        { slotId: slot.id, startsAt: slot.startsAt.toISOString() },
        null,
      );

      return slot;
    });

    // 409, not 404: the slot may well exist — it is simply no longer claimable.
    // The client's correct response is "pick another", which is what this says.
    if (!booked) return NextResponse.json({ error: TAKEN }, { status: 409 });

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return NextResponse.json({
      booked: {
        id: booked.id,
        startsAt: booked.startsAt.toISOString(),
        durationMinutes: booked.durationMinutes,
        location: booked.location,
      },
    });
  } catch (err) {
    console.error("[public/conversion/book]", err);
    return NextResponse.json({ error: "שמירת המועד נכשלה" }, { status: 500 });
  }
}
