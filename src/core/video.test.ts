import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveConfig } from "../config.js";
import { loadVideo } from "./media.js";
import { sampleVideoFrames } from "./video.js";

const execFileAsync = promisify(execFile);

describe("video frame handling", () => {
  it("samples a bounded ordered frame sequence when ffmpeg is available", async () => {
    try {
      await execFileAsync("ffmpeg", ["-version"], { maxBuffer: 100_000 });
    } catch {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "sidesight-video-test-"));
    try {
      const path = join(directory, "clip.mp4");
      await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=32x24:r=4", "-t", "0.75", "-pix_fmt", "yuv420p", path], { maxBuffer: 100_000 });
      const config = await resolveConfig({}, { SIDESIGHT_PROFILE: "generic", SIDESIGHT_ALLOWED_DIRS: directory, SIDESIGHT_CONFIG_FILE: join(directory, "config.json") }, directory);
      const video = await loadVideo(path, config, directory);
      const frames = await sampleVideoFrames(video, 3);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(3);
      expect(frames.map((frame) => frame.timestampSeconds)).toEqual([...frames].sort((a, b) => a.timestampSeconds - b.timestampSeconds).map((frame) => frame.timestampSeconds));
      expect(frames[0]?.source).toContain("clip.mp4 @");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
