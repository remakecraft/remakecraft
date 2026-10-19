#!/usr/bin/env node
// The run page's control channel. Pausing and the spec decision are written to
// .remake/control.json in the app tree; the orchestrator reads them with this
// script at the points SKILL.md names. Nothing else writes the file.
//
//   node scripts/control.mjs status [--app <app tree>]
//   node scripts/control.mjs pause|resume [--app <app tree>]
//   node scripts/control.mjs wait resume|spec [--app <app tree>] [--timeout <minutes>]
//   node scripts/control.mjs approve | changes "<note>" [--app <app tree>]
//   node scripts/control.mjs evidence [--app <app tree>]
//
// Exit codes: 0 go ahead, 5 timed out still waiting, 6 the user asked for spec
// changes (the note is printed), 7 the run's budget is spent, 8 the room's
// evidence/ is empty. Any other error exits 1.

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { RunError, hashFile, isMain, listFiles, locateRun, main, parseArgs, toSlash } from "./lib/run.mjs";
import { budgetCheck, describeEstimate, estimateRun, recordUsage } from "./lib/usage.mjs";

const USAGE = 'Usage: control.mjs status | pause | resume | wait resume|spec | approve | changes "<note>" | evidence [--app <app tree>] [--timeout <minutes>]';
export const EXIT = { ok: 0, error: 1, timeout: 5, changes: 6, budget: 7, noEvidence: 8 };
const OS_JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const NOTE_MAX = 4000;

export const controlFile = (root) => path.join(root, ".remake", "control.json");

const EMPTY = Object.freeze({ version: 1, paused: false, pausedAt: null, spec: null, updatedAt: null });

/** Reads control.json. A missing file means "running, no decision". A broken one is an error, not a silent resume. */
export function readControl(root) {
  const file = controlFile(root);
  if (!existsSync(file)) return { ...EMPTY };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new RunError(`.remake/control.json is not valid JSON (${err.message}). Delete it to clear the page's controls.`);
  }
  const spec = raw.spec && typeof raw.spec === "object" && ["approved", "changes"].includes(raw.spec.decision) && typeof raw.spec.hash === "string"
    ? { decision: raw.spec.decision, hash: raw.spec.hash, version: Number.isInteger(raw.spec.version) ? raw.spec.version : null, note: typeof raw.spec.note === "string" ? raw.spec.note : "", at: raw.spec.at ?? null }
    : null;
  return { version: 1, paused: raw.paused === true, pausedAt: raw.paused === true ? raw.pausedAt ?? null : null, spec, updatedAt: raw.updatedAt ?? null };
}

// Written to a temp file and renamed, so a reader never sees half a file.
function writeControl(root, value) {
  const file = controlFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2) + "\n");
  try {
    renameSync(tmp, file);
  } catch {
    // Windows refuses the rename while another process holds the target open; one retry covers a reader in flight.
    renameSync(tmp, file);
  }
  return readControl(root);
}

/** The room's current spec draft: its hash and version, or null when the spec writer has not written one. */
export function roomSpec(room) {
  const file = path.join(room, "spec", "spec.json");
  if (!existsSync(file)) return null;
  let version = null;
  try { version = JSON.parse(readFileSync(file, "utf8")).version ?? null; } catch { /* hash still identifies it */ }
  return { hash: hashFile(file), version };
}

export function setPaused(root, paused) {
  const c = readControl(root);
  if (c.paused === paused) return c;
  return writeControl(root, { ...c, paused, pausedAt: paused ? new Date().toISOString() : null });
}

/**
 * Records the user's spec decision for one exact draft. The hash ties it to
 * the draft the user read: a later rewrite of spec.json does not inherit it.
 */
export function decideSpec(root, room, { decision, hash, note = "" }) {
  if (!["approved", "changes"].includes(decision)) throw new RunError(`Spec decision must be "approved" or "changes"`, 2);
  const current = roomSpec(room);
  if (!current) throw new RunError("There is no spec draft in the room to decide on.", 2);
  if (hash !== current.hash) throw new RunError("The spec changed since the page loaded it. Reload and read the new draft first.", 2);
  const text = String(note || "").trim();
  if (decision === "changes" && !text) throw new RunError("Say what should change; the spec writer needs something to act on.", 2);
  if (text.length > NOTE_MAX) throw new RunError(`Keep the note under ${NOTE_MAX} characters.`, 2);
  const c = readControl(root);
  return writeControl(root, { ...c, spec: { decision, hash, version: current.version, note: decision === "changes" ? text : "", at: new Date().toISOString() } });
}

/** The spec decision that applies to the room's current draft, or null. */
export function specDecision(control, current) {
  if (!control.spec || !current || control.spec.hash !== current.hash) return null;
  return control.spec;
}

/** The files the user put in <room>/evidence/, OS clutter left out. */
export function evidenceFiles(room) {
  return listFiles(path.join(room, "evidence")).filter((f) => !OS_JUNK.has(path.basename(f).toLowerCase()));
}

/** The estimate for building the room's spec draft, or null without a readable draft. */
export function specEstimate(run) {
  try {
    const features = JSON.parse(readFileSync(path.join(run.room, "spec", "spec.json"), "utf8")).features;
    if (!Array.isArray(features) || !features.length) return null;
    return describeEstimate(estimateRun(features.length, { cheap: run.manifest.cheap }));
  } catch {
    return null;
  }
}

/** Refreshes usage.json from the transcripts and says whether the budget is spent. */
export function checkBudget(run, opts = {}) {
  const usage = recordUsage(run, opts);
  return { usage, ...budgetCheck(run.manifest, usage) };
}

export const budgetStop = (run, b) =>
  `Budget reached: about $${b.spent.toFixed(2)} of $${b.cap} spent (an estimate from the session transcripts). Nothing new starts.\n` +
  `To go on, raise "budgetUsd" in ${toSlash(path.join(run.root, "remake.json"))}, then run /remakecraft:remake ${run.manifest.app} to resume from the checklist.`;

function status(run) {
  const c = readControl(run.root);
  const current = roomSpec(run.room);
  const d = specDecision(c, current);
  const b = checkBudget(run);
  return [
    `Run: ${c.paused ? `paused since ${c.pausedAt}` : "running"}`,
    `Spec draft: ${current ? `v${current.version ?? "?"}` : "none"}; page decision: ${d ? (d.decision === "approved" ? "approved" : `changes requested: ${d.note}`) : "none"}`,
    `Cost: about $${b.spent.toFixed(2)} (estimate)${b.cap === null ? ", no budget set" : ` of a $${b.cap} budget${b.over ? ", budget reached" : ""}`}`,
  ].join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until the condition holds or the timeout passes. check() returns an exit code to stop with, or null to keep waiting. */
export async function waitFor(check, timeoutMs, everyMs = 1000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = check();
    if (r !== null) return r;
    if (Date.now() >= end) return null;
    await sleep(Math.min(everyMs, Math.max(0, end - Date.now())));
  }
}

export async function control(argv, cwd = process.cwd(), out = (s) => process.stdout.write(s + "\n")) {
  const { pos, flags } = parseArgs(argv, { value: ["app", "timeout"] });
  const [cmd, what] = pos;
  if (!cmd) throw new RunError(USAGE, 2);
  const run = locateRun(flags.app, cwd);

  if (cmd === "status") { out(status(run)); return EXIT.ok; }
  if (cmd === "evidence") {
    const files = evidenceFiles(run.room);
    if (files.length) { out(`Evidence: ${files.length} file${files.length > 1 ? "s" : ""} in ${toSlash(path.join(run.room, "evidence"))}.`); return EXIT.ok; }
    out([
      `No evidence yet: ${toSlash(path.join(run.room, "evidence"))} is empty, so phase 1 has nothing to inventory.`,
      "Put in what shows the original app at work: screenshots of every window, menu and dialog, screen recordings,",
      "the manual or help pages, and sample files it opens and saves. Optionally install the app, or a launcher for it,",
      `in ${toSlash(path.join(run.room, "original"))} so the observer can run it as a black box. Then run this again.`,
    ].join("\n"));
    return EXIT.noEvidence;
  }
  if (cmd === "approve" || cmd === "changes") {
    const current = roomSpec(run.room);
    if (!current) throw new RunError(`No spec draft at ${toSlash(path.join(run.room, "spec", "spec.json"))} to decide on.`, 2);
    if (cmd === "changes" && pos.length !== 2) throw new RunError('Say what should change, in one quoted argument: control.mjs changes "<note>"', 2);
    if (cmd === "approve" && pos.length !== 1) throw new RunError(USAGE, 2);
    decideSpec(run.root, run.room, { decision: cmd === "approve" ? "approved" : "changes", hash: current.hash, note: what });
    if (cmd === "changes") { out(`Changes requested for spec v${current.version ?? "?"}. The orchestrator's wait spec picks them up.`); return EXIT.ok; }
    out(`Approved spec v${current.version ?? "?"}.`);
    const est = specEstimate(run);
    if (est) out(est);
    return EXIT.ok;
  }
  if (cmd === "pause" || cmd === "resume") {
    setPaused(run.root, cmd === "pause");
    out(cmd === "pause" ? "Paused. Agents already working finish; nothing new starts until resume." : "Resumed.");
    return EXIT.ok;
  }
  if (cmd !== "wait" || !["resume", "spec"].includes(what)) throw new RunError(USAGE, 2);

  // Under the 10-minute cap a single shell call gets; loop the call to wait longer.
  const minutes = flags.timeout === undefined ? 9 : Number(flags.timeout);
  if (!(minutes >= 0)) throw new RunError("--timeout must be a number of minutes", 2);
  const timeoutMs = minutes * 60000;

  if (what === "resume") {
    // Every batch passes through here, so this is where a budget stops the run.
    const b = checkBudget(run);
    if (b.over) { out(budgetStop(run, b)); return EXIT.budget; }
    const r = await waitFor(() => (readControl(run.root).paused ? null : EXIT.ok), timeoutMs);
    out(r === null ? `Still paused after ${minutes} min. Run this again to keep waiting.` : "Running.");
    return r ?? EXIT.timeout;
  }

  let decided = null;
  const r = await waitFor(() => {
    const current = roomSpec(run.room);
    if (!current) throw new RunError(`No spec draft at ${toSlash(path.join(run.room, "spec", "spec.json"))}`);
    decided = specDecision(readControl(run.root), current);
    if (!decided) return null;
    return decided.decision === "approved" ? EXIT.ok : EXIT.changes;
  }, timeoutMs);
  if (r === null) out(`No decision on the page after ${minutes} min.`);
  else if (r === EXIT.ok) {
    out(`Approved: spec v${decided.version ?? "?"}.`);
    const est = specEstimate(run);
    if (est) out(est);
  }
  else out(`Changes requested on the run page:\n${decided.note}`);
  return r ?? EXIT.timeout;
}

if (isMain(import.meta.url)) main(() => control(process.argv.slice(2)));
