// Clients domain actions. National ID / phone / email are masked out of the
// user's message before the model reads it (maskPii), so they are never model
// params here: the card asks the human to type them (humanFields) and they
// reach execute only through the approval request.
//
// Identity fields (name, national ID, date of birth) are create-only through
// the assistant — changing a legal identity stays a deliberate edit on the
// client screen.
import { Type } from "@google/genai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createClient, deleteClient, updateClient, type UpdateClientInput } from "@/lib/actions";
import { EMPLOYMENT_STATUS_LABELS, GENDER_LABELS } from "@/lib/constants";
import { formatDay, parseDay } from "@/lib/ai/tools/intent";
import { resolveClient } from "@/lib/ai/tools/resolve";
import type { ActionDefinition, DisplayParam, HumanField } from "@/lib/ai/tools/types";

const STAFF = ["ADMIN", "SUPERVISOR", "AGENT"] as const;
const PRIVILEGED = ["ADMIN", "SUPERVISOR"] as const;

const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
const EMPLOYMENT = Object.keys(EMPLOYMENT_STATUS_LABELS) as [string, ...string[]];

const str = (description: string) => ({ type: Type.STRING, description });
const text = (max: number) => z.string().trim().min(1).max(max);
const clientHref = (id: string) => `/clients/${id}`;

const humanSchema = z.object({
  nationalId: z.string().regex(/^\d{5,9}$/, { message: "תעודת זהות: 5-9 ספרות" }).optional(),
  phone: z.string().regex(/^\+?[\d\s-]{9,15}$/, { message: "מספר טלפון לא תקין" }).optional(),
  email: z.email({ message: "כתובת אימייל לא תקינה" }).optional(),
});

const NATIONAL_ID: HumanField = { key: "nationalId", label: 'ת"ז', required: true, inputType: "text" };
const phoneField = (required: boolean): HumanField => ({ key: "phone", label: "טלפון", required, inputType: "tel" });
const emailField = (required: boolean): HumanField => ({ key: "email", label: "אימייל", required, inputType: "email" });

// ─── create_client ───────────────────────────────────────────────────────────

const createArgs = z.object({
  fullName: z.string().trim().min(2).max(100),
  dateOfBirth: z.iso.date(),
  gender: z.enum(GENDERS),
  employmentStatus: z.enum(EMPLOYMENT).optional(),
  addressStreet: text(100).optional(),
  addressCity: text(60).optional(),
  primaryCondition: text(200).optional(),
});
const createParams = createArgs.extend({ employmentStatus: z.enum(EMPLOYMENT) });

const createClientAction: ActionDefinition<z.infer<typeof createParams>> = {
  name: "create_client",
  domain: "CLIENTS",
  verb: "CREATE",
  roles: STAFF,
  declaration: {
    name: "create_client",
    description:
      'הצעה ליצירת לקוח חדש. ת"ז, טלפון ואימייל אינם פרמטרים — המשתמש ימלא אותם בכרטיס האישור. אל תבקש אותם בצ\'אט. דורש אישור.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fullName: str("שם מלא"),
        dateOfBirth: str("תאריך לידה YYYY-MM-DD"),
        gender: str(`מגדר, אחד מ: ${GENDERS.join(", ")}`),
        employmentStatus: str(`מצב תעסוקתי, אחד מ: ${EMPLOYMENT.join(", ")}`),
        addressStreet: str("רחוב ומספר"),
        addressCity: str("עיר"),
        primaryCondition: str("מצב רפואי עיקרי"),
      },
      required: ["fullName", "dateOfBirth", "gender"],
    },
  },
  argsSchema: createArgs,
  paramsSchema: createParams,
  humanSchema,
  async resolve(raw) {
    const args = createArgs.parse(raw);
    const employmentStatus = args.employmentStatus ?? "UNEMPLOYED";
    const display: DisplayParam[] = [
      ["שם מלא", args.fullName],
      ["תאריך לידה", formatDay(parseDay(args.dateOfBirth))],
      ["מגדר", GENDER_LABELS[args.gender]],
      ["מצב תעסוקתי", EMPLOYMENT_STATUS_LABELS[employmentStatus]],
    ];
    if (args.addressStreet || args.addressCity) {
      display.push(["כתובת", [args.addressStreet, args.addressCity].filter(Boolean).join(", ")]);
    }
    if (args.primaryCondition) display.push(["מצב רפואי", args.primaryCondition]);
    return {
      params: { ...args, employmentStatus },
      summaryHebrew: `יצירת לקוח חדש: ${args.fullName}`,
      displayParams: display,
      humanFields: [NATIONAL_ID, phoneField(true), emailField(false)],
    };
  },
  async execute(p, _actor, human) {
    const { id } = await createClient({
      fullName: p.fullName,
      nationalId: human.nationalId!,
      dateOfBirth: parseDay(p.dateOfBirth).toISOString(),
      gender: p.gender,
      phone: human.phone!,
      email: human.email ?? "",
      addressStreet: p.addressStreet,
      addressCity: p.addressCity,
      employmentStatus: p.employmentStatus as UpdateClientInput["employmentStatus"],
      primaryCondition: p.primaryCondition,
    });
    return { ok: true, message: "הלקוח נוצר", entityHref: clientHref(id) };
  },
};

// ─── update_client (contact / address / employment / archive) ───────────────

const updateArgs = z.object({
  clientName: text(100),
  updatePhone: z.boolean().optional(),
  updateEmail: z.boolean().optional(),
  addressStreet: text(100).optional(),
  addressCity: text(60).optional(),
  addressZip: text(10).optional(),
  employmentStatus: z.enum(EMPLOYMENT).optional(),
  employer: text(100).optional(),
  primaryCondition: text(200).optional(),
  internalNotes: text(2000).optional(),
  active: z.boolean().optional(),
});
const updateParams = z.object({
  clientId: z.string().min(1),
  addressStreet: z.string().max(100).optional(),
  addressCity: z.string().max(60).optional(),
  addressZip: z.string().max(10).optional(),
  employmentStatus: z.enum(EMPLOYMENT).optional(),
  employer: z.string().max(100).optional(),
  primaryCondition: z.string().max(200).optional(),
  internalNotes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

const updateClientAction: ActionDefinition<z.infer<typeof updateParams>> = {
  name: "update_client",
  domain: "CLIENTS",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "update_client",
    description:
      "הצעה לעדכון לקוח: כתובת, תעסוקה, מצב רפואי, הערות פנימיות, או העברה לארכיון (active=false) / שחזור (active=true). " +
      "לעדכון טלפון/אימייל סמן updatePhone/updateEmail — הערך החדש יוזן בכרטיס. שם, ת\"ז ותאריך לידה אינם ניתנים לשינוי דרך העוזר. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        clientName: str("שם הלקוח"),
        updatePhone: { type: Type.BOOLEAN, description: "המשתמש רוצה לעדכן טלפון" },
        updateEmail: { type: Type.BOOLEAN, description: "המשתמש רוצה לעדכן אימייל" },
        addressStreet: str("רחוב ומספר"),
        addressCity: str("עיר"),
        addressZip: str("מיקוד"),
        employmentStatus: str(`מצב תעסוקתי, אחד מ: ${EMPLOYMENT.join(", ")}`),
        employer: str("מעסיק"),
        primaryCondition: str("מצב רפואי עיקרי"),
        internalNotes: str("הערות פנימיות (מחליף את הקיים)"),
        active: { type: Type.BOOLEAN, description: "false = העברה לארכיון, true = שחזור" },
      },
      required: ["clientName"],
    },
  },
  argsSchema: updateArgs,
  paramsSchema: updateParams,
  humanSchema,
  async resolve(raw) {
    const { clientName, updatePhone, updateEmail, active, ...fields } = updateArgs.parse(raw);
    const client = await resolveClient(clientName);
    if ("error" in client) return client;

    const display: DisplayParam[] = [["לקוח", client.value.fullName]];
    if (fields.addressStreet) display.push(["רחוב", fields.addressStreet]);
    if (fields.addressCity) display.push(["עיר", fields.addressCity]);
    if (fields.addressZip) display.push(["מיקוד", fields.addressZip]);
    if (fields.employmentStatus) display.push(["מצב תעסוקתי", EMPLOYMENT_STATUS_LABELS[fields.employmentStatus]]);
    if (fields.employer) display.push(["מעסיק", fields.employer]);
    if (fields.primaryCondition) display.push(["מצב רפואי", fields.primaryCondition]);
    if (fields.internalNotes) display.push(["הערות פנימיות", fields.internalNotes]);
    if (active !== undefined) display.push(["סטטוס", active ? "פעיל" : "בארכיון"]);

    const humanFields: HumanField[] = [];
    if (updatePhone) humanFields.push(phoneField(true));
    if (updateEmail) humanFields.push(emailField(true));
    if (display.length === 1 && humanFields.length === 0) return { error: "לא צוין מה לעדכן בלקוח" };

    const onlyArchive = display.length === 2 && active !== undefined && humanFields.length === 0;
    return {
      params: { clientId: client.value.id, ...fields, active },
      summaryHebrew: onlyArchive
        ? `${active ? "שחזור" : "העברה לארכיון של"} הלקוח ${client.value.fullName}`
        : `עדכון פרטי הלקוח ${client.value.fullName}`,
      displayParams: display,
      humanFields: humanFields.length ? humanFields : undefined,
    };
  },
  async execute(p, _actor, human) {
    // updateClient replaces every column it is given — merge onto the live row.
    const c = await prisma.client.findUnique({ where: { id: p.clientId } });
    if (!c) return { ok: false, message: "הלקוח לא נמצא" };
    const opt = <T,>(v: T | null) => v ?? undefined;
    await updateClient(p.clientId, {
      fullName: c.fullName,
      nationalId: c.nationalId,
      dateOfBirth: c.dateOfBirth.toISOString(),
      gender: c.gender,
      phone: human.phone ?? c.phone,
      email: human.email ?? c.email ?? "",
      addressStreet: p.addressStreet ?? opt(c.addressStreet),
      addressCity: p.addressCity ?? opt(c.addressCity),
      addressZip: p.addressZip ?? opt(c.addressZip),
      employmentStatus: (p.employmentStatus ?? c.employmentStatus) as UpdateClientInput["employmentStatus"],
      employer: p.employer ?? opt(c.employer),
      monthlyIncome: c.monthlyIncome == null ? undefined : Number(c.monthlyIncome),
      spouseIncome: c.spouseIncome == null ? undefined : Number(c.spouseIncome),
      spouseName: opt(c.spouseName),
      primaryCondition: p.primaryCondition ?? opt(c.primaryCondition),
      icdCode: opt(c.icdCode),
      recognizedPercentage: opt(c.recognizedPercentage),
      diagnosisDate: c.diagnosisDate?.toISOString(),
      treatingPhysician: opt(c.treatingPhysician),
      internalNotes: p.internalNotes ?? opt(c.internalNotes),
      isActive: p.active,
    });
    return { ok: true, message: "פרטי הלקוח עודכנו", entityHref: clientHref(p.clientId) };
  },
};

// ─── delete_client ───────────────────────────────────────────────────────────

const deleteArgs = z.object({ clientName: text(100) });
const deleteParams = z.object({ clientId: z.string().min(1) });

const deleteClientAction: ActionDefinition<z.infer<typeof deleteParams>> = {
  name: "delete_client",
  domain: "CLIENTS",
  verb: "DELETE",
  roles: PRIVILEGED,
  destructive: true,
  declaration: {
    name: "delete_client",
    description:
      "הצעה למחיקת לקוח לצמיתות — כולל כל התיקים, המסמכים והמשימות שלו. בלתי הפיך. כשהמשתמש רק רוצה להסתיר לקוח, העדף update_client עם active=false. דורש אישור.",
    parameters: { type: Type.OBJECT, properties: { clientName: str("שם הלקוח") }, required: ["clientName"] },
  },
  argsSchema: deleteArgs,
  paramsSchema: deleteParams,
  async resolve(raw) {
    const args = deleteArgs.parse(raw);
    const client = await resolveClient(args.clientName);
    if ("error" in client) return client;
    const caseCount = await prisma.case.count({ where: { clientId: client.value.id } });
    return {
      params: { clientId: client.value.id },
      summaryHebrew: `מחיקת הלקוח ${client.value.fullName} לצמיתות`,
      displayParams: [
        ["לקוח", client.value.fullName],
        ["יימחקו גם", caseCount ? `${caseCount} תיקים (${client.value.caseNumbers.join(", ")}) וכל תוכנם` : "אין תיקים"],
      ],
    };
  },
  async execute(p) {
    await deleteClient(p.clientId);
    return { ok: true, message: "הלקוח נמחק", entityHref: "/clients" };
  },
};

export const CLIENT_ACTIONS = [createClientAction, updateClientAction, deleteClientAction];
