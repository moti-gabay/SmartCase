// CLI front-end for the autofix pipeline.
//
// Owns every human interaction (stdin prompts, stdout progress) so that
// runPipeline itself stays transport-agnostic — a Slack adapter binds the same
// hooks without this file.

import { createInterface } from "node:readline/promises";
import { createReadStream } from "node:fs";
import { stdin, stdout } from "node:process";

import { runPipeline, AutofixError, EXIT } from "./pipeline.mjs";

const USAGE = `Usage: npm run autofix -- [options] "<issue text>"

Reads the issue from argv, or from stdin when no positional argument is given.

Options:
  --provider <name>   Plan reviewer: gemini | openai | deepseek  (default: gemini)
  --yes               Skip the interactive approval prompt (DANGEROUS — this is
                      the only gate before 'claude --dangerously-skip-permissions')
  --no-pr             Stop after the tests pass; do not push or open a PR
  --dry-run           Print the resolved binary, run id, and branch; change nothing
  -h, --help          Show this message`;

const PROVIDERS = ["gemini", "openai", "deepseek"];

function parseArgs(argv) {
  const options = { provider: "gemini", yes: false, createPr: true, dryRun: false };
  const positional = [];
  let endOfFlags = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (endOfFlags) {
      positional.push(arg);
    } else if (arg === "--") {
      // Everything after `--` is issue text, so a report that starts with
      // dashes is still reportable.
      endOfFlags = true;
    } else if (arg === "--provider") {
      const value = argv[i + 1];
      // Without this check `--provider --yes` swallows the flag and only fails
      // minutes later, inside Phase 2, as an unrecognisable error.
      if (!value || value.startsWith("-")) throw new AutofixError(EXIT.BAD_INPUT, "--provider needs a value");
      if (!PROVIDERS.includes(value)) {
        throw new AutofixError(EXIT.BAD_INPUT, `unknown provider: ${value}`, `choose one of: ${PROVIDERS.join(", ")}`);
      }
      options.provider = value;
      i += 1;
    } else if (arg === "--yes") options.yes = true;
    else if (arg === "--no-pr") options.createPr = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("-") && arg !== "-") {
      throw new AutofixError(EXIT.BAD_INPUT, `unknown option: ${arg}`, "use -- before issue text that starts with a dash");
    } else positional.push(arg);
  }
  return { options, issue: positional.join(" ") };
}

const MAX_STDIN_BYTES = 256 * 1024;

async function readStdin() {
  if (stdin.isTTY) return "";
  const chunks = [];
  let total = 0;
  for await (const chunk of stdin) {
    total += chunk.length;
    if (total > MAX_STDIN_BYTES) {
      throw new AutofixError(EXIT.BAD_INPUT, `issue text exceeds ${MAX_STDIN_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Ask the operator to approve execution.
 *
 * When the issue arrived on stdin, stdin is already at EOF — a readline over it
 * never yields an answer and the pipeline hangs at the gate forever. Reading the
 * terminal directly via /dev/tty keeps the gate real for piped input. If there
 * is no terminal at all (cron, CI), refuse rather than silently approving.
 */
async function confirm(question) {
  let input = stdin;
  let tty = null;

  if (!stdin.isTTY) {
    try {
      tty = createReadStream("/dev/tty");
      input = tty;
    } catch {
      throw new AutofixError(
        EXIT.APPROVAL_DENIED,
        "no terminal available for the approval prompt",
        "run interactively, or pass --yes to execute without the gate"
      );
    }
  }

  const rl = createInterface({ input, output: stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
    tty?.destroy();
  }
}

async function main() {
  const { options, issue: argvIssue } = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return EXIT.OK;
  }

  const piped = argvIssue ? "" : await readStdin();
  const issue = (argvIssue || piped).trim();
  if (!issue) {
    console.error("error: no issue text provided\n");
    console.error(USAGE);
    return EXIT.BAD_INPUT;
  }

  const hooks = {
    onPhase(phase, name, detail) {
      console.error(`\n[phase ${phase}] ${name}${detail ? ` — ${detail}` : ""}`);
    },

    async requestApproval(plan, review, meta) {
      if (options.yes) {
        console.error("--yes given: skipping the approval gate");
        return true;
      }
      console.error(`\n${"=".repeat(72)}`);
      console.error(`PLAN:   ${meta.planPath}`);
      console.error(`REVIEW: ${meta.reviewPath}  (VERDICT: PASS)`);
      console.error(`BRANCH: ${meta.branch}`);
      console.error("=".repeat(72));
      // Show the plan in full. Truncating here would mean approving one thing
      // while the executor receives another — the tail is exactly where an
      // injected instruction would sit.
      console.error(plan);
      console.error("=".repeat(72));
      console.error("\nApproving runs `claude --dangerously-skip-permissions` against this repo.");
      return confirm("Approve execution? [y/N] ");
    },

    async report(summary) {
      console.error(`\n${"=".repeat(72)}`);
      console.error(`✅ autofix complete — run ${summary.runId}`);
      console.error(`   branch:  ${summary.branch}`);
      console.error(`   changed: ${summary.filesChanged} file(s)`);
      console.error(`   tests:   ${summary.testResults.join(", ")}`);
      console.error(`   PR:      ${summary.prUrl ?? "(skipped: --no-pr)"}`);
      console.error("=".repeat(72));
    },
  };

  await runPipeline(issue, hooks, {
    provider: options.provider,
    createPr: options.createPr,
    dryRun: options.dryRun,
  });
  return EXIT.OK;
}

// Set exitCode rather than calling process.exit(), so buffered stderr is flushed
// when output is redirected to a file or pipe.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof AutofixError) {
      console.error(`\n❌ ${err.message}`);
      if (err.detail) console.error(err.detail);
      process.exitCode = err.code;
      return;
    }
    console.error(`\n❌ unexpected error: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
