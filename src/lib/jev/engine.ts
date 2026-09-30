// Runs registered rule vectors over one proposed action. Sequential (0–3 rules
// per action) so verdict order is deterministic; fails closed if a rule throws.
import type { JevContext, JevResult, JevRule, JevVerdict, JevWarning } from "@/lib/jev/types";

export const JEV_RULE_ERROR_REASON = "בדיקת המדיניות נכשלה — הפעולה נחסמה מטעמי בטיחות";

export async function evaluateJev<P>(
  rules: readonly JevRule<P>[] | undefined,
  params: P,
  ctx: JevContext
): Promise<JevResult> {
  const verdicts: JevVerdict[] = [];
  const evaluated: string[] = [];
  for (const rule of rules ?? []) {
    evaluated.push(rule.id);
    try {
      const verdict = await rule.evaluate(params, ctx);
      if (verdict) verdicts.push(verdict);
    } catch (err) {
      console.error(`[jev] rule ${rule.id} threw:`, err);
      verdicts.push({ ruleId: rule.id, status: "BLOCKED", reasonHebrew: JEV_RULE_ERROR_REASON });
    }
  }
  const status = verdicts.some((v) => v.status === "BLOCKED")
    ? "BLOCKED"
    : verdicts.length > 0
      ? "WARNING_REQUIRES_ELEVATED_APPROVAL"
      : "ALLOWED";
  return { status, verdicts, evaluated };
}

export const blockedReason = (r: JevResult): string =>
  r.verdicts.filter((v) => v.status === "BLOCKED").map((v) => v.reasonHebrew).join(" · ");

export const toWarnings = (r: JevResult): JevWarning[] =>
  r.verdicts
    .filter((v) => v.status === "WARNING_REQUIRES_ELEVATED_APPROVAL")
    .map((v) => ({ ruleId: v.ruleId, reasonHebrew: v.reasonHebrew }));

// Every current warning must have been shown (and acknowledged) on the card.
export const unacknowledged = (warnings: JevWarning[], acknowledged: readonly string[] | undefined): JevWarning[] =>
  warnings.filter((w) => !(acknowledged ?? []).includes(w.ruleId));
