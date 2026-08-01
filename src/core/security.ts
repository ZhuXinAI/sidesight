import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { securityError } from "./errors.js";

export const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const videoMimeTypes = new Set(["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"]);

export function isPathInside(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export async function canonicalAllowedPath(input: string, allowedDirectories: string[], cwd = process.cwd()): Promise<string> {
  if (!input || input.startsWith("data:") || /^https?:\/\//i.test(input)) {
    throw securityError("A local media path is required for canonical path validation.");
  }
  const candidate = resolve(cwd, input);
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    throw securityError(`Media path does not exist: ${input}`, error);
  }
  const canonicalAllowed = await Promise.all(
    (allowedDirectories.length > 0 ? allowedDirectories : [cwd]).map(async (directory) => {
      try {
        return await realpath(resolve(cwd, directory));
      } catch (error) {
        throw securityError(`Allowed directory does not exist: ${directory}`, error);
      }
    }),
  );
  if (!canonicalAllowed.some((directory) => isPathInside(directory, canonicalCandidate))) {
    throw securityError(`Media path is outside the configured allowed directories: ${input}`);
  }
  const information = await stat(canonicalCandidate);
  if (!information.isFile()) throw securityError(`Media path is not a regular file: ${input}`);
  return canonicalCandidate;
}

export async function canonicalAllowedDirectory(input: string, allowedDirectories: string[], cwd = process.cwd()): Promise<string> {
  const candidate = resolve(cwd, input);
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    throw securityError(`Directory does not exist: ${input}`, error);
  }
  const canonicalAllowed = await Promise.all(
    (allowedDirectories.length > 0 ? allowedDirectories : [cwd]).map(async (directory) => realpath(resolve(cwd, directory))),
  );
  if (!canonicalAllowed.some((directory) => isPathInside(directory, canonicalCandidate))) {
    throw securityError(`Directory is outside the configured allowed directories: ${input}`);
  }
  const information = await stat(canonicalCandidate);
  if (!information.isDirectory()) throw securityError(`Path is not a directory: ${input}`);
  return canonicalCandidate;
}

function parseIPv4(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined;
}

function isPrivateIPv4(address: string): boolean {
  const parts = parseIPv4(address);
  if (!parts) return false;
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return first === 0 || first === 10 || first === 127 || (first === 100 && second !== undefined && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168) || first >= 224;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1] ?? "") : false;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? isPrivateIPv4(address) : version === 6 ? isPrivateIPv6(address) : false;
}

export interface SafeUrlOptions {
  lookupFn?: typeof lookup;
}

export async function validateRemoteUrl(raw: string, options: SafeUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw securityError("Remote media URL is invalid.", error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw securityError("Only HTTP and HTTPS media URLs are allowed.");
  if (url.username || url.password) throw securityError("Remote media URLs may not contain credentials.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal" || hostname === "metadata.google.com") {
    throw securityError("Localhost and cloud metadata media URLs are not allowed.");
  }
  if (isPrivateAddress(hostname)) throw securityError("Private-network media URLs are not allowed.");
  const lookupFn = options.lookupFn ?? lookup;
  try {
    const records = await lookupFn(hostname, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
      throw securityError("Remote media URL resolves to a private or local network address.");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "SideSightError") throw error;
    throw securityError(`Unable to validate the remote media host ${hostname}.`, error);
  }
  return url;
}

export function detectMediaMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")) return "image/gif";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    return brand === "qt  " ? "video/quicktime" : brand === "M4V " ? "video/x-m4v" : "video/mp4";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  return undefined;
}

export function safeMediaLabel(source: string): string {
  return /^data:/i.test(source) ? "[data URI media]" : source;
}

export function safeChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "ComSpec", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) {
    const value = env[key];
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}

export function assertMediaMime(mimeType: string, kind: "image" | "video"): string {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const allowed = kind === "image" ? imageMimeTypes : videoMimeTypes;
  if (!allowed.has(normalized)) throw securityError(`Unsupported ${kind} MIME type: ${mimeType}`);
  return normalized;
}

export function contentLengthWithinLimit(value: string | null, limit: number): boolean {
  if (!value) return true;
  const length = Number(value);
  return Number.isFinite(length) && length >= 0 && length <= limit;
}

export function safeTemporaryPath(baseDirectory: string, name: string): string {
  const candidate = resolve(baseDirectory, name);
  if (!isPathInside(resolve(baseDirectory), candidate)) throw securityError("Temporary file path escaped its directory.");
  return candidate;
}
