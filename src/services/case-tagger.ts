// Case tagging service — pure add/remove/filter logic over TaggedCase, plus
// a JSONL audit trail for tag mutations. No Prisma model yet (see src/types/case-tags.ts).

import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  TaggedCase,
  CaseTag,
  TagColor,
  TagFilterCriteria,
  TagAuditEvent,
} from "@/types/case-tags";
import { PRIORITY_ORDER } from "@/types/case-tags";

export const TAG_COLOR_PALETTE: readonly TagColor[] = [
  "#3b82f6",
  "#22c55e",
  "#ef4444",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#64748b",
];

export type AuditWriter = (event: TagAuditEvent) => void;

export function createJsonlAuditWriter(filePath?: string): AuditWriter {
  const resolvedPath = resolve(process.cwd(), filePath ?? "logs/case-events.jsonl");
  return (event: TagAuditEvent) => {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    appendFileSync(resolvedPath, `${JSON.stringify(event)}\n`);
  };
}

let defaultAuditWriter: AuditWriter | undefined;

function getDefaultAuditWriter(): AuditWriter {
  if (!defaultAuditWriter) {
    defaultAuditWriter = createJsonlAuditWriter();
  }
  return defaultAuditWriter;
}

export function addTag(
  caseItem: TaggedCase,
  tag: CaseTag,
  opts?: { audit?: AuditWriter }
): TaggedCase {
  const audit = opts?.audit ?? getDefaultAuditWriter();

  const reject = (reason: string): never => {
    audit({
      timestamp: new Date().toISOString(),
      action: "TAG_REJECTED",
      caseId: caseItem.id,
      tagId: tag.id,
      label: tag.label,
      reason,
    });
    throw new Error(reason);
  };

  if (!TAG_COLOR_PALETTE.includes(tag.color)) {
    reject(`Invalid tag color "${tag.color}" — must be one of TAG_COLOR_PALETTE`);
  }
  if (tag.label.trim().length === 0) {
    reject("Tag label must not be empty or whitespace");
  }
  const isDuplicate = caseItem.tags.some(
    (existing) =>
      existing.id === tag.id ||
      (existing.category === tag.category &&
        existing.label.toLowerCase() === tag.label.toLowerCase())
  );
  if (isDuplicate) {
    reject(`Duplicate tag "${tag.label}" (category ${tag.category}) already on case ${caseItem.id}`);
  }

  audit({
    timestamp: new Date().toISOString(),
    action: "TAG_ADDED",
    caseId: caseItem.id,
    tagId: tag.id,
    label: tag.label,
  });

  return { ...caseItem, tags: [...caseItem.tags, tag] };
}

export function removeTag(
  caseItem: TaggedCase,
  tagId: string,
  opts?: { audit?: AuditWriter }
): TaggedCase {
  const target = caseItem.tags.find((t) => t.id === tagId);
  if (!target) {
    return caseItem;
  }

  const audit = opts?.audit ?? getDefaultAuditWriter();
  audit({
    timestamp: new Date().toISOString(),
    action: "TAG_REMOVED",
    caseId: caseItem.id,
    tagId: target.id,
    label: target.label,
  });

  return { ...caseItem, tags: caseItem.tags.filter((t) => t.id !== tagId) };
}

export function filterCasesByTags(
  cases: TaggedCase[],
  criteria: TagFilterCriteria
): TaggedCase[] {
  if (criteria.tagIds.length === 0) {
    return [...cases];
  }

  const matches = cases.filter((c) => {
    const tagIdSet = new Set(c.tags.map((t) => t.id));
    return criteria.mode === "AND"
      ? criteria.tagIds.every((id) => tagIdSet.has(id))
      : criteria.tagIds.some((id) => tagIdSet.has(id));
  });

  let result = matches;
  if (criteria.maxPerCategory !== undefined) {
    const maxPerCategory = criteria.maxPerCategory;
    const countByCategory = new Map<string, number>();
    result = matches.filter((c) => {
      const firstMatchingTag = c.tags.find((t) => criteria.tagIds.includes(t.id));
      const category = firstMatchingTag?.category ?? "CUSTOM";
      const count = countByCategory.get(category) ?? 0;
      if (count >= maxPerCategory) {
        return false;
      }
      countByCategory.set(category, count + 1);
      return true;
    });
  }

  if (criteria.sortByPriority) {
    result = [...result].sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  return result;
}
