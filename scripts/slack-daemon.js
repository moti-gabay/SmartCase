// Two-way bridge: Slack messages in SLACK_NOTIFY_CHANNEL trigger a Claude Code run.
//
//   npm run slack-daemon
import "dotenv/config";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "@slack/bolt";

import { resolveClaudeBin } from "./autofix/guards.mjs";

const { App } = pkg;

// Append-only JSONL event log (logs/ at repo root, gitignored).
const LOG_FILE = join(dirname(dirname(fileURLToPath(import.meta.url))), "logs", "slack-events.jsonl");
mkdirSync(dirname(LOG_FILE), { recursive: true });

function logEvent(event) {
  try {
    appendFileSync(LOG_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + "\n");
  } catch (err) {
    console.error(`[log error] ${err.message}`);
  }
}

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_NOTIFY_CHANNEL } = process.env;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !SLACK_NOTIFY_CHANNEL) {
  console.error(
    "Missing SLACK_BOT_TOKEN, SLACK_APP_TOKEN, or SLACK_NOTIFY_CHANNEL in .env"
  );
  process.exit(1);
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

app.message(async ({ message, say }) => {
  if (message.channel !== SLACK_NOTIFY_CHANNEL) return;
  if (message.bot_id || message.subtype === "bot_message") return;

  const text = message.text?.trim();
  if (!text) return;

  // Resolve the CLI explicitly. A bare "claude" off $PATH resolves to the
  // Windows npm shim under WSL, which is executable but non-functional — the
  // run would fail with a confusing error long after the ack was posted.
  const claude = resolveClaudeBin();
  if (!claude.path) {
    const detail = `no usable claude binary found — tried:\n${claude.tried.join("\n")}`;
    console.error(`[claude error] ${detail}`);
    logEvent({ channel: message.channel, prompt: text, status: "failed", duration_ms: 0, exit_code: 127 });
    await say(`⚠️ Cannot run: no usable \`claude\` binary. Set \`CLAUDE_BIN\` and restart the daemon.`);
    return;
  }

  await say(`🤖 Received instruction! Starting execution: ${text}...`);

  const startedAt = Date.now();
  logEvent({
    channel: message.channel,
    prompt: text,
    status: "started",
    duration_ms: null,
    exit_code: null,
  });

  // execFile (not exec) — passes the message as a literal argv entry rather than
  // interpolating it into a shell string, so shell metacharacters in an untrusted
  // Slack message can't escape into arbitrary shell commands.
  execFile(
    claude.path,
    ["-p", text],
    { maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (stdout) console.log(`[claude stdout]\n${stdout}`);
      if (stderr) console.error(`[claude stderr]\n${stderr}`);
      if (error) console.error(`[claude error] ${error.message}`);
      logEvent({
        channel: message.channel,
        prompt: text,
        status: error ? "failed" : "success",
        duration_ms: Date.now() - startedAt,
        exit_code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
      });
    }
  );
});

(async () => {
  await app.start();
  console.log(
    `⚡ Slack daemon running (Socket Mode) — listening on ${SLACK_NOTIFY_CHANNEL}`
  );
})();
