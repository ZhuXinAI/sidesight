import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { resolveConfig, type ResolvedConfig } from "../config.js";
import { SideSightError, mediaError, securityError } from "./errors.js";
import { inspectImage, normalizeGif } from "./image.js";
import {
  assertMediaMime,
  canonicalAllowedDirectory,
  canonicalAllowedPath,
  contentLengthWithinLimit,
  detectMediaMime,
  imageMimeTypes,
  safeMediaLabel,
  safeChildEnv,
  validateRemoteUrl,
  videoMimeTypes,
} from "./security.js";
import type { LoadedImage, LoadedVideo } from "./types.js";

const execFileAsync = promisify(execFile);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function maxBytes(config: ResolvedConfig, kind: "image" | "video"): number {
  return Math.floor((kind === "image" ? config.maxImageMb : config.maxVideoMb) * 1024 * 1024);
}

function decodeDataUri(source: string): { mimeType: string; buffer: Buffer } {
  const match = source.match(/^data:([^;,\s]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw securityError("Only base64 data URIs with an explicit media MIME type are supported.");
  const encoded = match[2];
  const mimeType = match[1];
  if (!encoded || !mimeType) throw securityError("The data URI is missing a MIME type or payload.");
  const buffer = Buffer.from(encoded.replace(/\s/g, ""), "base64");
  if (buffer.length === 0) throw securityError("The data URI is empty.");
  return { mimeType, buffer };
}

function expectedKindFromMime(mimeType: string): "image" | "video" | undefined {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (imageMimeTypes.has(normalized)) return "image";
  if (videoMimeTypes.has(normalized)) return "video";
  return undefined;
}

async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const information = await stat(path);
  if (information.size > limit) throw securityError(`Media file exceeds the configured ${Math.round(limit / 1024 / 1024)} MB limit.`);
  return readFile(path);
}

async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  if (!contentLengthWithinLimit(response.headers.get("content-length"), limit)) throw securityError("Remote media exceeds the configured size limit.");
  if (!response.body) throw mediaError("Remote media response did not contain a body.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > limit) throw securityError("Remote media exceeds the configured size limit.");
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function fetchRemote(source: string, config: ResolvedConfig, expectedKind: "image" | "video"): Promise<{ buffer: Buffer; mimeType: string }> {
  let current = source;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const url = await validateRemoteUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
    try {
      const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { accept: "image/*,video/*;q=0.9,*/*;q=0.1" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw securityError("Remote media redirect did not include a location.");
        if (redirect === 5) throw securityError("Remote media exceeded the redirect limit.");
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw mediaError(`Remote media returned HTTP ${response.status}.`);
      const buffer = await readBoundedResponse(response, maxBytes(config, expectedKind));
      const detected = detectMediaMime(buffer);
      const headerMime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const mimeType = detected ?? headerMime;
      if (!mimeType) throw securityError("Remote media type could not be validated from its bytes or content type.");
      if (detected && headerMime && expectedKindFromMime(headerMime) && detected !== headerMime && !(detected === "image/jpeg" && headerMime === "image/jpg")) {
        throw securityError("Remote media content type does not match its bytes.");
      }
      assertMediaMime(mimeType, expectedKind);
      return { buffer, mimeType };
    } catch (error) {
      if (error instanceof SideSightError) throw error;
      throw mediaError(`Unable to download remote media: ${error instanceof Error ? error.message : String(error)}`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw securityError("Remote media redirect validation failed.");
}

async function loadClipboard(): Promise<Buffer> {
  if (process.platform === "darwin") {
    try {
      const result = await execFileAsync("pbpaste", ["-Prefer", "png"], { env: safeChildEnv(), maxBuffer: 20 * 1024 * 1024 });
      const buffer = Buffer.from(result.stdout, "binary");
      if (detectMediaMime(buffer) === "image/png") return buffer;
    } catch (error) {
      throw mediaError("Unable to read an image from the macOS clipboard. Install pngpaste or copy a bitmap image first.", error);
    }
  }
  throw mediaError("Clipboard image input is not supported on this platform. Use a local image path instead.");
}

async function findLatestImage(config: ResolvedConfig, cwd: string): Promise<string> {
  const directory = config.screenshotDir ?? join(cwd, "screenshots");
  const canonical = await canonicalAllowedDirectory(directory, config.allowedDirs, cwd);
  const entries = await readdir(canonical, { withFileTypes: true });
  const candidates: Array<{ path: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !imageExtensions.has(extname(entry.name).toLowerCase())) continue;
    const path = join(canonical, entry.name);
    const information = await stat(path);
    candidates.push({ path, mtime: information.mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const latest = candidates[0]?.path;
  if (!latest) throw mediaError(`No image files were found in ${canonical}.`);
  return latest;
}

async function assetFromBuffer(source: string, buffer: Buffer, declaredMime: string | undefined, expectedKind: "image" | "video", config: ResolvedConfig): Promise<LoadedImage | LoadedVideo> {
  if (buffer.length > maxBytes(config, expectedKind)) throw securityError(`Media exceeds the configured ${expectedKind} size limit.`);
  const detectedMime = detectMediaMime(buffer);
  const mimeType = detectedMime ?? declaredMime;
  if (!mimeType) throw securityError("Media type could not be validated from its bytes.");
  assertMediaMime(mimeType, expectedKind);
  if (detectedMime && declaredMime && expectedKindFromMime(declaredMime) && detectedMime !== declaredMime && !(detectedMime === "image/jpeg" && declaredMime === "image/jpg")) {
    throw securityError("Media content type does not match its bytes.");
  }
  if (expectedKind === "image") {
    if (mimeType === "image/gif") return normalizeGif(buffer, source);
    return inspectImage(buffer, source, mimeType);
  }
  return { source, kind: "video", mimeType, buffer };
}

export async function loadMedia(
  source: string,
  config: ResolvedConfig,
  expectedKind: "image" | "video" | "auto" = "auto",
  cwd = process.cwd(),
): Promise<LoadedImage | LoadedVideo> {
  const isUrl = /^https?:\/\//i.test(source);
  let buffer: Buffer;
  let declaredMime: string | undefined;
  let canonicalSource = source;
  if (/^data:/i.test(source)) {
    const data = decodeDataUri(source);
    buffer = data.buffer;
    declaredMime = data.mimeType;
  } else if (isUrl) {
    const remoteKind = expectedKind === "auto" ? "image" : expectedKind;
    const remote = await fetchRemote(source, config, remoteKind);
    buffer = remote.buffer;
    declaredMime = remote.mimeType;
  } else {
    const path = source === "clipboard" ? undefined : source === "latest" ? await findLatestImage(config, cwd) : await canonicalAllowedPath(source, config.allowedDirs, cwd);
    canonicalSource = path ?? source;
    buffer = path ? await readBoundedFile(path, maxBytes(config, expectedKind === "video" ? "video" : "image")) : await loadClipboard();
    declaredMime = detectMediaMime(buffer);
  }
  const detected = detectMediaMime(buffer);
  const actualKind = expectedKindFromMime(detected ?? declaredMime ?? "");
  const kind = expectedKind === "auto" ? actualKind : expectedKind;
  if (!kind) throw securityError(`Unsupported or unknown media format for ${source}.`);
  if (actualKind && actualKind !== kind) throw securityError(`Expected ${kind} media but received ${actualKind}.`);
  return assetFromBuffer(safeMediaLabel(canonicalSource), buffer, declaredMime, kind, config);
}

export async function loadImages(sources: string[], config: ResolvedConfig, cwd = process.cwd()): Promise<LoadedImage[]> {
  const assets = await Promise.all(sources.map((source) => loadMedia(source, config, "image", cwd)));
  return assets as LoadedImage[];
}

export async function loadVideo(source: string, config: ResolvedConfig, cwd = process.cwd()): Promise<LoadedVideo> {
  const asset = await loadMedia(source, config, "video", cwd);
  return asset as LoadedVideo;
}

export async function configForMedia(): Promise<ResolvedConfig> {
  return resolveConfig();
}
