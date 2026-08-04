import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { configError } from "./core/errors.js";

export interface ProfileDefaults {
  name: string;
  baseUrl: string;
  model: string;
  supportsNativeVideo: boolean;
}

export const profileDefaults: Record<string, ProfileDefaults> = {
  "opencode-go": {
    name: "opencode-go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    model: "mimo-v2.5",
    supportsNativeVideo: false,
  },
  generic: {
    name: "generic",
    baseUrl: "http://localhost:8000/v1",
    model: "vision-model",
    supportsNativeVideo: false,
  },
  local: {
    name: "local",
    baseUrl: "http://local.invalid",
    model: "macos-vision",
    supportsNativeVideo: false,
  },
};

export interface UserConfigFile {
  profile?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  allowedDirs?: string[];
  maxImageMb?: number;
  maxVideoMb?: number;
  maxZoomRounds?: number;
  maxImages?: number;
  maxOverviewEdge?: number;
  videoFrames?: number;
  timeoutSeconds?: number;
  screenshotDir?: string;
  allowUrlPassthrough?: boolean;
  ffmpegPath?: string;
}

export interface ResolvedConfig {
  profile: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  allowedDirs: string[];
  maxImageMb: number;
  maxVideoMb: number;
  maxZoomRounds: number;
  maxImages: number;
  maxOverviewEdge: number;
  videoFrames: number;
  timeoutSeconds: number;
  maxTokens: number;
  screenshotDir?: string;
  allowUrlPassthrough: boolean;
  ffmpegPath?: string;
  configFile: string;
  supportsNativeVideo: boolean;
}

export interface ConfigOverrides {
  profile?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  allowedDirs?: string[];
  maxImageMb?: number;
  maxVideoMb?: number;
  maxZoomRounds?: number;
  maxImages?: number;
  maxOverviewEdge?: number;
  videoFrames?: number;
  timeoutSeconds?: number;
  maxTokens?: number;
  screenshotDir?: string;
  allowUrlPassthrough?: boolean;
  ffmpegPath?: string;
}

const userConfigSchema = z.object({
  profile: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  allowedDirs: z.array(z.string().min(1)).optional(),
  maxImageMb: z.number().positive().optional(),
  maxVideoMb: z.number().positive().optional(),
  maxZoomRounds: z.number().nonnegative().optional(),
  maxImages: z.number().positive().optional(),
  maxOverviewEdge: z.number().positive().optional(),
  videoFrames: z.number().positive().optional(),
  timeoutSeconds: z.number().positive().optional(),
  screenshotDir: z.string().min(1).optional(),
  allowUrlPassthrough: z.boolean().optional(),
  ffmpegPath: z.string().min(1).optional(),
}).strict();

function parseNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw configError(`${name} must be a positive number.`);
  return value;
}

function parseBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw configError(`${name} must be true or false.`);
}

export function getConfigFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SIDESIGHT_CONFIG_FILE) return env.SIDESIGHT_CONFIG_FILE;
  if (env.SIDESIGHT_CONFIG_DIR) return join(env.SIDESIGHT_CONFIG_DIR, "config.json");
  return join(homedir(), ".sidesight", "config.json");
}

export async function readUserConfig(path: string): Promise<UserConfigFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = userConfigSchema.safeParse(parsed);
    if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; "));
    return result.data;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw configError(`Unable to read config file ${path}: ${error instanceof Error ? error.message : String(error)}`, error);
  }
}

export async function writeUserConfig(path: string, config: UserConfigFile): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function envAllowedDirs(env: NodeJS.ProcessEnv): string[] | undefined {
  const raw = env.SIDESIGHT_ALLOWED_DIRS;
  if (!raw) return undefined;
  return raw.split(delimiter).map((item) => item.trim()).filter(Boolean);
}

export async function resolveConfig(
  overrides: ConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<ResolvedConfig> {
  const configFile = getConfigFilePath(env);
  const user = await readUserConfig(configFile);
  const profileName = overrides.profile ?? env.SIDESIGHT_PROFILE ?? user.profile ?? "opencode-go";
  const profile = profileDefaults[profileName] ?? {
    name: profileName,
    baseUrl: "",
    model: "",
    supportsNativeVideo: false,
  };
  const allowedDirs = overrides.allowedDirs ?? envAllowedDirs(env) ?? user.allowedDirs ?? [cwd];
  const baseUrl = overrides.baseUrl ?? env.SIDESIGHT_BASE_URL ?? user.baseUrl ?? profile.baseUrl;
  const model = overrides.model ?? env.SIDESIGHT_MODEL ?? user.model ?? profile.model;
  if (!baseUrl) throw configError(`Profile ${profileName} has no base URL. Set SIDESIGHT_BASE_URL.`);
  if (!model) throw configError(`Profile ${profileName} has no model. Set SIDESIGHT_MODEL.`);
  try {
    const parsedBaseUrl = new URL(baseUrl);
    if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") throw new Error("base URL must use http or https");
    if (parsedBaseUrl.username || parsedBaseUrl.password) throw new Error("base URL must not contain embedded credentials");
  } catch (error) {
    throw configError(`Invalid provider base URL: ${error instanceof Error ? error.message : String(error)}`, error);
  }

  const maxImageMb = overrides.maxImageMb ?? parseNumber("SIDESIGHT_MAX_IMAGE_MB", env.SIDESIGHT_MAX_IMAGE_MB, user.maxImageMb ?? 10);
  const maxVideoMb = overrides.maxVideoMb ?? parseNumber("SIDESIGHT_MAX_VIDEO_MB", env.SIDESIGHT_MAX_VIDEO_MB, user.maxVideoMb ?? 50);
  const maxZoomRounds = overrides.maxZoomRounds ?? parseNumber("SIDESIGHT_MAX_ZOOM_ROUNDS", env.SIDESIGHT_MAX_ZOOM_ROUNDS, user.maxZoomRounds ?? 3);
  const maxImages = overrides.maxImages ?? parseNumber("SIDESIGHT_MAX_IMAGES", env.SIDESIGHT_MAX_IMAGES, user.maxImages ?? 8);
  const maxOverviewEdge = overrides.maxOverviewEdge ?? parseNumber("SIDESIGHT_MAX_EDGE_PX", env.SIDESIGHT_MAX_EDGE_PX, user.maxOverviewEdge ?? 1568);
  const videoFrames = overrides.videoFrames ?? parseNumber("SIDESIGHT_VIDEO_FRAMES", env.SIDESIGHT_VIDEO_FRAMES, user.videoFrames ?? 8);
  const timeoutSeconds = overrides.timeoutSeconds ?? parseNumber("SIDESIGHT_TIMEOUT_SECONDS", env.SIDESIGHT_TIMEOUT_SECONDS, user.timeoutSeconds ?? 120);
  const maxTokens = overrides.maxTokens ?? parseNumber("SIDESIGHT_MAX_TOKENS", env.SIDESIGHT_MAX_TOKENS, 2_000);
  const allowUrlPassthrough = overrides.allowUrlPassthrough ?? parseBoolean("SIDESIGHT_ALLOW_URL_PASSTHROUGH", env.SIDESIGHT_ALLOW_URL_PASSTHROUGH, user.allowUrlPassthrough ?? false);

  return {
    profile: profileName,
    baseUrl,
    model,
    apiKey: overrides.apiKey ?? env.SIDESIGHT_API_KEY ?? env.Z_AI_API_KEY ?? user.apiKey,
    allowedDirs,
    maxImageMb,
    maxVideoMb,
    maxZoomRounds: Math.floor(maxZoomRounds),
    maxImages: Math.floor(maxImages),
    maxOverviewEdge: Math.floor(maxOverviewEdge),
    videoFrames: Math.floor(videoFrames),
    timeoutSeconds,
    maxTokens: Math.floor(maxTokens),
    screenshotDir: overrides.screenshotDir ?? env.SIDESIGHT_DROP_DIR ?? user.screenshotDir,
    allowUrlPassthrough,
    ffmpegPath: overrides.ffmpegPath ?? env.SIDESIGHT_FFMPEG_PATH ?? user.ffmpegPath,
    configFile,
    supportsNativeVideo: profile.supportsNativeVideo,
  };
}

export function publicConfig(config: ResolvedConfig): Record<string, unknown> {
  return {
    profile: config.profile,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    allowedDirs: config.allowedDirs,
    maxImageMb: config.maxImageMb,
    maxVideoMb: config.maxVideoMb,
    maxZoomRounds: config.maxZoomRounds,
    maxImages: config.maxImages,
    maxOverviewEdge: config.maxOverviewEdge,
    videoFrames: config.videoFrames,
    timeoutSeconds: config.timeoutSeconds,
    maxTokens: config.maxTokens,
    screenshotDir: config.screenshotDir,
    allowUrlPassthrough: config.allowUrlPassthrough,
    ffmpegPath: config.ffmpegPath,
    configFile: config.configFile,
  };
}

export const runtimeDefaults = { tempDirectory: tmpdir() };
