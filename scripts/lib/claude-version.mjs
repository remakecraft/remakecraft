// Claude Code version preflight. The wall's `onFailure: "block"` only exists from
// MIN_CLAUDE_VERSION; older versions let a failing hook fall through, so the wall fails open.

import { spawnSync } from "node:child_process";
import { RunError } from "./run.mjs";

export const MIN_CLAUDE_VERSION = "2.1.295";

/** "2.1.295 (Claude Code)" -> [2, 1, 295]; null when the text is not a version line. */
export function parseClaudeVersion(text) {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)\b/.exec(String(text ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative, zero or positive as `a` is older than, equal to or newer than `b` (both [major, minor, patch]). */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Decides from `claude --version` output. Returns { ok, warning?, version? }:
 * a missing binary or odd output warns (the user may run another agent); only a
 * parsed version below the minimum refuses.
 */
export function judgeClaudeVersion(output) {
  const version = parseClaudeVersion(output);
  if (!version)
    return { ok: true, warning: `Could not read the Claude Code version, so the wall's fail-closed setting is unchecked. Remakecraft needs Claude Code ${MIN_CLAUDE_VERSION}+.` };
  if (compareVersions(version, parseClaudeVersion(MIN_CLAUDE_VERSION)) < 0)
    return { ok: false, version: version.join(".") };
  return { ok: true, version: version.join(".") };
}

/** Runs `claude --version`. REMAKECRAFT_CLAUDE_VERSION stands in for its output where claude is not on PATH (tests, CI). */
export function readClaudeVersion(env = process.env) {
  if (env.REMAKECRAFT_CLAUDE_VERSION) return env.REMAKECRAFT_CLAUDE_VERSION;
  // On Windows claude can be a .cmd shim, which only runs through a shell; one command
  // string there avoids Node's DEP0190 warning for args passed alongside shell: true.
  const opts = { encoding: "utf8", timeout: 15000, windowsHide: true };
  const r = process.platform === "win32"
    ? spawnSync("claude --version", { ...opts, shell: true })
    : spawnSync("claude", ["--version"], opts);
  return r.error || r.status !== 0 ? null : r.stdout;
}

/** Throws a RunError below the minimum; returns a warning string (or null) otherwise. */
export function requireClaudeVersion(output = readClaudeVersion()) {
  const verdict = judgeClaudeVersion(output);
  if (!verdict.ok)
    throw new RunError(`Claude Code ${MIN_CLAUDE_VERSION}+ is required: older versions let the wall fail open (you have ${verdict.version}). Update with \`claude update\`.`);
  return verdict.warning ?? null;
}
