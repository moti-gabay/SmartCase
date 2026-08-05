import { createAnthropicPlugin } from "./providers/anthropic-plugin";
import { createOllamaPlugin } from "./providers/ollama-plugin";
import { createOpenAIPlugin } from "./providers/openai-plugin";
import type { AIGenerateOptions, AIGenerateResult, AIProviderPlugin } from "./types";

export type { AIGenerateOptions, AIGenerateResult, AIProviderPlugin } from "./types";
export { createAnthropicPlugin } from "./providers/anthropic-plugin";
export { createOllamaPlugin } from "./providers/ollama-plugin";
export { createOpenAIPlugin } from "./providers/openai-plugin";

/**
 * AI provider registry and fallback manager.
 *
 * `AI_PROVIDER` selects the chain: a single plugin name or a comma-separated
 * priority list (`anthropic,openai`). Unset defaults to `anthropic`. Unknown
 * names are dropped rather than throwing — a typo must not take the app down at
 * import time, and an empty chain fails loudly on the first call instead.
 */

type PluginFactory = () => AIProviderPlugin;

const FACTORIES: Record<string, PluginFactory> = {
  anthropic: () => createAnthropicPlugin(),
  openai: () => createOpenAIPlugin(),
  ollama: () => createOllamaPlugin(),
};

export function parseProviders(raw?: string): string[] {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return ["anthropic"];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry in FACTORIES);
}

/** The configured chain, in priority order. */
export function getProviderChain(env: NodeJS.ProcessEnv = process.env): AIProviderPlugin[] {
  return parseProviders(env.AI_PROVIDER).map((name) => FACTORIES[name]());
}

/**
 * Generate text through the first provider that succeeds.
 *
 * Unconfigured providers are skipped without an attempt; a provider that throws
 * is recorded and the next one is tried. If nothing succeeds the error names
 * every provider and why it failed — a bare "all providers failed" is useless
 * when the cause is one missing key and one 429.
 */
export async function generateText(
  options: AIGenerateOptions,
  plugins: AIProviderPlugin[] = getProviderChain()
): Promise<AIGenerateResult> {
  const failures: string[] = [];

  for (const plugin of plugins) {
    if (!plugin.isConfigured()) {
      failures.push(`${plugin.name}: not configured`);
      continue;
    }
    try {
      return await plugin.generateText(options);
    } catch (error) {
      failures.push(`${plugin.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    failures.length
      ? `All AI providers failed — ${failures.join("; ")}`
      : "No AI provider is configured (check AI_PROVIDER)"
  );
}
