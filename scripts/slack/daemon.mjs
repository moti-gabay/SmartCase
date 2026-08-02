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
import { killActiveRun } from "../autofix/kill.mjs";
import {
  parseAllowlist,
  isAllowed,
  extractIssueText,
  shouldTrigger,
  isKillCommand,
  pruneFailureWindow,
  isTransportFlapping,
  missingScopes,
  missingOptionalScopes,
  REQUIRED_SCOPES,
} from "./guards.mjs";
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
/** Set at preflight: false when the token lacks reactions:read, so the ✅ path is off. */
let reactionsEnabled = true;

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
  if (!granted) {
    console.warn("[warn] could not read granted scopes from auth.test; continuing without verification");
    return auth;
  }

  const missing = missingScopes(granted);
  if (missing.length > 0) {
    console.error(
      `Slack token is missing required scope(s): ${missing.join(", ")}\n` +
        `Required: ${REQUIRED_SCOPES.join(", ")}\n` +
        "Add them in the Slack App Manifest, then REINSTALL the app — scope changes " +
        "do not take effect on an existing token until reinstall."
    );
    process.exit(1);
  }

  // Degrade rather than refuse: each optional scope costs exactly one capability.
  for (const { scope, capability } of missingOptionalScopes(granted)) {
    console.warn(`[warn] ${scope} not granted — disabled: ${capability}`);
    if (scope === "reactions:read") reactionsEnabled = false;
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
    [EXIT.BUDGET_EXHAUSTED]: "💸 תקציב ההרצה אזל",
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

  activeRun = { threadTs, user: event.user, startedAt: Date.now(), runId: null };
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
          reactionsEnabled
            ? "הגב ✅ (או `אישור`) לאישור, ❌ (או `דחייה`) לביטול."
            : "השב `אישור` לאישור, או `דחייה` לביטול. (אישור בריאקציה מושבת — חסר scope `reactions:read`.)",
        ].join("\n"),
        threadTs
      );
      // The plan body stays out of Slack deliberately — read it from the repo.
      return approvals.wait(threadTs, { allowlist, promptTs: prompt.ts });
    },

    onNotify(notifyEvent, detail) {
      // Lifecycle pages. The approval prompt itself is posted by
      // requestApproval; this adds the machine-readable marker and a nudge for
      // the case where the operator is not watching the thread.
      //
      // Audited to slack-events.jsonl before the post, and independently of it:
      // runPipeline already records the event in autofix-events.jsonl, but this
      // is the transport's own ledger — the record of what an operator was
      // actually paged about must survive a Slack API call that fails. Writing
      // it after a failed post would lose exactly the events that matter most.
      logEvent({
        kind: "notification",
        event: notifyEvent,
        user: event.user,
        thread_ts: threadTs,
        run_id: detail.runId ?? null,
        outcome: detail.outcome ?? null,
        exit_code: detail.exit_code ?? null,
        pr_url: detail.pr_url ?? null,
        awaiting: detail.awaiting ?? null,
        spent_usd: detail.spent_usd ?? null,
        remaining_usd: detail.remaining_usd ?? null,
        phase: detail.phase ?? null,
      });

      // The kill switch addresses runs by id; remember the one this thread owns
      // so `עצור` cannot stop a later, unrelated run.
      if (activeRun && detail.runId) activeRun.runId = detail.runId;

      const text =
        notifyEvent === "input_required"
          ? `🔔 *נדרשת פעולה שלך* — ההרצה ממתינה לאישור (${detail.awaiting}). ללא מענה היא תידחה אוטומטית.`
          : notifyEvent === "budget_exhausted"
            ? `💸 *תקציב ההרצה אזל* לפני שלב \`${detail.phase}\` — נוצלו $${detail.spent_usd} מתוך $${detail.budget_usd}. לא הופעל סוכן נוסף.`
            : detail.outcome === "success"
              ? `🔔 ההרצה הסתיימה בהצלחה${detail.pr_url ? ` — ${detail.pr_url}` : ""}`
              : `🔔 ההרצה הסתיימה בכישלון (קוד ${detail.exit_code})`;
      say(text, threadTs).catch((err) => console.error(`[slack] notify post failed: ${err.message}`));
    },

    async report(summary) {
      await say(
        [
          "✅ *הסתיים בהצלחה*",
          `ענף: \`${summary.branch}\` → \`${summary.baseBranch}\``,
          `קבצים ששונו: ${summary.filesChanged}`,
          `טסטים: ${summary.testResults.join(", ")}`,
          `עלות: $${summary.spentUsd} מתוך $${summary.budgetUsd}`,
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

  // Emergency stop takes precedence over approval parsing: a run that is already
  // executing cannot be halted by denying a gate it has passed.
  if (isKillCommand(message.text)) {
    if (!isAllowed(message.user, allowlist)) {
      logEvent({ kind: "kill-refused", user: message.user, thread_ts: message.thread_ts, reason: "not-allowlisted" });
      return;
    }
    // A `עצור` only stops the run its own thread started. Typed late into an
    // old thread it must not reach into a different run that began since —
    // refuse outright rather than falling through to an untargeted kill.
    if (activeRun && activeRun.threadTs !== message.thread_ts) {
      logEvent({ kind: "kill-refused", user: message.user, thread_ts: message.thread_ts, reason: "thread-does-not-own-active-run" });
      await say("⚠️ ההרצה הפעילה שייכת לשרשור אחר — עצור אותה שם.", message.thread_ts);
      return;
    }
    const result = killActiveRun(activeRun?.runId ?? undefined);
    logEvent({
      kind: "kill",
      user: message.user,
      thread_ts: message.thread_ts,
      run_id: activeRun?.runId ?? null,
      killed: result.killed,
      reason: result.reason,
    });
    await say(result.killed ? `🛑 ההרצה נעצרה — ${result.reason}` : `⚠️ לא נעצר: ${result.reason}`, message.thread_ts);
    return;
  }

  approvals.handleReply({ threadTs: message.thread_ts, user: message.user, text: message.text });
});

app.event("reaction_added", async ({ event }) => {
  // Without reactions:read Slack never delivers this; the guard keeps intent explicit.
  if (!reactionsEnabled) return;
  if (event.item?.channel !== SLACK_NOTIFY_CHANNEL) return;
  const threadTs = activeRun?.threadTs;
  if (!threadTs) return;
  approvals.handleReaction({ itemTs: event.item.ts, threadTs, user: event.user, reaction: event.reaction });
});

/**
 * Transport supervision.
 *
 * A Socket Mode WebSocket can die while the process stays alive and the startup
 * banner still scrolls above in the terminal — the daemon then looks healthy and
 * silently receives nothing. That happened in testing: 14 consecutive pong
 * timeouts, no delivered events for ~30 minutes, and a mention lost because
 * Socket Mode does not replay events missed while disconnected.
 *
 * So: every transport transition is written to the JSONL audit log, and repeated
 * failure exits non-zero rather than lingering. Exiting is the correct behaviour
 * for an ingress whose whole job is to be listening — a process supervisor
 * (systemd, pm2, Docker restart policy) can restore a working socket, whereas a
 * live process with a dead socket cannot be detected from outside.
 *
 * Failures are counted over a rolling WINDOW, not consecutively. A first attempt
 * counted consecutive closes and reset on every `connected`, which missed the
 * failure mode that actually occurred in production: the socket flapped — close,
 * reconnect, close — and stayed effectively unusable for ~14 hours without ever
 * tripping the threshold, because no three closes were adjacent. A flapping
 * transport loses events just as surely as a dead one.
 *
 * A prolonged gap is also treated as a failure in its own right: if the socket
 * stays down past DISCONNECT_ALERT_MS the daemon stops waiting and exits, since
 * Socket Mode never replays what was missed while it was away.
 */
const FAILURE_WINDOW_MS = 30 * 60_000;
const MAX_FAILURES_IN_WINDOW = 3;
const DISCONNECT_ALERT_MS = 5 * 60_000;

/** Timestamps of recent transport failures, pruned to the rolling window. */
let failureTimes = [];
let downSince = null;
let downTimer = null;

function superviseTransport() {
  const client = app.receiver?.client;
  if (!client?.on) {
    console.warn("[warn] Socket Mode client not exposed — transport supervision unavailable");
    logEvent({ kind: "transport", state: "supervision-unavailable" });
    return;
  }

  client.on("connected", () => {
    const downMs = downSince ? Date.now() - downSince : 0;
    if (downMs > 0) console.log(`[transport] reconnected after ${Math.round(downMs / 1000)}s down`);
    downSince = null;
    clearTimeout(downTimer);
    downTimer = null;
    // Deliberately does NOT clear failureTimes: a reconnect proves the socket
    // came back, not that it is stable. Only the rolling window ages failures out.
    logEvent({ kind: "transport", state: "connected", down_ms: downMs || null, failures_in_window: failureTimes.length });
  });

  client.on("disconnected", (err) => {
    console.warn(`[transport] disconnected${err ? `: ${err.message}` : ""}`);
    logEvent({ kind: "transport", state: "disconnected", error: err?.message ?? null });
  });

  client.on("unable_to_socket_mode_start", (err) => {
    logEvent({ kind: "transport", state: "start-failed", error: err?.message ?? null });
    recordFailure("start-failed");
  });

  client.on("close", (code) => {
    logEvent({ kind: "transport", state: "closed", code: code ?? null });
    beginDowntime();
    recordFailure("closed");
  });
}

function exitUnhealthy(reason, detail) {
  console.error(`[transport] ${detail}\nExiting so a supervisor can restart; a dead socket receives nothing.`);
  logEvent({ kind: "daemon-exit", reason, failures_in_window: failureTimes.length });
  process.exit(1);
}

/** Start the clock on a disconnection so prolonged downtime is itself a failure. */
function beginDowntime() {
  if (downSince) return;
  downSince = Date.now();
  downTimer = setTimeout(() => {
    exitUnhealthy("transport-down-too-long", `socket down for over ${DISCONNECT_ALERT_MS / 60000} minutes`);
  }, DISCONNECT_ALERT_MS);
  downTimer.unref?.();
}

function recordFailure(kind) {
  const now = Date.now();
  failureTimes = pruneFailureWindow([...failureTimes, now], now, FAILURE_WINDOW_MS);
  logEvent({ kind: "transport", state: "failure", cause: kind, failures_in_window: failureTimes.length });
  if (isTransportFlapping(failureTimes, MAX_FAILURES_IN_WINDOW)) {
    exitUnhealthy(
      "transport-unhealthy",
      `${failureTimes.length} socket failures within ${FAILURE_WINDOW_MS / 60000} minutes — the transport is flapping`
    );
  }
}

export async function start() {
  const auth = await preflightScopes();
  // Attach before start(): app.start() resolves only once the socket is already
  // connected, so listeners registered afterwards miss the first `connected`
  // event and the audit log would begin mid-story.
  superviseTransport();
  await app.start();
  console.log(
    `⚡ Slack ingress running (Socket Mode) as ${auth.user} on ${SLACK_NOTIFY_CHANNEL}\n` +
      `   allowlist: ${[...allowlist].join(", ")}\n` +
      `   approval:  ${reactionsEnabled ? "reaction or reply" : "reply only (no reactions:read)"}\n` +
      `   transport: supervised (exit after ${MAX_FAILURES_IN_WINDOW} failures / ${FAILURE_WINDOW_MS / 60000}min, or ${DISCONNECT_ALERT_MS / 60000}min down)`
  );
  logEvent({ kind: "daemon-start", bot_user: auth.user_id, allowlist_size: allowlist.size });
}

export { app, approvals, handleTrigger, superviseTransport };
