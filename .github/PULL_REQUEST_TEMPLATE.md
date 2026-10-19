## What and why

<!-- One or two lines. Link the issue or the vote it comes from: "Closes #12", "Won poll #34". -->

## How I checked it

<!-- CI does not run on this repo, so say what you ran. -->

- [ ] `npm test`
- [ ] `claude plugin validate . --strict`
- [ ] Tried it in a real run (say which app and stack):

## Wall

- [ ] This PR does not touch `hooks/`.
- [ ] Or: it does, every new allow or deny has a test in `tests/wall.test.mjs`, and I describe below anything that is now allowed which was blocked before.

## Clean-room attestation

- [ ] I did not copy code from any app Remakecraft targets, from decompiled or disassembled output, from leaked source, or from an existing open-source reimplementation of a target app. Everything here is my own work or is MIT-compatible and its source is named in this PR. My commits are signed off (`git commit -s`).

## Scoreboard submission (only if this PR adds `gallery/<clone>/`)

- [ ] Built end to end with a released Remakecraft version, named in `entry.json`.
- [ ] `wall.log`, `parity.json` and `licence-scan.json` are unedited apart from redacting my home path.
- [ ] `parity` and `sealed_pass_rate` in `entry.json` match `parity.json`; `wall_denials` matches the line count of `wall.log`.
- [ ] The licence scan shows no copyleft code in a permissively licensed clone.
- [ ] The clone has its own name and icons, a licence file, and the not-affiliated disclaimer in its README.
- [ ] The original is not DRM, anti-cheat or security software.

## Changelog

- [ ] Added a line under `[Unreleased]` in `CHANGELOG.md`, or this change is not user-visible.
