// Admin user-management Server Actions (src/lib/actions.ts).
//
// Unlike the pure-core workflows in src/lib/workflows/*, actions.ts imports
// Prisma, NextAuth and next/cache directly, so there are no ports to inject.
// These tests substitute those three modules with node:test module mocks
// (`--experimental-test-module-mocks`, set in the `test` script) and drive the
// real exported actions — no production code is reshaped for testability.
//
// `requireAdmin` is not exported; it is covered through the actions it guards,
// which is also the only way it is ever reached in production.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mutable fixture state, read by the mocked modules on every call ───────────

interface TargetUser {
  role: "ADMIN" | "SUPERVISOR" | "AGENT";
  status: "PENDING_APPROVAL" | "APPROVED" | "SUSPENDED";
}

type Json = Record<string, unknown>;

interface Call {
  op: string;
  args?: Json;
  path?: string;
  size?: number;
}

// @types/node still types the removed `namedExports` instead of `exports`; the
// runtime accepts (and now requires) `exports`, so the option object is cast.
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

const state: {
  session: unknown;
  target: TargetUser | null;
  otherApprovedAdmins: number;
  calls: Call[];
} = {
  session: null,
  target: null,
  otherApprovedAdmins: 0,
  calls: [],
};

function reset(overrides: Partial<typeof state> = {}) {
  state.session = { user: { id: "admin-1", role: "ADMIN" } };
  state.target = { role: "AGENT", status: "PENDING_APPROVAL" };
  state.otherApprovedAdmins = 0;
  state.calls = [];
  Object.assign(state, overrides);
}

const only = (op: string) => state.calls.filter((c) => c.op === op);
const argsOf = (op: string, key: string) => ((only(op)[0]?.args?.[key] ?? {}) as Json);

mock.module(
  "../src/lib/prisma.ts",
  asExports({
    prisma: {
      user: {
        findUnique: async (args: Json) => {
          state.calls.push({ op: "user.findUnique", args });
          return state.target;
        },
        count: async (args: Json) => {
          state.calls.push({ op: "user.count", args });
          return state.otherApprovedAdmins;
        },
        // Called eagerly to build the $transaction array, so recording here is
        // what proves the write was *composed*; $transaction proves it ran.
        update: (args: Json) => {
          state.calls.push({ op: "user.update", args });
          return { __op: "user.update" };
        },
      },
      auditLog: {
        create: (args: Json) => {
          state.calls.push({ op: "auditLog.create", args });
          return { __op: "auditLog.create" };
        },
      },
      $transaction: async (ops: unknown[]) => {
        state.calls.push({ op: "$transaction", size: ops.length });
        return ops;
      },
    },
  }),
);

mock.module("../auth.ts", asExports({ auth: async () => state.session }));

mock.module(
  "next/cache",
  asExports({
    revalidatePath: (path: string) => state.calls.push({ op: "revalidatePath", path }),
  }),
);

// Loaded lazily (not top-level await — tsx emits CJS here) but only after the
// mocks above are registered, so actions.ts never binds the real Prisma client.
type Actions = typeof import("../src/lib/actions");
let actionsPromise: Promise<Actions> | null = null;
const actions = () => (actionsPromise ??= import("../src/lib/actions"));

const adminUpdateUser: Actions["adminUpdateUser"] = async (...args) =>
  (await actions()).adminUpdateUser(...args);
const approveUser: Actions["approveUser"] = async (...args) =>
  (await actions()).approveUser(...args);
const suspendUser: Actions["suspendUser"] = async (...args) =>
  (await actions()).suspendUser(...args);

// ── requireAdmin ─────────────────────────────────────────────────────────────

test("requireAdmin rejects an unauthenticated caller", async () => {
  reset({ session: null });
  await assert.rejects(() => adminUpdateUser("u-2", { status: "APPROVED" }), /Unauthorized/);
  assert.equal(only("user.findUnique").length, 0, "must not read the target before authorizing");
});

test("requireAdmin rejects a session with no user id", async () => {
  reset({ session: { user: { role: "ADMIN" } } });
  await assert.rejects(() => adminUpdateUser("u-2", { status: "APPROVED" }), /Unauthorized/);
});

test("requireAdmin rejects a non-ADMIN staff role", async () => {
  for (const role of ["SUPERVISOR", "AGENT"]) {
    reset({ session: { user: { id: "u-9", role } } });
    await assert.rejects(
      () => adminUpdateUser("u-2", { status: "APPROVED" }),
      /Unauthorized/,
      `${role} must not reach admin user management`,
    );
    assert.equal(only("$transaction").length, 0, `${role} must not write`);
  }
});

test("requireAdmin admits an ADMIN and the action proceeds", async () => {
  reset();
  await adminUpdateUser("u-2", { status: "APPROVED" });
  assert.equal(only("$transaction").length, 1);
});

// ── adminUpdateUser: input validation ─────────────────────────────────────────

test("adminUpdateUser rejects an unknown role", async () => {
  reset();
  await assert.rejects(() => adminUpdateUser("u-2", { role: "OWNER" } as never));
  assert.equal(only("$transaction").length, 0);
});

test("adminUpdateUser rejects an unknown status", async () => {
  reset();
  await assert.rejects(() => adminUpdateUser("u-2", { status: "DELETED" } as never));
});

test("adminUpdateUser rejects a one-character name", async () => {
  reset();
  await assert.rejects(() => adminUpdateUser("u-2", { name: "א" }));
});

test("adminUpdateUser rejects a missing target", async () => {
  reset({ target: null });
  await assert.rejects(() => adminUpdateUser("ghost", { status: "APPROVED" }), /המשתמש לא נמצא/);
  assert.equal(only("$transaction").length, 0);
});

// ── adminUpdateUser: the write it composes ────────────────────────────────────

test("adminUpdateUser writes only the fields supplied", async () => {
  reset();
  await adminUpdateUser("u-2", { status: "APPROVED" });
  const data = argsOf("user.update", "data");
  assert.deepEqual(data, { status: "APPROVED" });
});

test("adminUpdateUser normalizes an empty phone to null", async () => {
  reset();
  await adminUpdateUser("u-2", { phone: "" });
  const data = argsOf("user.update", "data");
  assert.equal(data.phone, null);
});

test("adminUpdateUser keeps a non-empty phone as given", async () => {
  reset();
  await adminUpdateUser("u-2", { phone: "050-1234567" });
  const data = argsOf("user.update", "data");
  assert.equal(data.phone, "050-1234567");
});

test("adminUpdateUser binds the audit row to the same transaction as the update", async () => {
  reset();
  await adminUpdateUser("u-2", { role: "SUPERVISOR" });
  assert.equal(only("$transaction")[0]?.size, 2, "update + audit row must be one atomic write");

  const data = argsOf("auditLog.create", "data");
  assert.equal(data.userId, "admin-1", "audit attributes the acting admin");
  assert.equal(data.action, "USER_UPDATE");
  assert.equal(data.entityType, "User");
  assert.equal(data.entityId, "u-2");
  assert.deepEqual(data.metadata, {
    before: { role: "AGENT", status: "PENDING_APPROVAL" },
    after: { role: "SUPERVISOR", status: "PENDING_APPROVAL" },
  });
});

test("adminUpdateUser revalidates the admin users page", async () => {
  reset();
  await adminUpdateUser("u-2", { status: "APPROVED" });
  assert.deepEqual(only("revalidatePath"), [{ op: "revalidatePath", path: "/admin/users" }]);
});

// ── adminUpdateUser: self-lockout guard ───────────────────────────────────────

test("an approved admin cannot demote their own role", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 5 });
  await assert.rejects(
    () => adminUpdateUser("admin-1", { role: "AGENT" }),
    /לא ניתן לבטל את הרשאות המנהל של עצמך/,
  );
  assert.equal(only("$transaction").length, 0);
});

test("an approved admin cannot suspend themselves", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 5 });
  await assert.rejects(
    () => adminUpdateUser("admin-1", { status: "SUSPENDED" }),
    /לא ניתן לבטל את הרשאות המנהל של עצמך/,
  );
});

test("the self-lockout guard fires before the last-admin count is even queried", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 5 });
  await assert.rejects(() => adminUpdateUser("admin-1", { role: "AGENT" }));
  assert.equal(only("user.count").length, 0);
});

test("an admin may edit their own non-privilege fields", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 0 });
  await adminUpdateUser("admin-1", { name: "מוטי" });
  assert.equal(only("$transaction").length, 1, "a name change strips no admin access");
});

// ── adminUpdateUser: last-admin (bricked-system) guard ────────────────────────

test("the final approved admin cannot be demoted", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 0 });
  await assert.rejects(
    () => adminUpdateUser("u-2", { role: "SUPERVISOR" }),
    /לא ניתן להסיר את מנהל המערכת המאושר האחרון/,
  );
  assert.equal(only("$transaction").length, 0);
});

test("the last-admin count excludes the target itself", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 0 });
  await assert.rejects(() => adminUpdateUser("u-2", { role: "SUPERVISOR" }));
  const where = argsOf("user.count", "where");
  assert.deepEqual(where, {
    role: "ADMIN",
    status: "APPROVED",
    id: { not: "u-2" },
  });
});

test("an admin may be demoted while another approved admin remains", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 1 });
  await adminUpdateUser("u-2", { role: "SUPERVISOR" });
  assert.equal(only("$transaction").length, 1);
});

test("a pending admin is not protected by the last-admin guard", async () => {
  reset({ target: { role: "ADMIN", status: "PENDING_APPROVAL" }, otherApprovedAdmins: 0 });
  await adminUpdateUser("u-2", { role: "AGENT" });
  assert.equal(only("user.count").length, 0, "an unapproved admin holds no access to lose");
  assert.equal(only("$transaction").length, 1);
});

test("a non-admin status change never consults the admin count", async () => {
  reset({ target: { role: "AGENT", status: "PENDING_APPROVAL" }, otherApprovedAdmins: 0 });
  await adminUpdateUser("u-2", { status: "SUSPENDED" });
  assert.equal(only("user.count").length, 0);
  assert.equal(only("$transaction").length, 1);
});

// ── approveUser / suspendUser ─────────────────────────────────────────────────

test("approveUser sets status APPROVED and nothing else", async () => {
  reset();
  await approveUser("u-2");
  const data = argsOf("user.update", "data");
  assert.deepEqual(data, { status: "APPROVED" });
});

test("suspendUser sets status SUSPENDED and nothing else", async () => {
  reset();
  await suspendUser("u-2");
  const data = argsOf("user.update", "data");
  assert.deepEqual(data, { status: "SUSPENDED" });
});

test("approveUser and suspendUser inherit the admin guard", async () => {
  reset({ session: { user: { id: "u-9", role: "AGENT" } } });
  await assert.rejects(() => approveUser("u-2"), /Unauthorized/);
  reset({ session: null });
  await assert.rejects(() => suspendUser("u-2"), /Unauthorized/);
});

test("suspendUser cannot brick the system by suspending the final approved admin", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 0 });
  await assert.rejects(
    () => suspendUser("u-2"),
    /לא ניתן להסיר את מנהל המערכת המאושר האחרון/,
  );
  assert.equal(only("$transaction").length, 0);
});

test("suspendUser cannot be used by an admin on themselves", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 5 });
  await assert.rejects(() => suspendUser("admin-1"), /לא ניתן לבטל את הרשאות המנהל של עצמך/);
});

test("approveUser re-approving an already approved admin is not a privilege loss", async () => {
  reset({ target: { role: "ADMIN", status: "APPROVED" }, otherApprovedAdmins: 0 });
  await approveUser("u-2");
  assert.equal(only("user.count").length, 0);
  assert.equal(only("$transaction").length, 1);
});
