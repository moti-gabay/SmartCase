// G1 — Slack Socket Mode ingress for the autofix orchestrator.
//
//   npm run slack-daemon
//
// An allowlisted user mentions the bot with an issue; the daemon drives
// runPipeline and reports every phase back into that thread. Slack identity
// answers only "who may ask" and "who may approve" — every other control stays
// in the pipeline, and issue text reaches it as a plain string, never a shell.

import "dotenv/config";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "@slack/bolt";

import { runPipeline, AutofixError, EXIT } from "../autofix/pipeline.mjs";
import { parseAllowlist, isAllowed, extractIssueText, shouldTrigger, missingScopes, REQUIRED_SCOPES } from "./guards.mjs";
import { createApprovalRegistry } from "./approvals.mjs";

const { App } = pkg;

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LOG_FILE = join(REPO_ROOT, "logs", "slack-events.jsonl");

function logEvent(event) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + "\n");
  } catch (err) {
    console.error(`[log error] ${err.message}`);
  }
}

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_NOTIFY_CHANNEL, SLACK_ALLOWED_USERS } = process.env;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !SLACK_NOTIFY_CHANNEL) {
  console.error("Missing SLACK_BOT_TOKEN, SLACK_APP_TOKEN, or SLACK_NOTIFY_CHANNEL in the environment");
  process.exit(1);
}

const allowlist = parseAllowlist(SLACK_ALLOWED_USERS);
if (allowlist.size === 0) {
  // Fail closed. An unset allowlist must never mean "anyone in the channel can
  // trigger an autonomous code change".
  console.error(
    "SLACK_ALLOWED_USERS is empty — refusing to start.\n" +
      "Set it to the Slack user IDs allowed to trigger and approve runs, e.g.\n" +
      "  SLACK_ALLOWED_USERS=U0BJQM1TC2D,U0ABCDEF123"
  );
  process.exit(1);
}

const app = new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true });

/** One run per process. A concurrent trigger is refused, never queued. */
let activeRun = null;

const approvals = createApprovalRegistry({
  onResolved: ({ threadTs, decision, actor }) =>
    logEvent({ kind: "approval", thread_ts: threadTs, decision, user: actor }),
});

let botUserId = null;

/**
 * Confirm the token actually carries the scopes this daemon needs.
 *
 * Slack reports the granted scopes in a response header, so one cheap call
 * surfaces a misconfigured install at startup rather than halfway through a run
 * when the approval gate silently cannot read reactions.
 */
async function preflightScopes() {
  const auth = await app.client.auth.test();
  botUserId = auth.user_id;

  const granted = auth.response_metadata?.scopes?.join(",") ?? auth.headers?.["x-oauth-scopes"] ?? "";
  const missing = granted ? missingScopes(granted) : [];

  if (missing.length > 0) {
    console.error(
      `Slack token is missing required scope(s): ${missing.join(", ")}\n` +
        `Required: ${REQUIRED_SCOPES.join(", ")}\n` +
        "Add them in the Slack App Manifest, then REINSTALL the app — scope changes " +
        "do not take effect on an existing token until reinstall."
    );
    process.exit(1);
  }
  if (!granted) {
    console.warn("[warn] could not read granted scopes from auth.test; continuing without verification");
  }
  return auth;
}

async function say(text, threadTs) {
  return app.client.chat.postMessage({ channel: SLACK_NOTIFY_CHANNEL, thread_ts: threadTs, text });
}

const PHASE_LABEL = {
  preflight: "🔎 בודק סביבה",
  plan: "🧠 מנתח את התקלה (קריאה בלבד)",
  review: "🔬 סקירת התוכנית במודל חיצוני",
  approval: "⏸️ ממתין לאישור",
  execute: "🛠️ מיישם על ענף מבודד",
  verify: "✅ מריץ טסטים ובנייה",
  pr: "🚀 פותח PR",
};

function describeFailure(err) {
  if (!(err instanceof AutofixError)) return `❌ שגיאה בלתי צפויה: ${err.message}`;
  const byCode = {
    [EXIT.BAD_INPUT]: "❌ הבקשה לא תקינה",
    [EXIT.REVIEW_FAILED]: "🛑 הסוקר החיצוני דחה את התוכנית — לא בוצע שינוי בקוד",
    [EXIT.APPROVAL_DENIED]: "🚫 ההרצה לא אושרה — לא בוצע שינוי בקוד",
    [EXIT.TESTS_FAILED]: "❌ הטסטים או הבנייה נכשלו — לא נפתח PR",
    [EXIT.UNSAFE_REPO_STATE]: "⚠️ מצב הריפו לא מאפשר הרצה",
    [EXIT.FORBIDDEN_PATHS]: "🛡️ ההרצה נגעה בקבצים אסורים — השינוי בוטל",
    [EXIT.NO_CLAUDE_BIN]: "❌ לא נמצא בינארי claude תקין",
    [EXIT.CLAUDE_FAILED]: "❌ הרצת claude נכשלה",
  };
  return `${byCode[err.code] ?? "❌ ההרצה נכשלה"} (קוד ${err.code})\n${err.message}`;
}

async function handleTrigger(event) {
  // Mentions can arrive outside the configured channel; only one channel drives runs.
  if (event.channel !== SLACK_NOTIFY_CHANNEL) return;

  const decision = shouldTrigger(event, { botUserId, allowlist });
  if (!decision.run) {
    // Audited but silent: replying would confirm to a non-allowlisted user that
    // the bot is listening and what it does.
    logEvent({ kind: "trigger-ignored", user: event.user, reason: decision.reason, thread_ts: event.thread_ts ?? event.ts });
    if (decision.reason === "empty-issue" && isAllowed(event.user, allowlist)) {
      await say("שלחת אזכור בלי תיאור תקלה — כתוב מה קרה ואפתח בדיקה.", event.thread_ts ?? event.ts);
    }
    return;
  }

  // Reply into the mention's own thread; a top-level mention starts one.
  const threadTs = event.thread_ts ?? event.ts;
  const issue = extractIssueText(event.text, botUserId);

  if (activeRun) {
    logEvent({ kind: "trigger-refused", user: event.user, thread_ts: threadTs, reason: "run-in-progress", active: activeRun.threadTs });
    await say(`⏳ כבר רצה בקשה אחרת כרגע (מאז ${new Date(activeRun.startedAt).toLocaleTimeString("he-IL")}). נסה שוב כשתסתיים.`, threadTs);
    return;
  }

  activeRun = { threadTs, user: event.user, startedAt: Date.now() };
  logEvent({ kind: "trigger", user: event.user, thread_ts: threadTs, issue_length: issue.length });

  await say(`👋 קיבלתי. מתחיל בדיקה — אעדכן כאן בכל שלב.\n\n> ${issue.slice(0, 300)}`, threadTs);

  const hooks = {
    onPhase(phase, name, detail) {
      const label = PHASE_LABEL[name] ?? name;
      say(detail && name === "dry-run" ? `${label}\n\`\`\`${detail}\`\`\`` : label, threadTs).catch((err) =>
        console.error(`[slack] phase post failed: ${err.message}`)
      );
    },

    async requestApproval(plan, review, meta) {
      const prompt = await say(
        [
          "⏸️ *התוכנית עברה סקירה חיצונית ומחכה לאישורך.*",
          `ענף: \`${meta.branch}\``,
          `תוכנית: \`${meta.planPath.replace(REPO_ROOT + "/", "")}\``,
          `סקירה: \`${meta.reviewPath.replace(REPO_ROOT + "/", "")}\``,
          "",
          "אישור מריץ את הסוכן עם הרשאות מלאות על הריפו.",
          "הגב ✅ (או `אישור`) לאישור, ❌ (או `דחייה`) לביטול.",
        ].join("\n"),
        threadTs
      );
      // The plan body stays out of Slack deliberately — read it from the repo.
      return approvals.wait(threadTs, { allowlist, promptTs: prompt.ts });
    },

    async report(summary) {
      await say(
        [
          "✅ *הסתיים בהצלחה*",
          `ענף: \`${summary.branch}\` → \`${summary.baseBranch}\``,
          `קבצים ששונו: ${summary.filesChanged}`,
          `טסטים: ${summary.testResults.join(", ")}`,
          summary.prUrl ? `PR: ${summary.prUrl}` : "PR: לא נפתח (--no-pr)",
        ].join("\n"),
        threadTs
      );
    },
  };

  try {
    const summary = await runPipeline(issue, hooks, { createPr: true });
    logEvent({ kind: "run", status: "success", user: event.user, thread_ts: threadTs, run_id: summary.runId, pr_url: summary.prUrl });
  } catch (err) {
    const code = err instanceof AutofixError ? err.code : 1;
    logEvent({ kind: "run", status: "failed", user: event.user, thread_ts: threadTs, exit_code: code, error: err.message });
    await say(describeFailure(err), threadTs).catch(() => {});
  } finally {
    activeRun = null;
  }
}

app.event("app_mention", async ({ event }) => {
  await handleTrigger(event).catch((err) => {
    console.error(`[slack] trigger handler failed: ${err.message}`);
    logEvent({ kind: "handler-error", error: err.message });
  });
});

// Threaded replies can carry an approval decision.
app.message(async ({ message }) => {
  if (message.channel !== SLACK_NOTIFY_CHANNEL) return;
  if (message.bot_id || message.subtype) return;
  if (!message.thread_ts) return;
  approvals.handleReply({ threadTs: message.thread_ts, user: message.user, text: message.text });
});

app.event("reaction_added", async ({ event }) => {
  if (event.item?.channel !== SLACK_NOTIFY_CHANNEL) return;
  const threadTs = activeRun?.threadTs;
  if (!threadTs) return;
  approvals.handleReaction({ itemTs: event.item.ts, threadTs, user: event.user, reaction: event.reaction });
});

export async function start() {
  const auth = await preflightScopes();
  await app.start();
  console.log(
    `⚡ Slack ingress running (Socket Mode) as ${auth.user} on ${SLACK_NOTIFY_CHANNEL}\n` +
      `   allowlist: ${[...allowlist].join(", ")}`
  );
  logEvent({ kind: "daemon-start", bot_user: auth.user_id, allowlist_size: allowlist.size });
}

export { app, approvals, handleTrigger };
