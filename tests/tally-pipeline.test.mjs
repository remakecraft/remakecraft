// The scripted half of the tiny-app-parity eval, without the model: the real
// init-run, publish and parity scripts on the web preset (npm install and all),
// with hand-written spec and tests for tally and the hidden original standing
// in for the clone. It runs everywhere, including Windows where the eval
// itself cannot (no shell sandbox), and it checks that the eval's file graders
// match the report parity.mjs really writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PLUGIN, cli, gitIn, tempDir, write } from "./helpers.mjs";

const FIXTURE = path.join(PLUGIN, "evals", "fixtures", "toy-original");
const CASE = path.join(PLUGIN, "evals", "tiny-app-parity");

const SPEC = {
  app: "tally",
  version: 1,
  features: [
    { id: "count.change", layer: "behaviour", priority: "must", acceptance: ["add and sub change the count by 1 or n", "sub never goes below 0"] },
    { id: "count.undo", layer: "behaviour", priority: "must", acceptance: ["undo restores the previous value", "at most 10 steps are kept", "empty undo prints nothing to undo and exits 1"] },
    { id: "file.save", layer: "format", priority: "must", acceptance: ["the save file is 'tally 1', the value, then the undo values"] },
  ],
};

// Each test runs tally in its own empty dir; cwd is the checkout parity scores.
const HEADER = `import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const TALLY = path.resolve("src/tally.mjs");
const session = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tally-t-"));
  return (...args) => {
    const r = spawnSync(process.execPath, [TALLY, ...args], { cwd: dir, encoding: "utf8" });
    return { out: r.stdout, err: r.stderr, code: r.status, file: () => readFileSync(path.join(dir, ".tally"), "utf8") };
  };
};
`;
const VISIBLE = {
  "change.add": `const t = session(); t("add"); assert.equal(t("add", "5").out, "6\\n");`,
  "change.floor": `const t = session(); t("add", "2"); assert.equal(t("sub", "9").out, "0\\n");`,
  "undo.one": `const t = session(); t("add", "3"); t("add"); assert.equal(t("undo").out, "3\\n");`,
  "undo.empty": `const t = session(); const r = t("undo"); assert.equal(r.code, 1); assert.equal(r.err, "tally: nothing to undo\\n");`,
  "save.format": `const t = session(); t("add", "2"); t("add"); assert.equal(t().file(), "tally 1\\n3\\n0\\n2\\n");`,
};
const SEALED = {
  "change.max": `const t = session(); assert.equal(t("add", "999999").out, "999999\\n"); assert.equal(t("add", "1000000").code, 2);`,
  "undo.cap": `const t = session(); for (let i = 0; i < 12; i++) t("add"); for (let i = 0; i < 10; i++) t("undo"); const r = t("undo"); assert.equal(r.code, 1); assert.equal(t("show").out, "2\\n");`,
  "save.cap": `const t = session(); for (let i = 0; i < 12; i++) t("add"); assert.equal(t().file().trimEnd().split("\\n").length, 12);`,
};
const FEATURE = { change: "count.change", undo: "count.undo", save: "file.save" };
const suiteFile = (tests) => HEADER + Object.entries(tests).map(([id, body]) => `test(${JSON.stringify(id)}, () => { ${body} });\n`).join("");

function stageRun(t) {
  const out = tempDir(t, "rc-tally");
  const init = cli("init-run.mjs", ["tally", "--out", out, "--stack", "web", "--cheap"]);
  assert.equal(init.code, 0, init.err);
  const root = path.join(out, "tally");
  const room = path.join(out, "tally.remake-room");
  cpSync(path.join(FIXTURE, "docs"), path.join(room, "evidence"), { recursive: true });

  write(path.join(room, "spec", "spec.json"), SPEC);
  write(path.join(room, "spec", "spec.md"), "# tally\n");
  write(path.join(room, "tests", "visible", "tally.test.mjs"), suiteFile(VISIBLE));
  write(path.join(room, "sealed", "tally.test.mjs"), suiteFile(SEALED));
  const entries = (tests, set) => Object.keys(tests).map((id) => ({ id, feature: FEATURE[id.split(".")[0]], set, file: "tally.test.mjs" }));
  write(path.join(room, "tests", "manifest.json"), { version: 1, tests: [...entries(VISIBLE, "visible"), ...entries(SEALED, "sealed")] });
  for (const what of ["spec", "tests"]) {
    const r = cli("publish.mjs", [what], root);
    assert.equal(r.code, 0, r.err);
  }
  return { out, root };
}

function build(root, source) {
  write(path.join(root, "src", "tally.mjs"), source);
  gitIn(root, "add", "src");
  gitIn(root, "commit", "-qm", "feat: tally");
}

/** Reads a grader's frontmatter pattern, so the test fails when the grader drifts from the report. */
function graderPattern(name) {
  const text = readFileSync(path.join(CASE, "graders", `${name}.md`), "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^pattern: '(.*)'$/m);
  assert.ok(m, `graders/${name}.md has no single-quoted pattern`);
  return new RegExp(m[1].replace(/''/g, "'"));
}

test("tally through the real scripts: the original scores 100% and passes the eval's file graders", (t) => {
  const { out, root } = stageRun(t);
  build(root, readFileSync(path.join(FIXTURE, "impl", "tally.mjs"), "utf8"));

  const r = cli("parity.mjs", [], root);
  assert.equal(r.code, 0, r.err + r.out);
  const reportFile = path.join(root, ".remake", "reports", "parity.json");
  const p = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(p.build.ok, true, "npm install ran in the scratch checkout");
  assert.deepEqual([p.suites.visible.format, p.suites.sealed.format], ["junit", "junit"]);
  assert.deepEqual(p.score, {
    overall: 100, passed: 8, total: 8,
    visible: { passed: 5, total: 5, rate: 100 }, sealed: { passed: 3, total: 3, rate: 100 },
  });

  // The eval workspace holds ./out/tally; mirror its grader paths here.
  assert.ok(existsSync(path.join(out, "tally", "src", "tally.mjs")), "app-tree: out/tally/src/**");
  assert.match(readFileSync(reportFile, "utf8"), graderPattern("parity-report"));
});

test("a clone that ignores the undo cap passes visible and fails sealed", (t) => {
  const { root } = stageRun(t);
  const original = readFileSync(path.join(FIXTURE, "impl", "tally.mjs"), "utf8");
  const uncapped = original.replace("[...s.hist, s.value].slice(-MAX_UNDO)", "[...s.hist, s.value]").replace("nums.length > MAX_UNDO + 1 || ", "");
  assert.notEqual(uncapped, original, "the mutation applied");
  build(root, uncapped);

  const r = cli("parity.mjs", [], root);
  assert.equal(r.code, 0, r.err + r.out);
  const report = readFileSync(path.join(root, ".remake", "reports", "parity.json"), "utf8");
  const p = JSON.parse(report);
  assert.deepEqual([p.score.visible.passed, p.score.sealed.passed], [5, 1]);
  assert.deepEqual(p.overfit, ["count.undo", "file.save"]);
  assert.match(report, graderPattern("parity-report"), "the report still covers the sealed suite");
});
