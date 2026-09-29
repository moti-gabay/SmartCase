// Meeting-slot persistence shared by the staff scheduling route, the public
// portal booking route, and the assistant's appointment actions. Plain server
// module — never "use server": bookSlotForCase trusts the caseId it is handed,
// so every caller must have resolved that id from its own trust root (portal
// token, or a staff session + server-side case lookup).
import { prisma } from "@/lib/prisma";
import { logCaseActivity } from "@/lib/activity";
import type { MeetingSlotPorts } from "@/lib/workflows/meeting-slot-management";

// Real ports for the meeting-slot engine. The batch insert is one transaction
// so a partially-written recurring series can never be left behind.
export function buildMeetingSlotPorts(): MeetingSlotPorts {
  return {
    listSlotsInRange: async (from, to) =>
      prisma.meetingSlot.findMany({
        where: { startsAt: { gte: from, lte: to } },
        select: { id: true, startsAt: true, durationMinutes: true },
        orderBy: { startsAt: "asc" },
      }),

    // One transaction for the whole batch: a half-written recurring series is
    // worse than none, since the staff console would show gaps it cannot explain.
    createSlots: async (slots) => {
      if (slots.length === 0) return [];
      await prisma.$transaction(
        slots.map((slot) =>
          prisma.meetingSlot.create({
            data: {
              startsAt: slot.startsAt,
              durationMinutes: slot.durationMinutes,
              location: slot.location ?? null,
              isPublished: slot.isPublished,
            },
            select: { id: true },
          }),
        ),
      );
      return slots;
    },

    findSlot: async (id) =>
      prisma.meetingSlot.findUnique({
        where: { id },
        select: { id: true, startsAt: true, durationMinutes: true, bookedCaseId: true },
      }),

    deleteSlot: async (id) => {
      await prisma.meetingSlot.delete({ where: { id } });
    },
  };
}

export interface BookedSlot {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  location: string | null;
}

// Books one published slot for a case, releasing the case's previous
// published booking in the same transaction (rebooking == rescheduling).
// Returns null when the slot is no longer claimable.
//
// Every precondition lives in the claim's WHERE, so two callers racing for the
// last slot cannot both win: the loser's updateMany matches zero rows because
// bookedCaseId is no longer null. A slot the office created for a court hearing
// (isPublished: false) is never released or claimed here.
export async function bookSlotForCase(input: {
  caseId: string;
  slotId: string;
  earliest: Date;
  actorId: string | null;
  describe: (startsAt: Date) => string;
}): Promise<BookedSlot | null> {
  const { caseId, slotId, earliest, actorId, describe } = input;
  return prisma.$transaction(async (tx) => {
    // bookedCaseId is unique, so the claim below would collide with the case's
    // existing booking unless it is released first.
    await tx.meetingSlot.updateMany({
      where: { bookedCaseId: caseId, isPublished: true },
      data: { bookedCaseId: null, bookedAt: null },
    });

    const claim = await tx.meetingSlot.updateMany({
      where: { id: slotId, isPublished: true, bookedCaseId: null, startsAt: { gte: earliest } },
      data: { bookedCaseId: caseId, bookedAt: new Date() },
    });
    // Throwing rolls back the release above — a failed reschedule must leave
    // the original booking in place, not silently drop it.
    if (claim.count === 0) throw new SlotTakenError();

    const slot = await tx.meetingSlot.findUnique({
      where: { id: slotId },
      select: { id: true, startsAt: true, durationMinutes: true, location: true },
    });
    if (!slot) throw new SlotTakenError();

    await logCaseActivity(
      tx,
      caseId,
      "MEETING_SCHEDULED",
      describe(slot.startsAt),
      { slotId: slot.id, startsAt: slot.startsAt.toISOString() },
      actorId,
    );
    return slot;
  }).catch((err) => {
    if (err instanceof SlotTakenError) return null;
    throw err;
  });
}

class SlotTakenError extends Error {}

// Releases the case's published booking (the slot returns to the pool).
// Hearing slots (isPublished: false) belong to the document automation and are
// left alone. Returns the released slot's start, or null if nothing was booked.
export async function releaseCaseBooking(caseId: string, actorId: string, describe: (startsAt: Date) => string) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.meetingSlot.findFirst({
      where: { bookedCaseId: caseId, isPublished: true },
      select: { id: true, startsAt: true },
    });
    if (!slot) return null;
    await tx.meetingSlot.update({ where: { id: slot.id }, data: { bookedCaseId: null, bookedAt: null } });
    await logCaseActivity(
      tx,
      caseId,
      "MEETING_SCHEDULED",
      describe(slot.startsAt),
      { slotId: slot.id, startsAt: slot.startsAt.toISOString(), released: true },
      actorId,
    );
    return slot.startsAt;
  });
}
