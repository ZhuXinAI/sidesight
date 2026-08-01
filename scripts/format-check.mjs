#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (!path.includes("node_modules") && !path.includes("dist")) result.push(path);
  }
  return result;
}

const roots = ["src", "scripts", "skills", ".agents"];
const paths = (await Promise.all(roots.map((root) => files(root))))
  .flat()
  .filter((path) => /\.(ts|mjs|json|md|yaml|yml)$/.test(path));
const failures = [];
for (const path of paths) {
  const text = await readFile(path, "utf8");
  if (/[ \t]+\n/.test(text)) failures.push(`${path}: trailing whitespace`);
  if (text.length > 0 && !text.endsWith("\n")) failures.push(`${path}: missing final newline`);
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Format check passed for ${paths.length} files.\n`);
}
