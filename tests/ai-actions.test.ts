// Assistant Human-in-the-Loop action layer: the pure intent lifecycle
// (src/lib/ai/tools/intent.ts) and the execute gate
// (src/app/api/ai/actions/execute/route.ts).
//
// The route is driven for real; Prisma, NextAuth and the action registry are
// substituted with node:test module mocks (same technique as actions.test.ts),
// so every refusal branch is exercised without a database.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

type Json = Record<string, unknown>;
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

const MINUTE = 60_000;

const state: {
  session: unknown;
  intent: { id: string; userId: string | null; createdAt: Date; meta: Json } | null;
  decidedCount: number;
  recentApprovals: number;
  execResult: { ok: boolean; message: string; entityHref?: string };
  audits: Json[];
  executedWith: unknown[];
} = {
  session: null,
  intent: null,
  decidedCount: 0,
  recentApprovals: 0,
  execResult: { ok: true, message: "done" },
  audits: [],
  executedWith: [],
};

function reset(overrides: Partial<typeof state> = {}) {
  state.session = { user: { id: "u1", role: "AGENT" } };
  state.intent = {
    id: "intent-1",
    userId: "u1",
    createdAt: new Date(),
    meta: { tool: "fake_action", params: { taskId: "t-real" } },
  };
  state.decidedCount = 0;
  state.recentApprovals = 0;
  state.execResult = { ok: true, message: "done", entityHref: "/cases/c1" };
  state.audits = [];
  state.executedWith = [];
  Object.assign(state, overrides);
}

const auditLog = {
  count: async (args: { where: Json }) =>
    args.where.action && typeof args.where.action === "object" && "in" in (args.where.action as Json)
      ? state.decidedCount
      : state.recentApprovals,
  create: async (args: { data: Json }) => {
    state.audits.push(args.data);
    return { id: `a${state.audits.length}` };
  },
};

mock.module(
  "../src/lib/prisma.ts",
  asExports({
    prisma: {
      auditLog,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ auditLog, $queryRaw: async () => [{ "?column?": 1 }] }),
    },
  })
);
mock.module("../auth.ts", asExports({ auth: async () => state.session }));


mock.module(
  "../src/lib/ai/tools/registry.ts",
  asExports({
    loadIntent: async () => state.intent,
    getAction: (name: string) =>
      name === "fake_action"
        ? {
            name: "fake_action",
            roles: ["ADMIN", "SUPERVISOR", "AGENT"],
            paramsSchema: z.object({ taskId: z.string() }),
            execute: async (params: unknown) => {
              state.executedWith.push(params);
              return state.execResult;
            },
          }
        : name === "admin_action"
          ? { name: "admin_action", roles: ["ADMIN"], paramsSchema: z.object({}), execute: async () => state.execResult }
          : undefined,
  })
);

function post(body: unknown) {
  return new Request("http://localhost/api/ai/actions/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const { POST } = await import("../src/app/api/ai/actions/execute/route");
  const res = await POST(post(body));
  return { status: res.status, data: (await res.json()) as Json };
}

const actionsOf = () => state.audits.map((a) => a.action);

// ── Pure lifecycle ────────────────────────────────────────────────────────────

test("intent: expires exactly at TTL", async () => {
  const { isIntentExpired, INTENT_TTL_MS } = await import("../src/lib/ai/tools/intent");
  const t0 = new Date("2026-01-01T10:00:00Z");
  assert.equal(isIntentExpired(t0, new Date(t0.getTime() + INTENT_TTL_MS - 1)), false);
  assert.equal(isIntentExpired(t0, new Date(t0.getTime() + INTENT_TTL_MS)), true);
});

test("intent: status derivation — outcome beats claim, orphan claim is FAILED", async () => {
  const { deriveIntentStatus, AUDIT } = await import("../src/lib/ai/tools/intent");
  const now = new Date();
  assert.equal(deriveIntentStatus([], now, now).status, "PENDING");
  assert.equal(deriveIntentStatus([], new Date(now.getTime() - 16 * MINUTE), now).status, "EXPIRED");
  const executed = deriveIntentStatus(
    [{ action: AUDIT.APPROVED }, { action: AUDIT.EXECUTED, metadata: { message: "ok", entityHref: "/x" } }],
    now,
    now
  );
  assert.deepEqual(executed, { status: "EXECUTED", message: "ok", entityHref: "/x" });
  assert.equal(deriveIntentStatus([{ action: AUDIT.APPROVED }], now, now).status, "FAILED");
  assert.equal(deriveIntentStatus([{ action: AUDIT.CANCELLED }], now, now).status, "CANCELLED");
  assert.equal(deriveIntentStatus([{ action: AUDIT.DENIED }], now, now).status, "DENIED");
});

test("intent: parseDay anchors a calendar day without UTC drift", async () => {
  const { parseDay } = await import("../src/lib/ai/tools/intent");
  assert.equal(parseDay("2026-03-05").toISOString(), "2026-03-05T12:00:00.000Z");
});

test("intent: execute body rejects smuggled params shape", async () => {
  const { executeBodySchema } = await import("../src/lib/ai/tools/intent");
  assert.equal(executeBodySchema.safeParse({ intentId: "x", decision: "MAYBE" }).success, false);
  const parsed = executeBodySchema.parse({ intentId: "x", decision: "APPROVE", params: { taskId: "evil" } });
  assert.equal("params" in parsed, false);
});

// ── Execute gate ─────────────────────────────────────────────────────────────

test("execute: unauthenticated and CLIENT sessions are rejected", async () => {
  reset({ session: null });
  assert.equal((await call({ intentId: "intent-1", decision: "APPROVE" })).status, 401);
  reset({ session: { user: { id: "u1", role: "CLIENT" } } });
  assert.equal((await call({ intentId: "intent-1", decision: "APPROVE" })).status, 401);
  assert.equal(state.executedWith.length, 0);
});

test("execute: another user's intent is indistinguishable from a missing one", async () => {
  reset();
  state.intent!.userId = "someone-else";
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 404);
  assert.equal(state.executedWith.length, 0);
  assert.equal(state.audits.length, 0);
});

test("execute: approve runs persisted params, ignoring body params, and audits claim + outcome", async () => {
  reset();
  const res = await call({ intentId: "intent-1", decision: "APPROVE", params: { taskId: "t-evil" } });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "EXECUTED");
  assert.deepEqual(state.executedWith, [{ taskId: "t-real" }]);
  assert.deepEqual(actionsOf(), ["AI_ACTION_APPROVED", "AI_ACTION_EXECUTED"]);
  assert.equal(state.audits[0].entityId, "intent-1");
});

test("execute: an already-decided intent is never executed twice", async () => {
  reset({ decidedCount: 1 });
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 409);
  assert.equal(state.executedWith.length, 0);
  assert.equal(state.audits.length, 0);
});

test("execute: expired intent returns 410 without executing", async () => {
  reset();
  state.intent!.createdAt = new Date(Date.now() - 16 * MINUTE);
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 410);
  assert.equal(state.executedWith.length, 0);
});

test("execute: role is re-checked at approval time and the denial is audited", async () => {
  reset();
  state.intent!.meta = { tool: "admin_action", params: {} };
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 403);
  assert.deepEqual(actionsOf(), ["AI_ACTION_DENIED"]);
});

test("execute: cancel audits and never executes", async () => {
  reset();
  const res = await call({ intentId: "intent-1", decision: "CANCEL" });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "CANCELLED");
  assert.deepEqual(actionsOf(), ["AI_ACTION_CANCELLED"]);
  assert.equal(state.executedWith.length, 0);
});

test("execute: engine refusal is audited as FAILED with 422", async () => {
  reset({ execResult: { ok: false, message: "אין הרשאה לערוך משימה זו" } });
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 422);
  assert.deepEqual(actionsOf(), ["AI_ACTION_APPROVED", "AI_ACTION_FAILED"]);
});

test("execute: tampered persisted params fail validation and are audited", async () => {
  reset();
  state.intent!.meta = { tool: "fake_action", params: { taskId: 42 } };
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 500);
  assert.equal(state.executedWith.length, 0);
  assert.deepEqual(actionsOf(), ["AI_ACTION_APPROVED", "AI_ACTION_FAILED"]);
});

test("execute: per-user approval rate limit", async () => {
  reset({ recentApprovals: 10 });
  const res = await call({ intentId: "intent-1", decision: "APPROVE" });
  assert.equal(res.status, 429);
  assert.equal(state.executedWith.length, 0);
});

test("execute: malformed body is a generic 400", async () => {
  reset();
  assert.equal((await call({ decision: "APPROVE" })).status, 400);
});
