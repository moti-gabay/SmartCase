import Link from "next/link";
import { cn, formatDate, isDateOverdue } from "@/lib/utils";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { CASE_TYPE_LABELS } from "@/lib/constants";
import { AlertTriangle, Clock, User, Calendar } from "lucide-react";
import type { CaseSummary } from "@/types";

interface CaseCardProps {
  caseItem: CaseSummary;
}

export function CaseCard({ caseItem }: CaseCardProps) {
  const isDeadlineOverdue =
    caseItem.submissionDeadline && isDateOverdue(caseItem.submissionDeadline);

  return (
    <Link href={`/cases/${caseItem.id}`}>
      <div
        className={cn(
          "group flex cursor-pointer flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md",
          caseItem.priority === "URGENT" && "border-red-200",
          caseItem.isOverdue && "border-orange-200"
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              {caseItem.clientName}
            </p>
            <p className="text-[11px] font-mono text-slate-400">{caseItem.caseNumber}</p>
          </div>
          <PriorityBadge priority={caseItem.priority} />
        </div>

        {/* Case type */}
        <p className="text-xs text-slate-500 leading-tight">
          {CASE_TYPE_LABELS[caseItem.caseType]}
        </p>

        {/* Alerts row */}
        {(caseItem.hasMissingDocuments || caseItem.isOverdue || isDeadlineOverdue) && (
          <div className="flex flex-wrap gap-1.5">
            {caseItem.hasMissingDocuments && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {caseItem.missingDocsCount} מסמכים חסרים
              </span>
            )}
            {(caseItem.isOverdue || isDeadlineOverdue) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                <Clock className="h-3 w-3" />
                באיחור
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
          <div className="flex items-center gap-1">
            <User className="h-3 w-3" />
            <span className="truncate max-w-[90px]">
              {caseItem.assignedAgentName ?? "לא שויך"}
            </span>
          </div>
          {caseItem.nextFollowUpDate && (
            <div className={cn("flex items-center gap-1", isDateOverdue(caseItem.nextFollowUpDate) && "text-red-500 font-medium")}>
              <Calendar className="h-3 w-3" />
              {formatDate(caseItem.nextFollowUpDate)}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
