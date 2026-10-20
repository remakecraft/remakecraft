// Regression tests for v0.1.2 and v0.1.3, built from the chardet run's wall.log
// (v0.1.0, 2026-10-19). fixtures/chardet-run.json holds the real commands with
// the run's paths swapped for {app} and {projects}; each test names the bug it
// covers. The wall's guarantees are checked next to every loosening: the room,
// the evidence, the sealed tests and the blocklist stay out of reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide } from "../hooks/wall.mjs";
import { handle, ownOutputs } from "../hooks/guard.mjs";
import { PLUGIN, cli, tempDir } from "./helpers.mjs";

const SESSION = "e90f6cf1-3178-4e07-9b79-aaabb04be918";
const base = path.join(os.tmpdir(), "rc-v012").replace(/\\/g, "/");
const app = `${base}/guessling`;
const room = `${app}.remake-room`;
const home = `${base}/home`;
const projects = `${home}/.claude/projects/C--runs-guessling`;
const BLOCKED = ["chardet"];

const fixture = JSON.parse(readFileSync(path.join(PLUGIN, "tests", "fixtures", "chardet-run.json"), "utf8"));
const fill = (s) => s.replaceAll("{app}", app).replaceAll("{projects}", projects);

/** A fixture entry as the hook saw it: builders in their worktree, everyone else in the app tree. */
function replay(id, extra = {}) {
  const e = fixture.find((x) => x.id === id);
  assert.ok(e, `fixture ${id}`);
  const wt = /\{app\}\/\.claude\/worktrees\/(agent-\w+)/.exec(JSON.stringify(e.input));
  const cwd = wt ? `${app}/.claude/worktrees/${wt[1]}` : app;
  const hook = { agent_type: e.role === "main" ? undefined : `remakecraft:${e.role}`, tool_name: e.tool, tool_input: JSON.parse(fill(JSON.stringify(e.input))), cwd, session_id: SESSION, ...extra };
  return decide(hook, { root: cwd, logRoot: app, blocked: BLOCKED }, home, os.tmpdir());
}

const at = (agent, tool, input, cwd = app) =>
  decide({ agent_type: `remakecraft:${agent}`, tool_name: tool, tool_input: input, cwd, session_id: SESSION }, { root: cwd, logRoot: app, blocked: BLOCKED }, home, os.tmpdir());
const denied = (v, what = "") => assert.equal(v?.decision, "deny", `expected deny${what ? `: ${what}` : ""}`);
const allowed = (v, what = "") => assert.equal(v, null, `expected allow${what ? ` (${what})` : ""}, got: ${v?.reason}`);
const CLEAN = ["builder", "merger", "verifier", "reviewer"];
const wt = `${app}/.claude/worktrees/agent-x`;

// --- Bug 1: a glob bracket crashed the guard ("Range out of order") ----------

test("bug 1: the commands that crashed the guard are decided, not thrown", () => {
  for (const id of ["guard-1", "guard-2", "guard-3", "guard-4", "guard-5"]) {
    let v;
    assert.doesNotThrow(() => { v = replay(id); }, id);
    if (id === "guard-1") denied(v, "guard-1 climbs out with '../' in an inline script"); // a real reach, now logged as one
    else allowed(v, id);
  }
});

test("bug 1: bracket globs still find the room, reversed ranges included", () => {
  for (const word of [
    `${base}/guessling.rem[a-c]ke-r[n-p]om`,
    `${base}/guessling.rem[!x]ke-r?om`,
    `${base}/guessling.rem[^x]ke-r?om`,
    `${base}/guessling.rem[c-a]ke-r?om`, // reversed: read as its letters, which keeps 'a'
    `${base}/gu[e-e]ssling.rem*`,
  ]) {
    for (const agent of CLEAN) {
      let v;
      assert.doesNotThrow(() => { v = at(agent, "Bash", { command: `ls ${word}` }); }, word);
      denied(v, `${agent}: ${word}`);
    }
  }
});

// --- Bug 2: clean roles could not read their own spill files -----------------

test("bug 2: a spill file the guard confirmed as the agent's own is readable", () => {
  for (const id of ["17", "26"]) {
    const v = replay(id);
    denied(v, `${id} unconfirmed`);
    assert.match(v.reason, /spill file is readable only by the agent whose result announced it/);
    const file = fill(fixture.find((x) => x.id === id).input.file_path);
    allowed(replay(id, { own_outputs: [file] }), `${id} confirmed`);
    denied(replay(id, { own_outputs: [`${projects}/${SESSION}/tool-results/other.txt`] }), `${id} with another file confirmed`);
  }
  // own_outputs opens only the named files: the room stays shut.
  denied(decide({ agent_type: "remakecraft:builder", tool_name: "Read", tool_input: { file_path: `${room}/evidence/a.md` }, cwd: app, own_outputs: [`${room}/evidence/a.md`] }, { root: app, blocked: [] }, home, os.tmpdir()));
});

test("bug 2: the shell may not open session data, the agent's own spill included", () => {
  for (const agent of CLEAN)
    for (const command of [
      `cat ${projects}/${SESSION}/tool-results/b3isvu6ty.txt`,
      `ls ~/.claude/projects`,
      `grep -r evidence ${home}/.claude/projects/`,
      `cat ${projects}/${SESSION}/subagents/agent-a1.jsonl`,
    ])
      denied(at(agent, "Bash", { command }), `${agent}: ${command}`);
});

/** A session laid out the way Claude Code writes one, with a spill for agent A. */
function session(t) {
  const out = mkdtempSync(path.join(os.tmpdir(), "rc-spill-"));
  t.after(() => rmSync(out, { recursive: true, force: true, maxRetries: 3 }));
  const tree = path.join(out, "pad");
  mkdirSync(path.join(tree, "src"), { recursive: true });
  mkdirSync(path.join(out, "pad.remake-room", "evidence"), { recursive: true });
  writeFileSync(path.join(tree, "remake.json"), '{"app":"pad","blocked":[]}');
  const userHome = path.join(out, "home");
  const dir = path.join(userHome, ".claude", "projects", "C--pad", SESSION);
  mkdirSync(path.join(dir, "tool-results"), { recursive: true });
  mkdirSync(path.join(dir, "subagents"), { recursive: true });
  const body = Array.from({ length: 400 }, (_, i) => `line ${i}: ${"x".repeat(40)}`).join("\n") + "\n";
  const spill = path.join(dir, "tool-results", "b3isvu6ty.txt");
  writeFileSync(spill, body);
  const lines = body.split("\n");
  let preview = "";
  for (const l of lines) { if (preview.length + l.length + 1 > 2048) break; preview += `${l}\n`; }
  const announce = (file, text = preview) => `<persisted-output>\nOutput too large (${(body.length / 1024).toFixed(1)}KB). Full output saved to: ${file}\n\nPreview (first 2KB):\n${text.replace(/\n$/, "")}\n...\n</persisted-output>`;
  const result = (content, extra = {}) => JSON.stringify({ type: "user", agentId: "aa1", message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content, ...extra }] } });
  const transcript = (agent, ...entries) => writeFileSync(path.join(dir, "subagents", `agent-${agent}.jsonl`), entries.join("\n") + "\n");
  const hook = (agent, file = spill, tool = "Read") => ({ session_id: SESSION, agent_id: agent, cwd: tree, tool_name: tool, agent_type: "remakecraft:builder", tool_input: tool === "Read" ? { file_path: file } : { pattern: "line", path: file } });
  return { tree, userHome, dir, spill, body, announce, result, transcript, hook };
}

test("bug 2: the guard confirms a spill from the agent's own transcript", (t) => {
  const s = session(t);
  const norm = (p) => p.replace(/\\/g, "/");
  s.transcript("aa1", s.result("short result"), s.result(s.announce(s.spill)));
  assert.ok(ownOutputs(s.hook("aa1"), s.tree, s.userHome, {}).map(norm).includes(norm(s.spill)), "its own spill");
  assert.ok(ownOutputs(s.hook("aa1", s.spill, "Grep"), s.tree, s.userHome, {}).length > 0, "Grep on it too");

  const decision = (hook) => {
    const r = handle(JSON.stringify(hook), { home: s.userHome });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : "allow";
  };
  assert.equal(decision(s.hook("aa1")), "allow", "through the hook, end to end");
  assert.equal(decision(s.hook("bb2")), "deny", "another agent, no transcript");
  assert.equal(decision({ ...s.hook("aa1"), session_id: "f00" }), "deny", "another session");
  assert.equal(decision({ ...s.hook("aa1"), agent_id: undefined }), "deny", "no agent id");

  // Another agent's transcript names the file, not this one's.
  s.transcript("bb2", s.result(s.announce(s.spill)));
  s.transcript("aa1", s.result("short result"));
  assert.equal(decision(s.hook("aa1")), "deny", "the announcement must be in this agent's transcript");

  // The wall's own denial names the path too, as an error.
  s.transcript("aa1", s.result(`PreToolUse:Read hook error: Clean-room wall: builder may read only its own tree and toolchains, not ${s.spill}.`, { is_error: true }));
  assert.equal(decision(s.hook("aa1")), "deny", "an error result is not an announcement");
  s.transcript("aa1", s.result(s.announce(s.spill), { is_error: true }));
  assert.equal(decision(s.hook("aa1")), "deny", "an announcement flagged as an error does not count");

  // An agent echoing the announcement for a spill it never saw gets nothing:
  // the file must start with the preview its own result carried.
  s.transcript("aa1", s.result(s.announce(s.spill, "")));
  assert.equal(decision(s.hook("aa1")), "deny", "empty preview");
  s.transcript("aa1", s.result(s.announce(s.spill, "guessed first line\n".repeat(60))));
  assert.equal(decision(s.hook("aa1")), "deny", "a preview the file does not start with");

  // Only files in tool-results/ of this session qualify.
  const other = path.join(s.dir, "subagents", "agent-bb2.jsonl");
  s.transcript("aa1", s.result(s.announce(other)));
  assert.equal(decision(s.hook("aa1", other)), "deny", "a transcript is never a spill");
});

test("bug 2: a denied spill read is logged like any other denial", (t) => {
  const s = session(t);
  const r = handle(JSON.stringify(s.hook("bb2")), { home: s.userHome });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  const log = readFileSync(path.join(s.tree, ".remake", "wall.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].tool, "Read");
  assert.doesNotMatch(readFileSync(path.join(s.tree, ".remake", "wall.log"), "utf8"), /line 0: x/, "never the content");
});

// --- Bug 3: no scratch dir every role could use ------------------------------

test("bug 3: init-run makes .remake/tmp/, and every clean role may use it from the main tree and a worktree", (t) => {
  const out = tempDir(t, "rc-init");
  const r = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(path.join(out, "Pad", ".remake", "tmp")), ".remake/tmp/ exists from the start");

  for (const agent of CLEAN)
    for (const cwd of [app, wt]) {
      allowed(at(agent, "Write", { file_path: `${cwd}/.remake/tmp/notes.md`, content: "x" }, cwd), `${agent} Write in ${cwd}`);
      allowed(at(agent, "Read", { file_path: `${cwd}/.remake/tmp/notes.md` }, cwd), `${agent} Read in ${cwd}`);
      for (const command of ["mkdir -p .remake/tmp && node scripts/run-suite.mjs tests/visible > .remake/tmp/before.txt 2>&1; tail -5 .remake/tmp/before.txt", "ls .remake", "ls -a . .remake"])
        allowed(at(agent, "Bash", { command }, cwd), `${agent}: ${command}`);
      for (const command of ["cat .remake/wall.log", "grep -r room .remake", "ls .remake/wall.log", `cat ${room}/sealed/a.test.mjs`])
        denied(at(agent, "Bash", { command }, cwd), `${agent}: ${command}`);
    }
  // Room roles keep to the room and the scratchpad; the app tree's tmp/ is not theirs.
  for (const agent of ["observer", "spec-writer", "test-writer"])
    denied(at(agent, "Write", { file_path: `${app}/.remake/tmp/notes.md`, content: "x" }), agent);
});

test("bug 3: the chardet commands that needed a scratch dir", () => {
  for (const id of ["9", "18", "19", "21"]) allowed(replay(id), id);
  for (const id of ["5", "6"]) {
    const v = replay(id);
    denied(v, `${id}: .remake/tmp-before.txt is beside the logs, not in tmp/`);
    assert.match(v.reason, /temp files go in \.remake\/tmp\//);
  }
});

// --- Bug 4: builders were told to read the main tree's review.md -------------

test("bug 4: a worktree builder may not reach the main tree's .remake/, and is told why", () => {
  const v = replay("20");
  denied(v);
  assert.match(v.reason, /main tree's \.remake\//);
  for (const command of ["cat ../../../.remake/reports/review.md", `cat ${app}/.remake/reports/review.md`, "ls ../../../.remake"])
    denied(at("builder", "Bash", { command }, wt), command);
  denied(at("builder", "Read", { file_path: `${app}/.remake/reports/review.md` }, wt));
  // The skill and the headless loop carry findings in the prompt instead (build-steps.test.mjs).
  const skill = readFileSync(path.join(PLUGIN, "skills", "remake", "SKILL.md"), "utf8");
  assert.match(skill, /Never tell a builder to read `review\.md`/);
});

// --- Bug 5: the reviewer probed `codex --version` -----------------------------

test("bug 5: the reviewer checks for Codex in a way the wall allows", () => {
  for (const id of ["22", "27"]) denied(replay(id), `${id} still starts an agent CLI`);
  const reviewer = readFileSync(path.join(PLUGIN, "agents", "reviewer.md"), "utf8");
  assert.match(reviewer, /`which codex`/);
  allowed(at("reviewer", "Bash", { command: "which codex" }));
  for (const agent of CLEAN) {
    const md = readFileSync(path.join(PLUGIN, "agents", `${agent}.md`), "utf8");
    assert.match(md, /from outside Remakecraft/, `${agent} is told to leave other plugins alone`);
    assert.match(md, /never invent another folder/, `${agent} keeps to .remake/tmp/`);
  }
  const readme = readFileSync(path.join(PLUGIN, "README.md"), "utf8");
  assert.match(readme, /--setting-sources/, "the README documents the workaround");
});

// --- Bug 6: false positives on regex literals and bracket classes ------------

test("bug 6: a / regex delimiter and [a-z-]* are not path reach or room globs", () => {
  for (const id of ["14", "25", "29"]) allowed(replay(id), id);
  allowed(at("merger", "Bash", { command: "grep -o '[a-z-]*' .remake/progress/features.json" }));
  allowed(at("builder", "Bash", { command: `node -e "console.log('a/b'.split(/\\//))"` }, wt));
  // Still a reach: a lone / or ../.. as an argument, a real glob at the room.
  denied(at("builder", "Bash", { command: "node x.mjs '/'" }, wt), "node x.mjs '/'");
  denied(at("builder", "Bash", { command: 'node probe.mjs "../.."' }, wt), "../.. as an argument");
  denied(at("builder", "Bash", { command: `ls ${base}/gu*ling.r*` }), "unquoted glob at the room");
  denied(at("builder", "Bash", { command: `find ${base} -name 'gu*ling.r*'` }), "find -name is a glob");
  denied(at("builder", "Bash", { command: "grep -rn chardet src" }), "the blocklist still applies");
});

// --- v0.1.3 fix 1: "sealed" and "evidence" as plain words --------------------

test("fix 1: the word sealed or evidence in a report, a script or a pattern reaches nothing", () => {
  for (const id of ["12", "28", "30", "31"]) allowed(replay(id), id);
  for (const command of [
    'git commit -m "test: sealed counts in the parity report"',
    "grep -n sealed .remake/reports/parity.json",
    "grep -rn -e evidence -e sealed src",
    'rg -n "sealed|evidence" .remake/reports',
    'node --test --test-name-pattern="sealed" tests/unit',
    "node --test --test-name-pattern sealed tests/unit",
    `node -e "const j=require('./.remake/reports/parity.json');console.log(j.sealed.passed)"`,
    "cat > .remake/reports/verify.md <<'EOF'\nsealed 68/78, evidence reviewed\nEOF",
  ])
    for (const agent of ["verifier", "builder"]) allowed(at(agent, "Bash", { command }), `${agent}: ${command}`);
});

test("fix 1: a command that names the sealed or evidence folder is still refused", () => {
  for (const command of [
    "cat $R/sealed/a.test.mjs",
    "ls $R/evidence",
    "cd $R && cat sealed/a.test.mjs",
    "cd $R; ls sealed",
    "find . -name sealed",
    "find / -name sealed",
    "ls ../*/evidence",
    "grep -r x sealed",
    "grep -rn x --include=sealed .",
    "cat ../sea''led/x",
    "cat $R/sea\\led/x",
    "cat $R/sealed./a",
    "type %R%\\sealed\\a",
    'git commit -m "$(cat $R/sealed/a)"',
    'grep "$(cat $R/sealed/a)" f',
    "grep -f $R/sealed/a f",
    'sed "1r $R/sealed/a" f',
    `node -e "path.join(R,'sealed')"`,
    `node -e "require('fs').readdirSync(process.env.R+'/sealed')"`,
    `node -e "require('fs').readdirSync(R+'/evi'+'dence')"`,
    "python3 - <<'EOF'\nimport os\nprint(os.listdir(R + \"/sealed/a\"))\nEOF",
    "sh <<EOF\nls sealed\nEOF",
    "cat <<EOF | sh\nls sealed\nEOF",
    "cat > .remake/tmp/x.md <<EOF\n$(ls sealed)\nEOF",
    "cat > .remake/reports/verify.md <<'EOF'\nsee $R/sealed/a.test.mjs\nEOF",
    `cat ${room}/sealed/a.test.mjs`,
  ])
    for (const agent of CLEAN) denied(at(agent, "Bash", { command }), `${agent}: ${command}`);
  // The logged report, piped to a shell instead of written out.
  const report = fill(fixture.find((x) => x.id === "12").input.command).replace("<<'EOF'", "<<'EOF' | sh");
  denied(at("verifier", "Bash", { command: report }), "report piped to sh");
});

// --- v0.1.3 fix 2: a builder's $W/ paths -------------------------------------

test("fix 2: a builder's own $W/tests/visible is its worktree, not the room", () => {
  for (const id of ["7", "8"]) allowed(replay(id), id);
  allowed(at("builder", "Bash", { command: `export W=${wt}; ls $W/tests/visible | head` }, wt), "export W=");
  allowed(at("builder", "Bash", { command: `W="${wt}"; ls "\${W}/tests/visible"` }, wt), "quoted ${W}");
});

test("fix 2: a variable that leads out of the tree or into the room is still refused", () => {
  for (const command of [
    "W=..; cat $W/x",
    "W=../..; ls $W",
    `W=${room}; ls $W/x`,
    `W=${base}; cat $W/g*.r*/inventory.json`,
    `A=${base}; B=$A; ls $B/g*.r*`,
    `W=${base}; ls $W`,
    "W=/; ls $W",
    `W=${wt}; cat $W/../../../../x`,
    "ls $X/gu*room/inventory.json",
    "ls $X/guess*",
    "ls $X/tests/visible", // a variable nobody set may hold any path, as in v0.1.2
    "W=$(dirname $PWD); ls $W/tests/visible",
    `W=${wt}; W=$(dirname $W); ls $W/tests/visible`,
    `W=${wt}; cat $W/sealed/a.test.mjs`,
  ])
    denied(at("builder", "Bash", { command }, wt), command);
});

// --- v0.1.3 fix 3: a room role's leak check over its own output --------------

test("fix 3: a room role may grep its own output for the blocklist", () => {
  allowed(replay("2"), "2");
  const grep = (agent, input) => at(agent, "Grep", input);
  allowed(grep("spec-writer", { pattern: "chardet", path: `${room}/spec` }), "spec-writer spec/");
  allowed(grep("test-writer", { pattern: "(?i)chardet", path: `${room}/tests` }), "test-writer tests/");
  allowed(grep("test-writer", { pattern: "chardet", path: `${room}/sealed/a.test.mjs` }), "test-writer sealed/");
  allowed(grep("observer", { pattern: "chardet", path: `${room}/inventory.json` }), "observer inventory.json");
});

test("fix 3: every other blocklist hit is still refused", () => {
  for (const id of ["3", "13"]) denied(replay(id), id);
  const grep = (agent, input, cwd) => at(agent, "Grep", input, cwd);
  const chardet = { pattern: "chardet" };
  for (const agent of CLEAN) {
    denied(grep(agent, { ...chardet, path: `${app}/spec` }), `${agent} over the app's spec`);
    denied(grep(agent, { ...chardet, path: `${room}/spec` }), `${agent} over the room's spec`);
  }
  denied(grep("test-writer", { ...chardet, path: `${room}/evidence` }), "test-writer over evidence");
  denied(grep("test-writer", { ...chardet, path: `${room}/tests/../evidence` }), "climbs to evidence");
  denied(grep("spec-writer", { ...chardet, path: `${room}/tests` }), "spec-writer over tests/, not its own");
  denied(grep("spec-writer", { ...chardet, path: `${room}/evidence` }), "spec-writer over evidence");
  denied(grep("observer", { ...chardet, path: `${room}/evidence` }), "observer over evidence");
  denied(grep("spec-writer", { ...chardet, path: room }), "the whole room");
  denied(grep("spec-writer", { ...chardet }), "no path");
  denied(grep("spec-writer", { ...chardet, path: `${room}/spec`, glob: "chardet/**" }), "a term in the glob");
  denied(grep("spec-writer", { pattern: "x", path: `${room}/spec/chardet` }), "a term in the path");
  denied(grep("spec-writer", { ...chardet, path: "spec" }, `${base}/elsewhere`), "a relative path elsewhere");
  denied(decide({ agent_type: "remakecraft:spec-writer", tool_name: "Grep", tool_input: { ...chardet, path: `${room}/spec` }, cwd: app, real_paths: [`${base}/chardet-src`] }, { root: app, blocked: BLOCKED }, home), "a symlink out of spec/");
  denied(decide({ agent_type: "remakecraft:spec-writer", tool_name: "Grep", tool_input: { ...chardet, path: `${room}/spec` }, cwd: app, real_paths: [`${base}/src`] }, { root: app, blocked: BLOCKED }, home), "a link out of spec/, unnamed");
  denied(at("spec-writer", "Bash", { command: `grep -rn chardet ${room}/spec` }), "Bash grep stays closed");
  denied(at("spec-writer", "WebFetch", { url: "https://github.com/chardet/chardet" }), "WebFetch stays closed");
  denied(at("spec-writer", "Read", { file_path: `${room}/spec/chardet.md` }), "Read of a named file");
  assert.match(at("spec-writer", "Grep", { ...chardet, path: room }).reason, /<room>\/spec/, "the denial says how");
});

test("fix 3: each leak check is in audit.log; a check that cannot be logged is refused", (t) => {
  const out = tempDir(t, "rc-leak");
  const tree = path.join(out, "pad");
  const roomDir = path.join(out, "pad.remake-room");
  mkdirSync(path.join(roomDir, "spec"), { recursive: true });
  mkdirSync(path.join(roomDir, "evidence"), { recursive: true });
  writeFileSync(path.join(roomDir, "spec", "spec.json"), "{}\n");
  mkdirSync(tree, { recursive: true });
  writeFileSync(path.join(tree, "remake.json"), '{"app":"pad","blocked":["chardet"]}');
  const call = (agent, p) => handle(JSON.stringify({ session_id: SESSION, cwd: tree, tool_name: "Grep", agent_type: agent, tool_input: { pattern: "chardet|uchardet", path: p } }), { home: path.join(out, "home") });
  const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : "allow");
  const spec = path.join(roomDir, "spec", "spec.json").replace(/\\/g, "/");
  const lines = (name) => (existsSync(path.join(tree, ".remake", name)) ? readFileSync(path.join(tree, ".remake", name), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

  assert.equal(decision(call("remakecraft:spec-writer", spec)), "allow");
  const audit = lines("audit.log").filter((e) => e.event === "leak-check");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].role, "spec-writer");
  assert.equal(audit[0].tool, "Grep");
  assert.deepEqual(audit[0].terms, ["chardet"]);
  assert.match(audit[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(lines("wall.log").length, 0, "an allowed check is not a denial");

  assert.equal(decision(call("remakecraft:builder", spec)), "deny");
  assert.equal(decision(call("remakecraft:spec-writer", path.join(roomDir, "evidence").replace(/\\/g, "/"))), "deny");
  assert.equal(lines("wall.log").length, 2, "denials are logged as before");
  assert.equal(lines("audit.log").filter((e) => e.event === "leak-check").length, 1, "no leak-check line for a denial");

  // Fail closed: no audit line, no call.
  rmSync(path.join(tree, ".remake", "audit.log"));
  mkdirSync(path.join(tree, ".remake", "audit.log"));
  assert.equal(decision(call("remakecraft:spec-writer", spec)), "deny");
});
