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

// SCHEDULE_MEETING is staff-driven until the Smart Scheduling module lands;
// TRACKING is terminal. Everything else the client may advance out of (once
// its guard passes).
export function isClientAdvanceable(step: CaseStep): boolean {
  return step !== "SCHEDULE_MEETING" && step !== "TRACKING";
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

    // Not client-advanceable — routes reject before reaching here, but keep the
    // machine total so a direct call is still safe.
    case "SCHEDULE_MEETING":
      return { ok: false, reason: "STAFF_ONLY_TRANSITION" };
    case "TRACKING":
      return { ok: false, reason: "JOURNEY_COMPLETE" };
  }
}
