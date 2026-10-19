---
description: Plugin vs raw Claude on planning a clean-room rebuild of tally. The README's delta figure. Read-only, so it runs anywhere.
tags: [baseline, judge, no-shell]
max_turns: 12
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill]
---

I want a from-scratch rebuild of `tally`, a little command-line counter whose author vanished. I don't have its source; its manual and three recorded terminal sessions are in `./evidence-inbox/`. I want to publish the rebuild under MIT, so it has to be clean.

Before you create anything, lay out the plan: the phases in order, who (which agent or step) reads what, what the code author is and isn't allowed to see, and how we'll know the rebuild behaves like the original. Don't write any files yet.
