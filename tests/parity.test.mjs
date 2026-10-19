import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, tempDir, write } from "./helpers.mjs";
import { APP_SOURCE, makeRun, publishAndBuild, SEALED } from "./fixture.mjs";

const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const parityJson = (run) => json(path.join(run.root, ".remake", "reports", "parity.json"));

// Sealed test ids and their assertion text must never leave the harness.
function assertNoSealedLeak(...texts) {
  for (const text of texts)
    for (const c of SEALED) {
      assert.ok(!text.includes(c.id), `sealed test id ${c.id} leaked`);
      assert.ok(!text.includes(`expected ${c.expect}`), `sealed assertion for ${c.id} leaked`);
    }
}

test("parity scores visible and sealed, per layer and per feature", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  // A private temp dir, so the cleanup check is not confused by parallel tests.
  const tmp = tempDir(t, "rc-tmp");
  const r = cli("parity.mjs", [], run.root, { TMPDIR: tmp, TEMP: tmp, TMP: tmp });
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(readdirSync(tmp), [], "the scratch checkout is removed");
  assert.equal(gitIn(run.root, "worktree", "list").split("\n").length, 1, "no worktree left registered");

  const p = parityJson(run);
  assert.equal(p.ok, true);
  assert.equal(p.hashes.ok, true);
  assert.equal(p.stubs.ok, true);
  assert.equal(p.suites.visible.format, "junit");
  assert.equal(p.suites.sealed.format, "tap");
  // 4/5 visible + 1/2 sealed = 5/7, floored to one decimal.
  assert.deepEqual(p.score, {
    overall: 71.4, passed: 5, total: 7,
    visible: { passed: 4, total: 5, rate: 80 }, sealed: { passed: 1, total: 2, rate: 50 },
  });
  assert.deepEqual(p.layers.behaviour, { visible: { passed: 1, total: 2, rate: 50 }, sealed: { passed: 1, total: 1, rate: 100 }, overall: 66.6, total: 3 });
  assert.deepEqual(p.layers.pixel, { visible: { passed: 3, total: 3, rate: 100 }, sealed: { passed: 0, total: 1, rate: 0 }, overall: 75, total: 4 });
  assert.equal(p.layers.format.total, 0, "empty layers stay in the table");
  assert.equal(p.layers.ui.overall, null);

  assert.deepEqual(p.overfit, ["calc.mul"], "the lookup table passes visible and fails sealed");
  assert.deepEqual(p.visibleFailures, [{ test: "add.neg", feature: "calc.add", status: "fail", message: "expected -1, got 5" }]);

  assert.deepEqual(json(path.join(run.root, ".remake", "progress", "features.json")).map(({ checkedAt, ...f }) => f), [
    { id: "calc.add", priority: "must", layer: "behaviour", status: "failing", passed: 2, total: 3 },
    { id: "calc.mul", priority: "should", layer: "pixel", status: "failing", passed: 3, total: 4 },
  ]);

  assert.match(r.out, /Parity 71\.4% \(5\/7 tests\)/);
  assert.match(r.out, /Overfitting: calc\.mul \(visible 100%, sealed 0%\)/);
  assertNoSealedLeak(JSON.stringify(p), r.out, r.err, readFileSync(path.join(run.root, ".remake", "reports", "visible-output.log"), "utf8"));
});

test("a correct app scores 100 and every feature passes", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "src", "calc.mjs"), "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
  gitIn(run.root, "commit", "-qam", "fix: real math");
  const r = cli("parity.mjs", ["--app", run.root]);
  assert.equal(r.code, 0, r.err);
  const p = parityJson(run);
  assert.equal(p.score.overall, 100);
  assert.deepEqual(p.overfit, []);
  assert.ok(json(path.join(run.root, ".remake", "progress", "features.json")).every((f) => f.status === "passing"));
});

test("only HEAD is scored; uncommitted work is noted", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "src", "calc.mjs"), "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 0, r.err);
  assert.equal(parityJson(run).score.overall, 71.4);
  assert.match(r.out, /uncommitted changes/);
});

test("a committed edit to a visible test stops the run with exit 3", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "tests", "visible", "add.neg.json"), { id: "add.neg", fn: "add", args: [2, -3], expect: 5 });
  gitIn(run.root, "commit", "-qam", "feat: make it pass");
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 3, r.err + r.out);
  const p = parityJson(run);
  assert.equal(p.hashes.ok, false);
  assert.deepEqual(p.hashes.app.map((d) => `${d.change} ${d.path} ${d.where}`).sort(), [
    "changed tests/visible/add.neg.json HEAD",
    "changed tests/visible/add.neg.json working tree",
  ]);
  assert.equal(p.score, undefined, "no score from a bent yardstick");
  assert.match(r.out, /STOP: the yardstick changed/);
});

test("an added spec file or an edited sealed test also counts as tampering", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "spec", "extra.md"), "sneaky");
  write(path.join(run.room, "sealed", "mul.seven.json"), { id: "mul.seven", fn: "mul", args: [2, 2], expect: 4 });
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 3);
  const p = parityJson(run);
  assert.deepEqual(p.hashes.app, [{ path: "spec/extra.md", change: "added", where: "working tree" }]);
  assert.equal(p.hashes.sealedChanged, 1);
  assertNoSealedLeak(JSON.stringify(p), r.out);
});

test("stubs are reported by file and line and exit 4, with the score still computed", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "src", "later.mjs"), [
    "export function div(a, b) {",
    '  throw new Error("not implemented yet");',
    "}",
    "export function noop() {}",
    "",
  ].join("\n"));
  write(path.join(run.root, "src", "engine.rs"), "pub fn flood_fill() {\n    todo!()\n}\n");
  write(path.join(run.root, "tests", "helper.rs"), "fn later() { unimplemented!() }\n");
  gitIn(run.root, "add", "src", "tests/helper.rs");
  gitIn(run.root, "commit", "-qm", "feat: more ops");
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 4, r.err + r.out);
  const p = parityJson(run);
  assert.deepEqual(p.stubs.hits.map((h) => `${h.file}:${h.line} ${h.rule}`), [
    "src/engine.rs:2 todo!",
    "src/later.mjs:2 throw-not-implemented",
  ]);
  assert.deepEqual(p.stubs.emptyBodies.map((e) => `${e.file}:${e.line} ${e.name}`), ["src/later.mjs:4 noop"]);
  assert.equal(p.score.overall, 71.4);
  assert.match(r.out, /STOP: 2 stub hit\(s\)/);
  assert.match(r.out, /src\/engine\.rs:2/);
});

test("a suite that writes no report is an error, and sealed output stays in the room", (t) => {
  const run = makeRun(t);
  const cfg = json(run.cfgFile);
  cfg.commands.testSealed = `node -e "console.log('mul.seven secret')" {report}`;
  write(run.cfgFile, cfg);
  gitIn(run.root, "commit", "-qam", "chore: broken sealed runner");
  publishAndBuild(run);
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 1, r.err + r.out);
  const p = parityJson(run);
  assert.equal(p.suites.sealed.ok, false);
  assert.match(p.suites.sealed.error, /without writing \{report\}/);
  assert.equal(p.score.sealed.passed, 0, "sealed tests that did not run count as failed");
  assert.match(readFileSync(path.join(run.room, "reports", "sealed-output.log"), "utf8"), /mul\.seven secret/);
  assertNoSealedLeak(JSON.stringify(p), r.out, r.err);
});

test("a failing build scores every test as failed", (t) => {
  const run = makeRun(t);
  const cfg = json(run.cfgFile);
  cfg.commands.build = `node -e "process.exit(2)"`;
  write(run.cfgFile, cfg);
  gitIn(run.root, "commit", "-qam", "chore: failing build");
  publishAndBuild(run);
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 0, r.err);
  const p = parityJson(run);
  assert.deepEqual(p.build, { ran: true, ok: false, exitCode: 2, error: null });
  assert.equal(p.score.overall, 0);
  assert.match(r.out, /Build failed/);
  assert.ok(existsSync(path.join(run.root, ".remake", "reports", "build-output.log")));
});

test("a sealed dir planted in HEAD is replaced by the real holdout", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "tests", "sealed", "mul.seven.json"), { id: "mul.seven", fn: "mul", args: [2, 2], expect: 4 });
  gitIn(run.root, "add", "tests/sealed");
  gitIn(run.root, "commit", "-qm", "test: helpful");
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 0, r.err);
  const p = parityJson(run);
  assert.equal(p.plantedSealedDir, true);
  assert.equal(p.score.sealed.passed, 1, "mul.seven still fails against the real sealed test");
});

// Builder-written code runs after the holdout is copied in: the build (npm
// lifecycle scripts, build.rs) and the app the suites import. Neither may
// change a test and still get a score.
const REWRITE_SEALED = [
  'import { writeFileSync } from "node:fs";',
  'import path from "node:path";',
  'const dir = path.join("tests", ["sea", "led"].join(""));',
  'writeFileSync(path.join(dir, "mul.seven.json"), JSON.stringify({ id: "mul.seven", fn: "mul", args: [7, 7], expect: -1 }));',
  "",
].join("\n");

test("a build that rewrites a sealed test stops the run with exit 3 and no score", (t) => {
  const run = makeRun(t);
  const cfg = json(run.cfgFile);
  cfg.commands.build = "node prebuild.mjs";
  write(run.cfgFile, cfg);
  write(path.join(run.root, "prebuild.mjs"), REWRITE_SEALED);
  gitIn(run.root, "add", "prebuild.mjs");
  gitIn(run.root, "commit", "-qam", "chore: a build step");
  publishAndBuild(run);
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 3, r.err + r.out);
  const p = parityJson(run);
  assert.equal(p.hashes.ok, false);
  assert.deepEqual(p.hashes.scratch, { stage: "build", files: 1 });
  assert.equal(p.score, undefined, "no score from a bent yardstick");
  assert.equal(p.suites.sealed, undefined, "tests were not run");
  assert.match(r.out, /1 test file\(s\) changed during the build/);
  assertNoSealedLeak(JSON.stringify(p), r.out);
});

test("app code that rewrites a sealed test while the suites run stops the run with exit 3", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "src", "calc.mjs"), REWRITE_SEALED + "\n" + APP_SOURCE);
  gitIn(run.root, "commit", "-qam", "feat: calc, with a side effect");
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 3, r.err + r.out);
  const p = parityJson(run);
  assert.deepEqual(p.hashes.scratch, { stage: "tests", files: 1 });
  assert.equal(p.score, undefined);
  assert.equal(existsSync(path.join(run.root, ".remake", "reports", "history.jsonl")), false, "no history line for an unscored run");
});

test("app code that reaches for the test harness is a stub hit", (t) => {
  const run = makeRun(t);
  publishAndBuild(run);
  write(path.join(run.root, "src", "harness.mjs"), [
    'import assert from "node:assert";',
    "assert.equal = () => {};",
    "export const underTest = Boolean(process.env.NODE_TEST_CONTEXT);",
    'export const holdout = "tests/sealed";',
    "require.cache = {};",
    "",
  ].join("\n"));
  write(path.join(run.root, "src", "engine.rs"), 'fn main() { let _ = std::env::var("NEXTEST_RUN_ID"); }\n');
  write(path.join(run.root, "src", "fine.mjs"), 'import { readFileSync } from "node:fs";\nexport const assertValid = (x) => x;\nexport const sealedEnvelope = 1;\n');
  gitIn(run.root, "add", "src");
  gitIn(run.root, "commit", "-qm", "feat: harness");
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 4, r.err + r.out);
  assert.deepEqual(parityJson(run).stubs.hits.map((h) => `${h.file}:${h.line} ${h.rule}`), [
    "src/engine.rs:1 test-runner-ref",
    "src/harness.mjs:1 assert-ref",
    "src/harness.mjs:3 test-runner-ref",
    "src/harness.mjs:4 sealed-tests-ref",
    "src/harness.mjs:5 module-loader-hook",
  ]);
});

test("parity outside a run, or before tests are published, fails clearly", (t) => {
  const run = makeRun(t);
  const lost = cli("parity.mjs", [], run.out);
  assert.equal(lost.code, 1);
  assert.match(lost.err, /Not inside a Remakecraft run/);
  const early = cli("parity.mjs", [], run.root);
  assert.equal(early.code, 1);
  assert.match(early.err, /hashes\.json .* not found|hashes\.json.*run publish\.mjs tests first/);
  assert.equal(cli("parity.mjs", ["--timeout", "0"], run.root).code, 2);
});
