import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASE_STEP_ORDER,
  nextStep,
  isClientAdvanceable,
  canAdvance,
  type JourneySnapshot,
} from "../src/lib/portal/journey";
import type { CaseStep, DocumentStatus } from "../src/types";

// Baseline snapshot where every guard passes; tests override slices to fail.
const complete = (): JourneySnapshot => ({
  client: { phone: "050-1234567", email: "client@example.com", addressCity: "ירושלים" },
  profile: {
    communityName: "קהילת מרכז",
    sponsoringRabbi: "הרב כהן",
    personalStory: "הסיפור האישי שלי על הדרך ליהדות.",
  },
  mandatoryChecklist: [{ status: "UPLOADED_PENDING_REVIEW" }, { status: "APPROVED" }],
});

// Fresh case: nothing saved yet — profile row doesn't exist (lazy creation).
const empty = (): JourneySnapshot => ({
  client: { phone: "", email: null, addressCity: null },
  profile: null,
  mandatoryChecklist: [{ status: "MISSING" }],
});

// ── step ordering ──────────────────────────────────────────────────────────────

test("nextStep walks the full journey in order and returns null at the end", () => {
  for (let i = 0; i < CASE_STEP_ORDER.length - 1; i++) {
    assert.equal(nextStep(CASE_STEP_ORDER[i]), CASE_STEP_ORDER[i + 1]);
  }
  assert.equal(nextStep("TRACKING"), null);
});

test("isClientAdvanceable blocks exactly the staff-driven and terminal steps", () => {
  const blocked = CASE_STEP_ORDER.filter((s) => !isClientAdvanceable(s));
  assert.deepEqual(blocked, ["SCHEDULE_MEETING", "TRACKING"]);
});

// ── zero-input screens ─────────────────────────────────────────────────────────

test("WELCOME and PROCESS_OVERVIEW advance unconditionally", () => {
  for (const step of ["WELCOME", "PROCESS_OVERVIEW"] as CaseStep[]) {
    assert.deepEqual(canAdvance(step, empty()), { ok: true });
  }
});

// ── WIZARD_PERSONAL ────────────────────────────────────────────────────────────

test("WIZARD_PERSONAL requires phone, email and city", () => {
  assert.deepEqual(canAdvance("WIZARD_PERSONAL", complete()), { ok: true });

  const noEmail = complete();
  noEmail.client.email = null;
  assert.deepEqual(canAdvance("WIZARD_PERSONAL", noEmail), { ok: false, reason: "MISSING_CONTACT_FIELDS" });

  const noCity = complete();
  noCity.client.addressCity = "";
  assert.equal(canAdvance("WIZARD_PERSONAL", noCity).ok, false);
});

test("WIZARD_PERSONAL rejects whitespace-only contact fields (trimmed validation)", () => {
  const s = complete();
  s.client.phone = "   ";
  assert.deepEqual(canAdvance("WIZARD_PERSONAL", s), { ok: false, reason: "MISSING_CONTACT_FIELDS" });
});

// ── WIZARD_FAMILY (lazy profile generation) ────────────────────────────────────

test("WIZARD_FAMILY fails safely when the profile row doesn't exist yet", () => {
  const s = complete();
  s.profile = null; // lazy creation: no submit has happened yet
  assert.deepEqual(canAdvance("WIZARD_FAMILY", s), { ok: false, reason: "FAMILY_NOT_SAVED" });
});

test("WIZARD_FAMILY passes once a profile row exists, even with all-empty family fields", () => {
  const s = complete();
  s.profile = { communityName: null, sponsoringRabbi: null, personalStory: null };
  assert.deepEqual(canAdvance("WIZARD_FAMILY", s), { ok: true });
});

// ── WIZARD_BACKGROUND ──────────────────────────────────────────────────────────

test("WIZARD_BACKGROUND requires community and rabbi, never throws on null profile", () => {
  assert.deepEqual(canAdvance("WIZARD_BACKGROUND", complete()), { ok: true });

  const nullProfile = complete();
  nullProfile.profile = null;
  assert.deepEqual(canAdvance("WIZARD_BACKGROUND", nullProfile), { ok: false, reason: "MISSING_BACKGROUND_FIELDS" });

  const noRabbi = complete();
  noRabbi.profile!.sponsoringRabbi = "  ";
  assert.equal(canAdvance("WIZARD_BACKGROUND", noRabbi).ok, false);
});

// ── PERSONAL_STORY (trimmed length validation) ─────────────────────────────────

test("PERSONAL_STORY requires a non-empty trimmed story", () => {
  assert.deepEqual(canAdvance("PERSONAL_STORY", complete()), { ok: true });

  for (const story of [null, "", "   ", "\n\t "]) {
    const s = complete();
    s.profile!.personalStory = story;
    assert.deepEqual(canAdvance("PERSONAL_STORY", s), { ok: false, reason: "MISSING_PERSONAL_STORY" });
  }

  const nullProfile = complete();
  nullProfile.profile = null;
  assert.equal(canAdvance("PERSONAL_STORY", nullProfile).ok, false);
});

// ── PENDING_DOCS ───────────────────────────────────────────────────────────────

test("PENDING_DOCS requires every mandatory item past MISSING/PENDING_UPLOAD", () => {
  assert.deepEqual(canAdvance("PENDING_DOCS", complete()), { ok: true });

  for (const status of ["MISSING", "PENDING_UPLOAD"] as DocumentStatus[]) {
    const s = complete();
    s.mandatoryChecklist = [{ status: "APPROVED" }, { status }];
    assert.deepEqual(canAdvance("PENDING_DOCS", s), { ok: false, reason: "MISSING_MANDATORY_DOCUMENTS" });
  }

  // No mandatory items at all → vacuously complete.
  const none = complete();
  none.mandatoryChecklist = [];
  assert.deepEqual(canAdvance("PENDING_DOCS", none), { ok: true });
});

// ── staff-driven / terminal steps stay safe even if called directly ────────────

test("SCHEDULE_MEETING and TRACKING never client-advance, even with a complete snapshot", () => {
  assert.deepEqual(canAdvance("SCHEDULE_MEETING", complete()), { ok: false, reason: "STAFF_ONLY_TRANSITION" });
  assert.deepEqual(canAdvance("TRACKING", complete()), { ok: false, reason: "JOURNEY_COMPLETE" });
});
