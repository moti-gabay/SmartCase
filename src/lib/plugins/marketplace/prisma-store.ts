import type { InstalledPluginState, PluginStateStore } from "./types";

/**
 * Prisma-backed marketplace state store.
 *
 * The client is injected structurally rather than imported from
 * src/lib/prisma.ts so this module pulls in no Next-runtime singleton: the
 * Telegram daemon builds its own `PrismaClient` (see scripts/telegram/commands.ts)
 * and must be able to use the same store.
 *
 * NOTE: the `InstalledPlugin` model is a *proposed* migration — it is declared in
 * prisma/schema.prisma but `db:push` is a human step per the repo's governance
 * rules, and prisma/sql/enable-rls.sql must be re-run afterwards. Until then the
 * service falls back to env-only resolution (see `readState` in ./service.ts).
 */

interface InstalledPluginRow {
  pluginId: string;
  isEnabled: boolean;
  configOverlay: unknown;
  updatedAt: Date;
}

export interface PluginStateDelegate {
  findMany(args?: unknown): Promise<InstalledPluginRow[]>;
  upsert(args: unknown): Promise<InstalledPluginRow>;
}

export interface PrismaLike {
  installedPlugin: PluginStateDelegate;
}

/**
 * Coerce the `Json` column to a flat string map.
 *
 * The column is free-form JSON at the DB level, so a hand-edited row can hold
 * anything; non-string values are dropped rather than stringified, because an
 * env var whose value is `[object Object]` fails far less legibly than one that
 * is simply absent.
 */
function toOverlay(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function toState(row: InstalledPluginRow): InstalledPluginState {
  return {
    pluginId: row.pluginId,
    isEnabled: row.isEnabled,
    configOverlay: toOverlay(row.configOverlay),
    updatedAt: row.updatedAt,
  };
}

export function createPrismaPluginStateStore(prisma: PrismaLike): PluginStateStore {
  return {
    async list() {
      return (await prisma.installedPlugin.findMany()).map(toState);
    },

    async upsert({ pluginId, isEnabled, configOverlay }) {
      // `configOverlay` is omitted from `update` when undefined so a plain
      // enable/disable preserves the stored overlay instead of wiping it.
      const row = await prisma.installedPlugin.upsert({
        where: { pluginId },
        create: { pluginId, isEnabled, configOverlay: configOverlay ?? {} },
        update: configOverlay ? { isEnabled, configOverlay } : { isEnabled },
      });
      return toState(row);
    },
  };
}
