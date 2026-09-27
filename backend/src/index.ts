/**
 * Codebase Doctor MCP Server — entry point.
 *
 * Starts the server built by createServer() (src/server.ts) on stdio, which
 * is how Bob IDE launches it. Nothing is written to stdout except MCP
 * protocol messages.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  // Server runs until stdin closes — no console.log to avoid polluting stdio
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
