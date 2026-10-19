// End to end through the real hook process: hooks/guard.mjs is spawned with
// the JSON Claude Code sends on stdin, against a run laid out like init-run
// makes it (<out>/x/remake.json beside <out>/x.remake-room/). wall.test.mjs
// covers decide() rule by rule; this proves the wiring around it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "guard.mjs");

function makeRun(t, manifest = '{"app":"x","blocked":[]}') {
  const out = mkdtempSync(path.join(os.tmpdir(), "remake-guard-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const app = path.join(out, "x");
  const room = path.join(out, "x.remake-room");
  mkdirSync(path.join(app, "src"), { recursive: true });
  mkdirSync(path.join(room, "evidence"), { recursive: true });
  writeFileSync(path.join(app, "remake.json"), manifest);
  writeFileSync(path.join(room, "evidence", "a.md"), "observer notes\n");
  return { app, room };
}

function guard(cwd, tool_name, tool_input, agent_type = "remakecraft:builder") {
  const hook = { session_id: "t", hook_event_name: "PreToolUse", cwd, tool_name, tool_input, agent_type };
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(hook), encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

const wallLog = (app) => {
  const file = path.join(app, ".remake", "wall.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

function assertDenied(r, app) {
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "deny");
  assert.match(out.permissionDecisionReason, /^Clean-room wall:/);
  const log = wallLog(app);
  assert.equal(log.length, 1, "one wall.log line per deny");
  assert.equal(log[0].role, "builder");
  assert.equal(log[0].agent, "remakecraft:builder");
  assert.equal(log[0].reason, out.permissionDecisionReason);
}

test("builder reading the room is denied and logged", (t) => {
  const { app, room } = makeRun(t);
  const r = guard(app, "Read", { file_path: path.join(room, "evidence", "a.md") });
  assertDenied(r, app);
  assert.equal(wallLog(app)[0].tool, "Read");
});

test("builder calling an MCP tool is denied and logged", (t) => {
  const { app } = makeRun(t);
  const r = guard(app, "mcp__webpool__web_scrape", { url: "https://example.com/manual" });
  assertDenied(r, app);
  assert.match(wallLog(app)[0].reason, /mcpAllow/);
  assert.equal(wallLog(app)[0].tool, "mcp__webpool__web_scrape");
});

test("an MCP tool named in mcpAllow reaches the builder; REA in a --with-rea run reaches only the observer", (t) => {
  const { app, room } = makeRun(t, '{"app":"x","blocked":[],"rea":true,"basis":"own","mcpAllow":["mcp__docs__*"]}');
  const ok = guard(app, "mcp__docs__search", { q: "egui button" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "");
  const rea = ["mcp__rea__analyze_function", { path: path.join(room, "original", "x.exe"), address: "0x1400" }];
  const ob = guard(path.dirname(app), ...rea, "remakecraft:observer");
  assert.equal(ob.stdout, "", ob.stderr);
  assertDenied(guard(app, ...rea), app);
  assert.match(wallLog(app)[0].reason, /Only the observer/);
});

test("a --with-rea manifest without a basis blocks every call", (t) => {
  const { app } = makeRun(t, '{"app":"x","blocked":[],"rea":true}');
  const r = guard(app, "Write", { file_path: path.join(app, "src", "main.mjs"), content: "" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /basis/);
});

test("builder writing src is allowed and leaves no log", (t) => {
  const { app } = makeRun(t);
  const r = guard(app, "Write", { file_path: path.join(app, "src", "main.mjs"), content: "export {};\n" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.deepEqual(wallLog(app), []);
});

test("the observer may write its session scratchpad; a builder may not read it", (t) => {
  const { app } = makeRun(t);
  const pad = path.join(os.tmpdir(), "claude", "C--runs-x", "t", "scratchpad", "gen_inventory.py");
  const w = guard(app, "Write", { file_path: pad, content: "print(1)\n" }, "remakecraft:observer");
  assert.equal(w.status, 0, w.stderr);
  assert.equal(w.stdout, "");
  assert.deepEqual(wallLog(app), []);
  assertDenied(guard(app, "Read", { file_path: pad }), app);
});

for (const [name, manifest] of [
  ["invalid JSON", "{ not json"],
  ["blocked is not an array", '{"app":"x","blocked":"x-clone"}'],
]) {
  test(`malformed remake.json (${name}) exits 2 and blocks the call`, (t) => {
    const { app } = makeRun(t, manifest);
    const r = guard(app, "Write", { file_path: path.join(app, "src", "main.mjs"), content: "" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /remake\.json is unreadable/);
    assert.equal(r.stdout, "");
  });
}

test("builder reading the room through a real symlink is denied", (t) => {
  const { app, room } = makeRun(t);
  const link = path.join(app, "src", "link");
  try {
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(path.join(room, "evidence"), link, "junction");
  } catch (err) {
    t.skip(`this OS would not create a directory link (${err.code})`);
    return;
  }
  const r = guard(app, "Read", { file_path: path.join(link, "a.md") });
  assertDenied(r, app);
});

// Subagents run with the session's cwd, which is usually the --out folder that
// holds both trees, not the app tree. The wall must find the run from there.
test("from the folder holding both trees, the wall still finds the run", (t) => {
  const { app, room } = makeRun(t);
  const out = path.dirname(app);
  mkdirSync(path.join(room, "original"), { recursive: true });
  writeFileSync(path.join(room, "original", "x.mjs"), "console.log(1)\n");

  const tw = guard(out, "Read", { file_path: path.join(room, "evidence", "a.md") }, "remakecraft:test-writer");
  assert.equal(JSON.parse(tw.stdout).hookSpecificOutput.permissionDecision, "deny");
  const ob = guard(out, "Bash", { command: "cat x.remake-room/original/x.mjs" }, "remakecraft:observer");
  assert.equal(JSON.parse(ob.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(wallLog(app).map((l) => [l.role, l.tool]), [["test-writer", "Read"], ["observer", "Bash"]]);

  const run = guard(out, "Bash", { command: "node x.remake-room/original/x.mjs" }, "remakecraft:observer");
  assert.equal(run.stdout, "");
});

test("a run elsewhere is found from the paths the call names", (t) => {
  const { app, room } = makeRun(t);
  const r = guard(os.tmpdir(), "Read", { file_path: path.join(room, "evidence", "a.md") }, "remakecraft:test-writer");
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(wallLog(app).length, 1);
});

test("a builder in a worktree of the app tree logs to the main tree", (t) => {
  // Worktrees are deleted after the merge; their gitignored .remake/ goes with them.
  const { app, room } = makeRun(t);
  const git = (...a) => spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@localhost", ...a], { cwd: app, encoding: "utf8" });
  git("init", "-q");
  git("add", "remake.json");
  git("commit", "-q", "-m", "init");
  const wt = path.join(app, ".claude", "worktrees", "b1");
  assert.equal(git("worktree", "add", "-q", "-b", "b1", wt).status, 0);

  const r = guard(wt, "Read", { file_path: path.join(room, "evidence", "a.md") });
  assertDenied(r, app);
  assert.equal(existsSync(path.join(wt, ".remake", "wall.log")), false);
  const locked = guard(wt, "Write", { file_path: path.join(wt, "tests", "visible", "a.test.mjs"), content: "" });
  assert.equal(JSON.parse(locked.stdout).hookSpecificOutput.permissionDecision, "deny", "the worktree's own tests/ is read-only");

  const AUDIT = path.join(path.dirname(GUARD), "audit.mjs");
  const hook = { session_id: "t", hook_event_name: "SubagentStart", cwd: wt, agent_type: "remakecraft:builder", agent_id: "b1" };
  assert.equal(spawnSync(process.execPath, [AUDIT], { input: JSON.stringify(hook), encoding: "utf8" }).status, 0);
  assert.match(readFileSync(path.join(app, ".remake", "audit.log"), "utf8"), /remakecraft:builder/);
});

test("wall.log keeps targets and a hash, never the content", (t) => {
  const { app, room } = makeRun(t);
  const secret = "assert.equal(fill(3), 'sealed-answer-42');\n";
  const target = path.join(room, "sealed", "fill.test.mjs");
  const r = guard(app, "Write", { file_path: target, content: secret }, "remakecraft:builder");
  assertDenied(r, app);
  const [line] = wallLog(app);
  assert.deepEqual(line.targets, [target]);
  assert.match(line.sha256, /^[0-9a-f]{64}$/);
  assert.equal("input" in line || "content" in line, false);
  assert.doesNotMatch(readFileSync(path.join(app, ".remake", "wall.log"), "utf8"), /sealed-answer-42/);

  const b = guard(app, "Bash", { command: `cat ${path.join(room, "evidence", "a.md")} # sealed-answer-43` });
  assert.equal(JSON.parse(b.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(wallLog(app)[1].targets, [path.join(room, "evidence", "a.md")]);
  assert.doesNotMatch(readFileSync(path.join(app, ".remake", "wall.log"), "utf8"), /sealed-answer-43/);
});

test("a prompt for one of the plugin's agents is kept in audit.log", (t) => {
  const { app } = makeRun(t);
  const prompt = "Build feature calc.add. Branch name: remake/calc.add.";
  const r = guard(app, "Agent", { subagent_type: "remakecraft:builder", description: "build", prompt }, null);
  assert.equal(r.stdout, "", r.stderr);
  const log = readFileSync(path.join(app, ".remake", "audit.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].event, "prompt");
  assert.equal(log[0].agent, "remakecraft:builder");
  assert.equal(log[0].by, "main");
  assert.equal(log[0].prompt, prompt);
  guard(app, "Agent", { subagent_type: "Explore", prompt: "look around" }, null);
  assert.equal(readFileSync(path.join(app, ".remake", "audit.log"), "utf8").trim().split("\n").length, 1, "other agents' prompts are not kept");
});

test("an internal error denies inside a run and allows outside one", async (t) => {
  const { handle } = await import("../hooks/guard.mjs");
  const { app, room } = makeRun(t);
  const empty = mkdtempSync(path.join(os.tmpdir(), "remake-none-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const boom = () => { throw new Error("boom"); };
  const payload = (cwd) => JSON.stringify({ cwd, tool_name: "Read", tool_input: { file_path: path.join(room, "evidence", "a.md") }, agent_type: "remakecraft:builder" });
  const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : "allow");

  const inside = handle(payload(app), { decideFn: boom });
  assert.equal(decision(inside), "deny");
  assert.match(JSON.parse(inside.stdout).hookSpecificOutput.permissionDecisionReason, /guard failed \(boom\)/);
  assert.equal(decision(handle(JSON.stringify({ cwd: empty, tool_name: "Read", tool_input: { file_path: "a.md" } }), { decideFn: boom })), "allow");

  assert.equal(decision(handle("{ not json", { fallbackCwd: app })), "deny");
  assert.equal(decision(handle("", { fallbackCwd: app })), "deny");
  assert.equal(decision(handle("{ not json", { fallbackCwd: empty })), "allow");
});

// The exact command Claude Code runs, read from hooks/hooks.json, so a broken
// matcher, path or failure mode fails here rather than in a live run.
test("the hooks.json PreToolUse command enforces the wall", (t) => {
  const pluginRoot = path.join(path.dirname(GUARD), "..");
  const config = JSON.parse(readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  const [entry] = config.hooks.PreToolUse;
  const tools = entry.matcher.split("|");
  for (const tool of ["Read", "Grep", "Glob", "Bash", "PowerShell", "Edit", "Write", "WebFetch", "Agent", "Task"]) assert.ok(tools.includes(tool), `matcher covers ${tool}`);
  const matcher = new RegExp(`^(${entry.matcher})$`);
  for (const tool of ["mcp__rea__open_binary", "mcp__webpool__web_scrape", "ListMcpResourcesTool", "ReadMcpResourceTool"]) assert.match(tool, matcher, `matcher covers ${tool}`);
  const [hook] = entry.hooks;
  assert.equal(hook.onFailure, "block");
  const args = hook.args.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot));
  const run = (cwd, input) => {
    const r = spawnSync(hook.command, args, { cwd, input, encoding: "utf8", timeout: hook.timeout * 1000 });
    if (r.error) throw r.error;
    return r;
  };

  const { app, room } = makeRun(t);
  const empty = mkdtempSync(path.join(os.tmpdir(), "remake-none-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const read = { session_id: "t", hook_event_name: "PreToolUse", cwd: app, tool_name: "Read", tool_input: { file_path: path.join(room, "evidence", "a.md") }, agent_type: "remakecraft:builder" };
  assertDenied(run(app, JSON.stringify(read)), app);
  const ok = run(app, JSON.stringify({ ...read, tool_input: { file_path: path.join(app, "src", "main.mjs") } }));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "");

  const bad = run(app, "{ not json");
  assert.equal(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision, "deny", "a payload the guard cannot read is blocked inside a run");
  const outside = run(empty, "{ not json");
  assert.equal(outside.status, 0, outside.stderr);
  assert.equal(outside.stdout, "", "outside a run the guard never blocks");
});

test("SubagentStart from the folder holding both trees is audited", (t) => {
  const { app } = makeRun(t);
  const AUDIT = path.join(path.dirname(GUARD), "audit.mjs");
  const hook = { session_id: "t", hook_event_name: "SubagentStart", cwd: path.dirname(app), agent_type: "remakecraft:observer", agent_id: "a1" };
  const r = spawnSync(process.execPath, [AUDIT], { input: JSON.stringify(hook), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const log = readFileSync(path.join(app, ".remake", "audit.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => l.agent), ["remakecraft:observer"]);
});

test("open mode: a link planted in original/ does not lead a shell word out of it", (t) => {
  const { app, room } = makeRun(t, '{"app":"x","blocked":[],"mode":"open","basis":"own"}');
  mkdirSync(path.join(room, "original"), { recursive: true });
  mkdirSync(path.join(room, "sealed"), { recursive: true });
  writeFileSync(path.join(room, "sealed", "t.js"), "secret\n");
  writeFileSync(path.join(room, "original", "app.js"), "x\n");
  try {
    symlinkSync("..", path.join(room, "original", "up"), "junction");
  } catch (err) {
    t.skip(`this OS would not create a directory link (${err.code})`);
    return;
  }
  const orig = path.join(room, "original");
  assert.equal(guard(app, "Bash", { command: `cat ${orig}/app.js` }).stdout, "", "plain original/ read stays open");
  assertDenied(guard(app, "Bash", { command: `cat ${orig}/up/sea"l"ed/t.js` }), app);
  const r = guard(app, "Bash", { command: `cd ${orig} && cat up/sealed/t.js` });
  assert.match(r.stdout, /deny/, "cd into original, then through the link");
});
