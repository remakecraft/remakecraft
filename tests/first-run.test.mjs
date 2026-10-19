// The first-run path: /remakecraft:try staging, --budget, cost from the
// session transcripts, headless spec approval, the evidence gate and the
// estimate printed after the spec checkpoint.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, tempDir, write } from "./helpers.mjs";
import { REA_PACKAGE } from "../scripts/try.mjs";
import { makeRun } from "./fixture.mjs";
import { locateRun, validateManifest } from "../scripts/lib/run.mjs";
import { PER_FEATURE, PRICES, TALLY, budgetCheck, estimateRun, recordUsage, sumTranscripts, transcriptDir } from "../scripts/lib/usage.mjs";
import { buildState } from "../scripts/lib/state.mjs";
import { readControl } from "../scripts/control.mjs";

const read = (f) => readFileSync(f, "utf8");
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const msg = (id, model, usage, timestamp = new Date(Date.now() + 60000).toISOString()) => ({ type: "assistant", timestamp, message: { id, model, usage } });

/** A Claude config dir with one session and one builder subagent for the given app tree. */
function fakeTranscripts(t, root, { output = 1_000_000 } = {}) {
  const config = tempDir(t, "rc-claude");
  const dir = transcriptDir(root, { CLAUDE_CONFIG_DIR: config });
  write(path.join(dir, "s1.jsonl"), jsonl([
    // A streamed message: the first line carries a partial output count.
    msg("m1", "claude-opus-5-5", { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    msg("m1", "claude-opus-5-5", { input_tokens: 0, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    { type: "user", message: { content: "usage is a word here, not a field" } },
  ]));
  write(path.join(dir, "s1", "subagents", "agent-b.jsonl"), jsonl([
    msg("m2", "claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }),
  ]));
  write(path.join(dir, "s1", "subagents", "agent-b.meta.json"), { agentType: "remakecraft:builder" });
  return config;
}

test("init-run stores --budget in remake.json, and refuses a bad one", (t) => {
  const out = tempDir(t);
  const r = cli("init-run.mjs", ["Pad", "--out", out, "--stack", "web", "--budget", "$25"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /budget \$25/);
  assert.equal(JSON.parse(read(path.join(out, "Pad", "remake.json"))).budgetUsd, 25);

  for (const bad of ["0", "-3", "lots"]) {
    const b = cli("init-run.mjs", [`P${bad.length}`, "--out", out, "--stack", "web", "--budget", bad]);
    assert.equal(b.code, 2, bad);
    assert.match(b.err, /--budget must be a number/);
  }
  const none = cli("init-run.mjs", ["Free", "--out", out, "--stack", "web"]);
  assert.equal("budgetUsd" in JSON.parse(read(path.join(out, "Free", "remake.json"))), false, "no flag, no cap");
  assert.equal(none.code, 0);

  const cfg = JSON.parse(read(path.join(out, "Pad", "remake.json")));
  assert.throws(() => validateManifest({ ...cfg, budgetUsd: 0 }), /budgetUsd/);
  assert.throws(() => validateManifest({ ...cfg, budgetUsd: "25" }), /budgetUsd/);
});

test("transcripts are summed once per message, at its largest, by role and model", (t) => {
  const run = makeRun(t);
  const config = fakeTranscripts(t, run.root);
  const s = sumTranscripts(transcriptDir(run.root, { CLAUDE_CONFIG_DIR: config }));
  const opus = PRICES.opus.output;
  const sonnet = PRICES.sonnet.cacheRead + PRICES.sonnet.cacheWrite;
  assert.equal(Math.round(s.costUsd * 1e4), Math.round((opus + sonnet) * 1e4));
  assert.deepEqual(s.agents, { main: 1_000_000, builder: 1_000_000 }, "cache reads are not counted as tokens");
  assert.equal(s.cacheReadTokens, 1_000_000);
  assert.equal(s.files, 2);
  assert.equal(sumTranscripts(transcriptDir(run.root, { CLAUDE_CONFIG_DIR: config }), { sinceMs: Date.now() + 3600000 }).costUsd, 0, "messages before the run do not count");
});

test("the price table reproduces the measured tally cost from its token counts", () => {
  // Token totals from Claude Code's own modelUsage for tally run 2 (reported $6.29).
  const cost = (p, u) => (u.in * p.input + u.out * p.output + u.cr * p.cacheRead + u.cc * p.cacheWrite) / 1e6;
  const total = cost(PRICES.opus, { in: 124, out: 22019, cr: 4969654, cc: 338988 }) + cost(PRICES.sonnet, { in: 212, out: 129256, cr: 4172019, cc: 450540 });
  assert.ok(Math.abs(total - TALLY.costUsd) / TALLY.costUsd < 0.03, `$${total.toFixed(2)} vs $${TALLY.costUsd}`);
});

test("wait resume stops the run with a resume hint once the budget is spent", (t) => {
  const run = makeRun(t);
  const cfg = JSON.parse(read(run.cfgFile));
  write(run.cfgFile, { ...cfg, budgetUsd: 5 });
  const config = fakeTranscripts(t, run.root, { output: 1_000_000 }); // about $25
  const env = { CLAUDE_CONFIG_DIR: config };

  const w = cli("control.mjs", ["wait", "resume", "--timeout", "0"], run.root, env);
  assert.equal(w.code, 7, w.err);
  assert.match(w.out, /Budget reached: about \$\d+\.\d\d of \$5/);
  assert.match(w.out, /raise "budgetUsd" in .*remake\.json, then run \/remakecraft:remake Calc to resume/);

  const usage = JSON.parse(read(path.join(run.root, ".remake", "progress", "usage.json")));
  assert.equal(usage.budgetUsd, 5);
  assert.equal(usage.costIsEstimate, true);
  assert.ok(usage.costUsd > 5);
  assert.match(cli("control.mjs", ["status"], run.root, env).out, /of a \$5 budget, budget reached/);

  const page = buildState(locateRun(run.root, run.root));
  assert.equal(page.usage.budgetUsd, 5, "the run page's cost fields fill in");
  assert.equal(page.usage.costUsd, usage.costUsd);

  write(run.cfgFile, { ...cfg, budgetUsd: 500 });
  assert.equal(cli("control.mjs", ["wait", "resume", "--timeout", "0"], run.root, env).code, 0, "a raised budget resumes");
  write(run.cfgFile, cfg);
  assert.equal(cli("control.mjs", ["wait", "resume", "--timeout", "0"], run.root, env).code, 0, "no budget, no cap");
  assert.equal(budgetCheck(cfg, { costUsd: 1e6 }).over, false);
});

test("recordUsage writes an empty usage file when no session has run yet", (t) => {
  const run = makeRun(t);
  const u = recordUsage(locateRun(run.root, run.root), { transcripts: path.join(run.out, "none") });
  assert.equal(u.costUsd, 0);
  assert.equal(u.tokens, 0);
  assert.equal(u.transcripts, 0);
});

test("control.mjs approve and changes decide the current draft headlessly", (t) => {
  const run = makeRun(t);
  const ch = cli("control.mjs", ["changes", "Keep mul to small numbers."], run.root);
  assert.equal(ch.code, 0, ch.err);
  const w = cli("control.mjs", ["wait", "spec", "--timeout", "0"], run.root);
  assert.equal(w.code, 6);
  assert.match(w.out, /Keep mul to small numbers\./);

  assert.equal(cli("control.mjs", ["changes"], run.root).code, 2, "changes needs a note");
  assert.equal(cli("control.mjs", ["changes", "  "], run.root).code, 2, "a blank note is refused");

  const ok = cli("control.mjs", ["approve"], run.root);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Approved spec v1\./);
  assert.match(ok.out, /Estimate for 2 features: \$\d+\.\d\d to \$\d+\.\d\d/);
  assert.match(ok.out, /not a quote/);
  assert.equal(readControl(run.root).spec.decision, "approved");

  const again = cli("control.mjs", ["wait", "spec", "--timeout", "0"], run.root);
  assert.equal(again.code, 0);
  assert.match(again.out, /Estimate for 2 features/, "the estimate follows the spec checkpoint");
});

test("approve refuses when there is no draft", (t) => {
  const fresh = tempDir(t);
  assert.equal(cli("init-run.mjs", ["Empty", "--out", fresh, "--stack", "web"]).code, 0);
  const r = cli("control.mjs", ["approve", "--app", path.join(fresh, "Empty")]);
  assert.equal(r.code, 2);
  assert.match(r.err, /No spec draft/);
});

test("phase 1 is refused while the room's evidence folder is empty", (t) => {
  const run = makeRun(t);
  write(path.join(run.room, "evidence", "Thumbs.db"), "x");
  const empty = cli("control.mjs", ["evidence"], run.root);
  assert.equal(empty.code, 8);
  assert.match(empty.out, /No evidence yet: .*evidence is empty/);
  assert.match(empty.out, /screenshots of every window, menu and dialog/);

  write(path.join(run.room, "evidence", "shots", "main.png"), "png");
  const ok = cli("control.mjs", ["evidence"], run.root);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /Evidence: 1 file in/);
});

test("the estimate scales the measured tally run, cheap mode labelled as derived", () => {
  const full = estimateRun(TALLY.features);
  assert.equal(full.measured, true);
  assert.equal(Math.round(full.low * 100), Math.round(TALLY.costUsd * 100));
  assert.ok(full.high > full.low);
  const cheap = estimateRun(TALLY.features, { cheap: true });
  assert.equal(cheap.measured, false);
  assert.ok(cheap.low < full.low && cheap.low > TALLY.sonnetUsd, "cheaper than full, dearer than its Sonnet share alone");
  assert.ok(PER_FEATURE.cheap.usd < PER_FEATURE.full.usd);
});

test("try.mjs stages the toy app as a cheap, capped run and states the cost first", (t) => {
  const out = path.join(tempDir(t), "try");
  const r = cli("try.mjs", ["--out", out], tempDir(t));
  assert.equal(r.code, 0, r.err);
  const root = path.join(out, "tally");
  const room = path.join(out, "tally.remake-room");

  const cfg = JSON.parse(read(path.join(root, "remake.json")));
  assert.equal(cfg.cheap, true);
  assert.equal(cfg.builders, 1);
  assert.equal(cfg.budgetUsd, 8);
  assert.equal(cfg.stack, "web");

  assert.ok(existsSync(path.join(room, "evidence", "MANUAL.md")));
  assert.equal(readdirSync(path.join(room, "evidence", "sessions")).length, 3);
  assert.match(read(path.join(room, "evidence", "ORIGINAL.md")), /Never open, search or copy/);
  assert.ok(existsSync(path.join(room, "original", "tally.mjs")), "the original is installed to run as a black box");
  assert.equal(existsSync(path.join(room, "evidence", "tally.mjs")), false, "the program never lands in the evidence");

  assert.match(r.out, /full mode, measured: 97\.9% \(187\/191\) parity.*\$6\.29/);
  assert.match(r.out, /cheap mode: agents on Sonnet, one builder\. Measured once at \$7\.15 \(98\.9% \(95\/96\)\), half of it this session's own model; switch it with \/model sonnet first and the estimate is about \$\d\.\d\d/);
  assert.match(r.out, /cd ".*\/tally" && claude "\/remakecraft:remake tally"/);
  assert.equal(cli("control.mjs", ["evidence", "--app", root]).code, 0, "phase 1 can start");

  const again = cli("try.mjs", ["--out", out], tempDir(t));
  assert.equal(again.code, 1);
  assert.match(again.err, /already exists/);

  const full = cli("try.mjs", ["--out", path.join(out, "full"), "--full", "--budget", "20"], tempDir(t));
  assert.equal(full.code, 0, full.err);
  const fcfg = JSON.parse(read(path.join(out, "full", "tally", "remake.json")));
  assert.equal(fcfg.cheap, false);
  assert.equal(fcfg.budgetUsd, 20);
});

test("try.mjs --with-rea registers a pinned REA for the observer, on the toy's licence", (t) => {
  const out = path.join(tempDir(t), "try");
  const r = cli("try.mjs", ["--out", out, "--with-rea"], tempDir(t));
  assert.equal(r.code, 0, r.err);
  const root = path.join(out, "tally");
  const cfg = JSON.parse(read(path.join(root, "remake.json")));
  assert.equal(cfg.mode, "clean");
  assert.equal(cfg.rea, true);
  assert.equal(cfg.basis, "license");

  const mcp = JSON.parse(read(path.join(root, ".mcp.json")));
  assert.deepEqual(mcp.mcpServers.rea.args, ["-y", REA_PACKAGE, "mcp"]);
  assert.equal(mcp.mcpServers.rea.env.REA_MCP_INPUT_SCHEMA_PROFILE, "compact", "full schemas overflow the observer's context");
  assert.match(REA_PACKAGE, /^rea-agents@\d+\.\d+\.\d+$/, "pinned to an exact version");
  const settings = JSON.parse(read(path.join(root, ".claude", "settings.local.json")));
  assert.deepEqual(settings.enabledMcpjsonServers, ["rea"]);
  assert.ok(settings.permissions.allow.includes("mcp__rea"));  assert.equal(gitIn(root, "status", "--porcelain"), "", ".mcp.json is committed, so worktrees carry it");

  const original = read(path.join(out, "tally.remake-room", "evidence", "ORIGINAL.md"));
  assert.match(original, /observer alone may also inspect/);
  assert.match(original, /settle every UNKNOWN/, "the demo asks the observer to actually use REA");
  assert.doesNotMatch(original, /Never open/);
  assert.match(r.out, /observer uses REA/);
});
