import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "sidesight-acceptance-"));
const image = join(root, "error.png");
const ocrImage = join(root, "ocr.png");
await writeFile(image, await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } } }).png().toBuffer());
await writeFile(ocrImage, await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180"><rect width="640" height="180" fill="white"/><text x="24" y="115" font-family="Arial" font-size="72" fill="black">SIDESIGHT</text></svg>')).png().toBuffer());
let providerRequests = 0;
const server = createServer((incoming, outgoing) => {
  const chunks = [];
  incoming.on("data", (chunk) => chunks.push(chunk));
  incoming.on("end", () => {
    providerRequests += 1;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "acceptance answer", confidence: 0.96, warnings: [], evidence: [] }) } }] }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

function run(args, input, environment = {}) {
  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env, SIDESIGHT_PROFILE: "generic", SIDESIGHT_BASE_URL: `http://127.0.0.1:${port}/v1`, SIDESIGHT_MODEL: "mock", SIDESIGHT_API_KEY: "acceptance-secret", SIDESIGHT_ALLOWED_DIRS: root, SIDESIGHT_CONFIG_FILE: join(root, "config.json"), ...environment };
    for (const [key, value] of Object.entries(environment)) {
      if (value === null) delete childEnvironment[key];
    }
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], { cwd: root, env: childEnvironment });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
    if (input !== undefined) child.stdin.end(input);
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
  const requestsBeforeLocal = providerRequests;
  const swiftAvailable = process.platform === "darwin" && await execFileAsync("swift", ["--version"], { maxBuffer: 1_000_000 }).then(() => true).catch(() => false);
  const localEnvironment = { SIDESIGHT_PROFILE: null, SIDESIGHT_BASE_URL: null, SIDESIGHT_MODEL: null, SIDESIGHT_API_KEY: null };
  if (swiftAvailable) {
    for (const localArgs of [["--provider", "local"], ["--offline"], ["--ocr-backend", "system"]]) {
      const local = await run(["ocr", ocrImage, ...localArgs, "--format", "json"], undefined, localEnvironment);
      if (local.code !== 0) throw new Error(`local OCR acceptance failed: ${local.stderr}`);
      const localParsed = JSON.parse(local.stdout);
      if (localParsed.task !== "ocr" || localParsed.provider !== "local" || localParsed.model !== "macos-vision" || !/sidesight/i.test(localParsed.answer)) throw new Error("local OCR output acceptance failed");
    }
    if (providerRequests !== requestsBeforeLocal) throw new Error("local OCR unexpectedly called the cloud provider");
  } else {
    const local = await run(["ocr", ocrImage, "--provider", "local", "--format", "json"], undefined, localEnvironment);
    if (process.platform === "darwin") {
      if (local.code === 0 || !/Swift|runtime|Xcode|Vision/i.test(local.stderr)) throw new Error("missing macOS OCR runtime was not reported clearly");
    } else if (local.code === 0 || !/macOS Vision|local/i.test(local.stderr)) {
      throw new Error("unsupported local OCR platform acceptance failed");
    }
    if (providerRequests !== requestsBeforeLocal) throw new Error("local OCR unexpectedly called the cloud provider");
  }
  const setupConfig = join(root, "setup-config.json");
  const setup = await run(["setup", "--config-file", setupConfig, "--profile", "generic", "--base-url", `http://127.0.0.1:${port}/v1`, "--model", "mock", "--api-key", "acceptance-secret"]);
  if (setup.code !== 0 || setup.stdout.includes("acceptance-secret")) throw new Error("setup acceptance failed");
  const setupShow = await run(["config", "show", "--config-file", setupConfig]);
  if (setupShow.code !== 0 || !setupShow.stdout.includes("apiKeyConfigured") || setupShow.stdout.includes("acceptance-secret")) throw new Error("saved setup config acceptance failed");
  const interactiveConfig = join(root, "interactive-config.json");
  const interactive = await run(["setup"], `http://127.0.0.1:${port}/v1\ninteractive-model\ninteractive-secret\n`, { SIDESIGHT_CONFIG_FILE: interactiveConfig });
  if (interactive.code !== 0 || !interactive.stdout.includes("Base URL") || !interactive.stdout.includes("Model") || !interactive.stdout.includes("API key") || interactive.stdout.includes("interactive-secret")) throw new Error("interactive setup acceptance failed");
  const interactiveSaved = JSON.parse(await readFile(interactiveConfig, "utf8"));
  if (interactiveSaved.model !== "interactive-model" || interactiveSaved.apiKey !== "interactive-secret") throw new Error("interactive setup persistence acceptance failed");
  const show = await run(["config", "show"]);
  if (show.code !== 0 || show.stdout.includes("acceptance-secret") || !show.stdout.includes("apiKeyConfigured")) throw new Error("config acceptance failed");
  process.stdout.write(`Acceptance scenarios passed: CLI help, mocked diagnose, JSON output, ${swiftAvailable ? "native OCR, " : "local OCR platform guard, "}interactive setup, safe config display.\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
