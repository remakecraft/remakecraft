// Replays the observed sessions in docs/sessions/ against a tally program and
// reports every line that differs. tests/tally-fixture.test.mjs uses it to
// prove the manual matches the hidden original; point it at a clone to grade
// a tiny-app-parity run by hand (keep the run with --keep-temp):
//
//   node evals/fixtures/toy-original/replay.mjs                 # the original
//   node evals/fixtures/toy-original/replay.mjs node <clone>.mjs  # a clone
//
// Sessions use a tiny shell: `tally ...`, `cat F`, `ls -a`, `echo $?` and
// `printf '...' > F` (\n escapes only). Each session starts in an empty dir.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SESSIONS_DIR = path.join(here, "docs", "sessions");
export const ORIGINAL = [process.execPath, path.join(here, "impl", "tally.mjs")];

export function parseSession(text) {
  const steps = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("#")) continue;
    if (line.startsWith("$ ")) steps.push({ cmd: line.slice(2), expected: [] });
    else if (steps.length) steps.at(-1).expected.push(line);
    else if (line.trim()) throw new Error(`output before the first command: ${line}`);
  }
  for (const s of steps) while (s.expected.at(-1) === "") s.expected.pop();
  return steps;
}

function run(cmd, dir, state, program) {
  const printf = cmd.match(/^printf '([^']*)' > (\S+)$/);
  if (printf) {
    writeFileSync(path.join(dir, printf[2]), printf[1].replace(/\\n/g, "\n"));
    return "";
  }
  const [name, ...args] = cmd.split(/\s+/);
  if (name === "tally") {
    const r = spawnSync(program[0], [...program.slice(1), ...args], { cwd: dir, encoding: "utf8" });
    if (r.error) throw r.error;
    state.exit = r.status;
    return r.stdout + r.stderr;
  }
  if (cmd === "echo $?") return `${state.exit}\n`;
  if (cmd === "ls -a") return [".", "..", ...readdirSync(dir).sort()].join("\n") + "\n";
  if (name === "cat" && args.length === 1) {
    const file = path.join(dir, args[0]);
    return existsSync(file) ? readFileSync(file, "utf8") : `cat: ${args[0]}: No such file or directory\n`;
  }
  throw new Error(`unsupported session command: ${cmd}`);
}

/** @returns {string[]} one message per mismatching step; empty means the session replays exactly */
export function replaySession(file, program = ORIGINAL) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tally-replay-"));
  const state = { exit: 0 };
  const diffs = [];
  try {
    for (const step of parseSession(readFileSync(file, "utf8"))) {
      const want = step.expected.length ? step.expected.join("\n") + "\n" : "";
      const got = run(step.cmd, dir, state, program);
      if (got !== want) diffs.push(`${path.basename(file)}: $ ${step.cmd}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return diffs;
}

export const sessionFiles = () =>
  readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".txt")).sort().map((f) => path.join(SESSIONS_DIR, f));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const program = process.argv.length > 2 ? process.argv.slice(2) : ORIGINAL;
  const diffs = sessionFiles().flatMap((f) => replaySession(f, program));
  for (const d of diffs) console.error(d);
  console.log(diffs.length ? `${diffs.length} step(s) differ` : "all sessions replay exactly");
  process.exit(diffs.length ? 1 : 0);
}
