// Document analysis + automation, shared by POST /api/documents/[id]/analyze
// and the assistant's analyze_document action. Plain server module — never
// "use server": it trusts the actor and document id it is handed.
//
// Deliberately NOT part of the upload/confirm path: a multi-second Gemini
// round trip has no business there (see the analyze route).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { presignDownload, baseMimeType, ALLOWED_MIME } from "@/core/storage/s3-storage";
import { getGeminiClient } from "@/lib/ai/gemini";
import { logCaseActivity } from "@/lib/activity";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { buildDocumentAnalysisPrompt, parseDocumentAnalysis, type DocumentAnalysis } from "@/lib/ai/document-schema";
import {
  HEARING_DURATION_MINUTES,
  HEARING_LOCATION,
  HEARING_TASK_TITLE,
  runDocumentAutomation,
  type DocumentAutomationPorts,
  type DocumentAutomationResult,
} from "@/lib/workflows/document-automation";

const MODEL = "gemini-2.5-flash-lite";

// The analysis prompt is small; the ceiling only has to cover the JSON envelope.
const MAX_OUTPUT_TOKENS = 1024;

// Refusals carry the HTTP status the route maps them to; the assistant uses
// only the message.
export type AnalyzeDocumentOutcome =
  | { ok: true; caseId: string; analysis: DocumentAnalysis; result: DocumentAutomationResult }
  | { ok: false; status: number; error: string; reason?: string };

export async function analyzeAndAutomateDocument(id: string, actorId: string): Promise<AnalyzeDocumentOutcome> {
  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      caseId: true,
      documentType: true,
      displayName: true,
      storageKey: true,
      mimeType: true,
    },
  });
  if (!doc || !doc.storageKey) return { ok: false, status: 404, error: "המסמך לא נמצא" };

  const res = await fetch(presignDownload(doc.storageKey, doc.displayName, doc.mimeType));
  if (!res.ok) return { ok: false, status: 404, error: "הקובץ לא נמצא ב-R2" };

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, status: 409, error: "הקובץ ריק" };

  // Gemini only accepts the media types the uploader already allows; anything
  // else means the row's mimeType is untrustworthy, so refuse rather than
  // send bytes the model will reject.
  const stored = baseMimeType(doc.mimeType ?? res.headers.get("content-type") ?? "");
  if (!(ALLOWED_MIME as readonly string[]).includes(stored)) {
    return { ok: false, status: 415, error: "סוג קובץ לא נתמך לניתוח" };
  }
  // ALLOWED_MIME accepts the non-canonical "image/jpg" that some browsers
  // report; Gemini only knows "image/jpeg".
  const mimeType = stored === "image/jpg" ? "image/jpeg" : stored;

  const typeLabel = DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType;
  const completion = await getGeminiClient().models.generateContent({
    model: MODEL,
    contents: [
      { inlineData: { mimeType, data: bytes.toString("base64") } },
      { text: buildDocumentAnalysisPrompt(typeLabel) },
    ],
    config: { maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
  });

  const parsed = parseDocumentAnalysis(completion.text);
  if (!parsed.ok) {
    console.error("[documents:analyze] unusable AI output", { documentId: id, reason: parsed.reason });
    return { ok: false, status: 502, error: "ניתוח המסמך נכשל", reason: parsed.reason };
  }

  const ports = buildPorts(actorId, id, doc.displayName);
  const result = await runDocumentAutomation(
    { caseId: doc.caseId, documentName: doc.displayName, analysis: parsed.data, now: new Date() },
    ports,
  );

  await prisma.document.update({
    where: { id },
    data: { isAiReviewed: true, aiValidation: parsed.data as never, aiSummary: parsed.data.managerNotes },
  });

  revalidatePath(`/cases/${doc.caseId}`);
  revalidatePath("/tasks");

  return { ok: true, caseId: doc.caseId, analysis: parsed.data, result };
}

// Real ports. Each one owns exactly the writes its effect implies, and the
// manager branch is transactional because its three writes (priority, task,
// timeline) only make sense together.
function buildPorts(actorId: string, documentId: string, documentName: string): DocumentAutomationPorts {
  return {
    listOpenTaskTitles: async (caseId) => {
      const tasks = await prisma.task.findMany({
        where: { caseId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        select: { title: true },
      });
      return tasks.map((t) => t.title);
    },

    createMissingDocumentTasks: async (caseId, tasks) => {
      const created = await prisma.task.createMany({
        data: tasks.map((task) => ({
          caseId,
          createdById: actorId,
          title: task.title,
          description: `נוצר אוטומטית מניתוח AI של "${documentName}".`,
          dueDate: task.dueDate,
          priority: "HIGH" as const,
        })),
      });
      return created.count;
    },

    // Books the hearing onto the case's MeetingSlot. `bookedCaseId` is unique,
    // which is what makes upsert (not create) correct: a revised hearing date
    // moves the case's existing slot instead of violating the constraint.
    //
    // The published check is the important guard. That same unique column also
    // carries the client's own office meeting booked through the portal
    // (isPublished: true, chosen from real availability). Blindly upserting
    // would silently relocate that meeting to "בית דין" on the hearing date and
    // the client would never be told — so a published slot is left untouched and
    // the hearing falls back to the case's follow-up date plus a dated task.
    scheduleHearing: async (caseId, startsAt) => {
      const day = startsAt.toISOString().slice(0, 10);
      await prisma.$transaction(async (tx) => {
        await tx.case.update({ where: { id: caseId }, data: { nextFollowUpDate: startsAt } });

        const existing = await tx.meetingSlot.findUnique({
          where: { bookedCaseId: caseId },
          select: { id: true, isPublished: true },
        });
        const clientBookedMeeting = existing?.isPublished === true;

        if (!clientBookedMeeting) {
          await tx.meetingSlot.upsert({
            where: { bookedCaseId: caseId },
            create: {
              startsAt,
              durationMinutes: HEARING_DURATION_MINUTES,
              location: HEARING_LOCATION,
              isPublished: false,
              bookedCaseId: caseId,
              bookedAt: new Date(),
            },
            update: { startsAt, durationMinutes: HEARING_DURATION_MINUTES, location: HEARING_LOCATION },
          });
        }

        // A revised date for the same hearing moves the existing task rather
        // than stacking a second one — the fixed title is the identity here.
        const task = await tx.task.findFirst({
          where: { caseId, title: HEARING_TASK_TITLE, status: { in: ["PENDING", "IN_PROGRESS"] } },
          select: { id: true },
        });
        if (task) {
          await tx.task.update({ where: { id: task.id }, data: { dueDate: startsAt } });
        } else {
          await tx.task.create({
            data: {
              caseId,
              createdById: actorId,
              title: HEARING_TASK_TITLE,
              description: `נקבע ל-${day} (${HEARING_LOCATION}). זוהה אוטומטית מניתוח AI של "${documentName}".`,
              dueDate: startsAt,
              priority: "HIGH",
            },
          });
        }

        await logCaseActivity(
          tx,
          caseId,
          "MEETING_SCHEDULED",
          clientBookedMeeting
            ? `דיון בבית דין זוהה ל-${day} מתוך ניתוח "${documentName}". הפגישה שהלקוח קבע נשארה ללא שינוי.`
            : `דיון בבית דין נקבע ל-${day} מתוך ניתוח "${documentName}".`,
          { documentId, startsAt: startsAt.toISOString(), clientBookedMeeting },
          actorId,
        );
      });
    },

    flagManagerAttention: async (caseId, title, notes) => {
      await prisma.$transaction(async (tx) => {
        await tx.case.update({ where: { id: caseId }, data: { priority: "URGENT" } });
        // Same dedupe rule as the other two branches: re-analysing a document
        // must not stack a second identical URGENT task on the manager's queue.
        const existing = await tx.task.findFirst({
          where: { caseId, title, status: { in: ["PENDING", "IN_PROGRESS"] } },
          select: { id: true },
        });
        if (existing) return;
        await tx.task.create({
          data: { caseId, createdById: actorId, title, description: notes, priority: "URGENT" },
        });
        await logCaseActivity(
          tx,
          caseId,
          "DOCUMENT_UPLOADED",
          `המסמך "${documentName}" סומן כדורש התייחסות מנהל.`,
          { documentId, notes },
          actorId,
        );
      });
    },
  };
}
