import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_CLAUDE_VERSION, compareVersions, judgeClaudeVersion, parseClaudeVersion, requireClaudeVersion } from "../scripts/lib/claude-version.mjs";
import { cli, tempDir } from "./helpers.mjs";

test("parses the claude --version line", () => {
  assert.deepEqual(parseClaudeVersion("2.1.295 (Claude Code)\n"), [2, 1, 295]);
  assert.deepEqual(parseClaudeVersion("10.0.3"), [10, 0, 3]);
  for (const bad of ["", null, undefined, "claude: command not found", "v2.1.295", "2.1"]) assert.equal(parseClaudeVersion(bad), null, String(bad));
});

test("compares numerically, not as strings", () => {
  assert.ok(compareVersions([2, 1, 288], [2, 1, 295]) < 0);
  assert.ok(compareVersions([2, 1, 1000], [2, 1, 295]) > 0);
  assert.ok(compareVersions([2, 2, 0], [2, 1, 999]) > 0);
  assert.ok(compareVersions([3, 0, 0], [2, 9, 9]) > 0);
  assert.equal(compareVersions([2, 1, 295], [2, 1, 295]), 0);
});

test("refuses below the minimum, passes at and above it", () => {
  assert.equal(judgeClaudeVersion("2.1.294 (Claude Code)").ok, false);
  assert.equal(judgeClaudeVersion(`${MIN_CLAUDE_VERSION} (Claude Code)`).ok, true);
  assert.equal(judgeClaudeVersion("2.2.0 (Claude Code)").ok, true);
});

test("a missing binary or odd output warns instead of refusing", () => {
  for (const out of [null, "", "garbage"]) {
    const v = judgeClaudeVersion(out);
    assert.equal(v.ok, true);
    assert.match(v.warning, /Claude Code 2\.1\.295\+/);
  }
  assert.equal(requireClaudeVersion("2.1.295 (Claude Code)"), null);
});

test("requireClaudeVersion names the fix", () => {
  assert.throws(() => requireClaudeVersion("2.1.288 (Claude Code)"), /2\.1\.295\+ is required: older versions let the wall fail open.*claude update/);
});

test("init-run refuses to start a run on an old Claude Code", (t) => {
  const out = tempDir(t);
  const r = cli("init-run.mjs", ["App", "--out", out, "--stack", "web"], undefined, { REMAKECRAFT_CLAUDE_VERSION: "2.1.288 (Claude Code)" });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /claude update/);
});
