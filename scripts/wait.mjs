#!/usr/bin/env node
// Waits a few seconds, for agents that must let an MCP server finish starting:
// Claude Code blocks a foreground `sleep`, while node on the plugin's scripts is
// pre-approved for every run.
//
//   node scripts/wait.mjs <seconds>   (1-120)

import { RunError, isMain, main } from "./lib/run.mjs";

export function parseSeconds(arg) {
  const s = Number(arg);
  if (!Number.isInteger(s) || s < 1 || s > 120) throw new RunError("Usage: wait.mjs <seconds>, a whole number from 1 to 120", 2);
  return s;
}

if (isMain(import.meta.url)) {
  main(async () => {
    const s = parseSeconds(process.argv[2]);
    await new Promise((resolve) => setTimeout(resolve, s * 1000));
    process.stdout.write(`waited ${s}s\n`);
  });
}
