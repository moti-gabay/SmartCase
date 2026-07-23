// Case tagging & dynamic filtering — shared types.
// Tags are an in-memory/service-layer concept for now (no Prisma model yet);
// cases are tagged as `TaggedCase` view models built on top of CaseSummary.

import type { CaseSummary, Priority } from "./index";

export type TagCategory = "DOMAIN" | "URGENCY" | "WORKFLOW" | "CLIENT" | "CUSTOM";

/** Allowed tag colors — must stay a hex value from TAG_COLOR_PALETTE. */
export type TagColor = `#${string}`;

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
  reason?: string;
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
