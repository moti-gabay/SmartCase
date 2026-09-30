// AI-tools domain actions. Generation is a read tool (summarize_case in
// assistant-tools.ts — a draft, nothing saved); persisting is this action, so
// the card shows the exact text that lands on the case timeline.
import { Type } from "@google/genai";
import { z } from "zod";
import { commitAiSummary } from "@/lib/actions";
import { resolveCase } from "@/lib/ai/tools/resolve";
import type { ActionDefinition } from "@/lib/ai/tools/types";

const STAFF = ["ADMIN", "SUPERVISOR", "AGENT"] as const;
const MAX_SUMMARY_CHARS = 4000;

const str = (description: string) => ({ type: Type.STRING, description });

const commitArgs = z.object({
  caseNumber: z.string().trim().min(1).max(50),
  summary: z.string().trim().min(3).max(MAX_SUMMARY_CHARS),
});
const commitParams = z.object({
  caseId: z.string().min(1),
  summary: z.string().min(3).max(MAX_SUMMARY_CHARS),
});

const commitSummaryAction: ActionDefinition<z.infer<typeof commitParams>> = {
  name: "commit_ai_summary",
  domain: "AI",
  verb: "CREATE",
  roles: STAFF,
  declaration: {
    name: "commit_ai_summary",
    description:
      "הצעה לשמירת סיכום שיחה בציר הפעילות של התיק (רשומה קבועה, לא ניתנת לעריכה). העבר את הטקסט שהמשתמש אישר, בדרך כלל טיוטה מ-summarize_case. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        summary: str("טקסט הסיכום המלא לשמירה"),
      },
      required: ["caseNumber", "summary"],
    },
  },
  argsSchema: commitArgs,
  paramsSchema: commitParams,
  async resolve(raw) {
    const args = commitArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    return {
      params: { caseId: kase.value.id, summary: args.summary },
      summaryHebrew: `שמירת סיכום שיחה בציר הפעילות של תיק ${kase.value.caseNumber}`,
      // Full text on the card: the approval is of exactly what gets saved.
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["סיכום", args.summary],
        ["שים לב", "הרשומה קבועה ואינה ניתנת לעריכה"],
      ],
    };
  },
  async execute(p) {
    await commitAiSummary(p.caseId, p.summary);
    return { ok: true, message: "הסיכום נשמר בציר הפעילות", entityHref: `/cases/${p.caseId}` };
  },
};

export const AI_ACTIONS = [commitSummaryAction];
