// The trust gate between Gemini and Prisma for the personal-story intake
// workflow.
//
// Everything the model returns is untrusted text. Nothing from an extraction
// reaches a database write before it has been through `parseStoryIntake`, which
// is deliberately *lenient about shape and strict about values*: a hallucinated
// gap or a non-array list is dropped rather than failing the whole intake,
// because one bad field should not cost us the other fan-out effects. Only
// structurally unusable output (not JSON, not an object) fails outright.

import { z } from "zod";

// The only intake gaps the office actually acts on. A closed tuple — not free
// AI prose — because each value becomes a task TITLE, and that title is the
// dedupe key against open tasks. AI-generated titles would stack duplicates on
// every re-run.
export const INTAKE_GAP_VALUES = [
  "MISSING_MOTIVATION",      // the story never states why the client seeks גיור
  "MISSING_TIMELINE",        // no sense of how long the process has been running
  "MISSING_COMMUNITY",       // no community / synagogue affiliation named
  "MISSING_RABBI",           // no sponsoring rabbi named
  "MISSING_FAMILY_STATUS",   // marital / children situation unclear
  "MISSING_REFERENCES",      // no supporting people named
  "MISSING_DOCUMENTS",       // the story references documents not yet in the case
] as const;

export type IntakeGap = (typeof INTAKE_GAP_VALUES)[number];

// Hebrew task-title fragment per gap. Kept next to the tuple so a new gap
// cannot be added without its wording. Deliberately not in src/lib/constants.ts
// — this is an AI-contract value, not a DB enum, and it is never rendered as a
// status chip: it is rendered *inside* a task title.
export const INTAKE_GAP_LABELS: Record<IntakeGap, string> = {
  MISSING_MOTIVATION:    "השלמת המניע לגיור",
  MISSING_TIMELINE:      "בירור משך התהליך עד כה",
  MISSING_COMMUNITY:     "בירור שיוך קהילתי",
  MISSING_RABBI:         "איתור רב מלווה",
  MISSING_FAMILY_STATUS: "השלמת מצב משפחתי",
  MISSING_REFERENCES:    "השלמת ממליצים",
  MISSING_DOCUMENTS:     "איסוף המסמכים שהוזכרו בסיפור",
};

const INTAKE_GAP_SET: ReadonlySet<string> = new Set(INTAKE_GAP_VALUES);

export function isIntakeGap(value: unknown): value is IntakeGap {
  return typeof value === "string" && INTAKE_GAP_SET.has(value);
}

// ~a paragraph; anything longer is the model retelling the story back to us.
const MAX_SUMMARY_LENGTH = 600;
// More than five open follow-ups on one intake buries the case agent.
const MAX_GAPS = 5;
// Names/documents worth chasing, not an index of the whole story.
const MAX_MENTIONED = 8;
const MAX_NAME_LENGTH = 80;
const MAX_RED_FLAG_NOTES_LENGTH = 1000;

// trim → empty becomes null → hard cap. Every free-text field is the same
// shape, so it is one helper rather than nine repeated ternaries.
const text = (cap: number) => (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, cap) : null;

// Non-arrays degrade to [] rather than failing the parse (the model sometimes
// emits a bare string here); members are trimmed, capped, deduped.
const stringList = (max: number, cap: number) => (v: unknown): string[] =>
  [
    ...new Set(
      (Array.isArray(v) ? v : [])
        .map((x) => (typeof x === "string" ? x.trim().slice(0, cap) : ""))
        .filter((x) => x.length > 0),
    ),
  ].slice(0, max);

export const storyIntakeSchema = z.object({
  // Rendered in the case panel and the timeline description — the single most
  // useful thing a case agent reads before a first meeting.
  motivationSummary: z.unknown().optional().transform(text(MAX_SUMMARY_LENGTH)),

  // Free-form Hebrew duration ("כשנתיים") — deliberately not parsed to a date;
  // used as panel context, never as a due date.
  processDuration: z.unknown().optional().transform(text(120)),

  // Family + community context the wizard may have left blank. Displayed, and
  // their absence is what the model is told to report as a gap.
  familyStatus: z.unknown().optional().transform(text(200)),
  communityAffiliation: z.unknown().optional().transform(text(200)),

  // Documents the client SAID they have. Feeds the MISSING_DOCUMENTS task
  // description so the agent knows what to ask for by name.
  mentionedDocuments: z
    .unknown()
    .optional()
    .transform(stringList(MAX_MENTIONED, MAX_NAME_LENGTH)),

  // People named in the story — candidate ממליצים.
  mentionedPeople: z
    .unknown()
    .optional()
    .transform(stringList(MAX_MENTIONED, MAX_NAME_LENGTH)),

  // THE fan-out driver: closed enum, deduped, capped. One follow-up task per
  // gap, so an unrecognized member is dropped rather than becoming a task.
  gaps: z
    .unknown()
    .optional()
    .transform((v): IntakeGap[] =>
      [...new Set((Array.isArray(v) ? v : []).filter(isIntakeGap))].slice(0, MAX_GAPS),
    ),

  // Escalation. Strict `=== true` so a truthy string ("yes") can never raise a
  // case to URGENT; the notes are what the manager task carries as its body.
  hasRedFlags: z.unknown().optional().transform((v) => v === true),
  redFlagNotes: z.unknown().optional().transform(text(MAX_RED_FLAG_NOTES_LENGTH)),
});

export type StoryIntake = z.infer<typeof storyIntakeSchema>;

export type StoryIntakeParse =
  | { ok: true; data: StoryIntake }
  | { ok: false; reason: string };

// Gemini still fences its output occasionally even under
// responseMimeType: "application/json", so strip that before parsing.
function stripJsonFence(raw: string): string {
  return raw
    .replace(/^\s*```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

export function parseStoryIntake(raw: string | null | undefined): StoryIntakeParse {
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

  const parsed = storyIntakeSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema-mismatch" };
  return { ok: true, data: parsed.data };
}

// The stored Json column may hold a payload written by an older shape of this
// contract. Route it back through the same lenient parser rather than casting,
// so the writer and the reader cannot drift.
export function readStoredIntake(raw: unknown): StoryIntake | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = storyIntakeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// The extraction runs on plain text (not audio), so it stays on the cheap model
// the rest of the document/letter pipeline uses.
export const STORY_INTAKE_MODEL = "gemini-2.5-flash-lite";
export const STORY_INTAKE_MAX_OUTPUT_TOKENS = 1536;

// The instruction half of the extraction call. Kept next to the schema so the
// requested JSON shape and the validated shape can never drift apart.
export function buildStoryIntakePrompt(transcript: string): string {
  return `אתה עוזר מקצועי במשרד המלווה תיקי גיור. לפניך תמלול של סיפור אישי שסיפר הלקוח בקולו.

התמלול:
"""
${transcript}
"""

החזר JSON בלבד, במבנה המדויק הבא:
{
  "motivationSummary": "סיכום קצר בעברית של המניע לגיור, עד 3 משפטים, או null אם לא נאמר",
  "processDuration": "משך התהליך עד כה כפי שנאמר (למשל: כשנתיים), או null",
  "familyStatus": "מצב משפחתי כפי שעולה מהסיפור, או null",
  "communityAffiliation": "קהילה / בית כנסת / רב שהוזכרו, או null",
  "mentionedDocuments": ["שמות מסמכים שהלקוח אמר שיש ברשותו"],
  "mentionedPeople": ["שמות אנשים שהוזכרו כתומכים או כמלווים"],
  "gaps": ["ערכים מהרשימה הסגורה בלבד"],
  "hasRedFlags": false,
  "redFlagNotes": "הסבר קצר בעברית אם וכאשר hasRedFlags=true, אחרת null"
}

ערכי gaps האפשריים (אלה בלבד): ${INTAKE_GAP_VALUES.join(", ")}

כללים מחייבים:
- דווח על gap רק כאשר המידע באמת חסר בתמלול. אין לנחש ואין להשלים מידע שלא נאמר.
- אין להמציא שמות, תאריכים או מסמכים שלא הוזכרו במפורש.
- hasRedFlags=true רק כאשר עולה חשש ממשי (סתירה מהותית, לחץ מצד גורם חיצוני, מצוקה או סיכון) — לא בשל מידע חסר.
- כל הטקסט החופשי בעברית.
- אין להוסיף שדות, אין טקסט מחוץ ל-JSON, ואין סימוני עיצוב.`;
}
