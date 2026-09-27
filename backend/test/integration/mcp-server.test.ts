/**
 * Integration test at the MCP protocol level: a real MCP client talks to the
 * real server (createServer) over an in-memory transport — the same tool
 * registrations, zod schemas and error handling Bob uses over stdio.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_VERSION } from "../../src/server.js";
import { prepareWorkingCopy, removeDir } from "../helpers.js";

let client: Client;
let repo: string;

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;
const text = (r: ToolResult) => r.content.map((c) => c.text).join("\n");

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  repo = prepareWorkingCopy();
});

afterAll(async () => {
  await client.close();
  removeDir(repo);
});

describe("MCP server", () => {
  it("identifies itself and registers exactly the 12 documented tools", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "codebase-doctor", version: SERVER_VERSION });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "analyze_dependency_usage",
      "apply_migration_patch",
      "approve_migration_plan",
      "calculate_migration_blast_radius",
      "checkout_branch",
      "create_pull_request",
      "generate_migration_plan",
      "generate_report",
      "get_session_status",
      "load_migration_requirements",
      "run_checks",
      "verify_migration",
    ]);
    for (const t of tools) expect(t.description!.length).toBeGreaterThan(40);
  });

  it("rejects malformed input before any tool code runs", async () => {
    const r = await call("load_migration_requirements", { sessionId: "../../etc/passwd" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/uuid|Invalid/i);
  });

  it("surfaces tool errors as MCP errors with an actionable message", async () => {
    const bad = await call("analyze_dependency_usage", { url: "https://gitlab.com/a/b", dependency: "react", targetVersion: "18" });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/only github.com repositories are supported/);

    const missing = await call("generate_migration_plan", { sessionId: "4f8e2a6c-0000-4000-8000-000000000000" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/not found\. Call analyze_dependency_usage first/);
  });

  it("drives the read-only half of the workflow end to end on a local repository", async () => {
    const analysed = await call("analyze_dependency_usage", { url: repo, dependency: "react", targetVersion: "18.3.1" });
    expect(analysed.isError).toBeFalsy();
    const sessionId = text(analysed).match(/Session created: ([0-9a-f-]{36})/)![1];

    expect(text(await call("load_migration_requirements", { sessionId }))).toContain("react-bc-1");
    expect(text(await call("calculate_migration_blast_radius", { sessionId }))).toContain("[90/100] src/App.test.jsx");
    const plan = text(await call("generate_migration_plan", { sessionId }));
    expect(plan).toContain("NOT approved");
    const planId = plan.match(/Plan ID:\*\* `([0-9a-f]{12})`/)![1];

    // The approval gate holds at the protocol level too.
    const early = await call("checkout_branch", { sessionId });
    expect(early.isError).toBe(true);
    expect(text(early)).toMatch(/has not been approved/);
    const notApproved = await call("approve_migration_plan", { sessionId, planId, confirmation: "sure, go ahead" });
    expect(notApproved.isError).toBe(true);

    const status = text(await call("get_session_status", { sessionId }));
    expect(status).toContain(`present plan ${planId}`);

    const html = text(await call("generate_report", { sessionId, format: "html" }));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Awaiting approval");
    const md = text(await call("generate_report", { sessionId }));
    expect(md).toContain("## Migration Report: react ^17.0.2 → 18.3.1");
  });
});
