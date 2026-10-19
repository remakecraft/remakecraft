---
description: A spec written from the tally evidence keeps behaviour and drops expression (prose, art, help text, internals).
tags: [spec, judge, no-shell]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent, Write, Edit]
---

This directory is a Remakecraft run for `tally`, a small command-line counter. The evidence (its manual and three recorded terminal sessions) is in `tally.remake-room/evidence/`. The inventory step was skipped for this tiny app.

Write the functional spec now: `tally.remake-room/spec/spec.json` as the source of truth and `tally.remake-room/spec/spec.md` rendered from it. If you have the `remakecraft:spec-writer` agent, use it. Builders will only ever see this spec, so it must be complete enough to rebuild tally from and clean enough to publish.

Write only inside `tally.remake-room/`. When it is done, reply with the feature count.
