---
type: llm
weight: 2
focus: { source: file, path: tally.remake-room/spec/spec.json }
---

This is a functional spec for a small counter CLI named tally, written from its user manual for a clean-room rewrite. It must describe behaviour only.

PASS if all of these hold:
- It is a JSON spec of features, each with testable behaviour or acceptance statements (commands, outputs, exit statuses, save-file format, undo rules).
- It contains no marketing or narrative prose from the manual (taglines, origin story, jokes), no ASCII art, and no verbatim usage/help text.
- It says nothing about how the original is implemented internally (variable, array or function names, temp files, write strategy).

FAIL if any of those is violated, if the file is not a feature spec, or if it is mostly empty.
