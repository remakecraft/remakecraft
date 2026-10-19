# Security policy

The security bug that matters most in Remakecraft is a **wall bypass**: any way an agent inside a run can reach what the clean room is meant to keep from it. The project's claim rests on the wall, so a bypass is treated like a vulnerability, reported privately and fixed before it is discussed in public.

## Report privately

Use GitHub's private reporting form:

**[Report a vulnerability](https://github.com/remakecraft/remakecraft/security/advisories/new)**

That form is the only private channel for security reports.

Do not open a public issue, pull request or Discussion with a working bypass until a fix has shipped. A public issue is fine for hardening ideas and for bypasses that are already fixed; use the [wall-bypass template](https://github.com/remakecraft/remakecraft/issues/new?template=wall-bypass.yml) for those.

## What counts as a wall bypass

Inside a Remakecraft run (a directory with a `remake.json`), any of these:

| Bypass | Example |
|---|---|
| A clean-side agent (builder, merger, verifier, reviewer) reads the room | Reaching `<app>.remake-room/`, its evidence or the sealed tests through a path, glob, symlink, junction, shell expansion, environment variable or a tool the guard does not inspect |
| A builder changes the yardstick | Editing `tests/`, `spec/`, `remake.json` or `.remake/` in the app tree, or getting another process to do it |
| The test-writer sees evidence | Reading `<room>/evidence/` directly or through an intermediary |
| A decompiler or disassembler runs | Any route that gets one past the shell-token check, for any role, the main session included |
| A blocklisted implementation gets in | Fetching, reading or searching a term on the run's `blocked` list without the wall catching it |
| The wall fails open | Any input that makes `hooks/guard.mjs` allow a call it should deny, instead of crashing closed |
| Logs can be silenced | A denied call that never reaches `.remake/wall.log`, or an agent start missing from `.remake/audit.log` |
| The parity score can be faked | A builder getting the harness to pass sealed tests it has not earned |

A good report has: the Remakecraft version, OS, the agent role, the exact tool call or command, what it reached, and the wall log lines (or their absence).

## What does not count

- **Outside a run.** With no `remake.json` up the tree the wall is down by design.
- **Agents without hooks.** In Codex, Cursor, Gemini CLI and other agents the rules in `AGENTS.md` are instructions only. Nothing enforces them, and the README says so.
- **The main session acting as a human would.** The main session is not a clean-side role. It is only blocked from decompilers and blocklisted terms.
- **A user disabling the plugin or editing the hooks.** The wall protects a run from its own agents, not from the person running it.
- **Hooks are not a sandbox.** A bypass that needs code execution outside the agent's tool calls (a compromised toolchain, a malicious dependency) is out of scope for the wall, though we still want to hear about it.

## What happens next

| When | What |
|---|---|
| Within 3 days | You get an acknowledgement |
| Within 7 days | We confirm or decline it, with a reason |
| Within 30 days | A fix ships in a patch release, or we tell you why it needs longer |
| After the release | The advisory is published, crediting you unless you ask not to be named |

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| Older | No, upgrade |

## Rights holders and takedown requests

Not a security issue, but often sent here: if you hold rights in an app, a trademark or a work and believe something the project publishes infringes them, email remakecraft@proton.me. You get an acknowledgement within 3 business days, and within 7 days the material is changed or removed or you get a reasoned reply. Details and what to include: [LEGAL.md](LEGAL.md#rights-holders).

## Other security issues

Anything else (a dependency issue, a script that mishandles paths, a secret in the repo) goes through the same private form.
