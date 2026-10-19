import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { matchResults, normId, parseResults } from "../scripts/lib/results.mjs";
import { scanStubs } from "../scripts/lib/stubs.mjs";
import { cli, gitIn, tempDir, write } from "./helpers.mjs";
import { STACKS } from "../scripts/lib/stacks.mjs";
import { makeRun } from "./fixture.mjs";

test("JUnit: pass, failure, error, skipped and entities", () => {
  const xml = `<?xml version="1.0"?>
<testsuites><!-- <testcase name="commented.out"/> -->
  <testsuite name="visible">
    <testcase classname="brushling::visible" name="tool_fill::basic" time="0.1"/>
    <testcase classname="brushling::visible" name="tool_fill::edge"><failure message="left &lt; right &amp; 0x&#41;" type="assert">long trace</failure></testcase>
    <testcase name="io.save"><error><![CDATA[panicked at src/io.rs:4]]></error></testcase>
    <testcase name="ui.menu"><skipped/></testcase>
  </testsuite>
</testsuites>`;
  const { format, results } = parseResults(xml);
  assert.equal(format, "junit");
  assert.deepEqual(results, [
    { name: "tool_fill::basic", classname: "brushling::visible", status: "pass", message: "" },
    { name: "tool_fill::edge", classname: "brushling::visible", status: "fail", message: "left < right & 0x)" },
    { name: "io.save", classname: "", status: "fail", message: "panicked at src/io.rs:4" },
    { name: "ui.menu", classname: "", status: "skip", message: "" },
  ]);
});

test("JUnit from cargo-nextest: the panic payload joins the location", () => {
  // Shape copied from cargo-nextest 0.9.148 on Windows.
  const xml = `<testsuites><testsuite name="adder::visible">
  <testcase name="add::neg" classname="adder::visible"><failure message="thread &apos;add::neg&apos; (39924) panicked at tests\\visible\\main.rs:3:24" type="test failure with exit code 101">thread &apos;add::neg&apos; (39924) panicked at tests\\visible\\main.rs:3:24:
assertion \`left == right\` failed
  left: 5
 right: -1
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace</failure></testcase>
  <testcase name="add::bare" classname="adder::visible"><failure message="thread &apos;add::bare&apos; panicked at src/lib.rs:9:5" type="x"/></testcase>
</testsuite></testsuites>`;
  assert.deepEqual(parseResults(xml).results.map((r) => r.message), [
    "thread 'add::neg' (39924) panicked at tests\\visible\\main.rs:3:24: assertion `left == right` failed; left: 5; right: -1",
    "thread 'add::bare' panicked at src/lib.rs:9:5",
  ]);
});

test("TAP: node --test nesting, directives and YAML diagnostics", () => {
  const tap = `TAP version 13
# Subtest: tool.fill.basic
ok 1 - tool.fill.basic
  ---
  duration_ms: 0.6
  ...
# Subtest: tool.fill.edge
not ok 2 - tool.fill.edge
  ---
  error: |-
    fill mismatch at (3,4)
  ...
# Subtest: grp
    ok 1 - tool.line.x
    ok 2 - tool.skip # SKIP
    1..2
ok 3 - grp
not ok 4 - tool.todo # TODO not yet
1..4`;
  const { format, results } = parseResults(tap);
  assert.equal(format, "tap");
  assert.deepEqual(results.map((r) => `${r.name}:${r.status}`), [
    "tool.fill.basic:pass", "tool.fill.edge:fail", "tool.line.x:pass", "tool.skip:skip", "tool.todo:fail",
  ], "the describe block 'grp' is not a test");
  assert.equal(results[1].message, "fill mismatch at (3,4)");
});

test("unknown results formats are rejected", () => {
  assert.throws(() => parseResults("PASS everything"), /neither JUnit XML nor TAP/);
  assert.throws(() => parseResults("<html></html>"), /no <testsuite>/);
});

test("ids match runner names across Rust paths and prefixes, exact first", () => {
  assert.equal(normId("tool_fill::basic"), "tool_fill.basic");
  const results = [
    { name: "tool_fill::basic", classname: "brushling::visible", status: "pass" },
    { name: "basic", classname: "x", status: "fail", message: "nope" },
    { name: "case", classname: "io.png", status: "pass" },
    { name: "case", classname: "io.png", status: "fail", message: "second param" },
    { name: "stray", classname: "", status: "pass" },
  ];
  const { byId, unmatched } = matchResults(["tool_fill.basic", "basic", "io.png.case", "never.ran"], results);
  assert.deepEqual(byId.get("tool_fill.basic"), { status: "pass", message: "" });
  assert.deepEqual(byId.get("basic"), { status: "fail", message: "nope" }, "exact match wins over a suffix match");
  assert.deepEqual(byId.get("io.png.case"), { status: "fail", message: "second param" }, "every repeat must pass");
  assert.equal(byId.get("never.ran").status, "missing");
  assert.equal(unmatched, 1);
});

test("stub scan: hard hits by file:line, empty bodies as warnings, tests/ and deps skipped", (t) => {
  const dir = tempDir(t);
  write(path.join(dir, "src", "a.rs"), [
    "fn ok() -> u8 { 1 }",
    "fn later() { todo!() }",
    "fn gone() { unimplemented!(\"soon\") }",
    "fn boom() { panic!(\"Not implemented: fill\") }",
    "fn noop(&self) {}",
    "fn fine() { panic!(\"bad input\") }",
  ].join("\n"));
  write(path.join(dir, "src", "b.ts"), "export function x(): void {}\nthrow new TypeError('not yet implemented');\n");
  write(path.join(dir, "py", "c.py"), "def run(self):\n    pass\n\ndef go():\n    raise NotImplementedError\n");
  write(path.join(dir, "tests", "visible", "t.rs"), "fn t() { todo!() }");
  write(path.join(dir, "node_modules", "dep", "i.js"), "throw new Error('not implemented')");
  write(path.join(dir, "src", "tests", "inner.rs"), "fn t() { todo!() }");
  const { hits, empty } = scanStubs(dir);
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line} ${h.rule}`).sort(), [
    "py/c.py:5 NotImplementedError",
    "src/a.rs:2 todo!",
    "src/a.rs:3 unimplemented!",
    "src/a.rs:4 panic-not-implemented",
    "src/b.ts:2 throw-not-implemented",
    "src/tests/inner.rs:1 todo!",
  ]);
  assert.deepEqual(empty.map((e) => `${e.file}:${e.line} ${e.name}`).sort(), ["py/c.py:1 run", "src/a.rs:5 noop", "src/b.ts:1 x"]);
});

test("the web preset runs real node --test files end to end", (t) => {
  const run = makeRun(t, { cases: false });
  const cfg = JSON.parse(readFileSync(run.cfgFile, "utf8"));
  cfg.commands = { ...STACKS.web.commands, build: "" }; // no npm install in tests
  writeFileSync(run.cfgFile, JSON.stringify(cfg, null, 2));
  gitIn(run.root, "commit", "-qam", "chore: real web preset");

  const testFile = (id, expr) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as calc from "../../src/calc.mjs";\ntest(${JSON.stringify(id)}, () => { assert.equal(${expr}); });\n`;
  write(path.join(run.room, "tests", "visible", "add.test.mjs"), testFile("calc.add.visible", "calc.add(2, 3), 5"));
  write(path.join(run.room, "tests", "visible", "mul.test.mjs"), testFile("calc.mul.visible", "calc.mul(2, 3), 6"));
  write(path.join(run.room, "sealed", "add.test.mjs"), testFile("calc.add.sealed", "calc.add(10, 20), 30"));
  write(path.join(run.room, "sealed", "mul.test.mjs"), testFile("calc.mul.sealed", "calc.mul(7, 7), 49"));
  write(path.join(run.room, "tests", "manifest.json"), { version: 1, tests: [
    { id: "calc.add.visible", feature: "calc.add", set: "visible" },
    { id: "calc.mul.visible", feature: "calc.mul", set: "visible" },
    { id: "calc.add.sealed", feature: "calc.add", set: "sealed" },
    { id: "calc.mul.sealed", feature: "calc.mul", set: "sealed" },
  ] });
  for (const what of ["spec", "tests"]) assert.equal(cli("publish.mjs", [what, "--app", run.root]).code, 0);
  write(path.join(run.root, "src", "calc.mjs"), "export const add = (a, b) => a + b;\nexport const mul = (a, b) => (a === 7 ? 0 : a * b);\n");
  gitIn(run.root, "add", "src");
  gitIn(run.root, "commit", "-qm", "feat: calc");

  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 0, r.err + r.out);
  const p = JSON.parse(readFileSync(path.join(run.root, ".remake", "reports", "parity.json"), "utf8"));
  assert.equal(p.suites.visible.format, "junit");
  assert.deepEqual([p.score.visible.passed, p.score.sealed.passed, p.score.total], [2, 1, 4]);
});
