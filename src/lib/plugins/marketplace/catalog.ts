import { createSlackPlugin } from "../notifications/slack-plugin";
import { createTelegramPlugin } from "../notifications/telegram-plugin";
import type { NotificationPlugin } from "../notifications/types";
import { createAnthropicPlugin } from "../ai/providers/anthropic-plugin";
import { createOllamaPlugin } from "../ai/providers/ollama-plugin";
import { createOpenAIPlugin } from "../ai/providers/openai-plugin";
import type { AIProviderPlugin } from "../ai/types";
import type { PluginCategory, PluginEnv, PluginManifest } from "./types";

/**
 * The catalog of every plugin this build ships.
 *
 * Each entry pairs a manifest with an env-taking factory. The factories are
 * duplicated from the two registries on purpose: the registries' own factories
 * are zero-arg (they read `process.env` directly), and the marketplace must be
 * able to construct a plugin against an overlaid env instead.
 */

type CatalogEntry = {
  manifest: PluginManifest;
  create: (env: PluginEnv) => NotificationPlugin | AIProviderPlugin;
};

const ENTRIES: readonly CatalogEntry[] = [
  {
    manifest: {
      id: "slack",
      name: "Slack",
      description: "התראות יוצאות לערוץ Slack דרך Webhook או Bot Token",
      category: "notification",
      // Either credential path satisfies the plugin, so neither is listed as
      // strictly required; `isConfigured()` on the instance is the real check.
      requiredEnvVars: [],
      version: "1.0.0",
    },
    create: (env) => createSlackPlugin({ env }),
  },
  {
    manifest: {
      id: "telegram",
      name: "Telegram",
      description: "התראות יוצאות לצ׳אט טלגרם דרך Bot API",
      category: "notification",
      requiredEnvVars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
      version: "1.0.0",
    },
    create: (env) => createTelegramPlugin({ env }),
  },
  {
    manifest: {
      id: "anthropic",
      name: "Anthropic Claude",
      description: "ספק AI ראשי — Messages API",
      category: "ai",
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
      version: "1.0.0",
    },
    create: (env) => createAnthropicPlugin({ env }),
  },
  {
    manifest: {
      id: "openai",
      name: "OpenAI",
      description: "ספק AI חלופי — Chat Completions (וכל שער תואם־OpenAI)",
      category: "ai",
      requiredEnvVars: ["OPENAI_API_KEY"],
      version: "1.0.0",
    },
    create: (env) => createOpenAIPlugin({ env }),
  },
  {
    manifest: {
      id: "ollama",
      name: "Ollama",
      description: "מודל מקומי — ללא מפתח API",
      category: "ai",
      requiredEnvVars: [],
      version: "1.0.0",
    },
    create: (env) => createOllamaPlugin({ env }),
  },
];

const BY_ID = new Map(ENTRIES.map((entry) => [entry.manifest.id, entry]));

export function listManifests(category?: PluginCategory): PluginManifest[] {
  return ENTRIES.filter((entry) => !category || entry.manifest.category === category).map(
    (entry) => entry.manifest
  );
}

export function getManifest(pluginId: string): PluginManifest | null {
  return BY_ID.get(pluginId)?.manifest ?? null;
}

export function isKnownPlugin(pluginId: string): boolean {
  return BY_ID.has(pluginId);
}

/**
 * Build a plugin instance against `env`. Returns null for an unknown id rather
 * than throwing — a stale DB row naming a removed plugin must not break the
 * whole resolve pass.
 */
export function instantiate(
  pluginId: string,
  env: PluginEnv
): NotificationPlugin | AIProviderPlugin | null {
  return BY_ID.get(pluginId)?.create(env) ?? null;
}
