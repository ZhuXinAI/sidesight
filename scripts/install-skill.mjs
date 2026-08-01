#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const destinationRoot = process.argv[2];
if (!destinationRoot) {
  process.stderr.write("Usage: node scripts/install-skill.mjs <user-skill-directory>\n");
  process.exitCode = 2;
} else {
  const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "sidesight");
  const destination = join(destinationRoot, "sidesight");
  await mkdir(join(destination, "agents"), { recursive: true });
  await writeFile(join(destination, "SKILL.md"), await readFile(join(sourceRoot, "SKILL.md")));
  await writeFile(join(destination, "agents", "openai.yaml"), await readFile(join(sourceRoot, "agents", "openai.yaml")));
  process.stdout.write(`Installed SideSight skill at ${destination}\n`);
}
