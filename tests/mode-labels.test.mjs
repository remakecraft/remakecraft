// Every report names the run's mode, and open mode is never called clean-room.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, write } from "./helpers.mjs";
import { INVENTORY, makeRun, publishAndBuild } from "./fixture.mjs";
import { locateRun, modeInfo, modeLabel } from "../scripts/lib/run.mjs";
import { buildState } from "../scripts/lib/state.mjs";

function runIn(t, mode) {
  const run = makeRun(t);
  const cfg = { ...JSON.parse(readFileSync(run.cfgFile, "utf8")), ...mode };
  writeFileSync(run.cfgFile, JSON.stringify(cfg, null, 2) + "\n");
  if (Object.keys(mode).length) gitIn(run.root, "commit", "-qam", "chore: mode");
  write(path.join(run.room, "inventory.json"), { ...INVENTORY, items: INVENTORY.items.map((it, i) => ({ ...it, source: i ? "watched" : "rea" })) });
  return run;
}

test("modeLabel and modeInfo", () => {
  assert.equal(modeLabel({}), "clean-room");
  assert.equal(modeLabel({ rea: true }), "clean-room, observer uses REA");
  assert.equal(modeLabel({ mode: "open", rea: true }), "open mode: not clean-room");
  assert.deepEqual(modeInfo({ rea: true, basis: "own" }, { items: [{ source: "rea" }, { source: "watched" }, {}] }),
    { mode: "clean", rea: true, basis: "own", label: "clean-room, observer uses REA", reaItems: 1 });
  assert.deepEqual(modeInfo({}), { mode: "clean", rea: false, basis: null, label: "clean-room", reaItems: 0 });
});

for (const [name, mode, line] of [
  ["clean", {}, /^Mode: clean-room$/m],
  ["--with-rea", { rea: true, basis: "own" }, /^Mode: clean-room, observer uses REA \(1 inventory item from REA\)$/m],
  ["open", { mode: "open", basis: "authorized" }, /^Mode: open mode: not clean-room$/m],
]) {
  test(`parity.json, the summary and the run page state carry the ${name} mode`, (t) => {
    const run = runIn(t, mode);
    publishAndBuild(run);
    const r = cli("parity.mjs", [], run.root);
    assert.match(r.out, line);
    const p = JSON.parse(readFileSync(path.join(run.root, ".remake", "reports", "parity.json"), "utf8"));
    assert.equal(p.mode.label, modeLabel(mode));
    assert.equal(p.mode.basis, mode.basis ?? null);
    const s = buildState(locateRun(run.root));
    assert.deepEqual(s.app.mode, p.mode);
  });
}

test("the run page shows open mode as not clean-room", () => {
  const html = readFileSync(new URL("../ui/run-page.html", import.meta.url), "utf8");
  assert.match(html, /m\.mode === 'open' \? `<span class="ofchip"/);
});
