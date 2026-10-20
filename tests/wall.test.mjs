import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { decide, roleOf } from "../hooks/wall.mjs";

const base = path.join(os.tmpdir(), "rc-wall").replace(/\\/g, "/");
const root = `${base}/brushling`;
const room = `${base}/brushling.remake-room`;
const home = `${base}/home`;
const run = { root, blocked: ["jspaint", "kolourpaint", "reactos"] };

const call = (agent, tool, input, cwd = root) => decide({ agent_type: agent, tool_name: tool, tool_input: input, cwd }, run, home);
const denied = (v, what = "") => assert.equal(v?.decision, "deny", `expected deny${what ? `: ${what}` : ""}`);
const allowed = (v) => assert.equal(v, null, `expected allow, got: ${v?.reason}`);

test("outside a run the wall is down", () => {
  assert.equal(decide({ agent_type: "remakecraft:builder", tool_name: "Read", tool_input: { file_path: `${room}/evidence/a.png` }, cwd: root }, null, home), null);
});

test("roles are namespaced to remakecraft only", () => {
  assert.equal(roleOf("remakecraft:builder"), "builder");
  assert.equal(roleOf("builder"), "builder");
  assert.equal(roleOf("other-plugin:builder"), null);
  assert.equal(roleOf("remakecraft:unknown"), null);
  assert.equal(roleOf(undefined), null);
});

test("builder cannot read the room", () => {
  denied(call("remakecraft:builder", "Read", { file_path: `${room}/evidence/menu.png` }));
  denied(call("remakecraft:builder", "Read", { file_path: `../brushling.remake-room/sealed/t1.rs` }));
  denied(call("remakecraft:builder", "Grep", { pattern: "fill", path: room }));
  denied(call("remakecraft:builder", "Glob", { pattern: `${room}/**/*` }));
  denied(call("remakecraft:builder", "Bash", { command: `cat ${room}/inventory.json` }));
});

test("builder cannot read outside its tree, except toolchains", () => {
  denied(call("remakecraft:builder", "Read", { file_path: `${base}/elsewhere/notes.md` }));
  denied(call("remakecraft:builder", "Glob", { pattern: "../*/evidence/*" }));
  allowed(call("remakecraft:builder", "Read", { file_path: `${home}/.cargo/registry/src/egui/lib.rs` }));
  allowed(call("remakecraft:builder", "Read", { file_path: "src/main.rs" }));
  allowed(call("remakecraft:builder", "Grep", { pattern: "fn flood_fill", path: "src" }));
});

test("builder shell heuristics", () => {
  denied(call("remakecraft:builder", "Bash", { command: "ls ../*/evidence" }));
  denied(call("remakecraft:builder", "Bash", { command: "find / -name sealed" }));
  denied(call("remakecraft:builder", "Bash", { command: "cat ../d*/x" }));
  allowed(call("remakecraft:builder", "Bash", { command: "cargo test --workspace" }));
});

test("a symlink into the room is caught by its real path", () => {
  const v = decide(
    { agent_type: "remakecraft:builder", tool_name: "Read", tool_input: { file_path: "src/notes.txt" }, cwd: root, real_paths: [`${room}/evidence/secret.txt`] },
    run, home,
  );
  denied(v);
});

test("builder cannot edit the yardstick", () => {
  denied(call("remakecraft:builder", "Edit", { file_path: "tests/visible/fill.rs" }));
  denied(call("remakecraft:builder", "Write", { file_path: `${root}/spec/spec.json` }));
  denied(call("remakecraft:builder", "Write", { file_path: "remake.json" }));
  allowed(call("remakecraft:builder", "Write", { file_path: "src/tools/fill.rs" }));
});

test("builder in a worktree is held to the same rules", () => {
  const wt = `${root}/.claude/worktrees/b1`;
  const wtRun = { ...run, root: wt };
  const v = (tool, input) => decide({ agent_type: "remakecraft:builder", tool_name: tool, tool_input: input, cwd: wt }, wtRun, home);
  denied(v("Edit", { file_path: "tests/visible/fill.rs" }));
  denied(v("Read", { file_path: `${room}/evidence/a.png` }));
  allowed(v("Write", { file_path: "src/lib.rs" }));
});

test("room roles write only inside the room", () => {
  allowed(call("remakecraft:observer", "Write", { file_path: `${room}/evidence/notes/menus.md` }));
  allowed(call("remakecraft:spec-writer", "Write", { file_path: `${room}/spec/spec.json` }));
  denied(call("remakecraft:spec-writer", "Write", { file_path: `${root}/src/main.rs` }));
  denied(call("remakecraft:observer", "Edit", { file_path: "src/main.rs" }));
});

test("room roles may keep temp files in their session's scratchpad", () => {
  // The observer in the Brushling run wrote a generator script to Claude Code's scratchpad and was denied.
  const tmp = `${base}/Temp`;
  const pad = `${tmp}/claude/C--runs-brushling/s1/scratchpad`;
  const at = (agent, tool, input, session = "s1") =>
    decide({ agent_type: agent, tool_name: tool, tool_input: input, cwd: root, session_id: session }, run, home, tmp);

  allowed(at("remakecraft:observer", "Write", { file_path: `${pad}/gen_inventory.py` }));
  allowed(at("remakecraft:spec-writer", "Edit", { file_path: `${pad}/draft.md` }));
  allowed(at("remakecraft:test-writer", "Write", { file_path: pad.replace(/\//g, "\\") + "\\cases.json" }));
  allowed(at("remakecraft:observer", "Write", { file_path: `${pad}/x.py` }, undefined));

  denied(at("remakecraft:observer", "Write", { file_path: `${tmp}/claude/C--runs-brushling/s2/scratchpad/x.py` }));
  denied(at("remakecraft:observer", "Write", { file_path: `${tmp}/claude/C--runs-brushling/s1/notes.md` }));
  denied(at("remakecraft:observer", "Write", { file_path: `${tmp}/gen_inventory.py` }));
  denied(at("remakecraft:observer", "Write", { file_path: `${pad}/../../../../x.py` }));
  denied(at("remakecraft:observer", "Write", { file_path: `${root}/scratchpad/x.py` }));
  denied(call("remakecraft:observer", "Write", { file_path: `${pad}/x.py` }));
});

test("the clean side may not touch any scratchpad", () => {
  // Builders share the session's scratchpad with the room roles.
  const tmp = `${base}/Temp`;
  const pad = `${tmp}/claude/C--runs-brushling/s1/scratchpad`;
  const at = (agent, tool, input) =>
    decide({ agent_type: agent, tool_name: tool, tool_input: input, cwd: root, session_id: "s1" }, run, home, tmp);

  for (const agent of ["remakecraft:builder", "remakecraft:verifier", "remakecraft:reviewer"]) {
    denied(at(agent, "Read", { file_path: `${pad}/gen_inventory.py` }));
    denied(at(agent, "Grep", { pattern: "fill", path: pad }));
    denied(at(agent, "Bash", { command: `cat "${pad}/gen_inventory.py"` }));
    denied(at(agent, "Bash", { command: "cat $TMPDIR/claude/*/*/scratchpad/*.py" }));
    denied(at(agent, "PowerShell", { command: "Get-Content $env:TEMP\\claude\\p\\s1\\scratchpad\\notes.md" }));
  }
  denied(at("remakecraft:builder", "Write", { file_path: `${pad}/notes.md` }));
  allowed(at("remakecraft:builder", "Write", { file_path: "src/scratchpad.rs" }));
  allowed(at("remakecraft:builder", "Bash", { command: "cargo test scratchpad" }));
  allowed(at(undefined, "Read", { file_path: `${pad}/gen_inventory.py` }));
});

test("test-writer works from the spec, never the evidence", () => {
  allowed(call("remakecraft:test-writer", "Read", { file_path: `${room}/spec/spec.json` }));
  allowed(call("remakecraft:test-writer", "Write", { file_path: `${room}/sealed/fill_edges.rs` }));
  denied(call("remakecraft:test-writer", "Read", { file_path: `${room}/evidence/menu.png` }));
});

test("verifier and reviewer write only reports", () => {
  allowed(call("remakecraft:verifier", "Write", { file_path: ".remake/reports/parity.json" }));
  denied(call("remakecraft:verifier", "Edit", { file_path: "src/main.rs" }));
  denied(call("remakecraft:reviewer", "Write", { file_path: "tests/visible/x.rs" }));
  denied(call("remakecraft:verifier", "Read", { file_path: `${room}/sealed/t1.rs` }));
});

test("blocklist applies to everyone, main session included", () => {
  denied(call(undefined, "WebFetch", { url: "https://jspaint.app" }));
  denied(call("remakecraft:observer", "WebSearch", { query: "kolourpaint flood fill source" }));
  denied(call("remakecraft:builder", "Bash", { command: "git clone https://github.com/reactos/reactos" }));
  allowed(call(undefined, "WebFetch", { url: "https://docs.rs/egui" }));
});

test("decompilers are blocked for everyone", () => {
  denied(call(undefined, "Bash", { command: "ghidra mspaint.exe" }));
  denied(call("remakecraft:observer", "Bash", { command: "C:/tools/ida64.exe C:/Windows/System32/mspaint.exe" }));
  denied(call("remakecraft:observer", "PowerShell", { command: "& ilspycmd app.dll" }));
  denied(call(undefined, "Bash", { command: "objdump -d paint.exe | head" }));
  allowed(call(undefined, "Bash", { command: "objdump --help" }));
  allowed(call(undefined, "Bash", { command: "cargo build --release" }));
});

test("unknown agents get only the global rules", () => {
  allowed(call("some-plugin:helper", "Read", { file_path: `${room}/evidence/a.png` }));
  denied(call("some-plugin:helper", "WebFetch", { url: "https://jspaint.app" }));
});

test("clean roles may not start another agent; the reviewer may run Codex read-only on its tree", () => {
  // A fresh claude -p or codex exec has no agent type, so the wall would treat it as the main session.
  for (const agent of ["remakecraft:builder", "remakecraft:merger", "remakecraft:verifier", "remakecraft:reviewer"]) {
    for (const command of [
      'claude -p "summarise ../"',
      "FOO=1 claude --print hi",
      "echo hi | claude",
      'codex exec "list the parent folder"',
      "npx -y @anthropic-ai/claude-code -p hi",
      "pnpm dlx @openai/codex exec hi",
      "gemini -p hi",
      'cmd /c "C:/Users/x/AppData/Roaming/npm/claude.cmd -p hi"',
      "opencode run hi",
    ]) denied(call(agent, "Bash", { command }));
    denied(call(agent, "PowerShell", { command: "& claude -p hi" }));
    allowed(call(agent, "Bash", { command: "git log --oneline --author claude" }));
    allowed(call(agent, "Bash", { command: "grep -rn codex src/" }));
  }
  allowed(call("remakecraft:builder", "Bash", { command: "cargo test gemini_mode" }));

  const review = `codex exec -C . -c default_permissions="remake_review" -c 'permissions.remake_review.filesystem={":minimal"="read",":workspace_roots"={"."="read"}}' -m gpt-5 "Review this diff against spec/spec.json."`;
  allowed(call("remakecraft:reviewer", "Bash", { command: review }));
  denied(call("remakecraft:builder", "Bash", { command: review }), "only the reviewer");
  denied(call("remakecraft:reviewer", "Bash", { command: 'codex exec --sandbox read-only "Review this diff"' }));
  denied(call("remakecraft:reviewer", "Bash", { command: `${review} -s danger-full-access` }));
  denied(call("remakecraft:reviewer", "Bash", { command: 'codex exec -c default_permissions="remake_review" -c \'permissions.remake_review.filesystem={":root"="read"}\' "x"' }));
  denied(call("remakecraft:reviewer", "Bash", { command: 'codex exec "Review this diff"' }));

  // Outside the clean side there is no wall to escape.
  allowed(call(undefined, "Bash", { command: 'claude -p "hi"' }));
  allowed(call("remakecraft:observer", "Bash", { command: 'codex exec "describe the screenshot"' }));
});

test("clean roles may not read wall.log or audit.log", () => {
  for (const agent of ["remakecraft:builder", "remakecraft:merger", "remakecraft:verifier", "remakecraft:reviewer"]) {
    denied(call(agent, "Read", { file_path: ".remake/wall.log" }));
    denied(call(agent, "Read", { file_path: `${root}/.remake/audit.log` }));
    denied(call(agent, "Grep", { pattern: "reason", path: ".remake" }));
    denied(call(agent, "Glob", { pattern: ".remake/*" }));
    denied(call(agent, "Bash", { command: "cat .remake/wall.log" }));
    denied(call(agent, "Bash", { command: "tail -n 5 .remake/*.log" }));
    denied(call(agent, "PowerShell", { command: "Get-Content .remake\\audit.log" }));
    allowed(call(agent, "Read", { file_path: ".remake/progress/features.json" }));
    allowed(call(agent, "Read", { file_path: `${root}/.remake/reports/review.md` }));
    allowed(call(agent, "Bash", { command: "cat .remake/progress/features.json" }));
  }
  // From a builder worktree the logs sit in the main tree.
  const wt = `${root}/.claude/worktrees/b1`;
  const v = (input) => decide({ agent_type: "remakecraft:builder", tool_name: "Bash", tool_input: input, cwd: wt }, { ...run, root: wt, logRoot: root }, home);
  denied(v({ command: "cat ../../../.remake/wall.log" }));
  allowed(call(undefined, "Read", { file_path: ".remake/wall.log" }));
  allowed(call("remakecraft:observer", "Read", { file_path: `${root}/.remake/wall.log` }));
});

test("a prompt that spawns a clean role may not carry the room or a blocked name", () => {
  const spawn = (subagent_type, prompt) => call(undefined, "Agent", { subagent_type, prompt, description: "x" });
  denied(spawn("remakecraft:builder", `Build calc.add. The screenshots are in ${room}/evidence if you need them.`));
  denied(spawn("remakecraft:merger", "Merge remake/fill. It should behave like JSPaint does."));
  allowed(spawn("remakecraft:builder", "Build feature calc.add. Branch name: remake/calc.add."));
  allowed(spawn("remakecraft:observer", `Inventory the app from ${room}/evidence.`));
  allowed(spawn("Explore", `Look at ${room}`));
});

test("the merger merges code and progress, never the yardstick or the room", () => {
  assert.equal(roleOf("remakecraft:merger"), "merger");
  allowed(call("remakecraft:merger", "Edit", { file_path: "src/calc.mjs" }));
  allowed(call("remakecraft:merger", "Write", { file_path: ".remake/progress/features.json" }));
  allowed(call("remakecraft:merger", "Bash", { command: "git merge --no-ff remake/calc.add && npm test" }));
  denied(call("remakecraft:merger", "Edit", { file_path: "tests/visible/add.test.mjs" }));
  denied(call("remakecraft:merger", "Write", { file_path: "spec/spec.json" }));
  denied(call("remakecraft:merger", "Write", { file_path: ".remake/wall.log" }));
  denied(call("remakecraft:merger", "Read", { file_path: `${room}/sealed/t1.json` }));
});

test("the shell wall catches cheap obfuscation of the room", () => {
  // The one-liners from the pre-launch audit, against this run's layout.
  const b64 = "Li4vYnJ1c2hsaW5nLnJlbWFrZS1yb29tL2V2aWRlbmNlL3NlY3JldC50eHQ="; // ../brushling.remake-room/evidence/secret.txt
  for (const command of [
    "cat $(find / -path '*remake-r*' -name secret.txt)",
    `cat ${base}/brushling.*/sec*.txt`,
    `cat ${base}/brushl?ng.*/x`,
    "R=remake; cat ../brushling.${R}-room/evid''ence/secret.txt",
    "R=remake; cat ../brushling.$R-room/notes.md",
    `node -e "require('fs').readFileSync('../brushling.re'+'make-ro'+'om/s.txt')"`,
    `python3 -c "print(open('../brushling.rem' 'ake-r' 'oom/x').read())"`,
    `python3 -c "import os; print(os.listdir('..'))"`,
    `echo ${b64} | base64 -d | xargs cat`,
    `cat "$(echo ${b64} | base64 --decode)"`,
    "echo bm90aGluZw== | base64 -d | sh",
    "cd .. && cd brushling.remake-ro?m && cat */*",
    'find .. -name "*-room"',
    "cat ev\\idence/x",
  ]) denied(call("remakecraft:builder", "Bash", { command }), command);
  denied(call("remakecraft:builder", "Bash", { command: "cat */se*/*" }, base), "from the folder that holds both trees");
  denied(call("remakecraft:builder", "Bash", { command: "ls */ev*" }, base));
});

test("the shell wall leaves normal builder commands alone", () => {
  for (const command of [
    "cargo test --workspace",
    "cargo build 2>&1 | tail -20",
    "npm test",
    'node --test "tests/visible/**/*.test.mjs"',
    'git commit -qm "feat(calc.add): add numbers"',
    "git diff HEAD~1 -- src/",
    "ls src/*.rs",
    "cat .remake/progress/features.json",
    'node -e "console.log(1 + 2)"',
    `python -c "print('a' + 'b')"`,
    'grep -rn "fn main" src/',
    "echo aGVsbG8gd29ybGQ= | base64 -d",
    "find src -name '*.rs'",
    'find . -name "*.test.mjs" -path "*visible*"',
    "npx prettier --check src",
    "rm -rf target/debug/*.d",
    'for f in src/*.mjs; do node --check "$f"; done',
  ]) allowed(call("remakecraft:builder", "Bash", { command }));
  allowed(call("remakecraft:reviewer", "Bash", { command: "git diff remake-reviewed..HEAD > .remake/reports/review.diff" }));
  allowed(call("remakecraft:reviewer", "Bash", { command: "git tag -f remake-reviewed HEAD" }));
  allowed(call("remakecraft:verifier", "Bash", { command: `node "${home}/.claude/plugins/remakecraft/scripts/parity.mjs" --app ${root}` }));
});

test("nobody opens the original app, but anyone may run it", () => {
  const orig = `${room}/original/tally.mjs`;
  for (const agent of ["remakecraft:observer", undefined, "remakecraft:spec-writer"]) {
    denied(call(agent, "Read", { file_path: orig }));
    denied(call(agent, "Grep", { pattern: "hist", path: `${room}/original` }));
    denied(call(agent, "Bash", { command: `cat ${orig}` }));
  }
  denied(call("remakecraft:observer", "Read", { file_path: "brushling.remake-room/original/tally.mjs" }, base));
  denied(call("remakecraft:observer", "Bash", { command: `cd ${room}/original && head -n 40 tally.mjs` }));
  denied(call("remakecraft:observer", "Bash", { command: `node -e "console.log(require('fs').readFileSync('${orig}','utf8'))"` }));
  denied(call("remakecraft:observer", "Bash", { command: `python3 -c "print(open('${orig}').read())"` }));
  denied(call("remakecraft:observer", "Bash", { command: `node < ${orig}` }));
  denied(call("remakecraft:observer", "PowerShell", { command: `Get-Content ${orig}` }));
  denied(call("remakecraft:observer", "Bash", { command: `cp ${orig} /tmp/x.mjs` }));
  denied(call("remakecraft:observer", "Write", { file_path: orig }));

  // Observing: run it, list its folder, pipe its output through readers.
  allowed(call("remakecraft:observer", "Bash", { command: `node ${orig} add 5` }));
  allowed(call("remakecraft:observer", "Bash", { command: `mkdir -p s; cd s; T="node ${orig}"; r(){ $T "$@" >o.txt 2>e.txt; cat o.txt; }; r add 1` }));
  allowed(call("remakecraft:observer", "Bash", { command: `${room}/original/tally add 2 | cat` }));
  allowed(call("remakecraft:observer", "Bash", { command: `cd ${room}/original && node tally.mjs show` }));
  allowed(call("remakecraft:observer", "Bash", { command: `ls ${room}/original` }));
  allowed(call("remakecraft:observer", "Glob", { pattern: `${room}/original/*` }));
});

const CLEAN = ["remakecraft:builder", "remakecraft:verifier", "remakecraft:reviewer", "remakecraft:merger"];

test("clean roles may not walk up out of the tree in a shell", () => {
  for (const agent of CLEAN) {
    for (const command of [
      "grep -r . ..",
      "find .. -type f -exec cat {} +",
      "cp -r .. /tmp/x",
      "cd ../.. && grep -r . .",
      "cd .. && ls",
      "git -C .. log",
      "tar cf x.tar --directory=..",
      `cat ${base}/brushling/../*`,
      "ls ../",
    ]) denied(call(agent, "Bash", { command }), command);
  }
  denied(call("remakecraft:builder", "Bash", { command: "cd src && grep -r . ../.." }), "two levels up from src");
  denied(call("remakecraft:builder", "Bash", { command: "ls /" }));
});

test("a worktree builder may not walk up to the main tree or beyond", () => {
  const wt = `${root}/.claude/worktrees/b1`;
  const wtRun = { ...run, root: wt, logRoot: root };
  const v = (command, cwd = wt) => decide({ agent_type: "remakecraft:builder", tool_name: "Bash", tool_input: { command }, cwd }, wtRun, home);
  denied(v("grep -r . ../../../.."));
  denied(v("grep -r . .."));
  denied(v("cat ../../../brushling.remake-room/x"));
  allowed(v("cat ../b1/Cargo.toml"));
  allowed(v("cd src && cat ../Cargo.toml", `${wt}`));
});

test("a home directory above the tree is an ancestor too", () => {
  const upHome = base; // holds brushling/
  const v = (command) => decide({ agent_type: "remakecraft:builder", tool_name: "Bash", tool_input: { command }, cwd: root }, run, upHome);
  denied(v("grep -r . ~"));
  denied(v("grep -r . $HOME"));
  denied(v("ls ${HOME}/"));
  denied(v("cd ~ && ls"));
  allowed(v("ls ~/brushling/src"));
});

test("normal commands that stay inside the tree still run", () => {
  const sub = (command) => call("remakecraft:builder", "Bash", { command }, `${root}/src`);
  allowed(sub("cat ../Cargo.toml"));
  allowed(sub("ls ../"));
  allowed(sub("cd .. && cat Cargo.toml"));
  allowed(sub("cd ../tests && ls"));
  for (const command of [
    "cd src && cat ../Cargo.toml",
    "cargo build",
    "npm test",
    "node /usr/bin/npm --version",
    "/usr/bin/node --test",
    "cat ./src/../Cargo.toml",
    `cd ${root}/src && cat ../Cargo.toml`,
    "cargo build --target-dir=target/x",
  ]) allowed(call("remakecraft:builder", "Bash", { command }));
});

test("clean roles may not symlink out of the tree", () => {
  for (const agent of CLEAN) {
    denied(call(agent, "Bash", { command: "ln -s .. up" }));
    denied(call(agent, "Bash", { command: "ln -s ../.. up" }));
    denied(call(agent, "Bash", { command: `ln -s ${base} up` }));
    denied(call(agent, "Bash", { command: `ln -sfn ${room} up` }));
  }
  denied(call("remakecraft:builder", "Bash", { command: "ln -s .. up && cat up/*/e*/*" }));
  allowed(call("remakecraft:builder", "Bash", { command: "ln -s src/lib.rs lib_link.rs" }));
});

test("room paths are normalised before they are matched", () => {
  const tw = (file_path, tool = "Read") => call("remakecraft:test-writer", tool, { file_path });
  denied(tw(`${room}/./evidence/x`));
  denied(tw(`${room}//evidence/x`));
  denied(tw(`${room}/spec/../evidence/x`));
  denied(tw("../brushling.remake-room/./evidence/x"));
  denied(call("remakecraft:test-writer", "Glob", { pattern: `${room}/./evidence/*` }));
  denied(call("remakecraft:test-writer", "Bash", { command: `cat ${room}/./evidence/x` }));
  allowed(tw(`${room}/./spec/spec.json`));
  allowed(tw(`${room}/spec/../spec/spec.json`));
  denied(call("remakecraft:builder", "Read", { file_path: `${room}/./sealed/t.rs` }));
  denied(call("remakecraft:builder", "Read", { file_path: "src/../../brushling.remake-room/x" }));
});

test("clean roles may not read the run logs in any form", () => {
  for (const command of [
    "grep -r . .remake",
    "cat .remake/wal''l.log",
    'cat .remake/"audit".log',
    "cat .remake/./wall.log",
    "head -5 .remake/wall.log",
    "cat src/../.remake/wall.log",
  ]) {
    denied(call("remakecraft:verifier", "Bash", { command }), command);
    denied(call("remakecraft:merger", "Bash", { command }), command);
  }
  // Listing .remake/ itself shows file names, never what the logs hold (v0.1.2, chardet #9, #18, #19, #21).
  for (const command of ["ls .remake", "ls -a . .remake", "mkdir -p .remake/tmp && ls .remake"]) {
    allowed(call("remakecraft:verifier", "Bash", { command }), command);
    allowed(call("remakecraft:merger", "Bash", { command }), command);
  }
  allowed(call("remakecraft:merger", "Bash", { command: "cat .remake/progress/features.json" }));
  allowed(call("remakecraft:verifier", "Bash", { command: "ls .remake/reports" }));
  allowed(call("remakecraft:reviewer", "Bash", { command: "git diff remake-reviewed..HEAD > .remake/reports/review.diff" }));
});

test("an agent CLI hidden in a variable is refused", () => {
  for (const agent of CLEAN) {
    for (const command of ["C=claude; $C -p hi", 'C="claude"; $C -p hi', "export C=codex && $C exec hi", "C=cla''ude; $C -p hi", "C=/usr/local/bin/gemini $C -p hi"])
      denied(call(agent, "Bash", { command }), command);
    allowed(call(agent, "Bash", { command: "NAME=widget cargo test $NAME" }));
    allowed(call(agent, "Bash", { command: "git log --author=claude" }));
  }
  allowed(call(undefined, "Bash", { command: "C=claude; $C -p hi" }));
});

// --- Traversal rule: Windows paths, home, false positives --------------------

const winRoot = "C:/Users/s/Projects/brushling";
const winHome = "C:/Users/s";
const winRun = { root: winRoot, blocked: [] };
const winBash = (command, cwd = winRoot) =>
  decide({ agent_type: "remakecraft:builder", tool_name: "Bash", tool_input: { command }, cwd }, winRun, winHome);
const homeRun = { root, blocked: [] };
const homeBash = (command, cwd = root) =>
  decide({ agent_type: "remakecraft:builder", tool_name: "Bash", tool_input: { command }, cwd }, homeRun, base);

test("Git Bash drive paths are resolved as drive paths", () => {
  denied(winBash("grep -r tok /c/Users/s/Projects"), "/c/ ancestor");
  denied(winBash("cd /c/Users/s && grep -r tok ."), "cd /c/");
  denied(winBash("grep -r tok /C/Users/s"), "upper-case drive");
  denied(winBash("ls /mnt/c/Users/s/Projects"), "WSL form");
  denied(winBash("grep -r tok c:\\users\\S\\projects"), "case-insensitive backslash path");
  allowed(winBash("cat /c/Users/s/Projects/brushling/spec/a.md"));
  allowed(winBash("cargo build 2>/dev/null"));
});

test("UNC and device paths are refused for clean roles", () => {
  denied(winBash("gci -r \\\\localhost\\C$\\Users\\s\\Projects"));
  denied(winBash("cat //server/share/x"));
  denied(winBash("cat \\\\?\\C:\\Users\\s\\Projects\\x"));
  denied(winBash("cat \\\\.\\C:\\x"));
});

test("home and cwd spellings that climb out are refused", () => {
  denied(homeBash("cd; rg -l tok ."), "bare cd; home is an ancestor");
  denied(homeBash("cd"), "bare cd");
  denied(homeBash("cd ~ && ls"));
  denied(homeBash("grep -r tok $PWD/.."));
  denied(homeBash("grep -r tok ${PWD}/.."));
  denied(homeBash("grep -r tok ~+/.."));
  denied(homeBash("D=..; grep -r tok $D"), "assignment word");
  denied(homeBash("grep -r tok $UNKNOWN/../x"), "unresolved variable with ..");
  denied(homeBash("grep -r tok ~s/Projects"), "another user's home");
  denied(winBash("gci -r ~\\Projects"));
  denied(winBash("gci -r $env:USERPROFILE\\Projects"));
  denied(winBash("gci -r %USERPROFILE%\\Projects"));
  denied(winBash("cd.. ; gci -r ."));
});

test("bare cd is fine when home is not above the tree", () => {
  allowed(call("remakecraft:builder", "Bash", { command: "cd; ls" }));
  allowed(call("remakecraft:builder", "Bash", { command: "cd src && ls $PWD" }));
  allowed(call("remakecraft:builder", "Bash", { command: "FOO=bar cargo build" }));
});

test("commit messages and arithmetic are not path reach", () => {
  allowed(call("remakecraft:builder", "Bash", { command: 'git commit -m "fix .. thing"' }));
  allowed(call("remakecraft:builder", "Bash", { command: 'git commit -m "docs: and / or"' }));
  allowed(call("remakecraft:builder", "Bash", { command: "git commit -am 'a / b .. c'" }));
  allowed(call("remakecraft:builder", "Bash", { command: 'git commit --message="x / y"' }));
  allowed(call("remakecraft:builder", "Bash", { command: 'node -e "console.log(4 / 2)"' }));
  allowed(call("remakecraft:builder", "Bash", { command: 'python3 -c "print(10 / 3)"' }));
  // Still refused: the exemption covers prose only.
  denied(call("remakecraft:builder", "Bash", { command: 'git commit -m "x" && ls ..' }));
  denied(call("remakecraft:builder", "Bash", { command: 'git commit -m "$(ls ..)"' }));
  denied(call("remakecraft:builder", "Bash", { command: "expr 10 / 2" }));
  denied(call("remakecraft:builder", "Bash", { command: "ls /" }));
  denied(call("remakecraft:builder", "Bash", { command: 'cat .. -m "x"' }));
});

test("every clean role keeps temp files in .remake/tmp/", () => {
  for (const role of ["builder", "merger", "verifier", "reviewer"]) {
    const agent = `remakecraft:${role}`;
    allowed(call(agent, "Write", { file_path: `${root}/.remake/tmp/ext.mjs`, content: "x" }));
    allowed(call(agent, "Write", { file_path: ".remake/tmp/notes.md", content: "x" }));
    allowed(call(agent, "Bash", { command: "node .remake/tmp/ext.mjs .remake/reports/visible.xml > .remake/tmp/out.txt" }));
    allowed(call(agent, "Read", { file_path: `${root}/.remake/tmp/out.txt` }));
    denied(call(agent, "Write", { file_path: `${root}/.remake/wall.log`, content: "x" }), `${role} wall.log`);
    denied(call(agent, "Read", { file_path: `${root}/.remake/wall.log` }), `${role} read wall.log`);
  }
  denied(call("remakecraft:builder", "Write", { file_path: `${root}/.remake/reports/parity.json`, content: "x" }), "builder reports");
  denied(call("remakecraft:builder", "Write", { file_path: "tests/visible/a.test.mjs", content: "x" }), "builder tests");
});

test("search patterns, heredoc file bodies and script comments are not path reach", () => {
  // From the 2026-10-18 tally run: builders and mergers reading their own JUnit
  // reports and appending code were refused for regex and escape text.
  const b = (command) => call("remakecraft:builder", "Bash", { command });
  allowed(b(`grep -o '<testcase name="[^"]*show[^"]*"[^>]*' visible.json | sed 's/ time.*failure=/ FAIL /;s/ time.*//' | cut -c1-120`));
  allowed(b(`f=.remake/reports/visible.json; grep -o 'testcase name="[^"]*"' $f | sed 's/testcase name=//' | head -80`));
  allowed(b(`grep -e '//' src/a.mjs && awk -F, '{ print $1 "/" $2 }' data.csv && rg '^//' src`));
  allowed(b(`cat >> src/store.mjs <<'EOF'\n// Serialize the state.\nexport const s = (c) => ["tally 1", c].join("\\n") + "\\n";\nEOF\nsed -i 's/import { a }/import { a, b }/' src/store.mjs`));
  allowed(b(`python - <<'EOF'\ns = open('src/tally.mjs').read().replace('a', '"\\\\n"')\nEOF`));
  allowed(b(`node -e 'const s = 1; // comment\nconsole.log(s.split("//"))'`));
  // Still refused: the pattern exemption covers the pattern alone, and shells run their heredocs.
  denied(b("grep -e x /"), "path after -e pattern");
  denied(b("grep -r x .. "), "path after positional pattern");
  denied(b("sed -n p .."), "sed's file argument");
  denied(b("sed -e 's/a/b/' ../.."), "sed's file argument after -e");
  denied(b("awk '{print}' ../.."), "awk's file argument");
  denied(b("bash <<'EOF'\nls /\nEOF"), "shell heredoc");
  denied(b("python - <<'EOF'\nimport os; print(os.listdir('..'))\nEOF"), "interpreter heredoc that climbs");
  denied(b("cat > x <<EOF\n$(ls ..)\nEOF"), "unquoted heredoc expands");
  denied(b("D=/; grep -r x $D"), "assignment to root");
  denied(b("cat //server/share/x"), "UNC with a share");
});

test("message and script exemptions are scoped to their own command", () => {
  const b = (command) => call("remakecraft:builder", "Bash", { command });
  denied(b('git commit -m x; rsync -am "../.." /tmp/x'));
  denied(b(`git commit -am "x" && tar -cm "${base}" -f /tmp/o.tar`));
  denied(b('git commit -m x && cp -rm ".." /tmp/x'));
  denied(b('bash -c "grep -r tok /"'));
  denied(b("sh -c 'cd / && grep -r tok .'"));
  denied(b('pwsh -command "gci -r /"'));
  allowed(b('git commit -am "a / b; c .. d" && cargo test'));
  allowed(b('node -e "console.log(8 / 2)" && python3 -c "print(1 / 2)"'));
});
