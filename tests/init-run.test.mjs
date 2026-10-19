import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cli, tempDir, write, gitIn } from "./helpers.mjs";
import { validateManifest } from "../scripts/lib/run.mjs";
import { STACKS } from "../scripts/lib/stacks.mjs";

test("the web preset installs without running package scripts", () => {
  // A postinstall is builder-written code that would run after the sealed tests are copied in.
  assert.match(STACKS.web.commands.build, /^npm install --ignore-scripts\b/);
});

const read = (f) => readFileSync(f, "utf8");

test("init-run lays out the app tree and the room", (t) => {
  const out = tempDir(t);
  const r = cli("init-run.mjs", ["Brushling", "--out", out, "--stack", "rust-egui", "--builders", "4"]);
  assert.equal(r.code, 0, r.err);
  const root = path.join(out, "Brushling");
  const room = path.join(out, "Brushling.remake-room");

  const cfg = JSON.parse(read(path.join(root, "remake.json")));
  validateManifest(cfg);
  assert.equal(cfg.app, "Brushling");
  assert.equal(cfg.stack, "rust-egui");
  assert.equal(cfg.builders, 4);
  assert.equal(cfg.cheap, false);
  assert.deepEqual(cfg.models, { planner: "opus", builder: "sonnet", reviewer: "opus" });
  assert.deepEqual(cfg.blocked, []);
  for (const k of ["testVisible", "testSealed"]) assert.match(cfg.commands[k], /\{report\}/);

  for (const d of ["evidence", "original", "spec", "tests/visible", "sealed"]) assert.ok(existsSync(path.join(room, d)), `room/${d}`);
  assert.deepEqual(JSON.parse(read(path.join(root, ".remake", "local.json"))), { room: room.replace(/\\/g, "/") });
  assert.match(read(path.join(root, ".gitignore")), /^\.remake\/$/m);
  assert.match(read(path.join(root, ".gitignore")), /^target\/$/m);

  const checklist = read(path.join(root, ".remake", "progress", "checklist.md"));
  assert.equal(checklist.match(/^- \[ \] \*\*\d/gm).length, 9, "phases 0 to 8");

  assert.equal(gitIn(root, "branch", "--show-current"), "main");
  assert.match(gitIn(root, "log", "--format=%s"), /^chore: start remake run for Brushling$/);
  assert.equal(gitIn(root, "status", "--porcelain"), "", ".remake/ is ignored and everything else is committed");
});

test("init-run pre-approves only edits, the plugin's scripts, the original, git and the stack's tools", (t) => {
  const out = tempDir(t);
  const r = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web"]);
  assert.equal(r.code, 0, r.err);
  const root = path.join(out, "Pad");
  const room = path.join(out, "Pad.remake-room").replace(/\\/g, "/");
  const { permissions } = JSON.parse(read(path.join(root, ".claude", "settings.local.json")));
  assert.deepEqual(Object.keys(permissions).sort(), ["additionalDirectories", "allow", "defaultMode"]);
  assert.equal(permissions.defaultMode, "acceptEdits");
  assert.deepEqual(permissions.additionalDirectories, [room]);
  const scripts = permissions.allow.filter((rule) => /^Bash\(node "?[^"*]+\/scripts\/\*\)$/.test(rule));
  const original = permissions.allow.filter((rule) => rule.replace(/"/g, "").replace(/^Bash\((node )?/, "") === `${room}/original/*)`);
  assert.equal(scripts.length, 2, "node on the plugin's scripts, quoted and bare");
  assert.equal(original.length, 4, "the original as a black box, with and without node");
  const tools = permissions.allow.slice(6);
  for (const rule of ["Bash(git commit *)", "Bash(git merge *)", "Bash(npm test*)", "Bash(codex exec *)", "Bash(head *)", "Bash(cd *)"]) assert.ok(tools.includes(rule), rule);
  assert.ok(!tools.some((rule) => /git (push|reset|checkout|clean|-C)|cargo/.test(rule)), "no push, reset or other stacks' tools");
  assert.ok(tools.every((rule) => /^Bash\([^*]+\*\)$/.test(rule)), "every tool rule is one command prefix");
  assert.match(read(path.join(root, ".gitignore")), /^\.claude\/settings\.local\.json$/m);
  assert.equal(gitIn(root, "status", "--porcelain"), "", "the local settings stay untracked");
});

test("cheap mode runs one Sonnet builder", (t) => {
  const out = tempDir(t);
  const r = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web", "--cheap", "--builders", "5"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ignoring --builders 5/);
  const cfg = JSON.parse(read(path.join(out, "Pad", "remake.json")));
  assert.equal(cfg.builders, 1);
  assert.equal(cfg.cheap, true);
  assert.deepEqual(new Set(Object.values(cfg.models)), new Set(["sonnet"]));
  assert.ok(existsSync(path.join(out, "Pad", "package.json")), "web stack gets a package.json so npm install works");
});

test("a Node app's own npm test runs the visible suite on this Node version", (t) => {
  // Node 20 cannot expand a test glob and Node 22+ cannot take a test directory,
  // so the scaffold's test script goes through a committed copy of the parity shim.
  const out = tempDir(t);
  assert.equal(cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web"]).code, 0);
  const root = path.join(out, "Pad");
  assert.match(gitIn(root, "ls-files"), /^scripts\/run-suite\.mjs$/m);

  const testFile = (name, ok) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest(${JSON.stringify(name)}, () => { assert.ok(${ok}); });\n`;
  write(path.join(root, "tests", "visible", "top.test.mjs"), testFile("top level runs", true));
  write(path.join(root, "tests", "visible", "deep", "nested.test.mjs"), testFile("nested runs", true));
  write(path.join(root, "tests", "visible", "helper.mjs"), "throw new Error('helpers are not test files');\n");
  // A child node --test would report to this runner instead of printing its own results.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT"));
  const { scripts } = JSON.parse(read(path.join(root, "package.json")));
  const run = () => spawnSync(scripts.test, { cwd: root, env, shell: true, encoding: "utf8", windowsHide: true });

  const pass = run();
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /top level runs/);
  assert.match(pass.stdout, /nested runs/);

  write(path.join(root, "tests", "visible", "deep", "fails.test.mjs"), testFile("a failure", false));
  assert.notEqual(run().status, 0, "a failing visible test fails npm test");
});

test("init-run tells a session started outside the app tree to restart there", (t) => {
  // Claude Code only makes worktrees for a session started inside a git repo.
  const out = tempDir(t);
  const outside = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web"], out);
  assert.equal(outside.code, 0, outside.err);
  assert.match(outside.out, /Restart Claude in .*\/Pad and run \/remakecraft:remake Pad/);
  assert.match(read(path.join(out, "Pad", ".gitignore")), /^\.claude\/worktrees\/$/m);

  const root = path.join(out, "Inside");
  mkdirSync(root);
  const inside = cli("init-run.mjs", ["Inside", "--out", out, "--stack", "web"], root);
  assert.equal(inside.code, 0, inside.err);
  assert.doesNotMatch(inside.out, /Restart/);
  assert.match(inside.out, /then phase 1/);
});

test("init-run refuses to overwrite a run", (t) => {
  const out = tempDir(t);
  assert.equal(cli("init-run.mjs", ["Brushling", "--out", out, "--stack", "tauri"]).code, 0);
  const again = cli("init-run.mjs", ["Brushling", "--out", out, "--stack", "tauri"]);
  assert.equal(again.code, 1);
  assert.match(again.err, /already exists/);
});

test("init-run refuses a non-empty folder", (t) => {
  const out = tempDir(t);
  write(path.join(out, "Brushling", "notes.txt"), "mine");
  assert.match(cli("init-run.mjs", ["Brushling", "--out", out, "--stack", "web"]).err, /not empty/);
});

test("init-run builds around a room the user already filled with evidence", (t) => {
  // Users drop screenshots into <app>.remake-room/evidence/ before or during setup.
  const out = tempDir(t);
  const room = path.join(out, "Pad.remake-room");
  write(path.join(room, "evidence", "menu.png"), "png");
  write(path.join(room, "original", "launch.cmd"), "start pad.exe");
  write(path.join(room, "Thumbs.db"), "junk");
  const r = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Reusing the room .*Pad\.remake-room; kept evidence\/ and original\//);
  for (const d of ["evidence", "original", "spec", "tests/visible", "sealed"]) assert.ok(existsSync(path.join(room, d)), `room/${d}`);
  assert.equal(read(path.join(room, "evidence", "menu.png")), "png");
  assert.equal(read(path.join(room, "original", "launch.cmd")), "start pad.exe");
  assert.ok(existsSync(path.join(out, "Pad", "remake.json")));

  // An empty room, or one with only evidence/, works too.
  mkdirSync(path.join(out, "Empty.remake-room"));
  assert.equal(cli("init-run.mjs", ["Empty", "--out", out, "--stack", "web"]).code, 0);
  write(path.join(out, "Ev.remake-room", "evidence", "a.md"), "notes");
  const ev = cli("init-run.mjs", ["Ev", "--out", out, "--stack", "web"]);
  assert.equal(ev.code, 0, ev.err);
  assert.match(ev.out, /kept evidence\/\./);
});

test("init-run refuses a room that already holds run state", (t) => {
  const out = tempDir(t);
  const cases = [
    ["inventory.json", "{}", /already holds inventory\.json/],
    ["spec/spec.json", "{}", /already holds spec/],
    ["sealed/t1.rs", "#[test]", /already holds sealed/],
    ["hashes.json", "{}", /already holds hashes\.json/],
    ["notes.txt", "mine", /already holds notes\.txt/],
  ];
  for (const [i, [file, content, re]] of cases.entries()) {
    const app = `Pad${i}`;
    const room = path.join(out, `${app}.remake-room`);
    write(path.join(room, "evidence", "a.png"), "x");
    write(path.join(room, file), content);
    const r = cli("init-run.mjs", [app, "--out", out, "--stack", "web"]);
    assert.equal(r.code, 1, `${file}: ${r.err}`);
    assert.match(r.err, re);
    assert.match(r.err, /resume that run/);
    assert.ok(!existsSync(path.join(out, app, "remake.json")), `${file}: no app tree`);
    assert.equal(read(path.join(room, file)), content, `${file}: left untouched`);
    assert.ok(!existsSync(path.join(room, "tests")), `${file}: nothing added to the room`);
  }

  write(path.join(out, "File.remake-room", "evidence"), "not a folder");
  assert.match(cli("init-run.mjs", ["File", "--out", out, "--stack", "web"]).err, /evidence must be a folder/);
  write(path.join(out, "Flat.remake-room"), "not a folder");
  assert.match(cli("init-run.mjs", ["Flat", "--out", out, "--stack", "web"]).err, /is not a folder/);
});

test("a failed setup removes only what it added to a reused room", (t) => {
  const out = tempDir(t);
  const room = path.join(out, "Pad.remake-room");
  write(path.join(room, "evidence", "menu.png"), "png");
  // A file where the app tree goes makes setup fail after the room is laid out.
  write(path.join(out, "Pad"), "in the way");
  const r = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web"]);
  assert.notEqual(r.code, 0);
  assert.equal(read(path.join(room, "evidence", "menu.png")), "png");
  for (const d of ["original", "spec", "tests", "sealed"]) assert.ok(!existsSync(path.join(room, d)), `room/${d} removed`);
});

test("init-run rejects bad arguments with usage errors", (t) => {
  const out = tempDir(t);
  const cases = [
    [["Brushling", "--out", out], /--stack is required/],
    [["Brushling", "--out", out, "--stack", "cobol"], /Unknown stack "cobol"/],
    [["Brushling", "--stack", "web"], /--out is required/],
    [["Brushling", "--out", out, "--stack", "web", "--builders", "9"], /1 to 5/],
    [["../evil", "--out", out, "--stack", "web"], /must be letters/],
    [["Brushling", "--out", out, "--stack", "web", "--color"], /Unknown option --color/],
    [[], /Usage/],
  ];
  for (const [args, re] of cases) {
    const r = cli("init-run.mjs", args);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.err}`);
    assert.match(r.err, re);
  }
});

test("validateManifest names every problem", () => {
  assert.throws(
    () => validateManifest({ app: "", stack: "web", builders: 7, cheap: "no", models: {}, blocked: "x", commands: { build: "", testVisible: "run", testSealed: "" } }),
    (err) => ["app", "builders", "cheap", "models", "blocked", "testVisible", "testSealed"].every((k) => err.message.includes(k)),
  );
});

test("a clean run records its mode and an empty MCP allowlist", (t) => {
  const out = tempDir(t);
  const r = cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /mode {6}clean-room\n/);
  assert.doesNotMatch(r.out, /EULA/);
  const cfg = JSON.parse(read(path.join(out, "Calc", "remake.json")));
  assert.equal(cfg.mode, "clean");
  assert.equal(cfg.rea, false);
  assert.deepEqual(cfg.mcpAllow, []);
  assert.equal("basis" in cfg, false);
});

for (const [flag, mode, rea, label] of [
  ["--with-rea", "clean", true, /clean-room, observer uses REA \(basis: license\)/],
  ["--open", "open", false, /open mode: not clean-room \(basis: license\)/],
]) {
  test(`${flag} with a basis records it and says the EULA is the user's call`, (t) => {
    const out = tempDir(t);
    const r = cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web", flag, "--basis", "license"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, label);
    assert.match(r.out, /may breach its EULA[^\n]*your call/);
    const cfg = JSON.parse(read(path.join(out, "Calc", "remake.json")));
    assert.deepEqual([cfg.mode, cfg.rea, cfg.basis, cfg.mcpAllow], [mode, rea, "license", []]);
    validateManifest(cfg);
  });

  test(`${flag} without a valid basis exits 2 and makes nothing`, (t) => {
    const out = tempDir(t);
    for (const extra of [[], ["--basis", "trust-me"]]) {
      const r = cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web", flag, ...extra]);
      assert.equal(r.code, 2, extra.join(" "));
      assert.match(r.err, /needs --basis own\|license\|authorized/);
      assert.match(r.err, /EULA[^\n]*your call/);
      assert.equal(existsSync(path.join(out, "Calc")), false);
      assert.equal(existsSync(path.join(out, "Calc.remake-room")), false);
    }
  });
}

test("--with-rea and --open together, or --basis alone, are refused", (t) => {
  const out = tempDir(t);
  const both = cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web", "--with-rea", "--open", "--basis", "own"]);
  assert.equal(both.code, 2);
  assert.match(both.err, /Pick one/);
  const alone = cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web", "--basis", "own"]);
  assert.equal(alone.code, 2);
  assert.match(alone.err, /--basis only applies/);
});

test("validateManifest applies the wall's own mode rules", (t) => {
  const out = tempDir(t);
  assert.equal(cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web"]).code, 0);
  const cfg = JSON.parse(read(path.join(out, "Calc", "remake.json")));
  validateManifest({ ...cfg, rea: true, basis: "own", mcpAllow: ["mcp__docs__*"] });
  assert.throws(() => validateManifest({ ...cfg, rea: true }), /invalid:\n {2}- "rea" and open mode need "basis"/);
  assert.throws(() => validateManifest({ ...cfg, mode: "open", basis: "maybe" }), /basis/);
  assert.throws(() => validateManifest({ ...cfg, mode: "dirty" }), /"mode" must be/);
  assert.throws(() => validateManifest({ ...cfg, mcpAllow: ["Read"] }), /mcpAllow/);
});
