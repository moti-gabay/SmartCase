// Entrypoint for `npm run slack-daemon`.
//
// The implementation moved to scripts/slack/daemon.mjs when the daemon became
// the G1 ingress for the autofix orchestrator. This file stays so the npm
// script, any shell alias, and the docs keep working.
import { start } from "./slack/daemon.mjs";

start().catch((err) => {
  console.error(`Slack ingress failed to start: ${err.message}`);
  process.exit(1);
});
