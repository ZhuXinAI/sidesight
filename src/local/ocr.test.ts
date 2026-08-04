import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { resolveConfig } from "../config.js";
import { VisionEngine } from "../core/engine.js";
import type { ProviderResponse, VisionProvider } from "../core/types.js";

describe("local OCR backend", () => {
  it("uses injected on-device OCR without calling the cloud provider and maps crop evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sidesight-local-ocr-test-"));
    try {
      const imagePath = join(directory, "screenshot.png");
      await writeFile(imagePath, await sharp({ create: { width: 100, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer());
      const config = await resolveConfig({}, { SIDESIGHT_PROFILE: "local", SIDESIGHT_ALLOWED_DIRS: directory, SIDESIGHT_CONFIG_FILE: join(directory, "config.json") }, directory);
      const cloudProvider: VisionProvider = {
        name: "cloud",
        model: "vision-model",
        supportsNativeVideo: false,
        analyze: vi.fn(async (): Promise<ProviderResponse> => ({ text: JSON.stringify({ answer: "cloud should not run" }) })),
      };
      const runner = vi.fn(async () => ({
        backend: "macos-vision",
        width: 50,
        height: 40,
        items: [{ text: "Save", confidence: 0.92, box: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } }],
      }));

      const result = await new VisionEngine(config, cloudProvider, runner).analyze({
        task: "ocr",
        backend: "local",
        sources: [imagePath],
        detail: "fine",
        region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      });

      expect(result).toMatchObject({ task: "ocr", answer: "Save", provider: "local", model: "macos-vision", confidence: 0.92 });
      expect(result.evidence[0]?.region).toEqual({ x: 0.3, y: 0.35, width: 0.25, height: 0.2 });
      expect(runner).toHaveBeenCalledOnce();
      expect(cloudProvider.analyze).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports an actionable empty-text warning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sidesight-local-ocr-empty-"));
    try {
      const imagePath = join(directory, "blank.png");
      await writeFile(imagePath, await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer());
      const config = await resolveConfig({}, { SIDESIGHT_PROFILE: "local", SIDESIGHT_ALLOWED_DIRS: directory, SIDESIGHT_CONFIG_FILE: join(directory, "config.json") }, directory);
      const result = await new VisionEngine(config, undefined, async () => ({ backend: "macos-vision", width: 10, height: 10, items: [] })).analyze({ task: "ocr", backend: "local", sources: [imagePath], detail: "overview" });
      expect(result.answer).toBe("No visible text detected.");
      expect(result.warnings).toContain("The on-device OCR backend did not detect visible text.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
