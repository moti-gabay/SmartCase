/**
 * Common contract for LLM text generation backends.
 *
 * Same shape as the notification plugins (see ../notifications/types.ts):
 * callers never name a vendor, they go through the registry in ./index.ts.
 * Adding a provider means adding a file under ./providers, not touching
 * application code.
 */

export interface AIGenerateOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  /** Upper bound on generated tokens. Anthropic requires one, so each plugin has a default. */
  maxTokens?: number;
  /** Overrides the plugin's default model id. */
  model?: string;
  /** Aborts an in-flight request; forwarded to `fetch`. */
  signal?: AbortSignal;
}

export interface AIGenerateResult {
  text: string;
  /** Absent when the provider does not report token counts. */
  usage?: { inputTokens: number; outputTokens: number };
  providerName: string;
  modelUsed: string;
}

export interface AIProviderPlugin {
  /** Stable identifier, also the value accepted by `AI_PROVIDER`. */
  readonly name: string;

  /**
   * True when the plugin has every secret it needs. The registry uses this to
   * skip an unconfigured provider and move to the next fallback instead of
   * burning an attempt on a request that cannot succeed.
   */
  isConfigured(): boolean;

  /**
   * Generate a completion. Rejects on transport or API failure; the registry
   * decides whether to fail over. Implementations must not swallow errors.
   */
  generateText(options: AIGenerateOptions): Promise<AIGenerateResult>;

  /** Incremental text chunks. Optional — not every backend is worth streaming. */
  generateStream?(options: AIGenerateOptions): AsyncIterable<string>;
}

/**
 * Read a `fetch` response body as newline-delimited chunks.
 *
 * All three providers stream line-oriented bodies (SSE for Anthropic/OpenAI,
 * NDJSON for Ollama), so the framing is shared and only the per-line parsing
 * differs. A partial line is held in `buffer` until its newline arrives —
 * network chunks split mid-line routinely and parsing one would drop a token.
 */
export async function* streamLines(body: Response["body"]): AsyncGenerator<string> {
  if (!body) throw new Error("Response has no body to stream");

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield line;
      }
    }
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Body text for a failed response, trimmed to keep provider errors loggable. */
export async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text ? `${res.status} ${text.slice(0, 500)}` : String(res.status);
}
