# Releasing

Releases are tagged, with notes taken from [CHANGELOG.md](../CHANGELOG.md). GitHub Actions does not run on this account, so the whole procedure is local: git plus the [GitHub CLI](https://cli.github.com/), logged in as `hellosverre`.

## Versions

[Semantic Versioning](https://semver.org/). While on 0.x:

| Change | Bump | Example |
|---|---|---|
| Fixes only, including wall-bypass fixes | patch | 0.1.0 → 0.1.1 |
| New features, or anything that changes `remake.json` or the run layout | minor | 0.1.1 → 0.2.0 |

A wall-bypass fix ships as its own patch release as soon as it is ready, without waiting for the vote cycle. Publish the security advisory after the release is out.

The version lives in one file: `.claude-plugin/plugin.json`.

## Procedure

Replace `X.Y.Z` throughout.

### 1. Start clean

```bash
git switch main
```

```bash
git pull --ff-only
```

```bash
git status --short
```

The last command must print nothing.

### 2. Run the checks

```bash
npm test
```

```bash
claude plugin validate . --strict
```

Both must pass. There is no CI to catch it later.

### 3. Update the changelog

In `CHANGELOG.md`:

1. Move everything under `## [Unreleased]` into a new section `## [X.Y.Z] - YYYY-MM-DD` (today, UTC) directly below it, leaving `## [Unreleased]` empty.
   For 0.1.0 the section already exists: replace `Unreleased` in `## [0.1.0] - Unreleased` with the date and delete the "planned for" line.
2. Update the link references at the bottom:

   ```
   [Unreleased]: https://github.com/remakecraft/remakecraft/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/remakecraft/remakecraft/compare/vPREVIOUS...vX.Y.Z
   ```

   0.1.0 keeps its `releases/tag/v0.1.0` link, since there is nothing to compare against.

### 4. Bump the version

Set `"version": "X.Y.Z"` in `.claude-plugin/plugin.json`.

### 5. Commit and tag

```bash
git commit -am "chore: release vX.Y.Z"
```

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
```

### 6. Push

```bash
git push origin main
```

```bash
git push origin vX.Y.Z
```

### 7. Write the notes file

Pulls the `X.Y.Z` section out of the changelog, without the link references:

```bash
awk -v v="X.Y.Z" 'index($0, "## [" v "]") == 1 {p=1; next} /^## \[/ && p {exit} /^\[[^]]+\]: / {next} p' CHANGELOG.md > release-notes.md
```

Read `release-notes.md` before using it. If it is empty, the heading in step 3 does not match `## [X.Y.Z]` exactly.

### 8. Create the release

```bash
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file release-notes.md --discussion-category "Announcements"
```

`--verify-tag` stops it from silently creating a tag on the wrong commit. `--discussion-category` opens an Announcements discussion for the release, so the categories in [community/discussions-setup.md](community/discussions-setup.md) must exist first.

### 9. Check and clean up

```bash
gh release view vX.Y.Z --web
```

```bash
rm release-notes.md
```

### 10. Announce

- GitHub Discussions, Announcements: version, two or three lines from the notes, the release link.
- Close or comment on the issues the release fixes, and on the `vote-winner` issue it ships.
- For a minor release, an X post with a short clip of the new thing.

## If something goes wrong

| Problem | Fix |
|---|---|
| Tag pushed on the wrong commit, no release yet | `git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`, then redo from step 5 |
| Release published with wrong notes | `gh release edit vX.Y.Z --notes-file release-notes.md` |
| A bad release is out | Ship a patch release with the fix. Do not delete a published release; people may have installed it. |
