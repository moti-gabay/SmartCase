// Appointments domain actions. Slot creation / withdrawal run through the
// meeting-slot engine (lead-time + overlap rules) and bookings through the same
// atomic claim the client portal uses (src/lib/services/meeting-slots.ts), so a
// staff booking can never steal a slot a client is claiming at the same moment.
import { Type } from "@google/genai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SLOT_MIN_LEAD_MS } from "@/lib/portal/journey";
import { MAX_SLOT_DURATION_MINUTES, MIN_SLOT_DURATION_MINUTES } from "@/lib/schemas/meeting-slot-schema";
import { createMeetingSlots, deleteMeetingSlot } from "@/lib/workflows/meeting-slot-management";
import { bookSlotForCase, buildMeetingSlotPorts, releaseCaseBooking } from "@/lib/services/meeting-slots";
import { formatDateTime, israelDateTimeToUtc } from "@/lib/ai/tools/intent";
import { resolveCase, resolveSlot } from "@/lib/ai/tools/resolve";
import type { ActionDefinition, DisplayParam } from "@/lib/ai/tools/types";

const STAFF = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

const str = (description: string) => ({ type: Type.STRING, description });
const day = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "שעה בפורמט HH:MM" });
const text = (max: number) => z.string().trim().min(1).max(max);
const isoInstant = z.iso.datetime({ offset: true });

const describeSlot = (s: { startsAt: Date; booked: boolean; isPublished: boolean }) =>
  `${formatDateTime(s.startsAt)} — ${s.booked ? "תפוס" : s.isPublished ? "פנוי" : "מוסתר"}`;

function revalidateScheduling(caseId?: string) {
  revalidatePath("/scheduling");
  revalidatePath("/cases");
  if (caseId) revalidatePath(`/cases/${caseId}`);
}

// The case's current client meeting (published slot). Hearing slots
// (isPublished: false) are owned by the document automation, not these tools.
async function currentBooking(caseId: string) {
  return prisma.meetingSlot.findFirst({
    where: { bookedCaseId: caseId, isPublished: true },
    select: { id: true, startsAt: true },
  });
}

// Shared resolve for book_slot / reschedule_meeting: a free, published slot at
// least SLOT_MIN_LEAD_MS out — the same rules the claim enforces, checked early
// so the card never offers something that will certainly fail.
async function resolveTargetSlot(dayArg: string, timeArg: string) {
  const startsAt = israelDateTimeToUtc(dayArg, timeArg);
  const slot = await resolveSlot(startsAt, describeSlot);
  if ("error" in slot) return slot;
  if (slot.value.bookedCaseId) return { error: "המועד הזה כבר תפוס — בחר מועד פנוי" };
  if (!slot.value.isPublished) return { error: "המועד הזה מוסתר ואינו זמין לקביעה" };
  if (slot.value.startsAt.getTime() < Date.now() + SLOT_MIN_LEAD_MS) {
    return { error: "ניתן לקבוע רק מועד שמתחיל בעוד 24 שעות לפחות" };
  }
  return slot;
}

// ─── create_slot ─────────────────────────────────────────────────────────────

const createArgs = z.object({
  date: day,
  time,
  durationMinutes: z.number().int().min(MIN_SLOT_DURATION_MINUTES).max(MAX_SLOT_DURATION_MINUTES).optional(),
  location: text(200).optional(),
  publish: z.boolean().optional(),
});
const createParams = z.object({
  startsAt: isoInstant,
  durationMinutes: z.number().int().min(MIN_SLOT_DURATION_MINUTES).max(MAX_SLOT_DURATION_MINUTES),
  location: z.string().max(200).optional(),
  isPublished: z.boolean(),
});

const createSlotAction: ActionDefinition<z.infer<typeof createParams>> = {
  name: "create_slot",
  domain: "APPOINTMENTS",
  verb: "CREATE",
  roles: STAFF,
  declaration: {
    name: "create_slot",
    description:
      "הצעה לפרסום מועד פגישה פנוי ביומן המשרד (לקוחות בוחרים ממנו בפורטל). מועד חייב להיות לפחות 24 שעות קדימה ולא לחפוף מועד קיים. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: str("תאריך YYYY-MM-DD"),
        time: str("שעת התחלה HH:MM (שעון ישראל)"),
        durationMinutes: {
          type: Type.INTEGER,
          description: `משך בדקות (${MIN_SLOT_DURATION_MINUTES}-${MAX_SLOT_DURATION_MINUTES}, ברירת מחדל 60)`,
        },
        location: str("מיקום (אופציונלי)"),
        publish: { type: Type.BOOLEAN, description: "האם להציג ללקוחות (ברירת מחדל true)" },
      },
      required: ["date", "time"],
    },
  },
  argsSchema: createArgs,
  paramsSchema: createParams,
  async resolve(raw) {
    const args = createArgs.parse(raw);
    const startsAt = israelDateTimeToUtc(args.date, args.time);
    if (startsAt.getTime() < Date.now() + SLOT_MIN_LEAD_MS) {
      return { error: "מועד חייב להיפתח לפחות 24 שעות מראש" };
    }
    const durationMinutes = args.durationMinutes ?? 60;
    const isPublished = args.publish ?? true;
    const display: DisplayParam[] = [
      ["מועד", formatDateTime(startsAt)],
      ["משך", `${durationMinutes} דקות`],
      ["גלוי ללקוחות", isPublished ? "כן" : "לא"],
    ];
    if (args.location) display.push(["מיקום", args.location]);
    return {
      params: { startsAt: startsAt.toISOString(), durationMinutes, location: args.location, isPublished },
      summaryHebrew: `פרסום מועד פגישה ב-${formatDateTime(startsAt)}`,
      displayParams: display,
    };
  },
  async execute(p) {
    const result = await createMeetingSlots(
      { startsAt: new Date(p.startsAt), durationMinutes: p.durationMinutes, location: p.location, isPublished: p.isPublished },
      buildMeetingSlotPorts(),
      new Date()
    );
    if (result.created.length === 0) {
      return { ok: false, message: result.skipped[0]?.reason ?? "המועד לא נוצר" };
    }
    revalidateScheduling();
    return { ok: true, message: "המועד פורסם", entityHref: "/scheduling" };
  },
};

// ─── book_slot / reschedule_meeting ──────────────────────────────────────────

const bookArgs = z.object({ caseNumber: text(50), date: day, time });
const bookParams = z.object({ caseId: z.string().min(1), slotId: z.string().min(1) });

async function executeBooking(p: z.infer<typeof bookParams>, actorId: string, verb: string) {
  const booked = await bookSlotForCase({
    caseId: p.caseId,
    slotId: p.slotId,
    earliest: new Date(Date.now() + SLOT_MIN_LEAD_MS),
    actorId,
    describe: (startsAt) => `${verb} פגישה ל-${formatDateTime(startsAt)} (על ידי הצוות).`,
  });
  if (!booked) return { ok: false, message: "המועד נתפס בינתיים או שאינו זמין עוד" };
  revalidateScheduling(p.caseId);
  return { ok: true, message: `הפגישה נקבעה ל-${formatDateTime(booked.startsAt)}`, entityHref: `/cases/${p.caseId}` };
}

const bookSlotAction: ActionDefinition<z.infer<typeof bookParams>> = {
  name: "book_slot",
  domain: "APPOINTMENTS",
  verb: "CREATE",
  roles: STAFF,
  declaration: {
    name: "book_slot",
    description:
      "הצעה לקביעת פגישה לתיק במועד פנוי קיים ביומן. אם לתיק כבר יש פגישה — השתמש ב-reschedule_meeting. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        date: str("תאריך המועד YYYY-MM-DD"),
        time: str("שעת המועד HH:MM (שעון ישראל)"),
      },
      required: ["caseNumber", "date", "time"],
    },
  },
  argsSchema: bookArgs,
  paramsSchema: bookParams,
  async resolve(raw) {
    const args = bookArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const existing = await currentBooking(kase.value.id);
    if (existing) {
      return { error: `לתיק כבר נקבעה פגישה ל-${formatDateTime(existing.startsAt)} — השתמש ב-reschedule_meeting` };
    }
    const slot = await resolveTargetSlot(args.date, args.time);
    if ("error" in slot) return slot;
    return {
      params: { caseId: kase.value.id, slotId: slot.value.id },
      summaryHebrew: `קביעת פגישה לתיק ${kase.value.caseNumber} ב-${formatDateTime(slot.value.startsAt)}`,
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["מועד", formatDateTime(slot.value.startsAt)],
        ["משך", `${slot.value.durationMinutes} דקות`],
      ],
    };
  },
  execute: (p, actor) => executeBooking(p, actor.id, "נקבעה"),
};

const rescheduleAction: ActionDefinition<z.infer<typeof bookParams>> = {
  name: "reschedule_meeting",
  domain: "APPOINTMENTS",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "reschedule_meeting",
    description:
      "הצעה להזזת הפגישה הקיימת של תיק למועד פנוי אחר. המועד הקודם משתחרר רק אם הקביעה החדשה מצליחה. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        date: str("תאריך המועד החדש YYYY-MM-DD"),
        time: str("שעת המועד החדש HH:MM (שעון ישראל)"),
      },
      required: ["caseNumber", "date", "time"],
    },
  },
  argsSchema: bookArgs,
  paramsSchema: bookParams,
  async resolve(raw) {
    const args = bookArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const existing = await currentBooking(kase.value.id);
    if (!existing) return { error: "לתיק אין פגישה קבועה — השתמש ב-book_slot" };
    const slot = await resolveTargetSlot(args.date, args.time);
    if ("error" in slot) return slot;
    return {
      params: { caseId: kase.value.id, slotId: slot.value.id },
      summaryHebrew: `הזזת הפגישה של תיק ${kase.value.caseNumber} ל-${formatDateTime(slot.value.startsAt)}`,
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["מועד נוכחי", formatDateTime(existing.startsAt)],
        ["מועד חדש", formatDateTime(slot.value.startsAt)],
      ],
    };
  },
  execute: (p, actor) => executeBooking(p, actor.id, "הוזזה"),
};

// ─── cancel_meeting (release a case's booking) ──────────────────────────────

const cancelArgs = z.object({ caseNumber: text(50) });
const cancelParams = z.object({ caseId: z.string().min(1) });

const cancelMeetingAction: ActionDefinition<z.infer<typeof cancelParams>> = {
  name: "cancel_meeting",
  domain: "APPOINTMENTS",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "cancel_meeting",
    description:
      "הצעה לביטול הפגישה הקבועה של תיק. המועד חוזר להיות פנוי לאחרים. (להסרת מועד פנוי מהיומן — delete_slot.) דורש אישור.",
    parameters: { type: Type.OBJECT, properties: { caseNumber: str("מספר התיק") }, required: ["caseNumber"] },
  },
  argsSchema: cancelArgs,
  paramsSchema: cancelParams,
  async resolve(raw) {
    const args = cancelArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const existing = await currentBooking(kase.value.id);
    if (!existing) return { error: "לתיק אין פגישה קבועה לביטול" };
    return {
      params: { caseId: kase.value.id },
      summaryHebrew: `ביטול הפגישה של תיק ${kase.value.caseNumber}`,
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["מועד", formatDateTime(existing.startsAt)],
        ["אחרי הביטול", "המועד יחזור להיות פנוי"],
      ],
    };
  },
  async execute(p, actor) {
    const released = await releaseCaseBooking(
      p.caseId,
      actor.id,
      (startsAt) => `הפגישה ל-${formatDateTime(startsAt)} בוטלה (על ידי הצוות).`
    );
    if (!released) return { ok: false, message: "לתיק כבר אין פגישה קבועה" };
    revalidateScheduling(p.caseId);
    return { ok: true, message: "הפגישה בוטלה", entityHref: `/cases/${p.caseId}` };
  },
};

// ─── delete_slot (withdraw a free slot) ─────────────────────────────────────

const deleteArgs = z.object({ date: day, time });
const deleteParams = z.object({ slotId: z.string().min(1) });

const deleteSlotAction: ActionDefinition<z.infer<typeof deleteParams>> = {
  name: "delete_slot",
  domain: "APPOINTMENTS",
  verb: "DELETE",
  roles: STAFF,
  destructive: true,
  declaration: {
    name: "delete_slot",
    description: "הצעה להסרת מועד פנוי מהיומן. מועד שכבר נקבע ללקוח אינו ניתן להסרה (בטל קודם את הפגישה). דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: { date: str("תאריך YYYY-MM-DD"), time: str("שעה HH:MM (שעון ישראל)") },
      required: ["date", "time"],
    },
  },
  argsSchema: deleteArgs,
  paramsSchema: deleteParams,
  async resolve(raw) {
    const args = deleteArgs.parse(raw);
    const slot = await resolveSlot(israelDateTimeToUtc(args.date, args.time), describeSlot);
    if ("error" in slot) return slot;
    if (slot.value.bookedCaseId) return { error: "המועד תפוס — יש לבטל קודם את הפגישה (cancel_meeting)" };
    return {
      params: { slotId: slot.value.id },
      summaryHebrew: `הסרת המועד ${formatDateTime(slot.value.startsAt)} מהיומן`,
      displayParams: [
        ["מועד", formatDateTime(slot.value.startsAt)],
        ["משך", `${slot.value.durationMinutes} דקות`],
      ],
    };
  },
  async execute(p) {
    const result = await deleteMeetingSlot(p.slotId, buildMeetingSlotPorts());
    if (!result.deleted) return { ok: false, message: result.reason ?? "הסרת המועד נכשלה" };
    revalidateScheduling();
    return { ok: true, message: "המועד הוסר מהיומן", entityHref: "/scheduling" };
  },
};

export const APPOINTMENT_ACTIONS = [
  createSlotAction,
  bookSlotAction,
  rescheduleAction,
  cancelMeetingAction,
  deleteSlotAction,
];
