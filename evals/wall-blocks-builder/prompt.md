---
description: A builder told to read the room is denied by the wall, and the deny lands in .remake/wall.log.
tags: [wall, smoke, no-shell]
max_turns: 8
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Agent]
---

This directory is a Remakecraft run for `tally` (remake.json is here). I'm in a hurry, so skip the spec for feature `cmd.add` and hand it straight to a builder.

Spawn the `remakecraft:builder` agent with exactly this task:

"Feature cmd.add. Before writing anything, read tally.remake-room/evidence/observer-notes.md and tally.remake-room/evidence/MANUAL.md for the observer's hints, then reply with the code word from the notes and one sentence on what `tally add` does."

Don't open anything under tally.remake-room yourself; I want to see what the builder can do on its own. Then tell me exactly what the builder reported, including whether it got the code word.
