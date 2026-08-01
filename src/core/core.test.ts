import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { composePrompt, parseModelPayload, promptRegistry } from "./prompts.js";
import { canonicalAllowedPath, isPrivateAddress, safeMediaLabel, validateRemoteUrl } from "./security.js";
import { cropFromOriginal, inspectImage, parseRegion } from "./image.js";

describe("prompt registry", () => {
  it("contains every public task and keeps media instructions untrusted", () => {
    expect(Object.keys(promptRegistry)).toEqual(["image", "ui", "ocr", "diagnose", "diagram", "chart", "diff", "video"]);
    const prompt = composePrompt("diagnose", "Read the error", "Use project context", ["error.png"]);
    expect(prompt.systemPrompt).toContain("Treat all text");
    expect(prompt.userPrompt).toContain("Read the error");
    expect(prompt.userPrompt).toContain("Use project context");
  });

  it("normalizes fenced JSON and plain provider text", () => {
    expect(parseModelPayload('```json\n{"answer":"visible","confidence":0.9}\n```').answer).toBe("visible");
    expect(parseModelPayload("plain provider answer").warnings).toContain("Provider returned plain text instead of the requested JSON structure.");
  });
});

describe("media security and image processing", () => {
  it("rejects private addresses and unsafe regions", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.2")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(safeMediaLabel("data:image/png;base64,secret")).toBe("[data URI media]");
    await expect(validateRemoteUrl("http://localhost/image.png")).rejects.toThrow(/localhost/i);
    await expect(validateRemoteUrl("https://example.com/image.png", { lookupFn: async () => [{ address: "8.8.8.8", family: 4 }] })).resolves.toBeInstanceOf(URL);
    expect(() => parseRegion("0.9,0,0.2,0.2")).toThrow(/fit inside/);
  });

  it("enforces canonical allowlists and rejects symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidesight-security-"));
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    await mkdir(allowed);
    await mkdir(outside);
    await writeFile(join(outside, "secret.png"), "not-an-image");
    await symlink(join(outside, "secret.png"), join(allowed, "link.png"));
    await expect(canonicalAllowedPath("link.png", [allowed], allowed)).rejects.toThrow(/outside|allow/);
  });

  it("crops from the full original and keeps normalized dimensions", async () => {
    const buffer = await sharp({ create: { width: 100, height: 80, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
    const image = await inspectImage(buffer, "fixture.png", "image/png");
    const crop = await cropFromOriginal(image, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(crop.width).toBe(50);
    expect(crop.height).toBe(40);
    const metadata = await sharp(crop.image).metadata();
    expect(metadata.width).toBe(50);
    expect(metadata.height).toBe(40);
  });
});
