import { formatDay } from "@/lib/ai/tools/intent";
import type { JevRule } from "@/lib/jev/types";

const DEADLINE_SOON_MS = 48 * 3_600_000;

// Params carry either a "YYYY-MM-DD" day or a full ISO instant.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ilDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

type Field<P> = (p: P) => string | null | undefined;

// BLOCK when a day is before today (Israel calendar) or an instant is before now.
export function notInPast<P>(id: string, label: string, get: Field<P>): JevRule<P> {
  return {
    id,
    async evaluate(p, { now }) {
      const v = get(p);
      if (!v) return null;
      const past = DAY_ONLY.test(v) ? v < ilDay(now) : new Date(v).getTime() < now.getTime();
      return past
        ? { ruleId: id, status: "BLOCKED", reasonHebrew: `${label} (${formatDay(v)}) כבר עבר`, metadata: { value: v } }
        : null;
    },
  };
}

// WARN when a deadline is within 48h (day values are treated as end of that day).
export function deadlineSoon<P>(id: string, label: string, get: Field<P>): JevRule<P> {
  return {
    id,
    async evaluate(p, { now }) {
      const v = get(p);
      if (!v) return null;
      const end = DAY_ONLY.test(v) ? new Date(`${v}T23:59:59+02:00`).getTime() : new Date(v).getTime();
      const left = end - now.getTime();
      return left >= 0 && left < DEADLINE_SOON_MS
        ? { ruleId: id, status: "WARNING_REQUIRES_ELEVATED_APPROVAL", reasonHebrew: `${label} בעוד פחות מ-48 שעות`, metadata: { value: v } }
        : null;
    },
  };
}
