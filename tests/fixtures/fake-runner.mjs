// A stand-in test runner for the parity tests. Each case file in the suite
// directory is JSON { id, fn, args, expect }; the runner calls the app's
// src/calc.mjs and writes JUnit (visible) or TAP (sealed), so both parsers
// are exercised end to end.
//
//   node fake-runner.mjs <visible|sealed> <tests dir> <report>

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [suite, dir, report] = process.argv.slice(2);
const calc = await import(pathToFileURL(path.resolve("src/calc.mjs")).href);
const cases = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));

const results = cases.map((c) => {
  try {
    const got = calc[c.fn](...c.args);
    return { id: c.id, ok: got === c.expect, message: `expected ${c.expect}, got ${got}` };
  } catch (err) {
    return { id: c.id, ok: false, message: err.message };
  }
});

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
if (suite === "visible") {
  const body = results.map((r) => r.ok
    ? `  <testcase classname="fixture" name="fixture::${esc(r.id)}"/>`
    : `  <testcase classname="fixture" name="fixture::${esc(r.id)}"><failure message="${esc(r.message)}">trace</failure></testcase>`);
  writeFileSync(report, `<?xml version="1.0"?>\n<testsuites><testsuite name="visible">\n${body.join("\n")}\n</testsuite></testsuites>\n`);
} else {
  const lines = ["TAP version 13", `1..${results.length}`];
  results.forEach((r, i) => {
    lines.push(`${r.ok ? "ok" : "not ok"} ${i + 1} - ${r.id}`);
    if (!r.ok) lines.push("  ---", `  error: '${r.message}'`, "  ...");
  });
  writeFileSync(report, lines.join("\n") + "\n");
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
