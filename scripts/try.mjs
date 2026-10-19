#!/usr/bin/env node
// /remakecraft:try: stages the tally toy app as a cheap run, so a stranger sees
// every phase on a 50-line CLI before pointing Remakecraft at a real app.
// The fixture's docs become the evidence and its program the black-box
// original; the session that runs this only copies them and never reads them.
//
//   node scripts/try.mjs [--out <dir>] [--budget <usd>] [--full] [--with-rea]
//
// --with-rea stages the same toy with the observer allowed to inspect it through
// REA. The toy ships under the plugin's MIT licence, so the basis is "license",
// and the app tree registers REA's MCP server at a pinned version.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireClaudeVersion } from "./lib/claude-version.mjs";
import { initRun } from "./init-run.mjs";
import { PLUGIN_ROOT, RunError, copyDir, gitCommit, isMain, main, parseArgs, toSlash, writeJson } from "./lib/run.mjs";
import { PER_FEATURE, TALLY, TALLY_CHEAP } from "./lib/usage.mjs";

const USAGE = "Usage: try.mjs [--out <dir>] [--budget <usd>] [--full] [--with-rea]";
export const FIXTURE = path.join(PLUGIN_ROOT, "evals", "fixtures", "toy-original");
export const APP = "tally";
export const DEFAULT_BUDGET = 8;
export const REA_PACKAGE = "rea-agents@6.7.0";

const stamp = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const money = (n) => `$${n.toFixed(2)}`;

/** The cost and time lines a stranger reads before spending anything. */
export function expectations(cheap) {
  const full = `full mode, measured: ${TALLY.parity} parity, sealed tests included; $${TALLY.costUsd}; ${TALLY.activeMin} min active plus a 10 min idle wait`;
  const cheapUsd = PER_FEATURE.cheap.usd * TALLY.features;
  const cheapLine = `cheap mode: agents on Sonnet, one builder. Measured once at $${TALLY_CHEAP.costUsd} (${TALLY_CHEAP.parity}), half of it this session's own model; switch it with /model sonnet first and the estimate is about ${money(cheapUsd)}`;
  return cheap ? [cheapLine, full] : [full, cheapLine];
}

export function stageTry(argv, { now = new Date() } = {}) {
  const { pos, flags } = parseArgs(argv, { bool: ["full", "with-rea"], value: ["out", "budget"] });
  if (pos.length) throw new RunError(USAGE, 2);
  for (const f of ["docs/MANUAL.md", "impl/tally.mjs"])
    if (!existsSync(path.join(FIXTURE, f))) throw new RunError(`The toy app is missing from this install (${toSlash(path.join(FIXTURE, f))}). Reinstall the plugin.`);

  const out = path.resolve(flags.out ?? path.join(os.homedir(), "remakecraft-try", stamp(now)));
  const cheap = !flags.full;
  const rea = Boolean(flags["with-rea"]);
  const budget = flags.budget ?? String(cheap ? DEFAULT_BUDGET : DEFAULT_BUDGET * 2);
  const r = initRun([
    APP, "--out", out, "--stack", "web", "--budget", budget,
    ...(cheap ? ["--cheap"] : []),
    ...(rea ? ["--with-rea", "--basis", "license"] : []),
  ]);
  if (rea) registerRea(r.root);

  // Evidence: the manual and three recorded sessions. Original: the program, run as a black box.
  copyDir(path.join(FIXTURE, "docs"), path.join(r.room, "evidence"));
  const original = path.join(r.room, "original", "tally.mjs");
  copyFileSync(path.join(FIXTURE, "impl", "tally.mjs"), original);
  writeFileSync(
    path.join(r.room, "evidence", "ORIGINAL.md"),
    [
      "# The original app",
      "",
      "tally is a command-line counter. It is installed at:",
      "",
      `    ${toSlash(original)}`,
      "",
      `Run it as a black box from a scratch folder, for example \`node "${toSlash(original)}" add 3\`, and record`,
      "what it prints, the files it writes and its exit codes.",
      rea
        ? "This run is --with-rea (basis: license; the toy ships under MIT): the observer alone may also inspect the file through REA, and writes behaviour only. It is a demo of REA mode, so after the black-box pass, open the file with REA, use it to settle every UNKNOWN and to check the exit codes and file formats you observed, and tag what REA settled or confirmed `\"source\": \"rea\"`."
        : "Never open, search or copy the file itself.",
      "",
    ].join("\n"),
  );
  return { ...r, cheap, rea, budget: Number(budget) };
}

// Compact input schemas cut REA's ~200 tool definitions from about 760 KB to 180 KB;
// the full set is bigger than the observer's whole context.
export const REA_ENV = { REA_MCP_INPUT_SCHEMA_PROFILE: "compact" };

/**
 * Registers REA's MCP server for sessions in the app tree: a pinned .mcp.json,
 * committed so builders' worktrees see the same config (the wall denies them REA),
 * and enabled in the local settings so the run does not stop to ask.
 */
function registerRea(root) {
  writeJson(path.join(root, ".mcp.json"), { mcpServers: { rea: { command: "npx", args: ["-y", REA_PACKAGE, "mcp"], env: REA_ENV } } });
  gitCommit(root, "chore: register REA for the observer", [".mcp.json"]);
  const settingsFile = path.join(root, ".claude", "settings.local.json");
  writeJson(settingsFile, { ...JSON.parse(readFileSync(settingsFile, "utf8")), enabledMcpjsonServers: ["rea"] });
}

if (isMain(import.meta.url)) {
  main(() => {
    const warning = requireClaudeVersion();
    if (warning) process.stderr.write(`Remakecraft: warning: ${warning}\n`);
    const r = stageTry(process.argv.slice(2));
    const root = toSlash(r.root);
    process.stdout.write(
      [
        `Staged the tally toy app (${r.cheap ? "cheap mode" : "full mode"}${r.rea ? ", observer uses REA" : ""}) at ${root}`,
        ...(r.rea ? [`  REA       ${REA_PACKAGE} is registered in ${root}/.mcp.json; npx downloads it on first use (Node 22.19+)`] : []),
        `  evidence  its manual and three recorded sessions, in ${toSlash(path.join(r.room, "evidence"))}`,
        `  original  the program itself, ${r.rea ? "runnable, and readable by the observer alone through REA" : "runnable but never readable"}, in ${toSlash(path.join(r.room, "original"))}`,
        `  budget    $${r.budget}: the run stops cleanly at the next checkpoint once it is spent ("budgetUsd" in remake.json)`,
        `What to expect for tally (${TALLY.features} features):`,
        ...expectations(r.cheap).map((l) => `  ${l}`),
        "You approve the spec once, in chat or on the run page (http://127.0.0.1:4317).",
        "Start it in a new terminal; builders need a session that starts inside the app tree:",
        "",
        `  cd "${root}" && claude "/remakecraft:remake ${APP}"`,
        "",
      ].join("\n"),
    );
  });
}
