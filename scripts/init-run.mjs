#!/usr/bin/env node
// Phase 0: lays out a new run. Creates the app tree (a git repo builders will
// branch from) and the room beside it, writes remake.json from a stack preset,
// and seeds the progress checklist the skill resumes from.
//
//   node scripts/init-run.mjs <app> --out <dir> --stack <stack> [--builders 1-5] [--cheap] [--budget <usd>]
//                             [--with-rea | --open] [--basis own|license|authorized]
//
// Clean is the default. --with-rea lets the observer alone look inside the
// original; --open lowers that wall for every role. Either one needs the
// user's --basis on record, because decompiling may breach the app's EULA.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { requireClaudeVersion } from "./lib/claude-version.mjs";
import { STACKS, STACK_NAMES } from "./lib/stacks.mjs";
import { BASES } from "../hooks/wall.mjs";
import { PLUGIN_ROOT, ROOM_MARK, RunError, git, gitCommit, isMain, isNonEmptyDir, main, modeLabel, parseArgs, toSlash, validateManifest, writeJson } from "./lib/run.mjs";

const USAGE = `Usage: init-run.mjs <app> --out <dir> --stack <${STACK_NAMES.join("|")}> [--builders 1-5] [--cheap] [--budget <usd>] [--with-rea | --open] [--basis ${BASES.join("|")}]`;
// Said before any run that looks inside the original, and again in its output.
export const EULA_NOTE = "Decompiling or inspecting the original may breach its EULA or local law. Whether you may is your call, not Remakecraft's.";
const MODELS = { planner: "opus", builder: "sonnet", reviewer: "opus" };
const CHEAP_MODELS = { planner: "sonnet", builder: "sonnet", reviewer: "sonnet" };
const ROOM_DIRS = ["evidence", "original", "spec", "tests/visible", "sealed"];
// What the user may put in the room before setup. Anything else is a run's
// state (inventory.json, spec/, sealed/, hashes.json) or unknown, and is never touched.
const ROOM_INPUTS = new Set(["evidence", "original"]);
const ORIGINAL_USE = {
  clean: "run as a black box, never read",
  rea: "run by everyone, inspected by the observer alone",
  open: "run and inspected by every role",
};
const OS_JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/**
 * A room the user made early to drop evidence into is reused around what is
 * there; a room holding anything else is refused. Returns the inputs found,
 * or null when there is no room yet.
 */
export function checkExistingRoom(room) {
  if (!existsSync(room)) return null;
  if (!statSync(room).isDirectory()) throw new RunError(`${toSlash(room)} exists and is not a folder. Remove it or pick another --out.`);
  const entries = readdirSync(room).filter((e) => !OS_JUNK.has(e.toLowerCase()));
  const other = entries.filter((e) => !ROOM_INPUTS.has(e)).sort();
  if (other.length)
    throw new RunError(
      `The room ${toSlash(room)} already holds ${other.join(", ")}. Only evidence/ and original/ may be there before setup: resume that run, or remove the rest.`,
    );
  const file = entries.find((e) => !statSync(path.join(room, e)).isDirectory());
  if (file) throw new RunError(`${toSlash(path.join(room, file))} must be a folder.`);
  return entries.sort();
}

/** The phase checklist, lifted from SKILL.md so the two never drift apart. */
export function readChecklist(skillFile = path.join(PLUGIN_ROOT, "skills", "remake", "SKILL.md")) {
  if (!existsSync(skillFile)) throw new RunError(`Cannot find the skill at ${toSlash(skillFile)} to copy the checklist from`);
  const text = readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
  const section = text.split(/^## Phases\s*$/m)[1];
  const lines = (section || "").split(/^## /m)[0].split("\n").filter((l) => l.startsWith("- [ ]"));
  if (!lines.length) throw new RunError(`SKILL.md has no "- [ ]" checklist under "## Phases"`);
  return `# Remake checklist\n\nTick each line when its phase is done. On resume, continue from the first unticked line.\n\n${lines.join("\n")}\n`;
}

// The git a run needs: builders commit on their branches, the merger merges and
// reverts, the reviewer diffs and tags. Never push, reset or checkout.
export const GIT_TOOLS = ["git add ", "git commit ", "git status", "git diff", "git log", "git show", "git merge ", "git revert ", "git tag ", "git rev-parse", "git branch"];
// Read-only shell tools agents reach for to check their work; compound commands are
// approved only when every part is. No `git -C`: it would let any git subcommand through.
export const LOOK_TOOLS = ["cd ", "ls", "cat ", "head ", "tail ", "grep ", "wc ", "sort", "cut ", "diff ", "echo ", "mkdir "];

/**
 * Local permissions for a session in the app tree, so a run is not a prompt per file
 * or test pass: edits accepted in the app tree and the room (a run writes hundreds of
 * files), node on this plugin's own scripts, the original run as a black box, the git
 * above, the stack's build and test tools, and Codex for the review. A run that may
 * inspect the original also gets REA's MCP tools. Nothing else is pre-approved, and
 * the wall still decides who may touch the room or use REA.
 */
export function runPermissions(room, { rea = false, tools = [] } = {}) {
  const scripts = `${toSlash(PLUGIN_ROOT)}/scripts/`;
  const original = `${toSlash(room)}/original/`;
  return {
    permissions: {
      defaultMode: "acceptEdits",
      allow: [
        `Bash(node "${scripts}*)`, `Bash(node ${scripts}*)`,
        `Bash(node "${original}*)`, `Bash(node ${original}*)`,
        `Bash("${original}*)`, `Bash(${original}*)`,
        ...[...GIT_TOOLS, ...LOOK_TOOLS, ...tools, "codex exec "].map((prefix) => `Bash(${prefix}*)`),
        ...(rea ? ["mcp__rea"] : []),
      ],
      additionalDirectories: [toSlash(room)],
    },
  };
}

/** The wall's mode from the flags. Lowering it without a recorded basis is refused before anything is made. */
function readModeFlags(flags) {
  const rea = Boolean(flags["with-rea"]);
  const open = Boolean(flags.open);
  if (rea && open) throw new RunError(`Pick one of --with-rea and --open: open mode already lets every role use REA.`, 2);
  if (!rea && !open) {
    if (flags.basis !== undefined) throw new RunError(`--basis only applies with --with-rea or --open; a clean run never looks inside the original.`, 2);
    return { mode: "clean", rea: false, mcpAllow: [] };
  }
  const flag = rea ? "--with-rea" : "--open";
  if (!BASES.includes(flags.basis))
    throw new RunError(
      `${flag} needs --basis ${BASES.join("|")}: you own the app, its license allows it, or you are authorized.\n${EULA_NOTE}`,
      2,
    );
  return { mode: open ? "open" : "clean", rea, basis: flags.basis, mcpAllow: [] };
}

export function initRun(argv) {
  const { pos, flags } = parseArgs(argv, { bool: ["cheap", "with-rea", "open"], value: ["out", "stack", "builders", "budget", "basis"] });
  if (pos.length !== 1) throw new RunError(USAGE, 2);
  const app = pos[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(app))
    throw new RunError(`App name "${app}" must be letters, digits, - and _ (it becomes a folder name)`, 2);
  if (!flags.stack) throw new RunError(`--stack is required.\n${USAGE}`, 2);
  const stack = STACKS[flags.stack];
  if (!stack) throw new RunError(`Unknown stack "${flags.stack}". Choose one of: ${STACK_NAMES.join(", ")}`, 2);
  if (!flags.out) throw new RunError(`--out is required: the folder the app tree and its room are created in.\n${USAGE}`, 2);

  const cheap = Boolean(flags.cheap);
  let builders = 3;
  if (flags.builders !== undefined) {
    builders = Number(flags.builders);
    if (!Number.isInteger(builders) || builders < 1 || builders > 5) throw new RunError(`--builders must be a whole number from 1 to 5`, 2);
  }
  let budgetUsd;
  if (flags.budget !== undefined) {
    budgetUsd = Number(String(flags.budget).replace(/^\$/, ""));
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new RunError(`--budget must be a number of US dollars above 0, like --budget 25`, 2);
  }
  const modes = readModeFlags(flags);
  const notes = [];
  if (cheap && builders !== 1) {
    if (flags.builders !== undefined) notes.push(`--cheap runs one builder; ignoring --builders ${builders}.`);
    builders = 1;
  }

  const out = path.resolve(flags.out);
  const root = path.join(out, app);
  const room = path.join(out, `${app}${ROOM_MARK}`);
  if (existsSync(path.join(root, "remake.json"))) throw new RunError(`A run already exists at ${toSlash(root)}. Resume it instead of starting over.`);
  if (isNonEmptyDir(root)) throw new RunError(`${toSlash(root)} exists and is not empty. Pick another --out or app name.`);
  const reused = checkExistingRoom(room);
  if (reused) notes.push(`Reusing the room ${toSlash(room)}${reused.length ? `; kept ${reused.map((e) => `${e}/`).join(" and ")}` : ""}.`);

  const manifest = validateManifest({
    app,
    stack: flags.stack,
    builders,
    cheap,
    models: cheap ? CHEAP_MODELS : MODELS,
    blocked: [],
    ...modes,
    commands: { ...stack.commands },
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
  });
  const checklist = readChecklist();

  // From here on, a failure leaves half a run behind; remove what we made so a
  // retry starts clean, and never what the user put in a reused room.
  const createdRoot = !existsSync(root);
  const madeInRoom = [...new Set(ROOM_DIRS.map((d) => d.split("/")[0]))].filter((d) => !existsSync(path.join(room, d)));
  try {
    for (const d of ROOM_DIRS) mkdirSync(path.join(room, d), { recursive: true });
    mkdirSync(path.join(root, ".remake", "progress"), { recursive: true });
    mkdirSync(path.join(root, ".remake", "reports"), { recursive: true });

    writeJson(path.join(root, "remake.json"), manifest);
    writeFileSync(path.join(root, ".gitignore"), [".remake/", ".claude/worktrees/", ".claude/settings.local.json", ...stack.ignore].join("\n") + "\n");
    for (const [name, make] of Object.entries(stack.files || {})) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), make(app));
    }
    writeJson(path.join(root, ".remake", "local.json"), { room: toSlash(room) });
    writeJson(path.join(root, ".claude", "settings.local.json"), runPermissions(room, { rea: manifest.rea || manifest.mode === "open", tools: stack.tools }));
    writeFileSync(path.join(root, ".remake", "progress", "checklist.md"), checklist);

    git(root, ["init", "-q"]);
    git(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    const tracked = ["remake.json", ".gitignore", ...Object.keys(stack.files || {})];
    const sha = gitCommit(root, `chore: start remake run for ${app}`, tracked);
    // Claude Code decides at startup whether a session can make worktrees: only
    // inside a git repo. Builders need them, so a session started elsewhere must restart in the app tree.
    // process.cwd() is the physical path, so compare real paths (macOS /var is /private/var).
    const rel = path.relative(realpathSync.native(root), realpathSync.native(process.cwd()));
    const restart = rel.startsWith("..") || path.isAbsolute(rel);
    return { root, room, manifest, sha, notes, layout: stack.layout, restart };
  } catch (err) {
    if (!reused) rmSync(room, { recursive: true, force: true });
    else for (const d of madeInRoom) rmSync(path.join(room, d), { recursive: true, force: true });
    if (createdRoot) rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

if (isMain(import.meta.url)) {
  main(() => {
    const warning = requireClaudeVersion();
    if (warning) process.stderr.write(`Remakecraft: warning: ${warning}\n`);
    const r = initRun(process.argv.slice(2));
    for (const n of r.notes) process.stdout.write(`Note: ${n}\n`);
    process.stdout.write(
      [
        `Remake run created for ${r.manifest.app} (${r.manifest.stack}, ${r.manifest.builders} builder${r.manifest.builders > 1 ? "s" : ""}${r.manifest.cheap ? ", cheap" : ""}${r.manifest.budgetUsd ? `, budget $${r.manifest.budgetUsd}` : ""}).`,
        `  mode      ${modeLabel(r.manifest)}${r.manifest.basis ? ` (basis: ${r.manifest.basis})` : ""}`,
        ...(r.manifest.basis ? [`            ${EULA_NOTE}`] : []),
        `  app tree  ${toSlash(r.root)}  (git, first commit ${r.sha})`,
        `  room      ${toSlash(r.room)}`,
        `  evidence  put screenshots, recordings and docs in ${toSlash(path.join(r.room, "evidence"))}`,
        `  original  optional: the original app or a launcher in ${toSlash(path.join(r.room, "original"))}, ${ORIGINAL_USE[r.manifest.mode === "open" ? "open" : r.manifest.rea ? "rea" : "clean"]}`,
        `  tests     ${r.layout}`,
        r.restart
          ? `Next: this session did not start in the app tree, so builders cannot get worktrees. Restart Claude in ${toSlash(r.root)} and run /remakecraft:remake ${r.manifest.app} to resume.`
          : `Next: add known open-source reimplementations to "blocked" in remake.json, then phase 1.`,
        "",
      ].join("\n"),
    );
  });
}
