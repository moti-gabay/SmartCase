// Single source of truth for every meeting-slot input shape (staff creation,
// recurring generation, listing, deletion).
//
// MeetingSlot has no `endsAt` column — the end of a slot is *always* derived
// from `startsAt + durationMinutes`, which is why `slotEndsAt` lives here next
// to the duration bounds rather than being re-implemented per call site.
//
// The >24h lead-time rule is a business invariant enforced by the core engine
// (it needs a clock, and a schema that rejects past dates would also reject
// legitimately-old rows on read). Only the constant is exported here so both
// layers agree on the number.

import { z } from "zod";

export const MIN_SLOT_DURATION_MINUTES = 15;
export const MAX_SLOT_DURATION_MINUTES = 240;

// A slot must open at least 24h out, so a client always has a full day to book.
export const MIN_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

export function slotEndsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
}

// Accepts either an ISO string (client payloads) or a Date (server callers).
const dateInput = z.union([z.iso.datetime({ offset: true }), z.date()]).pipe(z.coerce.date());

const durationMinutes = z
  .int()
  .min(MIN_SLOT_DURATION_MINUTES, { message: "משך הפגישה קצר מדי" })
  .max(MAX_SLOT_DURATION_MINUTES, { message: "משך הפגישה ארוך מדי" });

const location = z.string().trim().min(1).max(200).optional();

const isPublished = z.boolean().default(true);

export const createMeetingSlotSchema = z.object({
  startsAt: dateInput,
  durationMinutes,
  location,
  isPublished,
});

// Calendar-day boundaries for the recurring generator; times of day come from
// `timesOfDay`, so these only need to be days.
const dayInput = z.union([z.iso.date(), z.iso.datetime({ offset: true }), z.date()]).pipe(z.coerce.date());

// 0 = Sunday … 6 = Saturday (JS Date.getDay()).
const weekday = z.int().min(0).max(6);

// "HH:MM", 24h.
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "שעה לא תקינה" });

export const generateMeetingSlotsSchema = z.object({
  startDate: dayInput,
  endDate: dayInput,
  weekdays: z.array(weekday).min(1, { message: "יש לבחור לפחות יום אחד" }),
  timesOfDay: z.array(timeOfDay).min(1, { message: "יש לבחור לפחות שעה אחת" }),
  durationMinutes,
  location,
  isPublished,
});

export const listMeetingSlotsSchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
  includeUnpublished: z.boolean().default(false),
});

export const deleteMeetingSlotSchema = z.object({
  id: z.string().min(1),
});

export type CreateMeetingSlotInput = z.infer<typeof createMeetingSlotSchema>;
export type GenerateMeetingSlotsInput = z.infer<typeof generateMeetingSlotsSchema>;
export type ListMeetingSlotsInput = z.infer<typeof listMeetingSlotsSchema>;
export type DeleteMeetingSlotInput = z.infer<typeof deleteMeetingSlotSchema>;
