---
type: regex
weight: 2
target: { source: file, path: tally.remake-room/spec/spec.json }
pattern: 'count on it|shepherd|notches|espresso|rainy tuesday|sticky note|flushState|\bhist\b|\.tally\.tmp|__,_|\|__/|usage: tally \['
flags: i
match: not_contains
---

Free of the manual's expression: the banner and tagline, the "Why tally?" prose, the colophon's internals (array and routine names, temp-file write), and the help text the manual says is not part of the contract.
