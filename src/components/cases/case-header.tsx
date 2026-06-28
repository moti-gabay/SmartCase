"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS, PIPELINE_COLUMNS } from "@/lib/constants";
import type { CaseDetail, CaseStatus } from "@/types";
import {
  ChevronLeft,
  ChevronDown,
  Printer,
  Sparkles,
  UserCircle,
  Calendar,
  CheckCircle2,
  FileWarning,
} from "lucide-react";

interface CaseHeaderProps {
  caseDetail: CaseDetail;
  checklistProgress: { approved: number; total: number };
  onStatusChange?: (newStatus: CaseStatus) => void;
}

export function CaseHeader({ caseDetail, checklistProgress, onStatusChange }: CaseHeaderProps) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const progressPct = checklistProgress.total > 0
    ? Math.round((checklistProgress.approved / checklistProgress.total) * 100)
    : 0;

  return (
    <div className="border-b border-slate-200 bg-white">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-2">
        <Link
          href="/cases"
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
          כל התיקים
        </Link>
        <span className="text-xs text-slate-300">/</span>
        <span className="text-xs font-medium text-slate-700">{caseDetail.caseNumber}</span>
      </div>

      {/* Main header row */}
      <div className="flex flex-wrap items-start justify-between gap-4 px-6 pb-4">
        {/* Left: identity */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900">{caseDetail.client.fullName}</h1>
            <span className="rounded-md bg-slate-100 px-2.5 py-0.5 font-mono text-sm font-semibold text-slate-600">
              {caseDetail.caseNumber}
            </span>
            <PriorityBadge priority={caseDetail.priority} />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-4 w-4 text-slate-400">📋</span>
              {CASE_TYPE_LABELS[caseDetail.caseType]}
            </span>
            {caseDetail.assignedAgent && (
              <span className="flex items-center gap-1.5">
                <UserCircle className="h-4 w-4 text-slate-400" />
                {caseDetail.assignedAgent.name}
              </span>
            )}
            {caseDetail.submissionDeadline && (
              <span className="flex items-center gap-1.5 text-amber-600">
                <Calendar className="h-4 w-4" />
                מועד הגשה: {new Date(caseDetail.submissionDeadline).toLocaleDateString("he-IL")}
              </span>
            )}
            {caseDetail.authorityReferenceNumber && (
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                ב"ל: {caseDetail.authorityReferenceNumber}
              </span>
            )}
          </div>
        </div>

        {/* Right: status + actions */}
        <div className="flex items-center gap-2">
          {/* Status selector */}
          <div className="relative">
            <button
              onClick={() => setStatusMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <StatusBadge status={caseDetail.status} />
              <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", statusMenuOpen && "rotate-180")} />
            </button>

            {statusMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
                <div className="absolute start-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {PIPELINE_COLUMNS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { onStatusChange?.(s); setStatusMenuOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors",
                        s === caseDetail.status && "bg-indigo-50 text-indigo-700 font-medium"
                      )}
                    >
                      {s === caseDetail.status && <CheckCircle2 className="h-4 w-4 text-indigo-500" />}
                      {s !== caseDetail.status && <span className="h-4 w-4" />}
                      {CASE_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <Button variant="outline" size="sm">
            <Printer className="h-4 w-4" />
            הדפסה
          </Button>
          <Button size="sm" className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            יצירת מכתב
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-4 border-t border-slate-100 px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          {caseDetail.hasMissingDocuments
            ? <FileWarning className="h-4 w-4 text-amber-500" />
            : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          <span className="font-medium text-slate-700">
            {checklistProgress.approved} מתוך {checklistProgress.total} מסמכים הושלמו
          </span>
          <span className="text-slate-400">({progressPct}%)</span>
        </div>
        <Progress value={progressPct} className="flex-1 max-w-xs" size="sm" />
      </div>
    </div>
  );
}
