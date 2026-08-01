#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
if (process.env.SIDESIGHT_LIVE_TEST !== "1") {
  process.stdout.write("Live SideSight checks skipped; set SIDESIGHT_LIVE_TEST=1 to opt in.\n");
  process.exit(0);
}
if (!process.env.SIDESIGHT_API_KEY || !process.env.SIDESIGHT_BASE_URL || !process.env.SIDESIGHT_MODEL) {
  process.stdout.write("Live SideSight checks skipped; set SIDESIGHT_API_KEY, SIDESIGHT_BASE_URL, and SIDESIGHT_MODEL.\n");
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "sidesight-live-"));
const image = join(root, "probe.png");
const secondImage = join(root, "probe-actual.png");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
await writeFile(image, png);
await writeFile(secondImage, png);
const executable = join(process.cwd(), "dist", "cli.js");
const safeEnvironment = {
  PATH: process.env.PATH,
  SIDESIGHT_API_KEY: process.env.SIDESIGHT_API_KEY,
  SIDESIGHT_BASE_URL: process.env.SIDESIGHT_BASE_URL,
  SIDESIGHT_MODEL: process.env.SIDESIGHT_MODEL,
  SIDESIGHT_PROFILE: process.env.SIDESIGHT_PROFILE,
  SIDESIGHT_ALLOWED_DIRS: root,
  SIDESIGHT_CONFIG_FILE: join(root, "config.json"),
};

async function run(command, sources) {
  const result = await execFileAsync(process.execPath, [executable, command, ...sources, "--detail", "overview", "--format", "json", "--question", "Return only visible evidence."], { cwd: root, env: safeEnvironment, maxBuffer: 4_000_000 });
  const parsed = JSON.parse(result.stdout);
  if (parsed.task !== command) throw new Error(`${command} returned task ${parsed.task}`);
}

try {
  const tasks = ["image", "ui", "ocr", "diagnose", "diagram", "chart"];
  for (const task of tasks) {
    await run(task, [image]);
    process.stdout.write(`live ${task}: passed\n`);
  }
  await run("diff", [image, secondImage]);
  process.stdout.write("live diff: passed\n");
  let videoReady = true;
  const video = join(root, "probe.mp4");
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=2", "-t", "0.5", "-pix_fmt", "yuv420p", video], { maxBuffer: 100_000 });
  } catch {
    videoReady = false;
  }
  if (videoReady) {
    await run("video", [video]);
    process.stdout.write("live video: passed\n");
  } else {
    process.stdout.write("live video: skipped because ffmpeg is unavailable\n");
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
