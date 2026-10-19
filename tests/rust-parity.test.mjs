// The rust-egui stack end to end with the real toolchain: init-run, publish,
// then parity.mjs runs cargo build and both suites through
// scripts/runners/nextest.mjs and scores the JUnit it writes. The other parity
// tests use a fake runner; this one proves the route Daub depends on. Skipped
// when cargo-nextest is not installed (cargo install cargo-nextest --locked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, tempDir, write } from "./helpers.mjs";

const nextest = spawnSync("cargo", ["nextest", "--version"], { encoding: "utf8", windowsHide: true });
const skip = nextest.error || nextest.status !== 0 ? "cargo-nextest is not installed" : false;

const SPEC = {
  app: "adder",
  version: 1,
  features: [
    { id: "calc.add", layer: "behaviour", priority: "must", acceptance: ["add(2, -3) is -1"] },
    { id: "calc.mul", layer: "format", priority: "should", acceptance: ["mul(7, 7) is 49"] },
  ],
};
const VISIBLE_RS = `mod add {
    #[test] fn small() { assert_eq!(adder::add(2, 3), 5); }
    #[test] fn neg() { assert_eq!(adder::add(2, -3), -1); }
}
mod mul {
    #[test] fn two() { assert_eq!(adder::mul(2, 2), 4); }
    #[test] fn three() { assert_eq!(adder::mul(3, 3), 9); }
}
`;
const SEALED_RS = `mod add { #[test] fn big() { assert_eq!(adder::add(1000, 2000), 3000); } }
mod mul { #[test] fn seven() { assert_eq!(adder::mul(7, 7), 49); } }
`;
const SEALED_IDS = ["add.big", "mul.seven"];
// add drops the sign of b (fails add.neg); mul is a lookup table that knows only the visible inputs.
const LIB_RS = `pub fn add(a: i64, b: i64) -> i64 {
    a + b.abs()
}

pub fn mul(a: i64, b: i64) -> i64 {
    match (a, b) {
        (2, 2) => 4,
        (3, 3) => 9,
        _ => -1,
    }
}
`;

test("rust-egui: cargo build and nextest JUnit score both suites", { skip, timeout: 600_000 }, (t) => {
  const out = tempDir(t, "rc-rust");
  const init = cli("init-run.mjs", ["adder", "--out", out, "--stack", "rust-egui", "--cheap"]);
  assert.equal(init.code, 0, init.err);
  const root = path.join(out, "adder");
  const room = path.join(out, "adder.remake-room");

  write(path.join(room, "spec", "spec.json"), SPEC);
  write(path.join(room, "spec", "spec.md"), "# adder\n");
  write(path.join(room, "tests", "visible", "main.rs"), VISIBLE_RS);
  write(path.join(room, "sealed", "main.rs"), SEALED_RS);
  const entry = (id, feature, set) => ({ id, feature, set, file: "main.rs" });
  write(path.join(room, "tests", "manifest.json"), {
    version: 1,
    tests: [
      entry("add.small", "calc.add", "visible"), entry("add.neg", "calc.add", "visible"),
      entry("mul.two", "calc.mul", "visible"), entry("mul.three", "calc.mul", "visible"),
      entry("add.big", "calc.add", "sealed"), entry("mul.seven", "calc.mul", "sealed"),
    ],
  });
  for (const what of ["spec", "tests"]) {
    const r = cli("publish.mjs", [what], root);
    assert.equal(r.code, 0, r.err);
  }

  write(path.join(root, "Cargo.toml"), '[package]\nname = "adder"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n');
  write(path.join(root, "src", "lib.rs"), LIB_RS);
  gitIn(root, "add", "Cargo.toml", "src");
  gitIn(root, "commit", "-qm", "feat: adder");

  const r = cli("parity.mjs", [], root);
  assert.equal(r.code, 0, r.err + r.out);
  const p = JSON.parse(readFileSync(path.join(root, ".remake", "reports", "parity.json"), "utf8"));
  assert.deepEqual(p.build, { ran: true, ok: true, exitCode: 0, error: null });
  assert.equal(p.suites.visible.format, "junit");
  assert.equal(p.suites.sealed.format, "junit");
  assert.equal(p.suites.visible.unmatched, 0, "nextest's mod::fn names map onto the manifest ids");
  assert.equal(p.suites.sealed.unmatched, 0);
  assert.deepEqual(p.score, {
    overall: 66.6, passed: 4, total: 6,
    visible: { passed: 3, total: 4, rate: 75 }, sealed: { passed: 1, total: 2, rate: 50 },
  });
  assert.deepEqual(p.overfit, ["calc.mul"]);
  assert.equal(p.visibleFailures.length, 1);
  assert.equal(p.visibleFailures[0].test, "add.neg");
  assert.match(p.visibleFailures[0].message, /panicked at .*main\.rs:3:\d+: assertion `left == right` failed; left: 5; right: -1/);

  // The holdout leaves the harness as counts only.
  const visibleLog = readFileSync(path.join(root, ".remake", "reports", "visible-output.log"), "utf8");
  for (const text of [JSON.stringify(p), r.out, visibleLog])
    for (const id of SEALED_IDS) assert.ok(!text.includes(id) && !text.includes(id.replace(".", "::")), `sealed test ${id} leaked`);
});
