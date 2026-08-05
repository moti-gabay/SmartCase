// Pure response rendering for the Telegram ingress.
//
// Split from commands.ts so every string the operator sees is unit tested
// without spawning a process or touching the database.

/**
 * Telegram rejects `sendMessage` over 4096 characters with a 400. Test output
 * and AI answers both blow past that, so every outbound string goes through
 * here — a truncated answer is recoverable, a 400 silently loses the reply.
 */
export const TELEGRAM_MAX_MESSAGE = 4096;

export function truncateForTelegram(text: string, limit = TELEGRAM_MAX_MESSAGE): string {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  const suffix = "\n… (truncated)";
  return value.slice(0, Math.max(0, limit - suffix.length)) + suffix;
}

export const HELP_TEXT = [
  "SmartCase Bot — פקודות זמינות",
  "",
  "/status — מצב הריפו: ענף, שינויים, קומיט אחרון",
  "/run-tests — הרצת חבילת הבדיקות (npm test)",
  "/plugins — מצב התוספים: פעילים, כבויים והגדרות חסרות",
  "/help — ההודעה הזו",
  "",
  "אפשר גם לשלוח משימה בשפה חופשית, למשל:",
  '"סכם את תיק SC-2026-00123"',
  "",
  "גישת ה-AI היא לקריאה בלבד — הבוט לא משנה נתונים.",
].join("\n");

export interface RepoStatus {
  branch: string;
  lastCommit: string;
  dirtyFiles: number;
}

export function formatStatus(status: RepoStatus): string {
  const tree = status.dirtyFiles === 0 ? "clean" : `${status.dirtyFiles} uncommitted file(s)`;
  return ["📊 SmartCase status", "", `branch: ${status.branch}`, `tree: ${tree}`, `last commit: ${status.lastCommit}`].join("\n");
}

export interface TestSummary {
  pass: number;
  fail: number;
  skipped: number;
  total: number;
}

/**
 * Scrape the `node:test` tap-ish summary block out of a run.
 *
 * Matched line-anchored on the `ℹ pass N` counters rather than by parsing the
 * whole stream: individual test lines also contain the words pass/fail, and a
 * loose match would count those. Returns null when the block is absent, which
 * is what a crashed or killed run looks like — that must not be reported as
 * "0 failures".
 */
export function parseTestSummary(output: string | null | undefined): TestSummary | null {
  const text = String(output ?? "");
  const read = (label: string): number | null => {
    const match = text.match(new RegExp(`^\\s*(?:ℹ|#)?\\s*${label}\\s+(\\d+)\\s*$`, "m"));
    return match ? Number(match[1]) : null;
  };

  const pass = read("pass");
  const fail = read("fail");
  if (pass === null || fail === null) return null;

  return {
    pass,
    fail,
    skipped: read("skipped") ?? 0,
    total: read("tests") ?? pass + fail,
  };
}

export function formatTestResult(summary: TestSummary | null, exitCode: number, tail = ""): string {
  if (!summary) {
    return truncateForTelegram(
      ["❌ הרצת הבדיקות נכשלה — לא נמצא סיכום", "", `exit code: ${exitCode}`, "", tail].join("\n").trim()
    );
  }

  const ok = summary.fail === 0 && exitCode === 0;
  const header = ok ? "✅ כל הבדיקות עברו" : "❌ בדיקות נכשלו";
  const lines = [
    header,
    "",
    `pass: ${summary.pass}/${summary.total}`,
    `fail: ${summary.fail}`,
    `skipped: ${summary.skipped}`,
    `exit code: ${exitCode}`,
  ];
  if (!ok && tail) lines.push("", tail);

  return truncateForTelegram(lines.join("\n"));
}

/**
 * Render the marketplace view. Structural (id/enabled/configured) only —
 * secret *values* are never echoed to Telegram, just which vars are missing.
 */
export function formatPlugins(
  plugins: {
    manifest: { id: string; name: string; category: string };
    isEnabled: boolean;
    isConfigured: boolean;
    missingEnvVars: string[];
    hasOverride: boolean;
  }[]
): string {
  if (!plugins.length) return "אין תוספים בקטלוג.";

  const CATEGORY_LABELS: Record<string, string> = { notification: "התראות", ai: "ספקי AI" };
  const lines: string[] = ["🧩 שוק התוספים"];

  for (const category of ["notification", "ai"]) {
    const inCategory = plugins.filter((plugin) => plugin.manifest.category === category);
    if (!inCategory.length) continue;

    lines.push("", `— ${CATEGORY_LABELS[category] ?? category} —`);
    for (const plugin of inCategory) {
      const state = plugin.isEnabled ? "🟢 פעיל" : "⚪ כבוי";
      const source = plugin.hasOverride ? " (override)" : "";
      lines.push(`${state} ${plugin.manifest.name} [${plugin.manifest.id}]${source}`);
      if (!plugin.isConfigured) {
        lines.push(`   ⚠️ חסר: ${plugin.missingEnvVars.join(", ")}`);
      }
    }
  }

  return truncateForTelegram(lines.join("\n"));
}

export function formatUnknownCommand(name: string): string {
  return `לא מכיר את הפקודה /${name}.\n\n${HELP_TEXT}`;
}

export function formatError(context: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return truncateForTelegram(`⚠️ ${context}\n\n${detail}`);
}
