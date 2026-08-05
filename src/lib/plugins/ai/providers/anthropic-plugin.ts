import {
  errorDetail,
  streamLines,
  type AIGenerateOptions,
  type AIGenerateResult,
  type AIProviderPlugin,
} from "../types";

/**
 * Anthropic Messages API over plain `fetch` — no SDK dependency added.
 *
 * `max_tokens` is required by the API, hence the local default; `system` is a
 * top-level field rather than a message role.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 2048;

export interface AnthropicPluginEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

export interface AnthropicPluginOptions {
  env?: AnthropicPluginEnv;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function createAnthropicPlugin(options: AnthropicPluginOptions = {}): AIProviderPlugin {
  const env = options.env ?? (process.env as AnthropicPluginEnv);
  const doFetch = options.fetchImpl ?? fetch;
  const apiKey = env.ANTHROPIC_API_KEY || "";
  const defaultModel = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  function request(opts: AIGenerateOptions, stream: boolean) {
    if (!apiKey) throw new Error("Anthropic plugin is not configured");
    const model = opts.model || defaultModel;

    return {
      model,
      call: doFetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        signal: opts.signal,
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
          messages: [{ role: "user", content: opts.prompt }],
          ...(stream ? { stream: true } : {}),
        }),
      }),
    };
  }

  return {
    name: "anthropic",

    isConfigured() {
      return Boolean(apiKey);
    },

    async generateText(opts: AIGenerateOptions): Promise<AIGenerateResult> {
      const { model, call } = request(opts, false);
      const res = await call;
      if (!res.ok) throw new Error(`Anthropic API error: ${await errorDetail(res)}`);

      const body = (await res.json()) as AnthropicResponse;
      const text = (body.content ?? [])
        .filter((block) => block.type === "text" || typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("");

      return {
        text,
        usage: body.usage
          ? {
              inputTokens: body.usage.input_tokens ?? 0,
              outputTokens: body.usage.output_tokens ?? 0,
            }
          : undefined,
        providerName: "anthropic",
        modelUsed: model,
      };
    },

    async *generateStream(opts: AIGenerateOptions): AsyncIterable<string> {
      const { call } = request(opts, true);
      const res = await call;
      if (!res.ok) throw new Error(`Anthropic API error: ${await errorDetail(res)}`);

      // SSE: only `content_block_delta` events carry text; `event:` lines and
      // the lifecycle events (message_start, ping, …) are ignored.
      for await (const line of streamLines(res.body)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        const event = JSON.parse(payload) as { type?: string; delta?: { text?: string } };
        if (event.type === "content_block_delta" && event.delta?.text) yield event.delta.text;
      }
    },
  };
}
