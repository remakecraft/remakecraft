---
name: try
description: Stages a guided first Remakecraft run on a bundled toy app (tally, a 50-line command-line counter) in cheap mode with a budget cap, and says what it will cost and how long it takes before anything is spent. Use when the user wants to try, demo or test-drive Remakecraft, or asks what a run looks like before pointing it at a real app.
license: MIT
compatibility: Claude Code. Needs Node 20+ and git on PATH.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/try.mjs" *) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/try.mjs")
---

# Try Remakecraft on a toy app

Arguments: `[--full] [--budget <usd>] [--out <dir>] [--with-rea]`

`--with-rea` stages the same toy in REA mode: the observer alone may inspect the original through [REA](https://github.com/morluto/rea), whose MCP server the script registers in the app tree at a pinned version (npx downloads it on first use). The basis is `license`, because the toy ships under the plugin's MIT licence; never pass `--with-rea` to init-run for any other app on the user's behalf.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/try.mjs"` with the user's arguments. It stages the tally fixture into a fresh folder (default `~/remakecraft-try/<timestamp>/`): the fixture's docs become `<room>/evidence/`, its program becomes the black-box `<room>/original/`, and init-run lays out a cheap run with an $8 budget. Never open `evals/fixtures/toy-original/` yourself: the wall cannot see the plugin folder, so this rule is yours to keep.
2. Show the user the script's cost and time lines as printed. The full-mode figures are measured; the cheap-mode figure is labelled an estimate, so keep the label.
3. Give the user the `cd … && claude "/remakecraft:remake tally"` line it prints, to run in a new terminal. Builders need worktrees, and Claude Code only makes them for a session that starts inside the app tree, so the run cannot continue in this session. On PowerShell 5, use `;` in place of `&&`.

If the script fails, show its message; do not stage the run by hand.
