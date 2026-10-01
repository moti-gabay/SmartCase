// POST /api/auth/login — mobile credentials → Auth.js session JWT.
//
// Prisma is substituted with a module mock (same pattern as actions.test.ts);
// bcrypt, zod and next-auth/jwt run for real so the token the route mints is
// proven decodable with the salt Auth.js would use for the request's scheme.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

process.env.AUTH_SECRET ??= "test-secret-for-login-route";

type Json = Record<string, unknown>;
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

const PASSWORD = "correct-horse";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

const state: { user: Json | null; lastWhere: Json | null } = { user: null, lastWhere: null };

const staff = (overrides: Json = {}) => ({
  id: "u-1",
  name: "נציג",
  email: "agent@example.com",
  passwordHash,
  role: "AGENT",
  status: "APPROVED",
  ...overrides,
});

mock.module(
  "../src/lib/prisma.ts",
  asExports({
    prisma: {
      user: {
        findFirst: async (args: Json) => {
          state.lastWhere = args.where as Json;
          return state.user;
        },
      },
    },
  })
);

let seq = 0;
const post = async (body: unknown, url = "http://localhost:3000/api/auth/login") => {
  const { POST } = await import("../src/app/api/auth/login/route");
  // Distinct IP per call so the rate limiter never couples unrelated tests.
  seq += 1;
  return POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${seq}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
};

test("400 on malformed body", async () => {
  state.user = staff();
  const res = await post({ email: "not-an-email", password: "x" });
  assert.equal(res.status, 400);
  const bad = await post("{not json");
  assert.equal(bad.status, 400);
});

test("401 for unknown email and wrong password — same body, no enumeration", async () => {
  state.user = null;
  const unknown = await post({ email: "nobody@example.com", password: PASSWORD });
  state.user = staff();
  const wrong = await post({ email: "agent@example.com", password: "nope" });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await unknown.json(), await wrong.json());
});

test("wrong password never reveals account state", async () => {
  state.user = staff({ status: "SUSPENDED" });
  const res = await post({ email: "agent@example.com", password: "nope" });
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as Json).code, undefined);
});

test("403 with code for pending / suspended accounts (valid password)", async () => {
  state.user = staff({ status: "PENDING_APPROVAL" });
  const pending = await post({ email: "agent@example.com", password: PASSWORD });
  assert.equal(pending.status, 403);
  assert.equal(((await pending.json()) as Json).code, "pending_approval");

  state.user = staff({ status: "SUSPENDED" });
  const suspended = await post({ email: "agent@example.com", password: PASSWORD });
  assert.equal(suspended.status, 403);
  assert.equal(((await suspended.json()) as Json).code, "suspended");
});

test("403 for CLIENT role — no token is ever issued to a non-staff account", async () => {
  state.user = staff({ role: "CLIENT" });
  const res = await post({ email: "agent@example.com", password: PASSWORD });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as Json).token, undefined);
});

test("200 for approved staff: decodable Auth.js JWT with the jwt() claims", async () => {
  state.user = staff();
  const res = await post({ email: "Agent@Example.com", password: PASSWORD });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Json;
  assert.equal(body.cookieName, "authjs.session-token");
  assert.deepEqual(body.user, { id: "u-1", name: "נציג", email: "agent@example.com", role: "AGENT" });
  assert.ok(typeof body.expiresAt === "string" && Date.parse(body.expiresAt as string) > Date.now());
  // Lookup is case-insensitive, matching auth.ts.
  assert.deepEqual(state.lastWhere, { email: { equals: "Agent@Example.com", mode: "insensitive" } });

  const { decode } = await import("next-auth/jwt");
  const claims = (await decode({
    token: body.token as string,
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
  })) as Json;
  assert.equal(claims.id, "u-1");
  assert.equal(claims.sub, "u-1");
  assert.equal(claims.role, "AGENT");
  assert.equal(claims.status, "APPROVED");
  assert.equal(typeof claims.statusCheckedAt, "number");
});

test("HTTPS request salts with the __Secure- cookie name", async () => {
  state.user = staff();
  const res = await post({ email: "agent@example.com", password: PASSWORD }, "https://smartcase.example/api/auth/login");
  assert.equal(res.status, 200);
  const body = (await res.json()) as Json;
  assert.equal(body.cookieName, "__Secure-authjs.session-token");
  const { decode } = await import("next-auth/jwt");
  await assert.rejects(
    decode({ token: body.token as string, secret: process.env.AUTH_SECRET!, salt: "authjs.session-token" }),
    /no matching decryption secret/,
    "token must not decode under the wrong salt"
  );
  const ok = (await decode({
    token: body.token as string,
    secret: process.env.AUTH_SECRET!,
    salt: "__Secure-authjs.session-token",
  })) as Json;
  assert.equal(ok.id, "u-1");
});

test("429 after the per-IP limit within one minute", async () => {
  state.user = staff();
  const { POST } = await import("../src/app/api/auth/login/route");
  const hit = () =>
    POST(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ email: "agent@example.com", password: "nope" }),
      })
    );
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await hit()).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
});
