// Staff-side meeting-slot engine: turns one validated staff intent (a single
// slot, or a recurring pattern) into the rows that may actually be written.
//
// Same pure core + injected ports shape as
// src/lib/workflows/document-automation.ts — no Prisma import here, so every
// overlap / lead-time / weekday combination is unit-testable in isolation. The
// real wiring lives in the server actions.
//
// Two rules drive everything: a slot must open more than MIN_LEAD_TIME_MS out,
// and no two slots may overlap. Overlap is checked on half-open [start, end)
// intervals, so a 10:00–10:45 slot and a 10:45–11:30 slot are neighbours, not a
// conflict. Since MeetingSlot has no `endsAt` column, every end is derived via
// `slotEndsAt` — never stored, never recomputed inline.
//
// Conflicts are *reported*, not thrown: generating a month of slots over an
// already-populated calendar is a normal operation, and the staff user wants
// the 18 that landed plus the reasons for the 2 that did not.

import {
  MIN_LEAD_TIME_MS,
  slotEndsAt,
  type CreateMeetingSlotInput,
  type GenerateMeetingSlotsInput,
} from "@/lib/schemas/meeting-slot-schema";

// ── Types ─────────────────────────────────────────────────────────────────────

// A slot the engine wants to write — shaped for a bulk insert, not a DB row yet.
export interface SlotCandidate {
  startsAt: Date;
  durationMinutes: number;
  location?: string;
  isPublished: boolean;
}

// The minimum an already-persisted slot must expose for overlap detection.
export interface ExistingSlot {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  bookedCaseId?: string | null;
}

export interface SkippedSlot {
  startsAt: Date;
  reason: string;
}

export interface MeetingSlotResult {
  // The rows that actually landed, in chronological order.
  created: SlotCandidate[];
  skipped: SkippedSlot[];
}

export interface DeleteSlotResult {
  deleted: boolean;
  reason?: string;
}

export const SKIP_REASON_LEAD_TIME = "מועד הפגישה קרוב מדי — יש לפתוח מועד לפחות 24 שעות מראש";
export const SKIP_REASON_OVERLAP = "קיים מועד חופף בלוח הזמנים";
export const SKIP_REASON_BATCH_OVERLAP = "המועד חופף מועד אחר באותה בקשה";
export const DELETE_REASON_BOOKED = "לא ניתן למחוק מועד שכבר נתפס על ידי לקוח";
export const DELETE_REASON_NOT_FOUND = "המועד לא נמצא";
export const GENERATE_REASON_BAD_RANGE = "תאריך הסיום מוקדם מתאריך ההתחלה";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Pure core ─────────────────────────────────────────────────────────────────

// A slot must open more than 24h out. Strict `>`: exactly-24h is the boundary
// the client would lose to a rounding difference between browser and server.
export function validateLeadTime(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() > MIN_LEAD_TIME_MS;
}

// Half-open [start, end) — back-to-back slots do not overlap.
function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function detectOverlaps(candidates: SlotCandidate[], existing: ExistingSlot[]): SlotCandidate[] {
  return candidates.filter((candidate) => {
    const end = slotEndsAt(candidate.startsAt, candidate.durationMinutes);
    return existing.some((slot) =>
      intervalsOverlap(candidate.startsAt, end, slot.startsAt, slotEndsAt(slot.startsAt, slot.durationMinutes)),
    );
  });
}

// Expands a weekday × time-of-day pattern across the date range.
//
// The range is walked in UTC (`getUTCDay` / `setUTCHours`) because
// `generateMeetingSlotsSchema` coerces "YYYY-MM-DD" to UTC midnight — mixing in
// local getters here would silently shift the weekday for offset-negative
// servers. Both bounds are inclusive.
export function expandRecurringSlots(input: GenerateMeetingSlotsInput): SlotCandidate[] {
  const { startDate, endDate, weekdays, timesOfDay, durationMinutes, location, isPublished } = input;

  const days = new Set(weekdays);
  const candidates: SlotCandidate[] = [];

  const cursor = new Date(startDate.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(endDate.getTime());
  last.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= last.getTime()) {
    if (days.has(cursor.getUTCDay())) {
      for (const time of timesOfDay) {
        const [hours, minutes] = time.split(":").map(Number);
        const startsAt = new Date(cursor.getTime());
        startsAt.setUTCHours(hours, minutes, 0, 0);
        candidates.push({ startsAt, durationMinutes, location, isPublished });
      }
    }
    cursor.setTime(cursor.getTime() + DAY_MS);
  }

  return candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export interface ScreenResult {
  accepted: SlotCandidate[];
  skipped: SkippedSlot[];
}

// Filters a candidate batch against the lead-time rule, the persisted calendar
// and — critically — the batch's own accepted slots, so one generation run can
// never self-collide (two overlapping timesOfDay entries on the same day).
export function screenCandidates(candidates: SlotCandidate[], existing: ExistingSlot[], now: Date): ScreenResult {
  const result: ScreenResult = { accepted: [], skipped: [] };

  for (const candidate of candidates) {
    if (!validateLeadTime(candidate.startsAt, now)) {
      result.skipped.push({ startsAt: candidate.startsAt, reason: SKIP_REASON_LEAD_TIME });
      continue;
    }
    if (detectOverlaps([candidate], existing).length > 0) {
      result.skipped.push({ startsAt: candidate.startsAt, reason: SKIP_REASON_OVERLAP });
      continue;
    }
    // Accepted slots are compared as ExistingSlot so the batch guards itself.
    const accepted: ExistingSlot[] = result.accepted.map((slot, index) => ({
      id: `batch-${index}`,
      startsAt: slot.startsAt,
      durationMinutes: slot.durationMinutes,
    }));
    if (detectOverlaps([candidate], accepted).length > 0) {
      result.skipped.push({ startsAt: candidate.startsAt, reason: SKIP_REASON_BATCH_OVERLAP });
      continue;
    }
    result.accepted.push(candidate);
  }

  return result;
}

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface MeetingSlotPorts {
  // Every slot whose interval could touch [from, to) — the overlap baseline.
  listSlotsInRange: (from: Date, to: Date) => Promise<ExistingSlot[]>;
  // Bulk insert. Returns the rows that actually landed.
  createSlots: (slots: SlotCandidate[]) => Promise<SlotCandidate[]>;
  // Returns null when the id does not exist, so the caller can tell "gone" from
  // "refused"; deletion itself is unconditional — the booked check is core logic.
  findSlot: (id: string) => Promise<ExistingSlot | null>;
  deleteSlot: (id: string) => Promise<void>;
}

// ── Orchestrators ─────────────────────────────────────────────────────────────

// The window handed to `listSlotsInRange` is padded by a full day on each side:
// an existing long slot starting before the first candidate can still overlap it.
function overlapWindow(candidates: SlotCandidate[]): { from: Date; to: Date } {
  const starts = candidates.map((candidate) => candidate.startsAt.getTime());
  const ends = candidates.map((candidate) =>
    slotEndsAt(candidate.startsAt, candidate.durationMinutes).getTime(),
  );
  return {
    from: new Date(Math.min(...starts) - DAY_MS),
    to: new Date(Math.max(...ends) + DAY_MS),
  };
}

async function persist(
  candidates: SlotCandidate[],
  ports: MeetingSlotPorts,
  now: Date,
): Promise<MeetingSlotResult> {
  if (candidates.length === 0) return { created: [], skipped: [] };

  const { from, to } = overlapWindow(candidates);
  const existing = await ports.listSlotsInRange(from, to);
  const screened = screenCandidates(candidates, existing, now);

  if (screened.accepted.length === 0) return { created: [], skipped: screened.skipped };

  const created = await ports.createSlots(screened.accepted);
  return { created, skipped: screened.skipped };
}

export async function createMeetingSlots(
  input: CreateMeetingSlotInput,
  ports: MeetingSlotPorts,
  now: Date,
): Promise<MeetingSlotResult> {
  return persist(
    [
      {
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        location: input.location,
        isPublished: input.isPublished,
      },
    ],
    ports,
    now,
  );
}

export async function generateRecurringSlots(
  input: GenerateMeetingSlotsInput,
  ports: MeetingSlotPorts,
  now: Date,
): Promise<MeetingSlotResult> {
  // Range ordering is a business rule, not a schema rule — reported here rather
  // than thrown so the caller handles one result shape.
  if (input.endDate.getTime() < input.startDate.getTime()) {
    return { created: [], skipped: [{ startsAt: input.startDate, reason: GENERATE_REASON_BAD_RANGE }] };
  }

  return persist(expandRecurringSlots(input), ports, now);
}

// A booked slot is a client commitment; deleting it would orphan the case's
// only booking (bookedCaseId is unique). Unpublishing is the correct escape
// hatch, so this refuses rather than cascading.
export async function deleteMeetingSlot(id: string, ports: MeetingSlotPorts): Promise<DeleteSlotResult> {
  const slot = await ports.findSlot(id);
  if (!slot) return { deleted: false, reason: DELETE_REASON_NOT_FOUND };
  if (slot.bookedCaseId) return { deleted: false, reason: DELETE_REASON_BOOKED };

  await ports.deleteSlot(id);
  return { deleted: true };
}
