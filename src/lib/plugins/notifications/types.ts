/**
 * Common contract for outbound notification transports.
 *
 * The point of the interface is that callers never name a vendor: they resolve
 * plugins from the registry (see ./index.ts) and call `sendNotification`. Adding
 * a transport means adding a file here, not touching application code.
 */

/**
 * Free-form context attached to a message. Rendered by each plugin into whatever
 * that transport can express (Slack/Telegram both get plain `key: value` lines —
 * neither transport gets structured fields, so there is nothing to diverge on).
 *
 * `unknown` rather than `any`: values are stringified at the edge, never
 * dereferenced, and `any` would silently disable checking at every call site.
 */
export type NotificationMetadata = Record<string, unknown>;

export interface NotificationPlugin {
  /** Stable identifier, also the value accepted by `NOTIFICATION_PROVIDER`. */
  readonly name: string;

  /**
   * True when the plugin has every secret it needs. The registry uses this to
   * skip an unconfigured transport instead of failing the whole send — a missing
   * Telegram token must not suppress a Slack notification under `all`.
   */
  isConfigured(): boolean;

  /**
   * Deliver `message`. Rejects on transport or API failure; the registry decides
   * whether that is fatal. Implementations must not swallow errors themselves.
   */
  sendNotification(message: string, metadata?: NotificationMetadata): Promise<void>;
}

/**
 * Per-plugin outcome from a fan-out send. Returned rather than thrown so a
 * partial failure under `all` is still fully reportable.
 */
export interface NotificationResult {
  plugin: string;
  ok: boolean;
  error?: string;
}

/** Render metadata as `key: value` lines. Shared so transports stay consistent. */
export function formatMetadata(metadata?: NotificationMetadata): string {
  if (!metadata) return "";
  const lines = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return lines.length ? lines.join("\n") : "";
}
