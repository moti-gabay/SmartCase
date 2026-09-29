import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import {
  createMeetingSlotSchema,
  deleteMeetingSlotSchema,
  generateMeetingSlotsSchema,
  listMeetingSlotsSchema,
  slotEndsAt,
  type CreateMeetingSlotInput,
  type GenerateMeetingSlotsInput,
} from "@/lib/schemas/meeting-slot-schema";
import {
  DELETE_REASON_BOOKED,
  DELETE_REASON_NOT_FOUND,
  createMeetingSlots,
  deleteMeetingSlot,
  generateRecurringSlots,
} from "@/lib/workflows/meeting-slot-management";
import { buildMeetingSlotPorts as buildPorts } from "@/lib/services/meeting-slots";
import type { UserRole } from "@/types";

// Staff-only meeting-slot administration: list the office calendar, open new
// availability (one slot or a recurring batch), and withdraw a slot.
//
// This is the authenticated mirror of the public portal's read-only
// /api/public/conversion/[token]/slots. Nothing here is token-authorized, so
// the guard is the session role — never a caller-supplied user id or role.
//
// MeetingSlot has no endsAt column; every end time in the response comes from
// slotEndsAt(). Do not re-derive it inline.

const STAFF_ROLES: readonly UserRole[] = ["ADMIN", "SUPERVISOR", "AGENT"];

// One generic message for every validation failure. Zod's issue list names
// internal field paths and bounds, which a staff console has no need for and
// which would leak the shape of the API to anything that reaches this route.
const INVALID = "הנתונים שהתקבלו אינם תקינים";

// Returns the rejection response, or null when the caller is staff. The role is
// read off the server-side session only — a role in the request body is ignored.
async function rejectNonStaff(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  if (!STAFF_ROLES.includes(session.user.role as UserRole)) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }
  return null;
}

const SLOT_SELECT = {
  id: true,
  startsAt: true,
  durationMinutes: true,
  location: true,
  isPublished: true,
  bookedCaseId: true,
  bookedAt: true,
} as const;

type SlotRow = {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  location: string | null;
  isPublished: boolean;
  bookedCaseId: string | null;
  bookedAt: Date | null;
};

function serialize(row: SlotRow) {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: slotEndsAt(row.startsAt, row.durationMinutes).toISOString(),
    durationMinutes: row.durationMinutes,
    location: row.location,
    isPublished: row.isPublished,
    isBooked: row.bookedCaseId !== null,
    bookedCaseId: row.bookedCaseId,
    bookedAt: row.bookedAt?.toISOString() ?? null,
  };
}

export async function GET(req: Request) {
  const denied = await rejectNonStaff();
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const parsed = listMeetingSlotsSchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    includeUnpublished: params.get("includeUnpublished") === "true",
  });
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const { from, to, includeUnpublished } = parsed.data;
    const rows = await prisma.meetingSlot.findMany({
      where: {
        ...(includeUnpublished ? {} : { isPublished: true }),
        ...(from || to ? { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: SLOT_SELECT,
      orderBy: { startsAt: "asc" },
    });
    return NextResponse.json({ slots: rows.map(serialize) });
  } catch (err) {
    console.error("[staff/meeting-slots:GET]", err);
    return NextResponse.json({ error: "טעינת המועדים נכשלה" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await rejectNonStaff();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }

  // `weekdays` is the discriminator: its presence means the caller asked for a
  // recurring batch, its absence means a single slot. Both go through the same
  // orchestrator so lead-time and overlap rules can never diverge.
  const isBulk = typeof body === "object" && body !== null && "weekdays" in body;
  const parsed = isBulk
    ? generateMeetingSlotsSchema.safeParse(body)
    : createMeetingSlotSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const ports = buildPorts();
    const now = new Date();
    const result = isBulk
      ? await generateRecurringSlots(parsed.data as GenerateMeetingSlotsInput, ports, now)
      : await createMeetingSlots(parsed.data as CreateMeetingSlotInput, ports, now);

    const payload = {
      created: result.created.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slotEndsAt(slot.startsAt, slot.durationMinutes).toISOString(),
        durationMinutes: slot.durationMinutes,
        location: slot.location ?? null,
        isPublished: slot.isPublished,
      })),
      skipped: result.skipped.map((skip) => ({
        startsAt: skip.startsAt.toISOString(),
        reason: skip.reason,
      })),
    };

    // Nothing landed: every candidate was refused by a business rule (lead
    // time, overlap, bad range). That is a bad request, not a partial success.
    if (payload.created.length === 0) {
      return NextResponse.json({ error: "לא נוצרו מועדים", ...payload }, { status: 400 });
    }

    revalidatePath("/scheduling");
    // 207: part of the batch landed and part was refused. The caller needs both
    // halves, not a bare success.
    return NextResponse.json(payload, { status: payload.skipped.length > 0 ? 207 : 201 });
  } catch (err) {
    console.error("[staff/meeting-slots:POST]", err);
    return NextResponse.json({ error: "יצירת המועדים נכשלה" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const denied = await rejectNonStaff();
  if (denied) return denied;

  const fromQuery = new URL(req.url).searchParams.get("id");
  let raw: unknown = fromQuery ? { id: fromQuery } : undefined;
  if (!raw) {
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: INVALID }, { status: 400 });
    }
  }
  const parsed = deleteMeetingSlotSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    // The booked-slot refusal is core logic, not a route concern — the engine
    // decides, this only maps its reason onto a status code.
    const result = await deleteMeetingSlot(parsed.data.id, buildPorts());
    if (!result.deleted) {
      const status = result.reason === DELETE_REASON_NOT_FOUND ? 404 : 409;
      return NextResponse.json({ error: result.reason ?? DELETE_REASON_BOOKED }, { status });
    }

    revalidatePath("/scheduling");
    return NextResponse.json({ deleted: parsed.data.id });
  } catch (err) {
    console.error("[staff/meeting-slots:DELETE]", err);
    return NextResponse.json({ error: "מחיקת המועד נכשלה" }, { status: 500 });
  }
}
