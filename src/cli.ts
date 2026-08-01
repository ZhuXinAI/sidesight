#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { asSideSightError, redactSecrets, usageError } from "./core/errors.js";
import { parseRegion } from "./core/image.js";
import { detailLevelSchema, visionTaskIds, type DetailLevel, type VisionTaskId } from "./core/types.js";
import { formatJson, formatMarkdown } from "./core/output.js";
import { VisionEngine } from "./core/engine.js";
import { canonicalAllowedPath } from "./core/security.js";
import { getConfigFilePath, profileDefaults, readUserConfig, resolveConfig, publicConfig, writeUserConfig, type ConfigOverrides, type UserConfigFile } from "./config.js";
import { runDoctor, formatDoctor } from "./doctor.js";
import { runMcpServer } from "./mcp/server.js";
import { VERSION } from "./version.js";

export { VERSION };

type OptionValue = string | boolean;
export interface ParsedCliArgs {
  command?: string;
  positionals: string[];
  options: Map<string, OptionValue>;
}

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd?: string;
}

const valueOptions = new Set([
  "question", "instructions-file", "detail", "region", "format", "output", "model", "profile", "base-url", "api-key", "max-tokens", "timeout", "allowed-dir", "config-file", "ffmpeg-path",
]);

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const options = new Map<string, OptionValue>();
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) break;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const equals = withoutPrefix.indexOf("=");
      const rawName = equals >= 0 ? withoutPrefix.slice(0, equals) : withoutPrefix;
      const name = rawName.replaceAll("_", "-");
      if (!name) throw usageError("Option name cannot be empty.");
      if (valueOptions.has(name)) {
        const value = equals >= 0 ? withoutPrefix.slice(equals + 1) : argv[++index];
        if (!value) throw usageError(`Option --${name} requires a value.`);
        options.set(name, value);
      } else if (name === "help" || name === "version" || name === "verbose" || name === "quiet" || name === "live" || name === "force") {
        options.set(name, true);
      } else {
        throw usageError(`Unknown option --${name}. Run sidesight --help.`);
      }
    } else if (!command) {
      command = token;
    } else {
      positionals.push(token);
    }
  }
  return { command, positionals, options };
}

function option(args: ParsedCliArgs, name: string): string | undefined {
  const value = args.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function hasOption(args: ParsedCliArgs, name: string): boolean {
  return args.options.get(name) === true;
}

function environmentForArgs(args: ParsedCliArgs): NodeJS.ProcessEnv {
  const configFile = option(args, "config-file");
  return configFile ? { ...process.env, SIDESIGHT_CONFIG_FILE: configFile } : process.env;
}

const taskDescriptions: Record<VisionTaskId, string> = {
  image: "General image analysis",
  ui: "UI screenshot to implementation guidance",
  ocr: "Faithful visible-text extraction",
  diagnose: "Error screenshot diagnosis",
  diagram: "Technical diagram understanding",
  chart: "Chart and dashboard analysis",
  diff: "Expected versus actual UI comparison",
  video: "Video analysis with native input or bounded frames",
};

function commonOptionsText(): string {
  return `Common options:
  --question <text>          Focused question; use - to read it from stdin
  --instructions-file <path> Additional guidance without replacing safety rules
  --detail <auto|overview|normal|fine>
  --region <x,y,w,h>         Normalized 0..1 region from the full original
  --format <markdown|json>   Output format (default: markdown)
  --output <path>            Also save the rendered result
  --model <id>               Override SIDESIGHT_MODEL
  --profile <name>           Override SIDESIGHT_PROFILE
  --base-url <url>           Provider endpoint (setup or one command)
  --api-key <key>            Provider key (setup or one command; never printed)
  --allowed-dir <path>       Add the media directory to the allowlist
  --config-file <path>       Use a specific saved config file
  --ffmpeg-path <path>       Use a specific ffmpeg executable for video
  --max-tokens <number>      Provider output limit
  --timeout <seconds>        Provider/download timeout
  --verbose                  Progress goes to stderr
  --help`;
}

function mediaSourcesText(): string {
  return `Media sources:
  Local paths are preferred. HTTP(S) URLs, base64 data URIs, the literal
  clipboard source on macOS, and the literal latest source are also supported.
  Raw base64 without a data:<mime>;base64, prefix and host attachment objects
  must be exported to a path or converted to a data URI first.`;
}

function helpText(): string {
  return `SideSight ${VERSION} — vision sidecar for text-only coding agents.

Usage:
  sidesight <command> <media> [options]

Commands:
  setup [options]             Save provider settings in ~/.sidesight/config.json
  image <image>              General image analysis
  ui <image>                 UI screenshot to implementation guidance
  ocr <image>                Faithful visible-text extraction
  diagnose <image>           Error screenshot diagnosis
  diagram <image>            Technical diagram understanding
  chart <image>              Chart and dashboard analysis
  diff <expected> <actual>   Expected versus actual UI comparison
  video <video>              Video analysis with native input or bounded frames
  doctor [--live]            Setup diagnostics; live probe is opt-in
  config init                Create a non-secret user config template
  config show                Show resolved non-secret configuration
  mcp                       Run the optional stdio MCP server

Common options:
  --question <text>          Focused question; use - to read it from stdin
  --instructions-file <path> Additional guidance without replacing safety rules
  --detail <auto|overview|normal|fine>
  --region <x,y,w,h>         Normalized 0..1 region from the full original
  --format <markdown|json>   Output format (default: markdown)
  --output <path>            Also save the rendered result
  --model <id>               Override SIDESIGHT_MODEL
  --profile <name>           Override SIDESIGHT_PROFILE
  --base-url <url>           Provider endpoint (setup or one command)
  --api-key <key>            Provider key (setup or one command; never printed)
  --max-tokens <number>      Provider output limit
  --timeout <seconds>        Provider/download timeout
  --verbose                  Progress goes to stderr
  --help, --version

Configuration uses SIDESIGHT_API_KEY, SIDESIGHT_BASE_URL, SIDESIGHT_MODEL,
SIDESIGHT_PROFILE, SIDESIGHT_ALLOWED_DIRS, and other SIDESIGHT_* limits.

If provider setup is not complete, ask the user to run npx sidesight setup.
Do not search the filesystem, shell profiles, or unrelated files for keys.

Run sidesight <command> --help for command-specific help.
`;
}

function taskHelpText(command: VisionTaskId): string {
  const sourceUsage = command === "diff" ? "<expected> <actual>" : `<${command === "video" ? "video" : "image"}>`;
  return `SideSight ${command} — ${taskDescriptions[command]}.

Usage:
  sidesight ${command} ${sourceUsage} [options]

${mediaSourcesText()}

${commonOptionsText()}

Example:
  sidesight ${command} ${command === "diff" ? "reference.png actual.png" : `${command}.png`} --question "Ask a focused visual question"
`;
}

function commandHelpText(command: string, subcommand?: string): string {
  if (visionTaskIds.includes(command as VisionTaskId)) return taskHelpText(command as VisionTaskId);
  if (command === "setup") {
    return `SideSight setup — save provider settings for future commands.

Usage:
  sidesight setup [options]

Rerunnable setup preserves values omitted on later runs. API keys are stored
under the owner-only config file and are never printed.

Options:
  --profile <name>           Provider profile (default: opencode-go)
  --base-url <url>           OpenAI-compatible provider base URL
  --model <id>               Multimodal vision model identifier
  --api-key <key>            Provider key; never printed
  --allowed-dir <path>       Add the media directory to the allowlist
  --config-file <path>       Write to a specific config file
  --help

Example:
  npx sidesight setup --profile opencode-go --api-key "your-key"
`;
  }
  if (command === "config") {
    if (subcommand === "init") {
      return `SideSight config init — create a non-secret configuration template.

Usage:
  sidesight config init [--force] [--config-file <path>]

The command never writes an API key. Use sidesight setup for provider
credentials and sidesight config show to inspect redacted settings.
`;
    }
    if (subcommand === "show") {
      return `SideSight config show — display resolved non-secret configuration.

Usage:
  sidesight config show [--config-file <path>] [--profile <name>]

The output reports only whether an API key is configured; it never prints the
key itself.
`;
    }
    return `SideSight config — inspect or create saved configuration.

Usage:
  sidesight config <init|show> [options]

Subcommands:
  init                        Create a non-secret config template
  show                        Show resolved non-secret configuration

Run sidesight config <subcommand> --help for details.
`;
  }
  if (command === "doctor") {
    return `SideSight doctor — diagnose local setup without a model call by default.

Usage:
  sidesight doctor [--live] [--format <markdown|json>]

Use --live only when you want to send a small deterministic image to the
configured provider.
`;
  }
  if (command === "mcp") {
    return `SideSight mcp — run the optional stdio MCP server.

Usage:
  sidesight mcp [provider options]

Protocol messages are written to stdout. Diagnostics go to stderr. Provider
settings come from npx sidesight setup, environment variables, or flags.
`;
  }
  return helpText();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readQuestion(args: ParsedCliArgs): Promise<string | undefined> {
  const question = option(args, "question");
  return question === "-" ? readStdin() : question;
}

function parsePositiveOption(args: ParsedCliArgs, name: string): number | undefined {
  const raw = option(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw usageError(`--${name} must be a positive number.`);
  return value;
}

async function loadInstructions(args: ParsedCliArgs, configAllowedDirs: string[], cwd: string): Promise<string | undefined> {
  const path = option(args, "instructions-file");
  if (!path) return undefined;
  const canonical = await canonicalAllowedPath(path, configAllowedDirs, cwd);
  const content = await readFile(canonical, "utf8");
  if (content.length > 100_000) throw usageError("Instructions file must be 100 KB or smaller.");
  return content;
}

function configOverrides(args: ParsedCliArgs): ConfigOverrides {
  const allowedDir = option(args, "allowed-dir");
  return {
    profile: option(args, "profile"),
    baseUrl: option(args, "base-url"),
    model: option(args, "model"),
    apiKey: option(args, "api-key"),
    maxTokens: parsePositiveOption(args, "max-tokens"),
    timeoutSeconds: parsePositiveOption(args, "timeout"),
    allowedDirs: allowedDir ? [allowedDir] : undefined,
    ffmpegPath: option(args, "ffmpeg-path"),
  };
}

async function renderTask(args: ParsedCliArgs, command: VisionTaskId, io: CliIO): Promise<void> {
  const expected = command === "diff" ? 2 : 1;
  if (args.positionals.length !== expected) throw usageError(`${command} expects ${expected} media source${expected === 1 ? "" : "s"}.`);
  const config = await resolveConfig(configOverrides(args), environmentForArgs(args), io.cwd ?? process.cwd());
  const detailRaw = option(args, "detail") ?? "auto";
  const detailResult = detailLevelSchema.safeParse(detailRaw);
  if (!detailResult.success) throw usageError("--detail must be auto, overview, normal, or fine.");
  const detail: DetailLevel = detailResult.data;
  const regionValue = option(args, "region");
  const region = regionValue ? parseRegion(regionValue) : undefined;
  const instructions = await loadInstructions(args, config.allowedDirs, io.cwd ?? process.cwd());
  const question = await readQuestion(args);
  const engine = new VisionEngine(config);
  const result = await engine.analyze({ task: command, sources: args.positionals, question, instructions, detail, region, maxTokens: config.maxTokens, timeoutSeconds: config.timeoutSeconds, onProgress: hasOption(args, "verbose") ? io.stderr : undefined });
  const format = option(args, "format") ?? "markdown";
  if (format !== "markdown" && format !== "json") throw usageError("--format must be markdown or json.");
  const rendered = format === "json" ? formatJson(result) : formatMarkdown(result);
  const outputPath = option(args, "output");
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, "utf8");
  }
  io.stdout(rendered);
}

async function handleConfig(args: ParsedCliArgs, io: CliIO): Promise<void> {
  const subcommand = args.positionals[0] ?? "show";
  if (subcommand !== "init" && subcommand !== "show") throw usageError("config expects init or show.");
  const config = await resolveConfig(configOverrides(args), environmentForArgs(args), io.cwd ?? process.cwd());
  if (subcommand === "show") {
    io.stdout(`${JSON.stringify(publicConfig(config), null, 2)}\n`);
    return;
  }
  if (!hasOption(args, "force")) {
    try {
      await readFile(config.configFile, "utf8");
      io.stdout(`Config already exists at ${config.configFile}; use --force to replace it.\n`);
      return;
    } catch {
      // Safe to create a missing config file.
    }
  }
  await mkdir(dirname(config.configFile), { recursive: true, mode: 0o700 });
  await writeUserConfig(config.configFile, { profile: config.profile, allowedDirs: config.allowedDirs });
  io.stdout(`Created non-secret config at ${config.configFile}.\n`);
}

async function handleSetup(args: ParsedCliArgs, io: CliIO): Promise<void> {
  const env = environmentForArgs(args);
  const configFile = getConfigFilePath(env);
  const existing = await readUserConfig(configFile);
  const profileName = option(args, "profile") ?? env.SIDESIGHT_PROFILE ?? existing.profile ?? "opencode-go";
  const profile = profileDefaults[profileName];
  const baseUrl = option(args, "base-url") ?? env.SIDESIGHT_BASE_URL ?? existing.baseUrl ?? profile?.baseUrl;
  const model = option(args, "model") ?? env.SIDESIGHT_MODEL ?? existing.model ?? profile?.model;
  const apiKey = option(args, "api-key") ?? env.SIDESIGHT_API_KEY ?? env.Z_AI_API_KEY ?? existing.apiKey;
  if (!baseUrl) throw usageError("setup needs --base-url or SIDESIGHT_BASE_URL for this profile.");
  if (!model) throw usageError("setup needs --model or SIDESIGHT_MODEL for this profile.");
  let baseUrlObject: URL;
  try {
    baseUrlObject = new URL(baseUrl);
  } catch (error) {
    throw usageError(`setup received an invalid --base-url: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (baseUrlObject.protocol !== "http:" && baseUrlObject.protocol !== "https:") throw usageError("setup --base-url must use http or https.");
  if (baseUrlObject.username || baseUrlObject.password) throw usageError("setup --base-url must not contain embedded credentials; use --api-key or SIDESIGHT_API_KEY.");
  const next: UserConfigFile = { ...existing, profile: profileName, baseUrl, model };
  if (apiKey) next.apiKey = apiKey;
  const allowedDir = option(args, "allowed-dir");
  if (allowedDir) next.allowedDirs = [allowedDir];
  await writeUserConfig(configFile, next);
  io.stdout(`Saved SideSight provider settings to ${configFile}.\nProfile: ${profileName}\nBase URL: ${baseUrl}\nModel: ${model}\nAPI key: ${apiKey ? "configured" : "not configured (acceptable for local providers)"}\n`);
}

export async function runCli(argv: string[], io: CliIO = { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(`${text}\n`) }): Promise<number> {
  let parsed: ParsedCliArgs | undefined;
  try {
    parsed = parseCliArgs(argv);
    if (hasOption(parsed, "version")) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    if (hasOption(parsed, "help")) {
      io.stdout(parsed.command ? commandHelpText(parsed.command, parsed.positionals[0]) : helpText());
      return 0;
    }
    if (!parsed.command) {
      io.stdout(helpText());
      return 0;
    }
    if (parsed.command === "config") {
      await handleConfig(parsed, io);
      return 0;
    }
    if (parsed.command === "setup") {
      await handleSetup(parsed, io);
      return 0;
    }
    if (parsed.command === "doctor") {
      const config = await resolveConfig(configOverrides(parsed), environmentForArgs(parsed), io.cwd ?? process.cwd());
      const report = await runDoctor(config, hasOption(parsed, "live"));
      const format = option(parsed, "format") ?? "markdown";
      io.stdout(format === "json" ? `${JSON.stringify(report)}\n` : formatDoctor(report));
      return report.checks.some((check) => check.status === "fail") ? 1 : 0;
    }
    if (parsed.command === "mcp") {
      const config = await resolveConfig(configOverrides(parsed), environmentForArgs(parsed), io.cwd ?? process.cwd());
      await runMcpServer(config);
      return 0;
    }
    const task = parsed.command as VisionTaskId;
    if (!["image", "ui", "ocr", "diagnose", "diagram", "chart", "diff", "video"].includes(task)) throw usageError(`Unknown command ${parsed.command}. Run sidesight --help.`);
    await renderTask(parsed, task, io);
    return 0;
  } catch (error) {
    const safe = asSideSightError(error, process.env.SIDESIGHT_API_KEY ? [process.env.SIDESIGHT_API_KEY] : []);
    const format = parsed?.options.get("format") === "json" ? "json" : "text";
    io.stderr(format === "json" ? JSON.stringify({ error: { code: safe.code, message: redactSecrets(safe.message) } }) : `sidesight: ${redactSecrets(safe.message)}`);
    return safe.exitCode;
  }
}

const cliEntrypointNames = new Set(["cli.js", "sidesight", "sidesight.cmd"]);
if (process.argv[1] && cliEntrypointNames.has(basename(process.argv[1]))) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
