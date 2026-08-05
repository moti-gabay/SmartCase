import {
  errorDetail,
  streamLines,
  type AIGenerateOptions,
  type AIGenerateResult,
  type AIProviderPlugin,
} from "../types";

/**
 * Local Ollama over its native `/api/generate` endpoint.
 *
 * There is no API key, so `isConfigured` is true whenever a base URL exists —
 * which it always does, given the localhost default. A local daemon that is not
 * running surfaces as a connection error from `generateText`, and the registry
 * fails over from there; pretending it is "not configured" would hide the cause.
 */

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.1";

export interface OllamaPluginEnv {
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
}

export interface OllamaPluginOptions {
  env?: OllamaPluginEnv;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

type OllamaResponse = {
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

export function createOllamaPlugin(options: OllamaPluginOptions = {}): AIProviderPlugin {
  const env = options.env ?? (process.env as OllamaPluginEnv);
  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = (env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const defaultModel = env.OLLAMA_MODEL || DEFAULT_MODEL;

  function request(opts: AIGenerateOptions, stream: boolean) {
    const model = opts.model || defaultModel;

    return {
      model,
      call: doFetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: opts.signal,
        body: JSON.stringify({
          model,
          prompt: opts.prompt,
          ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
          stream,
          options: {
            ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
            ...(opts.maxTokens === undefined ? {} : { num_predict: opts.maxTokens }),
          },
        }),
      }),
    };
  }

  return {
    name: "ollama",

    isConfigured() {
      return Boolean(baseUrl);
    },

    async generateText(opts: AIGenerateOptions): Promise<AIGenerateResult> {
      const { model, call } = request(opts, false);
      const res = await call;
      if (!res.ok) throw new Error(`Ollama API error: ${await errorDetail(res)}`);

      const body = (await res.json()) as OllamaResponse;
      const hasUsage = body.prompt_eval_count !== undefined || body.eval_count !== undefined;

      return {
        text: body.response ?? "",
        usage: hasUsage
          ? { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 }
          : undefined,
        providerName: "ollama",
        modelUsed: model,
      };
    },

    async *generateStream(opts: AIGenerateOptions): AsyncIterable<string> {
      const { call } = request(opts, true);
      const res = await call;
      if (!res.ok) throw new Error(`Ollama API error: ${await errorDetail(res)}`);

      // NDJSON rather than SSE: one bare JSON object per line, `done: true` last.
      for await (const line of streamLines(res.body)) {
        const event = JSON.parse(line) as { response?: string; done?: boolean };
        if (event.response) yield event.response;
        if (event.done) break;
      }
    },
  };
}
