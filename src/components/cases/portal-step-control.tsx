"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCasePortalStep } from "@/lib/actions";
import { CASE_STEP_LABELS } from "@/lib/constants";
import { CASE_STEP_ORDER } from "@/lib/portal/journey";
import type { CaseStep } from "@/types";
import { Loader2, Route } from "lucide-react";

// Staff-side control for the client's portal journey step. This is the only
// way to move through the staff-driven transitions (SCHEDULE_MEETING →
// TRACKING) until the Smart Scheduling module lands, and the escape hatch to
// reset a client's journey.
export function PortalStepControl({ caseId, step }: { caseId: string; step: CaseStep }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const onChange = (next: CaseStep) => {
    setError(false);
    startTransition(async () => {
      try {
        await setCasePortalStep(caseId, next);
        router.refresh();
      } catch {
        setError(true);
      }
    });
  };

  return (
    <div className="flex items-start gap-2.5">
      <Route className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">שלב בפורטל הלקוח</p>
        <div className="mt-1 flex items-center gap-2">
          <select
            value={step}
            disabled={pending}
            onChange={(e) => onChange(e.target.value as CaseStep)}
            className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
          >
            {CASE_STEP_ORDER.map((s) => (
              <option key={s} value={s}>{CASE_STEP_LABELS[s]}</option>
            ))}
          </select>
          {pending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />}
        </div>
        {error && <p className="mt-1 text-[11px] text-red-600">עדכון השלב נכשל</p>}
      </div>
    </div>
  );
}
