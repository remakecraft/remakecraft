// The headless fallback for /remakecraft:build must spawn the same agents with
// the same prompts as the workflow. workflows/build.js is run here with fake
// Workflow globals, and its agent calls and log lines are compared with what
// scripts/build-steps.mjs tells the orchestrator to do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLUGIN, cli } from "./helpers.mjs";
import { makeRun } from "./fixture.mjs";
import { buildSteps } from "../scripts/build-steps.mjs";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const WORKFLOW = readFileSync(path.join(PLUGIN, "workflows", "build.js"), "utf8").replace(/^export const meta =/m, "const meta =");

/** Runs the workflow script. reply(prompt, opts, calls) answers each agent() call. */
async function runWorkflow(args, reply) {
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, ...opts });
    return reply(prompt, opts, calls);
  };
  const parallel = (fns) => Promise.all(fns.map((f) => f()));
  const result = await new AsyncFunction("args", "agent", "parallel", "phase", "log", WORKFLOW)(args, agent, parallel, () => {}, (l) => logs.push(l));
  return { calls, logs, result };
}

const ROOT = "C:/plugins/remakecraft";
const MANIFEST = { app: "Calc", builders: 2, cheap: false, models: { planner: "opus", builder: "sonnet", reviewer: "opus" } };
// The skill passes the run's settings; the fallback reads them from remake.json.
const ARGS = { pluginRoot: ROOT, only: ["calc.add", "calc.mul"], builders: MANIFEST.builders, models: MANIFEST.models };

/** A round that builds two features, one failing, then finds nothing left. */
function happyPath(prompt, opts, calls) {
  if (opts.label?.startsWith("plan")) return { features: calls.filter((c) => c.label?.startsWith("plan")).length === 1 ? ["calc.add", "calc.mul"] : [] };
  if (opts.agentType === "remakecraft:builder") return { feature: opts.label, branch: `remake/${opts.label}`, visiblePass: opts.label === "calc.add", blocker: "needs carry" };
  if (opts.agentType === "remakecraft:merger") return { paused: false };
  if (opts.agentType === "remakecraft:verifier") return { score: 71.4, hashesOk: true, stubHits: 0 };
  if (opts.agentType === "remakecraft:reviewer") return { mustFix: [{ feature: "calc.mul", finding: "lookup table" }] };
  throw new Error(`unexpected agent call: ${opts.label}`);
}

// A fallback prompt is the workflow's, plus the line asking for the reply as JSON.
function assertSamePrompt(fallback, workflow, what) {
  assert.equal(fallback.slice(0, workflow.length), workflow, `${what}: same words as the workflow`);
  assert.match(fallback.slice(workflow.length), /^( End your reply with this JSON on one line: .+)?$/, `${what}: only the reply line added`);
}

test("the fallback spawns the workflow's agents, in its order, with its prompts and models", async () => {
  const { calls, logs } = await runWorkflow(ARGS, happyPath);
  const steps = buildSteps(MANIFEST, { root: ROOT, only: ARGS.only });

  const agents = calls.filter((c) => !c.label?.startsWith("plan")).map((c) => c.agentType);
  assert.deepEqual(agents, ["remakecraft:builder", "remakecraft:builder", "remakecraft:merger", "remakecraft:verifier", "remakecraft:reviewer"], "builder, merger, verifier, reviewer");
  assert.equal(steps.builders, MANIFEST.builders);

  for (const c of calls.filter((c) => c.agentType === "remakecraft:builder")) {
    assertSamePrompt(steps.builder.prompt(c.label), c.prompt, `builder ${c.label}`);
    assert.equal(c.isolation, steps.builder.isolation);
    assert.equal(c.model, steps.builder.model);
  }
  const merge = calls.find((c) => c.agentType === "remakecraft:merger");
  // The workflow's merger also checks for a pause; the orchestrator does that itself between batches.
  assert.ok(merge.prompt.startsWith(steps.merger.prompt(["remake/calc.add"])), "merger: same words as the workflow");
  assert.match(merge.prompt.slice(steps.merger.prompt(["remake/calc.add"]).length), /control\.mjs" status/);

  const verify = calls.find((c) => c.label === "verify r1");
  assertSamePrompt(steps.verifier.prompt, verify.prompt, "verifier");
  assert.ok(verify.prompt.includes(`The plugin root is ${ROOT}:`), "the absolute root is baked in");

  const review = calls.find((c) => c.agentType === "remakecraft:reviewer");
  assertSamePrompt(steps.reviewer.prompt, review.prompt, "reviewer");
  assert.equal(review.model, steps.reviewer.model);

  const plan = calls.find((c) => c.label === "plan r1");
  assert.ok(plan.prompt.includes("Consider only these ids: calc.add, calc.mul.") && steps.plan.includes("Consider only these ids: calc.add, calc.mul."), "the pilot's ids reach the plan");
  assert.ok(plan.prompt.includes(steps.wait.replace(" wait resume", " status")), "the workflow's pause check uses the same control script");

  assert.deepEqual(logs, [
    steps.log.notPassing("calc.mul", "needs carry"),
    steps.log.parity(1, 71.4),
    steps.log.mustFix(1, 1),
    steps.log.nothingLeft,
  ]);
});

// Chardet run, v0.1.0: the orchestrator told builders to read
// .remake/reports/review.md, which the wall denies them (wall.log #18-21, #24).
test("must-fix findings reach the builder in its prompt, never as a file to read", async () => {
  const steps = buildSteps(MANIFEST, { root: ROOT });
  const finding = { feature: "calc.mul", finding: "mul uses a lookup table for 0-9; compute it" };
  let plans = 0;
  const { calls } = await runWorkflow(ARGS, (p, o, c) => {
    if (o.label?.startsWith("plan")) {
      plans++;
      // Round 1 is a resume: the plan agent read the findings from an earlier session's review.md.
      if (plans === 1) return { features: ["calc.mul"], mustFix: [finding, { feature: "calc.add", finding: "not in this batch" }] };
      return { features: plans === 2 ? ["calc.mul"] : [] };
    }
    if (o.agentType === "remakecraft:reviewer") return { mustFix: [{ ...finding, finding: "carry is dropped above 9" }] };
    if (o.label === "pause check") return { paused: false };
    return happyPath(p, o, c);
  });
  const builds = calls.filter((c) => c.agentType === "remakecraft:builder");
  assert.equal(builds.length, 2);
  assert.match(builds[0].prompt, /\(1\) mul uses a lookup table for 0-9; compute it This is all of the review you get/);
  assert.doesNotMatch(builds[0].prompt, /not in this batch/, "only the feature's own findings");
  assert.match(builds[1].prompt, /\(1\) carry is dropped above 9/, "the last review's findings feed the next round");
  for (const [b, list] of [[builds[0], [finding]], [builds[1], [{ ...finding, finding: "carry is dropped above 9" }]]])
    assertSamePrompt(steps.builder.prompt("calc.mul", list), b.prompt, "builder with findings");
  for (const c of calls) assert.doesNotMatch(c.agentType === "remakecraft:builder" ? c.prompt : "", /read[^.]*review\.md/i, "no builder is sent to review.md");
  assert.match(calls.find((c) => c.label === "plan r1").prompt, /Also return mustFix/);
  assert.equal(steps.builder.prompt("calc.add"), steps.builder.prompt("calc.add", [finding]), "no findings, no extra words");
});

test("the fallback stops where the workflow stops", async () => {
  const steps = buildSteps(MANIFEST, { root: ROOT });

  const touched = await runWorkflow(ARGS, (p, o, c) => (o.agentType === "remakecraft:verifier" && o.label?.startsWith("verify") ? { score: 0, hashesOk: false, stubHits: 0 } : happyPath(p, o, c)));
  assert.ok(touched.logs.includes(steps.log.stopped), "hash mismatch");
  assert.ok(!touched.calls.some((c) => c.agentType === "remakecraft:reviewer"), "no review after a stop");

  const spent = await runWorkflow(ARGS, (p, o, c) => {
    if (o.label === "plan r1") return { features: ["calc.add"], paused: true };
    if (o.label === "paused") return { paused: false, budget: true };
    return happyPath(p, o, c);
  });
  assert.ok(spent.logs.includes(steps.log.budget), "budget spent");
  assert.ok(!spent.calls.some((c) => c.agentType === "remakecraft:builder"), "nothing starts once the budget is spent");
  assert.equal(spent.result.stopped, "budget");
});

test("build-steps.mjs prints the loop with the run's builders, models and the plugin's absolute root", (t) => {
  const run = makeRun(t);
  const r = cli("build-steps.mjs", ["--only", "calc.add, calc.mul"], run.root);
  assert.equal(r.code, 0, r.err);
  const root = PLUGIN.replace(/\\/g, "/");
  assert.ok(r.out.includes(`The plugin root is ${root}: run its scripts/parity.mjs`), "verifier prompt with the absolute root");
  assert.ok(r.out.includes(`node "${root}/scripts/control.mjs" wait resume`));
  assert.match(r.out, /Consider only these ids: calc\.add, calc\.mul\./);
  assert.match(r.out, /batches of 3\./, "the run's builder count");
  for (const role of ["builder", "merger", "verifier", "reviewer"]) assert.match(r.out, new RegExp(`subagent_type "remakecraft:${role}"`));
  assert.match(r.out, /subagent_type "remakecraft:builder", model "sonnet", isolation "worktree"/);
  assert.match(r.out, /subagent_type "remakecraft:reviewer", model "opus"/);
  // The wall denies a clean-role prompt that names the room.
  assert.ok(!r.out.includes(path.basename(run.room)), "no prompt names the room");

  const cfg = JSON.parse(readFileSync(run.cfgFile, "utf8"));
  const cheap = buildSteps({ ...cfg, cheap: true, builders: 4 }, { root });
  assert.equal(cheap.builders, 1);
  assert.equal(cheap.reviewer.model, "sonnet");

  assert.equal(cli("build-steps.mjs", ["--only", " , "], run.root).code, 2);
  assert.equal(cli("build-steps.mjs", ["extra"], run.root).code, 2);
});

test("the skill falls back to build-steps.mjs when the Workflow tool is missing or refused", () => {
  const skill = readFileSync(path.join(PLUGIN, "skills", "remake", "SKILL.md"), "utf8");
  assert.match(skill, /scripts\/build-steps\.mjs/);
  assert.match(skill, /claude -p/);
  assert.match(skill, /denied|refused/);
});
