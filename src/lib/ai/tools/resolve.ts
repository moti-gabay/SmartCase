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

// Candidates carry case numbers, never ids or national IDs — enough for the
// user to pick, nothing the model should not see.
export async function resolveClient(
  name: string
): Promise<Resolved<{ id: string; fullName: string; caseNumbers: string[] }>> {
  const rows = await prisma.client.findMany({
    where: { fullName: { contains: name, mode: "insensitive" } },
    select: { id: true, fullName: true, cases: { select: { caseNumber: true }, take: 5 } },
    take: 6,
  });
  const shaped = rows.map((r) => ({ id: r.id, fullName: r.fullName, caseNumbers: r.cases.map((c) => c.caseNumber) }));
  const exact = shaped.filter((r) => r.fullName === name);
  if (exact.length === 1 || shaped.length === 1) return { value: exact[0] ?? shaped[0] };
  if (shaped.length === 0) return { error: `לא נמצא לקוח בשם "${name}"` };
  return {
    error: `נמצאו כמה לקוחות בשם "${name}" — בקש מהמשתמש לבחור (לפי מספר תיק)`,
    candidates: shaped.map((r) => `${r.fullName} (תיקים: ${r.caseNumbers.join(", ") || "אין"})`),
  };
}

// Slots are addressed by Israel wall-clock time. On a miss, the candidates are
// that day's slots so the model can offer real alternatives.
export async function resolveSlot(
  startsAt: Date,
  describe: (s: { startsAt: Date; booked: boolean; isPublished: boolean }) => string
): Promise<Resolved<{ id: string; startsAt: Date; bookedCaseId: string | null; isPublished: boolean; durationMinutes: number }>> {
  const row = await prisma.meetingSlot.findFirst({
    where: { startsAt: { gte: new Date(startsAt.getTime() - 60_000), lte: new Date(startsAt.getTime() + 60_000) } },
    select: { id: true, startsAt: true, bookedCaseId: true, isPublished: true, durationMinutes: true },
  });
  if (row) return { value: row };
  const dayStart = new Date(startsAt.getTime() - 12 * 3_600_000);
  const dayEnd = new Date(startsAt.getTime() + 12 * 3_600_000);
  const sameDay = await prisma.meetingSlot.findMany({
    where: { startsAt: { gte: dayStart, lte: dayEnd } },
    select: { startsAt: true, bookedCaseId: true, isPublished: true },
    orderBy: { startsAt: "asc" },
    take: 12,
  });
  return {
    error: "לא נמצא מועד בשעה הזו",
    candidates: sameDay.map((s) => describe({ startsAt: s.startsAt, booked: !!s.bookedCaseId, isPublished: s.isPublished })),
  };
}

// Documents are addressed by case + display name or type label.
export async function resolveDocument(
  caseId: string,
  query: string,
  typeLabels: Record<string, string>
): Promise<Resolved<{ id: string; displayName: string; status: string; storageKey: string | null }>> {
  const matchingTypes = Object.entries(typeLabels)
    .filter(([, label]) => label.includes(query) || query.includes(label))
    .map(([key]) => key);
  const rows = await prisma.document.findMany({
    where: {
      caseId,
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        ...(matchingTypes.length ? [{ documentType: { in: matchingTypes as never[] } }] : []),
      ],
    },
    select: { id: true, displayName: true, status: true, storageKey: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const exact = rows.filter((r) => r.displayName === query);
  if (exact.length === 1 || rows.length === 1) return { value: exact[0] ?? rows[0] };
  if (rows.length === 0) return { error: `לא נמצא בתיק מסמך התואם "${query}"` };
  return { error: "נמצאו כמה מסמכים תואמים — בקש מהמשתמש לבחור", candidates: rows.map((r) => r.displayName) };
}

// Latest letter on the case, optionally narrowed by type — "the letter" in
// conversation almost always means the one just generated.
export async function resolveLetter(
  caseId: string,
  letterType?: string
): Promise<Resolved<{ id: string; title: string }>> {
  const row = await prisma.generatedLetter.findFirst({
    where: { caseId, ...(letterType ? { letterType: letterType as never } : {}) },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });
  return row ? { value: row } : { error: "לא נמצא מכתב בתיק — אפשר להפיק מכתב חדש עם generate_letter" };
}

// Any status — approving a PENDING registration is the main use. Emails are
// masked out of user text before the model reads it, so lookup is by name;
// candidates disambiguate by role, status and join date, never by email.
export async function resolveUser(
  name: string,
  describe: (u: { name: string; role: string; status: string; createdAt: Date }) => string
): Promise<Resolved<{ id: string; name: string; role: string; status: string }>> {
  const rows = await prisma.user.findMany({
    where: { name: { contains: name, mode: "insensitive" } },
    select: { id: true, name: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const exact = rows.filter((r) => r.name === name);
  if (exact.length === 1 || rows.length === 1) return { value: exact[0] ?? rows[0] };
  if (rows.length === 0) return { error: `לא נמצא משתמש בשם "${name}"` };
  return { error: `נמצאו כמה משתמשים בשם "${name}" — בקש מהמשתמש לבחור`, candidates: rows.map(describe) };
}
