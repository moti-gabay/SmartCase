import { formatMetadata, type NotificationMetadata, type NotificationPlugin } from "./types";

/**
 * Slack transport.
 *
 * Mirrors the precedence already used by the session-summary hook
 * (.claude/hooks/session-summary.sh): an incoming webhook wins, and a bot token
 * plus channel is the fallback. Kept in that order deliberately — a webhook is
 * bound to its channel at creation time, so it is the narrower credential.
 */

export interface SlackPluginEnv {
  SLACK_CI_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CI_CHANNEL?: string;
  SLACK_NOTIFY_CHANNEL?: string;
}

export interface SlackPluginOptions {
  env?: SlackPluginEnv;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

export function createSlackPlugin(options: SlackPluginOptions = {}): NotificationPlugin {
  const env = options.env ?? (process.env as SlackPluginEnv);
  const doFetch = options.fetchImpl ?? fetch;

  const webhook = env.SLACK_CI_WEBHOOK_URL || env.SLACK_WEBHOOK_URL || "";
  const token = env.SLACK_BOT_TOKEN || "";
  const channel = env.SLACK_CI_CHANNEL || env.SLACK_NOTIFY_CHANNEL || "";

  return {
    name: "slack",

    isConfigured() {
      return Boolean(webhook) || Boolean(token && channel);
    },

    async sendNotification(message: string, metadata?: NotificationMetadata) {
      const details = formatMetadata(metadata);
      const text = details ? `${message}\n\`\`\`\n${details}\n\`\`\`` : message;

      if (webhook) {
        const res = await doFetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
        return;
      }

      if (!token || !channel) throw new Error("Slack plugin is not configured");

      const res = await doFetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel, text }),
      });
      if (!res.ok) throw new Error(`Slack API failed: ${res.status}`);

      // chat.postMessage returns HTTP 200 with `ok: false` on auth/scope errors,
      // so the status code alone is not a success signal.
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!body.ok) throw new Error(`Slack API error: ${body.error ?? "unknown"}`);
    },
  };
}
