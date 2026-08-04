import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import type { ResolvedConfig } from "../config.js";
import { cropFromOriginal } from "../core/image.js";
import { loadImages } from "../core/media.js";
import { localBackendError, mediaError } from "../core/errors.js";
import { validateNormalizedRegion } from "../core/image.js";
import { safeChildEnv, safeMediaLabel } from "../core/security.js";
import { regionSchema, type LoadedImage, type NormalizedRegion, type VisionRequest, type VisionResult } from "../core/types.js";

const execFileAsync = promisify(execFile);
const localOcrScript = join(dirname(fileURLToPath(import.meta.url)), "macos-vision-ocr.swift");

const localOcrItemSchema = z.object({
  text: z.string().min(1).max(20_000),
  confidence: z.number().finite().min(0).max(1).optional(),
  box: regionSchema.optional(),
}).strict();

const localOcrPayloadSchema = z.object({
  backend: z.string().min(1).max(100),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  items: z.array(localOcrItemSchema).max(10_000),
}).strict();

export type LocalOcrPayload = z.infer<typeof localOcrPayloadSchema>;

export interface LocalOcrRunnerInput {
  buffer: Buffer;
  source: string;
  timeoutMs: number;
}

export type LocalOcrRunner = (input: LocalOcrRunnerInput) => Promise<LocalOcrPayload>;

function parseLocalOcrPayload(output: string): LocalOcrPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw localBackendError("The on-device OCR backend returned invalid JSON.", error);
  }
  const result = localOcrPayloadSchema.safeParse(parsed);
  if (!result.success) throw localBackendError("The on-device OCR backend returned an invalid result structure.");
  return result.data;
}

export async function runMacOsVisionOcr(input: LocalOcrRunnerInput): Promise<LocalOcrPayload> {
  if (process.platform !== "darwin") {
    throw localBackendError("On-device OCR currently uses macOS Vision. On this platform, use cloud setup or install a supported local OCR backend.");
  }
  try {
    await access(localOcrScript);
  } catch (error) {
    throw localBackendError("The macOS Vision OCR runtime asset is missing. Reinstall the SideSight package.", error);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "sidesight-local-ocr-"));
  const imagePath = join(temporaryDirectory, "input.png");
  try {
    await writeFile(imagePath, input.buffer, { encoding: "binary", mode: 0o600 });
    const result = await execFileAsync("swift", [localOcrScript, imagePath], {
      env: safeChildEnv(),
      timeout: Math.max(1_000, input.timeoutMs),
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return parseLocalOcrPayload(result.stdout);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw localBackendError("Swift is unavailable. Install the Xcode Command Line Tools, then retry local OCR.", error);
    }
    if (error instanceof Error && "killed" in error && error.killed) {
      throw localBackendError("On-device OCR timed out. Try a smaller image or increase --timeout.", error);
    }
    if (error instanceof Error && error.name === "SideSightError") throw error;
    throw localBackendError("macOS Vision OCR failed. Check the image and the Xcode Command Line Tools installation.", error);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function mapRegion(inner: NormalizedRegion, outer: NormalizedRegion | undefined): NormalizedRegion {
  if (!outer) return inner;
  return validateNormalizedRegion({
    x: outer.x + inner.x * outer.width,
    y: outer.y + inner.y * outer.height,
    width: inner.width * outer.width,
    height: inner.height * outer.height,
  });
}

function metadataForImage(image: LoadedImage): VisionResult["media"][number] {
  return { source: safeMediaLabel(image.source), mimeType: image.mimeType, width: image.width, height: image.height };
}

export async function analyzeLocalOcr(
  request: VisionRequest,
  config: ResolvedConfig,
  runner: LocalOcrRunner = runMacOsVisionOcr,
): Promise<VisionResult> {
  if (request.task !== "ocr") throw mediaError("The local backend currently supports OCR only. Use cloud setup for other visual tasks.");
  const images = await loadImages(request.sources, config);
  const image = images[0];
  if (!image) throw mediaError("Local OCR expects one image source.");
  const crop = request.region ? await cropFromOriginal(image, request.region) : undefined;
  const payload = await runner({
    buffer: crop?.image ?? image.buffer,
    source: crop ? `${image.source} region` : image.source,
    timeoutMs: (request.timeoutSeconds ?? config.timeoutSeconds) * 1000,
  });
  const items = payload.items.filter((item) => item.text.trim().length > 0);
  const answer = items.map((item) => item.text.trim()).join("\n") || "No visible text detected.";
  const evidence = items.map((item) => ({
    description: `On-device OCR: ${item.text.trim()}`,
    ...(item.box ? { region: mapRegion(item.box, crop?.region) } : {}),
  }));
  const confidences = items.flatMap((item) => item.confidence === undefined ? [] : [item.confidence]);
  const warnings = items.length === 0 ? ["The on-device OCR backend did not detect visible text."] : [];
  const result: VisionResult = {
    task: "ocr",
    answer,
    warnings,
    evidence,
    rounds: 0,
    provider: "local",
    model: payload.backend,
    media: [metadataForImage(image)],
  };
  if (confidences.length > 0) result.confidence = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  return result;
}
