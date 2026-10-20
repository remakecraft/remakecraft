# Contributing to Remakecraft

Pull requests are welcome. So are clone submissions for the scoreboard, bug reports, and votes on what gets built next.

Remakecraft is early alpha. Things move fast, and the clean-room wall is the part that has to stay trustworthy while they do.

| You want to | Go to |
|---|---|
| Report a bug | [Bug issue](https://github.com/remakecraft/remakecraft/issues/new?template=bug.yml) |
| Report a way past the wall | **Privately**, see [SECURITY.md](SECURITY.md). Never in a public issue. |
| Ask for an app to be cloned | [Clone request](https://github.com/remakecraft/remakecraft/issues/new?template=clone-request.yml) |
| Propose a feature | [Feature vote](https://github.com/remakecraft/remakecraft/issues/new?template=feature-vote.yml), then vote in the [3-day poll](docs/feature-vote.md) |
| Show off a clone | [Show and tell](https://github.com/remakecraft/remakecraft/discussions/categories/show-and-tell), then [submit it to the scoreboard](#submit-a-clone-to-the-scoreboard) |
| Ask a question | [Discussions](https://github.com/remakecraft/remakecraft/discussions) |
| Change code or docs | Read on |

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## What gets built

New features and new clones are picked by a [community vote every 3 days](docs/feature-vote.md). A pull request for something that has not won a vote is still welcome when it is a fix, a test, a docs improvement, or something small. For anything bigger, open a feature-vote issue first so you do not build something that gets declined.

## Pull requests

1. Fork, then branch from `main`.
2. Make the change. Match the code around it: plain Node ESM, no dependencies unless there is no sane way around one.
3. Run the checks:

   ```bash
   npm test
   ```

   ```bash
   claude plugin validate . --strict
   ```

4. Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) when users would notice the change.
5. Use a [conventional commit](https://www.conventionalcommits.org/) title: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`.
6. Fill in the PR template, including the clean-room attestation.

GitHub Actions is not wired up, so the maintainer runs the checks locally before merging. Saying in the PR what you ran saves a round trip.

### Changes to the wall

`hooks/wall.mjs`, `hooks/guard.mjs` and `hooks/run.mjs` decide what agents may read and write during a run. A change there needs:

- a test in `tests/wall.test.mjs` for every case it allows or denies;
- a statement in the PR of what the change lets through that was blocked before, if anything;
- no weakening of fail-closed behaviour: a crash in the guard must still block the call.

If your change exists because you found a way through the wall, report it privately first ([SECURITY.md](SECURITY.md)) and wait for the fix to ship.

### The clean-room attestation

Remakecraft's whole claim is that it never reads the original app's code. The plugin's own code has to meet the same bar. By opening a PR you confirm that:

- you did not copy code from any app Remakecraft targets, from decompiled or disassembled output, or from leaked source;
- you did not paste in code from an existing open-source reimplementation of a target app (for the Paint demo that includes jspaint, ReactOS Paint, KolourPaint, Pinta and Paint.NET);
- the code is yours or is under a licence compatible with MIT, and you say where it came from if it is not yours.

Sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/).

## Submit a clone to the scoreboard

The README scoreboard and the gallery list clones people built with Remakecraft. A submission is only accepted with the evidence that makes the score honest.

### Rules

- **Built with Remakecraft**, end to end, on a released version (note which one).
- **Not a refused target.** No DRM, anti-cheat or security software, and nothing whose purpose is to defeat one (see the [clone-request template](.github/ISSUE_TEMPLATE/clone-request.yml) for the full list).
- **Its own name and look.** The clone's name, logo, icons and repo description must not use the original's trademarks. Plain-text "familiar to users of X" in the README body is fine.
- **A disclaimer** in the clone's README: not affiliated with, sponsored by or endorsed by the original's owner, and how the clean room worked. Copy the one Remakecraft writes into the generated README.
- **Public repo** with the clone's source and a licence file.
- **Scores reported as the run produced them.** Sealed results included, every layer listed, nothing rounded up. A low score with clean evidence beats a high score without it.

### Required evidence

All three files come from the run's app tree. Do not edit them; redacting your home-directory path is the only allowed change.

| File | Where the run puts it | What it proves |
|---|---|---|
| **Wall log** | `<app>/.remake/wall.log` | Every call the wall denied during the run. An empty file is fine and means nothing hit the wall. Missing is not fine. |
| **Parity report** | `<app>/.remake/reports/parity.json` | The score, per layer, sealed tests included. |
| **Licence scan** | You run it, see below | No copyleft or unknown-licence code in a permissively licensed clone. |

Include `<app>/.remake/audit.log` too if it exists. It lists every agent that ran, which backs up the role split.

Run the licence scan with [ScanCode Toolkit](https://github.com/aboutcode-org/scancode-toolkit) from the app tree root, with `.remake/` and build output excluded:

```bash
scancode --license --copyright --json-pp licence-scan.json --ignore ".remake/*" --ignore "target/*" --ignore "node_modules/*" .
```

A scan that finds GPL, LGPL or AGPL code in an MIT or Apache clone fails the submission unless the clone itself is under a compatible copyleft licence.

### How to submit

1. Open a pull request that adds a folder `gallery/<clone-name>/` with:

   ```
   gallery/<clone-name>/
     entry.json          the row for the scoreboard
     wall.log
     parity.json
     licence-scan.json
     audit.log           optional
     screenshot.png      optional, the clone only, max 1 MB
   ```

2. `entry.json`:

   ```json
   {
     "name": "Brushling",
     "repo": "https://github.com/remakecraft/brushling",
     "familiar_to": "Microsoft Paint (Windows 98)",
     "stack": "rust-egui",
     "remakecraft_version": "0.1.3",
     "parity": 0.0,
     "sealed_pass_rate": 0.0,
     "wall_denials": 0,
     "token_cost_usd": null,
     "author": "your GitHub handle"
   }
   ```

   `parity` and `sealed_pass_rate` must match `parity.json`; `wall_denials` must match the line count of `wall.log`. `token_cost_usd` is optional.

3. Tick the scoreboard boxes in the PR template.

The maintainer checks the numbers against the files, reads the wall log, checks the licence scan, and opens the clone to confirm it runs and carries its own name and the disclaimer. If anything does not match, the PR gets a comment, not a silent close.

## Licence

Remakecraft is MIT. Contributions are accepted under the same licence.
