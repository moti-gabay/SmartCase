// The trust gate between Gemini and Prisma for the document automation workflow.
//
// Everything the model returns is untrusted text. Nothing from an analysis
// reaches a database write before it has been through `parseDocumentAnalysis`,
// which is deliberately *lenient about shape and strict about values*: a
// hallucinated document type or a nonsense date is dropped rather than failing
// the whole analysis, because one bad field should not cost us the other two
// automations. Only structurally unusable output (not JSON, not an object)
// fails outright.

import { z } from "zod";
import type { DocumentType } from "@/types";

// Canonical enum values, in schema order. Kept as a literal tuple (rather than
// derived from DOCUMENT_TYPE_LABELS, which is typed Record<string, string>) so
// the array itself is type-checked against the DocumentType union. Drift
// against the label map is caught by tests/document-workflow.test.ts.
export const DOCUMENT_TYPE_VALUES = [
  "NATIONAL_ID",
  "MEDICAL_REPORT",
  "PSYCHIATRIC_EVALUATION",
  "SALARY_SLIP",
  "EMPLOYER_CONFIRMATION",
  "BANK_STATEMENT",
  "HOSPITALIZATION_SUMMARY",
  "SPECIALIST_REFERRAL",
  "PRESCRIPTION",
  "LAB_RESULTS",
  "INCOME_TAX_RETURN",
  "SPOUSE_INCOME_PROOF",
  "DISABILITY_CERTIFICATE",
  "PHOTOGRAPH",
  "AUTHORITY_DECISION_LETTER",
  "APPEAL_LETTER",
  "POWER_OF_ATTORNEY",
  "RABBI_LETTER",
  "COMMUNITY_LETTER",
  "FAMILY_PHOTO",
  "OTHER",
] as const satisfies readonly DocumentType[];

const DOCUMENT_TYPE_SET: ReadonlySet<string> = new Set(DOCUMENT_TYPE_VALUES);

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && DOCUMENT_TYPE_SET.has(value);
}

// A single upload can plausibly imply a handful of follow-ups; a model claiming
// twenty is hallucinating, and creating twenty tasks would bury the case agent.
export const MAX_MISSING_DOCUMENTS = 10;

// Manager notes are read in a task description — long enough for a real
// explanation, short enough that a runaway generation cannot bloat a row.
export const MAX_MANAGER_NOTES_LENGTH = 1000;

// Accepts what Gemini actually emits for dates: "2026-09-14" or a full ISO
// timestamp. Anything else (Hebrew prose, "soon", a partial date) yields null,
// which the engine treats as "no hearing date" rather than an error.
export function parseHearingDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T09:00:00.000Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const documentAnalysisSchema = z.object({
  // An unrecognized type is downgraded to OTHER rather than rejected — the
  // classification is informational, while the three automations below are not.
  documentType: z
    .unknown()
    .optional()
    .transform((v): DocumentType => (isDocumentType(v) ? v : "OTHER")),

  // Unknown members are dropped, duplicates collapsed, and the list is capped.
  // Deliberately `z.unknown()` rather than `z.array(...)`: a model that emits a
  // bare string or null here would otherwise fail the whole safeParse and cost
  // us the hearing and manager-attention effects in the same payload.
  missingDocuments: z
    .unknown()
    .optional()
    .transform((v): DocumentType[] => [
      ...new Set((Array.isArray(v) ? v : []).filter(isDocumentType)),
    ].slice(0, MAX_MISSING_DOCUMENTS)),

  courtHearingDate: z.unknown().optional().transform(parseHearingDate),

  requiresManagerAttention: z
    .unknown()
    .optional()
    .transform((v) => v === true),

  managerNotes: z
    .unknown()
    .optional()
    .transform((v) =>
      typeof v === "string" && v.trim().length > 0
        ? v.trim().slice(0, MAX_MANAGER_NOTES_LENGTH)
        : null,
    ),
});

export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>;

export type DocumentAnalysisParse =
  | { ok: true; data: DocumentAnalysis }
  | { ok: false; reason: string };

// Gemini still fences its output occasionally even under
// responseMimeType: "application/json", so strip that before parsing.
function stripJsonFence(raw: string): string {
  return raw
    .replace(/^\s*```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

export function parseDocumentAnalysis(raw: string | null | undefined): DocumentAnalysisParse {
  if (!raw || raw.trim().length === 0) return { ok: false, reason: "empty-response" };

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(raw));
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, reason: "not-an-object" };
  }

  const parsed = documentAnalysisSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema-mismatch" };
  return { ok: true, data: parsed.data };
}

// The instruction half of the analysis call. Kept next to the schema so the
// requested JSON shape and the validated shape can never drift apart.
export function buildDocumentAnalysisPrompt(documentTypeLabel: string): string {
  return `אתה עוזר מומחה במשרד המטפל בתיקי ביטוח לאומי וגיור בישראל.

לפניך מסמך שהועלה לתיק, שסווג על ידי הצוות כ: "${documentTypeLabel}".

נתח את המסמך והחזר JSON בלבד, במבנה המדויק הבא:
{
  "documentType": "אחד מהערכים ברשימה המותרת בלבד",
  "missingDocuments": ["ערכים מהרשימה המותרת בלבד"],
  "courtHearingDate": "YYYY-MM-DD או null",
  "requiresManagerAttention": true/false,
  "managerNotes": "הסבר קצר בעברית או null"
}

הרשימה המותרת ל-documentType ול-missingDocuments:
${DOCUMENT_TYPE_VALUES.join(", ")}

כללים מחייבים:
- missingDocuments: רק מסמכים שהמסמך הזה מלמד במפורש שהם חסרים או נדרשים להמשך. אם אין כאלה, החזר [].
- courtHearingDate: רק אם מופיע במסמך תאריך דיון בבית דין בפועל. אין לנחש ואין להמציא תאריך. אחרת null.
- requiresManagerAttention: true רק אם יש דחיפות אמיתית — דחייה, מועד אחרון קרוב, או סתירה מהותית בפרטים.
- managerNotes: חובה כאשר requiresManagerAttention הוא true, אחרת null.
- אין להוסיף שדות, אין טקסט מחוץ ל-JSON, ואין סימוני עיצוב.`;
}
