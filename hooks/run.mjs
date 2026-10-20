// Finds the Remakecraft run a tool call belongs to. Shared by the guard and
// the audit hook.
//
// The nearest remake.json walking up from the working directory wins. That
// alone misses the common case: the session (and every subagent, whose cwd
// resets to the session's) sits in the --out folder that holds the app tree
// and the room side by side, so nothing above it is a run and the wall would
// be down for the observer, spec writer and test writer. findRuns therefore
// also looks at the paths the call names and at the folder's own children.

import { existsSync, readFileSync, appendFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOM_MARK, readModes } from "./wall.mjs";

/** Reads the run whose app tree is dir, or null when dir has no remake.json. Throws on a broken manifest. */
function readRunAt(dir) {
  const file = path.join(dir, "remake.json");
  if (!existsSync(file)) return null;
  const root = dir.replace(/\\/g, "/");
  const logRoot = mainTreeOf(dir) || root;
  try {
    // Windows editors and PowerShell's Set-Content -Encoding utf8 write a byte order mark.
    const cfg = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (cfg.blocked !== undefined && !Array.isArray(cfg.blocked))
      throw new Error(`${file}: "blocked" must be an array of strings`);
    const modes = readModes(cfg, file);
    return { root, logRoot, blocked: cfg.blocked || [], app: cfg.app || path.basename(dir), ...modes };
  } catch (err) {
    // A broken manifest must not silently drop the wall: the caller fails
    // closed, and logs the denial in the run it could not read.
    err.run = { root, logRoot };
    throw err;
  }
}

/**
 * The main app tree when dir is a linked git worktree of it, else null. Builders
 * run in worktrees that carry their own copy of remake.json; their wall and audit
 * lines belong in the main tree's .remake/, which outlives the worktree.
 */
function mainTreeOf(dir) {
  let gitFile;
  try { gitFile = readFileSync(path.join(dir, ".git"), "utf8"); } catch { return null; } // a directory, or no git
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(gitFile);
  if (!m) return null;
  // A linked worktree's gitdir is <main>/.git/worktrees/<name>.
  const gitdir = path.resolve(dir, m[1]);
  const dotGit = path.dirname(path.dirname(gitdir));
  if (path.basename(path.dirname(gitdir)) !== "worktrees" || path.basename(dotGit) !== ".git") return null;
  const main = path.dirname(dotGit);
  return existsSync(path.join(main, "remake.json")) ? main.replace(/\\/g, "/") : null;
}

export function findRun(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const run = readRunAt(dir);
    if (run) return run;
    if (path.dirname(dir) === dir) return null;
  }
}

/** The app tree beside the room a path points into: /out/x.remake-room/a -> /out/x. */
function appBesideRoom(p) {
  const parts = path.resolve(p).split(/[\\/]+/);
  const i = parts.findIndex((s) => s.toLowerCase().endsWith(ROOM_MARK) && s.length > ROOM_MARK.length);
  if (i < 0) return null;
  return [...parts.slice(0, i), parts[i].slice(0, -ROOM_MARK.length)].join(path.sep) || null;
}

/**
 * Every run a call may touch. The run above cwd when there is one; otherwise
 * the runs the hinted paths (tool paths, path-like shell tokens) fall in or
 * beside, plus any run laid out directly in cwd (<cwd>/x beside <cwd>/x.remake-room).
 */
export function findRuns(cwd, hints = []) {
  const above = findRun(cwd);
  if (above) return [above];
  const found = new Map();
  const add = (run) => { if (run) found.set(run.root.toLowerCase(), run); };
  for (const h of hints) {
    const p = path.resolve(cwd, h);
    add(findRun(p));
    const app = appBesideRoom(p);
    if (app) add(readRunAt(app));
  }
  let children = [];
  try { children = readdirSync(cwd, { withFileTypes: true }); } catch { /* cwd vanished: nothing to add */ }
  for (const e of children) {
    if (e.isDirectory() && e.name.toLowerCase().endsWith(ROOM_MARK) && e.name.length > ROOM_MARK.length)
      add(readRunAt(path.join(cwd, e.name.slice(0, -ROOM_MARK.length))));
  }
  return [...found.values()];
}

export function appendLog(run, name, entry) {
  const dir = path.join(run.logRoot || run.root, ".remake");
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, name), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function readStdinJson() {
  return JSON.parse(readFileSync(0, "utf8"));
}
