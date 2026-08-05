import {
  errorDetail,
  streamLines,
  type AIGenerateOptions,
  type AIGenerateResult,
  type AIProviderPlugin,
} from "../types";

/**
 * OpenAI Chat Completions over plain `fetch` — no SDK dependency added.
 *
 * `OPENAI_BASE_URL` exists so any OpenAI-compatible gateway (Azure-style proxy,
 * OpenRouter, a self-hosted vLLM) works through this same plugin.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface OpenAIPluginEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export interface OpenAIPluginOptions {
  env?: OpenAIPluginEnv;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function createOpenAIPlugin(options: OpenAIPluginOptions = {}): AIProviderPlugin {
  const env = options.env ?? (process.env as OpenAIPluginEnv);
  const doFetch = options.fetchImpl ?? fetch;
  const apiKey = env.OPENAI_API_KEY || "";
  const baseUrl = (env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const defaultModel = env.OPENAI_MODEL || DEFAULT_MODEL;

  function request(opts: AIGenerateOptions, stream: boolean) {
    if (!apiKey) throw new Error("OpenAI plugin is not configured");
    const model = opts.model || defaultModel;

    const messages = [
      ...(opts.systemPrompt ? [{ role: "system", content: opts.systemPrompt }] : []),
      { role: "user", content: opts.prompt },
    ];

    return {
      model,
      call: doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: opts.signal,
        body: JSON.stringify({
          model,
          messages,
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
          ...(opts.maxTokens === undefined ? {} : { max_tokens: opts.maxTokens }),
          ...(stream ? { stream: true } : {}),
        }),
      }),
    };
  }

  return {
    name: "openai",

    isConfigured() {
      return Boolean(apiKey);
    },

    async generateText(opts: AIGenerateOptions): Promise<AIGenerateResult> {
      const { model, call } = request(opts, false);
      const res = await call;
      if (!res.ok) throw new Error(`OpenAI API error: ${await errorDetail(res)}`);

      const body = (await res.json()) as OpenAIResponse;
      return {
        text: body.choices?.[0]?.message?.content ?? "",
        usage: body.usage
          ? {
              inputTokens: body.usage.prompt_tokens ?? 0,
              outputTokens: body.usage.completion_tokens ?? 0,
            }
          : undefined,
        providerName: "openai",
        modelUsed: model,
      };
    },

    async *generateStream(opts: AIGenerateOptions): AsyncIterable<string> {
      const { call } = request(opts, true);
      const res = await call;
      if (!res.ok) throw new Error(`OpenAI API error: ${await errorDetail(res)}`);

      for await (const line of streamLines(res.body)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}
