---
type: regex
weight: 2
target: { source: file, path: tally.remake-room/spec/spec.json }
pattern: '^(?=[\s\S]*nothing to undo)(?=[\s\S]*tally 1)(?=[\s\S]*999999)(?=[\s\S]*damaged)(?=[\s\S]*\b10\b)'
---

Keeps the functional facts a clone needs: the exact error texts, the save-file header, the amount bound and the 10-step undo limit.
