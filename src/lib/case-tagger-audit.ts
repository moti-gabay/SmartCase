// Server-only JSONL audit sink for tag mutations. Kept apart from the pure
// service (src/lib/case-tagger.ts) so that module stays importable from
// client components — this one pulls in node:fs and must never be.

import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuditWriter } from "./case-tagger";

export function createJsonlAuditWriter(filePath?: string): AuditWriter {
  const resolvedPath = resolve(process.cwd(), filePath ?? "logs/case-events.jsonl");
  return (event) => {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    appendFileSync(resolvedPath, `${JSON.stringify(event)}\n`);
  };
}
