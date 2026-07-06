"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteCase, generatePortalLink } from "@/lib/actions";
import { printSection } from "@/lib/print";
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
  MoreHorizontal,
  Pencil,
  Trash2,
  Link2,
  Copy,
  Check,
  X,
  Loader2,
} from "lucide-react";

interface CaseHeaderProps {
  caseDetail: CaseDetail;
  checklistProgress: { approved: number; total: number };
  onStatusChange?: (newStatus: CaseStatus) => void;
}

export function CaseHeader({ caseDetail, checklistProgress, onStatusChange }: CaseHeaderProps) {
  const router = useRouter();
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const progressPct = checklistProgress.total > 0
    ? Math.round((checklistProgress.approved / checklistProgress.total) * 100)
    : 0;

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteCase(caseDetail.id);
        router.push("/cases");
      } catch {
        setConfirmOpen(false);
      }
    });
  };

  const handleGenerateLink = async () => {
    setActionsOpen(false);
    setLinkModalOpen(true);
    setLinkGenerating(true);
    setLinkError(null);
    setLinkCopied(false);
    try {
      const { token } = await generatePortalLink(caseDetail.id);
      // Built from the browser's own origin (not an env-configured base URL) so
      // the link is always correct regardless of custom domains / preview URLs.
      setLinkUrl(`${window.location.origin}/share/conversion/${token}`);
    } catch {
      setLinkError("יצירת הקישור נכשלה");
    } finally {
      setLinkGenerating(false);
    }
  };

  const copyLink = () => {
    if (!linkUrl) return;
    navigator.clipboard.writeText(linkUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

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

          <Button variant="outline" size="sm" onClick={() => printSection("summary")}>
            <Printer className="h-4 w-4" />
            הדפסה
          </Button>
          <Button size="sm" className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            יצירת מכתב
          </Button>

          {/* Edit / delete menu */}
          <div className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 transition-colors"
              aria-label="פעולות נוספות"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {actionsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
                <div className="absolute end-0 top-full z-20 mt-1.5 w-40 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <Link
                    href={`/cases/${caseDetail.id}/edit`}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    onClick={() => setActionsOpen(false)}
                  >
                    <Pencil className="h-4 w-4 text-slate-400" />
                    עריכת תיק
                  </Link>
                  {caseDetail.caseType === "CONVERSION" && (
                    <button
                      onClick={handleGenerateLink}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Link2 className="h-4 w-4 text-slate-400" />
                      צור קישור ללקוח
                    </button>
                  )}
                  <button
                    onClick={() => { setActionsOpen(false); setConfirmOpen(true); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    מחיקת תיק
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        danger
        title="מחיקת תיק"
        confirmLabel="מחק תיק"
        pending={pending}
        message={
          <>
            האם למחוק את תיק <span className="font-semibold">{caseDetail.caseNumber}</span> לצמיתות?
            <span className="mt-2 block text-red-600">כל המסמכים, המשימות וההערות של התיק יימחקו.</span>
          </>
        }
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* Client portal link modal */}
      {linkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setLinkModalOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">קישור ללקוח</h2>
              <button onClick={() => setLinkModalOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="סגור">
                <X className="h-5 w-5" />
              </button>
            </div>

            {linkGenerating && (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> יוצר קישור...
              </div>
            )}

            {linkError && <p className="text-sm text-red-600">{linkError}</p>}

            {linkUrl && !linkGenerating && (
              <>
                <p className="mb-2 text-xs text-slate-500">
                  שלח קישור זה ללקוח כדי שיוכל למלא פרטים ולהעלות מסמכים. הקישור בתוקף ל-30 יום.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <span dir="ltr" className="flex-1 truncate font-mono text-xs text-slate-700">{linkUrl}</span>
                  <button
                    onClick={copyLink}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-600 shadow-sm hover:bg-indigo-50"
                  >
                    {linkCopied ? <><Check className="h-3.5 w-3.5" /> הועתק</> : <><Copy className="h-3.5 w-3.5" /> העתק</>}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  יצירת קישור חדש תבטל את הקישור הקודם.
                </p>
              </>
            )}
          </div>
        </div>
      )}

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
