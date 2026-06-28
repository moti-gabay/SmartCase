import { cn } from "@/lib/utils";
import { FolderOpen, AlertTriangle, Clock, CheckCircle, TrendingUp, FilePlus } from "lucide-react";
import type { DashboardStats } from "@/types";

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  trend?: { value: number; label: string; positive: boolean };
  highlight?: boolean;
}

function StatCard({ label, value, icon: Icon, iconColor, iconBg, trend, highlight }: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md",
        highlight ? "border-red-200" : "border-slate-200"
      )}
    >
      {highlight && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-red-400 to-red-500" />
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{value.toLocaleString("he-IL")}</p>
          {trend && (
            <p className={cn("mt-1 text-xs font-medium", trend.positive ? "text-emerald-600" : "text-red-600")}>
              <TrendingUp className={cn("me-1 inline h-3 w-3", !trend.positive && "rotate-180")} />
              {trend.value}+ {trend.label}
            </p>
          )}
        </div>
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", iconBg)}>
          <Icon className={cn("h-5 w-5", iconColor)} />
        </div>
      </div>
    </div>
  );
}

interface StatsCardsProps {
  stats: DashboardStats;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards: StatCardProps[] = [
    {
      label: "תיקים פעילים",
      value: stats.totalActiveCases,
      icon: FolderOpen,
      iconColor: "text-indigo-600",
      iconBg: "bg-indigo-50",
      trend: { value: stats.newCasesThisWeek, label: "השבוע", positive: true },
    },
    {
      label: "תיקים עם מסמכים חסרים",
      value: stats.missingDocsCases,
      icon: AlertTriangle,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-50",
      highlight: stats.missingDocsCases > 10,
    },
    {
      label: "תיקים באיחור",
      value: stats.overdueCases,
      icon: Clock,
      iconColor: "text-red-600",
      iconBg: "bg-red-50",
      highlight: stats.overdueCases > 0,
    },
    {
      label: "הוגשו החודש",
      value: stats.submittedThisMonth,
      icon: FilePlus,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-50",
    },
    {
      label: "אושרו החודש",
      value: stats.approvedThisMonth,
      icon: CheckCircle,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-50",
    },
    {
      label: "תיקים חדשים השבוע",
      value: stats.newCasesThisWeek,
      icon: FolderOpen,
      iconColor: "text-violet-600",
      iconBg: "bg-violet-50",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </div>
  );
}
