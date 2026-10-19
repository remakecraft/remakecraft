// PreToolUse entry point for the wall. It fails closed inside a run: any
// internal error denies the call, and hooks.json sets onFailure: "block" for a
// crash this file cannot catch. Outside a run it never blocks, because the hook
// runs on every tool call in every project.
//
// wall.log and audit.log record what was tried, never what it carried: a
// denied Write from the test-writer holds test content, and clean roles may
// read the app tree the logs live in. Each line has the tool, the paths it
// named and a sha256 of its input; the transcript holds the rest.

import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROOM_MARK, decide, roleOf, stringLeaves } from "./wall.mjs";
import { findRuns, appendLog } from "./run.mjs";

const AGENT_TOOLS = new Set(["Agent", "Task"]);
const ALLOW = { code: 0, stdout: "", stderr: "" };
const deny = (reason) => ({
  code: 0,
  stderr: "",
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
});

export const sha256 = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex");

/** Paths a call names: tool path arguments, a Glob's base, and path-like shell words (or MCP input strings). */
function namedPaths(hook) {
  const input = hook.tool_input || {};
  const named = ["file_path", "notebook_path", "path"].filter((k) => input[k]).map((k) => String(input[k]));
  if (hook.tool_name === "Glob" && input.pattern) named.push(String(input.pattern).split(/[*?[{]/)[0] || ".");
  const words = String(hook.tool_name || "").startsWith("mcp__") ? stringLeaves(input).join(" ") : String(input.command || "");
  const shell = words
    .split(/[\s;|&()<>`"'=]+/)
    .filter((t) => /[\\/]/.test(t) || t.includes(ROOM_MARK))
    .slice(0, 64);
  return { named, shell };
}

/**
 * Symlink-resolved targets of a shell line's words, so a link planted inside
 * original/ (up -> ..) shows its real target to decide(). Words are resolved
 * against the cwd and against each `cd` target; missing paths are skipped.
 * Bounded; any other failure propagates and blocks the call inside a run.
 */
function shellRealPaths(hook, cwd) {
  if (!["Bash", "PowerShell"].includes(hook.tool_name)) return [];
  const out = [];
  let words = 0;
  let base = cwd;
  for (const seg of String(hook.tool_input?.command || "").split(/\r?\n|;|&&|\|\||\||&|\$\(|[()`]/)) {
    const toks = seg.trim().split(/\s+/).map((t) => t.replace(/["'`]/g, "").replace(/^\d*[<>]+/, "")).filter(Boolean);
    const isCd = /^(cd|pushd|set-location|sl|chdir)$/i.test(toks[0] || "");
    for (const t of toks.slice(isCd ? 1 : 0)) {
      if (words >= 64) return out;
      const cand = t.includes("=") ? t.slice(t.indexOf("=") + 1) : t;
      if (!cand || cand.startsWith("-")) continue;
      words++;
      for (const b of new Set([base, cwd])) {
        try { out.push(realpathSync.native(path.resolve(b, cand))); } catch { /* does not exist (yet) */ }
      }
    }
    if (isCd && toks[1] && toks[1] !== "-") base = path.resolve(base, toks[1]);
  }
  return out;
}

/** What wall.log keeps of a denied call: where it reached, never its content. */
function logTargets(hook, named, shell) {
  const input = hook.tool_input || {};
  const pathLike = (t) => /^(\.{1,2}[\\/]|[\\/~]|[A-Za-z]:[\\/])/.test(t) || t.includes(ROOM_MARK);
  return [...new Set([...named, ...shell.filter(pathLike), ...(input.url ? [String(input.url)] : [])])].slice(0, 16);
}

/**
 * Decides one PreToolUse payload. Returns what the hook process prints and its exit code.
 * @param {string} raw  the payload Claude Code sends on stdin
 */
export function handle(raw, { fallbackCwd = process.cwd(), home = os.homedir(), tmp = os.tmpdir(), decideFn = decide } = {}) {
  let runs = null;
  try {
    const hook = JSON.parse(raw);
    const cwd = hook.cwd || fallbackCwd;
    const input = hook.tool_input || {};
    const { named, shell } = namedPaths(hook);
    try {
      runs = findRuns(cwd, [...named, ...shell]);
    } catch (err) {
      return { code: 2, stdout: "", stderr: `Remakecraft: remake.json is unreadable (${err.message}). Fix it before continuing.\n` };
    }
    if (!runs.length) return ALLOW;

    // The orchestrator writes every subagent prompt; keep the ones for this
    // plugin's roles so a run can show what each agent was told.
    if (AGENT_TOOLS.has(hook.tool_name) && roleOf(input.subagent_type)) {
      for (const run of runs)
        appendLog(run, "audit.log", { event: "prompt", agent: input.subagent_type, by: hook.agent_type || "main", sha256: sha256(input.prompt ?? ""), prompt: input.prompt ?? null });
    }

    // Resolve symlinks on the path arguments; a missing file simply has no real path yet.
    hook.real_paths = named
      .map((p) => {
        try { return realpathSync(path.resolve(cwd, p)); } catch { return null; }
      })
      .filter(Boolean)
      .concat(shellRealPaths(hook, cwd));

    for (const run of runs) {
      const verdict = decideFn(hook, run, home, tmp);
      if (!verdict) continue;
      let stderr = "";
      try {
        appendLog(run, "wall.log", {
          role: roleOf(hook.agent_type) || "main",
          agent: hook.agent_type || null,
          tool: hook.tool_name,
          targets: logTargets(hook, named, shell),
          sha256: sha256(input),
          reason: verdict.reason,
        });
      } catch (err) {
        stderr = `Remakecraft: could not write wall.log (${err.message}); the call is still denied.\n`;
      }
      return { ...deny(verdict.reason), stderr };
    }
    return ALLOW;
  } catch (err) {
    // A payload we could not read: look for a run from where the hook runs.
    if (runs === null) {
      try { runs = findRuns(fallbackCwd); } catch { runs = [null]; } // a broken manifest is still a run
    }
    if (runs.length) return deny(`Clean-room wall: the guard failed (${err.message}), so the call is blocked inside a run.`);
    return ALLOW;
  }
}

const self = path.resolve(fileURLToPath(import.meta.url));
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { /* an unreadable stdin is handled as a bad payload */ }
  const r = handle(raw);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.code);
}
