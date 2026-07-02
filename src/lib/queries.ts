// Server-only data access layer. Maps Prisma rows → the view models in @/types
// that the UI components already consume. Import ONLY from server components /
// server actions / route handlers — never from a "use client" module.
import { prisma } from "@/lib/prisma";
import type {
  DashboardStats,
  CaseSummary,
  AlertItem,
  ClientListItem,
  CaseDetail,
  TaskListItem,
  UserSummary,
  CaseStatus,
  DocumentStatus,
} from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

const num = (d: unknown): number | undefined =>
  d == null ? undefined : Number(d);

const initialsOf = (name: string): string =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

const ACTIVE_STATUSES: CaseStatus[] = [
  "NEW_INTAKE",
  "GATHERING_DOCUMENTS",
  "PENDING_AI_REVIEW",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "AWAITING_DECISION",
  "APPEAL_IN_PROGRESS",
];

const MISSING_DOC_STATUSES: DocumentStatus[] = ["MISSING", "REJECTED"];

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function startOfWeek(): Date {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay()); // Sunday-start week (Israel)
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const monthStart = startOfMonth();
  const weekStart = startOfWeek();

  const [
    totalActiveCases,
    missingDocsCases,
    overdueCases,
    submittedThisMonth,
    approvedThisMonth,
    newCasesThisWeek,
  ] = await Promise.all([
    prisma.case.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    prisma.case.count({ where: { hasMissingDocuments: true, status: { in: ACTIVE_STATUSES } } }),
    prisma.case.count({ where: { isOverdue: true } }),
    prisma.case.count({ where: { submissionDate: { gte: monthStart } } }),
    prisma.case.count({ where: { status: "APPROVED", decisionDate: { gte: monthStart } } }),
    prisma.case.count({ where: { createdAt: { gte: weekStart } } }),
  ]);

  return {
    totalActiveCases,
    missingDocsCases,
    overdueCases,
    submittedThisMonth,
    approvedThisMonth,
    newCasesThisWeek,
  };
}

// Shared case → CaseSummary shape used by the board and the cases list.
const caseSummarySelect = {
  id: true,
  caseNumber: true,
  clientId: true,
  caseType: true,
  status: true,
  priority: true,
  hasMissingDocuments: true,
  isOverdue: true,
  nextFollowUpDate: true,
  submissionDeadline: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { fullName: true } },
  assignedAgent: { select: { name: true } },
  _count: {
    select: {
      checklist: { where: { status: { in: MISSING_DOC_STATUSES } } },
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCaseSummary(c: any): CaseSummary {
  return {
    id: c.id,
    caseNumber: c.caseNumber,
    clientId: c.clientId,
    clientName: c.client.fullName,
    caseType: c.caseType,
    status: c.status,
    priority: c.priority,
    assignedAgentName: c.assignedAgent?.name ?? null,
    hasMissingDocuments: c.hasMissingDocuments,
    isOverdue: c.isOverdue,
    nextFollowUpDate: iso(c.nextFollowUpDate),
    submissionDeadline: iso(c.submissionDeadline),
    missingDocsCount: c._count?.checklist ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function getCases(): Promise<CaseSummary[]> {
  const rows = await prisma.case.findMany({
    select: caseSummarySelect,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toCaseSummary);
}

export async function getAlerts(): Promise<AlertItem[]> {
  const rows = await prisma.case.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      OR: [{ hasMissingDocuments: true }, { isOverdue: true }, { submissionDeadline: { not: null } }],
    },
    select: {
      id: true,
      caseNumber: true,
      isOverdue: true,
      hasMissingDocuments: true,
      submissionDeadline: true,
      nextFollowUpDate: true,
      client: { select: { fullName: true } },
      _count: { select: { checklist: { where: { status: { in: MISSING_DOC_STATUSES } } } } },
    },
    orderBy: { submissionDeadline: "asc" },
    take: 12,
  });

  const alerts: AlertItem[] = [];
  for (const c of rows) {
    const missing = c._count.checklist;
    if (c.isOverdue) {
      alerts.push({
        id: `${c.id}-overdue`,
        caseId: c.id,
        caseNumber: c.caseNumber,
        clientName: c.client.fullName,
        type: "overdue",
        severity: "high",
        message: "התיק באיחור – נדרש טיפול מיידי",
        date: iso(c.submissionDeadline) ?? undefined,
      });
    } else if (c.submissionDeadline) {
      alerts.push({
        id: `${c.id}-deadline`,
        caseId: c.id,
        caseNumber: c.caseNumber,
        clientName: c.client.fullName,
        type: "deadline",
        severity: "high",
        message: `מועד הגשה מתקרב${missing > 0 ? ` – ${missing} מסמכים חסרים` : ""}`,
        date: iso(c.submissionDeadline) ?? undefined,
      });
    } else if (c.hasMissingDocuments) {
      alerts.push({
        id: `${c.id}-missing`,
        caseId: c.id,
        caseNumber: c.caseNumber,
        clientName: c.client.fullName,
        type: "missing_docs",
        severity: missing >= 4 ? "high" : "medium",
        message: missing > 0 ? `${missing} מסמכים חסרים לאיסוף` : "מסמכים חסרים לאיסוף",
        date: iso(c.nextFollowUpDate) ?? undefined,
      });
    }
  }
  return alerts.slice(0, 8);
}

// ─── Clients ───────────────────────────────────────────────────────────────

export async function getClientList(): Promise<ClientListItem[]> {
  const rows = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      cases: {
        orderBy: { updatedAt: "desc" },
        select: {
          status: true,
          caseType: true,
          hasMissingDocuments: true,
          updatedAt: true,
          assignedAgent: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((c) => {
    const activeCases = c.cases.filter((k) => ACTIVE_STATUSES.includes(k.status as CaseStatus));
    const last = c.cases[0];
    return {
      id: c.id,
      fullName: c.fullName,
      nationalId: c.nationalId,
      dateOfBirth: c.dateOfBirth.toISOString(),
      gender: c.gender,
      phone: c.phone,
      email: c.email ?? undefined,
      addressCity: c.addressCity ?? undefined,
      employmentStatus: c.employmentStatus,
      primaryCondition: c.primaryCondition ?? undefined,
      recognizedPercentage: c.recognizedPercentage ?? undefined,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      activeCasesCount: activeCases.length,
      totalCasesCount: c.cases.length,
      lastCaseStatus: last?.status,
      lastCaseType: last?.caseType,
      hasMissingDocuments: c.cases.some((k) => k.hasMissingDocuments),
      assignedAgentName: last?.assignedAgent?.name ?? undefined,
      lastActivityDate: last ? last.updatedAt.toISOString() : undefined,
    };
  });
}

export async function getClientCities(): Promise<string[]> {
  const rows = await prisma.client.findMany({
    where: { addressCity: { not: null } },
    select: { addressCity: true },
    distinct: ["addressCity"],
    orderBy: { addressCity: "asc" },
  });
  return rows.map((r) => r.addressCity!).filter(Boolean);
}

// ─── Case detail ───────────────────────────────────────────────────────────

export async function getCaseDetail(id: string): Promise<CaseDetail | null> {
  const c = await prisma.case.findUnique({
    where: { id },
    include: {
      client: true,
      assignedAgent: { select: { id: true, name: true, email: true } },
      checklist: {
        include: { template: true, document: { include: { uploadedBy: { select: { name: true } } } } },
        orderBy: { template: { sortOrder: "asc" } },
      },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      tasks: { include: { assignedTo: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      statusHistory: { include: { changedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    caseNumber: c.caseNumber,
    status: c.status,
    caseType: c.caseType,
    priority: c.priority,
    claimedPercentage: c.claimedPercentage ?? undefined,
    claimDescription: c.claimDescription ?? undefined,
    authorityReferenceNumber: c.authorityReferenceNumber ?? undefined,
    submissionDate: iso(c.submissionDate) ?? undefined,
    submissionDeadline: iso(c.submissionDeadline) ?? undefined,
    decisionDate: iso(c.decisionDate) ?? undefined,
    decisionDescription: c.decisionDescription ?? undefined,
    nextFollowUpDate: iso(c.nextFollowUpDate) ?? undefined,
    lastContactDate: iso(c.lastContactDate) ?? undefined,
    isOverdue: c.isOverdue,
    hasMissingDocuments: c.hasMissingDocuments,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),

    client: {
      id: c.client.id,
      fullName: c.client.fullName,
      nationalId: c.client.nationalId,
      dateOfBirth: c.client.dateOfBirth.toISOString(),
      gender: c.client.gender,
      phone: c.client.phone,
      email: c.client.email ?? undefined,
      addressStreet: c.client.addressStreet ?? undefined,
      addressCity: c.client.addressCity ?? undefined,
      employmentStatus: c.client.employmentStatus,
      employer: c.client.employer ?? undefined,
      monthlyIncome: num(c.client.monthlyIncome),
      spouseIncome: num(c.client.spouseIncome),
      spouseName: c.client.spouseName ?? undefined,
      primaryCondition: c.client.primaryCondition ?? undefined,
      icdCode: c.client.icdCode ?? undefined,
      recognizedPercentage: c.client.recognizedPercentage ?? undefined,
      diagnosisDate: iso(c.client.diagnosisDate) ?? undefined,
      treatingPhysician: c.client.treatingPhysician ?? undefined,
    },

    assignedAgent: c.assignedAgent
      ? { id: c.assignedAgent.id, name: c.assignedAgent.name, email: c.assignedAgent.email }
      : undefined,

    checklist: c.checklist.map((item) => ({
      id: item.id,
      documentType: item.template.documentType,
      displayName: item.template.displayName,
      description: item.template.description ?? undefined,
      isMandatory: item.template.isMandatory,
      validityMonths: item.template.validityMonths ?? undefined,
      sortOrder: item.template.sortOrder,
      status: item.status,
      document: item.document
        ? {
            id: item.document.id,
            fileName: item.document.fileName ?? item.document.displayName,
            fileSize: item.document.fileSize ?? 0,
            storageKey: item.document.storageKey ?? undefined,
            issueDate: iso(item.document.issueDate) ?? undefined,
            expiryDate: iso(item.document.expiryDate) ?? undefined,
            aiSummary: item.document.aiSummary ?? undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            aiValidation: (item.document.aiValidation as any) ?? undefined,
            isAiReviewed: item.document.isAiReviewed,
            uploadedByName: item.document.uploadedBy?.name ?? undefined,
            reviewNotes: item.document.reviewNotes ?? undefined,
            createdAt: item.document.createdAt.toISOString(),
          }
        : undefined,
    })),

    notes: c.notes.map((n) => ({
      id: n.id,
      type: n.type,
      content: n.content,
      followUpDate: iso(n.followUpDate) ?? undefined,
      isPrivate: n.isPrivate,
      authorName: n.author.name,
      authorInitials: initialsOf(n.author.name),
      createdAt: n.createdAt.toISOString(),
    })),

    tasks: c.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? undefined,
      dueDate: iso(t.dueDate) ?? undefined,
      priority: t.priority,
      status: t.status,
      assignedToName: t.assignedTo?.name ?? undefined,
      completedAt: iso(t.completedAt) ?? undefined,
      createdAt: t.createdAt.toISOString(),
    })),

    statusHistory: c.statusHistory.map((s) => ({
      id: s.id,
      previousStatus: s.previousStatus ?? undefined,
      newStatus: s.newStatus,
      changedByName: s.changedBy.name,
      reason: s.reason ?? undefined,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export interface CaseOption {
  id: string;
  caseNumber: string;
  clientName: string;
}

export interface ClientOption {
  id: string;
  fullName: string;
  nationalId: string;
}

export async function getClientOptions(): Promise<ClientOption[]> {
  return prisma.client.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, nationalId: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getCaseOptions(): Promise<CaseOption[]> {
  const rows = await prisma.case.findMany({
    select: { id: true, caseNumber: true, client: { select: { fullName: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, caseNumber: r.caseNumber, clientName: r.client.fullName }));
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function getTasks(): Promise<TaskListItem[]> {
  const now = new Date();
  const rows = await prisma.task.findMany({
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    include: {
      assignedTo: { select: { name: true } },
      case: { select: { id: true, caseNumber: true, client: { select: { fullName: true } } } },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description ?? undefined,
    dueDate: iso(t.dueDate),
    priority: t.priority,
    status: t.status,
    completedAt: iso(t.completedAt),
    createdAt: t.createdAt.toISOString(),
    assignedToName: t.assignedTo?.name ?? undefined,
    caseId: t.case.id,
    caseNumber: t.case.caseNumber,
    clientName: t.case.client.fullName,
    isOverdue:
      t.dueDate != null &&
      t.dueDate < now &&
      t.status !== "COMPLETED" &&
      t.status !== "CANCELLED",
  }));
}

// ─── Documents ─────────────────────────────────────────────────────────────

export interface DocumentListItem {
  id: string;
  displayName: string;
  documentType: string;
  status: string;
  fileName?: string | null;
  fileSize?: number | null;
  isAiReviewed: boolean;
  createdAt: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  uploadedByName?: string | null;
}

export async function getDocuments(): Promise<DocumentListItem[]> {
  const rows = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { name: true } },
      case: { select: { id: true, caseNumber: true, client: { select: { fullName: true } } } },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    displayName: d.displayName,
    documentType: d.documentType,
    status: d.status,
    fileName: d.fileName,
    fileSize: d.fileSize,
    isAiReviewed: d.isAiReviewed,
    createdAt: d.createdAt.toISOString(),
    caseId: d.case.id,
    caseNumber: d.case.caseNumber,
    clientName: d.case.client.fullName,
    uploadedByName: d.uploadedBy?.name ?? null,
  }));
}

export async function getAgents(): Promise<UserSummary[]> {
  const rows = await prisma.user.findMany({
    where: { isActive: true, role: { not: "CLIENT" } },
    select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ ...r, role: r.role as UserSummary["role"] }));
}
