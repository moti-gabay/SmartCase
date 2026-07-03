import { cn } from "@/lib/utils";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_COLORS,
  CASE_STATUS_DOT,
  PRIORITY_LABELS,
  DOCUMENT_STATUS_LABELS,
} from "@/lib/constants";
import type { CaseStatus, Priority, DocumentStatus } from "@/types";

interface StatusBadgeProps {
  status: CaseStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        CASE_STATUS_COLORS[status],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", CASE_STATUS_DOT[status])} />
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
}

const PRIORITY_STYLES: Record<Priority, string> = {
  LOW:    "bg-slate-100 text-slate-600 border-slate-200",
  MEDIUM: "bg-blue-50 text-blue-600 border-blue-200",
  HIGH:   "bg-orange-50 text-orange-600 border-orange-200",
  URGENT: "bg-red-50 text-red-600 border-red-200",
};

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        PRIORITY_STYLES[priority],
        className
      )}
    >
      {priority === "URGENT" && (
        <span className="urgent-pulse me-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
      )}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

interface DocStatusBadgeProps {
  status: DocumentStatus;
  className?: string;
}

const DOC_STATUS_STYLES: Record<DocumentStatus, string> = {
  MISSING:                 "bg-red-50 text-red-600 border-red-200",
  PENDING_UPLOAD:          "bg-slate-100 text-slate-500 border-slate-200",
  UPLOADED_PENDING_REVIEW: "bg-amber-50 text-amber-600 border-amber-200",
  APPROVED:                "bg-emerald-50 text-emerald-600 border-emerald-200",
  REJECTED:                "bg-red-50 text-red-700 border-red-200",
  EXPIRED:                 "bg-slate-100 text-slate-500 border-slate-200",
};

export function DocStatusBadge({ status, className }: DocStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        DOC_STATUS_STYLES[status],
        className
      )}
    >
      {DOCUMENT_STATUS_LABELS[status]}
    </span>
  );
}
