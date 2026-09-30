// Live Voice Mode proposal parity (src/app/api/ai/live/tool/route.ts).
//
// The invariant pinned here: voice can PROPOSE an action but can never execute
// or approve one. Execution lives only in /api/ai/actions/execute, reached by a
// click on the card. The route is driven for real with Prisma, NextAuth, the
// registry and the read-tool dispatcher substituted by module mocks.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Json = Record<string, unknown>;
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

process.env.AUTH_SECRET ??= "test-secret-for-pii-seal";

const state: {
  session: unknown;
  ownedConversation: boolean;
  proposeCalls: { name: string; args: unknown; actor: unknown; conversationId: unknown }[];
  readCalls: string[];
  executeCalls: number;
} = { session: null, ownedConversation: true, proposeCalls: [], readCalls: [], executeCalls: 0 };

function reset(overrides: Partial<typeof state> = {}) {
  Object.assign(state, {
    session: { user: { id: "u1", role: "AGENT" } },
    ownedConversation: true,
    proposeCalls: [],
    readCalls: [],
    executeCalls: 0,
    ...overrides,
  });
}

mock.module("../auth.ts", asExports({ auth: async () => state.session }));
mock.module(
  "../src/lib/prisma.ts",
  asExports({
    prisma: {
      conversation: {
        findFirst: async (args: { where: Json }) =>
          state.ownedConversation && args.where.userId === "u1" ? { id: String(args.where.id) } : null,
      },
    },
  })
);
mock.module(
  "../src/lib/ai/tools/registry.ts",
  asExports({
    isActionTool: (name: string) => name === "create_task",
    proposeAction: async (name: string, args: unknown, actor: unknown, conversationId: unknown) => {
      state.proposeCalls.push({ name, args, actor, conversationId });
      return {
        intent: { intentId: "intent-9", tool: name, summaryHebrew: "יצירת משימה", displayParams: [], status: "PENDING" },
        modelResult: { status: "PENDING_APPROVAL", summary: "יצירת משימה" },
      };
    },
    // Present so a regression that reaches for execution is observable.
    getAction: () => ({
      execute: async () => {
        state.executeCalls++;
        return { ok: true, message: "" };
      },
    }),
  })
);
mock.module(
  "../src/lib/ai/assistant-tools.ts",
  asExports({
    executeAssistantTool: async (name: string) => {
      state.readCalls.push(name);
      return { results: [] };
    },
  })
);

async function call(body: Json) {
  const { POST } = await import("../src/app/api/ai/live/tool/route");
  const res = await POST(
    new Request("http://localhost/api/ai/live/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, data: (await res.json()) as Json };
}

test("live tool: an action tool only proposes and returns the card payload", async () => {
  reset();
  const res = await call({ name: "create_task", args: { caseNumber: "SC-1", title: "x" }, conversationId: "conv-1" });
  assert.equal(res.status, 200);
  assert.equal((res.data.intent as Json).intentId, "intent-9");
  assert.equal((res.data.result as Json).status, "PENDING_APPROVAL");
  assert.equal(state.proposeCalls.length, 1);
  assert.deepEqual(state.proposeCalls[0].actor, { id: "u1", role: "AGENT" });
  assert.equal(state.proposeCalls[0].conversationId, "conv-1");
  assert.equal(state.executeCalls, 0, "voice must never execute");
  assert.deepEqual(state.readCalls, []);
});

test("live tool: a conversation id the user does not own is dropped", async () => {
  reset({ ownedConversation: false });
  await call({ name: "create_task", args: {}, conversationId: "someone-elses" });
  assert.equal(state.proposeCalls[0].conversationId, null);
});

test("live tool: role and user come from the session, never the body", async () => {
  reset({ session: { user: { id: "u1", role: "AGENT" } } });
  await call({ name: "create_task", args: {}, role: "ADMIN", userId: "admin-1" });
  assert.deepEqual(state.proposeCalls[0].actor, { id: "u1", role: "AGENT" });
});

test("live tool: read tools still execute directly, with no card", async () => {
  reset();
  const res = await call({ name: "get_alerts", args: {} });
  assert.deepEqual(state.readCalls, ["get_alerts"]);
  assert.equal(res.data.intent, undefined);
  assert.equal(state.proposeCalls.length, 0);
});

test("live tool: unauthenticated and CLIENT sessions are rejected", async () => {
  reset({ session: null });
  assert.equal((await call({ name: "create_task", args: {} })).status, 401);
  reset({ session: { user: { id: "c1", role: "CLIENT" } } });
  assert.equal((await call({ name: "create_task", args: {} })).status, 401);
  assert.equal(state.proposeCalls.length, 0);
});

test("invariant: the live tool route has no path to execution or approval", () => {
  // Comments are stripped: the header deliberately names the execute endpoint.
  const src = readFileSync("src/app/api/ai/live/tool/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(!src.includes("actions/execute"), "must not call the execute endpoint");
  assert.ok(!/\.execute\(/.test(src), "must not call an action's execute()");
  assert.ok(!src.includes("getAction("), "must not load action definitions");
});

test("voice prompt: spoken approval is explicitly not approval", async () => {
  const { LIVE_PROMPT_ADDENDUM } = await import("../src/lib/ai/live-protocol");
  assert.match(LIVE_PROMPT_ADDENDUM, /אישור בקול אינו אישור/);
  assert.match(LIVE_PROMPT_ADDENDUM, /אישור וביצוע/);
});

test("withProposalLead: an untranscribed proposal turn is kept, greetings still drop", async () => {
  const { withProposalLead, normalizeTurns, UNTRANSCRIBED_REQUEST } = await import("../src/lib/ai/live-protocol");
  const assistantOnly = [{ role: "ASSISTANT" as const, text: "בדוק את הכרטיס" }];
  // No proposal: unchanged behavior — a lone assistant turn (greeting) drops.
  assert.deepEqual(normalizeTurns(withProposalLead(assistantOnly, false), "x"), []);
  // Proposal: kept, led by the placeholder so the alternation holds.
  assert.deepEqual(normalizeTurns(withProposalLead(assistantOnly, true), "x"), [
    { role: "USER", text: UNTRANSCRIBED_REQUEST },
    { role: "ASSISTANT", text: "בדוק את הכרטיס" },
  ]);
  // A real user transcript needs no placeholder.
  const spoken = [{ role: "USER" as const, text: "צור משימה" }, ...assistantOnly];
  assert.deepEqual(withProposalLead(spoken, true), spoken);
});
