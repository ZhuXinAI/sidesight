#!/usr/bin/env node
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
await rm(join(root, "dist"), { recursive: true, force: true });
await promisify(execFile)(tsc, [], { cwd: root, maxBuffer: 4_000_000 });
await mkdir(join(root, "dist", "local"), { recursive: true });
await copyFile(join(root, "src", "local", "macos-vision-ocr.swift"), join(root, "dist", "local", "macos-vision-ocr.swift"));
