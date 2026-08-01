#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (path.endsWith(".ts") || path.endsWith(".mjs")) result.push(path);
  }
  return result;
}

const sourceFiles = await files("src");
const scriptFiles = await files("scripts");
const violations = [];
for (const path of [...sourceFiles, ...scriptFiles]) {
  if (path === "scripts/lint.mjs") continue;
  const text = await readFile(path, "utf8");
  if (/console\.log\s*\(/.test(text)) violations.push(`${path}: use stderr or the CLI IO abstraction instead of console.log`);
  if (/TODO|FIXME|Not implemented/.test(text)) violations.push(`${path}: placeholder marker found`);
}
if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Lint passed for ${sourceFiles.length + scriptFiles.length} source files.\n`);
}
