#!/usr/bin/env node
// The parity harness. The verifier runs it from the app tree; it is the only
// thing that ever runs the sealed tests. Agents' claims about passing tests are
// ignored: this script checks the yardstick is untouched, runs both suites in
// a scratch checkout of HEAD, scans for stubs and writes the score.
//
//   node scripts/parity.mjs [--app <app tree>] [--timeout <minutes per command>]
//
// Exit codes: 0 ok, 3 spec or tests changed (since publish, or by the build or
// the test run in the scratch checkout), 4 stub hits, 1 any other error.
// Sealed results leave this script as counts per feature only: no test names,
// no assertion text, no output. Anything more would leak the holdout into the
// next build round.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LAYERS, PLUGIN_ROOT, RunError, copyDir, git, hashTree, isMain, locateRun, main, modeInfo, parseArgs, readJson, toSlash, writeJson,
} from "./lib/run.mjs";
import { matchResults, parseResults } from "./lib/results.mjs";
import { scanStubs } from "./lib/stubs.mjs";

const EXIT = { ok: 0, error: 1, hashes: 3, stubs: 4 };
const OVERFIT_POINTS = 15;
const MAX_OUTPUT = 64 * 1024 * 1024;

// Never round a score up: one decimal, floored.
const pct = (passed, total) => (total ? Math.floor((passed / total) * 1000) / 10 : null);
const rate = (passed, total) => ({ passed, total, rate: pct(passed, total) });

/** Compares recorded hashes with current ones. Returns [{path, change}]. */
function diffHashes(recorded, current, prefixes) {
  const out = [];
  const inScope = (k) => prefixes.some((p) => k.startsWith(p));
  for (const [k, h] of Object.entries(recorded)) {
    if (!inScope(k)) continue;
    if (!(k in current)) out.push({ path: k, change: "missing" });
    else if (current[k] !== h) out.push({ path: k, change: "changed" });
  }
  for (const k of Object.keys(current)) if (inScope(k) && !(k in recorded)) out.push({ path: k, change: "added" });
  return out;
}

function fill(command, values) {
  return command.replace(/\{(tests|report|suite|plugin)\}/g, (_, k) => {
    const v = values[k];
    if (v === undefined) throw new RunError(`Command uses {${k}}, which has no value here: ${command}`);
    if (v.includes('"')) throw new RunError(`Path for {${k}} contains a double quote, which no shell can pass safely: ${v}`);
    return v;
  });
}

// When parity itself runs under node --test, NODE_TEST_CONTEXT would make a
// node --test suite report to that parent instead of writing {report}.
const suiteEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT"));

function runCommand(command, cwd, timeoutMs) {
  const r = spawnSync(command, { cwd, env: suiteEnv(), shell: true, encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT });
  const output = `$ ${command}\n${r.stdout || ""}${r.stderr || ""}`;
  if (r.error?.code === "ETIMEDOUT") return { status: null, output, error: `timed out after ${timeoutMs / 60000} min` };
  if (r.error) return { status: null, output, error: `could not start: ${r.error.message}` };
  return { status: r.status, output, error: null };
}

function scratchCheckout(root) {
  const base = mkdtempSync(path.join(os.tmpdir(), "remake-parity-"));
  const dir = path.join(base, "checkout");
  git(root, ["worktree", "add", "--detach", "-q", dir, "HEAD"]);
  const cleanup = () => {
    git(root, ["worktree", "remove", "--force", dir], { allowFail: true });
    rmSync(base, { recursive: true, force: true, maxRetries: 3 });
    git(root, ["worktree", "prune"], { allowFail: true });
  };
  return { base, dir, cleanup };
}

/** Runs one suite and maps its results onto the manifest ids. */
function runSuite(suite, ctx) {
  const { manifest, scratch, timeoutMs, logFile } = ctx;
  const ids = manifest.tests.filter((t) => t.set === suite).map((t) => t.id);
  const report = path.join(scratch.base, "results", `${suite}.report`);
  mkdirSync(path.dirname(report), { recursive: true });
  const cmd = fill(ctx.commands[suite === "visible" ? "testVisible" : "testSealed"], {
    tests: toSlash(path.join(scratch.dir, "tests", suite)),
    report: toSlash(report),
    suite,
    plugin: toSlash(PLUGIN_ROOT),
  });
  const r = runCommand(cmd, scratch.dir, timeoutMs);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, r.output);

  let parsed = null;
  let error = r.error;
  if (!error) {
    if (!existsSync(report)) error = `the command exited ${r.status} without writing {report}`;
    else {
      try { parsed = parseResults(readFileSync(report, "utf8")); } catch (err) { error = `unreadable results: ${err.message}`; }
    }
  }
  if (!parsed) return { ok: false, exitCode: r.status, error, byId: new Map(ids.map((id) => [id, { status: "not-run", message: error }])), unmatched: 0 };
  const { byId, unmatched } = matchResults(ids, parsed.results);
  return { ok: true, exitCode: r.status, format: parsed.format, results: parsed.results.length, byId, unmatched };
}

function score(spec, manifest, outcome) {
  const features = new Map(spec.features.map((f) => [f.id, f]));
  const layers = Object.fromEntries(LAYERS.map((l) => [l, { visible: [0, 0], sealed: [0, 0] }]));
  const perFeature = new Map(spec.features.map((f) => [f.id, { visible: [0, 0], sealed: [0, 0] }]));
  const visibleFailures = [];
  for (const t of manifest.tests) {
    const res = outcome[t.set].get(t.id);
    const pass = res?.status === "pass" ? 1 : 0;
    const layer = t.layer ?? features.get(t.feature)?.layer;
    for (const bucket of [layers[layer]?.[t.set], perFeature.get(t.feature)?.[t.set]]) {
      if (!bucket) continue;
      bucket[0] += pass;
      bucket[1] += 1;
    }
    if (!pass && t.set === "visible") visibleFailures.push({ test: t.id, feature: t.feature, status: res?.status ?? "missing", message: res?.message ?? "" });
  }
  const sum = (set) => [...perFeature.values()].reduce((a, f) => [a[0] + f[set][0], a[1] + f[set][1]], [0, 0]);
  const [vp, vt] = sum("visible");
  const [sp, st] = sum("sealed");
  const feats = spec.features.map((f) => {
    const c = perFeature.get(f.id);
    const visible = rate(...c.visible);
    const sealed = rate(...c.sealed);
    const overfit = visible.rate !== null && sealed.rate !== null && visible.rate - sealed.rate > OVERFIT_POINTS;
    return { id: f.id, layer: f.layer, priority: f.priority, visible, sealed, overall: pct(c.visible[0] + c.sealed[0], c.visible[1] + c.sealed[1]), overfit };
  });
  return {
    score: { overall: pct(vp + sp, vt + st), passed: vp + sp, total: vt + st, visible: rate(vp, vt), sealed: rate(sp, st) },
    layers: Object.fromEntries(LAYERS.map((l) => {
      const { visible: v, sealed: s } = layers[l];
      return [l, { visible: rate(...v), sealed: rate(...s), overall: pct(v[0] + s[0], v[1] + s[1]), total: v[1] + s[1] }];
    })),
    features: feats,
    overfit: feats.filter((f) => f.overfit).map((f) => f.id),
    visibleFailures,
  };
}

function updateFeatures(root, feats, at) {
  const file = path.join(root, ".remake", "progress", "features.json");
  const list = existsSync(file) ? readJson(file) : [];
  const byId = new Map(feats.map((f) => [f.id, f]));
  writeJson(file, list.map((entry) => {
    const f = byId.get(entry.id);
    if (!f) return entry;
    const total = f.visible.total + f.sealed.total;
    const passed = f.visible.passed + f.sealed.passed;
    return { ...entry, status: total && passed === total ? "passing" : "failing", passed, total, checkedAt: at };
  }));
}

export function parity(argv, cwd = process.cwd()) {
  const { flags } = parseArgs(argv, { value: ["app", "timeout"] });
  const timeoutMin = flags.timeout === undefined ? 30 : Number(flags.timeout);
  if (!(timeoutMin > 0)) throw new RunError("--timeout must be a positive number of minutes", 2);
  const timeoutMs = timeoutMin * 60000;

  const { root, room, manifest: cfg } = locateRun(flags.app, cwd);
  const reports = path.join(root, ".remake", "reports");
  const recorded = readJson(path.join(room, "hashes.json"), "The room's hashes.json (run publish.mjs tests first)");
  const spec = readJson(path.join(root, "spec", "spec.json"), "spec/spec.json");
  const manifest = readJson(path.join(room, "tests", "manifest.json"), "The room's tests/manifest.json");
  if (!Array.isArray(manifest.tests)) throw new RunError("The room's tests/manifest.json has no tests array");
  const at = new Date().toISOString();
  const commit = git(root, ["rev-parse", "HEAD"]).out;
  const dirty = git(root, ["status", "--porcelain"]).out;

  // (a) The yardstick, in the working tree and in the room.
  const appPrefixes = ["spec/", "tests/visible/"];
  const tamper = diffHashes(recorded.app || {}, { ...hashTree(root, "spec"), ...hashTree(root, "tests/visible") }, appPrefixes)
    .map((d) => ({ ...d, where: "working tree" }));
  const sealedChanged = diffHashes(recorded.room || {}, hashTree(room, "sealed"), ["sealed/"]).length;

  const report = {
    version: 1, at, app: cfg.app, stack: cfg.stack, commit,
    mode: modeInfo(cfg, existsSync(path.join(room, "inventory.json")) ? readJson(path.join(room, "inventory.json"), "inventory.json") : null),
    uncommitted: dirty ? "the working tree has uncommitted changes; only HEAD is scored" : null,
    hashes: null, stubs: null, build: null, suites: {},
  };
  let exitCode = EXIT.ok;
  let scored = null;
  const scratch = scratchCheckout(root);
  try {
    // (a, continued) HEAD is what gets scored, so its copy must match too.
    tamper.push(...diffHashes(recorded.app || {}, { ...hashTree(scratch.dir, "spec"), ...hashTree(scratch.dir, "tests/visible") }, appPrefixes)
      .map((d) => ({ ...d, where: "HEAD" })));
    report.hashes = { ok: !tamper.length && !sealedChanged, app: tamper, sealedChanged };

    // (d) Stubs, over HEAD's own source before any build output exists.
    const stubs = scanStubs(scratch.dir);
    report.stubs = { ok: !stubs.hits.length, scanned: stubs.files, hits: stubs.hits, emptyBodies: stubs.empty };

    if (!report.hashes.ok) {
      exitCode = EXIT.hashes;
    } else {
      // (b) A planted tests/sealed in HEAD must not stand in for the real holdout.
      const sealedDir = path.join(scratch.dir, "tests", "sealed");
      report.plantedSealedDir = existsSync(sealedDir);
      rmSync(sealedDir, { recursive: true, force: true });
      copyDir(path.join(room, "sealed"), sealedDir);

      // The build and the suites run builder-written code (build.rs, the app
      // code the tests import) after the holdout is in place. Pin tests/ now
      // and check it after each, so code that rewrites a test cannot score.
      const pinned = hashTree(scratch.dir, "tests");
      const moved = (stage) => {
        const files = diffHashes(pinned, hashTree(scratch.dir, "tests"), ["tests/"]).length;
        if (!files) return false;
        report.hashes = { ...report.hashes, ok: false, scratch: { stage, files } };
        exitCode = EXIT.hashes;
        return true;
      };

      const build = cfg.commands.build.trim();
      if (build) {
        const b = runCommand(build, scratch.dir, timeoutMs);
        mkdirSync(reports, { recursive: true });
        writeFileSync(path.join(reports, "build-output.log"), b.output);
        report.build = { ran: true, ok: b.status === 0, exitCode: b.status, error: b.error };
      } else report.build = { ran: false, ok: true };

      const outcome = {};
      if (moved("build")) {
        // The yardstick moved: nothing is run or scored.
      } else if (report.build.ok) {
        const ctx = { manifest, scratch, timeoutMs, commands: cfg.commands };
        const v = runSuite("visible", { ...ctx, logFile: path.join(reports, "visible-output.log") });
        const s = runSuite("sealed", { ...ctx, logFile: path.join(room, "reports", "sealed-output.log") });
        outcome.visible = v.byId;
        outcome.sealed = s.byId;
        report.suites.visible = { ok: v.ok, format: v.format, results: v.results, unmatched: v.unmatched, exitCode: v.exitCode, error: v.error };
        // Sealed: whether it ran and how many results did not map. Its error
        // text is our own wording, never the runner's output.
        report.suites.sealed = { ok: s.ok, format: s.format, results: s.results, unmatched: s.unmatched, error: s.error };
        if (!moved("tests") && (!v.ok || !s.ok)) exitCode = EXIT.error;
      } else {
        const notRun = (set) => new Map(manifest.tests.filter((t) => t.set === set).map((t) => [t.id, { status: "not-run", message: "build failed" }]));
        outcome.visible = notRun("visible");
        outcome.sealed = notRun("sealed");
      }

      // (c, e) Map to features and layers, and score; never a moved yardstick.
      if (report.hashes.ok) {
        scored = score(spec, manifest, outcome);
        Object.assign(report, scored);
        if (exitCode === EXIT.ok && !report.stubs.ok) exitCode = EXIT.stubs;
      }
    }
  } finally {
    scratch.cleanup();
  }

  report.exitCode = exitCode;
  report.ok = exitCode === EXIT.ok;
  // (f, g)
  writeJson(path.join(reports, "parity.json"), report);
  if (scored) {
    updateFeatures(root, scored.features, at);
    // One line per scored run: the run page draws its parity chart from these.
    const { overall, visible, sealed } = scored.score;
    appendFileSync(path.join(reports, "history.jsonl"), JSON.stringify({ at, commit, overall, visible: visible.rate, sealed: sealed.rate }) + "\n");
  }
  return { report, exitCode, summary: summarize(report) };
}

function summarize(r) {
  const lines = [];
  const frac = (x) => (x.total ? `${x.passed}/${x.total}` : "-");
  lines.push(`Mode: ${r.mode.label}${r.mode.rea ? ` (${r.mode.reaItems} inventory item${r.mode.reaItems === 1 ? "" : "s"} from REA)` : ""}`);
  if (!r.hashes.ok) {
    lines.push(`STOP: the yardstick changed since publish. Tests were not run.`);
    for (const d of r.hashes.app) lines.push(`  ${d.change.padEnd(8)} ${d.path} (${d.where})`);
    if (r.hashes.sealedChanged) lines.push(`  ${r.hashes.sealedChanged} sealed file(s) changed in the room`);
    if (r.hashes.scratch) lines.push(`  ${r.hashes.scratch.files} test file(s) changed during the ${r.hashes.scratch.stage === "build" ? "build" : "test run"} in the scratch checkout`);
  }
  if (r.stubs.hits.length) {
    lines.push(`STOP: ${r.stubs.hits.length} stub hit(s):`);
    for (const h of r.stubs.hits.slice(0, 20)) lines.push(`  ${h.file}:${h.line}  ${h.rule}`);
    if (r.stubs.hits.length > 20) lines.push(`  … and ${r.stubs.hits.length - 20} more in parity.json`);
  }
  if (r.score) {
    if (r.build?.ran && !r.build.ok) lines.push(`Build failed (${r.build.error || `exit ${r.build.exitCode}`}); every test counts as failed. See .remake/reports/build-output.log.`);
    for (const s of ["visible", "sealed"]) if (r.suites[s] && !r.suites[s].ok) lines.push(`The ${s} suite did not produce results: ${r.suites[s].error}`);
    lines.push(`Parity ${r.score.overall ?? 0}% (${r.score.passed}/${r.score.total} tests) at ${r.commit.slice(0, 7)}`);
    lines.push(`  ${"layer".padEnd(10)} ${"visible".padEnd(9)} ${"sealed".padEnd(9)} overall`);
    for (const [name, l] of Object.entries(r.layers))
      lines.push(`  ${name.padEnd(10)} ${frac(l.visible).padEnd(9)} ${frac(l.sealed).padEnd(9)} ${l.overall === null ? "-" : `${l.overall}%`}`);
    for (const id of r.overfit) {
      const f = r.features.find((x) => x.id === id);
      lines.push(`Overfitting: ${id} (visible ${f.visible.rate}%, sealed ${f.sealed.rate}%)`);
    }
    if (r.stubs.emptyBodies.length) lines.push(`${r.stubs.emptyBodies.length} empty function bod${r.stubs.emptyBodies.length === 1 ? "y" : "ies"} (warning, see parity.json)`);
  }
  if (r.uncommitted) lines.push(`Note: ${r.uncommitted}.`);
  lines.push(`Wrote .remake/reports/parity.json`);
  return lines.join("\n");
}

if (isMain(import.meta.url)) {
  main(() => {
    const { exitCode, summary } = parity(process.argv.slice(2));
    process.stdout.write(summary + "\n");
    return exitCode;
  });
}
