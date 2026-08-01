import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { mediaError } from "./errors.js";
import { safeChildEnv } from "./security.js";
import type { LoadedVideo, ProviderImage } from "./types.js";

export interface VideoFrame {
  timestampSeconds: number;
  image: Buffer;
  source: string;
}

function resolveFfmpeg(configured?: string): string {
  return configured ?? "ffmpeg";
}

async function runProcess(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: safeChildEnv(), stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    child.once("error", (error) => reject(error));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code ?? "unknown"}`)));
  });
}

export async function probeVideoDuration(video: LoadedVideo, ffmpegPath?: string): Promise<number | undefined> {
  const command = ffmpegPath && /ffprobe(?:\.exe)?$/i.test(ffmpegPath) ? ffmpegPath : "ffprobe";
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "-i", "pipe:0"], { env: safeChildEnv(), stdio: ["pipe", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error("ffprobe failed")));
      child.stdin.end(video.buffer);
    });
    const duration = Number.parseFloat(output.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  } catch {
    return undefined;
  }
}

export async function sampleVideoFrames(video: LoadedVideo, count: number, ffmpegPath?: string): Promise<VideoFrame[]> {
  const requested = Math.max(1, Math.min(32, Math.floor(count)));
  const directory = await mkdtemp(join(tmpdir(), "sidesight-video-"));
  const input = join(directory, "input");
  const pattern = join(directory, "frame-%03d.png");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(input, video.buffer, { mode: 0o600 });
    const duration = await probeVideoDuration(video, ffmpegPath);
    const filter = duration ? `fps=${requested}/${Math.max(0.1, duration)}` : "select=not(mod(n\\,1))";
    await runProcess(resolveFfmpeg(ffmpegPath), ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", filter, "-frames:v", String(requested), "-vsync", "vfr", pattern]);
    const files = (await readdir(directory)).filter((file) => /^frame-\d+\.png$/.test(file)).sort();
    if (files.length === 0) throw new Error("ffmpeg produced no frames");
    return await Promise.all(files.map(async (file, index) => ({
      timestampSeconds: duration ? (index / Math.max(1, files.length - 1)) * duration : index,
      image: await readFile(join(directory, file)),
      source: `${video.source} @ ${duration ? ((index / Math.max(1, files.length - 1)) * duration).toFixed(2) : index.toFixed(2)}s`,
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT" || /not found|spawn ffmpeg/i.test(message)) {
      throw mediaError("Video analysis needs ffmpeg. Install ffmpeg and make it available on PATH, or set SIDESIGHT_FFMPEG_PATH.", error);
    }
    throw mediaError(`Unable to sample video frames: ${message}`, error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function framesToProviderImages(frames: VideoFrame[], maxImages: number): ProviderImage[] {
  return frames.slice(0, maxImages).map((frame) => ({ data: frame.image, mimeType: "image/png", source: frame.source, detail: "high" as const }));
}
