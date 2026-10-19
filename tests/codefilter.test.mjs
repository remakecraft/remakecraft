// The code filter for runs started --with-rea: the observer read the
// original's code, so the spec and the visible tests are checked for it before
// they cross. Clean and open runs publish exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cli, write } from "./helpers.mjs";
import { INVENTORY, SPEC, makeRun } from "./fixture.mjs";
import { reaNames, scanDocs } from "../scripts/lib/codefilter.mjs";
import { validateSpec } from "../scripts/publish.mjs";

const spec = (line) => scanDocs([["spec.md", line]], { prose: true });
const visible = (line) => scanDocs([["tests/visible/a.test.mjs", line]]);

test("behaviour in plain words passes", () => {
  for (const line of [
    "% after + takes that percent of the first number",
    "The display shows 1,234.5 after 12345 / 10",
    "result == 5 after add(2,3)",
    "A double click (left button) opens the file, or PC, then saves",
    "Fill colour is #ff00ff at (3,4), inclusive",
    "Ctrl+C copies; Esc clears",
  ]) assert.deepEqual(spec(line), [], line);
});

test("addresses, disassembly and decompiled C are stopped", () => {
  assert.deepEqual(spec("0x180124945: MOV EAX, dword ptr [R13 + 0x18]"), ["spec.md:1: hex-address"]);
  assert.deepEqual(spec("MOV EAX, dword ptr [R13 + 0x18]"), ["spec.md:1: assembly"]);
  assert.deepEqual(spec("if (operation == multiply || operation == divide) {"), ["spec.md:1: c-like"]);
  for (const line of ["mov eax, ebx", "ldr x0, [x1, #8]", "sub_401000 handles percent", "FUN_00401a20 rounds", ".text:00401000 entry", "uint32_t total = 0;", "engine->applyPercent(x)"])
    assert.equal(spec(line).length, 1, line);
});

test("visible tests are code, so only the code-from-the-binary rules apply", () => {
  assert.deepEqual(visible("if (a == b && c) { assert.equal(add(2, 3), 5); }"), []);
  assert.deepEqual(visible("// 0x180124945: MOV EAX, dword ptr [R13 + 0x18]"), ["tests/visible/a.test.mjs:1: hex-address"]);
  assert.deepEqual(visible("const x = 1;\n// sub_401000\n"), ["tests/visible/a.test.mjs:2: decompiler-name"]);
});

test("JSON is scanned by its string values, line by line", () => {
  const json = JSON.stringify({ features: [{ acceptance: ["add(2,3) is 5", "calls sub_4010f0 first"] }] }, null, 2);
  assert.deepEqual(scanDocs([["spec.json", json]], { prose: true }), [`spec.json:${json.split("\n").findIndex((l) => l.includes("sub_")) + 1}: decompiler-name`]);
});

test("REA names that read as code are stopped, plain words and inventory titles are not", (t) => {
  const { room } = makeRun(t);
  write(path.join(room, "evidence", "rea", "symbols.json"), {
    symbols: ["CalcEngine::applyPercent", "g_lastOperand", "multiply", "Percent", { name: "DisplayBuffer" }],
    functions: [{ name: "HandleKeyPress", address: "0x140001000" }],
    strings: ["MemoryRecall"],
  });
  const names = reaNames(room, { items: [{ id: "key.mr", title: "MemoryRecall" }] });
  assert.deepEqual(names.sort(), ["CalcEngine::applyPercent", "DisplayBuffer", "HandleKeyPress", "g_lastOperand"]);
  const hits = scanDocs([["spec.md", "Pressing % multiplies.\nThe g_lastOperand is reused.\nMemoryRecall shows it."]], { prose: true, reaNames: names });
  assert.deepEqual(hits, ['spec.md:2: REA name "g_lastOperand"']);
});

test("unreadable REA evidence stops the filter rather than letting everything through", (t) => {
  const { room } = makeRun(t);
  write(path.join(room, "evidence", "rea", "broken.json"), "{ nope");
  assert.throws(() => reaNames(room), /broken\.json is not valid JSON/);
});

test("source is watched or rea on inventory items and features", () => {
  validateSpec({ ...SPEC, features: SPEC.features.map((f) => ({ ...f, source: "rea" })) }, { items: INVENTORY.items.map((it) => ({ ...it, source: "watched" })) });
  assert.throws(() => validateSpec({ ...SPEC, features: [{ ...SPEC.features[0], source: "ghidra" }, SPEC.features[1]] }, INVENTORY), /"source" must be one of watched, rea/);
  assert.throws(() => validateSpec(SPEC, { items: [{ id: "op.add", source: "decompiled" }, { id: "op.mul" }, { id: "key.star" }] }), /inventory item "op\.add": "source"/);
});

function reaRun(t, cfg = { rea: true, basis: "own" }) {
  const run = makeRun(t);
  const manifest = { ...JSON.parse(readFileSync(run.cfgFile, "utf8")), ...cfg };
  writeFileSync(run.cfgFile, JSON.stringify(manifest, null, 2) + "\n");
  write(path.join(run.room, "inventory.json"), { ...INVENTORY, items: INVENTORY.items.map((it) => ({ ...it, source: "watched" })) });
  return run;
}

const LEAK = "# Calc\n\n## calc.add\n\nif (operation == multiply || operation == divide) {\n\n## calc.mul\n";

test("--with-rea: publish spec refuses code with exit 9 and file:line", (t) => {
  const run = reaRun(t);
  write(path.join(run.room, "spec", "spec.md"), LEAK);
  const r = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(r.code, 9, r.err);
  assert.match(r.err, /started --with-rea/);
  assert.match(r.err, /spec\.md:5: c-like/);
  write(path.join(run.room, "spec", "spec.md"), "# Calc\n\n## calc.add\n\n% after + takes that percent of the first number\n\n## calc.mul\n");
  const ok = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(ok.code, 0, ok.err);
});

test("--with-rea: every inventory item must say where it came from", (t) => {
  const run = reaRun(t);
  write(path.join(run.room, "inventory.json"), INVENTORY);
  const r = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(r.code, 1);
  assert.match(r.err, /needs "source".*op\.add, op\.mul, key\.star/);
});

test("--with-rea: publish tests refuses code in visible tests, never reads the sealed ones", (t) => {
  const run = reaRun(t);
  assert.equal(cli("publish.mjs", ["spec", "--app", run.root]).code, 0);
  write(path.join(run.room, "sealed", "add.big.json"), { id: "add.big", note: "0x180124945: MOV EAX, dword ptr [R13 + 0x18]", fn: "add", args: [1000, 2000], expect: 3000 });
  const sealedOnly = cli("publish.mjs", ["tests", "--app", run.root]);
  assert.equal(sealedOnly.code, 0, sealedOnly.err);
  write(path.join(run.room, "tests", "visible", "add.small.json"), { id: "add.small", note: "see sub_401000", fn: "add", args: [2, 3], expect: 5 });
  const r = cli("publish.mjs", ["tests", "--app", run.root]);
  assert.equal(r.code, 9);
  assert.match(r.err, /tests\/visible\/add\.small\.json:3: decompiler-name/);
});

for (const [name, cfg] of [["clean", {}], ["open", { mode: "open", basis: "own" }]]) {
  test(`${name} runs publish without the code filter`, (t) => {
    const run = reaRun(t, cfg);
    write(path.join(run.room, "spec", "spec.md"), LEAK);
    const r = cli("publish.mjs", ["spec", "--app", run.root]);
    assert.equal(r.code, 0, r.err);
  });
}
