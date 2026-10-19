---
type: llm
weight: 3
focus: { source: file, path: out/tally/.remake/reports/parity.json }
---

This is a parity report for a clean-room rewrite of a small counter CLI, produced by running visible and sealed conformance tests.

PASS if the report shows an overall parity score of at least 90% (0.9), the sealed suite ran with at least one test, and it reports no hash mismatch or stub hit.
FAIL if the score is below 90%, the sealed suite is missing or empty, a hash mismatch or stub hit is reported, or the file is not a parity report.
