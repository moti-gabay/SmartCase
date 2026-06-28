"use client";

import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/constants";
import type { ClientFilters, EmploymentStatus } from "@/types";
import { Search, SlidersHorizontal, X, LayoutGrid, List } from "lucide-react";

const EMPLOYMENT_OPTIONS: EmploymentStatus[] = [
  "EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "RETIRED", "STUDENT", "UNABLE_TO_WORK",
];

interface FilterToolbarProps {
  search:           string;
  onSearchChange:   (v: string) => void;
  filters:          ClientFilters;
  onFilterChange:   <K extends keyof ClientFilters>(key: K, value: ClientFilters[K]) => void;
  onClearAll:       () => void;
  hasActiveFilters: boolean;
  activeFilterCount:number;
  availableCities:  string[];
  view:             "table" | "grid";
  onViewChange:     (v: "table" | "grid") => void;
  totalResults:     number;
  onNewClient:      () => void;
}

export function FilterToolbar({
  search, onSearchChange,
  filters, onFilterChange, onClearAll, hasActiveFilters, activeFilterCount,
  availableCities,
  view, onViewChange,
  totalResults, onNewClient,
}: FilterToolbarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef  = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Multi-select toggle helpers ───────────────────────────────────────────────
  const toggleEmployment = (val: EmploymentStatus) => {
    const cur = filters.employmentStatus;
    onFilterChange(
      "employmentStatus",
      cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val]
    );
  };

  const toggleCity = (city: string) => {
    const cur = filters.cities;
    onFilterChange("cities", cur.includes(city) ? cur.filter((c) => c !== city) : [...cur, city]);
  };

  // ── Active filter chip list ───────────────────────────────────────────────────
  const chips: { label: string; onRemove: () => void }[] = [
    ...filters.employmentStatus.map((s) => ({
      label: EMPLOYMENT_STATUS_LABELS[s],
      onRemove: () => onFilterChange("employmentStatus", filters.employmentStatus.filter((v) => v !== s)),
    })),
    ...filters.cities.map((c) => ({
      label: c,
      onRemove: () => onFilterChange("cities", filters.cities.filter((v) => v !== c)),
    })),
    ...(filters.hasActiveCases !== "all"
      ? [{ label: filters.hasActiveCases === "yes" ? "עם תיקים" : "ללא תיקים",
           onRemove: () => onFilterChange("hasActiveCases", "all") }]
      : []),
    ...(filters.hasMissingDocs
      ? [{ label: "מסמכים חסרים", onRemove: () => onFilterChange("hasMissingDocs", false) }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* ── Main row ── */}
      <div className="flex items-center gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="חיפוש לפי שם, ת.ז., טלפון, עיר, מצב רפואי..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-white ps-10 pe-4 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
            dir="rtl"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter button */}
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={() => setPanelOpen((v) => !v)}
            className={cn(
              "relative flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-medium shadow-sm transition-all",
              panelOpen || activeFilterCount > 0
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            סינון
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[11px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Filter dropdown panel */}
          {panelOpen && (
            <div
              ref={panelRef}
              className="absolute start-0 top-full z-30 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            >
              {/* Employment status */}
              <FilterSection title="מעמד תעסוקתי">
                <div className="grid grid-cols-2 gap-1.5">
                  {EMPLOYMENT_OPTIONS.map((val) => (
                    <label
                      key={val}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                        filters.employmentStatus.includes(val)
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={filters.employmentStatus.includes(val)}
                        onChange={() => toggleEmployment(val)}
                        className="sr-only"
                      />
                      <span className={cn("h-3.5 w-3.5 rounded border-2 shrink-0 flex items-center justify-center",
                        filters.employmentStatus.includes(val) ? "border-indigo-500 bg-indigo-500" : "border-slate-300"
                      )}>
                        {filters.employmentStatus.includes(val) && (
                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 12 12">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        )}
                      </span>
                      {EMPLOYMENT_STATUS_LABELS[val]}
                    </label>
                  ))}
                </div>
              </FilterSection>

              <div className="my-4 border-t border-slate-100" />

              {/* City */}
              <FilterSection title="עיר מגורים">
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                  {availableCities.map((city) => (
                    <label
                      key={city}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-all",
                        filters.cities.includes(city)
                          ? "bg-indigo-50 text-indigo-700 font-medium"
                          : "text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={filters.cities.includes(city)}
                        onChange={() => toggleCity(city)}
                        className="sr-only"
                      />
                      <span className={cn("h-3.5 w-3.5 rounded border-2 shrink-0 flex items-center justify-center",
                        filters.cities.includes(city) ? "border-indigo-500 bg-indigo-500" : "border-slate-300"
                      )}>
                        {filters.cities.includes(city) && (
                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 12 12">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        )}
                      </span>
                      {city}
                    </label>
                  ))}
                </div>
              </FilterSection>

              <div className="my-4 border-t border-slate-100" />

              {/* Has active cases */}
              <FilterSection title="תיקים פעילים">
                <div className="flex gap-2">
                  {(["all", "yes", "no"] as const).map((val) => (
                    <label
                      key={val}
                      className={cn(
                        "flex flex-1 cursor-pointer items-center justify-center rounded-lg border py-2 text-xs font-medium transition-all",
                        filters.hasActiveCases === val
                          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <input
                        type="radio"
                        name="hasActiveCases"
                        value={val}
                        checked={filters.hasActiveCases === val}
                        onChange={() => onFilterChange("hasActiveCases", val)}
                        className="sr-only"
                      />
                      {val === "all" ? "הכל" : val === "yes" ? "עם תיקים" : "ללא תיקים"}
                    </label>
                  ))}
                </div>
              </FilterSection>

              <div className="my-4 border-t border-slate-100" />

              {/* Missing docs */}
              <label className="flex cursor-pointer items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <span className="text-sm font-medium text-amber-800">עם מסמכים חסרים בלבד</span>
                <input
                  type="checkbox"
                  checked={filters.hasMissingDocs}
                  onChange={(e) => onFilterChange("hasMissingDocs", e.target.checked)}
                  className="sr-only"
                />
                <span className={cn(
                  "relative h-5 w-9 rounded-full transition-colors shrink-0",
                  filters.hasMissingDocs ? "bg-amber-500" : "bg-slate-200"
                )}>
                  <span className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                    filters.hasMissingDocs ? "end-0.5" : "start-0.5"
                  )} />
                </span>
              </label>

              {/* Clear */}
              {hasActiveFilters && (
                <button
                  onClick={() => { onClearAll(); setPanelOpen(false); }}
                  className="mt-4 w-full rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  נקה את כל הסינונים
                </button>
              )}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => onViewChange("table")}
            className={cn(
              "flex h-10 w-10 items-center justify-center transition-colors",
              view === "table" ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:bg-slate-50"
            )}
            aria-label="תצוגת טבלה"
          >
            <List className="h-4 w-4" />
          </button>
          <div className="w-px bg-slate-200" />
          <button
            onClick={() => onViewChange("grid")}
            className={cn(
              "flex h-10 w-10 items-center justify-center transition-colors",
              view === "grid" ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:bg-slate-50"
            )}
            aria-label="תצוגת כרטיסים"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        {/* New client */}
        <button
          onClick={onNewClient}
          className="flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors whitespace-nowrap"
        >
          + לקוח חדש
        </button>
      </div>

      {/* ── Active filter chips ── */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">סינונים פעילים:</span>
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
            >
              {chip.label}
              <button
                onClick={chip.onRemove}
                className="rounded-full text-indigo-400 hover:text-indigo-600 transition-colors"
                aria-label={`הסר סינון: ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            onClick={onClearAll}
            className="text-xs text-slate-400 hover:text-slate-600 underline transition-colors"
          >
            נקה הכל
          </button>
          <span className="ms-auto text-xs text-slate-400">{totalResults} תוצאות</span>
        </div>
      )}
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</h4>
      {children}
    </div>
  );
}
