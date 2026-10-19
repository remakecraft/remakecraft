// The clean-room wall: decides whether one tool call may run.
//
// A run has two trees. The app tree (git repo, contains remake.json) is clean:
// the spec, the visible tests and the code. The room (a sibling directory whose
// name contains ROOM_MARK) holds everything that came from the original app:
// evidence, the inventory drafts and the sealed tests. Builders work in
// worktrees of the app tree, so the room is never under their feet; this
// module is the second layer that stops them reaching for it anyway.
//
// Pure logic, no I/O: guard.mjs feeds it the hook payload and the run config.
//
// Modes (remake.json). Clean, the default: nobody looks inside the original.
// Clean with "rea": true: the observer alone may use REA, the decompilers and
// <room>/original/; it writes behaviour only, and publish.mjs filters code out
// of what crosses. Open: the original-code wall is off for every role; the
// room's other contents, the sealed tests and the blocklist still hold.
// MCP tools go through the same wall in every mode: the clean side gets none
// but the ones remake.json "mcpAllow" names.

import path from "node:path";

export const ROOM_MARK = ".remake-room";

/** What the user says entitles them to look inside the original, recorded by init-run. */
export const BASES = ["own", "license", "authorized"];

/**
 * The wall's settings from remake.json. Anything malformed, or a mode that
 * lowers the wall without the user's recorded basis, throws: the guard then
 * blocks every call rather than guess.
 */
export function readModes(cfg, file = "remake.json") {
  const mode = cfg.mode ?? "clean";
  if (mode !== "clean" && mode !== "open") throw new Error(`${file}: "mode" must be "clean" or "open"`);
  if (cfg.rea !== undefined && typeof cfg.rea !== "boolean") throw new Error(`${file}: "rea" must be true or false`);
  const rea = cfg.rea === true;
  if ((rea || mode === "open") && !BASES.includes(cfg.basis))
    throw new Error(`${file}: "rea" and open mode need "basis" set to one of ${BASES.join(", ")}`);
  const mcpAllow = cfg.mcpAllow ?? [];
  if (!Array.isArray(mcpAllow) || !mcpAllow.every((t) => typeof t === "string" && /^mcp__\S+__\S+$/.test(t)))
    throw new Error(`${file}: "mcpAllow" must be a list of MCP tool names, mcp__<server>__<tool> or mcp__<server>__* for a whole server`);
  return { mode, rea, mcpAllow };
}

// REA (github.com/morluto/rea): `npx rea-agents setup` registers its MCP server
// as "rea", so its tools are mcp__rea__<tool>; installed as a Claude Code plugin
// they would be mcp__plugin_<plugin>_rea__<tool>. Its tools decompile and trace
// the original, so they count as reading its code.
const REA_TOOL = /^mcp__(rea|plugin_[a-z0-9_-]+_rea)__/i;
// Built-in tools that list and read any MCP server's resources.
const MCP_RESOURCE_TOOLS = new Set(["ListMcpResourcesTool", "ReadMcpResourceTool"]);
const isMcp = (tool) => String(tool || "").startsWith("mcp__") || MCP_RESOURCE_TOOLS.has(tool);
export const isReaTool = (tool, input = {}) => REA_TOOL.test(String(tool || "")) || (MCP_RESOURCE_TOOLS.has(tool) && /^rea$/i.test(String(input.server || "")));
const mcpAllowed = (tool, allow) => allow.some((a) => (a.endsWith("__*") ? tool.startsWith(a.slice(0, -1)) : a === tool));

const ROOM_ROLES = new Set(["observer", "spec-writer", "test-writer"]);
const CLEAN_ROLES = new Set(["builder", "verifier", "reviewer", "merger"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
// The parts of .remake/ the clean side works in; the rest (wall.log, audit.log) records the room's paths.
const WORK_DIRS = ["reports", "progress", "tmp"];
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const AGENT_TOOLS = new Set(["Agent", "Task"]);

// Coding-agent CLIs. One started from a clean role's shell is a fresh session
// with no agent type, so the wall would not know it is on the clean side.
const AGENT_CLIS = new Set([
  "claude", "claude-code", "codex", "codex-cli", "gemini", "gemini-cli", "opencode", "cursor-agent", "aider", "qwen", "goose", "crush",
]);
const AGENT_PACKAGES = /@anthropic-ai\/claude-code|@openai\/codex|@google\/gemini-cli|opencode-ai|@qwen-code\//;
// Words a launcher puts before the program it runs.
const LAUNCHERS = new Set(["sudo", "env", "command", "exec", "xargs", "nohup", "time", "nice", "start", "call", "npx", "bunx", "pnpx", "dlx", "&", "."]);
// The reviewer's one sanctioned agent: Codex under a permission profile that
// reads only the app tree (see agents/reviewer.md).
const REVIEW_PROFILE = "remake_review";

// Disassemblers and decompilers. Observing and using the original is allowed;
// reading its code is not, for anyone, while a run is active.
const DECOMPILERS = new Set([
  "ghidra", "ghidrarun", "analyzeheadless", "ida", "ida64", "idat", "idat64", "idaq", "idaq64",
  "radare2", "r2", "rizin", "rz-bin", "cutter", "dnspy", "dnspyex", "ilspy", "ilspycmd", "dotpeek",
  "x64dbg", "x32dbg", "retdec", "retdec-decompiler", "jadx", "apktool", "binaryninja", "hopper",
  "uncompyle6", "decompyle3", "pycdc", "de4dot", "cfr", "procyon", "fernflower", "jd-gui",
  "rea", "rea-agents", // REA's CLI and npm package
]);

// <room>/original/ holds the original app itself, installed so the observer can
// run it as a black box. Running it is observing; opening it is reading its
// code, which nobody may do. Shell programs that would print, search or copy a
// file are refused when their arguments point there, and so is any inline
// script (node -e, python -c) that names it.
export const ORIGINAL_DIR = `${ROOM_MARK}/original`;
const READ_PROGRAMS = new Set([
  "cat", "tac", "nl", "head", "tail", "less", "more", "bat", "type", "strings", "xxd", "od", "hexdump", "hd",
  "grep", "egrep", "fgrep", "rg", "ag", "ack", "findstr", "sed", "awk", "gawk", "cut", "sort", "uniq", "diff", "cmp",
  "cp", "copy", "xcopy", "robocopy", "mv", "move", "rsync", "scp", "tar", "zip", "7z", "gzip", "base64", "certutil",
  "iconv", "dd", "vi", "vim", "nvim", "nano", "emacs", "code", "notepad", "get-content", "gc", "select-string", "sls",
  "copy-item", "cpi", "move-item", "mi", "format-hex", "fhx",
]);
const EVAL_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-c", "/c", "eval", "-command", "-encodedcommand"]);
const INTERPRETERS = new Set([
  "node", "deno", "bun", "python", "python3", "py", "perl", "ruby", "php", "sh", "bash", "zsh", "dash", "pwsh", "powershell", "cmd",
]);

// Paths a builder may read outside its own tree: toolchains, not projects.
const TOOLCHAIN_DIRS = [".cargo", ".rustup", ".npm", ".pnpm-store", ".bun", ".deno", "go/pkg"];

export function roleOf(agentType) {
  if (!agentType) return null;
  const [ns, name] = String(agentType).includes(":") ? String(agentType).split(":") : ["remakecraft", agentType];
  if (ns !== "remakecraft") return null;
  return ROOM_ROLES.has(name) || CLEAN_ROLES.has(name) ? name : null;
}

const norm = (p) => p.replace(/\\/g, "/");
const lower = (s) => norm(String(s)).toLowerCase();

function resolveFrom(cwd, p) {
  // Strip glob tails so "src/**/*.rs" resolves to the directory it searches.
  const literal = norm(p).split(/[*?[{]/)[0] || ".";
  // Resolve by the cwd's own flavour, so a drive-letter tree behaves the same on any host.
  const flavour = /^[a-z]:/i.test(cwd) ? path.win32 : path.posix;
  return norm(flavour.resolve(cwd, literal));
}

function isInside(child, parent) {
  const c = lower(child).replace(/\/+$/, "");
  const p = lower(parent).replace(/\/+$/, "");
  return c === p || c.startsWith(p + "/");
}

// Claude Code gives each session a scratchpad at <tmp>/claude/<project>/<session>/scratchpad
// and tells every agent in it, subagents included, to keep temp files there.
// Room roles may use their session's; builders share that same folder, so the
// clean side may not touch any scratchpad, or room content would cross there.
function inScratchpad(p, tmp, session) {
  if (!tmp) return false;
  const base = lower(tmp).replace(/\/+$/, "") + "/claude/";
  const l = lower(p);
  if (!l.startsWith(base)) return false;
  const [project, sess, pad] = l.slice(base.length).split("/");
  return Boolean(project) && pad === "scratchpad" && (!session || sess === lower(session));
}

// A path segment named scratchpad, in a path or a command: "/scratchpad/x", "...\scratchpad".
const namesScratchpad = (text) => /\/scratchpad([/\s"'`;|&)*]|$)/.test(lower(text));

function pathTargets(toolName, input) {
  const out = [];
  for (const key of ["file_path", "notebook_path", "path"]) if (input[key]) out.push(String(input[key]));
  if (toolName === "Glob" && input.pattern) out.push(String(input.pattern));
  return out;
}

const targets_ = (tool, input, cwd) => pathTargets(tool, input).map((p) => resolveFrom(cwd, p));

// Lowercased, with ./ segments and doubled slashes folded away.
const folded = (t) => lower(t).replace(/(\/\.)+(?=\/|$)/g, "").replace(/\/{2,}/g, "/");

/** Every string in an MCP tool's input, whatever its schema calls the fields. */
export function stringLeaves(value, out = [], depth = 0) {
  if (out.length >= 256 || depth > 8) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out, depth + 1);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringLeaves(v, out, depth + 1);
  return out;
}

function textTargets(tool, input) {
  const out = ["command", "url", "query", "pattern", "file_path", "path", "notebook_path"]
    .map((k) => input[k])
    .filter(Boolean)
    .map(String);
  return isMcp(tool) ? [...out, ...stringLeaves(input)] : out;
}

function shellTokens(command) {
  return String(command)
    .split(/[\s;|&()<>`"']+/)
    .filter(Boolean)
    .map((t) => norm(t).split("/").pop().toLowerCase().replace(/(.)@.*$/, "$1").replace(/\.(exe|bat|cmd|sh|py|jar)$/, ""));
}

// Open mode lets every role read <room>/original/. These drop path words that
// stay inside it, so the clean side's room checks still see everything else;
// a word that climbs back out with .. is kept.
const ORIGINAL_WORD = /[^\s"'`;|&()<>]*\.remake-room[\\/]+original(?=$|[\\/\s"'`;|&()<>])(?![^\s"'`;|&()<>]*\.\.)[^\s"'`;|&()<>]*/gi;
const stripOriginal = (text) => String(text).replace(ORIGINAL_WORD, " ");

function blockedTermHit(texts, blocked) {
  for (const term of blocked) {
    const re = new RegExp(`(^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (texts.some((t) => re.test(t.toLowerCase()))) return term;
  }
  return null;
}

const inOriginal = (p) => {
  const l = lower(p).replace(/\/+$/, "");
  return l.includes(ORIGINAL_DIR + "/") || l.endsWith(ORIGINAL_DIR);
};

// Splits a command into simple commands and reports whether one of them reads
// a file under the original. Running it (`node <room>/original/app.mjs add`,
// `T="node <room>/original/app.mjs"`) is fine: there the path is the program
// or an interpreter's script argument, not an argument to a reader.
function shellReadsOriginal(command, cwd) {
  const refs = (tok) => tok && inOriginal(resolveFrom(cwd, tok));
  // An inline script carries its own quotes and parens, so check it on the whole command.
  const all = String(command).split(/[\s;|&()<>`"'=,]+/).filter(Boolean);
  const prog = (t) => norm(t).split("/").pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
  const inline = all.some((t, i) => INTERPRETERS.has(prog(t)) && all.slice(i + 1, i + 4).some((f) => EVAL_FLAGS.has(f.toLowerCase())));
  if (inline && all.some(refs)) return "an inline script names it";
  for (const seg of String(command).split(/\r?\n|;|&&|\|\||\||&|\$\(|[()`]/)) {
    const toks = seg.trim().split(/\s+/).map((t) => t.replace(/^["']+|["']+$/g, "")).filter(Boolean);
    // `cd <room>/original && cat app.mjs`: later relative paths resolve from there.
    if (/^(cd|pushd|set-location|sl)$/i.test(toks[0] || "") && toks[1]) { cwd = resolveFrom(cwd, toks[1]); continue; }
    if (!toks.some((t) => refs(t.replace(/^[<>]+/, "")))) continue;
    if (toks.some((t, i) => (t.startsWith("<") && refs(t.slice(1))) || (t === "<" && refs(toks[i + 1]))))
      return "redirects it into another program";
    let i = 0;
    while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++; // leading VAR=value
    while (["sudo", "env", "command", "xargs", "nohup", "time", "&"].includes(toks[i]?.toLowerCase())) i++;
    const prog = (toks[i] || "").replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
    if (READ_PROGRAMS.has(prog)) return `${prog} would read it`;
  }
  return null;
}

/** Nobody, the main session included, reads the original app's files; running it is allowed. */
function originalRead(tool, input, cwd, real) {
  if (READ_TOOLS.has(tool) || WRITE_TOOLS.has(tool)) {
    const paths = [...pathTargets(tool, input).map((p) => resolveFrom(cwd, p)), ...real];
    // Glob only lists names, and the observer may need to find the launcher.
    if (tool !== "Glob" && paths.some(inOriginal)) return `${tool} on the original app. Run it as a black box; never open its files.`;
  }
  if (SHELL_TOOLS.has(tool)) {
    const why = shellReadsOriginal(input.command || "", cwd);
    if (why) return `the command touches the original app's files (${why}). Run it as a black box; never open its files.`;
  }
  return null;
}

// --- Clean-side shell heuristics -------------------------------------------
// The shell rules below are string matching. They catch the accidental and
// the lazy crossing (a glob, a split word, an encoded path), not a determined
// one; the README says so.

/** Simple commands of a shell line, each as words with surrounding quotes removed. */
function simpleCommands(command) {
  return String(command)
    .split(/\r?\n|;|&&|\|\||\||&|\$\(|[()`]/)
    .map((seg) => seg.trim().split(/\s+/).map((t) => t.replace(/^["']+|["']+$/g, "")).filter(Boolean))
    .filter((toks) => toks.length);
}

const progName = (t) => norm(t || "").split("/").pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1|js|mjs)$/, "");

/** The program a simple command runs, past VAR=value prefixes and launchers. */
function programOf(toks) {
  let i = 0;
  for (;;) {
    while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
    const p = progName(toks[i]);
    if (LAUNCHERS.has(p) || (["pnpm", "yarn"].includes(p) && toks[i + 1] === "dlx") || (p === "npm" && toks[i + 1] === "exec")) {
      i += ["pnpm", "yarn", "npm"].includes(p) ? 2 : 1;
      while (toks[i]?.startsWith("-")) i++; // npx -y, env -i
      continue;
    }
    if (["cmd", "pwsh", "powershell"].includes(p) && /^[-/](c|command)$/i.test(toks[i + 1] || "")) { i += 2; continue; }
    return { prog: p, at: i };
  }
}

/** The reviewer's Codex call, and only in its read-the-app-tree-only form. */
function sanctionedCodex(role, toks, at) {
  if (role !== "reviewer" || !["exec", "e"].includes(toks[at + 1])) return false;
  const line = toks.join(" ");
  return new RegExp(`default_permissions="?${REVIEW_PROFILE}"?`).test(line)
    && !/(^|\s)(-s|--sandbox|--full-auto|--add-dir|--profile|-p)(\s|=|$)|danger|:root|yolo/i.test(line);
}

function agentCliHit(command, role) {
  if (AGENT_PACKAGES.test(lower(command))) return "a coding-agent package";
  for (const toks of simpleCommands(command)) {
    const { prog, at } = programOf(toks);
    if (AGENT_CLIS.has(prog) && !(prog === "codex" && sanctionedCodex(role, toks, at))) return prog;
  }
  return null;
}

/**
 * The command with cheap obfuscation undone: empty quote pairs (evid''ence),
 * string concatenation ('evi'+'dence', 'evi' 'dence') and backslash escapes.
 */
function deobfuscate(command) {
  // Escapes go before the path separators are normalised; a Windows path keeps
  // its own spelling in the plain lowered command, which is checked too.
  return String(command).toLowerCase()
    .replace(/\\(?=[a-z0-9.-])/g, "")
    .replace(/\\/g, "/")
    .replace(/(["'])\s*\+\s*\1/g, "")
    .replace(/(["'])\s+\1/g, "")
    .replace(/''|""/g, "");
}

// A room name, or a recognisable piece of one, in a command. Not "remake-r":
// the reviewer's own git tag is remake-reviewed.
const ROOM_FRAGMENT = /remake-ro|\.remake-|make-roo|ke-room/;

/** Regex for one glob segment; $VAR and ${VAR} expand to anything. */
function segmentRegex(seg) {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") { const j = seg.indexOf("]", i); if (j > i) { re += `[${seg.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`; i = j; } else re += "\\["; }
    else if (c === "$") { const m = /^\$(\{[^}]*\}|\w+)/.exec(seg.slice(i)); if (m) { re += ".*"; i += m[0].length - 1; } else re += "\\$"; }
    else re += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const hasWild = (t) => /[*?[]|\$(\{|\w)/.test(t);

/** Could this glob (already resolved to an absolute path) match the room or something in it? */
function globReachesRoom(glob, room) {
  const g = lower(glob).split("/");
  const r = lower(room).split("/");
  for (let i = 0; i < g.length; i++) {
    if (g[i] === "**") return true; // everything below what matched so far
    if (i >= r.length) return true; // already inside the room
    if (!segmentRegex(g[i]).test(r[i])) return false;
  }
  return g.length >= r.length;
}

/** A glob or a find/ls pattern that names the room without spelling it out. */
function shellGlobsRoom(command, cwd, room) {
  const roomName = lower(room).split("/").pop();
  for (const toks of simpleCommands(command)) {
    if (/^(cd|pushd|set-location|sl)$/i.test(toks[0]) && toks[1] && !hasWild(toks[1])) { cwd = resolveFrom(cwd, toks[1]); continue; }
    for (const t of toks.slice(1)) {
      if (!hasWild(t)) continue;
      // A bare pattern (find -name, -path, ls) tested against the room's name.
      const literal = t.replace(/[*?[\]]|\$(\{[^}]*\}|\w+)/g, "");
      if (literal.length >= 4 && segmentRegex(lower(t).replace(/\//g, "")).test(roomName)) return t;
      if (/^\$/.test(t)) continue; // a variable we cannot resolve
      const abs = /^([a-z]:)?\//i.test(norm(t)) ? norm(t) : `${norm(cwd).replace(/\/+$/, "")}/${norm(t)}`;
      const parts = [];
      for (const s of abs.split("/")) {
        if (s === "..") parts.pop();
        else if (s !== "." && s !== "") parts.push(s);
      }
      const resolved = (/^[a-z]:/i.test(parts[0] || "") ? "" : "/") + parts.join("/");
      if (globReachesRoom(resolved, room)) return t;
    }
  }
  return null;
}

/** Base64 words that decode to a room path, a run log or a word the clean side may not use. */
function encodedHit(command) {
  for (const t of String(command).split(/[\s;|&()<>`"'=]+/)) {
    if (!/^[A-Za-z0-9+/]{8,}={0,2}$/.test(t)) continue;
    const text = Buffer.from(t, "base64").toString("latin1");
    if (!text || (text.match(/[\x20-\x7e]/g) || []).length < text.length * 0.9) continue;
    const l = lower(text);
    if (l.includes(ROOM_MARK) || ROOM_FRAGMENT.test(l) || /(^|[^a-z])(evidence|sealed)([^a-z]|$)|(wall|audit)\.log/.test(l)) return t;
  }
  // Decoded text fed to a program, whatever it says.
  if (/(base64\s+(-d|--decode|-D)\b|certutil\s+-decode|xxd\s+-r|frombase64string)[^|]*\|\s*(xargs|sh|bash|zsh|source|eval|iex|invoke-expression|node|python3?|perl|ruby)\b/i.test(command)) return "a decoded command";
  if (/\$\([^)]*(base64\s+(-d|--decode|-D)\b|xxd\s+-r)/i.test(command)) return "a decoded argument";
  return null;
}

// The run's logs record the room's paths and every crossing attempt.
const NAMES_LOG = /(^|[^a-z0-9_-])(wall|audit)\.log([^a-z0-9_]|$)|\.remake\/[^\s/]*[*?[]/;

function readsRunLogs(texts, targets, bases) {
  if (texts.some((t) => NAMES_LOG.test(lower(t)))) return true;
  // Read-tool targets inside .remake/, other than the work dirs the clean side uses (WORK_DIRS).
  return targets.some((t) => bases.some((b) => {
    const dot = norm(path.join(b, ".remake"));
    return isInside(t, dot) && !WORK_DIRS.some((w) => isInside(t, `${dot}/${w}`));
  }));
}

// --- Path reach of a shell line ----------------------------------------------
// Every path-like word of a clean role's command is resolved against the cwd
// it would run in (following `cd`). A word that lands on an ancestor of the
// tree, on the room, or in the run's logs is refused: `grep -r . ..` and
// `cp -r .. /tmp/x` walk to the room without ever naming it.

const stripQuotes = (t) => t.replace(/["'`]/g, "");

const HOME_WORD = /^(~|\$HOME|\$\{HOME\}|\$env:(?:USERPROFILE|HOME)|\$\{env:(?:USERPROFILE|HOME)\}|%(?:USERPROFILE|HOME)%)(?=\/|$)/i;
const CWD_WORD = /^(~\+|\$PWD|\$\{PWD\}|\$pwd|\$\(pwd\)|\$\(Get-Location\))(?=\/|$)/;

/**
 * Expands a leading ~, $HOME, $env:USERPROFILE or %USERPROFILE% to home and ~+ / $PWD to the cwd.
 * Null for any other unresolvable $VAR or %VAR%.
 */
function expandHome(tok, home, cwd) {
  const t = norm(tok);
  const h = HOME_WORD.exec(t);
  if (h) return norm(home).replace(/\/+$/, "") + t.slice(h[0].length);
  const c = CWD_WORD.exec(t);
  if (c) return norm(cwd).replace(/\/+$/, "") + t.slice(c[0].length);
  return /^[$%]/.test(t) ? null : tok;
}

/** Git Bash (/c/Users), Cygwin (/cygdrive/c) and WSL (/mnt/c) spell drive C: as a POSIX path. */
function driveForm(p, cwd) {
  if (!/^[a-z]:/i.test(cwd)) return p;
  const m = /^\/(?:cygdrive\/|mnt\/)?([a-z])(?=\/|$)/i.exec(norm(p));
  return m ? `${m[1].toUpperCase()}:${norm(p).slice(m[0].length) || "/"}` : p;
}

/**
 * The command as shellReach should see it: a commit message is prose, and a
 * lone `/` inside a quoted -e/-c script is arithmetic. Only quoted values
 * that cannot run code ($(, backtick, ${ ) are neutralised; when in doubt the
 * text is left alone so it is still checked.
 */
const SAFE_DQ = '"(?:[^"$`\\\\]|\\\\.)*"';
const SAFE_SQ = "'[^']*'";
const SCRIPT_RUNNERS = new Set(["node", "deno", "bun", "python", "python3", "py", "perl", "ruby", "php"]);
const SHELL_PROGS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "pwsh", "powershell", "cmd", "eval", "source", "."]);

// Search and edit programs whose first operand is a pattern or a script, not a file.
// Per program: the flags that name the pattern, and the flags whose value is something else.
const PATTERN_PROGS = {
  grep: { pattern: ["-e", "--regexp"], file: ["-f", "--file"], value: ["-m", "--max-count", "-A", "-B", "-C", "--context", "--include", "--exclude", "--label"] },
  rg: { pattern: ["-e", "--regexp"], file: ["-f", "--file"], value: ["-m", "--max-count", "-A", "-B", "-C", "-g", "--glob", "-t", "--type", "-T", "--type-not", "-r", "--replace"] },
  sed: { pattern: ["-e", "--expression"], file: ["-f", "--file"], value: ["-l", "--line-length"] },
  awk: { pattern: [], file: ["-f", "--file"], value: ["-F", "-v", "--assign", "--field-separator"] },
};
for (const [alias, of] of [["egrep", "grep"], ["fgrep", "grep"], ["ag", "rg"], ["ack", "rg"], ["gawk", "awk"], ["mawk", "awk"], ["nawk", "awk"]])
  PATTERN_PROGS[alias] = PATTERN_PROGS[of];

/** Shell words of one simple command, quotes kept, with their offsets in it. */
function wordsAt(seg) {
  const out = [];
  for (const m of seg.matchAll(/(?:[^\s"']+|"(?:[^"\\]|\\.)*"|'[^']*')+/g)) out.push({ text: m[0], at: m.index });
  return out;
}

/** Indexes of the words a search or edit program reads as its pattern or script. */
function patternWords(words, spec) {
  const at = [];
  let explicit = false, positional = -1;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === "--") { if (positional < 0) positional = i + 1; break; }
    const flag = w.split("=")[0];
    if (spec.pattern.includes(flag)) { explicit = true; if (!w.includes("=")) at.push(++i); continue; }
    if (spec.file.includes(flag)) { explicit = true; if (!w.includes("=")) i++; continue; }
    if (spec.value.includes(flag)) { if (!w.includes("=")) i++; continue; }
    if (w.startsWith("-") && w.length > 1) continue;
    if (positional < 0) positional = i;
  }
  if (!explicit && positional > 0 && positional < words.length) at.push(positional);
  return at;
}

// A heredoc's body is the file it writes, unless a shell runs it or it expands
// $( ) or backticks. Bodies fed to a script runner are kept when they climb.
const HEREDOC = /<<-?\s*(["']?)([A-Za-z_][\w.-]*)\1/;

/** Whether a heredoc in the command feeds a script runner or shell: python - <<EOF. */
function heredocRunner(command) {
  return String(command).split("\n").some((line) => {
    const m = HEREDOC.exec(line);
    if (!m) return false;
    const head = line.slice(0, m.index).split(/[;&|]/).pop();
    return INTERPRETERS.has(programOf(head.trim().split(/\s+/).map((t) => t.replace(/^["']+|["']+$/g, ""))).prog);
  });
}

function dropHeredocBodies(command) {
  const lines = String(command).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = HEREDOC.exec(lines[i]);
    if (!m) continue;
    const end = lines.findIndex((l, j) => j > i && l.replace(/^\t+/, "") === m[2]);
    if (end < 0) continue;
    const body = lines.slice(i + 1, end).join("\n");
    const head = lines[i].slice(0, m.index).split(/[;&|]/).pop();
    const { prog } = programOf(head.trim().split(/\s+/).map((t) => t.replace(/^["']+|["']+$/g, "")));
    const runs = SHELL_PROGS.has(prog) || (!m[1] && /\$\(|`/.test(body));
    const climbs = SCRIPT_RUNNERS.has(prog) && /(^|[^.\w])\.\.([/\\]|["'`]|$)/m.test(body);
    if (runs || climbs) continue;
    i = end - 1; // keep the closing delimiter line, drop the body
  }
  return out.join("\n");
}

function reachView(command) {
  const msgRe = new RegExp(`(\\s(?:--message|-[a-zA-Z]*m)(?:=|\\s+))(?:${SAFE_DQ}|${SAFE_SQ})`, "g");
  const evalRe = new RegExp(`(\\s(?:-e|-c|-p|--eval|--print|-command)\\s+)(${SAFE_DQ}|${SAFE_SQ})`, "gi");
  const literal = new RegExp(`^(?:${SAFE_DQ}|${SAFE_SQ})$`);
  const rewrite = (seg) => {
    // Only the git commit's own segment loses its message ...
    const g = /^\s*(?:\w+=\S*\s+)*git(?:\s+-\S+)*\s+commit\b/.exec(seg);
    if (g) return seg.slice(0, g[0].length) + seg.slice(g[0].length).replace(msgRe, '$1"msg"');
    const words = wordsAt(seg);
    const { prog, at } = programOf(words.map((w) => w.text.replace(/^["']+|["']+$/g, "")));
    // ... a search or edit program loses its quoted pattern ...
    const spec = PATTERN_PROGS[prog];
    if (spec) {
      let out = seg;
      for (const i of patternWords(words.slice(at).map((w) => w.text), spec).map((i) => i + at).reverse()) {
        const w = words[i];
        if (w && literal.test(w.text)) out = out.slice(0, w.at) + '"pat"' + out.slice(w.at + w.text.length);
      }
      return out;
    }
    // ... and only a script runner loses its slashes that stand alone (division,
    // comments, split("//")); shells run what the string says.
    if (!SCRIPT_RUNNERS.has(prog)) return seg;
    return seg.replace(evalRe, (_m, flag, body) => flag + body.replace(/(^|[\s"'(])\/+(?=[\s"')]|$)/g, "$1÷"));
  };
  // Split on ; & | and newlines outside quotes, keeping the separators.
  let out = "", seg = "", q = "";
  for (const c of dropHeredocBodies(command)) {
    if (q) { seg += c; if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") { q = c; seg += c; continue; }
    if (/[;&|\n]/.test(c)) { out += rewrite(seg) + c; seg = ""; continue; }
    seg += c;
  }
  return out + rewrite(seg);
}

const strictAncestor = (p, of) => isInside(of, p) && lower(p).replace(/\/+$/, "") !== lower(of).replace(/\/+$/, "");

/** Why this command line reaches above the tree, into the room or into the run's logs; null if it does not. */
function shellReach(command, cwd, run, home, mainRoot, lift = false) {
  const room = `${mainRoot}${ROOM_MARK}`;
  const original = `${mainRoot}${ORIGINAL_DIR}`;
  const logDirs = [...new Set([run.root, mainRoot, cwd].map((b) => norm(path.join(b, ".remake"))))];
  const inLogs = (t) => logDirs.some((d) => isInside(t, d) && !WORK_DIRS.some((w) => isInside(t, `${d}/${w}`)));
  const home_ = norm(home).replace(/\/+$/, "");
  const homeAbove = strictAncestor(home_, run.root) || strictAncestor(home_, mainRoot);
  for (const toks of simpleCommands(reachView(command))) {
    const words = toks.map(stripQuotes).filter(Boolean);
    const first = /^(cd|pushd|set-location|sl|chdir)(\.\.)?$/i.exec(words[0] || "");
    const isCd = !!first;
    if (first && first[2]) words.splice(1, 0, ".."); // cd.. (PowerShell)
    // A leading VAR=value is an argument too: D=..; grep -r x $D
    const startAt = isCd || /^[A-Za-z_]\w*=/.test(words[0] || "") ? 0 : 1;
    // Bare cd / sl goes to $HOME.
    if (isCd && !words[1] && homeAbove) return "a bare cd goes to the home directory, above its tree";
    // Links and copies could carry original/ content or a path out of it.
    const links = /^(ln|mklink|new-item|ni|cp)$/i.test(progName(words[0]));
    for (const raw of words.slice(startAt)) {
      const w0 = raw.replace(/^\d*[<>]+/, "");
      // Also the word with backslash escapes removed: ../sea\led is ../sealed in a shell.
      for (const word of new Set([w0, w0.replace(/\\(?=[^\\])/g, "")])) {
      // The value of VAR=x or --flag=x is a path too; `time.*failure=/` is a regex, not an assignment.
      const assigned = /^-{0,2}[A-Za-z_][\w.-]*=/.test(word) ? word.slice(word.indexOf("=") + 1) : "";
      for (const cand of new Set([word, assigned])) {
        if (!cand || cand.startsWith("-") && !cand.includes("/")) continue;
        // \\server\share, \\?\C:\ and \\.\C:\ name a share or device; a lone \\n is an escape.
        if (/^\/\/[^/]+\/./.test(norm(cand))) return `${raw} is a UNC or device path`;
        if (/^~[^/~+-]/.test(norm(cand))) return `${raw} names another user's home`;
        const expanded = expandHome(cand, home, cwd);
        if (expanded === null) {
          if (/(^|[/\\])\.\.([/\\]|$)/.test(cand)) return `${raw} climbs out from an unresolved variable`;
          continue;
        }
        const abs = resolveFrom(cwd, driveForm(expanded, cwd));
        if (strictAncestor(abs, run.root) || strictAncestor(abs, mainRoot)) return `${raw} is above its tree`;
        if (isInside(abs, room) && !(lift && !links && isInside(abs, original))) return `${raw} is the room`;
        if (inLogs(abs)) return `${raw} is in the run logs`;
      }
      }
    }
    if (isCd && words[1] && words[1] !== "-") {
      const dest = expandHome(words[1], home, cwd);
      if (dest !== null) cwd = resolveFrom(cwd, driveForm(dest, cwd));
    } else if (isCd && !words[1]) cwd = resolveFrom(cwd, home_);
  }
  return null;
}

/** An assignment whose value is an agent CLI: C=claude; $C -p hi. */
function agentAssigned(command) {
  for (const toks of simpleCommands(command))
    for (const t of toks) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(t);
      if (m && AGENT_CLIS.has(progName(stripQuotes(m[1])))) return progName(stripQuotes(m[1]));
    }
  return null;
}

const deny = (reason) =>({ decision: "deny", reason: `Clean-room wall: ${reason}` });

/**
 * @param {object} hook  PreToolUse payload: tool_name, tool_input, agent_type, cwd
 * @param {object|null} run  { root, blocked: string[] } from remake.json, or null outside a run
 * @param {string} home  the user's home directory
 * @param {string} [tmp]  the OS temp directory, which holds Claude Code's session scratchpads
 * @returns {{decision:"deny",reason:string}|null}  null means allow
 */
export function decide(hook, run, home, tmp) {
  if (!run) return null; // not inside a Remakecraft run: the wall is down
  const tool = hook.tool_name;
  const input = hook.tool_input || {};
  const cwd = norm(hook.cwd || run.root);
  const role = roleOf(hook.agent_type);
  const texts = textTargets(tool, input);
  const open = run.mode === "open";
  // Who may look inside the original: everyone in open mode, the observer in a
  // clean run started --with-rea, nobody otherwise.
  const mayInspect = open || (run.rea === true && role === "observer");
  const onlyObserver = run.rea === true ? " Only the observer may, in this run." : "";

  // Everyone, the main session included.
  const term = blockedTermHit(texts, run.blocked || []);
  if (term) return deny(`"${term}" is on this run's blocklist (an existing implementation of the target).`);
  if (SHELL_TOOLS.has(tool) && !mayInspect) {
    const tokens = shellTokens(input.command || "");
    const hit = tokens.find((t) => DECOMPILERS.has(t));
    if (hit) return deny(`${hit} reads the original's code. Observe behaviour only.${onlyObserver}`);
    if (/\bobjdump\b[^|;&]*\s-[a-z]*d/i.test(input.command || "")) return deny(`objdump -d disassembles. Observe behaviour only.${onlyObserver}`);
  }

  if (!mayInspect) {
    const original = originalRead(tool, input, cwd, (hook.real_paths || []).map(norm));
    if (original) return deny(original + onlyObserver);
  }

  // MCP tools. REA reads the original's code, so it follows mayInspect. Every
  // other server is closed to any agent outside the room unless remake.json
  // "mcpAllow" names the tool; the main session (no agent type) keeps its own.
  if (isMcp(tool)) {
    if (isReaTool(tool, input)) {
      if (!mayInspect)
        return deny(run.rea === true
          ? `${tool} is REA, which reads the original's code. Only the observer may use it in this run.`
          : `${tool} is REA, which reads the original's code. A run started with --with-rea lets the observer use it.`);
    } else if (hook.agent_type && !ROOM_ROLES.has(role)) {
      if (MCP_RESOURCE_TOOLS.has(tool) || !mcpAllowed(tool, run.mcpAllow || []))
        return deny(`${role || hook.agent_type} may not use MCP tool ${tool}. Add it to "mcpAllow" in remake.json if the clean side needs it.`);
    }
  }

  // Whoever spawns a clean role writes its whole world; that prompt must not
  // carry the room or a blocked implementation into it.
  if (AGENT_TOOLS.has(tool) && CLEAN_ROLES.has(roleOf(input.subagent_type))) {
    const prompt = lower(open ? stripOriginal(input.prompt || "") : input.prompt || "");
    const term = blockedTermHit([prompt], run.blocked || []);
    if (prompt.includes(ROOM_MARK) || term)
      return deny(`a ${roleOf(input.subagent_type)} prompt may not name ${term ? `"${term}"` : "the room"}. Clean roles work from spec/ and tests/ alone.`);
  }

  if (!role) return null;
  // real_paths: symlink-resolved targets supplied by guard.mjs, so a link
  // inside the tree that points at the room is caught too.
  const real = (hook.real_paths || []).map(norm);
  // Open mode lets the clean side read the original, and nothing else in the room.
  const lift = open && !WRITE_TOOLS.has(tool);
  const resolved = targets_(tool, input, cwd);
  const touchesRoom = [...(lift ? texts.map(stripOriginal) : texts), ...[...real, ...resolved].filter((t) => !(lift && inOriginal(t)))]
    .some((t) => lower(t).includes(ROOM_MARK));
  const targets = [...resolved, ...real];

  if (ROOM_ROLES.has(role)) {
    const ownScratch = (t) => inScratchpad(t, tmp, hook.session_id);
    if (WRITE_TOOLS.has(tool) && !targets.every((t) => lower(t).includes(ROOM_MARK) || ownScratch(t)))
      return deny(`${role} writes only inside the room or this session's scratchpad. The app tree is for builders.`);
    if (role === "test-writer" && [...texts.map(folded), ...targets.map(folded)].some((t) => t.includes(`${ROOM_MARK}/evidence`)))
      return deny("test-writer works from the spec alone, never the evidence.");
    return null;
  }

  // Clean side: builder, merger, verifier, reviewer.
  if (touchesRoom) return deny(`${role} may not touch the room. Work from spec/ and tests/ in the app tree.`);
  if ([...texts, ...real].some(namesScratchpad) || targets.some((t) => inScratchpad(t, tmp)))
    return deny(`${role} may not touch the session scratchpad; room agents share it. Keep temp files in your own tree.`);
  const mainRoot = norm(run.logRoot || run.root);
  if (readsRunLogs([...texts, ...real], READ_TOOLS.has(tool) ? targets : [], [cwd, norm(run.root), mainRoot]))
    return deny(`${role} may not read wall.log or audit.log; they record the room's paths.`);

  if (READ_TOOLS.has(tool)) {
    const roots = [cwd, run.root, ...TOOLCHAIN_DIRS.map((d) => norm(path.join(home, d))), ...(lift ? [`${mainRoot}${ORIGINAL_DIR}`] : [])];
    const outside = targets.find((t) => !roots.some((r) => isInside(t, r)));
    if (outside) return deny(`${role} may read only its own tree and toolchains, not ${outside}.`);
  }

  if (SHELL_TOOLS.has(tool)) {
    const raw = lift ? stripOriginal(input.command || "") : input.command || "";
    const cmd = lower(raw);
    const plain = deobfuscate(raw);
    const agentCli = agentCliHit(raw, role);
    if (agentCli) return deny(`${role} may not start another agent (${agentCli}); it would run outside the wall.`);
    if ([cmd, plain].some((c) => /(^|[^a-z])(evidence|sealed)([^a-z]|$)/.test(c))) return deny(`${role} may not reach for evidence or sealed tests.`);
    if (plain.includes(ROOM_MARK) || ROOM_FRAGMENT.test(plain)) return deny(`${role} may not name the room, even in pieces.`);
    if (/\.\.\/[^\s]*[*?]/.test(cmd)) return deny(`${role} may not glob outside its tree.`);
    const glob = shellGlobsRoom(raw, cwd, `${mainRoot}${ROOM_MARK}`);
    if (glob) return deny(`${role} may not use a pattern that matches the room (${glob}).`);
    if (NAMES_LOG.test(plain)) return deny(`${role} may not read wall.log or audit.log; they record the room's paths.`);
    const assigned = agentAssigned(plain) || agentAssigned(raw);
    if (assigned) return deny(`${role} may not start another agent (${assigned} via a variable); it would run outside the wall.`);
    // The unstripped command: a stripped `cd original` would leave later ../ resolving against the tree.
    const reach = shellReach(input.command || "", cwd, run, home, mainRoot, lift);
    if (reach) return deny(`${role} may not reach outside its tree (${reach}). Name paths inside the tree.`);
    const encoded = encodedHit(raw);
    if (encoded) return deny(`${role} may not decode its way to the room (${encoded}).`);
    const inline = simpleCommands(raw).some((toks) => {
      const { prog, at } = programOf(toks);
      return INTERPRETERS.has(prog) && toks.slice(at + 1, at + 4).some((f) => EVAL_FLAGS.has(f.toLowerCase()));
    }) || heredocRunner(raw);
    if (inline && /["'`]\.\.([/\\]|["'`])/.test(plain)) return deny(`${role} may not reach outside its tree from an inline script.`);
  }

  if (WRITE_TOOLS.has(tool)) {
    // .remake/tmp/ is every clean role's own scratch space: the session scratchpad is shared with the room.
    const inWork = (t, dir) => [cwd, run.root].some((r) => isInside(t, norm(path.join(r, ".remake", dir))));
    if (targets.length && targets.every((t) => inWork(t, "tmp"))) return null;
    if (role === "merger") {
      // Merging resolves conflicts in the code and ticks features.json; the yardstick stays as it is.
      const locked = targets.find((t) => !inWork(t, "progress") &&
        ["tests", "spec", "remake.json", ".remake"].some((p) => isInside(t, norm(path.join(cwd, p))) || isInside(t, norm(path.join(run.root, p)))));
      if (locked) return deny("merger writes code, .remake/progress/ and .remake/tmp/ only; tests/, spec/ and remake.json stay as published.");
      return null;
    }
    if (role !== "builder") {
      const ok = targets.every((t) => /\/\.remake\/(reports|tmp)\//.test(lower(t)));
      if (!ok) return deny(`${role} writes only to .remake/reports/ and .remake/tmp/.`);
      return null;
    }
    const locked = targets.find((t) =>
      ["tests", "spec", "remake.json", ".remake"].some((p) => isInside(t, norm(path.join(cwd, p))) || isInside(t, norm(path.join(run.root, p)))),
    );
    if (locked) return deny("tests/, spec/ and remake.json are read-only for builders. Change the code, not the yardstick. Temp files go in .remake/tmp/.");
  }
  return null;
}
