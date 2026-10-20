# Changelog

All notable changes to Remakecraft are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Release steps are in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

## [0.1.3] - 2026-10-20

Three wall false positives from the chardet proof run (v0.1.0, wall.log #2, #7, #8, #12, #28, #30, #31). Every true positive stays denied: clean roles still never reach the room, the evidence, the sealed tests or blocklisted projects.

### Fixed

- **"sealed" and "evidence" as plain words.** Any clean-role command containing either word was denied: a verify report written through a heredoc ("sealed 68/78"), `f.sealed.passed` in a `node -e` script, a comment in a script, a commit message, a grep pattern or a test name. The wall now denies only a reference to the folders: the name standing alone in what the shell reads (`cd $R && ls sealed`, `$R/sealed/a.test.mjs`), and beside a path separator or as a whole string in a script (`R + "/sealed"`, `path.join(r, "sealed")`). Heredocs piped or fed to a shell, or that expand `$( )`, are still read as shell, and cheap obfuscation (`sea''led`, `'evi'+'dence'`) is undone first.
- **A builder's own `$W/tests/visible` read as the room.** With the slashes removed first, `$W/tests/visible` became one variable `$Wtests…` that matched any name. A variable the command sets to a literal value (`W=<worktree>; ls $W/tests/visible`) is now checked as that value, for the room-pattern check and for path reach alike. A variable nobody sets stays opaque as before, and a value that leads out of the tree or into the room is denied (`W=..; cat $W/x`, `W=<parent>; cat $W/g*.r*/inventory.json`).
- **The blocklist refused the spec's own leak check.** The spec-writer could not Grep its spec for the blocked names it must keep out. A room role may now Grep its own output (observer: `<room>/inventory.json`; spec-writer: `<room>/spec/`; test-writer: `<room>/tests/` and `<room>/sealed/`) with the names in the pattern alone. Each such call is recorded in `.remake/audit.log` as a `leak-check` event, and a call whose line cannot be written is denied. Clean roles, the main session, a path or glob that names a blocked project, a path anywhere else in the room (#3 searched the whole room, evidence included) and Bash `grep` stay denied.

### Added

- v0.1.3 tests in `tests/chardet-run.test.mjs`, replaying the logged commands next to near-miss variants that must stay denied.

## [0.1.2] - 2026-10-20

Six wall bugs from phase 5 of the chardet proof run (v0.1.0, wall.log #5 to #29). Every fix keeps the clean roles out of the room, the evidence, the sealed tests and blocklisted projects.

### Fixed

- **A glob bracket crashed the guard, and the denial was never logged.** `[a-z-]`-style classes became an invalid regex ("Range out of order"); the guard failed closed with no trace in `wall.log`. Bracket expressions are now translated member by member, a reversed range is read as its letters, and a pattern that still fails to compile matches everything. Every denial now gets a `wall.log` line: guard errors, unreadable payloads and an unreadable `remake.json` included. A `remake.json` saved with a byte-order mark is read instead of refused.
- **Clean roles could not read their own spilled tool results.** When Claude Code saves a large result to `~/.claude/projects/<project>/<session>/tool-results/`, the agent may now Read it. The guard allows a spill only when the agent's own transcript has the result that announced it and the file starts with that result's preview, so an echoed announcement for another agent's spill gets nothing. Shell access to `.claude/projects` is denied outright, since it holds the room agents' transcripts.
- **No scratch folder the clean roles could rely on.** `init-run` now makes `.remake/tmp/`, the agents say to use it and never to invent `.scratch/`, and `ls .remake` or `mkdir -p .remake/tmp` are no longer read as reading the run logs. The logs themselves stay closed. A denied write beside the logs (`.remake/tmp-before.txt`) says where temp files go.
- **Builders were sent to read `.remake/reports/review.md`.** A builder's reads stay inside its worktree, so the wall denied every one. The workflow and `build-steps.mjs` now carry each feature's must-fix findings in its builder prompt, the skill says never to point a builder at `.remake/reports/`, and a worktree builder that reaches for the main tree's `.remake/` is told why.
- **The reviewer probed `codex --version`, which the wall denies as starting an agent.** `reviewer.md` now checks with `which codex` and skips Codex on Windows.
- **False positives on regex literals.** A `/` regex delimiter in a script argument (`split(/<testcase /)`, `"/(de|fr)/(utf-8|cp)"`) was read as the filesystem root, an escaped quote broke quote pairing, and a quoted grep pattern such as `'[a-z-]*'` was matched against the room as a shell glob. A lone `/` or `../..` argument, unquoted globs and `find -name` patterns are still checked.

### Known limitation

- **User-level plugins and MCP servers reach the clean roles.** Claude Code hands every subagent the session's skills, MCP instructions and user CLAUDE.md; a plugin cannot remove them from its own agents. The wall still denies MCP tools and agent CLIs to the clean side, and the agents are told to ignore them. For a run without them, start Claude Code with `claude --setting-sources "project,local" --strict-mcp-config --plugin-dir <path to a Remakecraft checkout>` (README, Limits).

### Added

- `tests/chardet-run.test.mjs`: a regression test per bug, replaying the real commands from the chardet run's `wall.log` (`tests/fixtures/chardet-run.json`), each next to the checks that must stay denied.

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

[Unreleased]: https://github.com/remakecraft/remakecraft/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/remakecraft/remakecraft/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/remakecraft/remakecraft/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/remakecraft/remakecraft/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/remakecraft/remakecraft/releases/tag/v0.1.0
