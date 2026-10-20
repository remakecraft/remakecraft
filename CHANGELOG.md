# Changelog

All notable changes to Remakecraft are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Release steps are in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

## [0.1.1] - 2026-10-20

Two fixes from the chardet proof run, a CLI cloned on the `web` stack under `claude -p`.

### Fixed

- **CLI targets scored 0.** The `web` and `tauri` presets never passed `--bin` to the Node suite runner, so suites that start the app through `REMAKE_APP_BIN` had no program to run: the first parity run of the proof run scored 0/235 until `remake.json` was fixed by hand. `init-run.mjs --bin <entry>` now puts `--bin "<entry>"` on both test commands and on the app's `npm test`. The path is relative to the app tree, so parity runs HEAD's entry in its scratch checkout; it is checked to stay inside the tree, and the Rust preset refuses it (its tests use `CARGO_BIN_EXE_<name>`). The skill, builder and test-writer say when to use it.
- **`/remakecraft:build` could not run headless.** Under `claude -p` the Workflow tool waits for an interactive review and is denied. The skill now falls back when the tool is missing or refused: `scripts/build-steps.mjs` prints the workflow's loop for the run (builder, merger, verifier, reviewer, with the workflow's agent types, prompts and log lines, the run's builder count and models, and the plugin's absolute root), and the session drives it with subagents. The interactive workflow is unchanged.

### Added

- Tests: a CLI run scored end to end with and without `--bin`, `--bin` path checks, and the workflow script run with fake Workflow globals to hold the fallback to the same agents, prompts, order and stop conditions.

## [0.1.0] - 2026-10-19

First public release.

### Added

- `LEGAL.md`: what Remakecraft is and is not for, what each mode means, no warranty, and how rights holders reach the author. Linked from a new README "Responsible use" section and from SECURITY.md.
- `remake` skill: inventory, spec with a human checkpoint, tests before code, build, verify, review, report.
- Six agents with separate roles: observer, spec-writer and test-writer in the room; builder, verifier and reviewer on the clean side.
- Hook-enforced clean-room wall: a hook denies clean-side calls that name the room and builders' Write and Edit calls to `tests/`, `spec/` and `remake.json`, and refuses decompilers and blocklisted names for every role. The guard fails closed.
- `.remake/wall.log` records every denied call; `.remake/audit.log` records every agent that starts in a run.
- `build` workflow that runs build, verify and review in parallel worktrees.
- `AGENTS.md` with the same rules for agents that do not run Claude Code hooks.
- `try` skill: stages the bundled tally toy app as a cheap run with an $8 budget, and states the measured and estimated cost first.
- `--budget <usd>` on init-run: cost is summed from the session transcripts into `usage.json`, and the run stops at the next batch once it is spent.
- `control.mjs approve | changes "<note>"` for headless spec approval, `control.mjs evidence` to refuse phase 1 on an empty `evidence/`, and a cost estimate after the spec checkpoint.
- Wall unit tests, and a CI workflow that runs `npm test` on Ubuntu, Windows and macOS with Node 20.
- A merger role: builder branches are merged by a clean-side agent, not the orchestrator.
- README: Claude Code 2.1.295+ and Node 20+ requirements, a summary of what the wall enforces and what it does not, above the fold, a measured toy-run scoreboard row, and an FAQ.
- Claude Code version preflight: `init-run.mjs` and `try.mjs` refuse to start a run below Claude Code 2.1.295, where the wall's `onFailure: "block"` is missing and it fails open; an unreadable version only warns.
- The build workflow takes a `pluginRoot` arg and bakes absolute script paths into agent prompts, since `${CLAUDE_PLUGIN_ROOT}` is not reliably set in agent Bash.
- Community files: contributing guide with scoreboard submissions, code of conduct, security policy, issue, pull-request and discussion templates, the 3-day feature vote, and a local release procedure.

### Changed

- The wall is documented as a logged tripwire, not a sandbox. Clean roles are denied the agent CLIs (`claude`, `codex`, `gemini`), run logs and cheap shell obfuscation.
- The guard fails closed inside a run, and `.remake/wall.log` records the tool, the target paths and a sha256 of the input, never the content.
- Builder code can no longer rewrite the tests it is scored by: sealed hashes are checked again after the build and the test run.

### Measured

- Toy app (tally, bundled in `evals/fixtures`): 187 of 191 conformance tests pass (97.9%, sealed tests included), 35 minutes, $6.29 in tokens, run on Windows. The cost is a floor.
- Brushling (Paint-style app, Rust + egui): 470 of 471 (99.7%), 154 of 154 sealed, 2 h 56 min wall, $41.08 in tokens. The one failure is a spec defect the review caught.
- Sweepling (Minesweeper): 265 of 265, about $30, run overnight unattended. Its tests are headless, so its dialogs were never checked in a real window.

[Unreleased]: https://github.com/remakecraft/remakecraft/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/remakecraft/remakecraft/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/remakecraft/remakecraft/releases/tag/v0.1.0
