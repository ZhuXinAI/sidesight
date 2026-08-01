import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getConfigFilePath, resolveConfig } from "./config.js";

describe("configuration resolution", () => {
  it("defaults persisted settings to ~/.sidesight and supports an explicit directory override", () => {
    expect(getConfigFilePath({})).toBe(join(homedir(), ".sidesight", "config.json"));
    expect(getConfigFilePath({ SIDESIGHT_CONFIG_DIR: "/tmp/custom-sidesight" })).toBe("/tmp/custom-sidesight/config.json");
  });

  it("uses CLI overrides over environment, user config, and profile defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sidesight-config-"));
    const configFile = join(directory, "config.json");
    await writeFile(configFile, JSON.stringify({ profile: "generic", baseUrl: "http://config.example/v1", model: "config-model", timeoutSeconds: 8 }));
    const resolved = await resolveConfig({ model: "cli-model", timeoutSeconds: 3 }, {
      SIDESIGHT_CONFIG_FILE: configFile,
      SIDESIGHT_BASE_URL: "http://env.example/v1",
      SIDESIGHT_MODEL: "env-model",
      SIDESIGHT_TIMEOUT_SECONDS: "5",
    }, directory);
    expect(resolved.model).toBe("cli-model");
    expect(resolved.baseUrl).toBe("http://env.example/v1");
    expect(resolved.timeoutSeconds).toBe(3);
    expect(resolved.profile).toBe("generic");
  });

  it("rejects malformed user config instead of silently coercing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sidesight-config-invalid-"));
    const configFile = join(directory, "config.json");
    await writeFile(configFile, JSON.stringify({ maxImageMb: "large" }));
    await expect(resolveConfig({}, { SIDESIGHT_CONFIG_FILE: configFile }, directory)).rejects.toThrow(/maxImageMb/);
  });
});
