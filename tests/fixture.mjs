// A tiny but complete run: two features, seven tests (two sealed), a fake
// stack whose runner emits JUnit for the visible suite and TAP for the sealed
// one, and an app that is half right on purpose.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, tempDir, write } from "./helpers.mjs";

const RUNNER = `node "{plugin}/tests/fixtures/fake-runner.mjs"`;

export const SPEC = {
  app: "Calc",
  version: 1,
  features: [
    { id: "calc.add", inventory: ["op.add"], layer: "behaviour", priority: "must", summary: "adds", acceptance: ["add(2,3) is 5"] },
    { id: "calc.mul", inventory: ["op.mul", "key.star"], layer: "pixel", priority: "should", summary: "multiplies", acceptance: ["mul(2,3) is 6"] },
  ],
};
export const INVENTORY = { app: "Calc", items: [{ id: "op.add" }, { id: "op.mul" }, { id: "key.star" }] };

export const VISIBLE = [
  { id: "add.small", fn: "add", args: [2, 3], expect: 5, feature: "calc.add" },
  { id: "add.neg", fn: "add", args: [2, -3], expect: -1, feature: "calc.add" },
  { id: "mul.two", fn: "mul", args: [2, 2], expect: 4, feature: "calc.mul" },
  { id: "mul.three", fn: "mul", args: [3, 3], expect: 9, feature: "calc.mul" },
  { id: "mul.zero", fn: "mul", args: [0, 5], expect: 0, feature: "calc.mul" },
];
export const SEALED = [
  { id: "add.big", fn: "add", args: [1000, 2000], expect: 3000, feature: "calc.add" },
  { id: "mul.seven", fn: "mul", args: [7, 7], expect: 49, feature: "calc.mul" },
];

// add drops the sign of b (fails add.neg); mul is a lookup table that only
// knows the visible inputs (passes every visible mul test, fails the sealed one).
export const APP_SOURCE = `export function add(a, b) {
  return a + Math.abs(b);
}

const TABLE = { "2,2": 4, "3,3": 9, "0,5": 0 };
export function mul(a, b) {
  return TABLE[a + "," + b] ?? -1;
}
`;

export function manifestOf(visible = VISIBLE, sealed = SEALED) {
  return {
    version: 1,
    tests: [
      ...visible.map((c) => ({ id: c.id, feature: c.feature, set: "visible", file: `${c.id}.json` })),
      ...sealed.map((c) => ({ id: c.id, feature: c.feature, set: "sealed", file: `${c.id}.json` })),
    ],
  };
}

/** Creates a run with the fake stack. Returns paths and a publish helper. */
export function makeRun(t, { inventory = true, cases = true } = {}) {
  const out = tempDir(t, "rc-run");
  const r = cli("init-run.mjs", ["Calc", "--out", out, "--stack", "web"]);
  if (r.code !== 0) throw new Error(`init-run failed: ${r.err}`);
  const root = path.join(out, "Calc");
  const room = path.join(out, "Calc.remake-room");

  const cfgFile = path.join(root, "remake.json");
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  cfg.commands = { build: "", testVisible: `${RUNNER} {suite} "{tests}" "{report}"`, testSealed: `${RUNNER} {suite} "{tests}" "{report}"` };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
  gitIn(root, "commit", "-qam", "chore: fake stack");

  write(path.join(room, "spec", "spec.json"), SPEC);
  write(path.join(room, "spec", "spec.md"), "# Calc\n\n## calc.add\n\n## calc.mul\n");
  if (inventory) write(path.join(room, "inventory.json"), INVENTORY);
  if (cases) {
    const strip = ({ feature, ...c }) => c;
    for (const c of VISIBLE) write(path.join(room, "tests", "visible", `${c.id}.json`), strip(c));
    for (const c of SEALED) write(path.join(room, "sealed", `${c.id}.json`), strip(c));
    write(path.join(room, "tests", "manifest.json"), manifestOf());
  }

  return { out, root, room, cfgFile };
}

/** Publishes spec and tests, then commits the half-right app. */
export function publishAndBuild(run) {
  for (const what of ["spec", "tests"]) {
    const r = cli("publish.mjs", [what, "--app", run.root]);
    if (r.code !== 0) throw new Error(`publish ${what} failed: ${r.err}`);
  }
  write(path.join(run.root, "src", "calc.mjs"), APP_SOURCE);
  gitIn(run.root, "add", "src");
  gitIn(run.root, "commit", "-qm", "feat: calc");
}
