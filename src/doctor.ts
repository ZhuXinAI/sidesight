import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import type { ResolvedConfig } from "./config.js";
import { VisionEngine } from "./core/engine.js";
import { formatMarkdown } from "./core/output.js";
import { safeChildEnv } from "./core/security.js";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail" | "skip";
  message: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

async function canRun(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { env: safeChildEnv(), stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function endpointReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, { method: "GET", signal: controller.signal });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDoctor(config: ResolvedConfig, live = false): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", status: major >= 22 ? "pass" : "fail", message: `Node.js ${process.versions.node} detected; SideSight requires Node.js 22 or newer.` });
  checks.push({ name: "configuration", status: config.baseUrl && config.model ? "pass" : "fail", message: `Profile ${config.profile}, model ${config.model || "<missing>"}, endpoint ${config.baseUrl || "<missing>"}.` });
  checks.push({ name: "api-key", status: config.apiKey ? "pass" : "warn", message: config.apiKey ? "An API key is configured without printing it." : "No SIDESIGHT_API_KEY is configured; provider calls may require authentication." });
  checks.push({ name: "endpoint", status: await endpointReachable(config.baseUrl, Math.min(config.timeoutSeconds * 1000, 5_000)) ? "pass" : "warn", message: "Provider endpoint responded to a non-billable reachability check." });
  try {
    const sample = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 40, b: 80, alpha: 1 } } }).png().toBuffer();
    checks.push({ name: "sharp", status: sample.length > 0 ? "pass" : "fail", message: "sharp can encode a deterministic test image." });
  } catch (error) {
    checks.push({ name: "sharp", status: "fail", message: `sharp is not functional: ${error instanceof Error ? error.message : String(error)}` });
  }
  checks.push({ name: "ffmpeg", status: await canRun(config.ffmpegPath ?? "ffmpeg") ? "pass" : "warn", message: config.ffmpegPath ? `Configured ffmpeg path: ${config.ffmpegPath}.` : "ffmpeg is optional for image work and required for frame-sampled video." });
  let allowedStatus: DoctorCheck["status"] = "pass";
  try {
    for (const directory of config.allowedDirs) await access(directory);
  } catch {
    allowedStatus = "fail";
  }
  checks.push({ name: "allowed-directories", status: allowedStatus, message: allowedStatus === "pass" ? `Allowed directories: ${config.allowedDirs.join(", ")}.` : "At least one configured allowed directory is not accessible." });
  const tempDirectory = await mkdtemp(join(dirname(config.configFile), "sidesight-doctor-"));
  try {
    const probe = join(tempDirectory, "probe");
    await writeFile(probe, "ok", { mode: 0o600 });
    await readFile(probe, "utf8");
    checks.push({ name: "temporary-directory", status: "pass", message: "The temporary directory is writable." });
  } catch (error) {
    checks.push({ name: "temporary-directory", status: "fail", message: `Temporary directory check failed: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
  if (!live) {
    checks.push({ name: "live-probe", status: "skip", message: "Skipped; use sidesight doctor --live to make a provider call." });
  } else if (!config.apiKey && !config.baseUrl.startsWith("http://localhost") && !config.baseUrl.startsWith("http://127.0.0.1")) {
    checks.push({ name: "live-probe", status: "skip", message: "Skipped because no API key is configured." });
  } else {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="white"/><text x="5" y="25" font-size="16">SIDESIGHT</text></svg>`;
      const image = await sharp(Buffer.from(svg)).png().toBuffer();
      const dataUri = `data:image/png;base64,${image.toString("base64")}`;
      const result = await new VisionEngine(config).analyze({ task: "ocr", sources: [dataUri], question: "Read the exact visible word.", detail: "overview" });
      checks.push({ name: "live-probe", status: /sidesight/i.test(result.answer) ? "pass" : "warn", message: "The multimodal provider responded to the deterministic image probe." });
    } catch (error) {
      checks.push({ name: "live-probe", status: "fail", message: `Live probe failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { checks };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = ["SideSight doctor", ""];
  for (const check of report.checks) lines.push(`${check.status.toUpperCase().padEnd(5)} ${check.name}: ${check.message}`);
  return `${lines.join("\n")}\n`;
}

export function doctorAsVisionResult(report: DoctorReport): string {
  return formatMarkdown({ task: "image", answer: formatDoctor(report).trim(), warnings: [], evidence: [], rounds: 0, provider: "local", model: "local", media: [] });
}
