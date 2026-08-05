/**
 * Plugin marketplace contracts.
 *
 * The marketplace is a thin state layer *above* the existing notification and
 * AI registries: it decides which plugins are on and with what config, then
 * hands concrete plugin instances to `notify()` / `generateText()`. It never
 * reimplements dispatch — see ./service.ts.
 */

export type PluginCategory = "notification" | "ai";

/**
 * Environment a plugin is constructed against.
 *
 * Deliberately not `NodeJS.ProcessEnv`: Next augments that type with a required
 * `NODE_ENV`, which would make every overlaid/partial env object here a type
 * error. This is structurally what the plugin factories already accept.
 */
export type PluginEnv = Record<string, string | undefined>;

/**
 * Static, code-owned description of a plugin. Ships with the build; the DB only
 * ever stores state *about* a manifest, never a manifest itself — a marketplace
 * that could install arbitrary DB-defined plugins would be a remote code path
 * into a system holding medical and legal records.
 */
export interface PluginManifest {
  /** Stable id — must match the plugin's registry name (`slack`, `anthropic`, …). */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: PluginCategory;
  /** Env vars the plugin needs before it can run. Empty for keyless plugins (Ollama). */
  readonly requiredEnvVars: readonly string[];
  readonly version: string;
}

/**
 * Persisted per-plugin state. One row per plugin id.
 *
 * `configOverlay` holds env-var overrides applied on top of `process.env` when
 * the plugin is constructed — that is the whole runtime-configuration mechanism,
 * and it works because every existing factory already accepts an `env` object.
 */
export interface InstalledPluginState {
  pluginId: string;
  isEnabled: boolean;
  configOverlay: Record<string, string>;
  updatedAt: Date;
}

/** A manifest joined with its resolved runtime state. What the UI/bot renders. */
export interface PluginStatus {
  manifest: PluginManifest;
  isEnabled: boolean;
  /** Every `requiredEnvVars` entry is present (counting the overlay). */
  isConfigured: boolean;
  /** Required vars still missing. Empty when `isConfigured`. */
  missingEnvVars: string[];
  /** True when enablement came from a DB row rather than the env default. */
  hasOverride: boolean;
}

/**
 * Persistence port for marketplace state.
 *
 * An interface rather than a direct Prisma call so the service is testable
 * without a database, and so a missing table (the model is proposed, not yet
 * pushed — see prisma/schema.prisma) degrades to env-only behaviour instead of
 * taking notifications and AI down with it.
 */
export interface PluginStateStore {
  list(): Promise<InstalledPluginState[]>;
  upsert(state: Pick<InstalledPluginState, "pluginId" | "isEnabled"> & {
    configOverlay?: Record<string, string>;
  }): Promise<InstalledPluginState>;
}
