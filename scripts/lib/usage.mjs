// What a run has cost so far, and what a run is likely to cost. Claude Code
// writes one transcript per session and per subagent (workflow agents
// included) under its projects folder; the run's sessions start in the app
// tree, so that folder is keyed by the app tree's path. Tokens come from the
// transcripts; dollars are an estimate from a price table, never a bill.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git, writeJson } from "./run.mjs";

// USD per million tokens, fitted to the list-price costs Claude Code reported
// for the two tally runs (2026-10-13): Sonnet exactly, Opus as the Sonnet shape
// scaled. Summed from those runs' transcripts they give $6.34 and $3.59 against
// the reported $6.29 and $3.70. Override per run with remake.json
// "prices": { "<model substring>": { input, output, cacheRead, cacheWrite } }.
export const PRICES = {
  opus: { input: 2.24, output: 22.35, cacheRead: 0.224, cacheWrite: 5.59 },
  sonnet: { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  haiku: { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
// A model the table does not know is priced as Opus, so a budget errs towards stopping early.
const FALLBACK = "opus";

// The one measured end-to-end run: tally, 27 features, $6.29 (Opus $3.45 +
// Sonnet $2.84), 25.5 active minutes (remakecraft-notes/runs/2026-10-14-tally.md).
// The estimate's cheap figure moves the Opus share onto Sonnet at the price
// ratio above. That is the agents' share only: the session that runs the skill
// keeps the user's model.
export const TALLY = { features: 27, costUsd: 6.29, opusUsd: 3.45, sonnetUsd: 2.84, activeMin: 25.5, parity: "97.9% (187/191)" };
// The one measured cheap run (2026-10-19, tally, headless, resumed once after
// the pilot): $7.15. Opus was $3.75 of it: the session itself about $3.30 and a
// reviewer spawned without its model override about $0.45. The Sonnet agents were $3.39.
// So cheap mode only pays off with the session on Sonnet too.
export const TALLY_CHEAP = { costUsd: 7.15, sonnetUsd: 3.39, parity: "98.9% (95/96)" };
const OPUS_TO_SONNET = PRICES.opus.output / PRICES.sonnet.output;
export const PER_FEATURE = {
  full: { usd: TALLY.costUsd / TALLY.features, min: TALLY.activeMin / TALLY.features, measured: true },
  cheap: { usd: (TALLY.opusUsd / OPUS_TO_SONNET + TALLY.sonnetUsd) / TALLY.features, min: TALLY.activeMin / TALLY.features, measured: false },
};

/**
 * Claude Code's folder for sessions started in `dir`: every non-alphanumeric
 * becomes "-". Claude Code names it from its process.cwd(), the physical path,
 * so a symlinked dir (macOS /var is /private/var) resolves to its real path.
 */
export function transcriptDir(dir, env = process.env) {
  const base = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  let abs = path.resolve(dir);
  try { abs = realpathSync.native(abs); } catch { /* not created yet: the logical path is all there is */ }
  return path.join(base, "projects", abs.replace(/[^A-Za-z0-9]/g, "-"));
}

function priceFor(model, prices) {
  const m = String(model || "").toLowerCase();
  const key = Object.keys(prices).find((k) => m.includes(k.toLowerCase()));
  return prices[key ?? FALLBACK] ?? PRICES[FALLBACK];
}

function jsonlFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// A subagent's role sits in the meta file beside its transcript; the session's own transcript is "main".
function roleOf(file) {
  const meta = file.replace(/\.jsonl$/, ".meta.json");
  if (!existsSync(meta)) return path.basename(path.dirname(file)) === "subagents" || file.includes(`${path.sep}subagents${path.sep}`) ? "agent" : "main";
  try {
    const t = JSON.parse(readFileSync(meta, "utf8")).agentType;
    return typeof t === "string" && t ? t.replace(/^remakecraft:/, "") : "agent";
  } catch {
    return "agent";
  }
}

/**
 * Sums every assistant message in the transcripts under `dir` from `sinceMs` on.
 * A streamed message is written over several lines that repeat its usage, the
 * early ones with a partial output count, so each message id counts once at its largest.
 */
export function sumTranscripts(dir, { sinceMs = 0, prices = PRICES } = {}) {
  const messages = new Map();
  const total = { tokens: 0, cacheReadTokens: 0, costUsd: 0, agentMs: 0, agents: {}, models: {}, files: 0, skipped: 0 };
  const KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
  for (const file of jsonlFiles(dir)) {
    const role = roleOf(file);
    let first = null;
    let last = null;
    let counted = false;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (!line.includes('"usage"')) return;
      let e;
      try { e = JSON.parse(line); } catch { total.skipped++; return; }
      const u = e?.message?.usage;
      if (e?.type !== "assistant" || !u || typeof u !== "object") return;
      const at = Date.parse(e.timestamp);
      if (Number.isFinite(at) && at < sinceMs) return;
      const id = e.message.id || e.requestId || `${file}:${i}`;
      const m = messages.get(id) || { model: String(e.message.model || "unknown"), role, u: Object.fromEntries(KEYS.map((k) => [k, 0])) };
      for (const k of KEYS) if (Number.isFinite(u[k]) && u[k] > m.u[k]) m.u[k] = u[k];
      messages.set(id, m);
      if (Number.isFinite(at)) { first ??= at; last = at; }
      counted = true;
    });
    if (counted) total.files++;
    if (first !== null && last !== null) total.agentMs += last - first;
  }
  for (const { model, role, u } of messages.values()) {
    const p = priceFor(model, prices);
    const usd = (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.cacheRead + u.cache_creation_input_tokens * p.cacheWrite) / 1e6;
    const tokens = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens;
    total.tokens += tokens;
    total.cacheReadTokens += u.cache_read_input_tokens;
    total.costUsd += usd;
    total.agents[role] = (total.agents[role] || 0) + tokens;
    total.models[model] = (total.models[model] || 0) + usd;
  }
  for (const k of Object.keys(total.models)) total.models[k] = Math.round(total.models[k] * 1e4) / 1e4;
  return total;
}

/** When the run started: the app tree's first commit. */
export function runStartMs(root) {
  const r = git(root, ["log", "--max-parents=0", "--format=%cI", "HEAD"], { allowFail: true });
  const t = Date.parse((r.out || "").split(/\r?\n/).pop());
  if (Number.isFinite(t)) return t;
  try { return statSync(path.join(root, "remake.json")).mtimeMs; } catch { return 0; }
}

export const usageFile = (root) => path.join(root, ".remake", "progress", "usage.json");

/** Recomputes the run's usage from its transcripts and writes .remake/progress/usage.json for the run page. */
export function recordUsage(run, { transcripts = transcriptDir(run.root), now = Date.now() } = {}) {
  const prices = { ...PRICES, ...(run.manifest.prices && typeof run.manifest.prices === "object" ? run.manifest.prices : {}) };
  const s = sumTranscripts(transcripts, { sinceMs: runStartMs(run.root) - 60000, prices });
  const usage = {
    tokens: s.tokens,
    cacheReadTokens: s.cacheReadTokens,
    costUsd: Math.round(s.costUsd * 100) / 100,
    costIsEstimate: true,
    agentHours: Math.round((s.agentMs / 3600000) * 100) / 100,
    budgetUsd: Number.isFinite(run.manifest.budgetUsd) ? run.manifest.budgetUsd : null,
    agents: s.agents,
    models: s.models,
    transcripts: s.files,
    at: new Date(now).toISOString(),
  };
  writeJson(usageFile(run.root), usage);
  return usage;
}

/** Budget state: over is true once the estimated cost reaches the cap. No cap, never over. */
export function budgetCheck(manifest, usage) {
  const cap = Number.isFinite(manifest.budgetUsd) ? manifest.budgetUsd : null;
  const spent = Number.isFinite(usage?.costUsd) ? usage.costUsd : 0;
  return { cap, spent, over: cap !== null && spent >= cap };
}

const usd = (n) => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;

/**
 * A cost and time estimate for `features` features, scaled from the one
 * measured run. Tally's features are tiny; real apps' are larger, so the
 * range only goes up.
 */
export function estimateRun(features, { cheap = false } = {}) {
  const basis = cheap ? PER_FEATURE.cheap : PER_FEATURE.full;
  const low = features * basis.usd;
  const minutes = features * basis.min;
  return { features, cheap, low, high: low * 3, minutes, measured: basis.measured };
}

export function describeEstimate(e) {
  const mins = e.minutes < 90 ? `${Math.max(1, Math.round(e.minutes))} min` : `${(e.minutes / 60).toFixed(1)} h`;
  return [
    `Estimate for ${e.features} features${e.cheap ? " in cheap mode" : ""}: ${usd(e.low)} to ${usd(e.high)}, about ${mins} of agent time.`,
    `  Basis: one measured run (tally, ${TALLY.features} features, $${TALLY.costUsd}, ${TALLY.activeMin} min)${e.measured ? "" : "; cheap mode is not measured yet, so its per-feature cost is derived from that run"}.`,
    `  An estimate, not a quote: tally's features are small, so bigger features cost more. Set --budget (remake.json "budgetUsd") to cap it.`,
  ].join("\n");
}
