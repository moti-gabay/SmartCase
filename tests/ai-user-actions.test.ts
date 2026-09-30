// Proposal-time guards of the ADMIN user-management actions
// (src/lib/ai/tools/users-tools.ts) and the staff-session route guard
// (src/lib/authz.ts). The admin Server Actions stay the enforcement point
// (covered by actions.test.ts); these pin that the assistant never *offers* a
// card for a change those actions would refuse.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Json = Record<string, unknown>;
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

type U = { id: string; name: string; role: string; status: string; createdAt: Date };
const state: { users: U[]; otherAdmins: number; authored: number; session: unknown } = {
  users: [],
  otherAdmins: 1,
  authored: 0,
  session: null,
};

const count = async () => state.authored;
mock.module(
  "../src/lib/prisma.ts",
  asExports({
    prisma: {
      user: {
        findMany: async () => state.users,
        count: async () => state.otherAdmins,
      },
      case: { count },
      note: { count },
      task: { count },
      caseStatusHistory: { count },
    },
  })
);
mock.module("../auth.ts", asExports({ auth: async () => state.session }));
mock.module("next/cache", asExports({ revalidatePath: () => {} }));

const ADMIN = { id: "admin-1", role: "ADMIN" as const };
const user = (o: Partial<U>): U => ({ id: "u2", name: "רון", role: "AGENT", status: "APPROVED", createdAt: new Date(), ...o });

async function propose(tool: string, args: Json, overrides: Partial<typeof state> = {}) {
  Object.assign(state, { users: [], otherAdmins: 1, authored: 0 }, overrides);
  const { getAction } = await import("../src/lib/ai/tools/registry");
  return getAction(tool)!.resolve(args as never, ADMIN) as Promise<Json>;
}

test("approve_user: proposes for a pending registration", async () => {
  const r = await propose("approve_user", { userName: "רון" }, { users: [user({ status: "PENDING_APPROVAL" })] });
  assert.deepEqual(r.params, { userId: "u2" });
});

test("approve_user: already-approved is refused", async () => {
  const r = await propose("approve_user", { userName: "רון" }, { users: [user({})] });
  assert.ok("error" in r);
});

test("change_role: admin cannot demote themself", async () => {
  const r = await propose("change_role", { userName: "אני", role: "AGENT" }, {
    users: [user({ id: "admin-1", name: "אני", role: "ADMIN" })],
  });
  assert.equal(r.error, "לא ניתן לבטל את הרשאות המנהל של עצמך");
});

test("suspend_user: the last approved admin cannot be suspended", async () => {
  const r = await propose("suspend_user", { userName: "דנה" }, {
    users: [user({ id: "a2", name: "דנה", role: "ADMIN" })],
    otherAdmins: 0,
  });
  assert.equal(r.error, "לא ניתן להסיר את מנהל המערכת המאושר האחרון");
});

test("suspend_user: another admin can be suspended when admins remain", async () => {
  const r = await propose("suspend_user", { userName: "דנה" }, {
    users: [user({ id: "a2", name: "דנה", role: "ADMIN" })],
    otherAdmins: 1,
  });
  assert.deepEqual(r.params, { userId: "a2" });
});

test("delete_user: self, and accounts with history, are refused (suggests suspend)", async () => {
  const self = await propose("delete_user", { userName: "אני" }, { users: [user({ id: "admin-1", name: "אני", role: "ADMIN" })] });
  assert.equal(self.error, "לא ניתן למחוק את המשתמש שלך");
  const busy = await propose("delete_user", { userName: "רון" }, { users: [user({})], authored: 3 });
  assert.match(String(busy.error), /suspend_user/);
  const clean = await propose("delete_user", { userName: "רון" }, { users: [user({ status: "PENDING_APPROVAL" })] });
  assert.deepEqual(clean.params, { userId: "u2" });
});

test("resolveUser: ambiguous names return candidates without emails", async () => {
  const r = await propose("approve_user", { userName: "רון" }, {
    users: [user({ id: "a", name: "רון כהן" }), user({ id: "b", name: "רון לוי", status: "PENDING_APPROVAL" })],
  });
  assert.ok(Array.isArray(r.candidates) && (r.candidates as string[]).length === 2);
  assert.ok(!(r.candidates as string[]).some((c) => c.includes("@")));
});

test("requireStaffSession: no session 401, CLIENT 403, staff passes", async () => {
  const { requireStaffSession } = await import("../src/lib/authz");
  state.session = null;
  let g = await requireStaffSession();
  assert.ok("denied" in g && g.denied.status === 401);
  state.session = { user: { id: "c1", role: "CLIENT" } };
  g = await requireStaffSession();
  assert.ok("denied" in g && g.denied.status === 403);
  state.session = { user: { id: "s1", role: "AGENT" } };
  g = await requireStaffSession();
  assert.ok("session" in g && g.session.user.id === "s1");
});
