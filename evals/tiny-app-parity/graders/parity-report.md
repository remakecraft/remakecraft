---
type: regex
weight: 1
target: { source: file, path: out/tally/.remake/reports/parity.json }
pattern: '"sealed": \{\s*"passed": \d+,\s*"total": [1-9]'
---

parity.mjs wrote its report and scored at least one sealed test. tests/tally-pipeline.test.mjs checks this pattern against a real report.
