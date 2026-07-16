// SmartCase in-repo MCP server — exposes the dev CLIs' capabilities (seeding a
// portal-ready case, driving the rejection→email flow) plus live schema and
// stagnation reads to an MCP client over stdio.
//
//   npm run mcp:serve
//
// Registered for the team in .mcp.json (+ enabledMcpjsonServers in
// .claude/settings.json). Talks to the live DB via the app's own Prisma
// singleton, activity logger and Resend mailer, so anything it writes is
// indistinguishable from what the app itself would write.
import "./bootstrap"; // MUST stay first — re-points console.log off stdout and loads .env. Do not reorder.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { registerTools } from "./tools";
import { registerResources } from "./resources";

const server = new McpServer({ name: "smartcase", version: "0.1.0" });

registerTools(server);
registerResources(server);

server.registerPrompt(
  "stagnant-case-recovery",
  {
    title: "Stagnant case recovery",
    description:
      "Review every stalled case and draft a personalised follow-up per client, written in their own language.",
    // MCP prompt arguments are string-typed by protocol, hence z.string().
    argsSchema: { thresholdDays: z.string().optional().describe("Idle threshold in days (default 14)") },
  },
  ({ thresholdDays }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Read the smartcase://cases/stagnant resource${
            thresholdDays ? ` and consider only cases idle for ${thresholdDays}+ days` : ""
          }.

For each case:
1. List the outstanding checklist items (status MISSING or REJECTED). Each carries a
   'label' already translated into the client's locale — use that wording, not the raw
   documentType.
2. Treat the two statuses differently. REJECTED means the client already tried and it
   came back — acknowledge that, and be specific about what needs fixing. MISSING means
   they have not started.
3. Draft a short, warm follow-up addressed to client.fullName, written entirely in
   client.locale ("he" = Hebrew/RTL, "en" = English, "fr" = French). Never mix languages
   within a draft.
4. Scale the tone to idleDays: a gentle nudge around 14 days, more direct past 30.
5. Reference the client's portal link so they can act immediately.

Output one section per case: case number, idle days, outstanding items, then the draft.
Do not send anything — these are drafts for staff review.`,
        },
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  // Not top-level await: module "esnext" lets tsc accept it, but tsx emits CJS
  // (no "type": "module" in package.json) where it fails at runtime.
  await server.connect(transport);
  console.error("[mcp:smartcase] ready on stdio");
}

// A dev tool should survive a bad query rather than drop the client's connection.
process.on("unhandledRejection", (reason) => console.error("[mcp:smartcase] unhandledRejection", reason));
process.on("uncaughtException", (err) => console.error("[mcp:smartcase] uncaughtException", err));

async function shutdown() {
  try {
    await prisma.$disconnect();
  } catch {
    // exiting anyway
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[mcp:smartcase] fatal", err);
  process.exit(1);
});
