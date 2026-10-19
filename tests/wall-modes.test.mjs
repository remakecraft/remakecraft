// The wall per mode: clean (default), clean with REA for the observer, and
// open. Also the MCP hole: MCP tools reach the guard and the clean side gets
// none but the ones remake.json allows.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { decide, readModes, isReaTool } from "../hooks/wall.mjs";

const base = path.join(os.tmpdir(), "rc-modes").replace(/\\/g, "/");
const root = `${base}/calc`;
const room = `${base}/calc.remake-room`;
const home = `${base}/home`;
const clean = { root, blocked: ["jscalc"], mode: "clean", rea: false, mcpAllow: [] };
const withRea = { ...clean, rea: true };
const open = { ...clean, mode: "open" };

const call = (run, agent, tool, input, cwd = root) => decide({ agent_type: agent, tool_name: tool, tool_input: input, cwd }, run, home);
const denied = (v, what = "") => assert.equal(v?.decision, "deny", `expected deny${what ? `: ${what}` : ""}`);
const allowed = (v, what = "") => assert.equal(v, null, `expected allow${what ? ` (${what})` : ""}, got: ${v?.reason}`);

const ROOM_ROLES = ["remakecraft:observer", "remakecraft:spec-writer", "remakecraft:test-writer"];
const CLEAN_ROLES = ["remakecraft:builder", "remakecraft:merger", "remakecraft:verifier", "remakecraft:reviewer"];
const EVERYONE = [undefined, ...ROOM_ROLES, ...CLEAN_ROLES];
const REA_CALL = ["mcp__rea__analyze_function", { path: `${room}/original/calc.exe`, address: "0x180124945" }];
const GHIDRA = ["Bash", { command: `analyzeHeadless /tmp/p proj -import ${room}/original/calc.exe` }];
const READ_ORIGINAL = ["Read", { file_path: `${room}/original/calc.exe` }];

test("readModes defaults to clean and refuses a lowered wall without a basis", () => {
  assert.deepEqual(readModes({}), { mode: "clean", rea: false, mcpAllow: [] });
  assert.deepEqual(readModes({ mode: "open", basis: "own" }), { mode: "open", rea: false, mcpAllow: [] });
  assert.deepEqual(readModes({ rea: true, basis: "license", mcpAllow: ["mcp__docs__*"] }), { mode: "clean", rea: true, mcpAllow: ["mcp__docs__*"] });
  assert.throws(() => readModes({ rea: true }), /basis/);
  assert.throws(() => readModes({ mode: "open", basis: "trust me" }), /basis/);
  assert.throws(() => readModes({ mode: "dirty" }), /"mode"/);
  assert.throws(() => readModes({ rea: "yes", basis: "own" }), /"rea"/);
  assert.throws(() => readModes({ mcpAllow: "mcp__x__y" }), /mcpAllow/);
  assert.throws(() => readModes({ mcpAllow: ["Read"] }), /mcpAllow/);
});

test("REA tools are recognised by their registered server name", () => {
  assert.ok(isReaTool("mcp__rea__open_binary"));
  assert.ok(isReaTool("mcp__plugin_rea-agents_rea__decompile"));
  assert.ok(isReaTool("ReadMcpResourceTool", { server: "rea", uri: "rea://x" }));
  assert.ok(!isReaTool("mcp__reader__open"));
  assert.ok(!isReaTool("mcp__webpool__web_scrape"));
});

test("clean mode: nobody uses REA, the decompilers or the original's files", () => {
  for (const who of EVERYONE) {
    denied(call(clean, who, ...REA_CALL), `${who} REA`);
    denied(call(clean, who, ...GHIDRA), `${who} ghidra`);
    denied(call(clean, who, ...READ_ORIGINAL), `${who} read original`);
    denied(call(clean, who, "Bash", { command: "npx -y rea-agents@latest analyze-javascript-application /apps/calc --json" }), `${who} rea cli`);
  }
  assert.match(call(clean, "remakecraft:observer", ...REA_CALL).reason, /--with-rea/);
});

test("clean mode with REA: only the observer looks inside", () => {
  allowed(call(withRea, "remakecraft:observer", ...REA_CALL), "observer REA");
  allowed(call(withRea, "remakecraft:observer", ...GHIDRA), "observer ghidra");
  allowed(call(withRea, "remakecraft:observer", ...READ_ORIGINAL), "observer read original");
  allowed(call(withRea, "remakecraft:observer", "Bash", { command: `strings ${room}/original/calc.exe` }), "observer strings");
  allowed(call(withRea, "remakecraft:observer", "Write", { file_path: `${room}/evidence/rea/findings.md` }), "observer writes findings");
  denied(call(withRea, "remakecraft:observer", "Write", { file_path: `${root}/spec/spec.md` }), "observer still writes only in the room");
  for (const who of EVERYONE.filter((w) => w !== "remakecraft:observer")) {
    const r = call(withRea, who, ...REA_CALL);
    denied(r, `${who} REA`);
    assert.match(r.reason, /Only the observer/);
    denied(call(withRea, who, ...GHIDRA), `${who} ghidra`);
    denied(call(withRea, who, ...READ_ORIGINAL), `${who} read original`);
  }
  // A namesake from another plugin is not the observer.
  denied(call(withRea, "other:observer", ...REA_CALL), "other plugin's observer");
});

test("clean mode with REA: the clean side's room wall is unchanged", () => {
  denied(call(withRea, "remakecraft:builder", "Read", { file_path: `${room}/evidence/rea/findings.md` }));
  denied(call(withRea, "remakecraft:builder", "Bash", { command: `cat ${room}/evidence/rea/symbols.json` }));
  denied(call(withRea, "remakecraft:test-writer", "Read", { file_path: `${room}/evidence/rea/findings.md` }));
});

test("open mode: everyone may look inside the original", () => {
  for (const who of EVERYONE) {
    allowed(call(open, who, ...REA_CALL), `${who} REA`);
    allowed(call(open, who, ...GHIDRA), `${who} ghidra`);
    allowed(call(open, who, ...READ_ORIGINAL), `${who} read original`);
  }
  allowed(call(open, "remakecraft:builder", "Bash", { command: `strings ../calc.remake-room/original/calc.exe | head` }), "builder strings");
  allowed(call(open, "remakecraft:builder", "Grep", { pattern: "Percent", path: `${room}/original` }), "builder grep original");
});

test("open mode: sealed tests, evidence, the yardstick and the blocklist still hold", () => {
  for (const who of CLEAN_ROLES) {
    denied(call(open, who, "Read", { file_path: `${room}/sealed/t1.json` }), `${who} sealed`);
    denied(call(open, who, "Read", { file_path: `${room}/original/../sealed/t1.json` }), `${who} climbs out of original`);
    denied(call(open, who, "Bash", { command: `cat ${room}/original/../sealed/t1.json` }), `${who} shell climbs out`);
    denied(call(open, who, "Bash", { command: `ls ${room}/original && cat ${room}/hashes.json` }), `${who} original plus room`);
    denied(call(open, who, "Write", { file_path: `${room}/original/calc.exe` }), `${who} writes into original`);
  }
  denied(call(open, "remakecraft:builder", "Edit", { file_path: `${root}/tests/visible/a.json` }), "yardstick");
  denied(call(open, "remakecraft:test-writer", "Read", { file_path: `${room}/evidence/a.png` }), "test-writer evidence");
  for (const who of EVERYONE) denied(call(open, who, "WebFetch", { url: "https://github.com/x/jscalc" }), `${who} blocklist`);
  denied(call(open, undefined, "mcp__webpool__web_scrape", { url: "https://github.com/x/jscalc" }), "blocklist through MCP");
});

test("MCP hole: the clean side gets no MCP tool unless remake.json allows it", () => {
  const tools = ["mcp__webpool__web_scrape", "mcp__github__get_file_contents", "mcp__plugin_x_files__read", "ListMcpResourcesTool", "ReadMcpResourceTool"];
  for (const run of [clean, withRea, open]) {
    for (const who of [...CLEAN_ROLES, "general-purpose", "remakecraft:planner"]) {
      for (const tool of tools) denied(call(run, who, tool, { url: "https://example.com" }), `${run.mode}/${run.rea} ${who} ${tool}`);
    }
    // Room roles and the main session keep their MCP tools.
    for (const who of [undefined, ...ROOM_ROLES]) allowed(call(run, who, "mcp__webpool__web_scrape", { url: "https://example.com/manual" }), `${who}`);
  }
  assert.match(call(clean, "remakecraft:builder", "mcp__webpool__web_scrape", {}).reason, /mcpAllow/);
});

test("MCP hole: the allowlist opens exact tools and whole servers, nothing more", () => {
  const run = { ...clean, mcpAllow: ["mcp__context7__query-docs", "mcp__docs__*"] };
  allowed(call(run, "remakecraft:builder", "mcp__context7__query-docs", { query: "egui button" }));
  allowed(call(run, "remakecraft:builder", "mcp__docs__search", { q: "egui" }));
  denied(call(run, "remakecraft:builder", "mcp__context7__resolve-library-id", {}));
  denied(call(run, "remakecraft:builder", "mcp__docsx__search", {}));
  denied(call(run, "remakecraft:builder", "ReadMcpResourceTool", { server: "docs", uri: "x" }), "resource tools stay closed");
  // An allowed tool still may not carry the room to the clean side.
  denied(call(run, "remakecraft:builder", "mcp__docs__search", { q: `${room}/sealed/t1.json` }));
  denied(call(run, "remakecraft:builder", "mcp__docs__search", { opts: { path: `${room}/evidence` } }), "nested input");
  // The allowlist never opens REA.
  denied(call({ ...clean, mcpAllow: ["mcp__rea__*"] }, "remakecraft:builder", ...REA_CALL));
});

test("open mode: original/ is exempt only for paths that stay inside it", () => {
  const b = "remakecraft:builder";
  // The reviewer's repros: the cd or the quote hid the climb out of original/.
  denied(call(open, b, "Bash", { command: `cd ${room}/original && cat ../sea"l"ed/t.test.js` }), "cd then ../sealed");
  denied(call(open, b, "Bash", { command: `cd ${room}/original && cat ../inventory.json` }), "cd then ../inventory");
  denied(call(open, b, "Bash", { command: `cat "${room}/original"/../inventory.json` }), "quote ends the .. lookahead");
  denied(call(open, b, "Bash", { command: `cat ${room}/original/.\\./inventory.json` }), "escaped dot");
  denied(call(open, b, "Bash", { command: `ln -s ${room}/original o && cat o/../inventory.json` }), "symlink");
  denied(call(open, b, "Bash", { command: `cp -r ${room}/original ./o` }), "cp never exempt");
  denied(call(open, b, "PowerShell", { command: `New-Item -ItemType SymbolicLink -Path o -Target ${room}/original` }), "new-item never exempt");
  // Normal use of original/ stays open.
  allowed(call(open, b, "Bash", { command: `cat ${room}/original/app.js` }));
  allowed(call(open, b, "Bash", { command: `cd ${room}/original && ./app` }));
  allowed(call(open, b, "Bash", { command: `grep -r x ${room}/original/src` }));
  allowed(call(open, b, "Bash", { command: `cargo build` }));
});
