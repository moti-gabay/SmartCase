// Dynamic document workflow: turns one validated AI analysis into the set of
// side effects it actually implies.
//
// Structured as a pure core + injected ports (same shape as
// src/lib/ai/transcription.ts) so every fan-out combination is unit-testable
// without Prisma, R2 or Gemini. The real wiring lives in
// src/app/api/documents/[id]/analyze/route.ts.
//
// The fan-out is `Promise.allSettled`, not `Promise.all`, on purpose: the three
// effects are independent business outcomes. If task creation fails on a
// unique-constraint race there is no reason the court hearing should go
// unscheduled too — a partial success is reported, never thrown away.

import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import type { DocumentAnalysis } from "@/lib/ai/document-schema";
import type { DocumentType } from "@/types";

// How long the case agent gets to chase a document the AI flagged as missing.
export const MISSING_DOCUMENT_DUE_DAYS = 7;

// Every hearing this workflow detects is a rabbinical court date. The title is
// fixed (not date-derived) so it doubles as the dedupe key when a revised
// analysis reports a new date for the same hearing.
export const HEARING_LOCATION = "בית דין";

export const HEARING_TASK_TITLE = "דיון בבית דין";

// Stable, label-derived title. Also the dedupe key against already-open tasks,
// which is why it must be a pure function of the enum value.
export function buildMissingDocumentTaskTitle(documentType: DocumentType): string {
  return `להשלים מסמך: ${DOCUMENT_TYPE_LABELS[documentType] ?? documentType}`;
}

export function buildManagerTaskTitle(documentName: string): string {
  return `דורש התייחסות מנהל: ${documentName}`;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface MissingDocumentTask {
  documentType: DocumentType;
  title: string;
  dueDate: Date;
}

export interface DocumentAutomationPorts {
  // Titles of tasks already open on the case (PENDING / IN_PROGRESS). Used to
  // dedupe, so re-analysing the same document does not pile up duplicates.
  listOpenTaskTitles: (caseId: string) => Promise<string[]>;
  // Bulk-create the missing-document follow-ups. Returns how many rows landed.
  createMissingDocumentTasks: (caseId: string, tasks: MissingDocumentTask[]) => Promise<number>;
  // Upsert (not insert) the hearing — MeetingSlot.bookedCaseId is unique, so a
  // revised date must move the existing slot rather than collide with it.
  scheduleHearing: (caseId: string, startsAt: Date) => Promise<void>;
  // Case → URGENT, plus a task carrying the notes and a timeline entry. Kept as
  // one port because the route commits all three in a single transaction.
  flagManagerAttention: (caseId: string, title: string, notes: string) => Promise<void>;
}

export interface DocumentAutomationInput {
  caseId: string;
  documentName: string;
  analysis: DocumentAnalysis;
  now: Date;
}

export type AutomationEffect = "tasks" | "hearing" | "manager";

export interface DocumentAutomationResult {
  tasksCreated: number;
  hearingScheduledAt: Date | null;
  managerFlagged: boolean;
  // Effects the analysis asked for but the engine deliberately declined, with
  // the reason — distinct from `failures`, which are things that went wrong.
  skipped: string[];
  failures: { effect: AutomationEffect; reason: string }[];
}

const DEFAULT_MANAGER_NOTES = "המערכת סימנה את המסמך כדורש בדיקת מנהל, ללא פירוט נוסף.";

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Core ──────────────────────────────────────────────────────────────────────

export async function runDocumentAutomation(
  input: DocumentAutomationInput,
  ports: DocumentAutomationPorts,
): Promise<DocumentAutomationResult> {
  const { caseId, documentName, analysis, now } = input;

  const result: DocumentAutomationResult = {
    tasksCreated: 0,
    hearingScheduledAt: null,
    managerFlagged: false,
    skipped: [],
    failures: [],
  };

  // Branches are assembled conditionally, so an analysis that implies nothing
  // performs zero awaits and zero writes.
  const branches: { effect: AutomationEffect; run: () => Promise<void> }[] = [];

  if (analysis.missingDocuments.length > 0) {
    // The dedupe read is intentionally inside the branch: an analysis with no
    // missing documents must not pay for it.
    branches.push({
      effect: "tasks",
      run: async () => {
        const openTitles = new Set(await ports.listOpenTaskTitles(caseId));
        const dueDate = addDays(now, MISSING_DOCUMENT_DUE_DAYS);
        const tasks: MissingDocumentTask[] = [];

        for (const documentType of analysis.missingDocuments) {
          const title = buildMissingDocumentTaskTitle(documentType);
          if (openTitles.has(title)) {
            result.skipped.push(`task-already-open:${documentType}`);
            continue;
          }
          tasks.push({ documentType, title, dueDate });
        }

        if (tasks.length === 0) return;
        result.tasksCreated = await ports.createMissingDocumentTasks(caseId, tasks);
      },
    });
  }

  const hearingAt = analysis.courtHearingDate;
  if (hearingAt) {
    // A hearing date already in the past is either an OCR artefact or a
    // reference to a previous hearing — scheduling it would put a dead slot on
    // the case and consume its single unique booking.
    if (hearingAt.getTime() <= now.getTime()) {
      result.skipped.push("hearing-date-in-past");
    } else {
      branches.push({
        effect: "hearing",
        run: async () => {
          await ports.scheduleHearing(caseId, hearingAt);
          result.hearingScheduledAt = hearingAt;
        },
      });
    }
  }

  if (analysis.requiresManagerAttention) {
    branches.push({
      effect: "manager",
      run: async () => {
        await ports.flagManagerAttention(
          caseId,
          buildManagerTaskTitle(documentName),
          analysis.managerNotes ?? DEFAULT_MANAGER_NOTES,
        );
        result.managerFlagged = true;
      },
    });
  }

  const settled = await Promise.allSettled(branches.map((branch) => branch.run()));
  settled.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      result.failures.push({
        effect: branches[index].effect,
        reason: failureReason(outcome.reason),
      });
    }
  });

  return result;
}
