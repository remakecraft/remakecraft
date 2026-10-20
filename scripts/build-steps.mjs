#!/usr/bin/env node
// Phases 5 to 7 without the Workflow tool. Headless `claude -p` refuses the
// /remakecraft:build workflow (it waits for an interactive review nobody can
// give), so the orchestrator drives the same loop by hand: builder, merger,
// verifier, reviewer, as subagents one stage after another. This prints that
// loop for one run, with the workflow's agent types, prompts and log lines,
// the run's own models and builder count, and this plugin's absolute root
// baked in. tests/build-steps.test.mjs keeps it in step with workflows/build.js.
//
//   node scripts/build-steps.mjs [--app <app tree>] [--only <id,id,...>]
//
// --only limits the plan to those feature ids (the pilot's 10 in phase 4).

import { PLUGIN_ROOT, RunError, isMain, locateRun, main, parseArgs, toSlash } from "./lib/run.mjs";

export const ROUNDS = 3;

// The shape each agent's reply ends with: the workflow's schemas, as one JSON line.
const REPLY = {
  builder: '{"feature": "<id>", "branch": "<branch>", "visiblePass": true|false, "blocker": "<why, when not passing>"}',
  verifier: '{"score": <overall %>, "hashesOk": true|false, "stubHits": <count>, "overfit": ["<id>", ...]}',
  reviewer: '{"mustFix": [{"feature": "<id>", "finding": "<text>"}, ...]}',
};
const replyWith = (shape) => ` End your reply with this JSON on one line: ${shape}`;

/**
 * The loop's steps for a run. Prompts up to replyWith() are word for word the
 * workflow's; the merger leaves out the workflow's pause check, because the
 * orchestrator runs `control.mjs wait resume` itself before every batch.
 */
export function buildSteps(manifest, { root = PLUGIN_ROOT, only = [] } = {}) {
  const ROOT = toSlash(root).replace(/\/+$/, "");
  const builderModel = manifest.models?.builder ?? "sonnet";
  const control = `node "${ROOT}/scripts/control.mjs"`;
  return {
    root: ROOT,
    builders: manifest.cheap ? 1 : Math.max(1, Math.min(5, manifest.builders ?? 3)),
    rounds: ROUNDS,
    only,
    plan: `Read .remake/progress/features.json and .remake/reports/review.md if present. Take the ids of features that are not yet passing, must-fix review items first, then must, should, could.${only.length ? ` Consider only these ids: ${only.join(", ")}.` : ""}`,
    wait: `${control} wait resume`,
    status: `${control} status`,
    builder: {
      agentType: "remakecraft:builder", model: builderModel, isolation: "worktree",
      prompt: (id) => `Build feature ${id}. Branch name: remake/${id}. Return the branch and whether its visible tests pass.${replyWith(REPLY.builder)}`,
    },
    merger: {
      agentType: "remakecraft:merger", model: builderModel,
      prompt: (branches) => `Merge these branches into the app tree's main branch one at a time, running the visible suite after each and reverting any merge that breaks it: ${branches.join(", ")}. Update .remake/progress/features.json.`,
    },
    verifier: {
      agentType: "remakecraft:verifier", model: builderModel,
      prompt: `Verify the app tree now. The plugin root is ${ROOT}: run its scripts/parity.mjs by that absolute path.${replyWith(REPLY.verifier)}`,
    },
    reviewer: {
      agentType: "remakecraft:reviewer", model: manifest.cheap ? "sonnet" : (manifest.models?.reviewer ?? "opus"),
      prompt: `Review the work merged since the last review, then tag HEAD remake-reviewed.${replyWith(REPLY.reviewer)}`,
    },
    log: {
      nothingLeft: "Nothing left to build.",
      notPassing: (id, blocker) => `${id}: not passing${blocker ? ` (${blocker})` : ""}`,
      parity: (round, score) => `Round ${round}: parity ${score}%`,
      mustFix: (round, n) => `Round ${round}: ${n} must-fix findings`,
      stopped: "Stopping: tests or spec were touched, or stubs were found. See .remake/reports/verify.md.",
      budget: 'Stopping: the budget in remake.json is spent. Raise "budgetUsd" there and run /remakecraft:remake to resume.',
    },
  };
}

const agentLine = (s) => `subagent_type "${s.agentType}", model "${s.model}"${s.isolation ? `, isolation "${s.isolation}"` : ""}`;

/** The procedure as the orchestrator reads it. */
export function describeSteps(s) {
  return [
    `Build without the Workflow tool: up to ${s.rounds} rounds of the /remakecraft:build loop, driven from this session.`,
    "Spawn every agent with the subagent_type below: the wall takes the role from it, and audit.log records each spawn and its prompt.",
    "Never merge, verify or review in this session; it is not on the clean side. Say each quoted log line in chat as the workflow would log it.",
    "",
    "Each round:",
    "",
    `1 Plan. ${s.plan}`,
    `  None left: say "${s.log.nothingLeft}" and stop.`,
    `  Then run \`${s.wait}\`. Exit 5 means paused: run it again. Exit 7 means the budget is spent: say "${s.log.budget}" and stop.`,
    "",
    `2 Build. Split the ids into batches of ${s.builders}. Per batch, spawn one builder per feature, all in one message so they run in parallel:`,
    `  ${agentLine(s.builder)}`,
    `  prompt: ${s.builder.prompt("<id>")}`,
    `  For each reply with visiblePass false, say "${s.log.notPassing("<id>", "<blocker>")}".`,
    "",
    "3 Merge. When the batch has passing branches, spawn the merger once for all of them:",
    `  ${agentLine(s.merger)}`,
    `  prompt: ${s.merger.prompt(["<branch>", "<branch>"])}`,
    `  Then run \`${s.wait}\` as in step 1 before the next batch.`,
    "",
    "4 Verify. After the last batch:",
    `  ${agentLine(s.verifier)}`,
    `  prompt: ${s.verifier.prompt}`,
    `  Say "${s.log.parity("<round>", "<score>")}". When hashesOk is false or stubHits is above 0, say "${s.log.stopped}" and stop.`,
    "",
    "5 Review.",
    `  ${agentLine(s.reviewer)}`,
    `  prompt: ${s.reviewer.prompt}`,
    `  Say "${s.log.mustFix("<round>", "<n>")}". Must-fix findings are built first next round.`,
    "",
    `Then the next round, from step 1, up to round ${s.rounds}.`,
    "",
  ].join("\n");
}

export function buildStepsCli(argv, cwd = process.cwd()) {
  const { pos, flags } = parseArgs(argv, { value: ["app", "only"] });
  if (pos.length) throw new RunError("Usage: build-steps.mjs [--app <app tree>] [--only <id,id,...>]", 2);
  const only = flags.only === undefined ? [] : flags.only.split(",").map((id) => id.trim()).filter(Boolean);
  if (flags.only !== undefined && !only.length) throw new RunError("--only needs at least one feature id, comma-separated", 2);
  const { manifest } = locateRun(flags.app, cwd);
  return describeSteps(buildSteps(manifest, { only }));
}

if (isMain(import.meta.url)) main(() => { process.stdout.write(buildStepsCli(process.argv.slice(2))); });
