import { test } from "node:test";
import assert from "node:assert/strict";

import { getManifest, instantiate, isKnownPlugin, listManifests } from "../src/lib/plugins/marketplace/catalog";
import { createPrismaPluginStateStore } from "../src/lib/plugins/marketplace/prisma-store";
import {
  createMemoryStateStore,
  disablePlugin,
  enablePlugin,
  generateTextViaMarketplace,
  listPlugins,
  notifyViaMarketplace,
  resolveAIChain,
  resolveEnabledIds,
  resolveNotificationPlugins,
} from "../src/lib/plugins/marketplace/service";
import type { InstalledPluginState, PluginEnv, PluginStateStore } from "../src/lib/plugins/marketplace/types";
import { formatPlugins } from "../scripts/telegram/responses";

/** Empty env — nothing leaks in from the developer's real environment. */
const BARE: PluginEnv = {};

function state(rows: Partial<InstalledPluginState>[]): InstalledPluginState[] {
  return rows.map((row) => ({
    pluginId: row.pluginId ?? "slack",
    isEnabled: row.isEnabled ?? true,
    configOverlay: row.configOverlay ?? {},
    updatedAt: row.updatedAt ?? new Date(0),
  }));
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

test("catalog exposes all five plugins with matching registry ids", () => {
  const ids = listManifests().map((manifest) => manifest.id).sort();
  assert.deepEqual(ids, ["anthropic", "ollama", "openai", "slack", "telegram"]);
});

test("catalog filters by category", () => {
  assert.deepEqual(listManifests("notification").map((m) => m.id), ["slack", "telegram"]);
  assert.deepEqual(listManifests("ai").map((m) => m.id), ["anthropic", "openai", "ollama"]);
});

test("getManifest / isKnownPlugin reject unknown ids without throwing", () => {
  assert.equal(getManifest("telegram")?.name, "Telegram");
  assert.equal(getManifest("nope"), null);
  assert.equal(isKnownPlugin("ollama"), true);
  assert.equal(isKnownPlugin("nope"), false);
});

test("instantiate builds against the supplied env, not process.env", () => {
  const configured = instantiate("telegram", { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" });
  assert.equal(configured?.name, "telegram");
  assert.equal(configured?.isConfigured(), true);
  assert.equal(instantiate("telegram", BARE)?.isConfigured(), false);
  assert.equal(instantiate("nope", BARE), null);
});

// ─── State toggling ──────────────────────────────────────────────────────────

test("enable then disable round-trips through the store", async () => {
  const store = createMemoryStateStore();

  const enabled = await enablePlugin("telegram", { store, configOverlay: { TELEGRAM_CHAT_ID: "42" } });
  assert.equal(enabled.isEnabled, true);
  assert.deepEqual(enabled.configOverlay, { TELEGRAM_CHAT_ID: "42" });

  const disabled = await disablePlugin("telegram", { store });
  assert.equal(disabled.isEnabled, false);
  // Disabling must not wipe the overlay — re-enabling should not need re-config.
  assert.deepEqual(disabled.configOverlay, { TELEGRAM_CHAT_ID: "42" });

  assert.equal((await store.list()).length, 1);
});

test("toggling an unknown plugin throws instead of writing a dangling row", async () => {
  const store = createMemoryStateStore();
  await assert.rejects(() => enablePlugin("nope", { store }), /Unknown plugin/);
  await assert.rejects(() => disablePlugin("nope", { store }), /Unknown plugin/);
  assert.equal((await store.list()).length, 0);
});

test("mutating without a store is an explicit error, not a silent no-op", async () => {
  await assert.rejects(() => enablePlugin("slack"), /PluginStateStore is required/);
});

// ─── Resolution precedence ───────────────────────────────────────────────────

test("with no DB rows the env vars decide", () => {
  const empty = new Map<string, InstalledPluginState>();
  assert.deepEqual(resolveEnabledIds("notification", empty, BARE), ["slack"]);
  assert.deepEqual(resolveEnabledIds("ai", empty, BARE), ["anthropic"]);
  assert.deepEqual(
    resolveEnabledIds("ai", empty, { AI_PROVIDER: "openai,anthropic" }),
    ["openai", "anthropic"]
  );
});

test("a disabled row removes a plugin the env var names", () => {
  const rows = new Map(state([{ pluginId: "slack", isEnabled: false }]).map((r) => [r.pluginId, r]));
  assert.deepEqual(resolveEnabledIds("notification", rows, { NOTIFICATION_PROVIDER: "all" }), ["telegram"]);
});

test("an enabled row appends a plugin the env var omits, after the env chain", () => {
  const rows = new Map(state([{ pluginId: "ollama", isEnabled: true }]).map((r) => [r.pluginId, r]));
  // Env order is the fallback priority and must survive the DB append.
  assert.deepEqual(resolveEnabledIds("ai", rows, { AI_PROVIDER: "openai" }), ["openai", "ollama"]);
});

test("listPlugins reports enablement, missing env vars and override provenance", async () => {
  const store = createMemoryStateStore(state([{ pluginId: "telegram", isEnabled: true }]));
  const plugins = await listPlugins({ store, env: BARE });
  const byId = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));

  assert.equal(byId.get("telegram")?.isEnabled, true);
  assert.equal(byId.get("telegram")?.hasOverride, true);
  assert.equal(byId.get("telegram")?.isConfigured, false);
  assert.deepEqual(byId.get("telegram")?.missingEnvVars, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);

  assert.equal(byId.get("slack")?.isEnabled, true); // env default
  assert.equal(byId.get("slack")?.hasOverride, false);
  assert.equal(byId.get("ollama")?.isEnabled, false);
  assert.equal(byId.get("ollama")?.isConfigured, true); // keyless
});

test("configOverlay satisfies a requirement the environment is missing", async () => {
  const store = createMemoryStateStore(
    state([
      {
        pluginId: "telegram",
        isEnabled: true,
        configOverlay: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" },
      },
    ])
  );
  const telegram = (await listPlugins({ store, env: BARE })).find((p) => p.manifest.id === "telegram");
  assert.equal(telegram?.isConfigured, true);
  assert.deepEqual(telegram?.missingEnvVars, []);
});

test("a failing store degrades to env-only instead of throwing", async () => {
  const broken: PluginStateStore = {
    async list() {
      throw new Error('relation "installed_plugins" does not exist');
    },
    async upsert() {
      throw new Error("unreachable");
    },
  };
  const plugins = await listPlugins({ store: broken, env: BARE });
  assert.equal(plugins.find((p) => p.manifest.id === "slack")?.isEnabled, true);
});

// ─── Registry integration ────────────────────────────────────────────────────

test("resolveNotificationPlugins instantiates the resolved set with its overlay", async () => {
  const store = createMemoryStateStore(
    state([
      { pluginId: "slack", isEnabled: false },
      { pluginId: "telegram", isEnabled: true, configOverlay: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" } },
    ])
  );
  const plugins = await resolveNotificationPlugins({ store, env: BARE });
  assert.deepEqual(plugins.map((plugin) => plugin.name), ["telegram"]);
  assert.equal(plugins[0].isConfigured(), true);
});

test("resolveAIChain preserves priority order", async () => {
  const store = createMemoryStateStore(state([{ pluginId: "ollama", isEnabled: true }]));
  const chain = await resolveAIChain({ store, env: { AI_PROVIDER: "anthropic,openai" } });
  assert.deepEqual(chain.map((plugin) => plugin.name), ["anthropic", "openai", "ollama"]);
});

test("notifyViaMarketplace fans out only to marketplace-enabled transports", async () => {
  const calls: string[] = [];
  const store = createMemoryStateStore(
    state([
      { pluginId: "slack", isEnabled: false },
      {
        pluginId: "telegram",
        isEnabled: true,
        configOverlay: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" },
      },
    ])
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;

  try {
    const results = await notifyViaMarketplace("שלום", undefined, { store, env: BARE });
    assert.deepEqual(results, [{ plugin: "telegram", ok: true }]);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /api\.telegram\.org/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateTextViaMarketplace surfaces every skipped provider when none can run", async () => {
  const store = createMemoryStateStore(state([{ pluginId: "anthropic", isEnabled: false }]));
  await assert.rejects(
    () => generateTextViaMarketplace({ prompt: "hi" }, { store, env: { AI_PROVIDER: "anthropic,openai" } }),
    /openai: not configured/
  );
});

// ─── Prisma store adapter ────────────────────────────────────────────────────

test("prisma store coerces the Json column and preserves the overlay on toggle", async () => {
  const upserts: Record<string, unknown>[] = [];
  const store = createPrismaPluginStateStore({
    installedPlugin: {
      async findMany() {
        return [
          // A hand-edited row: non-string values are dropped, not stringified.
          { pluginId: "slack", isEnabled: true, configOverlay: { A: "1", B: 2 }, updatedAt: new Date(0) },
          { pluginId: "ollama", isEnabled: false, configOverlay: null, updatedAt: new Date(0) },
        ];
      },
      async upsert(args: unknown) {
        upserts.push(args as Record<string, unknown>);
        return { pluginId: "slack", isEnabled: false, configOverlay: {}, updatedAt: new Date(0) };
      },
    },
  });

  const rows = await store.list();
  assert.deepEqual(rows[0].configOverlay, { A: "1" });
  assert.deepEqual(rows[1].configOverlay, {});

  await store.upsert({ pluginId: "slack", isEnabled: false });
  assert.deepEqual((upserts[0] as { update: unknown }).update, { isEnabled: false });
});

// ─── Telegram rendering ──────────────────────────────────────────────────────

test("formatPlugins groups by category and never echoes secret values", async () => {
  const store = createMemoryStateStore(state([{ pluginId: "telegram", isEnabled: true }]));
  const text = formatPlugins(await listPlugins({ store, env: BARE }));

  assert.match(text, /🧩 שוק התוספים/);
  assert.match(text, /🟢 פעיל Telegram \[telegram\] \(override\)/);
  assert.match(text, /⚠️ חסר: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID/);
  assert.match(text, /⚪ כבוי Ollama \[ollama\]/);
  assert.match(text, /— התראות —[\s\S]*— ספקי AI —/);
});

test("formatPlugins handles an empty catalog view", () => {
  assert.equal(formatPlugins([]), "אין תוספים בקטלוג.");
});
