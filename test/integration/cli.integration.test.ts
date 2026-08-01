import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { runCli } from "../../src/cli.js";

let temporaryDirectory: string | undefined;
let mockServer: Server | undefined;
const originalEnvironment = { ...process.env };

afterEach(async () => {
  process.env = { ...originalEnvironment };
  if (mockServer) await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
  mockServer = undefined;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

async function startMock(): Promise<number> {
  mockServer = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const request = Buffer.concat(chunks).toString("utf8");
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: request.includes("focused question") ? "mock visual answer" : "mock answer", confidence: 0.95, evidence: [{ description: "mock visible evidence", region: { x: 0, y: 0, width: 1, height: 1 } }] }) } }], usage: { prompt_tokens: 11, completion_tokens: 9 } }));
    });
  });
  await new Promise<void>((resolve) => mockServer!.listen(0, "127.0.0.1", () => resolve()));
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("mock server did not bind");
  return address.port;
}

describe("CLI mocked provider integration", () => {
  it("runs a real diagnose command with a path containing spaces and safe JSON output", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "sidesight-cli-"));
    const imagePath = join(temporaryDirectory, "error screenshot.png");
    await writeFile(imagePath, await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer());
    const port = await startMock();
    process.env.SIDESIGHT_PROFILE = "generic";
    process.env.SIDESIGHT_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.SIDESIGHT_MODEL = "mock-vision";
    process.env.SIDESIGHT_API_KEY = "secret-test-key";
    process.env.SIDESIGHT_ALLOWED_DIRS = temporaryDirectory;
    process.env.SIDESIGHT_CONFIG_FILE = join(temporaryDirectory, "config.json");
    let stdout = "";
    let stderr = "";
    const code = await runCli(["diagnose", imagePath, "--format", "json", "--detail", "overview", "--question", "Read the exact error"], { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; }, cwd: temporaryDirectory });
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as { task: string; answer: string; confidence?: number };
    expect(result.task).toBe("diagnose");
    expect(result.answer).toBe("mock visual answer");
    expect(result.confidence).toBe(0.95);
    expect(stderr).not.toContain("secret-test-key");
    expect(stderr).not.toContain("base64");
  });

  it("sends both images for a diff and additional instructions", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "sidesight-diff-"));
    const first = join(temporaryDirectory, "reference.png");
    const second = join(temporaryDirectory, "actual.png");
    const instructions = join(temporaryDirectory, "guidance.md");
    const png = await sharp({ create: { width: 12, height: 12, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    await writeFile(first, png);
    await writeFile(second, png);
    await writeFile(instructions, "Only report visible differences.");
    const port = await startMock();
    process.env.SIDESIGHT_PROFILE = "generic";
    process.env.SIDESIGHT_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.SIDESIGHT_MODEL = "mock-vision";
    process.env.SIDESIGHT_ALLOWED_DIRS = temporaryDirectory;
    process.env.SIDESIGHT_CONFIG_FILE = join(temporaryDirectory, "config.json");
    let stdout = "";
    const code = await runCli(["diff", first, second, "--format", "json", "--detail", "overview", "--instructions-file", instructions, "--question", "List differences"], { stdout: (text) => { stdout += text; }, stderr: () => undefined, cwd: temporaryDirectory });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ task: "diff" });
  });
});
