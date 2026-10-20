# Run record: chardet 6.0.0, rebuilt as guessling

A clean-mode Remakecraft run against [chardet](https://github.com/chardet/chardet) 6.0.0 (LGPL-2.1-or-later),
done on 2026-10-19 and 2026-10-20 as a demo of the process. It is not a licensing move: chardet 7 is already 0BSD.
The clone, guessling, is not published here, on PyPI or anywhere else, and it is not a drop-in for chardet.

**Parity 241/251 (96.0%): visible 173/173, sealed 68/78 (87.2%).** 40 features, 4 h 22 min of run time,
$74.68 at API prices (opus $53.59, sonnet $21.08) on a Claude plan. 31 wall denials, none of them a reach for the
original, the evidence, the sealed tests or a blocklisted project.

## Files

| File | What it is |
|---|---|
| [`wall.log`](wall.log) | Every tool call the wall denied, one JSON line each: time, role, tool, the paths it named, the reason and a sha256 of the input. Never the input itself |
| [`audit.log`](audit.log) | Every agent start, and every prompt the main session sent an agent, in full |
| [`spec/spec.md`](spec/spec.md), [`spec/spec.json`](spec/spec.json) | Spec v2, the version the build ran against, as committed at `a2dbc37` |
| [`features.json`](features.json) | The 40 features with priority, layer and final status |
| [`parity/parity.json`](parity/parity.json) | The final parity report, scored at `1b2b55b` |
| [`parity/verify.md`](parity/verify.md) | The verifier's last report: layers, and sealed results as counts per feature |
| [`parity/history.jsonl`](parity/history.jsonl) | Every parity run, from the pilot's first 0% to the final 96% |
| [`parity/visible-output.log`](parity/visible-output.log) | Output of the last visible-suite run |
| [`similarity.md`](similarity.md) | copydetect and JPlag numbers against chardet 5.2.0, 6.0.0, 7.0.0 and 7.7.0, with controls and matched file names |

## Wall denials

| Class | Pilot | Phase 5 | Total |
|---|---|---|---|
| Reached for the original, evidence, sealed tests or a blocklisted project | 0 | 0 | 0 |
| Reviewer tried to start another agent CLI (`codex --version`) | 0 | 2 | 2 |
| A rule hit on the run's own files or output (logs, reports, leak self-checks) | 8 | 9 | 17 |
| False positive | 4 | 8 | 12 |
| **Total** | **12** | **19** | **31** |

Three of the 31 are leak self-checks refused by the blocklist: the spec-writer, the test-writer and the main
session grepped their own output for `chardet`. Five more calls crashed the wall's guard, which failed closed but
wrote nothing to `wall.log` (bug 1 below).

## The finding

A builder wrote the original's UTF-8 confidence formula from training memory (`src/detect/utf8.mjs` at
`0606b22`). None of that batch's prompts held the constants (see `audit.log`), and neither did the spec or the
tests. The wall had nothing to match, and copydetect scores the file 0.0. The opus reviewer flagged it as
must-fix M3, and `b73250c` replaced it with the clone's own curve.

## Commits

| What | Commit |
|---|---|
| Plugin | remakecraft v0.1.0, `f468649` |
| Spec v2 published | `a2dbc37` |
| Tests v2 published (173 visible, 78 sealed) | `f218419` |
| Formula recalled from memory | `0606b22` |
| Replaced after review M3 | `b73250c` |
| Final, scored | `1b2b55b` |
| `remake.json` test commands fixed by hand (`--bin`, budget) | `4041a2d`, `2421bd5` |

Hashes are from the clone's private repo.

## Left out

- guessling's source and its tests, visible and sealed.
- Anything from chardet itself: the wheel, the sdists, docs, and the matched source regions from the similarity
  scan.
- The evidence folder (encoded public-domain texts and their labels).
- Environment files and keys. The run used no API key: both session inits report `apiKeySource: none`.

## Path scrub

Absolute local paths were rewritten before publishing. The run folder became relative (`guessling/…`,
`guessling.remake-room/…`), and other prefixes became placeholders: `<plugin>` for the Remakecraft checkout,
`<claude-projects>/<run>` for Claude Code's per-project folder, `<tmp>` for the temp folder, `<projects>` and `~`
for the rest. Nothing else was edited. The sha256 values in both logs were computed on the original input, so they
won't match the scrubbed text of `audit.log` prompts.

## Notes

- `parity.json` shows the sealed rate as 87.1; 68/78 is 87.18%.
- The 10 sealed misses fall on 10 features, 6 of them era tiers (`detect.era-*`). Those are where the clone fits
  the visible samples and generalises worst.
- The run found six plugin bugs (unescaped regex in the guard, unreadable tool-output spill files, no shared
  scratch folder, builders sent to a report they may not read, user-level plugins visible to clean roles, and `/`
  or `[a-z-]*` read as paths). [v0.1.2](https://github.com/remakecraft/remakecraft/releases/tag/v0.1.2) fixes five; the user-plugin one comes from Claude Code and is documented with a workaround.
