// Client-portal journey state machine (Phase 5 wizard).
//
// Pure module — no Prisma, no side effects — so the guards are unit-testable
// with node:test like s3-storage.ts. Callers (the public advance route) load a
// JourneySnapshot from the DB and ask this module whether the CURRENT step is
// complete. The client never names a target step: the server computes
// nextStep() itself, so a crafted request can never skip ahead.

import type { CaseStep, DocumentStatus } from "@/types";

export const CASE_STEP_ORDER: CaseStep[] = [
  "WELCOME",
  "PROCESS_OVERVIEW",
  "WIZARD_PERSONAL",
  "WIZARD_FAMILY",
  "WIZARD_BACKGROUND",
  "PERSONAL_STORY",
  "WIZARD_REFERENCES",
  "PENDING_DOCS",
  "SCHEDULE_MEETING",
  "TRACKING",
];

// Minimum recommenders the client must save before leaving WIZARD_REFERENCES.
// Two is the office's working rule (a community voice plus a rabbinic one);
// change it here and the guard, the tests and the UI hint all follow.
export const MIN_REFERENCES = 2;

export function nextStep(step: CaseStep): CaseStep | null {
  const i = CASE_STEP_ORDER.indexOf(step);
  if (i < 0 || i === CASE_STEP_ORDER.length - 1) return null;
  return CASE_STEP_ORDER[i + 1];
}

// TRACKING is terminal — everything else the client may advance out of once its
// guard passes. SCHEDULE_MEETING used to be staff-driven too; it became
// client-advanceable when Smart Scheduling shipped and the client gained a way
// to complete it themselves (booking a slot).
export function isClientAdvanceable(step: CaseStep): boolean {
  return step !== "TRACKING";
}

// How far ahead a slot must be for a client to still book it. The office needs
// working notice to prepare a file, and a "book the meeting starting in ten
// minutes" button is a support call waiting to happen. One rule, one place.
export const SLOT_MIN_LEAD_MS = 24 * 60 * 60 * 1000; // 24 hours

// Serializable projection of a MeetingSlot — ISO strings, not Date objects, so
// the same value crosses the server/client boundary and the same predicate runs
// on both sides (the portal filters for display, the route re-checks on booking:
// the client's list can be minutes stale, and only the server's answer counts).
export interface SchedulableSlot {
  id: string;
  startsAt: string;
  durationMinutes: number;
  location: string | null;
  isPublished: boolean;
  isBooked: boolean;
}

export function isSlotSelectable(
  slot: SchedulableSlot,
  now: Date,
  leadMs: number = SLOT_MIN_LEAD_MS
): boolean {
  if (!slot.isPublished || slot.isBooked) return false;
  const startsAt = new Date(slot.startsAt).getTime();
  if (!Number.isFinite(startsAt)) return false; // unparseable date — never offer it
  return startsAt - now.getTime() >= leadMs;
}

// Bookable slots, soonest first. Sorting here (rather than in the query) keeps
// the order identical wherever the list is built.
export function selectableSlots(
  slots: SchedulableSlot[],
  now: Date,
  leadMs: number = SLOT_MIN_LEAD_MS
): SchedulableSlot[] {
  return slots
    .filter((slot) => isSlotSelectable(slot, now, leadMs))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

// Minimal DB-truth projection the guards need. profile is null until the first
// portal submit lazily upserts the ConversionProfile row — guards must treat
// that as "nothing saved yet", never throw.
export interface JourneySnapshot {
  client: {
    phone: string;
    email: string | null;
    addressCity: string | null;
  };
  profile: {
    communityName: string | null;
    sponsoringRabbi: string | null;
    personalStory: string | null;
    // Set once a voice recording is confirmed (PATCH .../story/upload). Its
    // presence alone satisfies PERSONAL_STORY — transcription runs afterwards,
    // so waiting for a transcript would block the client on a background job.
    storyAudioKey: string | null;
  } | null;
  mandatoryChecklist: { status: DocumentStatus }[];
  // Number of saved recommenders. A count is enough because the references
  // route rejects incomplete rows on the way in — a persisted row is a valid
  // one, so there is nothing further to re-validate here.
  referenceCount: number;
  // True once this case holds a booked slot. Presence is the whole guard — the
  // slot's own validity was enforced when it was booked.
  hasBookedMeeting: boolean;
}

export type AdvanceCheck = { ok: true } | { ok: false; reason: string };

const filled = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

// Validates that the CURRENT step is complete (against DB state, never request
// payloads). reason is a stable machine code the future wizard UI maps to the
// i18n dictionary — not display copy.
export function canAdvance(step: CaseStep, s: JourneySnapshot): AdvanceCheck {
  switch (step) {
    case "WELCOME":
    case "PROCESS_OVERVIEW":
      return { ok: true }; // zero-input screens — advancing is the acknowledgement

    case "WIZARD_PERSONAL":
      return filled(s.client.phone) && filled(s.client.email) && filled(s.client.addressCity)
        ? { ok: true }
        : { ok: false, reason: "MISSING_CONTACT_FIELDS" };

    case "WIZARD_FAMILY":
      // Family fields are legitimately optional (no spouse/children is valid),
      // so completion = an explicit save happened, i.e. the profile row exists.
      return s.profile !== null ? { ok: true } : { ok: false, reason: "FAMILY_NOT_SAVED" };

    case "WIZARD_BACKGROUND":
      // Court may be assigned later by the office — not required here.
      return s.profile !== null && filled(s.profile.communityName) && filled(s.profile.sponsoringRabbi)
        ? { ok: true }
        : { ok: false, reason: "MISSING_BACKGROUND_FIELDS" };

    case "PERSONAL_STORY":
      // Written story OR a confirmed recording — the two are equivalent ways of
      // telling the story, and the office accepts either.
      return s.profile !== null && (filled(s.profile.personalStory) || filled(s.profile.storyAudioKey))
        ? { ok: true }
        : { ok: false, reason: "MISSING_PERSONAL_STORY" };

    case "WIZARD_REFERENCES":
      return s.referenceCount >= MIN_REFERENCES
        ? { ok: true }
        : { ok: false, reason: "MISSING_REFERENCES" };

    case "PENDING_DOCS":
      return s.mandatoryChecklist.every(
        (item) => item.status !== "MISSING" && item.status !== "PENDING_UPLOAD"
      )
        ? { ok: true }
        : { ok: false, reason: "MISSING_MANDATORY_DOCUMENTS" };

    case "SCHEDULE_MEETING":
      return s.hasBookedMeeting
        ? { ok: true }
        : { ok: false, reason: "MEETING_NOT_SCHEDULED" };

    // Terminal — the route rejects before reaching here, but keep the machine
    // total so a direct call is still safe.
    case "TRACKING":
      return { ok: false, reason: "JOURNEY_COMPLETE" };
  }
}
