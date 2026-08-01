import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("SideSight skill", () => {
  it("contains one complete routing table and safety guidance", async () => {
    const skill = await readFile("skills/sidesight/SKILL.md", "utf8");
    expect(skill).toContain("sidesight diagnose");
    expect(skill).toContain("sidesight ocr");
    expect(skill).toContain("sidesight diff");
    expect(skill).toContain("untrusted evidence");
    expect(skill).not.toContain("TODO");
  });
});
