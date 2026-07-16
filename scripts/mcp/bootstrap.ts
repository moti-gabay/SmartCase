// MUST be the first import of server.ts — it establishes two process-wide
// invariants before any other module in the graph is evaluated. Do not reorder.
//
// 1. stdout belongs to the MCP JSON-RPC transport. Anything else written to fd 1
//    corrupts the stream and the client drops the connection. Two modules in our
//    import graph write there:
//      - Prisma: the string form of its `log` option routes EVERY level through
//        console.log — including "error", so the production branch in
//        src/lib/prisma.ts is just as fatal as the development one.
//      - dotenv v17: prints an "injected env (N) from .env" banner on load.
//    Prisma resolves console.log at call time, so re-pointing it at stderr
//    neutralises both without touching src/lib/prisma.ts, which the app depends
//    on. StdioServerTransport writes via process.stdout.write and is unaffected.
//
// 2. src/lib/prisma.ts reads DATABASE_URL at *module scope*, so .env must be
//    loaded before that import is evaluated. Imports hoist above statements, so
//    calling config() in server.ts's body would run too late — hence this module.
import path from "node:path";
import { config } from "dotenv";

console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

// Resolved from this file's own location, never process.cwd(): an MCP client
// spawns the server with a working directory that is not ours to assume.
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

// `quiet` suppresses the banner at the source; the console.log override above
// covers it regardless of import order. Explicit path keeps .env loading
// cwd-independent.
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
