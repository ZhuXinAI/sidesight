import { redactSecrets } from "./errors.js";
import type { VisionResult } from "./types.js";

export function formatMarkdown(result: VisionResult): string {
  const lines = [
    `## ${result.task}`,
    "",
    result.answer.trim(),
  ];
  if (result.confidence !== undefined) lines.push("", `Confidence: ${Math.round(result.confidence * 100)}%`);
  if (result.evidence.length > 0) {
    lines.push("", "Evidence:");
    for (const evidence of result.evidence) {
      const region = evidence.region ? ` (${evidence.region.x},${evidence.region.y},${evidence.region.width},${evidence.region.height})` : "";
      lines.push(`- ${evidence.description}${region}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

export function formatJson(result: VisionResult): string {
  return `${JSON.stringify(result, (_key, value) => typeof value === "string" ? redactSecrets(value) : value)}\n`;
}
