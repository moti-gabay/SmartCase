"use client";

import { useState } from "react";
import { useClientFilters } from "@/hooks/use-client-filters";
import { FilterToolbar } from "@/components/clients/filter-toolbar";
import { ClientTable } from "@/components/clients/client-table";
import { ClientCardGrid } from "@/components/clients/client-card-grid";
import { Pagination } from "@/components/ui/pagination";
import { Header } from "@/components/layout/header";
import { MOCK_CLIENTS, MOCK_CITIES } from "@/lib/mock-clients";
import { Users, FolderOpen, AlertTriangle, UserPlus } from "lucide-react";

// ─── Top stats bar ────────────────────────────────────────────────────────────

function StatsBar({ clients }: { clients: typeof MOCK_CLIENTS }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const stats = [
    {
      label:    "סך הלקוחות",
      value:    clients.length,
      icon:     Users,
      iconBg:   "bg-indigo-50",
      iconColor:"text-indigo-600",
    },
    {
      label:    "עם תיקים פעילים",
      value:    clients.filter((c) => c.activeCasesCount > 0).length,
      icon:     FolderOpen,
      iconBg:   "bg-blue-50",
      iconColor:"text-blue-600",
    },
    {
      label:    "מסמכים חסרים",
      value:    clients.filter((c) => c.hasMissingDocuments).length,
      icon:     AlertTriangle,
      iconBg:   "bg-amber-50",
      iconColor:"text-amber-600",
      highlight:true,
    },
    {
      label:    "נוספו החודש",
      value:    clients.filter((c) => c.createdAt >= monthStart).length,
      icon:     UserPlus,
      iconBg:   "bg-emerald-50",
      iconColor:"text-emerald-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, iconBg, iconColor, highlight }) => (
        <div
          key={label}
          className={`flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm ${
            highlight && value > 0 ? "border-amber-200" : "border-slate-200"
          }`}
        >
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 leading-tight">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [view, setView] = useState<"table" | "grid">("table");

  const {
    rawSearch, setRawSearch,
    filters, setFilter, clearFilters, hasActiveFilters, activeFilterCount,
    sort, toggleSort,
    filtered, paginated,
    page, setPage, totalPages, perPage, setPerPage, PER_PAGE_OPTIONS,
  } = useClientFilters(MOCK_CLIENTS);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="לקוחות"
        subtitle={`${MOCK_CLIENTS.length} לקוחות רשומים במערכת`}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-6">
          {/* Stats */}
          <StatsBar clients={MOCK_CLIENTS} />

          {/* Filter toolbar */}
          <FilterToolbar
            search={rawSearch}
            onSearchChange={setRawSearch}
            filters={filters}
            onFilterChange={setFilter}
            onClearAll={clearFilters}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
            availableCities={MOCK_CITIES}
            view={view}
            onViewChange={setView}
            totalResults={filtered.length}
            onNewClient={() => {/* TODO: open new client modal/page */}}
          />

          {/* Results card */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Table or Grid */}
            <div className={view === "grid" ? "p-5" : ""}>
              {view === "table" ? (
                <ClientTable
                  clients={paginated}
                  sort={sort}
                  onSort={toggleSort}
                  emptyMessage={hasActiveFilters ? "לא נמצאו לקוחות התואמים את הסינון" : "לא נמצאו לקוחות"}
                />
              ) : (
                <ClientCardGrid clients={paginated} />
              )}
            </div>

            {/* Pagination */}
            {filtered.length > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={filtered.length}
                perPage={perPage}
                perPageOptions={PER_PAGE_OPTIONS}
                onPageChange={setPage}
                onPerPageChange={(n) => setPerPage(n as typeof perPage)}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
