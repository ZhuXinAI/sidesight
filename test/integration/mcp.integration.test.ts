import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let child: ChildProcessWithoutNullStreams | undefined;
let mockServer: Server | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child!.once("exit", () => resolve()));
  child = undefined;
  if (mockServer) await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
  mockServer = undefined;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

async function nextMessage(): Promise<Record<string, unknown>> {
  if (!child) throw new Error("MCP child is not running");
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { lines.close(); reject(new Error("Timed out waiting for MCP response")); }, 5_000);
    lines.once("line", (line) => {
      clearTimeout(timer);
      lines.close();
      resolve(JSON.parse(line) as Record<string, unknown>);
    });
    child!.once("error", (error) => { clearTimeout(timer); lines.close(); reject(error); });
  });
}

describe("MCP stdio integration", () => {
  it("handles initialize, lists tools, and executes a tool over stdio", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "sidesight-mcp-test-"));
    const image = join(temporaryDirectory, "image.png");
    await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    mockServer = createServer((incoming, outgoing) => {
      incoming.resume();
      incoming.once("end", () => {
        outgoing.setHeader("content-type", "application/json");
        outgoing.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "mcp answer", confidence: 0.9 }) } }] }));
      });
    });
    await new Promise<void>((resolve) => mockServer!.listen(0, "127.0.0.1", () => resolve()));
    const address = mockServer.address();
    if (!address || typeof address === "string") throw new Error("mock server did not bind");
    child = spawn(process.execPath, [join(process.cwd(), "dist", "cli.js"), "mcp"], {
      cwd: process.cwd(),
      env: { ...process.env, SIDESIGHT_PROFILE: "generic", SIDESIGHT_BASE_URL: `http://127.0.0.1:${address.port}/v1`, SIDESIGHT_MODEL: "mock", SIDESIGHT_ALLOWED_DIRS: temporaryDirectory, SIDESIGHT_CONFIG_FILE: join(temporaryDirectory, "config.json") },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    const initialized = await nextMessage();
    expect(initialized.id).toBe(1);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const listed = await nextMessage();
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["ui_to_artifact", "extract_text_from_screenshot", "diagnose_error_screenshot", "understand_technical_diagram", "analyze_data_visualization", "ui_diff_check", "image_analysis", "video_analysis"]);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "diagnose_error_screenshot", arguments: { image, detail_level: "overview", question: "Read the image" } } })}\n`);
    const called = await nextMessage();
    const content = (called.result as { content: Array<{ text: string }> }).content;
    expect(content[0]?.text).toContain("mcp answer");
  });
});
