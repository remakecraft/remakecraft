import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("../scripts/runners/node-suite.mjs", import.meta.url));
// A child node --test inherits this from the outer run and then skips its files.
const { NODE_TEST_CONTEXT: _, ...env } = process.env;

test("with a report, the suite runner prints the pass count and each failure", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rc-suite-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "tests", "visible"), { recursive: true });
  writeFileSync(path.join(dir, "tests", "visible", "a.test.mjs"), [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'test("cmd.add.adds", () => assert.equal(1 + 1, 2));',
    'test("cmd.help.usage <line>", () => assert.equal("tally 1\\n8", "tally 1\\n7"));',
  ].join("\n"));
  const report = path.join(dir, "visible.xml");
  const r = spawnSync(process.execPath, [RUNNER, "tests/visible", report], { cwd: dir, encoding: "utf8", env, windowsHide: true });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^1\/2 passed$/m);
  assert.match(r.stdout, /^ {2}FAIL cmd\.help\.usage <line>: .*strictly equal/m);
  assert.doesNotMatch(r.stdout, /cmd\.add\.adds/);
});

test("--bin points the tests at another program through REMAKE_APP_BIN", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rc-suite-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "t"));
  writeFileSync(path.join(dir, "original.mjs"), "");
  writeFileSync(path.join(dir, "t", "a.test.mjs"), [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'test("bin", () => assert.equal(process.env.REMAKE_APP_BIN, process.env.EXPECT));',
  ].join("\n"));
  const ok = spawnSync(process.execPath, [RUNNER, "t", "--bin", "original.mjs"], { cwd: dir, encoding: "utf8", env: { ...env, EXPECT: path.join(dir, "original.mjs") }, windowsHide: true });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const missing = spawnSync(process.execPath, [RUNNER, "t", "--bin", "nope.mjs"], { cwd: dir, encoding: "utf8", env, windowsHide: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No program at nope\.mjs/);
});

test("without a report, the suite runner prints only node's own output", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rc-suite-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "t"));
  writeFileSync(path.join(dir, "t", "a.test.mjs"), 'import { test } from "node:test";\ntest("ok", () => {});\n');
  const r = spawnSync(process.execPath, [RUNNER, "t"], { cwd: dir, encoding: "utf8", env, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /passed$/m);
});
