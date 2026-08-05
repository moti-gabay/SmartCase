import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicPlugin } from "../src/lib/plugins/ai/providers/anthropic-plugin";
import { createOpenAIPlugin } from "../src/lib/plugins/ai/providers/openai-plugin";
import { createOllamaPlugin } from "../src/lib/plugins/ai/providers/ollama-plugin";
import { generateText, getProviderChain, parseProviders } from "../src/lib/plugins/ai";
import type { AIProviderPlugin } from "../src/lib/plugins/ai/types";

type Call = { url: string; init?: RequestInit };

/** Minimal fetch double: records calls, replies with the queued JSON response. */
function stubFetch(response: { ok: boolean; status?: number; body?: unknown; text?: string }) {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body ?? {},
      text: async () => response.text ?? JSON.stringify(response.body ?? {}),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Fetch double whose body streams `chunks` — deliberately split mid-line. */
function stubStreamFetch(chunks: string[]) {
  const encoder = new TextEncoder();
  const impl = (async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  })) as unknown as typeof fetch;
  return impl;
}

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

/** Plugin double with scripted outcomes, for registry-level tests. */
function fakePlugin(
  name: string,
  behaviour: { configured?: boolean; fail?: string }
): AIProviderPlugin & { attempts: number } {
  return {
    name,
    attempts: 0,
    isConfigured: () => behaviour.configured !== false,
    async generateText() {
      (this as { attempts: number }).attempts += 1;
      if (behaviour.fail) throw new Error(behaviour.fail);
      return { text: `from ${name}`, providerName: name, modelUsed: `${name}-model` };
    },
  };
}

// --- configuration -------------------------------------------------------

test("plugins report configuration from their env", () => {
  assert.equal(createAnthropicPlugin({ env: {} }).isConfigured(), false);
  assert.equal(createAnthropicPlugin({ env: { ANTHROPIC_API_KEY: "sk-a" } }).isConfigured(), true);
  assert.equal(createOpenAIPlugin({ env: {} }).isConfigured(), false);
  assert.equal(createOpenAIPlugin({ env: { OPENAI_API_KEY: "sk-o" } }).isConfigured(), true);
  // Ollama needs no key — the localhost default always yields a base URL.
  assert.equal(createOllamaPlugin({ env: {} }).isConfigured(), true);
});

test("unconfigured plugins reject instead of calling out", async () => {
  const { impl, calls } = stubFetch({ ok: true });
  await assert.rejects(
    createAnthropicPlugin({ env: {}, fetchImpl: impl }).generateText({ prompt: "hi" }),
    /not configured/
  );
  await assert.rejects(
    createOpenAIPlugin({ env: {}, fetchImpl: impl }).generateText({ prompt: "hi" }),
    /not configured/
  );
  assert.equal(calls.length, 0);
});

// --- anthropic -----------------------------------------------------------

test("anthropic sends system/max_tokens and joins text blocks", async () => {
  const { impl, calls } = stubFetch({
    ok: true,
    body: {
      content: [
        { type: "text", text: "שלום " },
        { type: "text", text: "עולם" },
      ],
      usage: { input_tokens: 11, output_tokens: 4 },
    },
  });

  const result = await createAnthropicPlugin({
    env: { ANTHROPIC_API_KEY: "sk-a" },
    fetchImpl: impl,
  }).generateText({ prompt: "כתוב", systemPrompt: "עברית", temperature: 0.2, maxTokens: 64 });

  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "sk-a");
  const sent = body(calls[0]);
  assert.equal(sent.system, "עברית");
  assert.equal(sent.max_tokens, 64);
  assert.equal(sent.model, "claude-sonnet-5");
  assert.deepEqual(sent.messages, [{ role: "user", content: "כתוב" }]);

  assert.equal(result.text, "שלום עולם");
  assert.equal(result.providerName, "anthropic");
  assert.equal(result.modelUsed, "claude-sonnet-5");
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 4 });
});

test("anthropic honours model override and surfaces API errors", async () => {
  const { impl, calls } = stubFetch({ ok: true, body: { content: [] } });
  await createAnthropicPlugin({ env: { ANTHROPIC_API_KEY: "sk-a" }, fetchImpl: impl }).generateText({
    prompt: "x",
    model: "claude-opus-5",
  });
  assert.equal(body(calls[0]).model, "claude-opus-5");

  const failing = stubFetch({ ok: false, status: 429, text: "rate limited" });
  await assert.rejects(
    createAnthropicPlugin({ env: { ANTHROPIC_API_KEY: "sk-a" }, fetchImpl: failing.impl }).generateText({
      prompt: "x",
    }),
    /Anthropic API error: 429 rate limited/
  );
});

test("anthropic streams content_block_delta text across split chunks", async () => {
  const plugin = createAnthropicPlugin({
    env: { ANTHROPIC_API_KEY: "sk-a" },
    fetchImpl: stubStreamFetch([
      'event: message_start\ndata: {"type":"message_start"}\n\ndata: {"type":"content_block_delta","delta":{"te',
      'xt":"של"}}\n\ndata: {"type":"content_block_delta","delta":{"text":"ום"}}\n\ndata: {"type":"message_stop"}\n',
    ]),
  });

  const chunks: string[] = [];
  for await (const chunk of plugin.generateStream!({ prompt: "x" })) chunks.push(chunk);
  assert.deepEqual(chunks, ["של", "ום"]);
});

// --- openai --------------------------------------------------------------

test("openai maps system prompt to a message and parses the choice", async () => {
  const { impl, calls } = stubFetch({
    ok: true,
    body: {
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 7, completion_tokens: 2 },
    },
  });

  const result = await createOpenAIPlugin({
    env: { OPENAI_API_KEY: "sk-o", OPENAI_MODEL: "gpt-4.1-mini" },
    fetchImpl: impl,
  }).generateText({ prompt: "hi", systemPrompt: "be terse", maxTokens: 32 });

  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer sk-o");
  const sent = body(calls[0]);
  assert.deepEqual(sent.messages, [
    { role: "system", content: "be terse" },
    { role: "user", content: "hi" },
  ]);
  assert.equal(sent.max_tokens, 32);

  assert.equal(result.text, "hello");
  assert.equal(result.modelUsed, "gpt-4.1-mini");
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 2 });
});

test("openai respects a custom base url and trims its trailing slash", async () => {
  const { impl, calls } = stubFetch({ ok: true, body: { choices: [] } });
  const result = await createOpenAIPlugin({
    env: { OPENAI_API_KEY: "sk-o", OPENAI_BASE_URL: "https://gateway.example/v1/" },
    fetchImpl: impl,
  }).generateText({ prompt: "hi" });

  assert.equal(calls[0].url, "https://gateway.example/v1/chat/completions");
  assert.equal(result.text, "");
  assert.equal(result.usage, undefined);
});

test("openai streaming stops cleanly at [DONE]", async () => {
  const plugin = createOpenAIPlugin({
    env: { OPENAI_API_KEY: "sk-o" },
    fetchImpl: stubStreamFetch([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n',
      'data: {"choices":[{"delta":{}}]}\ndata: {"choices":[{"delta":{"content":"b"}}]}\ndata: [DONE]\n',
    ]),
  });

  const chunks: string[] = [];
  for await (const chunk of plugin.generateStream!({ prompt: "x" })) chunks.push(chunk);
  assert.deepEqual(chunks, ["a", "b"]);
});

// --- ollama --------------------------------------------------------------

test("ollama posts to the local endpoint and maps eval counts to usage", async () => {
  const { impl, calls } = stubFetch({
    ok: true,
    body: { response: "local answer", prompt_eval_count: 5, eval_count: 9 },
  });

  const result = await createOllamaPlugin({ env: {}, fetchImpl: impl }).generateText({
    prompt: "hi",
    systemPrompt: "sys",
    temperature: 0.1,
    maxTokens: 50,
  });

  assert.equal(calls[0].url, "http://localhost:11434/api/generate");
  const sent = body(calls[0]);
  assert.equal(sent.stream, false);
  assert.equal(sent.system, "sys");
  assert.deepEqual(sent.options, { temperature: 0.1, num_predict: 50 });

  assert.equal(result.text, "local answer");
  assert.equal(result.modelUsed, "llama3.1");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 9 });
});

test("ollama uses OLLAMA_BASE_URL when set", async () => {
  const { impl, calls } = stubFetch({ ok: true, body: { response: "" } });
  await createOllamaPlugin({
    env: { OLLAMA_BASE_URL: "http://ollama.internal:11434/", OLLAMA_MODEL: "mistral" },
    fetchImpl: impl,
  }).generateText({ prompt: "hi" });

  assert.equal(calls[0].url, "http://ollama.internal:11434/api/generate");
  assert.equal(body(calls[0]).model, "mistral");
});

test("ollama streams NDJSON lines until done", async () => {
  const plugin = createOllamaPlugin({
    env: {},
    fetchImpl: stubStreamFetch([
      '{"response":"lo"}\n{"resp',
      'onse":"cal"}\n{"response":"","done":true}\n',
    ]),
  });

  const chunks: string[] = [];
  for await (const chunk of plugin.generateStream!({ prompt: "x" })) chunks.push(chunk);
  assert.deepEqual(chunks, ["lo", "cal"]);
});

// --- registry & fallback -------------------------------------------------

test("parseProviders defaults to anthropic and drops unknown names", () => {
  assert.deepEqual(parseProviders(undefined), ["anthropic"]);
  assert.deepEqual(parseProviders("  "), ["anthropic"]);
  assert.deepEqual(parseProviders("OpenAI"), ["openai"]);
  assert.deepEqual(parseProviders("anthropic, ollama"), ["anthropic", "ollama"]);
  assert.deepEqual(parseProviders("bogus"), []);
});

test("getProviderChain builds plugins in priority order", () => {
  const chain = getProviderChain({ AI_PROVIDER: "ollama,openai" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(chain.map((plugin) => plugin.name), ["ollama", "openai"]);
});

test("generateText falls back past a failing primary provider", async () => {
  const primary = fakePlugin("anthropic", { fail: "503 overloaded" });
  const secondary = fakePlugin("openai", {});

  const result = await generateText({ prompt: "hi" }, [primary, secondary]);

  assert.equal(result.text, "from openai");
  assert.equal(result.providerName, "openai");
  assert.equal(primary.attempts, 1);
  assert.equal(secondary.attempts, 1);
});

test("generateText skips unconfigured providers without attempting them", async () => {
  const skipped = fakePlugin("anthropic", { configured: false });
  const used = fakePlugin("ollama", {});

  const result = await generateText({ prompt: "hi" }, [skipped, used]);

  assert.equal(result.providerName, "ollama");
  assert.equal(skipped.attempts, 0);
});

test("generateText stops at the first success", async () => {
  const first = fakePlugin("anthropic", {});
  const second = fakePlugin("openai", {});

  await generateText({ prompt: "hi" }, [first, second]);
  assert.equal(second.attempts, 0);
});

test("generateText reports every provider failure when the chain is exhausted", async () => {
  await assert.rejects(
    generateText({ prompt: "hi" }, [
      fakePlugin("anthropic", { configured: false }),
      fakePlugin("openai", { fail: "401 bad key" }),
    ]),
    /anthropic: not configured; openai: 401 bad key/
  );
});

test("generateText fails loudly when the chain is empty", async () => {
  await assert.rejects(generateText({ prompt: "hi" }, []), /No AI provider is configured/);
});
