// PreToolUse entry point for the wall. It fails closed inside a run: any
// internal error denies the call, and hooks.json sets onFailure: "block" for a
// crash this file cannot catch. Every denial it makes, an internal error or an
// unreadable remake.json included, gets a wall.log line. Outside a run it never
// blocks, because the hook runs on every tool call in every project.
//
// wall.log and audit.log record what was tried, never what it carried: a
// denied Write from the test-writer holds test content, and clean roles may
// read the app tree the logs live in. Each line has the tool, the paths it
// named and a sha256 of its input; the transcript holds the rest.

import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
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

const SPILL_TOOLS = new Set(["Read", "Grep"]);
const SPILL_HEAD = /^<persisted-output>\nOutput too large \([^)\n]*\)\. Full output saved to: ([^\n]+)\n\nPreview \(first \d+KB\):\n/;
const MAX_TRANSCRIPT = 64 * 1024 * 1024;
const slashLower = (p) => p.replace(/\\/g, "/").toLowerCase();

/**
 * Text of the tool results in a transcript that announce `file` as a spill:
 * Claude Code's "<persisted-output> ... saved to: <file> ... Preview" block,
 * from a result that is not an error. Lines that do not name the file are not parsed.
 */
function spillPreviews(transcript, file, name) {
  const previews = [];
  for (const line of transcript.split("\n")) {
    if (!line.includes(name)) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_result" || block.is_error) continue;
      const texts = typeof block.content === "string" ? [block.content] : (Array.isArray(block.content) ? block.content.map((c) => c?.text).filter((t) => typeof t === "string") : []);
      for (const text of texts) {
        const m = SPILL_HEAD.exec(text);
        if (m && slashLower(m[1].trim()) === slashLower(file)) previews.push(text.slice(m[0].length).replace(/\n\.\.\.\n<\/persisted-output>\s*$/, "").replace(/\n<\/persisted-output>\s*$/, ""));
      }
    }
  }
  return previews;
}

/**
 * Spill files Claude Code wrote for this agent's own large tool results, which
 * a clean role may Read: they hold only what it was already shown. A spill
 * lives at <config>/projects/<project>/<session>/tool-results/<name>, shared by
 * every agent of the session, room roles included. It counts as this agent's
 * when the agent's own transcript (subagents/agent-<agent_id>.jsonl) has the
 * result that announced it, and the file starts with that result's preview, so
 * echoing the announcement for another agent's spill gets nothing.
 */
export function ownOutputs(hook, cwd, home, env = process.env) {
  if (!SPILL_TOOLS.has(hook.tool_name)) return [];
  const session = String(hook.session_id ?? "");
  const agent = String(hook.agent_id ?? "");
  if (!/^[\w-]+$/.test(session) || !/^[\w-]+$/.test(agent)) return [];
  const bases = [...new Set([path.join(home, ".claude", "projects"), ...(env.CLAUDE_CONFIG_DIR ? [path.join(env.CLAUDE_CONFIG_DIR, "projects")] : [])].map((b) => path.resolve(b)))];
  const input = hook.tool_input || {};
  const out = [];
  for (const key of ["file_path", "path"]) {
    if (typeof input[key] !== "string" || !input[key]) continue;
    const file = path.resolve(cwd, input[key]);
    for (const base of bases) {
      const parts = path.relative(base, file).split(/[\\/]/);
      if (parts.length !== 4 || parts[0] === ".." || parts[1].toLowerCase() !== session.toLowerCase() || parts[2] !== "tool-results" || !/^[\w.-]+$/.test(parts[3])) continue;
      const transcript = path.join(base, parts[0], parts[1], "subagents", `agent-${agent}.jsonl`);
      let text;
      let body;
      try {
        if (statSync(transcript).size > MAX_TRANSCRIPT) continue;
        text = readFileSync(transcript, "utf8");
        body = readFileSync(file, "utf8");
      } catch { continue; } // no transcript or no file: not shown to this agent
      const previews = spillPreviews(text, file, parts[3]);
      if (!previews.some((p) => p.length >= Math.min(512, body.length) && body.startsWith(p))) continue;
      out.push(file.replace(/\\/g, "/"));
      try { out.push(realpathSync(file).replace(/\\/g, "/")); } catch { /* read above, so it exists */ }
    }
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
 * Writes one wall.log line to each run, so every denial is on record, the
 * guard's own failures included. Returns a stderr note when a line could not
 * be written; the call is denied either way.
 */
function logDenial(runs, hook, reason) {
  const input = hook?.tool_input || {};
  let targets = [];
  try {
    const { named, shell } = namedPaths(hook || {});
    targets = logTargets(hook || {}, named, shell);
  } catch { /* a payload too broken to name paths still gets its line */ }
  const entry = {
    role: roleOf(hook?.agent_type) || "main",
    agent: hook?.agent_type || null,
    tool: hook?.tool_name ?? null,
    targets,
    sha256: sha256(hook ? input : null),
    reason,
  };
  const failed = [];
  for (const run of runs) {
    try { appendLog(run, "wall.log", entry); } catch (err) { failed.push(err.message); }
  }
  return failed.length ? `Remakecraft: could not write wall.log (${failed.join("; ")}); the call is still denied.\n` : "";
}

/**
 * Decides one PreToolUse payload. Returns what the hook process prints and its exit code.
 * @param {string} raw  the payload Claude Code sends on stdin
 */
export function handle(raw, { fallbackCwd = process.cwd(), home = os.homedir(), tmp = os.tmpdir(), decideFn = decide } = {}) {
  let runs = null;
  let hook = null;
  try {
    hook = JSON.parse(raw);
    const cwd = hook.cwd || fallbackCwd;
    const input = hook.tool_input || {};
    const { named, shell } = namedPaths(hook);
    try {
      runs = findRuns(cwd, [...named, ...shell]);
    } catch (err) {
      const reason = `Remakecraft: remake.json is unreadable (${err.message}). Fix it before continuing.`;
      const note = err.run ? logDenial([err.run], hook, reason) : "";
      return { code: 2, stdout: "", stderr: `${reason}\n${note}` };
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
    // Set here, never taken from the payload: decide() lets a clean role read these.
    hook.own_outputs = ownOutputs(hook, cwd, home);

    for (const run of runs) {
      const verdict = decideFn(hook, run, home, tmp);
      if (!verdict) continue;
      return { ...deny(verdict.reason), stderr: logDenial([run], hook, verdict.reason) };
    }
    return ALLOW;
  } catch (err) {
    // A payload we could not read: look for a run from where the hook runs.
    if (runs === null) {
      try { runs = findRuns(hook?.cwd || fallbackCwd); } catch (e) { runs = e.run ? [e.run] : [null]; } // a broken manifest is still a run
    }
    if (!runs.length) return ALLOW;
    const reason = `Clean-room wall: the guard failed (${err.message}), so the call is blocked inside a run.`;
    return { ...deny(reason), stderr: logDenial(runs.filter(Boolean), hook, reason) };
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
