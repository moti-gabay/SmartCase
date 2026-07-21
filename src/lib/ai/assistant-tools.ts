// Read-only tool set for the AI assistant chat. Plain server module — MUST NOT
// become "use server" (its exports would turn into network-invokable Server
// Actions; see the trust-boundary invariant in CLAUDE.md).
//
// Security model: the model chooses only a tool name + args. Every executor
// validates/clamps args against the enum keys in src/lib/constants.ts and uses
// explicit `select` whitelists. Never selected anywhere: passwordHash,
// clientPortalToken, fileData/storageKey, client emails.
import { Type, type FunctionDeclaration } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { getDashboardStats, getAlerts } from "@/lib/queries";
import {
  CASE_STATUS_LABELS,
  CASE_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  PRIORITY_LABELS,
  USER_ROLE_LABELS,
  USER_STATUS_LABELS,
} from "@/lib/constants";
import { capToolResult, clampLimit, TOOL_TIMEOUT_MS } from "@/lib/ai/chat-protocol";

type ToolResult = Record<string, unknown>;
type ToolArgs = Record<string, unknown>;

const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

// Invalid enum arg → structured error the model can self-correct from.
function enumArg(
  args: ToolArgs,
  key: string,
  valid: readonly string[]
): { value?: string; error?: ToolResult } {
  const raw = args[key];
  if (raw == null || raw === "") return {};
  if (typeof raw !== "string" || !valid.includes(raw)) {
    return { error: { error: `ערך לא חוקי עבור ${key}`, validValues: valid } };
  }
  return { value: raw };
}

function strArg(args: ToolArgs, key: string): string | undefined {
  const raw = args[key];
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 100) : undefined;
}

// ─── Executors ───────────────────────────────────────────────────────────────

async function searchCases(args: ToolArgs): Promise<ToolResult> {
  for (const [key, valid] of [
    ["status", Object.keys(CASE_STATUS_LABELS)],
    ["caseType", Object.keys(CASE_TYPE_LABELS)],
    ["priority", Object.keys(PRIORITY_LABELS)],
  ] as const) {
    const { error } = enumArg(args, key, valid);
    if (error) return error;
  }
  const query = strArg(args, "query");
  const agentName = strArg(args, "agentName");
  const rows = await prisma.case.findMany({
    where: {
      ...(args.status ? { status: args.status as never } : {}),
      ...(args.caseType ? { caseType: args.caseType as never } : {}),
      ...(args.priority ? { priority: args.priority as never } : {}),
      ...(agentName ? { assignedAgent: { name: { contains: agentName, mode: "insensitive" } } } : {}),
      ...(query
        ? {
            OR: [
              { caseNumber: { contains: query, mode: "insensitive" } },
              { client: { fullName: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      caseNumber: true,
      status: true,
      caseType: true,
      priority: true,
      hasMissingDocuments: true,
      isOverdue: true,
      submissionDeadline: true,
      updatedAt: true,
      client: { select: { fullName: true } },
      assignedAgent: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: clampLimit(args.limit),
  });
  if (rows.length === 0) return { results: [], note: "לא נמצאו תוצאות" };
  return { results: rows };
}

async function getCaseDetails(args: ToolArgs): Promise<ToolResult> {
  const caseNumber = strArg(args, "caseNumber");
  if (!caseNumber) return { error: "חסר caseNumber" };
  const row = await prisma.case.findUnique({
    where: { caseNumber },
    select: {
      caseNumber: true,
      status: true,
      caseType: true,
      priority: true,
      submissionDate: true,
      submissionDeadline: true,
      decisionDate: true,
      decisionDescription: true,
      hasMissingDocuments: true,
      isOverdue: true,
      nextFollowUpDate: true,
      createdAt: true,
      client: { select: { fullName: true, phone: true, addressCity: true } },
      assignedAgent: { select: { name: true } },
      documents: { select: { documentType: true, displayName: true, status: true, expiryDate: true } },
      tasks: {
        where: { status: { in: [...OPEN_TASK_STATUSES] } },
        select: { title: true, status: true, priority: true, dueDate: true, assignedTo: { select: { name: true } } },
      },
      statusHistory: {
        select: { previousStatus: true, newStatus: true, reason: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      _count: { select: { checklist: { where: { status: { in: ["MISSING", "REJECTED"] } } } } },
    },
  });
  if (!row) return { error: `לא נמצא תיק עם מספר ${caseNumber}` };
  const { _count, ...rest } = row;
  return { case: { ...rest, missingChecklistItems: _count.checklist } };
}

async function searchClients(args: ToolArgs): Promise<ToolResult> {
  const query = strArg(args, "query");
  if (!query || query.length < 2) return { error: "נדרש query באורך 2 תווים לפחות" };
  const rows = await prisma.client.findMany({
    where: {
      OR: [
        { fullName: { contains: query, mode: "insensitive" } },
        { nationalId: { contains: query } },
        { phone: { contains: query } },
      ],
    },
    select: {
      fullName: true,
      nationalId: true,
      phone: true,
      addressCity: true,
      cases: { select: { caseNumber: true, status: true, caseType: true } },
    },
    take: clampLimit(args.limit),
  });
  if (rows.length === 0) return { results: [], note: "לא נמצאו תוצאות" };
  return { results: rows };
}

async function getCaseMetrics(args: ToolArgs): Promise<ToolResult> {
  const groupBy = args.groupBy;
  if (groupBy === "agent") {
    const groups = await prisma.case.groupBy({ by: ["assignedAgentId"], _count: { _all: true } });
    const ids = groups.map((g) => g.assignedAgentId).filter((id): id is string => id != null);
    const agents = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameOf = new Map(agents.map((a) => [a.id, a.name]));
    return {
      results: groups.map((g) => ({
        key: g.assignedAgentId ? (nameOf.get(g.assignedAgentId) ?? "לא ידוע") : "ללא סוכן",
        count: g._count._all,
      })),
    };
  }
  const fields = {
    status: CASE_STATUS_LABELS,
    caseType: CASE_TYPE_LABELS,
    priority: PRIORITY_LABELS,
  } as const;
  if (groupBy !== "status" && groupBy !== "caseType" && groupBy !== "priority") {
    return { error: "ערך לא חוקי עבור groupBy", validValues: [...Object.keys(fields), "agent"] };
  }
  const groups = await prisma.case.groupBy({ by: [groupBy], _count: { _all: true } });
  return {
    results: groups.map((g) => {
      const key = g[groupBy] as string;
      return { key, label: fields[groupBy][key] ?? key, count: g._count._all };
    }),
  };
}

async function getDocumentSummary(args: ToolArgs): Promise<ToolResult> {
  const { value: status, error } = enumArg(args, "status", Object.keys(DOCUMENT_STATUS_LABELS));
  if (error) return error;
  const caseNumber = strArg(args, "caseNumber");
  if (!status && !caseNumber) {
    const groups = await prisma.document.groupBy({ by: ["status"], _count: { _all: true } });
    return {
      results: groups.map((g) => ({
        key: g.status,
        label: DOCUMENT_STATUS_LABELS[g.status] ?? g.status,
        count: g._count._all,
      })),
    };
  }
  const rows = await prisma.document.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(caseNumber ? { case: { caseNumber } } : {}),
    },
    select: {
      documentType: true,
      displayName: true,
      status: true,
      expiryDate: true,
      case: { select: { caseNumber: true, client: { select: { fullName: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  if (rows.length === 0) return { results: [], note: "לא נמצאו תוצאות" };
  return { results: rows };
}

async function getTaskLoad(args: ToolArgs): Promise<ToolResult> {
  const { value: status, error } = enumArg(args, "status", TASK_STATUSES);
  if (error) return error;
  const agentName = strArg(args, "agentName");
  const overdueOnly = args.overdueOnly === true;
  if (!status && !agentName && !overdueOnly) {
    const groups = await prisma.task.groupBy({
      by: ["assignedToId"],
      where: { status: { in: [...OPEN_TASK_STATUSES] } },
      _count: { _all: true },
    });
    const ids = groups.map((g) => g.assignedToId).filter((id): id is string => id != null);
    const agents = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameOf = new Map(agents.map((a) => [a.id, a.name]));
    return {
      results: groups.map((g) => ({
        key: g.assignedToId ? (nameOf.get(g.assignedToId) ?? "לא ידוע") : "ללא שיוך",
        openTasks: g._count._all,
      })),
    };
  }
  const rows = await prisma.task.findMany({
    where: {
      ...(status ? { status: status as never } : { status: { in: [...OPEN_TASK_STATUSES] } }),
      ...(agentName ? { assignedTo: { name: { contains: agentName, mode: "insensitive" } } } : {}),
      ...(overdueOnly ? { dueDate: { lt: new Date() } } : {}),
    },
    select: {
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignedTo: { select: { name: true } },
      case: { select: { caseNumber: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 20,
  });
  if (rows.length === 0) return { results: [], note: "לא נמצאו תוצאות" };
  return { results: rows };
}

// ADMIN only — gated in getToolDeclarations AND re-checked in the dispatcher.
async function getUserStats(): Promise<ToolResult> {
  const [byRole, byStatus, pending] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.findMany({
      where: { status: "PENDING_APPROVAL" },
      select: { name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    byRole: byRole.map((g) => ({ key: g.role, label: USER_ROLE_LABELS[g.role] ?? g.role, count: g._count._all })),
    byStatus: byStatus.map((g) => ({ key: g.status, label: USER_STATUS_LABELS[g.status] ?? g.status, count: g._count._all })),
    pendingApprovals: pending,
  };
}

// ─── Declarations & dispatcher ───────────────────────────────────────────────

const str = (description: string) => ({ type: Type.STRING, description });

const BASE_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_dashboard_stats",
    description:
      "מדדי לוח הבקרה: תיקים פעילים, תיקים עם מסמכים חסרים, תיקים באיחור, הגשות ואישורים החודש, תיקים חדשים השבוע.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "search_cases",
    description: "חיפוש תיקים לפי מספר תיק / שם לקוח / סטטוס / סוג / עדיפות / סוכן מטפל.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: str("טקסט חופשי — מספר תיק או שם לקוח"),
        status: str(`סטטוס תיק, אחד מ: ${Object.keys(CASE_STATUS_LABELS).join(", ")}`),
        caseType: str(`סוג תיק, אחד מ: ${Object.keys(CASE_TYPE_LABELS).join(", ")}`),
        priority: str(`עדיפות, אחת מ: ${Object.keys(PRIORITY_LABELS).join(", ")}`),
        agentName: str("שם הסוכן המטפל (חיפוש חלקי)"),
        limit: { type: Type.INTEGER, description: "מספר תוצאות מקסימלי (עד 20, ברירת מחדל 10)" },
      },
    },
  },
  {
    name: "get_case_details",
    description: "פרטים מלאים על תיק בודד לפי מספר תיק: לקוח, מסמכים, משימות פתוחות, היסטוריית סטטוסים.",
    parameters: {
      type: Type.OBJECT,
      properties: { caseNumber: str("מספר התיק המדויק") },
      required: ["caseNumber"],
    },
  },
  {
    name: "search_clients",
    description: "חיפוש לקוחות לפי שם / תעודת זהות / טלפון, כולל רשימת התיקים של כל לקוח.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: str("שם, ת\"ז או טלפון (2 תווים לפחות)"),
        limit: { type: Type.INTEGER, description: "מספר תוצאות מקסימלי (עד 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_case_metrics",
    description: "התפלגות כמות תיקים לפי סטטוס / סוג / עדיפות / סוכן מטפל.",
    parameters: {
      type: Type.OBJECT,
      properties: { groupBy: str('אחד מ: "status", "caseType", "priority", "agent"') },
      required: ["groupBy"],
    },
  },
  {
    name: "get_document_summary",
    description:
      "מצב מסמכים: ללא פרמטרים — התפלגות לפי סטטוס; עם status או caseNumber — רשימת מסמכים תואמים (עד 20).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: str(`סטטוס מסמך, אחד מ: ${Object.keys(DOCUMENT_STATUS_LABELS).join(", ")}`),
        caseNumber: str("מספר תיק לסינון"),
      },
    },
  },
  {
    name: "get_task_load",
    description:
      "עומס משימות: ללא פרמטרים — משימות פתוחות לפי עובד; עם סינון (agentName / status / overdueOnly) — רשימת משימות (עד 20).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        agentName: str("שם עובד (חיפוש חלקי)"),
        status: str(`סטטוס משימה, אחד מ: ${TASK_STATUSES.join(", ")}`),
        overdueOnly: { type: Type.BOOLEAN, description: "רק משימות שעבר מועד היעד שלהן" },
      },
    },
  },
  {
    name: "get_alerts",
    description: "ההתראות הפעילות: תיקים באיחור, מועדי הגשה מתקרבים, מסמכים חסרים.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

const ADMIN_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_user_stats",
    description: "סטטיסטיקת משתמשי המערכת: התפלגות לפי תפקיד וסטטוס, ורשימת חשבונות הממתינים לאישור.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export function getToolDeclarations(role: string): FunctionDeclaration[] {
  return role === "ADMIN" ? [...BASE_DECLARATIONS, ...ADMIN_DECLARATIONS] : BASE_DECLARATIONS;
}

const EXECUTORS: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
  get_dashboard_stats: () => getDashboardStats().then((stats) => ({ ...stats })),
  search_cases: searchCases,
  get_case_details: getCaseDetails,
  search_clients: searchClients,
  get_case_metrics: getCaseMetrics,
  get_document_summary: getDocumentSummary,
  get_task_load: getTaskLoad,
  get_alerts: () => getAlerts().then((alerts) => ({ results: alerts })),
  get_user_stats: getUserStats,
};

export async function executeAssistantTool(
  name: string,
  args: ToolArgs,
  ctx: { role: string }
): Promise<ToolResult> {
  // hasOwnProperty, not a truthiness check on EXECUTORS[name] — a plain
  // object inherits from Object.prototype, so a model-supplied name like
  // "constructor" or "toString" would otherwise resolve to a built-in and
  // slip past an `if (!executor)` guard.
  if (!Object.prototype.hasOwnProperty.call(EXECUTORS, name)) return { error: "כלי לא מוכר" };
  const executor = EXECUTORS[name];
  if (name === "get_user_stats" && ctx.role !== "ADMIN") return { error: "כלי זה זמין למנהלים בלבד" };
  try {
    const result = await Promise.race([
      executor(args ?? {}),
      new Promise<ToolResult>((resolve) =>
        setTimeout(() => resolve({ error: "תם הזמן המוקצב לשאילתה" }), TOOL_TIMEOUT_MS)
      ),
    ]);
    return capToolResult(result);
  } catch (err) {
    console.error(`[assistant-tools] ${name} failed:`, err);
    return { error: "השאילתה נכשלה" };
  }
}
