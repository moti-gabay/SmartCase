import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import { SLOT_MIN_LEAD_MS, selectableSlots, type SchedulableSlot } from "@/lib/portal/journey";

// PUBLIC, UNAUTHENTICATED. Available meeting slots for the SCHEDULE_MEETING
// step, plus this case's own booking if it already has one.
//
// The response is deliberately thin: id, start, duration, location. It never
// exposes which OTHER case booked a slot — a taken slot is simply absent from
// the list, so the portal cannot be used to enumerate the office's clients.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

  try {
    const now = new Date();
    // Pre-filter in SQL on the cheap bounds (published, unbooked, far enough
    // ahead); selectableSlots() then applies the exact same rule the booking
    // route enforces, so the list and the guard can never disagree.
    const rows = await prisma.meetingSlot.findMany({
      where: {
        isPublished: true,
        bookedCaseId: null,
        startsAt: { gte: new Date(now.getTime() + SLOT_MIN_LEAD_MS) },
      },
      select: { id: true, startsAt: true, durationMinutes: true, location: true },
      orderBy: { startsAt: "asc" },
      take: 60,
    });

    const available: SchedulableSlot[] = selectableSlots(
      rows.map((r) => ({
        id: r.id,
        startsAt: r.startsAt.toISOString(),
        durationMinutes: r.durationMinutes,
        location: r.location,
        isPublished: true,
        isBooked: false,
      })),
      now
    );

    const booked = await prisma.meetingSlot.findUnique({
      where: { bookedCaseId: resolved.caseId },
      select: { id: true, startsAt: true, durationMinutes: true, location: true },
    });

    return NextResponse.json({
      available,
      booked: booked
        ? {
            id: booked.id,
            startsAt: booked.startsAt.toISOString(),
            durationMinutes: booked.durationMinutes,
            location: booked.location,
          }
        : null,
    });
  } catch (err) {
    console.error("[public/conversion/slots]", err);
    return NextResponse.json({ error: "טעינת המועדים נכשלה" }, { status: 500 });
  }
}
