import type { JevRule } from "@/lib/jev/types";

export const MAX_OPEN_TASKS = 15;

type Field<P> = (p: P) => string | null | undefined;

// BLOCK assigning to a user who is not APPROVED (suspended / pending / gone).
// Re-checked at execute time: the user may be suspended after the proposal.
export function assigneeApproved<P>(get: Field<P>): JevRule<P> {
  const id = "assignee.approved";
  return {
    id,
    async evaluate(p, { db }) {
      const userId = get(p);
      if (!userId) return null;
      const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
      return user?.status === "APPROVED"
        ? null
        : { ruleId: id, status: "BLOCKED", reasonHebrew: "לא ניתן לשייך למשתמש שאינו פעיל או מאושר", metadata: { userId } };
    },
  };
}

// WARN when the assignee already carries MAX_OPEN_TASKS or more open tasks.
export function assigneeLoad<P>(get: Field<P>): JevRule<P> {
  const id = "assignee.load";
  return {
    id,
    async evaluate(p, { db }) {
      const userId = get(p);
      if (!userId) return null;
      const open = await db.task.count({ where: { assignedToId: userId, status: { in: ["PENDING", "IN_PROGRESS"] } } });
      return open >= MAX_OPEN_TASKS
        ? { ruleId: id, status: "WARNING_REQUIRES_ELEVATED_APPROVAL", reasonHebrew: `למשתמש כבר ${open} משימות פתוחות`, metadata: { userId, open } }
        : null;
    },
  };
}
