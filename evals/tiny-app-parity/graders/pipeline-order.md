---
type: tool_order
weight: 1
before: { tool: Bash, input_match: 'publish\.mjs.{0,40}tests' }
after: { tool: Bash, input_match: 'parity\.mjs' }
---

Tests were published before parity was scored.
