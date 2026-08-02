// Kill switch for a runaway autofix run.
//
//   npm run autofix:kill              # kill whatever run is active
//   npm run autofix:kill -- <runId>   # kill only if the active run is this one
//
// The Claude CLI has no `claude kill <id>` subcommand. It does have a hidden
// `claude stop <id>`, but that addresses *background agent* sessions started
// with `--bg` and managed by `claude agents`; every phase here runs as a
// foreground `--print` child, which has no such session id. So termination is
// done at the process level: the pipeline spawns `claude` detached (its own
// process group) and publishes the pid plus the runId to
// logs/autofix-active.json. Killing the negated pid reaps the whole group,
// including the tool subprocesses Claude spawns — signalling only the direct
// child can strand those holding the stdio pipes.
//
// The optional <runId> is the safety interlock for that model: with no session
// ids to address, an untargeted kill hits whatever happens to be running now,
// which may not be the run the operator meant. Naming the run makes the kill
// refuse rather than stop an innocent bystander.

import { readFileSync, existsSync, rmSync } from "node:fs";

import { RUNFILE, killGroup } from "./pipeline.mjs";

export function readActiveRun() {
  if (!existsSync(RUNFILE)) return null;
  try {
    return JSON.parse(readFileSync(RUNFILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} [targetRunId] Kill only if the active run has this id.
 * @returns {{killed: boolean, reason: string, run?: object}}
 */
export function killActiveRun(targetRunId) {
  const run = readActiveRun();
  if (!run) return { killed: false, reason: "no active run" };

  const target = String(targetRunId ?? "").trim();
  if (target && run.runId !== target) {
    // Refuse rather than fall back to killing the active run: the operator named
    // a specific run, and silently stopping a different one is worse than a no-op.
    return { killed: false, reason: `active run is ${run.runId ?? "(unknown)"}, not ${target} — refusing to kill`, run };
  }

  if (!run.pid) return { killed: false, reason: "runfile has no pid", run };

  // Confirm the process is actually alive before claiming a kill: a stale
  // runfile from a crashed run would otherwise report success.
  try {
    process.kill(run.pid, 0);
  } catch {
    clearRunfile();
    return { killed: false, reason: `pid ${run.pid} is not running (stale runfile, cleared)`, run };
  }

  const killed = killGroup(run.pid);
  // Clear on success: the pipeline normally clears this when the child closes,
  // but a killed run may not reach that path, and a stale pid would make the
  // next kill either no-op or, worse, signal a recycled pid.
  if (killed) clearRunfile();
  return { killed, reason: killed ? `killed process group ${run.pid}` : `failed to signal ${run.pid}`, run };
}

function clearRunfile() {
  try {
    rmSync(RUNFILE, { force: true });
  } catch {
    /* best effort */
  }
}

// Only act when executed directly, so importing this for tests is side-effect free.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const result = killActiveRun(process.argv[2]);
  if (result.run) {
    console.error(`run ${result.run.runId ?? "(unknown)"} · phase ${result.run.phase ?? "?"} · started ${result.run.startedAt ?? "?"}`);
  }
  console.error(result.killed ? `✅ ${result.reason}` : `⚠️  ${result.reason}`);
  process.exitCode = result.killed ? 0 : 1;
}
