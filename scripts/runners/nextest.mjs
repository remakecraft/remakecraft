#!/usr/bin/env node
// Runner shim for Rust stacks: runs one suite (a cargo test target) under
// cargo-nextest and copies its JUnit report to where parity.mjs reads it.
// It exists because the copy step cannot be chained portably in a one-line
// command across cmd.exe and sh.
//
//   node scripts/runners/nextest.mjs <suite> <report>     (cwd: the crate root)

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [suite, report] = process.argv.slice(2);
if (!suite || !report) {
  process.stderr.write("Usage: nextest.mjs <suite> <report>\n");
  process.exit(2);
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });

const probe = run("cargo", ["nextest", "--version"]);
if (probe.error || probe.status !== 0) {
  process.stderr.write("cargo-nextest is not installed. Install it with: cargo install cargo-nextest --locked\n");
  process.exit(127);
}

// The nextest store, and so the JUnit file, lives under cargo's target dir,
// which CARGO_TARGET_DIR or .cargo/config can move.
const meta = run("cargo", ["metadata", "--format-version", "1", "--no-deps"]);
if (meta.status !== 0) {
  process.stderr.write(`cargo metadata failed:\n${meta.stderr}\n`);
  process.exit(1);
}
const targetDir = JSON.parse(meta.stdout).target_directory;

// A throwaway config so the app's own nextest.toml cannot redirect or drop the report.
const tmp = mkdtempSync(path.join(os.tmpdir(), "remake-nextest-"));
const config = path.join(tmp, "nextest.toml");
// The store dir is pinned to cargo's target dir: left to its default, nextest
// resolves it against the workspace root and ignores CARGO_TARGET_DIR, so the
// report never lands where `junit` below looks for it.
const storeDir = path.join(targetDir, "nextest").replace(/\\/g, "/");
writeFileSync(config, `[store]\ndir = ${JSON.stringify(storeDir)}\n\n[profile.remake]\nfail-fast = false\n\n[profile.remake.junit]\npath = "junit.xml"\n`);
const junit = path.join(targetDir, "nextest", "remake", "junit.xml");
rmSync(junit, { force: true });

const r = run("cargo", ["nextest", "run", "--config-file", config, "--profile", "remake", "--test", suite, "--no-fail-fast"], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
if (!existsSync(junit)) {
  process.stderr.write(`cargo nextest wrote no JUnit report (exit ${r.status}); the suite likely failed to build.\n`);
  process.exit(r.status || 1);
}
copyFileSync(junit, report);
process.exit(r.status ?? 1);
