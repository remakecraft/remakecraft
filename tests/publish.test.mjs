import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, write } from "./helpers.mjs";
import { INVENTORY, SPEC, makeRun, manifestOf, VISIBLE, SEALED } from "./fixture.mjs";
import { validateSpec, validateTests } from "../scripts/publish.mjs";

const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const clone = (x) => structuredClone(x);

test("publish spec copies the spec, seeds features.json and commits", (t) => {
  const run = makeRun(t);
  const r = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /2 features \(must 1, should 1, could 0\)/);
  assert.deepEqual(json(path.join(run.root, "spec", "spec.json")), SPEC);
  assert.ok(existsSync(path.join(run.root, "spec", "spec.md")));
  assert.deepEqual(json(path.join(run.root, ".remake", "progress", "features.json")), [
    { id: "calc.add", priority: "must", layer: "behaviour", status: "pending" },
    { id: "calc.mul", priority: "should", layer: "pixel", status: "pending" },
  ]);
  assert.equal(gitIn(run.root, "log", "-1", "--format=%s"), "spec: publish v1");

  const again = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /nothing to commit/);
});

test("publish finds the run from inside the app tree", (t) => {
  const run = makeRun(t);
  write(path.join(run.root, "src", "deep", "x.txt"), "");
  const r = cli("publish.mjs", ["spec"], path.join(run.root, "src", "deep"));
  assert.equal(r.code, 0, r.err);
});

test("publish tests copies visible tests, hashes both sets and commits", (t) => {
  const run = makeRun(t);
  assert.equal(cli("publish.mjs", ["spec", "--app", run.root]).code, 0);
  const r = cli("publish.mjs", ["tests", "--app", run.root]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /5 visible tests; 2 sealed/);
  assert.doesNotMatch(r.out, /Warning/, "2 of 7 sealed is inside 20-40%");
  for (const c of VISIBLE) assert.ok(existsSync(path.join(run.root, "tests", "visible", `${c.id}.json`)));
  assert.ok(!existsSync(path.join(run.root, "tests", "sealed")), "sealed tests never enter the app tree");

  const hashes = json(path.join(run.room, "hashes.json"));
  assert.deepEqual(Object.keys(hashes.app).sort(), ["spec/spec.json", "spec/spec.md", ...VISIBLE.map((c) => `tests/visible/${c.id}.json`)].sort());
  assert.deepEqual(Object.keys(hashes.room).sort(), SEALED.map((c) => `sealed/${c.id}.json`).sort());
  assert.match(gitIn(run.root, "log", "-1", "--format=%s"), /^tests: publish 5 visible tests$/);
});

test("publish tests needs the spec published, and unchanged since", (t) => {
  const run = makeRun(t);
  const early = cli("publish.mjs", ["tests", "--app", run.root]);
  assert.equal(early.code, 1);
  assert.match(early.err, /not published yet/);

  assert.equal(cli("publish.mjs", ["spec", "--app", run.root]).code, 0);
  write(path.join(run.room, "spec", "spec.json"), { ...SPEC, version: 2 });
  const stale = cli("publish.mjs", ["tests", "--app", run.root]);
  assert.equal(stale.code, 1);
  assert.match(stale.err, /changed after it was published/);
});

test("publish rejects bad usage and runs it cannot find", (t) => {
  const run = makeRun(t);
  assert.equal(cli("publish.mjs", ["code", "--app", run.root]).code, 2);
  const lost = cli("publish.mjs", ["spec"], run.out);
  assert.equal(lost.code, 1);
  assert.match(lost.err, /Not inside a Remakecraft run/);
});

test("validateSpec catches shape errors", () => {
  const bad = clone(SPEC);
  bad.features.push({ ...clone(SPEC.features[0]) }); // duplicate id
  bad.features[1].layer = "vibes";
  bad.features[1].priority = "maybe";
  bad.features[1].acceptance = [];
  bad.features.push({ id: "Bad Id", layer: "ui", priority: "could", acceptance: ["x"] });
  assert.throws(() => validateSpec(bad), (err) =>
    /duplicate id/.test(err.message) && /"layer" must be/.test(err.message) && /"priority" must be/.test(err.message)
    && /"acceptance" must be/.test(err.message) && /lowercase and dotted/.test(err.message));
  assert.throws(() => validateSpec({ version: 1, features: [] }), /non-empty array/);
  assert.throws(() => validateSpec({ features: SPEC.features }), /"version"/);
});

test("validateSpec holds the spec to the inventory: exactly one feature per id", () => {
  assert.equal(validateSpec(SPEC, INVENTORY), SPEC);

  const uncovered = { items: [...INVENTORY.items, { id: "menu.file.open" }] };
  assert.throws(() => validateSpec(SPEC, uncovered), /covered by no feature: menu\.file\.open/);

  const doubled = clone(SPEC);
  doubled.features[0].inventory.push("key.star");
  assert.throws(() => validateSpec(doubled, INVENTORY), /"key\.star" is covered by 2 features/);

  const unknown = clone(SPEC);
  unknown.features[0].inventory.push("op.sqrt");
  assert.throws(() => validateSpec(unknown, INVENTORY), /"op\.sqrt", which is not in inventory\.json/);
});

test("publish spec fails on an uncovered inventory id and publishes nothing", (t) => {
  const run = makeRun(t);
  write(path.join(run.room, "inventory.json"), { items: [...INVENTORY.items, { id: "op.div" }] });
  const r = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(r.code, 1);
  assert.match(r.err, /op\.div/);
  assert.ok(!existsSync(path.join(run.root, "spec")));
});

test("validateTests needs a visible and a sealed test per feature", () => {
  const onlyVisible = manifestOf(VISIBLE, SEALED.filter((c) => c.feature !== "calc.mul"));
  assert.throws(() => validateTests(onlyVisible, SPEC), /feature "calc\.mul" has no sealed test/);

  const orphan = manifestOf();
  orphan.tests.push({ id: "x", feature: "calc.div", set: "visible" }, { id: "x", feature: "calc.add", set: "hidden" });
  assert.throws(() => validateTests(orphan, SPEC), (err) =>
    /"calc\.div" is not in the spec/.test(err.message) && /duplicate id/.test(err.message) && /"set" must be/.test(err.message));
});

test("validateTests warns when the sealed share leaves 20-40%", () => {
  assert.deepEqual(validateTests(manifestOf(), SPEC).warnings, []);
  assert.deepEqual(validateTests(manifestOf(VISIBLE.slice(0, 3), SEALED), SPEC).warnings, [], "40% is the edge, still fine");
  const tooMany = manifestOf([VISIBLE[0], VISIBLE[2]], SEALED);
  assert.match(validateTests(tooMany, SPEC).warnings[0], /sealed share is 50% \(2 of 4\)/);
});

test("validateTests checks declared files exist on the right side", (t) => {
  const run = makeRun(t);
  const m = manifestOf();
  m.tests[0].file = "nope.json";
  assert.throws(() => validateTests(m, SPEC, { visibleDir: path.join(run.room, "tests", "visible"), sealedDir: path.join(run.room, "sealed") }), /"nope\.json" is not in the room's tests\/visible/);
});

test("withheld text from the inventory blocks the spec, even in a non-goal", () => {
  const inv = { ...INVENTORY, withheld: [{ text: "flushState", why: "internal function name" }, { text: "hist", why: "internal array" }, "Count on it."] };
  assert.equal(validateSpec(SPEC, inv), SPEC);
  const md = "# calc\n\nUndo history is kept.\n";
  assert.equal(validateSpec(SPEC, inv, [["spec.json", JSON.stringify(SPEC)], ["spec.md", md]]), SPEC, "history is not hist");
  const leaky = [["spec.json", JSON.stringify(SPEC)], ["spec.md", "Non-goals: reproducing internal names (hist, flushState); the tagline 'count on it.'"]];
  assert.throws(() => validateSpec(SPEC, inv, leaky), (err) =>
    /spec\.md: "flushState" \(internal function name\)/.test(err.message) && /spec\.md: "hist"/.test(err.message) && /"Count on it\."/.test(err.message));
  assert.throws(() => validateSpec(SPEC, { ...INVENTORY, withheld: "flushState" }), /"withheld" must be a list/);
  assert.throws(() => validateSpec(SPEC, { ...INVENTORY, withheld: [{ text: "x" }] }), /at least 2 characters/);
});

test("publish refuses withheld text in spec.md, and in the tests", (t) => {
  const run = makeRun(t);
  write(path.join(run.room, "inventory.json"), { ...INVENTORY, withheld: [{ text: "TABLE", why: "internal name" }] });
  write(path.join(run.room, "spec", "spec.md"), "# Calc\n\nNever copy the original's TABLE.\n");
  const r = cli("publish.mjs", ["spec", "--app", run.root]);
  assert.equal(r.code, 1);
  assert.match(r.err, /withheld text in spec\.md: "TABLE" \(internal name\)/);
  assert.ok(!existsSync(path.join(run.root, "spec")));

  write(path.join(run.room, "spec", "spec.md"), "# Calc\n");
  assert.equal(cli("publish.mjs", ["spec", "--app", run.root]).code, 0);
  write(path.join(run.room, "sealed", "add.big.json"), { fn: "add", args: [1000, 2000], expect: 3000, note: "TABLE" });
  const tr = cli("publish.mjs", ["tests", "--app", run.root]);
  assert.equal(tr.code, 1);
  assert.match(tr.err, /withheld text:\n  - sealed\/add\.big\.json: "TABLE"/);
  assert.ok(!existsSync(path.join(run.root, "tests", "visible")));
});
