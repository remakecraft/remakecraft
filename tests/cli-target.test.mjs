// A CLI target: the Node suites start the clone's entry point through
// REMAKE_APP_BIN, so the web preset's test commands must pass --bin. Without
// it the first parity run of the chardet proof run scored 0/235.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, tempDir, write } from "./helpers.mjs";
import { checkBin, stackCommands, STACKS } from "../scripts/lib/stacks.mjs";
import { RunError } from "../scripts/lib/run.mjs";

const json = (f) => JSON.parse(readFileSync(f, "utf8"));

const SPEC = {
  app: "Echo",
  version: 1,
  features: [{ id: "cli.echo", inventory: ["cli.args"], layer: "behaviour", priority: "must", summary: "prints its arguments", acceptance: ["`echo a b` prints `a b`"] }],
};
// Each test starts whatever REMAKE_APP_BIN names, as test-writer.md tells the tests to.
const HEADER = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { spawnSync } from "node:child_process";\n';
const echoCase = (id, args, expect) => `test(${JSON.stringify(id)}, () => {
  const r = spawnSync(process.execPath, [process.env.REMAKE_APP_BIN, ...${JSON.stringify(args)}], { encoding: "utf8" });
  assert.equal(r.stdout, ${JSON.stringify(expect)});
});
`;
const ECHO = 'process.stdout.write(process.argv.slice(2).join(" ") + "\\n");\n';

/** A web run of a CLI with the preset's own test commands, published and built. */
function cliRun(t, initArgs) {
  const out = tempDir(t, "rc-cli");
  const r = cli("init-run.mjs", ["Echo", "--out", out, "--stack", "web", ...initArgs]);
  assert.equal(r.code, 0, r.err);
  const root = path.join(out, "Echo");
  const room = path.join(out, "Echo.remake-room");
  // Only the install is skipped (no network in tests); the test commands are the preset's.
  const cfg = json(path.join(root, "remake.json"));
  write(path.join(root, "remake.json"), { ...cfg, commands: { ...cfg.commands, build: "" } });
  gitIn(root, "commit", "-qam", "chore: no install");

  write(path.join(room, "spec", "spec.json"), SPEC);
  write(path.join(room, "spec", "spec.md"), "# Echo\n\n## cli.echo\n");
  write(path.join(room, "tests", "visible", "echo.test.mjs"), HEADER + echoCase("echo.two", ["a", "b"], "a b\n") + echoCase("echo.one", ["x"], "x\n"));
  write(path.join(room, "sealed", "echo.test.mjs"), HEADER + echoCase("echo.three", ["p", "q", "r"], "p q r\n"));
  write(path.join(room, "tests", "manifest.json"), {
    version: 1,
    tests: [
      { id: "echo.two", feature: "cli.echo", set: "visible", file: "echo.test.mjs" },
      { id: "echo.one", feature: "cli.echo", set: "visible", file: "echo.test.mjs" },
      { id: "echo.three", feature: "cli.echo", set: "sealed", file: "echo.test.mjs" },
    ],
  });
  for (const what of ["spec", "tests"]) {
    const p = cli("publish.mjs", [what, "--app", root]);
    assert.equal(p.code, 0, `publish ${what}: ${p.err}`);
  }
  write(path.join(root, "bin", "echo.mjs"), ECHO);
  gitIn(root, "add", "bin");
  gitIn(root, "commit", "-qm", "feat(cli.echo): echo");
  return { root, cfg };
}

test("init-run --bin puts the entry on both web test commands and on npm test", (t) => {
  const { root, cfg } = cliRun(t, ["--bin", "bin/echo.mjs"]);
  for (const k of ["testVisible", "testSealed"]) assert.match(cfg.commands[k], / --bin "bin\/echo\.mjs"$/, k);
  assert.equal(json(path.join(root, "package.json")).scripts.test, "node scripts/run-suite.mjs tests/visible --bin bin/echo.mjs");
});

test("a CLI's suites score against its entry point when init-run is given --bin", (t) => {
  const { root } = cliRun(t, ["--bin", "bin/echo.mjs"]);
  // HEAD is scored, not the working tree: the path is relative to the scratch checkout.
  write(path.join(root, "bin", "echo.mjs"), "process.stdout.write('broken\\n');\n");
  const r = cli("parity.mjs", [], root);
  assert.equal(r.code, 0, r.err + r.out);
  const p = json(path.join(root, ".remake", "reports", "parity.json"));
  assert.deepEqual(p.score, { overall: 100, passed: 3, total: 3, visible: { passed: 2, total: 2, rate: 100 }, sealed: { passed: 1, total: 1, rate: 100 } });
  assert.match(r.out, /uncommitted changes/);
});

test("without --bin the same CLI suites have no program to start and score 0", (t) => {
  // The 0.1.0 behaviour, kept so the regression stays visible.
  const { root } = cliRun(t, []);
  cli("parity.mjs", [], root);
  assert.equal(json(path.join(root, ".remake", "reports", "parity.json")).score.passed, 0);
});

test("--bin is checked before anything is created", (t) => {
  for (const bad of ["../echo.mjs", "/usr/bin/echo", "C:/echo.exe", "bin/../../x", "bin/my echo.mjs", 'bin/"x', "-x", "bin//x"])
    assert.throws(() => checkBin(bad), RunError, bad);
  assert.equal(checkBin("bin\\echo.mjs"), "bin/echo.mjs");
  assert.equal(checkBin("./dist/cli.js"), "dist/cli.js");

  assert.throws(() => stackCommands("rust-egui", { bin: "target/debug/app" }), /CARGO_BIN_EXE/);
  assert.deepEqual(stackCommands("web"), STACKS.web.commands, "no --bin, no change");
  assert.match(stackCommands("tauri", { bin: "bin/app.mjs" }).testSealed, /--bin "bin\/app\.mjs"$/);

  const out = tempDir(t);
  const r = cli("init-run.mjs", ["Echo", "--out", out, "--stack", "web", "--bin", "../escape.mjs"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--bin must be a path inside the app tree/);
  assert.equal(cli("init-run.mjs", ["Echo", "--out", out, "--stack", "rust-egui", "--bin", "x"]).code, 2);
  assert.ok(!existsSync(path.join(out, "Echo")) && !existsSync(path.join(out, "Echo.remake-room")), "a refused --bin makes nothing");
});
