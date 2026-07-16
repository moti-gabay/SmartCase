// Read-only MCP resources. Unlike tools, a resource has no isError channel — a
// failure must throw, which the SDK maps to a JSON-RPC error without killing the
// process.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { REPO_ROOT } from "./bootstrap";
import { prisma } from "@/lib/prisma";
import { isPortalLocale, translateChecklistLabel, type PortalLocale } from "@/lib/i18n/conversion-portal";

// Mirrors FROZEN_AFTER_DAYS in scripts/case-audit.ts and the red threshold on
// the Snapshot card (src/components/cases/case-snapshot-card.tsx).
const FROZEN_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / DAY_MS);

const BASE_URL = "http://localhost:3000";

type StagnantRow = {
  id: string;
  caseNumber: string;
  status: string;
  portalStep: string;
  updatedAt: Date;
  client: { fullName: string; email: string | null; locale: string };
  activities: { createdAt: Date }[];
  checklist: { status: string; template: { documentType: string; displayName: string } }[];
};

export function registerResources(server: McpServer) {
  server.registerResource(
    "db-schema",
    "smartcase://db/schema",
    {
      title: "Prisma schema",
      description:
        "Raw prisma/schema.prisma — the source of truth for models, fields and enums. Read this instead of guessing at database structure.",
      mimeType: "text/plain",
    },
    async (uri) => {
      // Resolved from REPO_ROOT, never process.cwd() — the MCP client's working
      // directory is not ours to assume.
      const text = await readFile(path.join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  server.registerResource(
    "stagnant-cases",
    "smartcase://cases/stagnant",
    {
      title: "Stagnant cases",
      description: `Open cases with no timeline activity for ${FROZEN_AFTER_DAYS}+ days, with their outstanding checklist items and the client's locale.`,
      mimeType: "application/json",
    },
    async (uri) => {
      const rows: StagnantRow[] = await prisma.case.findMany({
        // Only CLOSED is out of scope: APPROVED/REJECTED still sit in
        // PIPELINE_COLUMNS and can need an appeal or a follow-up.
        where: { status: { not: "CLOSED" } },
        select: {
          id: true,
          caseNumber: true,
          status: true,
          portalStep: true,
          updatedAt: true,
          client: { select: { fullName: true, email: true, locale: true } },
          activities: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
          checklist: {
            where: { status: { in: ["MISSING", "REJECTED"] } },
            select: { status: true, template: { select: { documentType: true, displayName: true } } },
          },
        },
      });

      const cases = rows
        .map((c: StagnantRow) => {
          const lastActivityAt = c.activities[0]?.createdAt ?? null;
          const locale: PortalLocale = isPortalLocale(c.client.locale) ? c.client.locale : "he";
          return {
            id: c.id,
            caseNumber: c.caseNumber,
            status: c.status,
            portalStep: c.portalStep,
            client: { fullName: c.client.fullName, email: c.client.email, locale },
            lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
            // CaseActivity is the intent-bearing feed, but it only starts at
            // CASE_CREATED — rows predating the timeline have none, and
            // updatedAt moves on any field write. Preferring the feed and
            // falling back to updatedAt means a case is never reported frozen
            // just because it predates the timeline.
            idleDays: daysSince(lastActivityAt ?? c.updatedAt),
            // Labels pre-translated by DocumentType enum (never by parsing the
            // Hebrew string) so a follow-up can name documents the way the
            // client sees them in the portal.
            outstanding: c.checklist.map((i: StagnantRow["checklist"][number]) => ({
              status: i.status,
              documentType: i.template.documentType,
              label: translateChecklistLabel(locale, i.template.documentType, i.template.displayName),
            })),
            staffUrl: `${BASE_URL}/cases/${c.id}`,
          };
        })
        .filter((c: { idleDays: number }) => c.idleDays >= FROZEN_AFTER_DAYS)
        .sort((a: { idleDays: number }, b: { idleDays: number }) => b.idleDays - a.idleDays);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ thresholdDays: FROZEN_AFTER_DAYS, count: cases.length, cases }, null, 2),
          },
        ],
      };
    },
  );
}
