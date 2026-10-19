#!/usr/bin/env node
// Runs every *.test.* file under one suite's directory with node --test,
// writing a JUnit report when given one. It exists because a suite cannot be
// named portably on the command line: Node 20 takes no glob patterns after
// --test, and Node 22+ takes no directories, so the files are listed here and
// passed one by one.
//
// parity.mjs runs it from the plugin with a report path. init-run copies it
// into Node apps as scripts/run-suite.mjs, so the app's own `npm test` runs the
// visible suite with the same file list.
//
//   node run-suite.mjs <tests dir> [report] [--bin <program>]     (cwd: the app root)
//
// --bin sets REMAKE_APP_BIN for the tests, which is how the room runs a suite
// against the original before publishing it. It is a flag rather than an env
// prefix so the call still matches the run's `node` permission rule.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const binAt = argv.indexOf("--bin");
const bin = binAt === -1 ? undefined : argv[binAt + 1];
if (binAt !== -1) argv.splice(binAt, 2);
const [dir, report] = argv;
if (!dir || (binAt !== -1 && !bin)) {
  process.stderr.write("Usage: run-suite.mjs <tests dir> [report] [--bin <program>]\n");
  process.exit(2);
}
if (bin && !existsSync(bin)) {
  process.stderr.write(`No program at ${bin}\n`);
  process.exit(1);
}
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  process.stderr.write(`No test directory at ${dir}\n`);
  process.exit(1);
}

// The same files "<dir>/**/*.test.*" matches: dotfiles and node_modules skipped.
const isTestFile = (name) => !name.startsWith(".") && /\.test\.[^.]+$/.test(name);
function collect(at, out) {
  for (const e of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(at, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.isFile() && isTestFile(e.name)) out.push(p);
  }
  return out;
}

const files = collect(dir, []);
if (files.length === 0) {
  process.stderr.write(`No *.test.* files under ${dir}\n`);
  process.exit(1);
}

const reporter = report ? ["--test-reporter=junit", `--test-reporter-destination=${report}`] : [];
const env = bin ? { ...process.env, REMAKE_APP_BIN: path.resolve(bin) } : process.env;
const r = spawnSync(process.execPath, ["--test", ...reporter, ...files], { stdio: "inherit", windowsHide: true, env });
if (r.error) {
  process.stderr.write(`Could not start node --test: ${r.error.message}\n`);
  process.exit(1);
}
// The JUnit reporter writes nothing to the terminal, so agents used to grep the
// XML by hand. Print the count and each failure instead. Node leaves > unescaped
// inside attribute values, so attributes are matched as quoted strings.
if (report && existsSync(report)) process.stdout.write(summarize(readFileSync(report, "utf8")));
process.exit(r.status ?? 1);

/** "N/M passed" and one line per failing test, from a node --test JUnit report. */
function summarize(xml) {
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, " ").replace(/&amp;/g, "&");
  const cases = [...xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => {
    const name = unescape(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? "?");
    const fail = /<(failure|error)\b((?:[^>"]|"[^"]*")*)/.exec(m[3] ?? "");
    const skipped = /<skipped\b/.test(m[3] ?? "");
    const message = fail ? unescape(/\bmessage="([^"]*)"/.exec(fail[2])?.[1] ?? fail[1]).replace(/\s+/g, " ").slice(0, 200) : "";
    return { name, fail: Boolean(fail) || skipped, message: skipped && !fail ? "skipped (counts as a fail)" : message };
  });
  const failed = cases.filter((c) => c.fail);
  return [`${cases.length - failed.length}/${cases.length} passed`, ...failed.map((c) => `  FAIL ${c.name}: ${c.message}`)].join("\n") + "\n";
}
