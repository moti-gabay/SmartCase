// Cases domain actions. Execution goes through the same Server Actions the
// case screens use (createCase / updateCase / changeCaseStatus / deleteCase /
// tag actions / generatePortalLink), so activity logging, status history and
// storage cleanup are identical to a manual edit.
import { Type } from "@google/genai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  addCaseTag,
  changeCaseStatus,
  createCase,
  deleteCase,
  generatePortalLink,
  removeCaseTag,
  updateCase,
} from "@/lib/actions";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, PRIORITY_LABELS, TAG_CATEGORY_LABELS } from "@/lib/constants";
import { TAG_CATEGORIES, TAG_COLOR_PALETTE, parseCaseTags } from "@/types/case-tags";
import { TASK_PRIORITIES } from "@/lib/schemas/task-schema";
import { formatDay, parseDay } from "@/lib/ai/tools/intent";
import { resolveCase, resolveClient, resolveStaff } from "@/lib/ai/tools/resolve";
import type { ActionDefinition, DisplayParam } from "@/lib/ai/tools/types";
import type { CaseStatus } from "@/types";

const STAFF = ["ADMIN", "SUPERVISOR", "AGENT"] as const;
// Cascading deletes (documents, tasks, checklist, R2 objects) are held to a
// stricter bar than the UI's any-staff guard.
const PRIVILEGED = ["ADMIN", "SUPERVISOR"] as const;

const CASE_TYPES = Object.keys(CASE_TYPE_LABELS) as [string, ...string[]];
const CASE_STATUSES = Object.keys(CASE_STATUS_LABELS) as [string, ...string[]];

const str = (description: string) => ({ type: Type.STRING, description });
const day = z.iso.date();
const text = (max: number) => z.string().trim().min(1).max(max);
const caseHref = (id: string) => `/cases/${id}`;
const iso = (d: string | undefined) => (d ? parseDay(d).toISOString() : undefined);

// ─── create_case ─────────────────────────────────────────────────────────────

const createArgs = z.object({
  clientName: text(100),
  caseType: z.enum(CASE_TYPES),
  priority: z.enum(TASK_PRIORITIES).optional(),
  claimDescription: text(2000).optional(),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  submissionDeadline: day.optional(),
  assigneeName: text(100).optional(),
});
const createParams = z.object({
  clientId: z.string().min(1),
  caseType: z.enum(CASE_TYPES),
  priority: z.enum(TASK_PRIORITIES),
  claimDescription: z.string().max(2000).optional(),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  submissionDeadline: day.optional(),
  assignedAgentId: z.string().min(1).optional(),
});

const createCaseAction: ActionDefinition<z.infer<typeof createParams>> = {
  name: "create_case",
  domain: "CASES",
  verb: "CREATE",
  roles: STAFF,
  declaration: {
    name: "create_case",
    description:
      "הצעה לפתיחת תיק חדש ללקוח קיים. ללקוח חדש — קודם create_client, ואחרי ביצועו create_case. דורש אישור המשתמש.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        clientName: str("שם הלקוח הקיים"),
        caseType: str(`סוג תיק, אחד מ: ${CASE_TYPES.join(", ")}`),
        priority: str(`עדיפות, אחת מ: ${TASK_PRIORITIES.join(", ")} (ברירת מחדל MEDIUM)`),
        claimDescription: str("תיאור התביעה"),
        claimedPercentage: { type: Type.INTEGER, description: "אחוזי נכות נתבעים (0-100)" },
        submissionDeadline: str("מועד הגשה אחרון YYYY-MM-DD"),
        assigneeName: str("שם הסוכן המטפל"),
      },
      required: ["clientName", "caseType"],
    },
  },
  argsSchema: createArgs,
  paramsSchema: createParams,
  async resolve(raw) {
    const args = createArgs.parse(raw);
    const client = await resolveClient(args.clientName);
    if ("error" in client) return client;
    const agent = args.assigneeName ? await resolveStaff(args.assigneeName) : null;
    if (agent && "error" in agent) return agent;
    const priority = args.priority ?? "MEDIUM";
    const display: DisplayParam[] = [
      ["לקוח", client.value.fullName],
      ["סוג תיק", CASE_TYPE_LABELS[args.caseType]],
      ["עדיפות", PRIORITY_LABELS[priority]],
    ];
    if (args.claimDescription) display.push(["תיאור", args.claimDescription]);
    if (args.claimedPercentage !== undefined) display.push(["אחוזים נתבעים", `${args.claimedPercentage}%`]);
    if (args.submissionDeadline) display.push(["מועד הגשה", formatDay(parseDay(args.submissionDeadline))]);
    if (agent) display.push(["סוכן מטפל", agent.value.name]);
    return {
      params: {
        clientId: client.value.id,
        caseType: args.caseType,
        priority,
        claimDescription: args.claimDescription,
        claimedPercentage: args.claimedPercentage,
        submissionDeadline: args.submissionDeadline,
        assignedAgentId: agent?.value.id,
      },
      summaryHebrew: `פתיחת תיק ${CASE_TYPE_LABELS[args.caseType]} ל${client.value.fullName}`,
      displayParams: display,
    };
  },
  async execute(p) {
    const { id } = await createCase({
      clientMode: "existing",
      existingClientId: p.clientId,
      caseType: p.caseType as never,
      priority: p.priority,
      claimDescription: p.claimDescription,
      claimedPercentage: p.claimedPercentage,
      submissionDeadline: iso(p.submissionDeadline),
      assignedAgentId: p.assignedAgentId,
    });
    const row = await prisma.case.findUnique({ where: { id }, select: { caseNumber: true } });
    // The number goes into the outcome note the model sees next turn, so it
    // can act on "the case you just opened" without asking.
    return { ok: true, message: row ? `התיק ${row.caseNumber} נפתח` : "התיק נפתח", entityHref: caseHref(id) };
  },
};

// ─── update_case (incl. assign / unassign) ──────────────────────────────────

const updateArgs = z.object({
  caseNumber: text(50),
  caseType: z.enum(CASE_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  claimDescription: text(2000).optional(),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  authorityReferenceNumber: text(100).optional(),
  submissionDeadline: z.union([day, z.literal("NONE")]).optional(),
  nextFollowUpDate: z.union([day, z.literal("NONE")]).optional(),
  assigneeName: text(100).optional(),
});
// Only the changed fields; the rest are merged from the live row at execute
// time, because updateCase replaces every column it is given.
const updateParams = z.object({
  caseId: z.string().min(1),
  caseType: z.enum(CASE_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  claimDescription: z.string().max(2000).optional(),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  authorityReferenceNumber: z.string().max(100).optional(),
  submissionDeadline: z.union([day, z.null()]).optional(),
  nextFollowUpDate: z.union([day, z.null()]).optional(),
  assignedAgentId: z.string().min(1).nullable().optional(),
});

const dayOrNone = (v: string | undefined) => (v === undefined ? undefined : v === "NONE" ? null : v);
const showDay = (v: string) => (v === "NONE" ? "ללא" : formatDay(parseDay(v)));

const updateCaseAction: ActionDefinition<z.infer<typeof updateParams>> = {
  name: "update_case",
  domain: "CASES",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "update_case",
    description:
      'הצעה לעדכון פרטי תיק: סוג, עדיפות, תיאור, אחוזים, אסמכתא, מועדים, או שיוך לסוכן (assigneeName="NONE" לביטול שיוך). לשינוי סטטוס השתמש ב-change_case_status. דורש אישור.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        caseType: str(`סוג תיק חדש, אחד מ: ${CASE_TYPES.join(", ")}`),
        priority: str(`עדיפות חדשה, אחת מ: ${TASK_PRIORITIES.join(", ")}`),
        claimDescription: str("תיאור תביעה חדש"),
        claimedPercentage: { type: Type.INTEGER, description: "אחוזים נתבעים (0-100)" },
        authorityReferenceNumber: str("מספר אסמכתא ברשות"),
        submissionDeadline: str('מועד הגשה YYYY-MM-DD, או "NONE" להסרה'),
        nextFollowUpDate: str('מועד מעקב הבא YYYY-MM-DD, או "NONE" להסרה'),
        assigneeName: str('שם הסוכן לשיוך, או "NONE" לביטול שיוך'),
      },
      required: ["caseNumber"],
    },
  },
  argsSchema: updateArgs,
  paramsSchema: updateParams,
  async resolve(raw) {
    const args = updateArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    let assignedAgentId: string | null | undefined;
    let assigneeLabel: string | undefined;
    if (args.assigneeName === "NONE") {
      assignedAgentId = null;
      assigneeLabel = "ללא שיוך";
    } else if (args.assigneeName) {
      const agent = await resolveStaff(args.assigneeName);
      if ("error" in agent) return agent;
      assignedAgentId = agent.value.id;
      assigneeLabel = agent.value.name;
    }

    const display: DisplayParam[] = [["תיק", kase.value.caseNumber]];
    if (args.caseType) display.push(["סוג תיק", CASE_TYPE_LABELS[args.caseType]]);
    if (args.priority) display.push(["עדיפות", PRIORITY_LABELS[args.priority]]);
    if (args.claimDescription) display.push(["תיאור", args.claimDescription]);
    if (args.claimedPercentage !== undefined) display.push(["אחוזים נתבעים", `${args.claimedPercentage}%`]);
    if (args.authorityReferenceNumber) display.push(["אסמכתא", args.authorityReferenceNumber]);
    if (args.submissionDeadline) display.push(["מועד הגשה", showDay(args.submissionDeadline)]);
    if (args.nextFollowUpDate) display.push(["מעקב הבא", showDay(args.nextFollowUpDate)]);
    if (assigneeLabel) display.push(["סוכן מטפל", assigneeLabel]);
    if (display.length === 1) return { error: "לא צוין מה לעדכן בתיק" };

    const onlyAssign = display.length === 2 && assigneeLabel !== undefined;
    return {
      params: {
        caseId: kase.value.id,
        caseType: args.caseType,
        priority: args.priority,
        claimDescription: args.claimDescription,
        claimedPercentage: args.claimedPercentage,
        authorityReferenceNumber: args.authorityReferenceNumber,
        submissionDeadline: dayOrNone(args.submissionDeadline),
        nextFollowUpDate: dayOrNone(args.nextFollowUpDate),
        assignedAgentId,
      },
      summaryHebrew: onlyAssign
        ? assignedAgentId === null
          ? `ביטול שיוך התיק ${kase.value.caseNumber}`
          : `שיוך התיק ${kase.value.caseNumber} ל${assigneeLabel}`
        : `עדכון פרטי התיק ${kase.value.caseNumber}`,
      displayParams: display,
    };
  },
  async execute(p) {
    const cur = await prisma.case.findUnique({
      where: { id: p.caseId },
      select: {
        caseType: true,
        priority: true,
        claimedPercentage: true,
        claimDescription: true,
        authorityReferenceNumber: true,
        submissionDeadline: true,
        nextFollowUpDate: true,
        assignedAgentId: true,
      },
    });
    if (!cur) return { ok: false, message: "התיק לא נמצא" };
    const pick = <T,>(next: T | undefined, current: T) => (next === undefined ? current : next);
    const dayField = (next: string | null | undefined, current: Date | null) =>
      next === undefined ? current?.toISOString() : next === null ? undefined : iso(next);
    await updateCase(p.caseId, {
      caseType: pick(p.caseType, cur.caseType) as never,
      priority: pick(p.priority, cur.priority),
      claimedPercentage: pick(p.claimedPercentage, cur.claimedPercentage ?? undefined),
      claimDescription: pick(p.claimDescription, cur.claimDescription ?? undefined),
      authorityReferenceNumber: pick(p.authorityReferenceNumber, cur.authorityReferenceNumber ?? undefined),
      submissionDeadline: dayField(p.submissionDeadline, cur.submissionDeadline),
      nextFollowUpDate: dayField(p.nextFollowUpDate, cur.nextFollowUpDate),
      assignedAgentId:
        p.assignedAgentId === undefined ? (cur.assignedAgentId ?? undefined) : (p.assignedAgentId ?? undefined),
    });
    return { ok: true, message: "התיק עודכן", entityHref: caseHref(p.caseId) };
  },
};

// ─── change_case_status ──────────────────────────────────────────────────────

const statusArgs = z.object({ caseNumber: text(50), status: z.enum(CASE_STATUSES), reason: text(500).optional() });
const statusParams = z.object({ caseId: z.string().min(1), status: z.enum(CASE_STATUSES), reason: z.string().max(500).optional() });

const changeStatusAction: ActionDefinition<z.infer<typeof statusParams>> = {
  name: "change_case_status",
  domain: "CASES",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "change_case_status",
    description: "הצעה לשינוי סטטוס תיק (נרשם בהיסטוריית הסטטוסים). דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        status: str(`סטטוס חדש, אחד מ: ${CASE_STATUSES.join(", ")}`),
        reason: str("סיבת השינוי (אופציונלי)"),
      },
      required: ["caseNumber", "status"],
    },
  },
  argsSchema: statusArgs,
  paramsSchema: statusParams,
  async resolve(raw) {
    const args = statusArgs.parse(raw);
    const row = await prisma.case.findUnique({
      where: { caseNumber: args.caseNumber },
      select: { id: true, caseNumber: true, status: true },
    });
    if (!row) return { error: `לא נמצא תיק עם מספר ${args.caseNumber}` };
    if (row.status === args.status) return { error: `התיק כבר בסטטוס ${CASE_STATUS_LABELS[args.status]}` };
    const display: DisplayParam[] = [
      ["תיק", row.caseNumber],
      ["מסטטוס", CASE_STATUS_LABELS[row.status]],
      ["לסטטוס", CASE_STATUS_LABELS[args.status]],
    ];
    if (args.reason) display.push(["סיבה", args.reason]);
    return {
      params: { caseId: row.id, status: args.status, reason: args.reason },
      summaryHebrew: `שינוי סטטוס התיק ${row.caseNumber} ל"${CASE_STATUS_LABELS[args.status]}"`,
      displayParams: display,
    };
  },
  async execute(p) {
    await changeCaseStatus(p.caseId, p.status as CaseStatus, p.reason);
    return { ok: true, message: "הסטטוס עודכן", entityHref: caseHref(p.caseId) };
  },
};

// ─── delete_case ─────────────────────────────────────────────────────────────

const deleteArgs = z.object({ caseNumber: text(50) });
const deleteParams = z.object({ caseId: z.string().min(1) });

const deleteCaseAction: ActionDefinition<z.infer<typeof deleteParams>> = {
  name: "delete_case",
  domain: "CASES",
  verb: "DELETE",
  roles: PRIVILEGED,
  destructive: true,
  declaration: {
    name: "delete_case",
    description: "הצעה למחיקת תיק לצמיתות, כולל מסמכים, משימות וקבצים. בלתי הפיך — דורש אישור.",
    parameters: { type: Type.OBJECT, properties: { caseNumber: str("מספר התיק") }, required: ["caseNumber"] },
  },
  argsSchema: deleteArgs,
  paramsSchema: deleteParams,
  async resolve(raw) {
    const args = deleteArgs.parse(raw);
    const row = await prisma.case.findUnique({
      where: { caseNumber: args.caseNumber },
      select: {
        id: true,
        caseNumber: true,
        client: { select: { fullName: true } },
        _count: { select: { documents: true, tasks: true } },
      },
    });
    if (!row) return { error: `לא נמצא תיק עם מספר ${args.caseNumber}` };
    return {
      params: { caseId: row.id },
      summaryHebrew: `מחיקת התיק ${row.caseNumber} לצמיתות`,
      displayParams: [
        ["תיק", row.caseNumber],
        ["לקוח", row.client.fullName],
        ["יימחקו גם", `${row._count.documents} מסמכים, ${row._count.tasks} משימות`],
      ],
    };
  },
  async execute(p) {
    await deleteCase(p.caseId);
    return { ok: true, message: "התיק נמחק", entityHref: "/cases" };
  },
};

// ─── add_case_tag / remove_case_tag ──────────────────────────────────────────

const addTagArgs = z.object({
  caseNumber: text(50),
  label: z.string().trim().min(1).max(40),
  category: z.enum(TAG_CATEGORIES).optional(),
  color: z.enum(TAG_COLOR_PALETTE).optional(),
});
const addTagParams = z.object({
  caseId: z.string().min(1),
  label: z.string().min(1).max(40),
  category: z.enum(TAG_CATEGORIES),
  color: z.enum(TAG_COLOR_PALETTE),
});

const addTagAction: ActionDefinition<z.infer<typeof addTagParams>> = {
  name: "add_case_tag",
  domain: "CASES",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "add_case_tag",
    description: "הצעה להוספת תגית לתיק. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        label: str("טקסט התגית (עד 40 תווים)"),
        category: str(`קטגוריה, אחת מ: ${TAG_CATEGORIES.join(", ")} (ברירת מחדל CUSTOM)`),
        color: str(`צבע, אחד מ: ${TAG_COLOR_PALETTE.join(", ")}`),
      },
      required: ["caseNumber", "label"],
    },
  },
  argsSchema: addTagArgs,
  paramsSchema: addTagParams,
  async resolve(raw) {
    const args = addTagArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const category = args.category ?? "CUSTOM";
    return {
      params: { caseId: kase.value.id, label: args.label, category, color: args.color ?? TAG_COLOR_PALETTE[0] },
      summaryHebrew: `הוספת התגית "${args.label}" לתיק ${kase.value.caseNumber}`,
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["תגית", args.label],
        ["קטגוריה", TAG_CATEGORY_LABELS[category] ?? category],
      ],
    };
  },
  async execute(p) {
    const { error } = await addCaseTag(p.caseId, { label: p.label, category: p.category, color: p.color });
    if (error) return { ok: false, message: error };
    return { ok: true, message: "התגית נוספה", entityHref: caseHref(p.caseId) };
  },
};

const removeTagArgs = z.object({ caseNumber: text(50), label: text(40) });
const removeTagParams = z.object({ caseId: z.string().min(1), tagId: z.string().min(1) });

const removeTagAction: ActionDefinition<z.infer<typeof removeTagParams>> = {
  name: "remove_case_tag",
  domain: "CASES",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "remove_case_tag",
    description: "הצעה להסרת תגית מתיק. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: { caseNumber: str("מספר התיק"), label: str("טקסט התגית להסרה") },
      required: ["caseNumber", "label"],
    },
  },
  argsSchema: removeTagArgs,
  paramsSchema: removeTagParams,
  async resolve(raw) {
    const args = removeTagArgs.parse(raw);
    const row = await prisma.case.findUnique({
      where: { caseNumber: args.caseNumber },
      select: { id: true, caseNumber: true, tags: true },
    });
    if (!row) return { error: `לא נמצא תיק עם מספר ${args.caseNumber}` };
    const tags = parseCaseTags(row.tags);
    const tag = tags.find((t) => t.label === args.label) ?? tags.find((t) => t.label.includes(args.label));
    if (!tag) return { error: `לא נמצאה בתיק התגית "${args.label}"`, candidates: tags.map((t) => t.label) };
    return {
      params: { caseId: row.id, tagId: tag.id },
      summaryHebrew: `הסרת התגית "${tag.label}" מתיק ${row.caseNumber}`,
      displayParams: [
        ["תיק", row.caseNumber],
        ["תגית", tag.label],
      ],
    };
  },
  async execute(p) {
    const { error } = await removeCaseTag(p.caseId, p.tagId);
    if (error) return { ok: false, message: error };
    return { ok: true, message: "התגית הוסרה", entityHref: caseHref(p.caseId) };
  },
};

// ─── generate_portal_link ────────────────────────────────────────────────────

const portalArgs = z.object({ caseNumber: text(50) });
const portalParams = z.object({ caseId: z.string().min(1) });

const portalLinkAction: ActionDefinition<z.infer<typeof portalParams>> = {
  name: "generate_portal_link",
  domain: "CASES",
  verb: "GENERATE",
  roles: STAFF,
  declaration: {
    name: "generate_portal_link",
    description: "הצעה להפקת (או חידוש) קישור פורטל לקוח לתיק. קישור קודם מבוטל. דורש אישור.",
    parameters: { type: Type.OBJECT, properties: { caseNumber: str("מספר התיק") }, required: ["caseNumber"] },
  },
  argsSchema: portalArgs,
  paramsSchema: portalParams,
  async resolve(raw) {
    const args = portalArgs.parse(raw);
    const row = await prisma.case.findUnique({
      where: { caseNumber: args.caseNumber },
      select: { id: true, caseNumber: true, clientPortalTokenExpiresAt: true },
    });
    if (!row) return { error: `לא נמצא תיק עם מספר ${args.caseNumber}` };
    const display: DisplayParam[] = [["תיק", row.caseNumber], ["תוקף", "30 יום"]];
    if (row.clientPortalTokenExpiresAt && row.clientPortalTokenExpiresAt > new Date()) {
      display.push(["שים לב", "הקישור הפעיל הנוכחי יפסיק לעבוד"]);
    }
    return {
      params: { caseId: row.id },
      summaryHebrew: `הפקת קישור פורטל לקוח לתיק ${row.caseNumber}`,
      displayParams: display,
    };
  },
  async execute(p) {
    // The token is a bearer secret: it is never returned to the chat or written
    // to the audit log — staff copy it from the case page.
    await generatePortalLink(p.caseId);
    return { ok: true, message: "נוצר קישור חדש — העתק אותו מדף התיק", entityHref: caseHref(p.caseId) };
  },
};

export const CASE_ACTIONS = [
  createCaseAction,
  updateCaseAction,
  changeStatusAction,
  deleteCaseAction,
  addTagAction,
  removeTagAction,
  portalLinkAction,
];
