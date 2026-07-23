// Case tagging & dynamic filtering — shared types.
// Tags are an in-memory/service-layer concept for now (no Prisma model yet);
// cases are tagged as `TaggedCase` view models built on top of CaseSummary.

import type { CaseSummary, Priority } from "./index";

export type TagCategory = "DOMAIN" | "URGENCY" | "WORKFLOW" | "CLIENT" | "CUSTOM";

/** Allowed tag colors — the palette IS the type: invalid colors fail to compile. */
export const TAG_COLOR_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#ef4444",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#64748b",
] as const;

export type TagColor = (typeof TAG_COLOR_PALETTE)[number];

export interface CaseTag {
  id: string;
  /** Hebrew display label (UI copy is Hebrew-first). */
  label: string;
  category: TagCategory;
  color: TagColor;
  createdAt: string; // ISO timestamp
}

export interface TaggedCase extends CaseSummary {
  tags: CaseTag[];
}

export type TagMatchMode = "AND" | "OR";

export interface TagFilterCriteria {
  /** Tag ids to match against a case's tags. */
  tagIds: string[];
  /** AND = case must carry every tag; OR = at least one. */
  mode: TagMatchMode;
  /** Optional cap of matched cases returned per tag category. */
  maxPerCategory?: number;
  /** When true, results are sorted URGENT → LOW, then by updatedAt desc. */
  sortByPriority?: boolean;
}

/** JSONL audit-trail record appended to logs/case-events.jsonl. */
export interface TagAuditEvent {
  timestamp: string; // ISO
  action: "TAG_ADDED" | "TAG_REMOVED" | "TAG_REJECTED";
  caseId: string;
  tagId: string;
  label: string;
  /** Who performed the mutation (user id or name); "system" when automated. */
  actor: string;
  reason?: string;
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
