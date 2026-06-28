import { Header } from "@/components/layout/header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { MOCK_STATS, MOCK_CASES, MOCK_ALERTS } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="לוח בקרה"
        subtitle="סקירה כללית של כל התיקים הפעילים"
      />

      {/* Scrollable body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main column */}
        <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
          {/* KPI stats */}
          <StatsCards stats={MOCK_STATS} />

          {/* Pipeline board */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                צינור תיקים
              </h2>
              <p className="text-xs text-slate-400">
                {MOCK_CASES.length} תיקים פעילים
              </p>
            </div>
            <PipelineBoard cases={MOCK_CASES} />
          </section>
        </main>

        {/* Alerts sidebar panel – pinned on the left (end side in RTL) */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-e border-slate-200 bg-white p-5 xl:block">
          <AlertsPanel alerts={MOCK_ALERTS} />
        </aside>
      </div>
    </div>
  );
}
