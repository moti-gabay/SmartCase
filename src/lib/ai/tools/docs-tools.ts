// Documents domain actions: letter generation / refinement, AI analysis,
// staff review, and deletion. Each executes through the path the UI uses —
// the letters and document-analysis services (shared with /api/ai/letter* and
// /api/documents/[id]/analyze) and the reviewDocument / deleteDocument actions.
//
// Uploading is deliberately absent: it needs file bytes, which a chat turn
// cannot carry. The assistant points to the case page for that.
import { Type } from "@google/genai";
import { z } from "zod";
import { deleteDocument, reviewDocument } from "@/lib/actions";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS, LETTER_TYPE_LABELS } from "@/lib/constants";
import { generateLetter, refineLetter, LETTER_TYPES } from "@/lib/services/letters";
import { analyzeAndAutomateDocument } from "@/lib/services/document-analysis";
import { formatDay } from "@/lib/ai/tools/intent";
import { resolveCase, resolveDocument, resolveLetter } from "@/lib/ai/tools/resolve";
import type { ActionDefinition, DisplayParam } from "@/lib/ai/tools/types";

const STAFF = ["ADMIN", "SUPERVISOR", "AGENT"] as const;
const LETTER_TYPE_KEYS = LETTER_TYPES as [string, ...string[]];

const str = (description: string) => ({ type: Type.STRING, description });
const text = (max: number) => z.string().trim().min(1).max(max);
const caseHref = (id: string) => `/cases/${id}`;

async function resolveCaseDocument(caseNumber: string, document: string) {
  const kase = await resolveCase(caseNumber);
  if ("error" in kase) return kase;
  const doc = await resolveDocument(kase.value.id, document, DOCUMENT_TYPE_LABELS);
  if ("error" in doc) return doc;
  return { value: { kase: kase.value, doc: doc.value } };
}

// ─── generate_letter ─────────────────────────────────────────────────────────

const generateArgs = z.object({
  caseNumber: text(50),
  letterType: z.enum(LETTER_TYPE_KEYS),
  context: text(2000).optional(),
});
const generateParams = z.object({
  caseId: z.string().min(1),
  letterType: z.enum(LETTER_TYPE_KEYS),
  context: z.string().max(2000).optional(),
});

const generateLetterAction: ActionDefinition<z.infer<typeof generateParams>> = {
  name: "generate_letter",
  domain: "DOCUMENTS",
  verb: "GENERATE",
  roles: STAFF,
  declaration: {
    name: "generate_letter",
    description:
      "הצעה להפקת מכתב רשמי בעברית לתיק באמצעות AI. המכתב נשמר בתיק וניתן לצפייה, עידון והדפסה ב-/ai-tools. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        letterType: str(
          `סוג מכתב, אחד מ: ${LETTER_TYPE_KEYS.map((k) => `${k} (${LETTER_TYPE_LABELS[k]})`).join(", ")}`
        ),
        context: str("הנחיות או הקשר נוסף למכתב (אופציונלי)"),
      },
      required: ["caseNumber", "letterType"],
    },
  },
  argsSchema: generateArgs,
  paramsSchema: generateParams,
  async resolve(raw) {
    const args = generateArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const display: DisplayParam[] = [
      ["תיק", kase.value.caseNumber],
      ["סוג מכתב", LETTER_TYPE_LABELS[args.letterType]],
    ];
    if (args.context) display.push(["הנחיות", args.context]);
    return {
      params: { caseId: kase.value.id, letterType: args.letterType, context: args.context },
      summaryHebrew: `הפקת ${LETTER_TYPE_LABELS[args.letterType]} לתיק ${kase.value.caseNumber}`,
      displayParams: display,
    };
  },
  async execute(p, actor) {
    const letter = await generateLetter({ caseId: p.caseId, letterType: p.letterType, context: p.context, actor });
    if (!letter) return { ok: false, message: "התיק לא נמצא" };
    // The letter body is not echoed into chat — it carries client identity
    // details and belongs in the letter screen, not the conversation log.
    return { ok: true, message: `המכתב "${letter.title}" נוצר — לצפייה והדפסה ב-/ai-tools`, entityHref: "/ai-tools" };
  },
};

// ─── refine_letter ───────────────────────────────────────────────────────────

const refineArgs = z.object({
  caseNumber: text(50),
  feedback: text(1000),
  letterType: z.enum(LETTER_TYPE_KEYS).optional(),
});
const refineParams = z.object({ letterId: z.string().min(1), feedback: z.string().min(1).max(1000) });

const refineLetterAction: ActionDefinition<z.infer<typeof refineParams>> = {
  name: "refine_letter",
  domain: "DOCUMENTS",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "refine_letter",
    description:
      "הצעה לעידון מכתב קיים בתיק לפי הערה (ברירת מחדל: המכתב האחרון שהופק בתיק). התוכן הקודם מוחלף. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        feedback: str("מה לשנות במכתב"),
        letterType: str(`סוג המכתב לעידון, אם יש כמה (${LETTER_TYPE_KEYS.join(", ")})`),
      },
      required: ["caseNumber", "feedback"],
    },
  },
  argsSchema: refineArgs,
  paramsSchema: refineParams,
  async resolve(raw) {
    const args = refineArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const letter = await resolveLetter(kase.value.id, args.letterType);
    if ("error" in letter) return letter;
    return {
      params: { letterId: letter.value.id, feedback: args.feedback },
      summaryHebrew: `עידון המכתב "${letter.value.title}"`,
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["מכתב", letter.value.title],
        ["שינוי מבוקש", args.feedback],
      ],
    };
  },
  async execute(p) {
    const content = await refineLetter(p.letterId, p.feedback);
    if (content === null) return { ok: false, message: "המכתב לא נמצא" };
    return { ok: true, message: "המכתב עודכן — לצפייה ב-/ai-tools", entityHref: "/ai-tools" };
  },
};

// ─── analyze_document ────────────────────────────────────────────────────────

const docArgs = z.object({ caseNumber: text(50), document: text(100) });
const docParams = z.object({ documentId: z.string().min(1) });

const analyzeDocumentAction: ActionDefinition<z.infer<typeof docParams>> = {
  name: "analyze_document",
  domain: "DOCUMENTS",
  verb: "EXECUTE",
  roles: STAFF,
  declaration: {
    name: "analyze_document",
    description:
      "הצעה להרצת ניתוח AI על מסמך שהועלה לתיק. הניתוח עשוי לפתוח משימות למסמכים חסרים, לקבוע דיון בבית דין, ולהעלות את התיק לעדיפות דחופה. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: { caseNumber: str("מספר התיק"), document: str("שם המסמך או סוגו") },
      required: ["caseNumber", "document"],
    },
  },
  argsSchema: docArgs,
  paramsSchema: docParams,
  async resolve(raw) {
    const args = docArgs.parse(raw);
    const found = await resolveCaseDocument(args.caseNumber, args.document);
    if ("error" in found) return found;
    const { kase, doc } = found.value;
    if (!doc.storageKey) return { error: "למסמך הזה אין קובץ שהועלה — אי אפשר לנתח אותו" };
    return {
      params: { documentId: doc.id },
      summaryHebrew: `ניתוח AI של "${doc.displayName}" בתיק ${kase.caseNumber}`,
      displayParams: [
        ["תיק", kase.caseNumber],
        ["מסמך", doc.displayName],
        ["עשוי לבצע", "פתיחת משימות, קביעת דיון, העלאת עדיפות"],
      ],
    };
  },
  async execute(p, actor) {
    const outcome = await analyzeAndAutomateDocument(p.documentId, actor.id);
    if (!outcome.ok) return { ok: false, message: outcome.error };
    const { result } = outcome;
    const parts = [`נפתחו ${result.tasksCreated} משימות`];
    if (result.hearingScheduledAt) parts.push(`נקבע דיון ל-${formatDay(result.hearingScheduledAt)}`);
    if (result.managerFlagged) parts.push("התיק סומן לבדיקת מנהל");
    if (result.failures.length) parts.push(`${result.failures.length} פעולות נכשלו`);
    return { ok: true, message: `הניתוח הושלם: ${parts.join(", ")}`, entityHref: caseHref(outcome.caseId) };
  },
};

// ─── review_document ─────────────────────────────────────────────────────────

const reviewArgs = z
  .object({
    caseNumber: text(50),
    document: text(100),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: text(500).optional(),
  })
  .refine((a) => a.decision === "APPROVED" || !!a.reason, {
    message: "דחייה מחייבת סיבה — שאל את המשתמש מה הסיבה",
    path: ["reason"],
  });
const reviewParams = z.object({
  documentId: z.string().min(1),
  caseId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().max(500).optional(),
});

const reviewDocumentAction: ActionDefinition<z.infer<typeof reviewParams>> = {
  name: "review_document",
  domain: "DOCUMENTS",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "review_document",
    description:
      "הצעה לאישור או דחיית מסמך שממתין לבדיקה. דחייה מחייבת סיבה, והלקוח מקבל עליה הודעה במייל. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        document: str("שם המסמך או סוגו"),
        decision: str('"APPROVED" לאישור או "REJECTED" לדחייה'),
        reason: str("סיבת הדחייה (חובה בדחייה)"),
      },
      required: ["caseNumber", "document", "decision"],
    },
  },
  argsSchema: reviewArgs,
  paramsSchema: reviewParams,
  async resolve(raw) {
    const args = reviewArgs.parse(raw);
    const found = await resolveCaseDocument(args.caseNumber, args.document);
    if ("error" in found) return found;
    const { kase, doc } = found.value;
    if (doc.status !== "UPLOADED_PENDING_REVIEW") {
      return { error: `המסמך אינו ממתין לבדיקה (סטטוס: ${DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status})` };
    }
    const reject = args.decision === "REJECTED";
    const display: DisplayParam[] = [
      ["תיק", kase.caseNumber],
      ["מסמך", doc.displayName],
      ["החלטה", reject ? "דחייה" : "אישור"],
    ];
    if (reject) {
      display.push(["סיבה", args.reason!]);
      display.push(["שים לב", "הלקוח יקבל הודעה במייל עם סיבת הדחייה"]);
    }
    return {
      params: { documentId: doc.id, caseId: kase.id, decision: args.decision, reason: args.reason },
      summaryHebrew: `${reject ? "דחיית" : "אישור"} המסמך "${doc.displayName}" בתיק ${kase.caseNumber}`,
      displayParams: display,
    };
  },
  async execute(p) {
    await reviewDocument(p.documentId, p.decision, p.reason);
    return {
      ok: true,
      message: p.decision === "APPROVED" ? "המסמך אושר" : "המסמך נדחה והלקוח עודכן",
      entityHref: caseHref(p.caseId),
    };
  },
};

// ─── delete_document ─────────────────────────────────────────────────────────

const deleteParams = z.object({ documentId: z.string().min(1), caseId: z.string().min(1) });

const deleteDocumentAction: ActionDefinition<z.infer<typeof deleteParams>> = {
  name: "delete_document",
  domain: "DOCUMENTS",
  verb: "DELETE",
  roles: STAFF,
  destructive: true,
  declaration: {
    name: "delete_document",
    description:
      "הצעה למחיקת מסמך מתיק, כולל הקובץ באחסון. פריט הצ'קליסט המקושר חוזר ל'חסר'. בלתי הפיך — דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: { caseNumber: str("מספר התיק"), document: str("שם המסמך או סוגו") },
      required: ["caseNumber", "document"],
    },
  },
  argsSchema: docArgs,
  paramsSchema: deleteParams,
  async resolve(raw) {
    const args = docArgs.parse(raw);
    const found = await resolveCaseDocument(args.caseNumber, args.document);
    if ("error" in found) return found;
    const { kase, doc } = found.value;
    return {
      params: { documentId: doc.id, caseId: kase.id },
      summaryHebrew: `מחיקת המסמך "${doc.displayName}" מתיק ${kase.caseNumber}`,
      displayParams: [
        ["תיק", kase.caseNumber],
        ["מסמך", doc.displayName],
        ["סטטוס", DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status],
        ["אחרי המחיקה", "פריט הצ'קליסט יסומן כחסר"],
      ],
    };
  },
  async execute(p) {
    await deleteDocument(p.documentId);
    return { ok: true, message: "המסמך נמחק", entityHref: caseHref(p.caseId) };
  },
};

export const DOCUMENT_ACTIONS = [
  generateLetterAction,
  refineLetterAction,
  analyzeDocumentAction,
  reviewDocumentAction,
  deleteDocumentAction,
];
