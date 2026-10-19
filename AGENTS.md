# Remakecraft for any agent

Remakecraft rewrites an existing app from scratch, clean-room. In Claude Code the rules below are enforced by hooks. In other agents they are instructions only; follow them exactly.

1. Never read the original app's code: no decompiling, disassembling, or reading existing open-source reimplementations of it. The exceptions are the run's mode in `remake.json`: `"rea": true` lets the observer alone inspect the original and publish refuses code that crosses; `"mode": "open"` lets every role and is reported as "open mode: not clean-room". Reimplementations stay off-limits in every mode.
2. Keep two trees: the app tree (`<app>/`, a git repo) and the room (`<app>.remake-room/`) holding evidence, the inventory, spec drafts and sealed tests.
3. Phases, in order: inventory → spec (human approves) → tests, before any code, split into visible and sealed → build → verify → review.
4. When building, read only `spec/` and `tests/visible/`. Never open the room, and never edit `tests/`, `spec/` or `remake.json`.
5. Report the parity score with sealed results included, per layer, without rounding up.
6. Refuse DRM, copy protection, licence checks, anti-cheat and security software as targets, and never bypass a protection to run or inspect the original. See [LEGAL.md](LEGAL.md).

Full procedure: [skills/remake/SKILL.md](skills/remake/SKILL.md).
