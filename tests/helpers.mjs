// Shared setup for the script tests: throwaway runs in the OS temp dir.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const script = (name) => path.join(PLUGIN, "scripts", name);

export function tempDir(t, label = "rc") {
  const dir = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

export function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}

/** Runs one of the scripts as a CLI, the way the skill and the verifier do. */
export function cli(name, args, cwd = PLUGIN, env = {}) {
  const r = spawnSync(process.execPath, [script(name), ...args], { cwd, encoding: "utf8", env: { ...process.env, REMAKECRAFT_CLAUDE_VERSION: "2.1.295 (Claude Code)", ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function gitIn(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
