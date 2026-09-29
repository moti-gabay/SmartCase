// Human identifier → internal id resolution for assistant actions. The model
// only ever speaks case numbers and names; ids are resolved here, server-side,
// and never round-trip through the model or the browser.
import { prisma } from "@/lib/prisma";

type Resolved<T> = { value: T } | { error: string; candidates?: string[] };

export async function resolveCase(caseNumber: string): Promise<Resolved<{ id: string; caseNumber: string }>> {
  const row = await prisma.case.findUnique({ where: { caseNumber }, select: { id: true, caseNumber: true } });
  return row ? { value: row } : { error: `לא נמצא תיק עם מספר ${caseNumber}` };
}

// Approved staff only — never assign work to a pending/suspended account.
export async function resolveStaff(name: string): Promise<Resolved<{ id: string; name: string }>> {
  const rows = await prisma.user.findMany({
    where: {
      name: { contains: name, mode: "insensitive" },
      status: "APPROVED",
      role: { in: ["ADMIN", "SUPERVISOR", "AGENT"] },
    },
    select: { id: true, name: true },
    take: 6,
  });
  const exact = rows.filter((r) => r.name === name);
  if (exact.length === 1 || rows.length === 1) return { value: exact[0] ?? rows[0] };
  if (rows.length === 0) return { error: `לא נמצא עובד פעיל בשם "${name}"` };
  return { error: `נמצאו כמה עובדים בשם "${name}" — בקש מהמשתמש לבחור`, candidates: rows.map((r) => r.name) };
}

export async function resolveTask(
  caseId: string,
  titleQuery: string
): Promise<Resolved<{ id: string; title: string }>> {
  const rows = await prisma.task.findMany({
    where: { caseId, title: { contains: titleQuery, mode: "insensitive" } },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const exact = rows.filter((r) => r.title === titleQuery);
  if (exact.length === 1 || rows.length === 1) return { value: exact[0] ?? rows[0] };
  if (rows.length === 0) return { error: `לא נמצאה בתיק משימה התואמת "${titleQuery}"` };
  return { error: "נמצאו כמה משימות תואמות — בקש מהמשתמש לבחור", candidates: rows.map((r) => r.title) };
}
