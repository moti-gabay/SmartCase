import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash-lite";

// Lazy-initialize so the module loads even without GEMINI_API_KEY in dev.
let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

// Shared lazy client for other AI features (assistant chat uses its own model).
export const getGeminiClient = getClient;

// Strip Markdown/formatting so letters come back as clean plain text.
function stripMarkdown(text: string): string {
  return text
    // horizontal rules on their own line: --- *** ___
    .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "")
    // heading hashes at line start (## Title)
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "")
    // blockquote markers
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    // bold/italic **x** __x__ *x*
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    // inline code `x`
    .replace(/`([^`]+)`/g, "$1")
    // collapse excess blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Document Analyzer ─────────────────────────────────────────────────────────

export interface DocumentValidationResult {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
  documentAge?: string;
  summary: string;
}

export async function analyzeDocument(
  documentBase64: string,
  documentType: string,
  mediaType: "image/png" | "image/jpeg" | "application/pdf"
): Promise<DocumentValidationResult> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { inlineData: { mimeType: mediaType, data: documentBase64 } },
      {
        text: `אתה עוזר מומחה לתביעות ביטוח לאומי בישראל.
בדוק את המסמך הבא מסוג: "${documentType}".

בדוק:
1. האם המסמך תקף ועדכני (לא עבר 6 חודשים)?
2. האם יש חתימה ו/או חותמת?
3. האם הפרטים ברורים וקריאים?
4. האם יש בעיות שיכולות לגרום לפסילה?

ענה ב-JSON בפורמט:
{
  "isValid": true/false,
  "issues": ["..."],
  "recommendations": ["..."],
  "documentAge": "X חודשים / לא ידוע",
  "summary": "סיכום קצר בעברית"
}`,
      },
    ],
    config: { maxOutputTokens: 1024, responseMimeType: "application/json" },
  });

  const text = response.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      isValid: false,
      issues: ["לא ניתן לנתח את המסמך"],
      recommendations: [],
      summary: "שגיאה בניתוח המסמך",
    };
  }
  return JSON.parse(jsonMatch[0]) as DocumentValidationResult;
}

// ── Letter Generator ───────────────────────────────────────────────────────────

export interface LetterInput {
  clientName: string;
  nationalId: string;
  dateOfBirth: string;
  primaryCondition: string;
  recognizedPercentage?: number;
  claimedPercentage?: number;
  claimDescription?: string;
  caseType: string;
  caseNumber: string;
  agentName: string;
  letterTypeLabel: string;   // e.g. "מכתב ערעור"
  letterPurpose: string;     // instruction describing the letter's goal
  context?: string;          // free-text notes/reasons from the advisor
}

export async function generateHebrewLetter(input: LetterInput): Promise<string> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `אתה כותב מכתבים רשמיים לביטוח הלאומי עבור עורכי דין ויועצי נכות.

סוג המכתב המבוקש: ${input.letterTypeLabel}
מטרת המכתב: ${input.letterPurpose}

כתוב מכתב רשמי ומקצועי בעברית עבור:

שם: ${input.clientName}
ת.ז.: ${input.nationalId}
תאריך לידה: ${input.dateOfBirth}
מצב רפואי עיקרי: ${input.primaryCondition}
אחוז מוכר קיים: ${input.recognizedPercentage ?? "לא ידוע"}%
אחוז מבוקש: ${input.claimedPercentage ?? "לא ידוע"}%
סוג תביעה: ${input.caseType}
מספר תיק: ${input.caseNumber}
${input.claimDescription ? `פרטי הבקשה: ${input.claimDescription}` : ""}
${input.context ? `\nהקשר, נסיבות ונימוקים שסיפק היועץ (שלב במכתב באופן טבעי):\n${input.context}` : ""}

המכתב צריך:
- להתאים במדויק לסוג המכתב ולמטרתו שצוינו למעלה
- להיות רשמי ומקצועי
- לכלול פתיח, גוף המכתב עם נימוקים, וסיום
- להפנות לסעיפי חוק רלוונטיים (חוק הביטוח הלאומי) כאשר מתאים
- להיות ב-RTL עברית תקינה
- לכלול שם הסוכן: ${input.agentName}
- תאריך: ${new Date().toLocaleDateString("he-IL")}

חשוב מאוד: החזר טקסט רגיל בלבד, ללא כל סימוני עיצוב או Markdown. אין להשתמש ב-** (הדגשה), ב-## (כותרות), ב--- (קווים מפרידים), בגרשיים לעיצוב, או בכל תגית עיצוב אחרת. רק טקסט נקי.`,
    config: { maxOutputTokens: 2048 },
  });

  return stripMarkdown(response.text ?? "");
}

// ── Call Summary (raw conversation notes → structured Hebrew summary) ──────────

export async function summarizeCallHebrew(rawInput: string): Promise<string> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `אתה עוזר תיעוד מקצועי במשרד ייעוץ המטפל בתביעות ומקרים בירוקרטיים.
לפניך רישום גולמי של שיחה עם לקוח (או תמלול). סכם אותו לתיעוד רשמי בתיק.

הרישום הגולמי:
"""
${rawInput}
"""

החזר סיכום תמציתי ומובנה בעברית, במבנה המדויק הבא ובדיוק שלוש הכותרות הבאות, כל אחת בשורה נפרדת:

נקודות מפתח:
- ...

החלטות:
- ...

משימות להמשך:
- ...

כללים מחייבים:
- הסתמך אך ורק על המידע שברישום הגולמי. אין להמציא פרטים, שמות, תאריכים או סכומים.
- אם אין תוכן לאחת הכותרות, כתוב "אין" בשורה תחתיה.
- כתוב בגוף שלישי, בשפה עניינית ותמציתית, ללא פנייה ישירה ללקוח.
- החזר טקסט רגיל בלבד, ללא כל סימוני עיצוב או Markdown. אין להשתמש ב-** (הדגשה), ב-## (כותרות), ב--- (קווים מפרידים) או בכל תגית עיצוב אחרת.`,
    config: { maxOutputTokens: 1024 },
  });

  return stripMarkdown(response.text ?? "");
}

// ── Letter Refiner (chat-style improvement) ─────────────────────────────────────

export async function refineHebrewLetter(currentLetter: string, feedback: string): Promise<string> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `הנה מכתב רשמי קיים בעברית עבור המוסד לביטוח לאומי:

${currentLetter}

בצע את השינוי/שיפור הבא לפי בקשת המשתמש:
"${feedback}"

החזר את המכתב המעודכן במלואו בלבד, ללא הסברים או הערות נוספות, בעברית רשמית ותקינה, RTL, תוך שמירה על מבנה מכתב רשמי ומקצועי.

חשוב מאוד: החזר טקסט רגיל בלבד, ללא כל סימוני עיצוב או Markdown. אין להשתמש ב-** (הדגשה), ב-## (כותרות), ב--- (קווים מפרידים), או בכל תגית עיצוב אחרת. רק טקסט נקי.`,
    config: { maxOutputTokens: 4096 },
  });

  return stripMarkdown(response.text ?? "");
}
