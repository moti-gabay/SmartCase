// Inbound Telegram ingress — long-polling command daemon.
//
//   npm run telegram-daemon
//
// The owner sends a command or a free-text task from their Telegram chat; the
// daemon runs it and replies in the same chat. Long-polling (`getUpdates`) is
// used rather than a webhook on purpose: getUpdates is authenticated by the bot
// token itself, so there is no public endpoint that a forged update carrying the
// right chat_id could reach. Identity answers only "whose messages are obeyed" —
// every other control stays inside the command handlers, and message text
// reaches them as a plain string, never a shell.

import "dotenv/config";

import { createTelegramPlugin } from "../../src/lib/plugins/notifications";
import { disconnectPrisma, handleNaturalLanguage, runCommand } from "./commands";
import { extractMessage, isAuthorized, isKnownCommand, parseIntent, type TelegramUpdate } from "./guards";
import { formatError, formatUnknownCommand, truncateForTelegram } from "./responses";

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in the environment");
  process.exit(1);
}

if (!TELEGRAM_CHAT_ID) {
  // Fail closed. An unset chat id must never mean "obey every chat this bot can
  // see" — bots added to a group receive that group's messages.
  console.error(
    "TELEGRAM_CHAT_ID is empty — refusing to start.\n" +
      "Set it to the chat id whose messages this daemon should obey, e.g.\n" +
      "  TELEGRAM_CHAT_ID=123456789"
  );
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const POLL_TIMEOUT_SECONDS = 30;

/** Outbound replies reuse the existing notification plugin — one transport, one place. */
const outbound = createTelegramPlugin();

async function reply(text: string): Promise<void> {
  try {
    await outbound.sendNotification(truncateForTelegram(text));
  } catch (error) {
    console.error(`[reply failed] ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fetch the next batch. `offset` is the acknowledgement mechanism: passing
 * `lastUpdateId + 1` is what tells Telegram the previous batch was handled, so
 * it must only advance after an update has been processed — otherwise a crash
 * mid-command silently drops it.
 */
async function getUpdates(offset: number): Promise<TelegramUpdate[]> {
  const url = `${API}/getUpdates?timeout=${POLL_TIMEOUT_SECONDS}&offset=${offset}&allowed_updates=${encodeURIComponent(
    JSON.stringify(["message"])
  )}`;

  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: TelegramUpdate[]; description?: string }
    | null;

  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram getUpdates error: ${body?.description ?? res.status}`);
  }
  return body.result ?? [];
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // SECURITY: the only authorization gate. Anything not from the configured
  // chat is dropped silently — no reply, so the bot never confirms its own
  // existence to an unauthorized sender.
  if (!isAuthorized(update, TELEGRAM_CHAT_ID)) {
    const seen = extractMessage(update);
    if (seen) console.warn(`[rejected] update from chat ${seen.chatId}`);
    return;
  }

  const message = extractMessage(update);
  if (!message) return;

  const intent = parseIntent(message.text);
  console.log(`[recv] ${intent.kind} — ${message.text.slice(0, 80)}`);

  if (intent.kind === "empty") return;

  if (intent.kind === "command") {
    if (!isKnownCommand(intent.name)) {
      await reply(formatUnknownCommand(intent.name));
      return;
    }
    if (intent.name === "run-tests") await reply("🧪 מריץ בדיקות…");
    await reply(await runCommand(intent.name));
    return;
  }

  await reply(await handleNaturalLanguage(intent.text));
}

let running = true;

async function main(): Promise<void> {
  console.log(`Telegram ingress listening — obeying chat ${TELEGRAM_CHAT_ID}`);

  let offset = 0;
  let backoffMs = 1000;

  while (running) {
    try {
      const updates = await getUpdates(offset);
      backoffMs = 1000;

      for (const update of updates) {
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error(`[handler error] ${error instanceof Error ? error.message : String(error)}`);
          await reply(formatError("הפקודה נכשלה", error));
        }
        // Advance only after the update is fully handled.
        offset = Math.max(offset, Number(update.update_id ?? 0) + 1);
      }
    } catch (error) {
      // Network blips and Telegram 5xx are expected; back off instead of
      // hammering the API, and never exit the loop on a transport error.
      console.error(`[poll error] ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} — shutting down`);
    running = false;
    void disconnectPrisma().finally(() => process.exit(0));
  });
}

main().catch(async (error) => {
  console.error(error);
  await disconnectPrisma();
  process.exit(1);
});
