// Case tagging & dynamic filtering — shared types.
// Tags persist as a `tags Json` column on the Prisma `Case` model (see
// prisma/schema.prisma); cases are tagged as `TaggedCase` view models built
// on top of CaseSummary.

import type { CaseSummary, Priority } from "./index";

export const TAG_CATEGORIES = ["DOMAIN", "URGENCY", "WORKFLOW", "CLIENT", "CUSTOM"] as const;

export type TagCategory = (typeof TAG_CATEGORIES)[number];

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

/**
 * Stable, server-derived tag identity — same category+label always yields the
 * same id, so the same tag added on two different cases aggregates into one
 * filter chip and AND-mode filtering works across cases. Never generate a
 * random id client-side.
 */
export function deriveTagId(category: TagCategory, label: string): string {
  // Lowercased to match the engine's case-insensitive duplicate check —
  // otherwise "Urgent" and "urgent" would get distinct ids and never
  // aggregate into one filter chip.
  return `${category}:${label.trim().toLowerCase()}`;
}

export interface CaseTag {
  id: string;
  /** Hebrew display label (UI copy is Hebrew-first). */
  label: string;
  category: TagCategory;
  color: TagColor;
  createdAt: string; // ISO timestamp
}

// Defensive parse of the `Case.tags` Json column → CaseTag[]. Malformed JSON,
// a non-array shape, entries with an invalid category/color, or duplicate ids
// are dropped rather than crashing the page (spec I/O matrix: "Malformed Json
// in DB"). Pure — safe to import from tests and client code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCaseTags(raw: any): CaseTag[] {
  if (!Array.isArray(raw)) return [];
  const tags: CaseTag[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.label === "string" &&
      typeof entry.category === "string" &&
      (TAG_CATEGORIES as readonly string[]).includes(entry.category) &&
      typeof entry.color === "string" &&
      (TAG_COLOR_PALETTE as readonly string[]).includes(entry.color) &&
      typeof entry.createdAt === "string" &&
      !tags.some((t) => t.id === entry.id)
    ) {
      tags.push({
        id: entry.id,
        label: entry.label,
        category: entry.category,
        color: entry.color,
        createdAt: entry.createdAt,
      });
    }
  }
  return tags;
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
