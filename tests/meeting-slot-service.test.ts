// bookSlotForCase (src/lib/services/meeting-slots.ts): the atomic claim shared
// by the client portal and the assistant. The property pinned here is the one
// the extraction fixed — a failed claim must throw *inside* the transaction so
// the release of the case's previous booking is rolled back, instead of
// committing the release and silently dropping the client's meeting.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Json = Record<string, unknown>;
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

const state = { claimCount: 1, ops: [] as string[], txRejected: false, activity: 0 };

const tx = {
  meetingSlot: {
    updateMany: async (args: { where: Json }) => {
      const isClaim = "id" in args.where;
      state.ops.push(isClaim ? "claim" : "release");
      return { count: isClaim ? state.claimCount : 1 };
    },
    findUnique: async () => ({ id: "s2", startsAt: new Date("2026-10-06T07:00:00Z"), durationMinutes: 60, location: null }),
  },
};

mock.module(
  "../src/lib/prisma.ts",
  asExports({
    prisma: {
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => {
        try {
          return await fn(tx);
        } catch (err) {
          state.txRejected = true; // a real DB rolls back every write above
          throw err;
        }
      },
    },
  })
);
mock.module(
  "../src/lib/activity.ts",
  asExports({ logCaseActivity: async () => void state.activity++ })
);

const input = {
  caseId: "c1",
  slotId: "s2",
  earliest: new Date(0),
  actorId: "u1",
  describe: () => "x",
};

function reset(claimCount: number) {
  Object.assign(state, { claimCount, ops: [], txRejected: false, activity: 0 });
}

test("bookSlotForCase: successful claim releases, claims, logs, commits", async () => {
  const { bookSlotForCase } = await import("../src/lib/services/meeting-slots");
  reset(1);
  const slot = await bookSlotForCase(input);
  assert.equal(slot?.id, "s2");
  assert.deepEqual(state.ops, ["release", "claim"]);
  assert.equal(state.txRejected, false);
  assert.equal(state.activity, 1);
});

test("bookSlotForCase: lost claim rolls back the release and returns null", async () => {
  const { bookSlotForCase } = await import("../src/lib/services/meeting-slots");
  reset(0);
  const slot = await bookSlotForCase(input);
  assert.equal(slot, null);
  assert.deepEqual(state.ops, ["release", "claim"]);
  assert.equal(state.txRejected, true, "release must not commit when the claim fails");
  assert.equal(state.activity, 0);
});
