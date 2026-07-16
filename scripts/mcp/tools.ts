// Active MCP tools. Every handler is wrapped so a DB failure returns an isError
// result rather than throwing: a thrown handler surfaces as a transport-level
// fault and would take the server down with it.
//
// NOTE: src/lib/actions.ts is "use server" and must never be imported here — its
// exports would cross the Server Action trust boundary, and reviewDocument()
// calls requireUserId(), which has no session in a script. Its transaction is
// replicated below instead.
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/prisma";
import { logCaseActivity } from "@/lib/activity";
import { sendDocumentRejectionEmail } from "@/lib/notifications";
import { isPortalLocale, portalDict, PORTAL_LOCALES, type PortalLocale } from "@/lib/i18n/conversion-portal";
import type { CaseStep, DocumentType } from "@/types";

// Kept in step with scripts/create-test-case.ts, which seeds the same shape from
// the CLI. The two duplicate this recipe deliberately (the CLI was left
// untouched); change one and change the other.
const BASE_URL = "http://localhost:3000";
const TOKEN_TTL_DAYS = 30;
const TEST_EMAIL = process.env.TEST_CLIENT_EMAIL || "smartcase.test@example.com";

// `satisfies` pins this tuple to the hand-maintained union in src/types, so
// adding a step to the schema without updating this list is a compile error
// rather than a silent gap in the tool's advertised JSON Schema.
const CASE_STEPS = [
  "WELCOME",
  "PROCESS_OVERVIEW",
  "WIZARD_PERSONAL",
  "WIZARD_FAMILY",
  "WIZARD_BACKGROUND",
  "PERSONAL_STORY",
  "PENDING_DOCS",
  "SCHEDULE_MEETING",
  "TRACKING",
] as const satisfies readonly CaseStep[];

const LOCALES = PORTAL_LOCALES as [PortalLocale, ...PortalLocale[]];

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

// Full stack to stderr (stdout is the transport), short message to the caller.
function fail(scope: string, err: unknown) {
  console.error(`[mcp:${scope}]`, err);
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

// nationalId is @unique and every run mints a fresh client, so a collision would
// abort the transaction — cheap to just re-roll. Ported from create-test-case.ts.
async function uniqueNationalId(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = String(randomInt(100_000_000, 1_000_000_000));
    const taken: { id: string } | null = await prisma.client.findUnique({
      where: { nationalId: id },
      select: { id: true },
    });
    if (!taken) return id;
  }
  throw new Error("Could not allocate a unique nationalId after 5 attempts");
}

// Same sequence the UI allocates from, so seeded cases sort naturally alongside
// real ones in the dashboard.
async function nextCaseNumber(): Promise<string> {
  const prefix = `SC-${new Date().getFullYear()}-`;
  const last: { caseNumber: string } | null = await prisma.case.findFirst({
    where: { caseNumber: { startsWith: prefix } },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  const lastSeq = last ? parseInt(last.caseNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, "0")}`;
}

type ChecklistHit = {
  id: string;
  documentId: string | null;
  // documentType is the DocumentType union rather than string: it is copied onto
  // the synthesized Document row, whose column is the enum. The union is still
  // assignable to translateChecklistLabel's string param.
  template: { documentType: DocumentType; displayName: string };
};

// Mirrors sendDocumentRejectionEmail's own internal lookup. That helper takes
// only a caseId and resolves the recipient itself, so reporting what it will do
// (or would have done) means re-deriving it here.
async function resolveEmailTarget(caseId: string) {
  const c: {
    clientPortalToken: string | null;
    client: { email: string | null; locale: string };
  } | null = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      clientPortalToken: true,
      client: { select: { email: true, locale: true } },
    },
  });

  const raw = c?.client.locale ?? "he";
  const locale: PortalLocale = isPortalLocale(raw) ? raw : "he";
  const to = c?.client.email ?? null;

  const skipReason = !process.env.RESEND_API_KEY
    ? "RESEND_API_KEY not set"
    : !to
      ? "client has no email"
      : !c?.clientPortalToken
        ? "case has no portal token"
        : null;

  return { to, locale, subject: portalDict[locale].emailRejectSubject, skipReason };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "create_test_case",
    {
      title: "Create test case",
      description:
        "Seeds a portal-ready CONVERSION test case (client, case, 256-bit share token, checklist, timeline) in one transaction and returns its ids and local URLs. Mirrors `npm run db:seed-test`.",
      inputSchema: {
        clientName: z.string().min(1).describe("Full name for the seeded client"),
        portalStep: z.enum(CASE_STEPS).default("WELCOME").describe("Portal step to park the case on"),
        locale: z
          .enum(LOCALES)
          .default("he")
          .describe("Persisted client locale — drives portal language and notification emails"),
      },
    },
    async ({ clientName, portalStep, locale }) => {
      try {
        // Cases require a creator FK; the portal journey belongs to a real staff owner.
        const creator: { id: string } | null = await prisma.user.findFirst({
          where: { role: "ADMIN", status: "APPROVED" },
          select: { id: true },
        });
        if (!creator) throw new Error("No approved ADMIN user found — run `npm run db:seed` first");

        const templates: { id: string }[] = await prisma.documentChecklistTemplate.findMany({
          where: { caseType: "CONVERSION" },
          select: { id: true },
        });
        if (templates.length === 0) {
          throw new Error("No CONVERSION checklist templates found — run `npm run db:seed` first");
        }

        const nationalId = await uniqueNationalId();
        const caseNumber = await nextCaseNumber();
        // Identical recipe to generatePortalLink: a 256-bit bearer secret stored raw.
        const token = randomBytes(32).toString("base64url");

        // One transaction: a failure anywhere leaves no half-built case and no
        // orphan timeline entry, which is why logCaseActivity takes the tx client.
        const created = await prisma.$transaction(async (tx) => {
          const client = await tx.client.create({
            data: {
              fullName: clientName,
              nationalId,
              dateOfBirth: new Date("1990-01-01"),
              gender: "OTHER",
              phone: "050-0000000",
              email: TEST_EMAIL,
              locale,
            },
            select: { id: true },
          });

          const c = await tx.case.create({
            data: {
              caseNumber,
              clientId: client.id,
              createdById: creator.id,
              caseType: "CONVERSION",
              status: "NEW_INTAKE",
              priority: "MEDIUM",
              portalStep,
              clientPortalToken: token,
              clientPortalTokenExpiresAt: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
              hasMissingDocuments: true,
              statusHistory: {
                create: { changedById: creator.id, previousStatus: null, newStatus: "NEW_INTAKE" },
              },
              checklist: {
                create: templates.map((t: { id: string }) => ({ templateId: t.id, status: "MISSING" as const })),
              },
            },
            select: { id: true },
          });

          await logCaseActivity(
            tx,
            c.id,
            "CASE_CREATED",
            `התיק נפתח: ${caseNumber}`,
            { caseType: "CONVERSION", priority: "MEDIUM", source: "mcp:create_test_case" },
            creator.id,
          );

          return c;
        });

        return ok({
          caseId: created.id,
          caseNumber,
          locale,
          portalStep,
          token,
          staffUrl: `${BASE_URL}/cases/${created.id}`,
          publicUrl: `${BASE_URL}/share/conversion/${token}`,
        });
      } catch (err) {
        return fail("create_test_case", err);
      }
    },
  );

  server.registerTool(
    "trigger_document_rejection",
    {
      title: "Trigger document rejection",
      description:
        "Rejects a checklist item on a case: sets it to REJECTED with a reason the client can see, logs a DOCUMENT_REJECTED activity, and emails the client in their persisted locale. " +
        "If the item has no uploaded document, a placeholder Document row is synthesized to carry the reason (the portal reads it via document.reviewNotes). " +
        "NOTE: dryRun still applies the database changes — it only skips the email dispatch.",
      inputSchema: {
        caseId: z.string().min(1),
        documentName: z.string().min(1).describe("Checklist template displayName to reject, e.g. 'תעודת זהות'"),
        reviewNotes: z.string().min(1).describe("Rejection reason — shown to the client in the portal and email"),
        dryRun: z
          .boolean()
          .default(false)
          .describe("Apply the rejection to the database but skip sending the email. Not a no-op probe."),
      },
    },
    async ({ caseId, documentName, reviewNotes, dryRun }) => {
      try {
        const item: ChecklistHit | null = await prisma.caseChecklist.findFirst({
          where: { caseId, template: { displayName: documentName } },
          select: {
            id: true,
            documentId: true,
            template: { select: { documentType: true, displayName: true } },
          },
        });

        // Listing the valid names lets the caller self-correct instead of guessing.
        if (!item) {
          const all: { template: { displayName: string } }[] = await prisma.caseChecklist.findMany({
            where: { caseId },
            select: { template: { select: { displayName: true } } },
          });
          const names = all.map((i: { template: { displayName: string } }) => i.template.displayName).join(", ");
          throw new Error(
            `No checklist item named "${documentName}" on case ${caseId}. Available: ${names || "(none)"}`,
          );
        }

        const email = await resolveEmailTarget(caseId);
        const synthesized = item.documentId === null;

        // Replicates the reviewDocument transaction in src/lib/actions.ts. Two
        // documented divergences: reviewedById / activity userId are null (a
        // script has no session, and both columns are nullable), and the
        // UPLOADED_PENDING_REVIEW guard is skipped — rejecting a never-uploaded
        // item is the point of this tool.
        const result = await prisma.$transaction(async (tx) => {
          let documentId = item.documentId;

          if (documentId) {
            await tx.document.update({
              where: { id: documentId },
              data: { status: "REJECTED", reviewNotes },
            });
          } else {
            // No upload ever arrived: synthesize the row a reviewer would have
            // acted on, so the checklist item has something to point at. No
            // storageKey/fileData — nothing was actually uploaded.
            const doc: { id: string } = await tx.document.create({
              data: {
                caseId,
                documentType: item.template.documentType,
                displayName: item.template.displayName,
                status: "REJECTED",
                reviewNotes,
              },
              select: { id: true },
            });
            documentId = doc.id;
          }

          // Starting from the checklist item (rather than documentId, as
          // actions.ts does) sets the status and establishes the link in one write.
          await tx.caseChecklist.update({
            where: { id: item.id },
            data: { status: "REJECTED", documentId },
          });

          // Recompute the case flag — REJECTED counts as missing.
          const stillMissing: number = await tx.caseChecklist.count({
            where: { caseId, status: { in: ["MISSING", "REJECTED"] } },
          });
          await tx.case.update({
            where: { id: caseId },
            data: { hasMissingDocuments: stillMissing > 0 },
          });

          await logCaseActivity(
            tx,
            caseId,
            "DOCUMENT_REJECTED",
            `מסמך נדחה: ${item.template.displayName} — ${reviewNotes}`,
            { documentId, reason: reviewNotes, source: "mcp:trigger_document_rejection" },
            null,
          );

          return { documentId, hasMissingDocuments: stillMissing > 0 };
        });

        // Email goes out AFTER the commit and stays fully isolated, so a mail
        // failure can never roll back the rejection. sendDocumentRejectionEmail
        // already swallows its own errors; this guard covers anything before it.
        let attempted = false;
        if (!dryRun) {
          try {
            await sendDocumentRejectionEmail(caseId, item.template.displayName, reviewNotes);
            attempted = true;
          } catch (err) {
            console.error("[mcp:trigger_document_rejection:notify]", err);
          }
        }

        return ok({
          caseId,
          checklistItemId: item.id,
          documentId: result.documentId,
          status: "REJECTED",
          synthesizedDocument: synthesized,
          hasMissingDocuments: result.hasMissingDocuments,
          email: {
            // "attempted", not "sent": the helper returns void and no-ops
            // silently without RESEND_API_KEY, so this only means we called it
            // and it did not throw.
            attempted,
            skipped: dryRun ? "dryRun" : email.skipReason,
            to: email.to,
            locale: email.locale,
            subject: email.subject,
          },
        });
      } catch (err) {
        return fail("trigger_document_rejection", err);
      }
    },
  );
}
