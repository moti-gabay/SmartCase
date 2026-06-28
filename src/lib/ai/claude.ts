import Anthropic from "@anthropic-ai/sdk";

// Lazy-initialize so the module loads even without ANTHROPIC_API_KEY in dev
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
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
  const client = getClient();

  // PDFs use document block; images use image block
  const contentBlock =
    mediaType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: documentBase64 } } as const)
      : ({ type: "image", source: { type: "base64", media_type: mediaType as "image/png" | "image/jpeg", data: documentBase64 } } as const);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          contentBlock,
          {
            type: "text",
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
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
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
}

export async function generateHebrewLetter(input: LetterInput): Promise<string> {
  const client = getClient();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `אתה כותב מכתבים רשמיים לביטוח הלאומי עבור עורכי דין ויועצי נכות.

כתוב מכתב בקשה/ערעור רשמי ומקצועי בעברית עבור:

שם: ${input.clientName}
ת.ז.: ${input.nationalId}
תאריך לידה: ${input.dateOfBirth}
מצב רפואי עיקרי: ${input.primaryCondition}
אחוז מוכר קיים: ${input.recognizedPercentage ?? "לא ידוע"}%
אחוז מבוקש: ${input.claimedPercentage ?? "לא ידוע"}%
סוג תביעה: ${input.caseType}
מספר תיק: ${input.caseNumber}
${input.claimDescription ? `פרטי הבקשה: ${input.claimDescription}` : ""}

המכתב צריך:
- להיות רשמי ומקצועי
- לכלול פתיח, גוף המכתב עם נימוקים, וסיום
- להפנות לסעיפי חוק רלוונטיים (חוק הביטוח הלאומי)
- להיות ב-RTL עברית תקינה
- לכלול שם הסוכן: ${input.agentName}
- תאריך: ${new Date().toLocaleDateString("he-IL")}`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
