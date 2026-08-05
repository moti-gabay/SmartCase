// Pure identity and intent parsing for the Telegram inbound ingress.
//
// Deterministic and dependency-free so every rule that decides *whose messages
// are obeyed* and *what they mean* is unit tested. All Telegram I/O lives in
// daemon.ts — keep it out of this file.

/** The subset of a Telegram `Update` this ingress reads. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; is_bot?: boolean; username?: string };
  };
  // Any other update type (edited_message, channel_post, callback_query…) is
  // deliberately unmodelled — see extractMessage.
  [key: string]: unknown;
}

export interface InboundMessage {
  updateId: number;
  messageId: number;
  chatId: string;
  fromId: string;
  text: string;
  date: number;
}

/**
 * Normalise a chat/user id to a comparison-safe string.
 *
 * Telegram sends ids as JSON numbers, but `TELEGRAM_CHAT_ID` arrives from the
 * environment as a string. Comparing them raw is a `123 === "123"` false —
 * an auth check that silently rejects everything, which reads as "the bot is
 * broken" rather than "the guard is wrong". Normalise both sides, always.
 */
export function normalizeId(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return "";
}

/**
 * Pull the one message shape this ingress acts on, or null.
 *
 * Only plain `message` updates with text are honoured. `edited_message` is
 * ignored on purpose: acting on edits would let a message that was already
 * processed be rewritten into a different command after the fact.
 */
export function extractMessage(update: TelegramUpdate | null | undefined): InboundMessage | null {
  const message = update?.message;
  if (!message || typeof message.text !== "string") return null;

  const chatId = normalizeId(message.chat?.id);
  const fromId = normalizeId(message.from?.id);
  const text = message.text.trim();
  if (!chatId || !text) return null;

  return {
    updateId: Number(update?.update_id ?? 0),
    messageId: Number(message.message_id ?? 0),
    chatId,
    fromId,
    text,
    date: Number(message.date ?? 0),
  };
}

/**
 * The single authorization gate: does this message come from the owner's chat?
 *
 * Fails closed on an empty `allowedChatId` — an unset `TELEGRAM_CHAT_ID` must
 * mean "nobody", never "every chat this bot is added to". Bots added to a group
 * receive that group's messages, so "no allowlist" would otherwise be a remote
 * command channel for anyone who finds the bot.
 *
 * Messages from other bots are refused regardless of chat, so a second bot in
 * the same chat cannot drive this one.
 */
export function isAuthorized(
  update: TelegramUpdate | null | undefined,
  allowedChatId: string | null | undefined
): boolean {
  const allowed = normalizeId(allowedChatId);
  if (!allowed) return false;

  const message = extractMessage(update);
  if (!message) return false;
  if (update?.message?.from?.is_bot === true) return false;

  return message.chatId === allowed;
}

export type ParsedIntent =
  | { kind: "command"; name: string; args: string }
  | { kind: "natural"; text: string }
  | { kind: "empty" };

/** Commands this ingress answers. Anything else falls through to the AI path. */
export const KNOWN_COMMANDS = ["status", "help", "run-tests", "plugins"] as const;
export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export function isKnownCommand(name: string): name is KnownCommand {
  return (KNOWN_COMMANDS as readonly string[]).includes(name);
}

/**
 * Classify message text as a slash command or a natural-language task.
 *
 * `@botname` suffixes are stripped: Telegram appends them to commands sent in
 * groups (`/status@smartcase_bot`), and a bare `startsWith("/status")` would
 * miss those. Command names are lowercased; the argument tail is preserved
 * verbatim so Hebrew and case-sensitive values survive intact.
 */
export function parseIntent(rawText: string | null | undefined): ParsedIntent {
  const text = String(rawText ?? "").trim();
  if (!text) return { kind: "empty" };

  if (!text.startsWith("/")) return { kind: "natural", text };

  const body = text.slice(1);
  const boundary = body.search(/\s/);
  const head = boundary === -1 ? body : body.slice(0, boundary);
  const name = head.split("@")[0].toLowerCase();
  if (!name) return { kind: "empty" };

  // Sliced, not split/joined: splitting on /\s+/ and re-joining would collapse
  // internal whitespace, which is not "verbatim" for a free-text argument.
  const args = boundary === -1 ? "" : body.slice(boundary).trim();

  return { kind: "command", name, args };
}

/**
 * Case-number / id extraction for natural-language case lookups.
 *
 * Accepts the canonical `SC-2026-00123` form, a raw cuid, and a bare `#123` /
 * `123` reference. Ids in this schema are **cuid, not UUID** (see
 * prisma/schema.prisma) — a UUID pattern here would never match a real id.
 *
 * The case-number check runs before the cuid check because `SC-2026-00123`
 * contains no `c`-prefixed run, but ordering it explicitly keeps the intent
 * obvious. This function only decides *what was referenced*; resolving it
 * against the DB is the caller's job.
 */
const CUID = /\bc[a-z0-9]{20,30}\b/i;
const CASE_NUMBER = /\bSC-\d{4}-\d{5}\b/i;
const BARE_NUMBER = /(?:^|\s)#?(\d{1,6})(?:\s|$)/;

export function extractCaseReference(text: string | null | undefined): string | null {
  const value = String(text ?? "");

  const caseNumber = value.match(CASE_NUMBER);
  if (caseNumber) return caseNumber[0].toUpperCase();

  const cuid = value.match(CUID);
  if (cuid) return cuid[0].toLowerCase();

  const bare = value.match(BARE_NUMBER);
  if (bare) return bare[1];

  return null;
}
