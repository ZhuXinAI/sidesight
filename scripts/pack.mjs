#!/usr/bin/env node
import { mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const directory = await mkdtemp(join(tmpdir(), "sidesight-pack-"));
let server;
try {
  const packed = await execFileAsync("pnpm", ["pack", "--pack-destination", directory], { maxBuffer: 2_000_000 });
  const archive = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
  if (!archive) throw new Error("pnpm pack did not create an archive");
  const installDirectory = join(directory, "install");
  await execFileAsync("pnpm", ["init"], { cwd: installDirectory, maxBuffer: 2_000_000 }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(installDirectory, { recursive: true });
    await execFileAsync("pnpm", ["init"], { cwd: installDirectory, maxBuffer: 2_000_000 });
  });
  await execFileAsync("pnpm", ["add", join(directory, archive)], { cwd: installDirectory, maxBuffer: 4_000_000 });
  const executable = join(installDirectory, "node_modules", ".bin", process.platform === "win32" ? "sidesight.cmd" : "sidesight");
  const help = await execFileAsync(executable, ["--help"], { cwd: installDirectory, maxBuffer: 4_000_000 });
  const version = await execFileAsync(executable, ["--version"], { cwd: installDirectory, maxBuffer: 4_000_000 });
  if (!help.stdout.includes("diagnose") || version.stdout.trim() !== packageJson.version) throw new Error("Packed executable smoke check failed");
  const symlinkDirectory = join(directory, "bin");
  await mkdir(symlinkDirectory);
  const symlinkExecutable = join(symlinkDirectory, "sidesight");
  await symlink(join(installDirectory, "node_modules", "sidesight", "dist", "cli.js"), symlinkExecutable);
  const symlinkHelp = await execFileAsync(process.execPath, [symlinkExecutable, "--help"], { cwd: installDirectory, maxBuffer: 4_000_000 });
  if (!symlinkHelp.stdout.includes("diagnose")) throw new Error("Symlinked executable smoke check failed");
  const imagePath = join(directory, "fixture.png");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  server = createServer((_incoming, outgoing) => {
    outgoing.statusCode = 200;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "packed mock answer", confidence: 0.9 }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("pack mock server did not bind");
  const mocked = await execFileAsync(executable, ["diagnose", imagePath, "--format", "json", "--detail", "overview", "--question", "Read the image"], {
    cwd: installDirectory,
    env: { ...process.env, SIDESIGHT_PROFILE: "generic", SIDESIGHT_BASE_URL: `http://127.0.0.1:${address.port}/v1`, SIDESIGHT_MODEL: "pack-mock", SIDESIGHT_API_KEY: "pack-secret", SIDESIGHT_ALLOWED_DIRS: directory, SIDESIGHT_CONFIG_FILE: join(directory, "config.json") },
    maxBuffer: 4_000_000,
  });
  const mockedResult = JSON.parse(mocked.stdout);
  if (mockedResult.answer !== "packed mock answer") throw new Error("Packed mocked provider smoke check failed");
  process.stdout.write(`${packed.stdout}Packed install passed: ${archive}; mocked command passed.\n`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
