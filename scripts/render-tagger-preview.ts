// Static preview harness for the case-tagging service — no app UI exists yet.
// Builds Hebrew fixtures, runs the REAL filterCasesByTags (OR + priority sort),
// and writes an RTL HTML page with colored tag chips. In-memory audit writer only.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { addTag, filterCasesByTags, TAG_COLOR_PALETTE, type AuditWriter } from "../src/lib/case-tagger";
import type { CaseTag, TaggedCase } from "../src/types/case-tags";
import type { Priority } from "../src/types/index";

const events: Parameters<AuditWriter>[0][] = [];
const audit: AuditWriter = (e) => events.push(e);

const CATEGORY_LABELS: Record<CaseTag["category"], string> = {
  DOMAIN: "תחום",
  URGENCY: "דחיפות",
  WORKFLOW: "תהליך",
  CLIENT: "לקוח",
  CUSTOM: "מותאם",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  URGENT: "דחוף מאוד",
  HIGH: "גבוה",
  MEDIUM: "בינוני",
  LOW: "נמוך",
};

function tag(id: string, label: string, category: CaseTag["category"], color: string): CaseTag {
  return { id, label, category, color: color as CaseTag["color"], createdAt: "2026-01-01T00:00:00.000Z" };
}

function baseCase(id: string, num: number, name: string, priority: Priority, updatedAt: string): TaggedCase {
  return {
    id,
    caseNumber: `SC-2026-${String(num).padStart(5, "0")}`,
    clientId: `client-${id}`,
    clientName: name,
    caseType: "CONVERSION",
    status: "GATHERING_DOCUMENTS",
    priority,
    assignedAgentName: "רות כהן",
    hasMissingDocuments: true,
    isOverdue: priority === "URGENT",
    nextFollowUpDate: null,
    submissionDeadline: null,
    missingDocsCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    tags: [],
  };
}

const tUrgent = tag("t-urgent", "דחוף", "URGENCY", TAG_COLOR_PALETTE[2]);
const tConversion = tag("t-conv", "גיור", "DOMAIN", TAG_COLOR_PALETTE[4]);
const tDocs = tag("t-docs", "חסרים מסמכים", "WORKFLOW", TAG_COLOR_PALETTE[3]);
const tVip = tag("t-vip", "לקוח מועדף", "CLIENT", TAG_COLOR_PALETTE[0]);
const tReview = tag("t-review", "בבדיקת AI", "WORKFLOW", TAG_COLOR_PALETTE[5]);

// Build 5 cases via the real addTag (exercises audit + immutability).
const rawCases: TaggedCase[] = [
  addTag(addTag(baseCase("c1", 1, "ישראל ישראלי", "URGENT", "2026-06-01T10:00:00.000Z"), tUrgent, { audit }), tConversion, { audit }),
  addTag(baseCase("c2", 2, "שרה לוי", "URGENT", "2026-03-15T10:00:00.000Z"), tConversion, { audit }),
  addTag(addTag(baseCase("c3", 3, "משה כהן", "HIGH", "2026-05-20T10:00:00.000Z"), tDocs, { audit }), tVip, { audit }),
  addTag(baseCase("c4", 4, "רבקה פרץ", "MEDIUM", "2026-04-10T10:00:00.000Z"), tReview, { audit }),
  addTag(baseCase("c5", 5, "דוד ביטון", "LOW", "2026-02-01T10:00:00.000Z"), tConversion, { audit }),
];

const filterTagIds = ["t-conv", "t-vip"];
const filtered = filterCasesByTags(rawCases, { tagIds: filterTagIds, mode: "OR", sortByPriority: true });

const activeTagLabels = [tConversion, tVip].map((t) => t.label).join(" · ");

function chip(t: CaseTag): string {
  return `<span class="chip" style="background:${t.color}">${t.label}<span class="chip-cat">${CATEGORY_LABELS[t.category]}</span></span>`;
}

function card(c: TaggedCase): string {
  return `
    <article class="card">
      <header class="card-head">
        <div>
          <h2>${c.clientName}</h2>
          <span class="case-num">${c.caseNumber}</span>
        </div>
        <span class="priority priority-${c.priority}">${PRIORITY_LABELS[c.priority]}</span>
      </header>
      <div class="chips">${c.tags.map(chip).join("")}</div>
    </article>`;
}

const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>תצוגה מקדימה — תיוג תיקים</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Rubik", "Assistant", "Segoe UI", system-ui, sans-serif;
    background: #f1f5f9;
    color: #0f172a;
    padding: 32px 16px;
    direction: rtl;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: #64748b; margin: 0 0 20px; font-size: 14px; }
  .filter-bar {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 16px 20px;
    margin-bottom: 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .filter-bar .label { font-weight: 600; }
  .filter-bar .meta { color: #475569; font-size: 14px; }
  .count-pill {
    background: #4f46e5; color: #fff; border-radius: 999px;
    padding: 4px 12px; font-size: 13px; font-weight: 600;
  }
  .card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 16px 20px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.05);
  }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .card-head h2 { font-size: 18px; margin: 0; }
  .case-num { color: #94a3b8; font-size: 13px; }
  .priority { border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .priority-URGENT { background: #fee2e2; color: #b91c1c; }
  .priority-HIGH { background: #ffedd5; color: #c2410c; }
  .priority-MEDIUM { background: #fef9c3; color: #a16207; }
  .priority-LOW { background: #e2e8f0; color: #475569; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .chip {
    color: #fff; border-radius: 999px; padding: 4px 12px;
    font-size: 13px; font-weight: 500;
    display: inline-flex; align-items: center; gap: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,.15);
  }
  .chip-cat {
    background: rgba(255,255,255,.28); border-radius: 999px;
    padding: 1px 7px; font-size: 11px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <h1>תיוג תיקים — תצוגה מקדימה</h1>
    <p class="sub">מופק ישירות מ־<code>filterCasesByTags</code> (מצב OR, מיון לפי דחיפות)</p>
    <div class="filter-bar">
      <div>
        <span class="label">סינון פעיל:</span>
        <span class="meta">${activeTagLabels}</span>
      </div>
      <span class="count-pill">${filtered.length} תיקים תואמים</span>
    </div>
    ${filtered.map(card).join("")}
  </div>
</body>
</html>`;

const outPath = resolve(process.cwd(), "_bmad-output/case-tagger-preview.html");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);

console.log(`Wrote ${outPath}`);
console.log(`Cases after filter: ${filtered.map((c) => c.id).join(", ")}`);
console.log(`Audit events captured (in-memory, no file): ${events.length}`);
