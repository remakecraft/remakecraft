// Builds the run page's state from the files a run already writes. Nothing
// here is estimated or invented: a value the run has not recorded comes back
// null, and the page shows it as empty.
//
// The holdout stays sealed here too. Sealed results leave as counts per
// feature; sealed test ids are read only to scrub them from free text (wall
// log targets, commit subjects) and are never part of the output. The page is
// served on localhost, where a builder could fetch it, so this matters.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { LAYERS, PRIORITIES, hashFile, modeInfo } from "./run.mjs";
import { readControl, roomSpec, specDecision } from "../control.mjs";

export const OVERFIT_POINTS = 15;
const WALL_MAX = 300;
const EXCERPT_MAX = 60;
const IDLE_MS = 20 * 60000;
const PHASE_NAMES = ["Setup", "Inventory", "Spec", "Tests", "Pilot", "Build", "Verify", "Review", "Report"];

/** Pass rate in percent with one decimal, floored like parity.mjs, or null for an empty set. */
export function rate(r) {
  if (!r || !Number.isFinite(r.total) || r.total <= 0 || !Number.isFinite(r.passed)) return null;
  return Math.floor((r.passed / r.total) * 1000) / 10;
}

/** How many points the visible pass rate beats the sealed one by, or null when either is unknown. */
export function overfitGap(visible, sealed) {
  const v = rate(visible);
  const s = rate(sealed);
  return v === null || s === null ? null : Math.round((v - s) * 10) / 10;
}

/** Overfit: visible beats sealed by more than 15 points. Exactly 15 is not overfit. */
export function isOverfit(visible, sealed) {
  const gap = overfitGap(visible, sealed);
  return gap !== null && gap > OVERFIT_POINTS;
}

function readJsonOrNull(file, warnings) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    warnings.push(`${path.basename(file)} is not valid JSON: ${err.message}`);
    return null;
  }
}

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
}

function jsonLines(file, warnings) {
  const out = [];
  let bad = 0;
  for (const line of readLines(file)) {
    try { out.push(JSON.parse(line)); } catch { bad++; }
  }
  if (bad) warnings.push(`${path.basename(file)}: skipped ${bad} unreadable line${bad > 1 ? "s" : ""}`);
  return out;
}

const mtime = (file) => { try { return statSync(file).mtimeMs; } catch { return 0; } };
const counts = (x) => (x && Number.isFinite(x.passed) && Number.isFinite(x.total) ? { passed: x.passed, total: x.total } : null);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10000 });
  return r.status === 0 ? r.stdout : null;
}

/** Replaces sealed test ids and anything filed under a sealed/ directory. */
export function makeScrubber(sealedIds) {
  const ids = [...sealedIds].filter(Boolean).sort((a, b) => b.length - a.length);
  const idRe = ids.length ? new RegExp(`(^|[^A-Za-z0-9_.-])(${ids.map(escapeRe).join("|")})(?=$|[^A-Za-z0-9_-])`, "g") : null;
  return (text) => {
    let s = String(text ?? "").replace(/(^|[\\/])sealed([\\/])[^\s"'`;|&)]+/gi, "$1sealed$2…");
    if (idRe) s = s.replace(idRe, "$1[sealed test]");
    return s;
  };
}

/** Phases from the progress checklist: the first unticked line is the one in progress. */
export function readPhases(checklistText) {
  const found = [];
  for (const line of String(checklistText || "").split(/\r?\n/)) {
    const m = line.match(/^- \[( |x|X)\] \*\*(\d+) ([^*]+?)\.?\*\*/);
    if (m) found.push({ n: Number(m[2]), name: m[3].trim(), done: m[1] !== " " });
  }
  const list = found.length ? found : PHASE_NAMES.map((name, n) => ({ n, name, done: false }));
  const now = list.findIndex((p) => !p.done);
  return list.map((p, i) => ({ n: p.n, name: p.name, state: p.done ? "done" : i === now ? "now" : "future" }));
}

const titleOf = (f) => f.name || f.title || f.summary || f.id;

/** The numbered lines of one spec feature, as the drill-in and the approval panel show them. */
function specLines(f) {
  const out = [];
  (Array.isArray(f.behaviour) ? f.behaviour : []).forEach((t, i) => out.push([`B${i + 1}`, String(t)]));
  (Array.isArray(f.acceptance) ? f.acceptance : []).forEach((t, i) => out.push([`A${i + 1}`, String(t)]));
  if (!out.length && f.summary) out.push(["S", String(f.summary)]);
  return out;
}

const splitOf = (features) => Object.fromEntries(PRIORITIES.map((p) => [p, features.filter((f) => f.priority === p).length]));

/**
 * The approval panel. A draft in the room that differs from the published
 * spec (or no published spec at all) is waiting for the human checkpoint.
 */
function specPanel({ root, room, control, warnings }) {
  const roomFile = path.join(room, "spec", "spec.json");
  const appFile = path.join(root, "spec", "spec.json");
  const draft = readJsonOrNull(roomFile, warnings);
  const published = readJsonOrNull(appFile, warnings);
  const show = draft || published;
  if (!show || !Array.isArray(show.features)) return null;

  const current = roomSpec(room);
  const isPublished = Boolean(published && (!draft || hashFile(roomFile) === hashFile(appFile)));
  const decision = isPublished ? null : specDecision(control, current);
  const state = isPublished ? "published" : decision ? (decision.decision === "approved" ? "approved" : "changes") : "pending";

  // Against the published spec, a revision marks the lines it adds and drops.
  const before = new Map((published && !isPublished ? published.features : []).map((f) => [f.id, specLines(f).map(([, t]) => t)]));
  let changed = 0;
  const groups = show.features.filter((f) => f && typeof f.id === "string").map((f) => {
    const old = before.get(f.id);
    const now = specLines(f);
    const lines = [];
    if (old) {
      const keep = new Set(now.map(([, t]) => t));
      for (const t of old) if (!keep.has(t)) { lines.push({ k: "", text: t, mark: "strike" }); changed++; }
    }
    for (const [k, t] of now) {
      const amend = Boolean(published && !isPublished && (!old || !old.includes(t)));
      if (amend) changed++;
      lines.push({ k, text: t, mark: amend ? "amend" : null });
    }
    return { id: f.id, title: titleOf(f), priority: f.priority ?? null, layer: f.layer ?? null, lines, changed: lines.some((l) => l.mark) };
  });
  groups.sort((a, b) => Number(b.changed) - Number(a.changed));

  return {
    state,
    version: Number.isInteger(show.version) ? show.version : null,
    publishedVersion: published && Number.isInteger(published.version) ? published.version : null,
    hash: isPublished ? null : current?.hash ?? null,
    features: show.features.length,
    split: splitOf(show.features),
    changed: published && !isPublished ? changed : null,
    groups: groups.slice(0, EXCERPT_MAX),
    more: Math.max(0, groups.length - EXCERPT_MAX),
    note: decision?.decision === "changes" ? decision.note : null,
    decidedAt: decision?.at ?? null,
  };
}

/** Visible test names per feature from the room's manifest; sealed ones only as counts and scrub ids. */
function readManifest(room, warnings) {
  const m = readJsonOrNull(path.join(room, "tests", "manifest.json"), warnings);
  const visible = new Map();
  const sealedCount = new Map();
  const sealedIds = new Set();
  for (const t of Array.isArray(m?.tests) ? m.tests : []) {
    if (!t || typeof t.id !== "string" || typeof t.feature !== "string") continue;
    if (t.set === "sealed") {
      sealedIds.add(t.id);
      sealedCount.set(t.feature, (sealedCount.get(t.feature) || 0) + 1);
    } else if (t.set === "visible") {
      if (!visible.has(t.feature)) visible.set(t.feature, []);
      visible.get(t.feature).push(t.id);
    }
  }
  return { visible, sealedCount, sealedIds };
}

/** Features with an unmerged builder worktree on remake/<id>: work in flight even when the orchestrator recorded nothing. */
function worktreesInFlight(root) {
  const list = git(root, ["worktree", "list", "--porcelain"]);
  if (list === null) return new Map();
  const branches = new Map();
  let dir = null;
  for (const line of list.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) dir = line.slice(9);
    const b = line.match(/^branch refs\/heads\/remake\/(.+)$/);
    if (b) branches.set(b[1], dir);
  }
  if (!branches.size) return branches;
  // Merged means behind HEAD. A fresh branch still sitting on HEAD has no commits yet, so it is in flight.
  const head = (git(root, ["rev-parse", "HEAD"]) || "").trim();
  for (const line of (git(root, ["branch", "--merged", "HEAD", "--list", "remake/*", "--format=%(objectname) %(refname:short)"]) || "").split(/\r?\n/)) {
    const [sha, name] = line.trim().split(" ");
    if (name && sha !== head) branches.delete(name.replace(/^remake\//, ""));
  }
  return branches;
}

function readCommits(root, scrub) {
  const out = git(root, ["log", "-n", "500", "--format=%h%x1f%s%x1f%cI"]);
  if (out === null) return [];
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [hash, msg, at] = l.split("\x1f");
    return { hash, msg: scrub(msg), at };
  });
}

function commitsFor(id, commits) {
  const re = new RegExp(`(^|[^a-z0-9._-])${escapeRe(id)}($|[^a-z0-9_-]|\\.(?![a-z0-9]))`, "i");
  return commits.filter((c) => re.test(c.msg)).slice(0, 12);
}

function wallTarget(input) {
  if (!input || typeof input !== "object") return "";
  for (const k of ["file_path", "notebook_path", "path", "url", "query", "pattern", "command"]) {
    if (input[k]) return String(input[k]).slice(0, 300);
  }
  return "";
}

// Absolute paths are shown relative to the folder holding the app and its room,
// so a target reads "Tally.remake-room/inventory.json" instead of a home-dir path.
function relativeToOut(root) {
  const out = path.dirname(path.resolve(root));
  const forms = [...new Set([out, out.replace(/\\/g, "/"), out.replace(/\//g, "\\")])];
  const re = new RegExp(`(${forms.map(escapeRe).join("|")})[\\\\/]`, "gi");
  return (s) => s.replace(re, "");
}

function readWall(root, scrub, warnings) {
  const all = jsonLines(path.join(root, ".remake", "wall.log"), warnings);
  const rel = relativeToOut(root);
  const entries = all.slice(-WALL_MAX).map((e, i, arr) => ({
    n: all.length - arr.length + i + 1,
    at: e.at ?? null,
    who: e.role && e.role !== "main" ? e.role : "main session",
    agent: e.agent ?? null,
    tool: String(e.tool ?? ""),
    target: scrub(rel(wallTarget(e.input))),
    reason: scrub(String(e.reason ?? "").replace(/^Clean-room wall:\s*/, "")),
  }));
  return { count: all.length, entries: entries.reverse() };
}

function readUsage(root, warnings, cfg = {}) {
  const u = readJsonOrNull(path.join(root, ".remake", "progress", "usage.json"), warnings);
  if (!u || typeof u !== "object") return null;
  const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  const agents = {};
  if (u.agents && typeof u.agents === "object") for (const [k, v] of Object.entries(u.agents)) if (num(v) !== null) agents[k] = v;
  const out = { tokens: num(u.tokens), costUsd: num(u.costUsd), agentHours: num(u.agentHours), budgetUsd: num(u.budgetUsd) ?? num(cfg.budgetUsd), agents };
  return Object.values(out).some((v) => v !== null && !(typeof v === "object" && !Object.keys(v).length)) ? out : null;
}

function readHistory(root, parity, warnings) {
  const pts = jsonLines(path.join(root, ".remake", "reports", "history.jsonl"), warnings)
    .filter((h) => Number.isFinite(h.overall))
    .map((h) => ({ at: h.at ?? null, overall: h.overall }));
  if (!pts.length && Number.isFinite(parity?.score?.overall)) pts.push({ at: parity.at ?? null, overall: parity.score.overall });
  return pts;
}

const ago = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/**
 * @param {{root:string, room:string, manifest:object}} run  from locateRun()
 * @param {{now?: number}} opts
 */
export function buildState(run, { now = Date.now() } = {}) {
  const { root, room, manifest: cfg } = run;
  const warnings = [];
  const reports = path.join(root, ".remake", "reports");
  const progress = path.join(root, ".remake", "progress");
  const control = readControl(root);

  const tests = readManifest(room, warnings);
  const scrub = makeScrubber(tests.sealedIds);

  const checklistFile = path.join(progress, "checklist.md");
  const phases = readPhases(existsSync(checklistFile) ? readFileSync(checklistFile, "utf8") : "");
  const phase = phases.find((p) => p.state === "now") ?? null;

  const spec = specPanel({ root, room, control, warnings });
  const appSpec = readJsonOrNull(path.join(root, "spec", "spec.json"), warnings);
  const specById = new Map((Array.isArray(appSpec?.features) ? appSpec.features : []).map((f) => [f.id, f]));

  const parity = readJsonOrNull(path.join(reports, "parity.json"), warnings);
  const scored = parity && parity.score ? parity : null;
  const parityById = new Map((Array.isArray(scored?.features) ? scored.features : []).map((f) => [f.id, f]));
  const failures = new Map((Array.isArray(scored?.visibleFailures) ? scored.visibleFailures : []).map((f) => [f.test, f]));

  const progressList = readJsonOrNull(path.join(progress, "features.json"), warnings);
  const inFlight = worktreesInFlight(root);
  const commits = readCommits(root, scrub);

  const features = (Array.isArray(progressList) ? progressList : []).filter((e) => e && typeof e.id === "string").map((e) => {
    const s = specById.get(e.id) || {};
    const p = parityById.get(e.id);
    const visible = counts(p?.visible);
    const sealed = counts(p?.sealed);
    let status = ["pending", "building", "passing", "failing"].includes(e.status) ? e.status : "pending";
    if (status !== "passing" && inFlight.has(e.id)) status = "building";
    const names = tests.visible.get(e.id) || [];
    return {
      id: e.id,
      title: titleOf({ ...s, id: e.id }),
      layer: LAYERS.includes(e.layer) ? e.layer : s.layer ?? null,
      priority: PRIORITIES.includes(e.priority) ? e.priority : s.priority ?? null,
      status,
      agent: typeof e.agent === "string" ? e.agent : null,
      worktree: inFlight.get(e.id) ?? null,
      visible,
      sealed,
      sealedCount: tests.sealedCount.get(e.id) ?? sealed?.total ?? 0,
      overfit: isOverfit(visible, sealed),
      gap: overfitGap(visible, sealed),
      checkedAt: e.checkedAt ?? null,
      spec: specLines(s),
      tests: names.map((name) => {
        const f = failures.get(name);
        if (!scored || !p) return { name, status: "not-run", message: "" };
        if (!f) return { name, status: "pass", message: "" };
        return { name, status: f.status === "not-run" ? "not-run" : "fail", message: scrub(f.message || f.status) };
      }),
      commits: commitsFor(e.id, commits),
    };
  });

  const layers = LAYERS.map((key) => {
    const l = scored?.layers?.[key];
    const fs = features.filter((f) => f.layer === key);
    return { key, features: fs.length, visible: counts(l?.visible), sealed: counts(l?.sealed), overfit: fs.filter((f) => f.overfit).length };
  });

  const history = readHistory(root, scored, warnings);
  const usage = readUsage(root, warnings, cfg);

  // Agent lanes: one per builder slot from remake.json, then the verifier and reviewer.
  const audit = jsonLines(path.join(root, ".remake", "audit.log"), warnings);
  const starts = (role) => audit.filter((a) => String(a.agent || "").replace(/^remakecraft:/, "") === role).length;
  const building = features.filter((f) => f.status === "building");
  const slots = Math.max(cfg.builders, building.length);
  const named = new Map(building.filter((f) => f.agent).map((f) => [f.agent, f]));
  const unnamed = building.filter((f) => !f.agent || !/^builder-\d+$/.test(f.agent));
  const agents = [];
  for (let i = 1; i <= slots; i++) {
    const id = `builder-${i}`;
    const f = named.get(id) || unnamed.shift() || null;
    agents.push({
      id, kind: "builder", label: id, short: `B${i}`, model: cfg.models?.builder ?? null,
      where: f?.worktree ? path.basename(f.worktree) : "worktree",
      feature: f?.id ?? null,
      detail: f ? (f.worktree ? `Working on branch remake/${f.id}` : "Building") : "",
      tokens: usage?.agents?.[id] ?? null,
    });
  }
  const reviewDiff = existsSync(path.join(reports, "review.diff"));
  const reviewAt = mtime(path.join(reports, "review.md"));
  agents.push({
    id: "verifier", kind: "verifier", label: "verifier", short: "V", model: cfg.models?.builder ?? null, where: "read-only",
    feature: null,
    detail: scored ? `Scored ${scored.score.overall ?? 0}% at ${String(scored.commit || "").slice(0, 7)}` : starts("verifier") ? "Started, no score yet" : "",
    runs: starts("verifier"), at: scored?.at ?? null, tokens: usage?.agents?.verifier ?? null,
  });
  agents.push({
    id: "reviewer", kind: "reviewer", label: reviewDiff ? "Codex" : "reviewer", short: reviewDiff ? "Cx" : "R",
    model: reviewDiff ? "Codex" : cfg.models?.reviewer ?? null, where: reviewDiff ? "cross-family" : "read-only",
    feature: null,
    detail: reviewAt ? "Wrote review.md" : "",
    runs: starts("reviewer"), at: reviewAt ? new Date(reviewAt).toISOString() : null, tokens: usage?.agents?.reviewer ?? null,
  });

  // When the run started and when it last did anything.
  const firstCommit = (git(root, ["log", "--max-parents=0", "--format=%cI", "HEAD"]) || "").trim().split(/\r?\n/).pop();
  const startedAt = ago(firstCommit) ?? (mtime(path.join(root, "remake.json")) || null);
  const lastActivity = Math.max(
    ...["wall.log", "audit.log", "progress/features.json", "progress/checklist.md", "reports/parity.json", "reports/review.md"].map((f) => mtime(path.join(root, ".remake", f))),
    mtime(path.join(root, ".git", "logs", "HEAD")), mtime(path.join(room, "spec", "spec.json")), 0,
  ) || null;
  const finished = phases.every((p) => p.state === "done");

  let status = "running";
  if (finished) status = "finished";
  else if (control.paused) status = "paused";
  else if (spec && spec.state === "pending" && phase && /spec/i.test(phase.name)) status = "approval";
  else if (lastActivity && now - lastActivity > IDLE_MS) status = "idle";

  return {
    version: 1,
    mode: "live",
    generatedAt: new Date(now).toISOString(),
    app: {
      name: cfg.app, stack: cfg.stack, builders: cfg.builders, cheap: cfg.cheap, original: typeof cfg.original === "string" ? cfg.original : null, room: path.basename(room),
      mode: modeInfo(cfg, readJsonOrNull(path.join(room, "inventory.json"), warnings)),
    },
    status,
    paused: control.paused,
    pausedAt: control.pausedAt,
    phases,
    phase: phase ? phase.name : finished ? "Done" : null,
    run: {
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
      endedAt: finished && lastActivity ? new Date(lastActivity).toISOString() : null,
    },
    usage,
    parity: scored
      ? {
        at: scored.at ?? null,
        commit: scored.commit ?? null,
        overall: scored.score.overall ?? null,
        passed: scored.score.passed ?? 0,
        total: scored.score.total ?? 0,
        delta: history.length > 1 ? Math.round((history.at(-1).overall - history.at(-2).overall) * 10) / 10 : null,
        ok: parity.ok === true,
        hashesOk: parity.hashes?.ok !== false,
        stubHits: Array.isArray(parity.stubs?.hits) ? parity.stubs.hits.length : 0,
        buildOk: parity.build?.ok !== false,
      }
      : null,
    history,
    layers,
    features,
    agents,
    wall: readWall(root, scrub, warnings),
    spec,
    warnings,
  };
}

/** A cheap fingerprint of every file the state reads, so the server rebuilds only on change. */
export function stateSignature({ root, room }) {
  const files = [
    "remake.json", ".remake/control.json", ".remake/wall.log", ".remake/audit.log",
    ".remake/progress/features.json", ".remake/progress/checklist.md", ".remake/progress/usage.json",
    ".remake/reports/parity.json", ".remake/reports/history.jsonl", ".remake/reports/review.md", ".remake/reports/review.diff",
    "spec/spec.json", ".git/logs/HEAD", ".git/worktrees",
  ].map((f) => path.join(root, f));
  files.push(path.join(room, "spec", "spec.json"), path.join(room, "tests", "manifest.json"));
  return files.map((f) => { try { const s = statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; } }).join("|");
}
