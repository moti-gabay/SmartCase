import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlackPlugin } from "../src/lib/plugins/notifications/slack-plugin";
import { createTelegramPlugin } from "../src/lib/plugins/notifications/telegram-plugin";
import { formatMetadata } from "../src/lib/plugins/notifications/types";
import { notify, parseProviders } from "../src/lib/plugins/notifications";
import type { NotificationPlugin } from "../src/lib/plugins/notifications/types";

type Call = { url: string; init?: RequestInit };

/** Minimal fetch double: records calls, replies with the queued response. */
function stubFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body ?? { ok: response.ok },
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

test("formatMetadata renders key: value lines and drops null/undefined", () => {
  assert.equal(formatMetadata(), "");
  assert.equal(formatMetadata({}), "");
  assert.equal(formatMetadata({ a: "1", b: undefined, c: null }), "a: 1");
  assert.equal(formatMetadata({ n: 3 }), "n: 3");
});

test("slack plugin prefers the webhook over the bot token", async () => {
  const { impl, calls } = stubFetch({ ok: true });
  const plugin = createSlackPlugin({
    env: { SLACK_WEBHOOK_URL: "https://hooks.example/x", SLACK_BOT_TOKEN: "t", SLACK_NOTIFY_CHANNEL: "C1" },
    fetchImpl: impl,
  });

  assert.equal(plugin.name, "slack");
  assert.equal(plugin.isConfigured(), true);
  await plugin.sendNotification("שלום", { branch: "main" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.example/x");
  assert.match(String(body(calls[0]).text), /שלום[\s\S]*branch: main/);
});

test("slack CI webhook wins over the general webhook", async () => {
  const { impl, calls } = stubFetch({ ok: true });
  await createSlackPlugin({
    env: { SLACK_CI_WEBHOOK_URL: "https://hooks.example/ci", SLACK_WEBHOOK_URL: "https://hooks.example/x" },
    fetchImpl: impl,
  }).sendNotification("hi");
  assert.equal(calls[0].url, "https://hooks.example/ci");
});

test("slack bot-token path posts to chat.postMessage with the channel", async () => {
  const { impl, calls } = stubFetch({ ok: true, body: { ok: true } });
  await createSlackPlugin({
    env: { SLACK_BOT_TOKEN: "xoxb-1", SLACK_NOTIFY_CHANNEL: "C0BJ" },
    fetchImpl: impl,
  }).sendNotification("hi");

  assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
  assert.equal(body(calls[0]).channel, "C0BJ");
});

test("slack treats HTTP 200 with ok:false as a failure", async () => {
  const { impl } = stubFetch({ ok: true, body: { ok: false, error: "invalid_auth" } });
  const plugin = createSlackPlugin({
    env: { SLACK_BOT_TOKEN: "xoxb-1", SLACK_NOTIFY_CHANNEL: "C1" },
    fetchImpl: impl,
  });
  await assert.rejects(plugin.sendNotification("hi"), /invalid_auth/);
});

test("slack is unconfigured without a webhook or a token+channel pair", () => {
  assert.equal(createSlackPlugin({ env: {} }).isConfigured(), false);
  assert.equal(createSlackPlugin({ env: { SLACK_BOT_TOKEN: "t" } }).isConfigured(), false);
});

test("telegram posts to the Bot API sendMessage endpoint", async () => {
  const { impl, calls } = stubFetch({ ok: true, body: { ok: true } });
  const plugin = createTelegramPlugin({
    env: { TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "-100" },
    fetchImpl: impl,
  });

  assert.equal(plugin.name, "telegram");
  assert.equal(plugin.isConfigured(), true);
  await plugin.sendNotification("עדכון", { case: "C-1" });

  assert.equal(calls[0].url, "https://api.telegram.org/bot123:ABC/sendMessage");
  const payload = body(calls[0]);
  assert.equal(payload.chat_id, "-100");
  assert.match(String(payload.text), /עדכון[\s\S]*case: C-1/);
});

test("telegram surfaces the API description on failure", async () => {
  const { impl } = stubFetch({ ok: false, status: 400, body: { ok: false, description: "chat not found" } });
  const plugin = createTelegramPlugin({
    env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" },
    fetchImpl: impl,
  });
  await assert.rejects(plugin.sendNotification("hi"), /chat not found/);
});

test("telegram is unconfigured when either secret is missing", () => {
  assert.equal(createTelegramPlugin({ env: { TELEGRAM_BOT_TOKEN: "t" } }).isConfigured(), false);
  assert.equal(createTelegramPlugin({ env: { TELEGRAM_CHAT_ID: "1" } }).isConfigured(), false);
});

test("parseProviders: default, all, none, list, and unknown names", () => {
  assert.deepEqual(parseProviders(undefined), ["slack"]);
  assert.deepEqual(parseProviders(""), ["slack"]);
  assert.deepEqual(parseProviders("none"), []);
  assert.deepEqual(parseProviders("all").sort(), ["slack", "telegram"]);
  assert.deepEqual(parseProviders("telegram"), ["telegram"]);
  assert.deepEqual(parseProviders(" SLACK , telegram "), ["slack", "telegram"]);
  assert.deepEqual(parseProviders("carrier-pigeon"), []);
});

function fakePlugin(name: string, behaviour: "ok" | "throw" | "unconfigured"): NotificationPlugin {
  return {
    name,
    isConfigured: () => behaviour !== "unconfigured",
    async sendNotification() {
      if (behaviour === "throw") throw new Error("boom");
    },
  };
}

test("notify reports per-plugin outcomes and never throws", async () => {
  const results = await notify("hi", undefined, [
    fakePlugin("a", "ok"),
    fakePlugin("b", "throw"),
    fakePlugin("c", "unconfigured"),
  ]);

  assert.deepEqual(results, [
    { plugin: "a", ok: true },
    { plugin: "b", ok: false, error: "boom" },
    { plugin: "c", ok: false, error: "not configured" },
  ]);
});

test("notify with no active plugins is a no-op", async () => {
  assert.deepEqual(await notify("hi", undefined, []), []);
});
