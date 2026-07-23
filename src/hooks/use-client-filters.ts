"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import type { ClientListItem, ClientFilters, ClientSort, SortField, EmploymentStatus } from "@/types";

const DEFAULT_FILTERS: ClientFilters = {
  employmentStatus: [],
  cities:           [],
  hasActiveCases:   "all",
  hasMissingDocs:   false,
};

const DEFAULT_SORT: ClientSort = { field: "lastActivityDate", dir: "desc" };

const PER_PAGE_OPTIONS = [10, 20, 50] as const;

export function useClientFilters(clients: ClientListItem[]) {
  const [rawSearch, setRawSearch]   = useState("");
  const [search, setSearch]         = useState("");
  const [filters, setFilters]       = useState<ClientFilters>(DEFAULT_FILTERS);
  const [sort, setSort]             = useState<ClientSort>(DEFAULT_SORT);
  const [page, setPage]             = useState(1);
  const [perPage, setPerPage]       = useState<(typeof PER_PAGE_OPTIONS)[number]>(10);

  // Debounce search input by 220ms. Page resets to 1 at every state-transition
  // source (search commit, sort toggle, filter change) rather than via an effect.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 220);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // ── Filter + sort ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...clients];

    // Text search: name, TZ, phone, email, city, condition
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          c.nationalId.includes(q) ||
          c.phone.includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.addressCity?.includes(q) ||
          c.primaryCondition?.toLowerCase().includes(q)
      );
    }

    // Employment status multi-select
    if (filters.employmentStatus.length > 0) {
      result = result.filter((c) =>
        filters.employmentStatus.includes(c.employmentStatus as EmploymentStatus)
      );
    }

    // City multi-select
    if (filters.cities.length > 0) {
      result = result.filter((c) => c.addressCity && filters.cities.includes(c.addressCity));
    }

    // Has active cases
    if (filters.hasActiveCases === "yes") result = result.filter((c) => c.activeCasesCount > 0);
    if (filters.hasActiveCases === "no")  result = result.filter((c) => c.activeCasesCount === 0);

    // Missing documents flag
    if (filters.hasMissingDocs) result = result.filter((c) => c.hasMissingDocuments);

    // Sort
    result.sort((a, b) => {
      const mul = sort.dir === "asc" ? 1 : -1;
      switch (sort.field) {
        case "fullName":
          return mul * a.fullName.localeCompare(b.fullName, "he");
        case "createdAt":
          return mul * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case "lastActivityDate":
          return mul * (
            new Date(a.lastActivityDate ?? 0).getTime() -
            new Date(b.lastActivityDate ?? 0).getTime()
          );
        case "activeCasesCount":
          return mul * (a.activeCasesCount - b.activeCasesCount);
        case "addressCity":
          return mul * (a.addressCity ?? "").localeCompare(b.addressCity ?? "", "he");
        default:
          return 0;
      }
    });

    return result;
  }, [clients, search, filters, sort]);

  // ── Pagination ───────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage   = Math.min(page, totalPages);
  const paginated  = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, safePage, perPage]);

  // ── Sort toggle ──────────────────────────────────────────────────────────────
  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
    setPage(1);
  }, []);

  // ── Filter helpers ────────────────────────────────────────────────────────────
  const setFilter = useCallback(<K extends keyof ClientFilters>(
    key: K,
    value: ClientFilters[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setRawSearch("");
    setPage(1);
  }, []);

  const hasActiveFilters =
    rawSearch !== "" ||
    filters.employmentStatus.length > 0 ||
    filters.cities.length > 0 ||
    filters.hasActiveCases !== "all" ||
    filters.hasMissingDocs;

  // Active filter count (for the badge on the Filter button)
  const activeFilterCount =
    (filters.employmentStatus.length > 0 ? 1 : 0) +
    (filters.cities.length > 0 ? 1 : 0) +
    (filters.hasActiveCases !== "all" ? 1 : 0) +
    (filters.hasMissingDocs ? 1 : 0);

  return {
    rawSearch, setRawSearch,
    filters, setFilter, clearFilters, hasActiveFilters, activeFilterCount,
    sort, toggleSort,
    filtered, paginated,
    page: safePage, setPage, totalPages, perPage, setPerPage, PER_PAGE_OPTIONS,
  };
}
