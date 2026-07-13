"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/../auth";
import { deleteObject } from "@/core/storage/s3-storage";
import { CASE_STEP_ORDER } from "@/lib/portal/journey";
import { CASE_STEP_LABELS } from "@/lib/constants";
import { logCaseActivity } from "@/lib/activity";
import { sendDocumentRejectionEmail } from "@/lib/notifications";
import type { CaseStatus, CaseStep, CaseType, Priority, TaskStatus, Gender, EmploymentStatus, UserRole, UserStatus } from "@/types";

// Best-effort removal of S3 objects; never let a storage error break the DB action.
async function deleteObjectsQuiet(keys: (string | null | undefined)[]): Promise<void> {
  await Promise.all(
    keys
      .filter((k): k is string => !!k)
      .map((k) => deleteObject(k).catch((e) => console.error("[s3 delete]", k, e)))
  );
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error("Unauthorized");
  return id;
}

async function requireAdmin(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return id;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function toggleTaskStatus(taskId: string) {
  await requireUserId();
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (!task) throw new Error("Task not found");

  const completing = task.status !== "COMPLETED";
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: completing ? "COMPLETED" : "PENDING",
      completedAt: completing ? new Date() : null,
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

const createTaskSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  dueDate: z.string().optional(),
  assignedToId: z.string().optional(),
});

export async function createTask(input: {
  caseId: string;
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string;
  assignedToId?: string;
}) {
  const userId = await requireUserId();
  const data = createTaskSchema.parse(input);

  await prisma.task.create({
    data: {
      caseId: data.caseId,
      title: data.title,
      description: data.description || null,
      priority: data.priority as Priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      assignedToId: data.assignedToId || null,
      createdById: userId,
      status: "PENDING",
    },
  });

  revalidatePath("/tasks");
  revalidatePath(`/cases/${data.caseId}`);
}

export async function setTaskStatus(taskId: string, status: TaskStatus) {
  await requireUserId();
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });
  revalidatePath("/tasks");
}

// ─── Create case ───────────────────────────────────────────────────────────────

const CASE_TYPES = [
  "DISABILITY_PENSION", "GENERAL_DISABILITY_ALLOWANCE", "MOBILITY_ALLOWANCE",
  "INCOME_SUPPORT", "LONG_TERM_CARE", "SURVIVORS_BENEFIT", "WORK_ACCIDENT",
  "OCCUPATIONAL_DISEASE", "APPEAL", "CONVERSION", "OTHER",
] as const;

const newClientSchema = z.object({
  fullName: z.string().min(2),
  nationalId: z.string().min(5),
  dateOfBirth: z.string().min(4),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  phone: z.string().min(3),
  email: z.string().email().optional().or(z.literal("")),
  addressCity: z.string().optional(),
  employmentStatus: z.enum(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "RETIRED", "STUDENT", "UNABLE_TO_WORK"]).optional(),
  primaryCondition: z.string().optional(),
});

const createCaseSchema = z.object({
  clientMode: z.enum(["existing", "new"]),
  existingClientId: z.string().optional(),
  newClient: newClientSchema.optional(),
  caseType: z.enum(CASE_TYPES),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  claimDescription: z.string().optional(),
  submissionDeadline: z.string().optional(),
  assignedAgentId: z.string().optional(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

async function nextCaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SC-${year}-`;
  const last = await prisma.case.findFirst({
    where: { caseNumber: { startsWith: prefix } },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  const lastSeq = last ? parseInt(last.caseNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, "0")}`;
}

export async function createCase(input: CreateCaseInput): Promise<{ id: string }> {
  const userId = await requireUserId();
  const data = createCaseSchema.parse(input);

  // Resolve the client (existing or newly created).
  let clientId: string;
  if (data.clientMode === "existing") {
    if (!data.existingClientId) throw new Error("יש לבחור לקוח");
    clientId = data.existingClientId;
  } else {
    const nc = newClientSchema.parse(data.newClient);
    const exists = await prisma.client.findUnique({ where: { nationalId: nc.nationalId }, select: { id: true } });
    if (exists) throw new Error("לקוח עם תעודת זהות זו כבר קיים במערכת");
    const created = await prisma.client.create({
      data: {
        fullName: nc.fullName,
        nationalId: nc.nationalId,
        dateOfBirth: new Date(nc.dateOfBirth),
        gender: nc.gender as Gender,
        phone: nc.phone,
        email: nc.email || null,
        addressCity: nc.addressCity || null,
        employmentStatus: (nc.employmentStatus ?? "UNEMPLOYED") as EmploymentStatus,
        primaryCondition: nc.primaryCondition || null,
      },
      select: { id: true },
    });
    clientId = created.id;
  }

  const caseNumber = await nextCaseNumber();
  const templates = await prisma.documentChecklistTemplate.findMany({
    where: { caseType: data.caseType as CaseType },
    select: { id: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.case.create({
      data: {
        caseNumber,
        clientId,
        createdById: userId,
        assignedAgentId: data.assignedAgentId || null,
        caseType: data.caseType as CaseType,
        priority: data.priority as Priority,
        status: "NEW_INTAKE",
        claimedPercentage: data.claimedPercentage ?? null,
        claimDescription: data.claimDescription || null,
        submissionDeadline: data.submissionDeadline ? new Date(data.submissionDeadline) : null,
        hasMissingDocuments: templates.length > 0,
        statusHistory: {
          create: { changedById: userId, previousStatus: null, newStatus: "NEW_INTAKE" },
        },
        ...(templates.length > 0
          ? { checklist: { create: templates.map((t) => ({ templateId: t.id, status: "MISSING" as const })) } }
          : {}),
      },
      select: { id: true },
    });

    await logCaseActivity(
      tx,
      c.id,
      "CASE_CREATED",
      `התיק נפתח: ${caseNumber}`,
      { caseType: data.caseType, priority: data.priority },
      userId,
    );

    return c;
  });

  revalidatePath("/cases");
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  return { id: created.id };
}

// ─── Update / delete client ─────────────────────────────────────────────────

const updateClientSchema = z.object({
  fullName: z.string().min(2),
  nationalId: z.string().min(5),
  dateOfBirth: z.string().min(4),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  phone: z.string().min(3),
  email: z.string().email().optional().or(z.literal("")),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressZip: z.string().optional(),
  employmentStatus: z.enum(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "RETIRED", "STUDENT", "UNABLE_TO_WORK"]),
  employer: z.string().optional(),
  monthlyIncome: z.number().nonnegative().optional(),
  spouseIncome: z.number().nonnegative().optional(),
  spouseName: z.string().optional(),
  primaryCondition: z.string().optional(),
  icdCode: z.string().optional(),
  recognizedPercentage: z.number().int().min(0).max(100).optional(),
  diagnosisDate: z.string().optional(),
  treatingPhysician: z.string().optional(),
  internalNotes: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export async function createClient(input: UpdateClientInput): Promise<{ id: string }> {
  await requireUserId();
  const data = updateClientSchema.parse(input);

  const exists = await prisma.client.findUnique({ where: { nationalId: data.nationalId }, select: { id: true } });
  if (exists) throw new Error("לקוח עם תעודת זהות זו כבר קיים במערכת");

  const created = await prisma.client.create({
    data: {
      fullName: data.fullName,
      nationalId: data.nationalId,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender as Gender,
      phone: data.phone,
      email: data.email || null,
      addressStreet: data.addressStreet || null,
      addressCity: data.addressCity || null,
      addressZip: data.addressZip || null,
      employmentStatus: data.employmentStatus as EmploymentStatus,
      employer: data.employer || null,
      monthlyIncome: data.monthlyIncome ?? null,
      spouseIncome: data.spouseIncome ?? null,
      spouseName: data.spouseName || null,
      primaryCondition: data.primaryCondition || null,
      icdCode: data.icdCode || null,
      recognizedPercentage: data.recognizedPercentage ?? null,
      diagnosisDate: data.diagnosisDate ? new Date(data.diagnosisDate) : null,
      treatingPhysician: data.treatingPhysician || null,
      internalNotes: data.internalNotes || null,
      isActive: data.isActive ?? true,
    },
    select: { id: true },
  });

  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { id: created.id };
}

export async function updateClient(id: string, input: UpdateClientInput) {
  await requireUserId();
  const data = updateClientSchema.parse(input);

  const conflict = await prisma.client.findFirst({
    where: { nationalId: data.nationalId, id: { not: id } },
    select: { id: true },
  });
  if (conflict) throw new Error("לקוח אחר עם תעודת זהות זו כבר קיים במערכת");

  await prisma.client.update({
    where: { id },
    data: {
      fullName: data.fullName,
      nationalId: data.nationalId,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender as Gender,
      phone: data.phone,
      email: data.email || null,
      addressStreet: data.addressStreet || null,
      addressCity: data.addressCity || null,
      addressZip: data.addressZip || null,
      employmentStatus: data.employmentStatus as EmploymentStatus,
      employer: data.employer || null,
      monthlyIncome: data.monthlyIncome ?? null,
      spouseIncome: data.spouseIncome ?? null,
      spouseName: data.spouseName || null,
      primaryCondition: data.primaryCondition || null,
      icdCode: data.icdCode || null,
      recognizedPercentage: data.recognizedPercentage ?? null,
      diagnosisDate: data.diagnosisDate ? new Date(data.diagnosisDate) : null,
      treatingPhysician: data.treatingPhysician || null,
      internalNotes: data.internalNotes || null,
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function deleteClient(id: string) {
  await requireUserId();
  // Collect S3 keys before the rows are gone (cascade removes Document rows).
  const docs = await prisma.document.findMany({ where: { case: { clientId: id } }, select: { storageKey: true } });
  // The Client→Case relation has no DB cascade, so remove the client's cases
  // first (their children cascade), then the client itself.
  await prisma.$transaction([
    prisma.case.deleteMany({ where: { clientId: id } }),
    prisma.client.delete({ where: { id } }),
  ]);
  await deleteObjectsQuiet(docs.map((d) => d.storageKey));

  revalidatePath("/clients");
  revalidatePath("/cases");
  revalidatePath("/dashboard");
}

// ─── Update / delete case ─────────────────────────────────────────────────────

const updateCaseSchema = z.object({
  caseType: z.enum(CASE_TYPES),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  claimDescription: z.string().optional(),
  authorityReferenceNumber: z.string().optional(),
  submissionDeadline: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  assignedAgentId: z.string().optional(),
});

export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

export async function updateCase(id: string, input: UpdateCaseInput) {
  await requireUserId();
  const data = updateCaseSchema.parse(input);

  await prisma.case.update({
    where: { id },
    data: {
      caseType: data.caseType as CaseType,
      priority: data.priority as Priority,
      claimedPercentage: data.claimedPercentage ?? null,
      claimDescription: data.claimDescription || null,
      authorityReferenceNumber: data.authorityReferenceNumber || null,
      submissionDeadline: data.submissionDeadline ? new Date(data.submissionDeadline) : null,
      nextFollowUpDate: data.nextFollowUpDate ? new Date(data.nextFollowUpDate) : null,
      assignedAgentId: data.assignedAgentId || null,
    },
  });

  revalidatePath(`/cases/${id}`);
  revalidatePath("/cases");
  revalidatePath("/dashboard");
}

export async function deleteCase(id: string) {
  await requireUserId();
  // Collect S3 keys before the cascade removes the Document rows.
  const docs = await prisma.document.findMany({ where: { caseId: id }, select: { storageKey: true } });
  // Case children (documents, notes, tasks, status history, checklist) cascade.
  await prisma.case.delete({ where: { id } });
  await deleteObjectsQuiet(docs.map((d) => d.storageKey));

  revalidatePath("/cases");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

// ─── Delete document ───────────────────────────────────────────────────────────

export async function deleteDocument(id: string) {
  await requireUserId();
  const doc = await prisma.document.findUnique({ where: { id }, select: { caseId: true, storageKey: true } });
  if (!doc) throw new Error("המסמך לא נמצא");

  // Reset any checklist item that pointed at this document back to MISSING.
  await prisma.caseChecklist.updateMany({
    where: { documentId: id },
    data: { status: "MISSING", documentId: null },
  });
  await prisma.document.delete({ where: { id } });
  await deleteObjectsQuiet([doc.storageKey]);

  const stillMissing = await prisma.caseChecklist.count({
    where: { caseId: doc.caseId, status: { in: ["MISSING", "REJECTED"] } },
  });
  await prisma.case.update({ where: { id: doc.caseId }, data: { hasMissingDocuments: stillMissing > 0 } });

  revalidatePath(`/cases/${doc.caseId}`);
  revalidatePath("/documents");
}

// ─── Review document (staff approve / reject) ──────────────────────────────────

const reviewDocumentSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().optional(),
});

export async function reviewDocument(
  documentId: string,
  status: "APPROVED" | "REJECTED",
  notes?: string,
) {
  const userId = await requireUserId();
  const data = reviewDocumentSchema.parse({ status, notes });

  // A rejection must carry a reason (fills reviewNotes, shown to the client).
  const reason = data.notes?.trim();
  if (data.status === "REJECTED" && !reason) throw new Error("נדרשת סיבת דחייה");

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { caseId: true, status: true, displayName: true },
  });
  if (!doc) throw new Error("המסמך לא נמצא");

  // Only a document actually awaiting review can be reviewed — guards against
  // acting on a stale/missing row.
  if (doc.status !== "UPLOADED_PENDING_REVIEW") throw new Error("המסמך אינו ממתין לבדיקה");

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        status: data.status,
        reviewedById: userId,
        // Clear any stale rejection note on approval.
        reviewNotes: data.status === "REJECTED" ? reason : null,
      },
    });

    // Sync the linked checklist item (general uploads have no link → no-op).
    await tx.caseChecklist.updateMany({
      where: { documentId },
      data: { status: data.status },
    });

    // Recompute the case flag — REJECTED counts as missing, so a rejection
    // re-flags the case exactly like a missing document.
    const stillMissing = await tx.caseChecklist.count({
      where: { caseId: doc.caseId, status: { in: ["MISSING", "REJECTED"] } },
    });
    await tx.case.update({
      where: { id: doc.caseId },
      data: { hasMissingDocuments: stillMissing > 0 },
    });

    await logCaseActivity(
      tx,
      doc.caseId,
      data.status === "APPROVED" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED",
      data.status === "APPROVED"
        ? `מסמך אושר: ${doc.displayName}`
        : `מסמך נדחה: ${doc.displayName} — ${reason}`,
      { documentId, ...(reason ? { reason } : {}) },
      userId,
    );
  });

  // Notify the client on rejection — AFTER the commit, and fully isolated so a
  // mail failure can never roll back the review or surface to the reviewer.
  // (sendDocumentRejectionEmail already swallows its own errors; the extra
  // guard covers anything unexpected before it, e.g. an import-time throw.)
  if (data.status === "REJECTED") {
    try {
      await sendDocumentRejectionEmail(doc.caseId, doc.displayName, reason ?? "");
    } catch (err) {
      console.error("[reviewDocument:notify]", err);
    }
  }

  revalidatePath(`/cases/${doc.caseId}`);
  revalidatePath("/documents");
  revalidatePath("/dashboard");
}

// ─── AI call summary (generate → approve → lock to timeline) ────────────────────
// NOTE: generation moved to the dedicated POST /api/ai/summary route (60s budget).
// Only the DB-writing commit remains a server action.

// Commit the approved (possibly edited) summary to the timeline as an immutable
// AI_CALL_SUMMARY activity, attributed to the acting staff member.
export async function commitAiSummary(caseId: string, summary: string) {
  const userId = await requireUserId();
  const clean = summary.trim();
  if (!caseId) throw new Error("תיק לא תקין");
  if (clean.length < 3) throw new Error("לא ניתן לשמור סיכום ריק");

  const exists = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!exists) throw new Error("התיק לא נמצא");

  await logCaseActivity(prisma, caseId, "AI_CALL_SUMMARY", clean, { source: "ai_call_summary" }, userId);

  revalidatePath(`/cases/${caseId}`);
}

// ─── Case status ───────────────────────────────────────────────────────────────

export async function changeCaseStatus(caseId: string, newStatus: CaseStatus, reason?: string) {
  const userId = await requireUserId();
  const current = await prisma.case.findUnique({ where: { id: caseId }, select: { status: true } });
  if (!current) throw new Error("Case not found");
  if (current.status === newStatus) return;

  await prisma.$transaction([
    prisma.case.update({
      where: { id: caseId },
      data: {
        status: newStatus,
        ...(newStatus === "SUBMITTED" ? { submissionDate: new Date() } : {}),
        ...(newStatus === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    }),
    prisma.caseStatusHistory.create({
      data: {
        caseId,
        changedById: userId,
        previousStatus: current.status,
        newStatus,
        reason: reason || null,
      },
    }),
  ]);

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  revalidatePath("/dashboard");
}

// ─── Client portal link (conversion cases) ──────────────────────────────────────

// Generates (or rotates) the public share link for a case. The token is a
// high-entropy random bearer secret (256 bits) — unguessable, not derived from
// any predictable data — stored directly as the unique lookup key. Regenerating
// overwrites the previous token, which immediately invalidates any leaked link
// (rotate-to-revoke; no separate revoke UI needed).
const PORTAL_TOKEN_TTL_DAYS = 30;

export async function generatePortalLink(caseId: string): Promise<{ token: string; expiresAt: string }> {
  await requireUserId();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.case.update({
    where: { id: caseId },
    data: { clientPortalToken: token, clientPortalTokenExpiresAt: expiresAt },
  });

  revalidatePath(`/cases/${caseId}`);
  return { token, expiresAt: expiresAt.toISOString() };
}

// Staff override for the client's portal journey step — the only way to move
// through the staff-driven transitions (SCHEDULE_MEETING → TRACKING) until the
// Smart Scheduling module lands, and the escape hatch to reset a client's
// journey. Client-side advancing goes through the token-guarded public route
// (api/public/conversion/[token]/advance), never through here.
export async function setCasePortalStep(caseId: string, step: CaseStep) {
  const userId = await requireUserId();
  if (!CASE_STEP_ORDER.includes(step)) throw new Error("שלב לא תקין");

  const current = await prisma.case.findUnique({ where: { id: caseId }, select: { portalStep: true } });
  if (!current) throw new Error("התיק לא נמצא");
  if (current.portalStep === step) return;

  await prisma.$transaction(async (tx) => {
    await tx.case.update({ where: { id: caseId }, data: { portalStep: step } });
    await logCaseActivity(
      tx,
      caseId,
      "STEP_CHANGED",
      `שלב התהליך עודכן ל: ${CASE_STEP_LABELS[step] ?? step}`,
      { from: current.portalStep, to: step },
      userId,
    );
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}

// ─── Admin: user management ──────────────────────────────────────────────────
// Every export here is an authenticated, ADMIN-guarded Server Action. Unlike the
// public portal (kept out of this file on purpose), these legitimately mutate
// other users' records — so the guard is `requireAdmin`, not a caller-supplied id.

const STAFF_ROLES = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

const adminUpdateUserSchema = z.object({
  name:   z.string().min(2).optional(),
  phone:  z.string().optional(),
  role:   z.enum(STAFF_ROLES).optional(),
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "SUSPENDED"]).optional(),
});

export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export async function adminUpdateUser(targetId: string, input: AdminUpdateUserInput) {
  const adminId = await requireAdmin();
  const data = adminUpdateUserSchema.parse(input);

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true, status: true },
  });
  if (!target) throw new Error("המשתמש לא נמצא");

  const nextRole   = data.role   ?? target.role;
  const nextStatus = data.status ?? target.status;

  // Does this change strip an approved admin of their admin access?
  const losesAdmin =
    target.role === "ADMIN" &&
    target.status === "APPROVED" &&
    (nextRole !== "ADMIN" || nextStatus !== "APPROVED");

  // Self-lockout guard: an admin cannot revoke their own admin access.
  if (targetId === adminId && losesAdmin) {
    throw new Error("לא ניתן לבטל את הרשאות המנהל של עצמך");
  }

  // Last-admin guard: never leave the system with zero approved admins.
  if (losesAdmin) {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", status: "APPROVED", id: { not: targetId } },
    });
    if (otherAdmins === 0) throw new Error("לא ניתן להסיר את מנהל המערכת המאושר האחרון");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: {
        ...(data.name   !== undefined ? { name: data.name } : {}),
        ...(data.phone  !== undefined ? { phone: data.phone || null } : {}),
        ...(data.role   !== undefined ? { role: data.role as UserRole } : {}),
        ...(data.status !== undefined ? { status: data.status as UserStatus } : {}),
      },
    }),
    // Compliance trail — status/role changes on user accounts are sensitive.
    prisma.auditLog.create({
      data: {
        userId: adminId,
        action: "USER_UPDATE",
        entityType: "User",
        entityId: targetId,
        metadata: {
          before: { role: target.role, status: target.status },
          after:  { role: nextRole, status: nextStatus },
        },
      },
    }),
  ]);

  revalidatePath("/admin/users");
}

export async function approveUser(targetId: string) {
  return adminUpdateUser(targetId, { status: "APPROVED" });
}

export async function suspendUser(targetId: string) {
  return adminUpdateUser(targetId, { status: "SUSPENDED" });
}

// Hard-delete a user. Only "clean" accounts (no authored records) are deletable —
// SUSPENDED is the soft-delete for anyone with activity. This exists mainly to
// purge rejected/spam PENDING_APPROVAL registrations.
export async function adminDeleteUser(targetId: string) {
  const adminId = await requireAdmin();

  // Self-lockout guard.
  if (targetId === adminId) throw new Error("לא ניתן למחוק את המשתמש שלך");

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true, status: true },
  });
  if (!target) throw new Error("המשתמש לא נמצא");

  // Last-admin guard: never delete the final approved admin.
  if (target.role === "ADMIN" && target.status === "APPROVED") {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", status: "APPROVED", id: { not: targetId } },
    });
    if (otherAdmins === 0) throw new Error("לא ניתן למחוק את מנהל המערכת המאושר האחרון");
  }

  // Referential-integrity guard: these relations are required FKs (onDelete:
  // Restrict), so a user who authored any of them cannot be hard-deleted.
  // Block early with a clear message rather than surfacing a raw FK violation.
  const [cases, notes, tasks, history] = await Promise.all([
    prisma.case.count({ where: { createdById: targetId } }),
    prisma.note.count({ where: { authorId: targetId } }),
    prisma.task.count({ where: { createdById: targetId } }),
    prisma.caseStatusHistory.count({ where: { changedById: targetId } }),
  ]);
  if (cases + notes + tasks + history > 0) {
    throw new Error("לא ניתן למחוק משתמש עם היסטוריית פעילות במערכת (תיקים, משימות, הערות או שינויי סטטוס). יש להשעות אותו במקום זאת.");
  }

  try {
    await prisma.$transaction([
      prisma.user.delete({ where: { id: targetId } }),
      // Audit row references the acting admin (not the deleted user), so it
      // survives the deletion and keeps the trail immutable.
      prisma.auditLog.create({
        data: {
          userId: adminId,
          action: "USER_DELETE",
          entityType: "User",
          entityId: targetId,
          metadata: { role: target.role, status: target.status },
        },
      }),
    ]);
  } catch (e) {
    // Safety net in case an optional relation's FK isn't SetNull as expected.
    if ((e as { code?: string })?.code === "P2003") {
      throw new Error("לא ניתן למחוק משתמש המשויך לרשומות במערכת. יש להשעות אותו במקום זאת.");
    }
    throw e;
  }

  revalidatePath("/admin/users");
}

// NOTE: the public conversion-portal submission logic (profile + children) lives
// in src/app/api/public/conversion/[token]/submit/route.ts, NOT here. This file
// is "use server", which turns every export into a network-invokable Server
// Action if it's ever imported into a "use client" component; a function that
// trusts a caller-supplied caseId (as the portal submission must, since there's
// no session) must never risk being wired up that way. Keeping it in a
// server-only route file makes that trust boundary structural, not conventional.
