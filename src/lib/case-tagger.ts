// Case tagging service — pure add/remove/filter logic over TaggedCase.
// Client-safe: no node builtins here. The JSONL audit sink lives in
// src/lib/case-tagger-audit.ts (server-only); inject it via opts.audit.

import type {
  TaggedCase,
  CaseTag,
  TagFilterCriteria,
  TagAuditEvent,
} from "@/types/case-tags";
import { PRIORITY_ORDER, TAG_COLOR_PALETTE } from "@/types/case-tags";

export { TAG_COLOR_PALETTE };

export type AuditWriter = (event: TagAuditEvent) => void;

export interface TagMutationOpts {
  /** Audit sink; omit for no auditing (e.g. pure client-side previews). */
  audit?: AuditWriter;
  /** Who performed the mutation; defaults to "system". */
  actor?: string;
}

export function addTag(
  caseItem: TaggedCase,
  tag: CaseTag,
  opts?: TagMutationOpts
): TaggedCase {
  const actor = opts?.actor ?? "system";

  const reject = (reason: string): never => {
    opts?.audit?.({
      timestamp: new Date().toISOString(),
      action: "TAG_REJECTED",
      caseId: caseItem.id,
      tagId: tag.id,
      label: tag.label,
      actor,
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

  opts?.audit?.({
    timestamp: new Date().toISOString(),
    action: "TAG_ADDED",
    caseId: caseItem.id,
    tagId: tag.id,
    label: tag.label,
    actor,
  });

  return { ...caseItem, tags: [...caseItem.tags, tag] };
}

export function removeTag(
  caseItem: TaggedCase,
  tagId: string,
  opts?: TagMutationOpts
): TaggedCase {
  const target = caseItem.tags.find((t) => t.id === tagId);
  if (!target) {
    return caseItem;
  }

  opts?.audit?.({
    timestamp: new Date().toISOString(),
    action: "TAG_REMOVED",
    caseId: caseItem.id,
    tagId: target.id,
    label: target.label,
    actor: opts?.actor ?? "system",
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

  let result = cases.filter((c) => {
    const tagIdSet = new Set(c.tags.map((t) => t.id));
    return criteria.mode === "AND"
      ? criteria.tagIds.every((id) => tagIdSet.has(id))
      : criteria.tagIds.some((id) => tagIdSet.has(id));
  });

  // Sort BEFORE applying the per-category cap, so the cap keeps the top-N
  // most urgent cases per category rather than the first-N by input order.
  if (criteria.sortByPriority) {
    result = [...result].sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  if (criteria.maxPerCategory !== undefined) {
    const maxPerCategory = criteria.maxPerCategory;
    const countByCategory = new Map<string, number>();
    result = result.filter((c) => {
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

  return result;
}
