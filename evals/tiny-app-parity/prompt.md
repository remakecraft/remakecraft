---
description: End to end on tally - init, spec, tests, build, parity - from docs alone, with the original hidden. Needs a shell, so Linux or macOS only (npm run eval:e2e); tests/tally-pipeline.test.mjs covers the scripted half everywhere.
tags: [e2e, slow, needs-bash]
max_turns: 200
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash, TodoWrite]
---

Rebuild the `tally` command-line counter from scratch. I don't have its source and you must not look for it. All I have is its manual and three recorded terminal sessions, in `./evidence-inbox/`.

Settings, so you don't need to ask me: app name `tally`, stack `web` (it's a Node CLI: `node src/tally.mjs <command>` from the app folder), output folder `./out`, one builder (cheap mode). I approve the spec in advance, so don't stop at the spec checkpoint, and skip the 10-feature pilot: tally is smaller than that.

Run the whole Remakecraft pipeline with the plugin's scripts (the `remake` skill shows their full path under the plugin root):

1. `node <plugin>/scripts/init-run.mjs tally --out ./out --stack web --cheap`, then copy everything in `./evidence-inbox/` into `./out/tally.remake-room/evidence/`.
2. Inventory and spec, then from `./out/tally`: `node <plugin>/scripts/publish.mjs spec`.
3. Tests, then from `./out/tally`: `node <plugin>/scripts/publish.mjs tests`.
4. Build every feature and commit it in `./out/tally` (parity scores the committed HEAD only), then from `./out/tally`: `node <plugin>/scripts/parity.mjs`.

Finish by telling me the parity score exactly as `.remake/reports/parity.json` states it, sealed results included.
