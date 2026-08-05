import { formatMetadata, type NotificationMetadata, type NotificationPlugin } from "./types";

/**
 * Telegram transport over the plain Bot API — no SDK, one `fetch` per message.
 *
 * Messages are sent as plain text: the office writes Hebrew, and Telegram's
 * MarkdownV2 requires escaping ~18 ASCII characters or the API rejects the whole
 * request. Plain text has no such failure mode and renders RTL correctly.
 */

export interface TelegramPluginEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export interface TelegramPluginOptions {
  env?: TelegramPluginEnv;
  /** Injectable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

export function createTelegramPlugin(options: TelegramPluginOptions = {}): NotificationPlugin {
  const env = options.env ?? (process.env as TelegramPluginEnv);
  const doFetch = options.fetchImpl ?? fetch;

  const token = env.TELEGRAM_BOT_TOKEN || "";
  const chatId = env.TELEGRAM_CHAT_ID || "";

  return {
    name: "telegram",

    isConfigured() {
      return Boolean(token && chatId);
    },

    async sendNotification(message: string, metadata?: NotificationMetadata) {
      if (!token || !chatId) throw new Error("Telegram plugin is not configured");

      const details = formatMetadata(metadata);
      const text = details ? `${message}\n\n${details}` : message;

      const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });

      // The Bot API answers 4xx with a JSON body carrying the real reason, so
      // read it before deciding what to report.
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; description?: string }
        | null;
      if (!res.ok || !body?.ok) {
        throw new Error(`Telegram API error: ${body?.description ?? res.status}`);
      }
    },
  };
}
