import { notify, parseProviders as parseNotificationProviders } from "../notifications";
import type { NotificationMetadata, NotificationPlugin, NotificationResult } from "../notifications/types";
import { generateText, parseProviders as parseAIProviders } from "../ai";
import type { AIGenerateOptions, AIGenerateResult, AIProviderPlugin } from "../ai/types";
import { getManifest, instantiate, listManifests } from "./catalog";
import type {
  InstalledPluginState,
  PluginCategory,
  PluginEnv,
  PluginStateStore,
  PluginStatus,
} from "./types";

/**
 * Marketplace service — resolves "which plugins are on, with what config" and
 * feeds the answer to the existing registries.
 *
 * Precedence: a DB row for a plugin is authoritative for its enabled/disabled
 * state; with no row, the env var (`NOTIFICATION_PROVIDER` / `AI_PROVIDER`)
 * decides. Env therefore remains the deployment default and the DB is a
 * deliberate, auditable override — not a second source of truth that silently
 * diverges on a fresh environment where the table is empty.
 */

export interface ResolveOptions {
  store?: PluginStateStore;
  env?: PluginEnv;
}

/** In-memory store. The test double, and the fallback when no DB store is wired. */
export function createMemoryStateStore(seed: InstalledPluginState[] = []): PluginStateStore {
  const rows = new Map(seed.map((row) => [row.pluginId, { ...row }]));
  return {
    async list() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
    async upsert({ pluginId, isEnabled, configOverlay }) {
      const existing = rows.get(pluginId);
      const row: InstalledPluginState = {
        pluginId,
        isEnabled,
        configOverlay: configOverlay ?? existing?.configOverlay ?? {},
        // Stamped by the caller's clock, mirroring what `@updatedAt` would do.
        updatedAt: new Date(),
      };
      rows.set(pluginId, row);
      return { ...row };
    },
  };
}

/**
 * Read state, tolerating a store that cannot answer.
 *
 * The `installed_plugins` table is a proposed migration (see prisma/schema.prisma)
 * and may not exist yet in a given environment. A marketplace read failure must
 * degrade to env-only behaviour: notifications and AI generation are load-bearing,
 * and a missing config table is not a reason to take them down.
 */
async function readState(store?: PluginStateStore): Promise<Map<string, InstalledPluginState>> {
  if (!store) return new Map();
  try {
    const rows = await store.list();
    return new Map(rows.map((row) => [row.pluginId, row]));
  } catch {
    return new Map();
  }
}

function envDefaults(category: PluginCategory, env: PluginEnv): string[] {
  return category === "notification"
    ? parseNotificationProviders(env.NOTIFICATION_PROVIDER)
    : parseAIProviders(env.AI_PROVIDER);
}

/**
 * Resolved plugin ids for a category, in priority order.
 *
 * Env order is preserved (it is the AI fallback chain), then DB-enabled plugins
 * absent from the env list are appended. A DB row with `isEnabled: false`
 * removes the plugin even if the env var names it.
 */
export function resolveEnabledIds(
  category: PluginCategory,
  state: Map<string, InstalledPluginState>,
  env: PluginEnv
): string[] {
  const fromEnv = envDefaults(category, env).filter((id) => state.get(id)?.isEnabled !== false);

  const fromDb = listManifests(category)
    .map((manifest) => manifest.id)
    .filter((id) => state.get(id)?.isEnabled === true && !fromEnv.includes(id));

  return [...fromEnv, ...fromDb];
}

/** `process.env` with the plugin's persisted overrides layered on top. */
function overlaidEnv(
  pluginId: string,
  state: Map<string, InstalledPluginState>,
  env: PluginEnv
): PluginEnv {
  const overlay = state.get(pluginId)?.configOverlay;
  return overlay && Object.keys(overlay).length ? { ...env, ...overlay } : env;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Every catalog plugin with its resolved state. The `/plugins` and UI feed. */
export async function listPlugins(options: ResolveOptions = {}): Promise<PluginStatus[]> {
  const env = options.env ?? process.env;
  const state = await readState(options.store);

  const enabledByCategory = new Map<PluginCategory, string[]>([
    ["notification", resolveEnabledIds("notification", state, env)],
    ["ai", resolveEnabledIds("ai", state, env)],
  ]);

  return listManifests().map((manifest) => {
    const pluginEnv = overlaidEnv(manifest.id, state, env);
    const missingEnvVars = manifest.requiredEnvVars.filter((key) => !pluginEnv[key]);
    return {
      manifest,
      isEnabled: (enabledByCategory.get(manifest.category) ?? []).includes(manifest.id),
      missingEnvVars,
      isConfigured: missingEnvVars.length === 0,
      hasOverride: state.has(manifest.id),
    };
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Turn a plugin on, optionally replacing its config overlay.
 *
 * Unknown ids throw: enabling a plugin that does not exist is a caller bug, and
 * writing the row anyway would leave a permanent dangling override.
 */
export async function enablePlugin(
  pluginId: string,
  options: ResolveOptions & { configOverlay?: Record<string, string> } = {}
): Promise<InstalledPluginState> {
  const store = requireStore(options.store, pluginId);
  return store.upsert({ pluginId, isEnabled: true, configOverlay: options.configOverlay });
}

export async function disablePlugin(
  pluginId: string,
  options: ResolveOptions = {}
): Promise<InstalledPluginState> {
  const store = requireStore(options.store, pluginId);
  return store.upsert({ pluginId, isEnabled: false });
}

function requireStore(store: PluginStateStore | undefined, pluginId: string): PluginStateStore {
  if (!getManifest(pluginId)) throw new Error(`Unknown plugin: ${pluginId}`);
  if (!store) throw new Error("A PluginStateStore is required to change plugin state");
  return store;
}

// ─── Registry integration ────────────────────────────────────────────────────

export async function resolveNotificationPlugins(
  options: ResolveOptions = {}
): Promise<NotificationPlugin[]> {
  const env = options.env ?? process.env;
  const state = await readState(options.store);
  return resolveEnabledIds("notification", state, env)
    .map((id) => instantiate(id, overlaidEnv(id, state, env)) as NotificationPlugin | null)
    .filter((plugin): plugin is NotificationPlugin => plugin !== null);
}

export async function resolveAIChain(options: ResolveOptions = {}): Promise<AIProviderPlugin[]> {
  const env = options.env ?? process.env;
  const state = await readState(options.store);
  return resolveEnabledIds("ai", state, env)
    .map((id) => instantiate(id, overlaidEnv(id, state, env)) as AIProviderPlugin | null)
    .filter((plugin): plugin is AIProviderPlugin => plugin !== null);
}

/**
 * `notify()` / `generateText()` with marketplace resolution in front.
 *
 * Dispatch, fan-out and fallback semantics stay in the existing registries —
 * these only decide *which* plugin instances go in, so there is exactly one
 * implementation of "try each provider until one succeeds".
 */
export async function notifyViaMarketplace(
  message: string,
  metadata?: NotificationMetadata,
  options: ResolveOptions = {}
): Promise<NotificationResult[]> {
  return notify(message, metadata, await resolveNotificationPlugins(options));
}

export async function generateTextViaMarketplace(
  generateOptions: AIGenerateOptions,
  options: ResolveOptions = {}
): Promise<AIGenerateResult> {
  return generateText(generateOptions, await resolveAIChain(options));
}
