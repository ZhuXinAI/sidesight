import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";

const root = await mkdtemp(join(tmpdir(), "sidesight-acceptance-"));
const image = join(root, "error.png");
await writeFile(image, await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } } }).png().toBuffer());
const server = createServer((incoming, outgoing) => {
  const chunks = [];
  incoming.on("data", (chunk) => chunks.push(chunk));
  incoming.on("end", () => {
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "acceptance answer", confidence: 0.96, warnings: [], evidence: [] }) } }] }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], { cwd: root, env: { ...process.env, SIDESIGHT_PROFILE: "generic", SIDESIGHT_BASE_URL: `http://127.0.0.1:${port}/v1`, SIDESIGHT_MODEL: "mock", SIDESIGHT_API_KEY: "acceptance-secret", SIDESIGHT_ALLOWED_DIRS: root, SIDESIGHT_CONFIG_FILE: join(root, "config.json") } });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  });
}

try {
  const help = await run(["--help"]);
  if (help.code !== 0 || !help.stdout.includes("diagnose") || !help.stdout.includes("video")) throw new Error("CLI help acceptance failed");
  const helpCommands = [
    ["setup"],
    ["image"],
    ["ui"],
    ["ocr"],
    ["diagnose"],
    ["diagram"],
    ["chart"],
    ["diff"],
    ["video"],
    ["doctor"],
    ["mcp"],
    ["config"],
    ["config", "init"],
    ["config", "show"],
  ];
  for (const command of helpCommands) {
    const commandHelp = await run([...command, "--help"]);
    if (commandHelp.code !== 0 || !commandHelp.stdout.includes("Usage:")) throw new Error(`Command help acceptance failed: ${command.join(" ")}`);
  }
  const result = await run(["diagnose", image, "--format", "json", "--detail", "overview", "--question", "Read the error"]);
  if (result.code !== 0) throw new Error(`diagnose acceptance failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.task !== "diagnose" || parsed.answer !== "acceptance answer" || result.stderr.includes("acceptance-secret") || result.stderr.includes("base64")) throw new Error("diagnose output acceptance failed");
  const setupConfig = join(root, "setup-config.json");
  const setup = await run(["setup", "--config-file", setupConfig, "--profile", "generic", "--base-url", `http://127.0.0.1:${port}/v1`, "--model", "mock", "--api-key", "acceptance-secret"]);
  if (setup.code !== 0 || setup.stdout.includes("acceptance-secret")) throw new Error("setup acceptance failed");
  const setupShow = await run(["config", "show", "--config-file", setupConfig]);
  if (setupShow.code !== 0 || !setupShow.stdout.includes("apiKeyConfigured") || setupShow.stdout.includes("acceptance-secret")) throw new Error("saved setup config acceptance failed");
  const show = await run(["config", "show"]);
  if (show.code !== 0 || show.stdout.includes("acceptance-secret") || !show.stdout.includes("apiKeyConfigured")) throw new Error("config acceptance failed");
  process.stdout.write("Acceptance scenarios passed: CLI help, mocked diagnose, JSON output, safe config display.\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
