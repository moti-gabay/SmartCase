// Pure identity and intent parsing for the Slack ingress.
//
// Deterministic and dependency-free so every rule that decides *who may trigger
// a run* and *who may approve one* is unit tested. The Bolt I/O lives in
// daemon.mjs — keep it out of this file.

/** Scopes the daemon cannot function without. Checked at startup, not on first use. */
export const REQUIRED_SCOPES = ["chat:write", "channels:history", "reactions:read", "users:read"];

const APPROVE_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "+1", "thumbsup", "ok_hand"]);
const DENY_REACTIONS = new Set(["x", "no_entry", "no_entry_sign", "-1", "thumbsdown"]);

// Hebrew first — the office works in Hebrew and the operator will type it.
//
// Anchored whole-string (bar trailing punctuation), NOT prefix-matched, for two
// reasons. `\b` is an ASCII word boundary and never matches after a Hebrew
// letter, so a `\b`-terminated pattern silently fails on "אישור" — the gate
// would wait out its timeout and deny. And for a gate that authorises
// autonomous code execution, "approve" must mean the whole message: "approve
// this only after you check X" is a conversation, not consent.
const APPROVE_WORDS = /^(אישור|מאושר|לאשר|כן|approve|approved|yes|y|ok)[\s.!,]*$/iu;
const DENY_WORDS = /^(דחייה|לדחות|דחה|לא|בטל|ביטול|deny|denied|reject|no|n|cancel|abort)[\s.!,]*$/iu;

/**
 * Parse `SLACK_ALLOWED_USERS` into a Set of user IDs.
 *
 * Accepts raw IDs or `<@U123>` mention syntax, comma or whitespace separated,
 * so a value pasted straight out of Slack works. Returns an empty Set for empty
 * input — callers must treat that as "nobody", never "everybody".
 */
export function parseAllowlist(raw) {
  return new Set(
    String(raw ?? "")
      .split(/[\s,]+/)
      .map((entry) => entry.trim().replace(/^<@|>$/g, "").toUpperCase())
      .filter(Boolean)
  );
}

/** Fail-closed: no allowlist means no one, and a missing user id is never allowed. */
export function isAllowed(userId, allowlist) {
  if (!userId || !allowlist || allowlist.size === 0) return false;
  return allowlist.has(String(userId).toUpperCase());
}

/**
 * Strip bot mentions and surrounding noise to get the issue text.
 *
 * Removes every `<@BOT>` occurrence rather than only a leading one — operators
 * mention the bot mid-sentence — and unescapes Slack's HTML entities so the
 * plan prompt sees what the human typed.
 */
export function extractIssueText(text, botUserId) {
  let out = String(text ?? "");
  if (botUserId) {
    out = out.replace(new RegExp(`<@${String(botUserId).toUpperCase()}(\\|[^>]*)?>`, "gi"), " ");
  }
  return out
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** @returns {'approve'|'deny'|null} — null means "not a decision", so keep waiting. */
export function classifyReply(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  if (DENY_WORDS.test(trimmed)) return "deny";
  if (APPROVE_WORDS.test(trimmed)) return "approve";
  return null;
}

/** @returns {'approve'|'deny'|null} */
export function classifyReaction(name) {
  const key = String(name ?? "").trim().toLowerCase().replace(/::skin-tone-\d+$/, "");
  if (DENY_REACTIONS.has(key)) return "deny";
  if (APPROVE_REACTIONS.has(key)) return "approve";
  return null;
}

/**
 * Should this event start a run?
 *
 * @returns {{run: boolean, reason: string}} — `reason` is what gets audited, so
 * every ignored event is explainable after the fact.
 */
export function shouldTrigger(event, { botUserId, allowlist } = {}) {
  if (!event || typeof event !== "object") return { run: false, reason: "malformed-event" };
  // Never react to our own posts or any other app's — that is how a bot loop starts.
  if (event.bot_id || event.subtype === "bot_message" || event.bot_profile) {
    return { run: false, reason: "bot-authored" };
  }
  if (botUserId && event.user && String(event.user).toUpperCase() === String(botUserId).toUpperCase()) {
    return { run: false, reason: "self-authored" };
  }
  if (!isAllowed(event.user, allowlist)) return { run: false, reason: "not-allowlisted" };
  if (!extractIssueText(event.text, botUserId)) return { run: false, reason: "empty-issue" };
  return { run: true, reason: "ok" };
}

/** Scopes present on the token minus what we need. Empty array means good to go. */
export function missingScopes(grantedHeader) {
  const granted = new Set(
    String(grantedHeader ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}
