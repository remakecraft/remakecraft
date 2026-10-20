---
name: remake
description: Rewrites an existing desktop or web app from scratch as a clean-room clone. Inventories the original, writes a functional spec behind an enforced wall, generates conformance tests (with a sealed holdout) before any code, builds with parallel agents, and scores parity honestly. Use when the user wants to clone, remake, rebuild or rewrite an app they may lawfully use but do not have the source for. Not for DRM, licence checks, anti-cheat or security software.
license: MIT
compatibility: Claude Code enforces the clean-room wall with hooks and runs the phases with plugin agents. Other agents get the same procedure as instructions only; see AGENTS.md in the Remakecraft repo. Needs Node 20+.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*) Read Glob Grep
---

# Remake an app, clean-room

Arguments: `<app name> [--stack rust-egui|tauri|web] [--builders 1-5] [--cheap] [--budget <usd>] [--bin <entry>] [--out <dir>] [--with-rea | --open] [--basis own|license|authorized]`

`${CLAUDE_PLUGIN_ROOT}` below is the Remakecraft plugin root. Agents without plugin support use the root of a Remakecraft checkout instead, play each `remakecraft:*` role themselves in a fresh context, and follow the rules in its AGENTS.md, since nothing enforces the wall for them.

Rules that survive compaction, in priority order:

1. **Never read the original's code, unless the run's mode allows it.** Clean (the default): nobody decompiles, disassembles or opens `<room>/original/`. `--with-rea`: only the observer may, through REA and the decompilers, and writes behaviour only; publish refuses code that crosses (exit 9). `--open`: every role may, and every report says "open mode: not clean-room". Existing reimplementations stay off-limits in every mode. The plugin's wall enforces the mode in remake.json; do not try to route around it.
2. **Builders see only `spec/` and `tests/visible/`.** Evidence and sealed tests live in the room, outside the app tree.
3. **Tests come before code** and builders never edit them. The harness, not the builder, decides pass or fail.
4. **Report the score honestly.** Sealed results count. Never round up, never drop a failing layer from the table.
5. **Refuse protected targets.** No DRM, copy protection, licence or activation checks, anti-cheat or security software, and never bypass a protection to run or inspect the original. If the user asks, decline and point to LEGAL.md in the Remakecraft repo.

## Layout

```
<out>/<app>/                 app tree, a git repo; builders work in worktrees of it
  remake.json                run manifest: app, stack, mode, commands, blocked terms, mcpAllow (tracked)
  spec/spec.json, spec.md    published spec (copied from the room after approval)
  tests/visible/             visible conformance tests
  .remake/                   gitignored: progress/, reports/, wall.log, audit.log, local.json
<out>/<app>.remake-room/     the room: evidence/, original/, inventory.json, spec/, tests/, sealed/, hashes.json
```

Stacks: `rust-egui` (needs `cargo install cargo-nextest --locked`), `web` and `tauri`. Their test commands live in remake.json `commands` and must write a JUnit or TAP file to `{report}`; see `scripts/lib/stacks.mjs` for the placeholders.

## Phases

Modes: start clean unless the user asks for `--with-rea` or `--open`. Both need `--basis own|license|authorized`, which only the user may state: they own the app, its license allows it, or they are authorized. Never choose it for them. Tell them decompiling may breach the app's EULA and that whether they may is their call; init-run refuses without a basis (exit 2). Sealed tests stay sealed and hashed in every mode.

`init-run.mjs` copies this checklist into `.remake/progress/checklist.md`; tick it there as you go. A run exists when the session folder or `<out>/<app>` holds remake.json: that is a resume. Read the checklist first and continue from the first unticked line. Look at run files with Read and Glob, not `ls` or `cat`: init-run pre-approves edits in the app tree and the room, the plugin's scripts and the original as a black box in `.claude/settings.local.json`, and shell reads outside that cost the user a prompt. Run each script call alone, not chained with `;`, `&&` or `echo $?`: the exit code is reported anyway.

- [ ] **0 Setup.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/init-run.mjs" <app> --out <dir> --stack <stack> [--builders N] [--cheap] [--budget <usd>] [--bin <entry>] [--with-rea | --open --basis <basis>]`. Ask the user for the stack and output folder if they did not say (default: a new folder per app). When the target is a CLI or anything else the suites start as a program (`web` and `tauri`), pass `--bin` with the clone's entry point relative to the app tree, such as `--bin bin/<app>.mjs`: both test commands then run every test against it, and without it the suites have no program to start and score 0. A run set up without it gets the same ` --bin "<entry>"` appended to `testVisible` and `testSealed` in remake.json, committed before phase 4. Have the user put screenshots, recordings and docs into `<room>/evidence/`, and, if they can, the original app or a launcher for it into `<room>/original/` so the observer can run it as a black box. Nobody may open the files there; the wall enforces it. Add known open-source reimplementations of the target to `blocked` in remake.json. If init-run says to restart, stop: builders need worktrees, and Claude Code only makes them for a session started inside a git repo. Tell the user to restart Claude in the app tree and run `/remakecraft:remake <app>` to resume. Otherwise start the live progress page with `node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" --app <out>/<app> --detach` (a normal command, not a background one: it returns once the page answers) and give the user the URL it prints.
- [ ] **1 Inventory.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/control.mjs" evidence --app <out>/<app>`; exit 8 means `evidence/` is empty, so show its message and wait for the user. Then spawn `remakecraft:observer`. Show the user the counts and the UNKNOWN list; ask for missing evidence.
- [ ] **2 Spec.** Spawn `remakecraft:spec-writer`. **Human checkpoint:** show the feature count, the must/should/could split and spec.md, and wait for an explicit yes, in chat or on the run page: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/control.mjs" wait spec --app <out>/<app>` and repeat it while it exits 5. Exit 0 is a yes and prints a cost estimate from the feature count: show it as an estimate. Exit 6 prints the requested changes, which go back to the spec-writer. Headless, the user answers with `control.mjs approve` or `control.mjs changes "<note>"`. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/publish.mjs" spec --app <out>/<app>`. Any later change to the spec, a typo fix included, goes back through this checkpoint before you publish it again.
- [ ] **3 Tests.** Spawn `remakecraft:test-writer`. Then, when `<room>/original/` holds something the suites can drive as a command, check the tests against it: from the room, run each suite with `REMAKE_APP_BIN` pointing at the original (Node: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runners/node-suite.mjs" <room>/tests/visible <room>/oracle-visible.xml --bin <room>/original/<entry>`, then the same for `<room>/sealed`; other stacks set the variable for their own test command). Every test the original fails goes back to the test-writer, or to the spec-writer when the spec is what is wrong, and you check again; say in the report how many came back. Running the original is black-box observation, allowed in every mode. Skip this step when the original is a GUI the suites cannot start. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/publish.mjs" tests --app <out>/<app>`. This copies the visible tests into the app tree and records the hashes of both sets. Exit 9 (a run started `--with-rea`) lists the lines that carry code; send them back to the test-writer. Exit 9 from `publish.mjs spec` goes back to the spec-writer the same way.
- [ ] **4 Pilot.** Build 10 `must` features (step 5 limited to them), verify, and report tokens, time and pass rates per feature. Extrapolate the full run and ask the user to continue.
- [ ] **5 Build.** Pick the next unbuilt features from `.remake/progress/features.json`. Spawn `remakecraft:builder` per feature with `isolation: worktree`, up to `builders` at once (1 in cheap mode). Spawn `remakecraft:merger` to merge the passing branches; do not merge them in this session, which is not on the clean side. Before each batch run `node "${CLAUDE_PLUGIN_ROOT}/scripts/control.mjs" wait resume --app <out>/<app>`; while it exits 5 the user has paused the run, so run it again. Exit 7 means the budget is spent: stop and show its message, which says how to resume.
- [ ] **6 Verify.** Spawn `remakecraft:verifier` after each merge batch. Its prompt gives the app tree and the plugin root, never the room: parity.mjs finds the sealed tests itself, and the wall refuses a clean-role prompt that names the room. A hash mismatch (parity exit 3) or stub hit (exit 4) stops the run.
- [ ] **7 Review.** Spawn `remakecraft:reviewer` every batch. Send must-fix findings back to step 5 as new work.
- [ ] **8 Report.** When the score stops rising or the user stops, show the parity table from `.remake/reports/parity.json` and the wall log count.

When the Workflow tool is available, run the `/remakecraft:build` workflow for phases 5 to 7 (pass `only` with the pilot ids in phase 4, and `pluginRoot` set to `${CLAUDE_PLUGIN_ROOT}` so the agents get an absolute path) instead of driving them by hand. It cannot take input mid-run, so do the human checkpoint in phase 2 first. Headless `claude -p` stops background work 10 minutes after its last turn, which kills the workflow mid-build; headless runs need `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`.

## Live progress page

`serve.mjs` serves a page on 127.0.0.1 only (`--port` to move it off 4317) that shows the phase, parity per layer with sealed results as counts, overfit flags, each feature, the agents and the wall log. It reads only files the run already writes and never shows a sealed test's name. Start it in phase 0, or later with `--app` when resuming. `--detach` keeps it out of Claude Code's background commands, which are stopped after two hours, so the page lasts the whole run; a second `--detach` on a page that is already up only reports it. `serve.mjs --stop --app <tree>` closes it after phase 7.

The page's Pause and spec buttons write `.remake/control.json`; the `control.mjs` calls above are where the run reads it. Tokens and cost come from `.remake/progress/usage.json`, which `control.mjs status` and `wait resume` rewrite from the session transcripts; run `control.mjs status` after each batch. The cost is an estimate from a price table, close to Claude Code's own figure on the tally runs. `serve.mjs --demo` plays a simulated run without touching any files.

## Models

Planners and reviewers run on Opus, builders on Sonnet, unless remake.json `models` overrides them. In cheap mode everything runs on Sonnet with one builder. Every Agent call you make sets `model` from remake.json `models`: `planner` for the observer, spec-writer and test-writer, `builder` for builders, the merger and the verifier, and `reviewer` for the reviewer, the Claude fallback included. An agent's own frontmatter is only the full-mode default, so leaving `model` out puts a cheap run's reviewer on Opus. This session stays on whatever model the user picked, and on the tally runs it was half the cost: in cheap mode, say once at phase 0 that `/model sonnet` before the run is the biggest saving left. `models.codex` picks the model for the Codex review (`codex exec -m`); leave it unset to use Codex's default.
