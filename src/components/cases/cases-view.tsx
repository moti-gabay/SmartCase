"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { CaseCard } from "@/components/dashboard/case-card";
import { CASE_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CaseSummary, CaseStatus } from "@/types";
import type { CaseTag } from "@/types/case-tags";
import { filterCasesByTags } from "@/lib/case-tagger";
import { Search, FolderOpen } from "lucide-react";

const FILTERS: { key: CaseStatus | "ALL" | "MISSING" | "OVERDUE"; label: string }[] = [
  { key: "ALL", label: "הכל" },
  { key: "MISSING", label: "מסמכים חסרים" },
  { key: "OVERDUE", label: "באיחור" },
  { key: "NEW_INTAKE", label: CASE_STATUS_LABELS.NEW_INTAKE },
  { key: "GATHERING_DOCUMENTS", label: CASE_STATUS_LABELS.GATHERING_DOCUMENTS },
  { key: "PENDING_AI_REVIEW", label: CASE_STATUS_LABELS.PENDING_AI_REVIEW },
  { key: "READY_FOR_SUBMISSION", label: CASE_STATUS_LABELS.READY_FOR_SUBMISSION },
  { key: "SUBMITTED", label: CASE_STATUS_LABELS.SUBMITTED },
  { key: "AWAITING_DECISION", label: CASE_STATUS_LABELS.AWAITING_DECISION },
  { key: "APPROVED", label: CASE_STATUS_LABELS.APPROVED },
  { key: "REJECTED", label: CASE_STATUS_LABELS.REJECTED },
  { key: "APPEAL_IN_PROGRESS", label: CASE_STATUS_LABELS.APPEAL_IN_PROGRESS },
  { key: "CLOSED", label: CASE_STATUS_LABELS.CLOSED },
];

export function CasesView({ cases }: { cases: CaseSummary[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL");
  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"AND" | "OR">("OR");

  // Dedupe by stable tag id (same label+category across cases share one id).
  const availableTags = useMemo(() => {
    const byId = new Map<string, CaseTag>();
    for (const c of cases) {
      for (const tag of c.tags) {
        if (!byId.has(tag.id)) byId.set(tag.id, tag);
      }
    }
    return [...byId.values()];
  }, [cases]);

  // Derived, not stored: prunes selected tag ids that no longer exist among
  // loaded cases (e.g. the last case carrying that tag was untagged/deleted)
  // without a setState-in-effect render cascade.
  const activeTagIds = useMemo(() => {
    const availableIds = new Set(availableTags.map((t) => t.id));
    return selectedTagIds.filter((id) => availableIds.has(id));
  }, [selectedTagIds, availableTags]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const statusFiltered = cases.filter((c) => {
      if (filter === "MISSING" && !c.hasMissingDocuments) return false;
      else if (filter === "OVERDUE" && !c.isOverdue) return false;
      else if (filter !== "ALL" && filter !== "MISSING" && filter !== "OVERDUE" && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.clientName.toLowerCase().includes(q) ||
        c.caseNumber.toLowerCase().includes(q) ||
        (c.assignedAgentName ?? "").toLowerCase().includes(q)
      );
    });
    return filterCasesByTags(statusFiltered, { tagIds: activeTagIds, mode: tagMode });
  }, [cases, filter, search, activeTagIds, tagMode]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="כל התיקים" subtitle="ניהול ועקיבה אחר תיקים פעילים" />

      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-6">
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם לקוח, מספר תיק או סוכן..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-white ps-9 pe-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                  filter === key
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tag chip filter */}
          {availableTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {availableTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                    activeTagIds.includes(tag.id)
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                  )}
                >
                  {tag.label}
                </button>
              ))}
              {activeTagIds.length >= 2 && (
                <button
                  onClick={() => setTagMode((m) => (m === "AND" ? "OR" : "AND"))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                >
                  מצב: {tagMode === "AND" ? "הכל (AND)" : "לפחות אחד (OR)"}
                </button>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400">{filtered.length} תיקים</p>

          {/* Grid */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((c) => (
                <CaseCard key={c.id} caseItem={c} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 py-16 text-slate-400">
              <FolderOpen className="h-8 w-8 text-slate-300" />
              <p className="text-sm">לא נמצאו תיקים התואמים את הסינון</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
