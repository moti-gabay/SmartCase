// Dynamic intake workflow: turns one validated personal-story intake into the
// set of case side effects it actually implies.
//
// Structured as a pure core + injected ports (same shape as
// src/lib/workflows/document-automation.ts) so every fan-out combination is
// unit-testable without Prisma or Gemini. The real wiring lives in
// src/app/api/ai/story-intake/route.ts.
//
// The fan-out is `Promise.allSettled`, not `Promise.all`, on purpose: persisting
// the intake, opening the gap follow-ups and escalating a red flag are
// independent business outcomes. If task creation loses a unique-constraint
// race there is no reason the manager escalation should be lost with it — a
// partial success is reported, never thrown away.

import { INTAKE_GAP_LABELS } from "@/lib/ai/story-intake-schema";
import type { IntakeGap, StoryIntake } from "@/lib/ai/story-intake-schema";

// A week matches the document-automation follow-up window: long enough that a
// gap chased by phone resolves itself, short enough to still matter.
export const INTAKE_GAP_DUE_DAYS = 7;

// Title is a pure function of the gap enum — never of AI prose — because the
// same string is the dedupe key against open task titles.
export function buildIntakeGapTaskTitle(gap: IntakeGap): string {
  return `השלמת אינטייק: ${INTAKE_GAP_LABELS[gap]}`;
}

// Fixed title so a re-run finds the escalation it already opened.
export const INTAKE_MANAGER_TASK_TITLE = "בדיקת מנהל: ממצאים חריגים בסיפור האישי";

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface IntakeGapTask {
  title: string;
  description: string;
  dueDate: Date;
}

export interface StoryIntakePorts {
  // Titles of tasks still open (PENDING / IN_PROGRESS) on the case. The dedupe
  // set: re-running the intake must not stack a second copy of a gap task the
  // agent has not closed yet.
  listOpenTaskTitles: (caseId: string) => Promise<string[]>;
  // Bulk-creates the gap follow-ups. Takes primitives so the core never sees a
  // Prisma type; the route resolves createdById (Task.createdById is required,
  // and the cron path has no session user). Returns how many rows landed.
  createTasks: (caseId: string, tasks: IntakeGapTask[]) => Promise<number>;
  // Red-flag escalation: raises the case to URGENT, opens one urgent manager
  // task and writes the timeline entry — one port because the route commits all
  // three in a single transaction; a case flagged urgent with no task and no
  // trace is worse than no escalation at all.
  flagForManager: (caseId: string, notes: string | null) => Promise<void>;
  // Persists the validated intake on ConversionProfile (intake / intakeStatus
  // COMPLETED / intakeAt) and writes the timeline entry.
  saveIntake: (caseId: string, intake: StoryIntake, at: Date) => Promise<void>;
  // Injected so tests can assert on failures without console noise.
  logError?: (message: string, error?: unknown) => void;
}

export interface StoryIntakeInput {
  caseId: string;
  intake: StoryIntake;
  now: Date;
}

export type StoryIntakeEffect = "save" | "tasks" | "manager";

export interface StoryIntakeResult {
  saved: boolean;
  tasksCreated: number;
  managerFlagged: boolean;
  // Effects the intake asked for but the engine deliberately declined, with the
  // reason — distinct from `failures`, which are things that went wrong.
  skipped: string[];
  failures: { effect: StoryIntakeEffect; reason: string }[];
}

const DEFAULT_GAP_DESCRIPTION = "נוצר אוטומטית מניתוח AI של הסיפור האישי.";

// Only the two gaps whose follow-up is "chase these specific items" carry the
// extracted list; the transcript itself is never copied into a task.
function buildGapDescription(gap: IntakeGap, intake: StoryIntake): string {
  const mentioned =
    gap === "MISSING_DOCUMENTS"
      ? intake.mentionedDocuments
      : gap === "MISSING_REFERENCES"
        ? intake.mentionedPeople
        : [];
  if (mentioned.length === 0) return DEFAULT_GAP_DESCRIPTION;
  return `${DEFAULT_GAP_DESCRIPTION} הוזכרו: ${mentioned.join(", ")}`;
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Core ──────────────────────────────────────────────────────────────────────

export async function runStoryIntake(
  input: StoryIntakeInput,
  ports: StoryIntakePorts,
): Promise<StoryIntakeResult> {
  const { caseId, intake, now } = input;

  const result: StoryIntakeResult = {
    saved: false,
    tasksCreated: 0,
    managerFlagged: false,
    skipped: [],
    failures: [],
  };

  // Branches are assembled conditionally, so an intake that implies nothing
  // beyond itself performs zero extra awaits and zero extra writes.
  const branches: { effect: StoryIntakeEffect; run: () => Promise<void> }[] = [];

  // Always persisted: an intake with nothing in it is still a completed
  // extraction, and leaving it unsaved would re-run it forever.
  branches.push({
    effect: "save",
    run: async () => {
      await ports.saveIntake(caseId, intake, now);
      result.saved = true;
    },
  });

  if (intake.gaps.length > 0) {
    // The dedupe read is intentionally inside the branch: an intake with no
    // gaps must not pay for it.
    branches.push({
      effect: "tasks",
      run: async () => {
        const openTitles = new Set(await ports.listOpenTaskTitles(caseId));
        const dueDate = addDays(now, INTAKE_GAP_DUE_DAYS);
        const pending: IntakeGapTask[] = [];

        for (const gap of intake.gaps) {
          const title = buildIntakeGapTaskTitle(gap);
          if (openTitles.has(title)) {
            result.skipped.push(`task-already-open:${gap}`);
            continue;
          }
          pending.push({ title, description: buildGapDescription(gap, intake), dueDate });
        }

        if (pending.length === 0) return;
        result.tasksCreated = await ports.createTasks(caseId, pending);
      },
    });
  }

  if (intake.hasRedFlags) {
    // Missing notes is not a reason to swallow the escalation — the flag itself
    // is the signal — but it is recorded so the gap stays visible.
    if (intake.redFlagNotes === null) result.skipped.push("manager-notes-missing");
    branches.push({
      effect: "manager",
      run: async () => {
        await ports.flagForManager(caseId, intake.redFlagNotes);
        result.managerFlagged = true;
      },
    });
  }

  const settled = await Promise.allSettled(branches.map((branch) => branch.run()));
  settled.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      const reason = failureReason(outcome.reason);
      result.failures.push({ effect: branches[index].effect, reason });
      ports.logError?.(`[story-intake] ${branches[index].effect} failed`, outcome.reason);
    }
  });

  return result;
}
