import type { JevRule } from "@/lib/jev/types";

export const IN_FLIGHT_STATUSES = ["SUBMITTED", "AWAITING_DECISION", "APPROVED", "APPEAL_IN_PROGRESS"] as const;

type CaseParams = { caseId: string };

// BLOCK deleting a case the authority is still handling or has decided.
export const caseNotInFlight: JevRule<CaseParams> = {
  id: "case.not_in_flight",
  async evaluate({ caseId }, { db }) {
    const row = await db.case.findUnique({ where: { id: caseId }, select: { status: true } });
    return row && (IN_FLIGHT_STATUSES as readonly string[]).includes(row.status)
      ? { ruleId: "case.not_in_flight", status: "BLOCKED", reasonHebrew: "לא ניתן למחוק תיק שהוגש לרשות או שהתקבלה בו החלטה", metadata: { caseId, status: row.status } }
      : null;
  },
};

// WARN when the delete cascades over documents or open tasks.
export const caseHasDependents: JevRule<CaseParams> = {
  id: "case.has_dependents",
  async evaluate({ caseId }, { db }) {
    const [documents, openTasks] = await Promise.all([
      db.document.count({ where: { caseId } }),
      db.task.count({ where: { caseId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    ]);
    return documents + openTasks > 0
      ? {
          ruleId: "case.has_dependents",
          status: "WARNING_REQUIRES_ELEVATED_APPROVAL",
          reasonHebrew: `המחיקה תסיר ${documents} מסמכים ו-${openTasks} משימות פתוחות`,
          metadata: { caseId, documents, openTasks },
        }
      : null;
  },
};
