// CLI front-end for the autofix pipeline.
//
// Owns every human interaction (stdin prompts, stdout progress) so that
// runPipeline itself stays transport-agnostic — a Slack adapter binds the same
// hooks without this file.

import { createInterface } from "node:readline/promises";
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

function parseArgs(argv) {
  const options = { provider: "gemini", yes: false, createPr: true, dryRun: false };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--provider") {
      options.provider = argv[i + 1];
      i += 1;
      if (!options.provider) throw new AutofixError(EXIT.BAD_INPUT, "--provider needs a value");
    } else if (arg === "--yes") options.yes = true;
    else if (arg === "--no-pr") options.createPr = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("--")) throw new AutofixError(EXIT.BAD_INPUT, `unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { options, issue: positional.join(" ") };
}

async function readStdin() {
  if (stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function confirm(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const { options, issue: argvIssue } = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return EXIT.OK;
  }

  const issue = (argvIssue || (await readStdin())).trim();
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
      console.error(plan.slice(0, 4000));
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

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof AutofixError) {
      console.error(`\n❌ ${err.message}`);
      if (err.detail) console.error(err.detail);
      process.exit(err.code);
    }
    console.error(`\n❌ unexpected error: ${err.stack ?? err.message}`);
    process.exit(1);
  });
