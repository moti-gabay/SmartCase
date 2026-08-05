import { createSlackPlugin } from "./slack-plugin";
import { createTelegramPlugin } from "./telegram-plugin";
import type { NotificationMetadata, NotificationPlugin, NotificationResult } from "./types";

export type { NotificationMetadata, NotificationPlugin, NotificationResult } from "./types";
export { createSlackPlugin } from "./slack-plugin";
export { createTelegramPlugin } from "./telegram-plugin";

/**
 * Notification registry.
 *
 * `NOTIFICATION_PROVIDER` selects the active transports: a single plugin name,
 * a comma-separated list, `all`, or `none`. Unset defaults to `slack` so the
 * existing behaviour is preserved for any deployment that has not set the var.
 */

type PluginFactory = () => NotificationPlugin;

const FACTORIES: Record<string, PluginFactory> = {
  slack: () => createSlackPlugin(),
  telegram: () => createTelegramPlugin(),
};

export function parseProviders(raw?: string): string[] {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return ["slack"];
  if (value === "none") return [];
  if (value === "all") return Object.keys(FACTORIES);
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry in FACTORIES);
}

/**
 * Plugins selected by config. Not filtered by `isConfigured` — a selected but
 * unconfigured transport is a deployment mistake worth surfacing in results,
 * not something to hide by silently returning an empty list.
 */
export function getActivePlugins(env: NodeJS.ProcessEnv = process.env): NotificationPlugin[] {
  return parseProviders(env.NOTIFICATION_PROVIDER).map((name) => FACTORIES[name]());
}

/**
 * Fan out to every active plugin and report per-plugin outcomes.
 *
 * Never throws: notifications are a side channel, and a Telegram outage must not
 * fail the business operation that triggered the message. Callers that care
 * about delivery inspect the returned results.
 */
export async function notify(
  message: string,
  metadata?: NotificationMetadata,
  plugins: NotificationPlugin[] = getActivePlugins()
): Promise<NotificationResult[]> {
  return Promise.all(
    plugins.map(async (plugin): Promise<NotificationResult> => {
      if (!plugin.isConfigured()) {
        return { plugin: plugin.name, ok: false, error: "not configured" };
      }
      try {
        await plugin.sendNotification(message, metadata);
        return { plugin: plugin.name, ok: true };
      } catch (error) {
        return {
          plugin: plugin.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
}
