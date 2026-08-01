import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, runCli } from "./cli.js";

describe("CLI parser", () => {
  it("supports command positionals, equals options, and stdin marker", () => {
    const parsed = parseCliArgs(["ocr", "a path.png", "--format=json", "--question", "-"]);
    expect(parsed.command).toBe("ocr");
    expect(parsed.positionals).toEqual(["a path.png"]);
    expect(parsed.options.get("format")).toBe("json");
    expect(parsed.options.get("question")).toBe("-");
    expect(parseCliArgs(["setup", "--base_url", "http://127.0.0.1/v1"]).options.get("base-url")).toBe("http://127.0.0.1/v1");
  });

  it("prints useful help without configuration", async () => {
    let output = "";
    const code = await runCli(["--help"], { stdout: (text) => { output += text; }, stderr: () => undefined });
    expect(code).toBe(0);
    expect(output).toContain("diagnose");
    expect(output).toContain("mcp");
    expect(output).toContain("setup");
  });

  it("prints command and subcommand help without resolving provider configuration", async () => {
    const cases = [
      { argv: ["setup", "--help"], expected: "Usage:\n  sidesight setup" },
      { argv: ["image", "--help"], expected: "Usage:\n  sidesight image" },
      { argv: ["diff", "--help"], expected: "Usage:\n  sidesight diff" },
      { argv: ["doctor", "--help"], expected: "Usage:\n  sidesight doctor" },
      { argv: ["mcp", "--help"], expected: "Usage:\n  sidesight mcp" },
      { argv: ["config", "--help"], expected: "Usage:\n  sidesight config <init|show>" },
      { argv: ["config", "init", "--help"], expected: "Usage:\n  sidesight config init" },
      { argv: ["config", "show", "--help"], expected: "Usage:\n  sidesight config show" },
    ];
    for (const testCase of cases) {
      let output = "";
      const code = await runCli(testCase.argv, { stdout: (text) => { output += text; }, stderr: () => undefined });
      expect(code, testCase.argv.join(" ")).toBe(0);
      expect(output, testCase.argv.join(" ")).toContain(testCase.expected);
    }
  });

  it("persists setup settings securely and supports rerunning with partial updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sidesight-setup-"));
    const configFile = join(directory, "config.json");
    const originalEnvironment = { ...process.env };
    for (const key of ["SIDESIGHT_API_KEY", "Z_AI_API_KEY", "SIDESIGHT_PROFILE", "SIDESIGHT_BASE_URL", "SIDESIGHT_MODEL", "SIDESIGHT_CONFIG_FILE", "SIDESIGHT_CONFIG_DIR"]) delete process.env[key];
    try {
      let output = "";
      const first = await runCli(["setup", "--config-file", configFile, "--profile", "generic", "--base-url", "http://127.0.0.1:8000/v1", "--model", "vision-test", "--api-key", "setup-secret"], { stdout: (text) => { output += text; }, stderr: () => undefined });
      expect(first).toBe(0);
      expect(output).not.toContain("setup-secret");
      const firstConfig = JSON.parse(await readFile(configFile, "utf8")) as { baseUrl: string; model: string; apiKey: string };
      expect(firstConfig).toMatchObject({ baseUrl: "http://127.0.0.1:8000/v1", model: "vision-test", apiKey: "setup-secret" });
      expect((await stat(configFile)).mode & 0o777).toBe(0o600);

      const second = await runCli(["setup", "--config-file", configFile, "--model", "vision-updated"], { stdout: () => undefined, stderr: () => undefined });
      expect(second).toBe(0);
      const secondConfig = JSON.parse(await readFile(configFile, "utf8")) as { baseUrl: string; model: string; apiKey: string };
      expect(secondConfig).toMatchObject({ baseUrl: "http://127.0.0.1:8000/v1", model: "vision-updated", apiKey: "setup-secret" });
    } finally {
      process.env = originalEnvironment;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
