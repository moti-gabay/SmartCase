// Call/meeting-notes → structured Hebrew summary. Shared by POST /api/ai/summary
// and the assistant's summarize_case read tool. Generate-only: persists
// nothing — saving to the timeline is commitAiSummary, behind human approval.
import { prisma } from "@/lib/prisma";
import { summarizeCallHebrew } from "@/lib/ai/gemini";

export const MIN_SUMMARY_INPUT_CHARS = 10;

export type SummaryOutcome = { ok: true; summary: string } | { ok: false; status: number; error: string };

export async function generateCallSummary(caseId: string, rawInput: string): Promise<SummaryOutcome> {
  const input = rawInput.trim();
  if (input.length < MIN_SUMMARY_INPUT_CHARS) {
    return { ok: false, status: 400, error: "יש להזין טקסט שיחה לסיכום (לפחות 10 תווים)" };
  }
  const exists = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, error: "התיק לא נמצא" };

  const summary = await summarizeCallHebrew(input);
  if (!summary.trim()) return { ok: false, status: 502, error: "יצירת הסיכום נכשלה" };
  return { ok: true, summary };
}
