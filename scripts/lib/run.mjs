// Shared plumbing for the run scripts: locating a run, reading and validating
// its manifest, git, hashing and file copies. The hooks have their own, smaller
// reader (hooks/run.mjs) because they sit on every tool call and must fail closed.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOM_MARK, readModes } from "../../hooks/wall.mjs";

export { ROOM_MARK };
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LAYERS = ["behaviour", "pixel", "format", "ui"];
export const PRIORITIES = ["must", "should", "could"];

// Every expected failure goes through this so the CLIs can print it cleanly
// and pick the exit code, instead of dumping a stack trace on the user.
export class RunError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const toSlash = (p) => p.replace(/\\/g, "/");

export function readJson(file, what = path.basename(file)) {
  if (!existsSync(file)) throw new RunError(`${what} not found at ${toSlash(file)}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new RunError(`${what} at ${toSlash(file)} is not valid JSON: ${err.message}`);
  }
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// remake.json is tracked and builders run next to it, so every reader checks
// its shape rather than trusting it.
export function validateManifest(cfg, where = "remake.json") {
  const errors = [];
  const isStr = (v) => typeof v === "string" && v.length > 0;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new RunError(`${where}: must be a JSON object`);
  if (!isStr(cfg.app)) errors.push(`"app" must be a non-empty string`);
  if (!isStr(cfg.stack)) errors.push(`"stack" must be a non-empty string`);
  if (!Number.isInteger(cfg.builders) || cfg.builders < 1 || cfg.builders > 5) errors.push(`"builders" must be an integer from 1 to 5`);
  if (typeof cfg.cheap !== "boolean") errors.push(`"cheap" must be true or false`);
  const m = cfg.models;
  if (!m || typeof m !== "object" || !["planner", "builder", "reviewer"].every((k) => isStr(m[k])))
    errors.push(`"models" must have string planner, builder and reviewer`);
  if (!Array.isArray(cfg.blocked) || !cfg.blocked.every(isStr)) errors.push(`"blocked" must be an array of strings`);
  if (cfg.budgetUsd !== undefined && !(Number.isFinite(cfg.budgetUsd) && cfg.budgetUsd > 0)) errors.push(`"budgetUsd" must be a number of US dollars above 0, or left out for no cap`);
  const c = cfg.commands;
  if (!c || typeof c !== "object") errors.push(`"commands" must be an object with build, testVisible and testSealed`);
  else {
    if (typeof c.build !== "string") errors.push(`"commands.build" must be a string (empty to skip the build step)`);
    for (const k of ["testVisible", "testSealed"]) {
      if (!isStr(c[k])) errors.push(`"commands.${k}" must be a non-empty string`);
      else if (!c[k].includes("{report}")) errors.push(`"commands.${k}" must contain {report}, the results file it writes`);
    }
  }
  // The wall reads the same fields; one reader keeps the scripts and the guard agreeing on what a valid mode is.
  try { readModes(cfg, where); } catch (err) { errors.push(err.message.slice(where.length + 2)); }
  if (errors.length) throw new RunError(`${where} is invalid:\n  - ${errors.join("\n  - ")}`);
  return cfg;
}

/** How reports and the run page name a run's mode. Open mode is never called clean-room. */
export function modeLabel(manifest) {
  if (manifest?.mode === "open") return "open mode: not clean-room";
  return manifest?.rea ? "clean-room, observer uses REA" : "clean-room";
}

/**
 * The mode as parity.json and the run page carry it. reaItems counts the
 * inventory items the observer tagged "source": "rea", the behaviour that came
 * from reading the original's code rather than watching it run.
 */
export function modeInfo(manifest, inventory = null) {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  return {
    mode: manifest?.mode === "open" ? "open" : "clean",
    rea: manifest?.rea === true,
    basis: manifest?.basis ?? null,
    label: modeLabel(manifest),
    reaItems: items.filter((it) => it?.source === "rea").length,
  };
}

/**
 * Finds the app tree: --app if given, else the nearest directory walking up
 * from cwd that holds both remake.json and .remake/local.json. Builder
 * worktrees carry remake.json but not the gitignored .remake/, so walking past
 * them lands on the real app tree.
 */
export function locateRun(appArg, cwd = process.cwd()) {
  let root = null;
  if (appArg) {
    root = path.resolve(cwd, appArg);
    if (!existsSync(path.join(root, "remake.json"))) throw new RunError(`No remake.json in ${toSlash(root)}. Is that the app tree?`);
  } else {
    for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, "remake.json")) && existsSync(path.join(dir, ".remake", "local.json"))) { root = dir; break; }
      if (path.dirname(dir) === dir) break;
    }
    if (!root) throw new RunError(`Not inside a Remakecraft run (no remake.json with .remake/local.json above ${toSlash(cwd)}). Pass --app <app tree>.`);
  }
  const manifest = validateManifest(readJson(path.join(root, "remake.json")), toSlash(path.join(root, "remake.json")));
  const local = readJson(path.join(root, ".remake", "local.json"), ".remake/local.json");
  if (typeof local.room !== "string" || !local.room.includes(ROOM_MARK))
    throw new RunError(`.remake/local.json: "room" must be the room's absolute path, and its name must contain ${ROOM_MARK}`);
  const room = path.resolve(local.room);
  if (!existsSync(room)) throw new RunError(`The room ${toSlash(room)} named in .remake/local.json does not exist`);
  return { root, room, manifest };
}

export function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (r.error) throw new RunError(`git could not start: ${r.error.message}. Is git on PATH?`);
  if (r.status !== 0 && !allowFail)
    throw new RunError(`git ${args.join(" ")} failed in ${toSlash(cwd)}:\n${(r.stderr || r.stdout).trim()}`);
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

// Commits as the user when git knows who they are; a fresh machine without a
// git identity still gets a working run, signed as Remakecraft.
export function gitCommit(cwd, message, paths) {
  git(cwd, ["add", "--", ...paths]);
  const staged = git(cwd, ["diff", "--cached", "--quiet", "--", ...paths], { allowFail: true });
  if (staged.ok) return null; // nothing changed
  const ident = git(cwd, ["config", "user.email"], { allowFail: true }).out
    ? []
    : ["-c", "user.name=Remakecraft", "-c", "user.email=remakecraft@localhost"];
  git(cwd, [...ident, "commit", "-q", "-m", message, "--", ...paths]);
  return git(cwd, ["rev-parse", "--short", "HEAD"]).out;
}

/** Every file under dir, sorted. skipDir(fullPath, name) prunes a directory before it is walked. */
export function listFiles(dir, skipDir = () => false) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!skipDir(full, e.name)) walk(full); }
      else if (e.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

// Text is hashed with CRLF folded to LF: git's autocrlf rewrites line endings
// on checkout, and that must not read as tampering. Any other byte change does.
export function hashFile(file) {
  let buf = readFileSync(file);
  if (!buf.includes(0)) buf = Buffer.from(buf.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  return createHash("sha256").update(buf).digest("hex");
}

/** Hashes every file under base/sub, keyed by its slash path relative to base. */
export function hashTree(base, sub) {
  const out = {};
  for (const f of listFiles(path.join(base, sub))) out[toSlash(path.relative(base, f))] = hashFile(f);
  return out;
}

export function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

export function isNonEmptyDir(dir) {
  return existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
}

/** Splits argv into positionals and --flags. Flags listed in `bool` take no value. */
export function parseArgs(argv, { bool = [], value = [] } = {}) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const [name, inline] = a.slice(2).split(/=(.*)/s);
    if (bool.includes(name)) { flags[name] = true; continue; }
    if (!value.includes(name)) throw new RunError(`Unknown option --${name}`, 2);
    const v = inline ?? argv[++i];
    if (v === undefined || (inline === undefined && v.startsWith("--"))) throw new RunError(`--${name} needs a value`, 2);
    flags[name] = v;
  }
  return { pos, flags };
}

/** Runs a CLI body and turns RunErrors into a message and an exit code. */
export async function main(fn) {
  try {
    process.exitCode = (await fn()) ?? 0;
  } catch (err) {
    if (err instanceof RunError) {
      process.stderr.write(`Remakecraft: ${err.message}\n`);
      process.exitCode = err.code;
    } else {
      process.stderr.write(`Remakecraft: unexpected error\n${err.stack || err}\n`);
      process.exitCode = 1;
    }
  }
}

/** True when the module at `url` is the script node was started with, not an import. */
export function isMain(url) {
  if (!process.argv[1]) return false;
  const a = path.resolve(fileURLToPath(url));
  const b = path.resolve(process.argv[1]);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
