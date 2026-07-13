"use client";

import { useState, useMemo, useTransition } from "react";
import { CaseHeader } from "@/components/cases/case-header";
import { CaseInfoPanel } from "@/components/cases/case-info-panel";
import { DocumentChecklist } from "@/components/cases/document-checklist";
import { ActivityTimeline } from "@/components/cases/activity-timeline";
import { AiSummaryModal } from "@/components/cases/ai-summary-modal";
import { TasksPanel } from "@/components/cases/tasks-panel";
import { changeCaseStatus } from "@/lib/actions";
import { LetterGenerator } from "@/components/ai/letter-generator";
import { cn } from "@/lib/utils";
import type { CaseDetail, CaseStatus } from "@/types";
import { FileText, Clock, CheckSquare, Sparkles, AlertTriangle } from "lucide-react";

type TabId = "documents" | "activity" | "tasks" | "ai";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "documents", label: "מסמכים", icon: FileText },
  { id: "activity", label: "פעילות", icon: Clock },
  { id: "tasks", label: "משימות", icon: CheckSquare },
  { id: "ai", label: "כלי AI", icon: Sparkles },
];

export function CaseDetailView({ caseDetail }: { caseDetail: CaseDetail }) {
  const [caseData, setCaseData] = useState(caseDetail);
  const [activeTab, setActiveTab] = useState<TabId>("documents");
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [, startTransition] = useTransition();

  const checklistProgress = useMemo(() => ({
    approved: caseData.checklist.filter((i) => i.status === "APPROVED").length,
    total: caseData.checklist.length,
  }), [caseData.checklist]);

  const missingMandatory = caseData.checklist.filter(
    (i) => i.isMandatory && (i.status === "MISSING" || i.status === "REJECTED")
  ).length;

  const pendingTasks = caseData.tasks.filter(
    (t) => t.status !== "COMPLETED" && t.status !== "CANCELLED"
  ).length;

  const handleStatusChange = (newStatus: CaseStatus) => {
    setCaseData((prev) => ({ ...prev, status: newStatus }));
    startTransition(async () => {
      try {
        await changeCaseStatus(caseData.id, newStatus);
      } catch {
        // Revert on failure
        setCaseData((prev) => ({ ...prev, status: caseDetail.status }));
      }
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CaseHeader
        caseDetail={caseData}
        checklistProgress={checklistProgress}
        onStatusChange={handleStatusChange}
      />

      <div className="flex flex-1 overflow-hidden">
        <aside className="print-summary hidden w-72 shrink-0 overflow-y-auto border-s border-slate-200 bg-white xl:block">
          <CaseInfoPanel caseDetail={caseData} />
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex gap-0.5 border-b border-slate-200 bg-white px-5 pt-3">
            {TABS.map(({ id, label, icon: Icon }) => {
              const badge =
                id === "documents" && missingMandatory > 0 ? missingMandatory :
                id === "tasks" && pendingTasks > 0 ? pendingTasks :
                undefined;

              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "relative flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-all",
                    activeTab === id
                      ? "border-b-2 border-indigo-600 bg-white text-indigo-700"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {badge !== undefined && (
                    <span className={cn(
                      "flex h-4.5 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                      id === "documents" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                    )}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === "documents" && (
              <>
                {missingMandatory > 0 && (
                  <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-amber-700 font-medium">
                      {missingMandatory} מסמכ{missingMandatory === 1 ? "" : "י"} חובה חסר{missingMandatory === 1 ? "" : "ים"} – התיק אינו מוכן להגשה
                    </span>
                  </div>
                )}
                <DocumentChecklist items={caseData.checklist} caseId={caseData.id} documents={caseData.documents} />
              </>
            )}

            {activeTab === "activity" && (
              <div className="flex flex-col gap-3">
                <div className="flex justify-end">
                  <button
                    onClick={() => setAiSummaryOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    סיכום שיחה חכם
                  </button>
                </div>
                <ActivityTimeline
                  notes={caseData.notes}
                  statusHistory={caseData.statusHistory}
                  activities={caseData.activities}
                />
              </div>
            )}

            {activeTab === "tasks" && <TasksPanel tasks={caseData.tasks} />}

            {activeTab === "ai" && (
              <AiToolsPanel caseId={caseData.id} clientName={caseData.client.fullName} />
            )}
          </div>
        </div>
      </div>

      <AiSummaryModal
        caseId={caseData.id}
        open={aiSummaryOpen}
        onClose={() => setAiSummaryOpen(false)}
      />
    </div>
  );
}

// ─── AI tools tab ─────────────────────────────────────────────────────────────

function AiToolsPanel({ caseId, clientName }: { caseId: string; clientName: string }) {
  return (
    <div className="flex flex-col gap-6">
      <LetterGenerator caseId={caseId} clientName={clientName} />

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">מנתח מסמכים</h3>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">
              בדוק מסמך מועלה מול הדרישות – Claude יאמת תאריכים, חתימות ותקינות המסמך.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              עבור לטאב <span className="font-semibold text-slate-600">מסמכים</span> ולחץ על כפתור AI ליד כל מסמך שהועלה.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
