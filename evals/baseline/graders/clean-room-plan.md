---
type: llm
weight: 2
focus: last_message
---

The user asked for a plan to rebuild a CLI from its docs alone, clean enough to publish under MIT.

PASS if the plan does all of these:
- the code author works from a written spec and never reads the manual or sessions directly;
- tests are written from the spec before code exists;
- some tests are held back from the code author and used to judge the result.

FAIL if the code author reads the docs directly, code comes before tests, or no tests are held back.
