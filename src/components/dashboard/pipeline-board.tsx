"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CaseCard } from "./case-card";
import { CASE_STATUS_LABELS, CASE_STATUS_DOT, PIPELINE_COLUMNS } from "@/lib/constants";
import { ChevronDown } from "lucide-react";
import type { CaseSummary } from "@/types";

interface PipelineBoardProps {
  cases: CaseSummary[];
}

const COLUMN_ORDER = PIPELINE_COLUMNS;

export function PipelineBoard({ cases }: PipelineBoardProps) {
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());

  const byStatus = COLUMN_ORDER.reduce<Record<string, CaseSummary[]>>((acc, status) => {
    acc[status] = cases.filter((c) => c.status === status);
    return acc;
  }, {} as Record<string, CaseSummary[]>);

  const toggleColumn = (status: string) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <div className="pipeline-scroll flex gap-4 pb-4">
      {COLUMN_ORDER.map((status) => {
        const columnCases = byStatus[status] ?? [];
        const isCollapsed = collapsedColumns.has(status);

        return (
          <div key={status} className="pipeline-column flex flex-col gap-3">
            {/* Column header */}
            <button
              onClick={() => toggleColumn(status)}
              className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2.5 hover:bg-slate-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", CASE_STATUS_DOT[status])} />
                <span className="text-xs font-semibold text-slate-700">
                  {CASE_STATUS_LABELS[status]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-slate-600 shadow-sm">
                  {columnCases.length}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-slate-400 transition-transform",
                    isCollapsed && "-rotate-90"
                  )}
                />
              </div>
            </button>

            {/* Cards */}
            {!isCollapsed && (
              <div className="flex flex-col gap-2.5">
                {columnCases.length === 0 ? (
                  <div className="flex h-20 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-400">
                    אין תיקים
                  </div>
                ) : (
                  columnCases.map((c) => <CaseCard key={c.id} caseItem={c} />)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
