import { Header } from "@/components/layout/header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { getDashboardStats, getCases, getAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats, cases, alerts] = await Promise.all([
    getDashboardStats(),
    getCases(),
    getAlerts(),
  ]);

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
          <StatsCards stats={stats} />

          {/* Pipeline board */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                צינור תיקים
              </h2>
              <p className="text-xs text-slate-400">
                {cases.length} תיקים פעילים
              </p>
            </div>
            <PipelineBoard cases={cases} />
          </section>
        </main>

        {/* Alerts sidebar panel – pinned on the left (end side in RTL) */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-e border-slate-200 bg-white p-5 xl:block">
          <AlertsPanel alerts={alerts} />
        </aside>
      </div>
    </div>
  );
}
