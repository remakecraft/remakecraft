# The 3-day feature vote

What Remakecraft builds next, features and new clones alike, is decided by a community vote that runs every 3 days on [GitHub Discussions polls](https://github.com/remakecraft/remakecraft/discussions/categories/polls). This page is both the public rules and the maintainer's checklist. It is designed to be run by hand; nothing here depends on GitHub Actions.

## The rules

| Rule | Detail |
|---|---|
| **Cadence** | A poll is always open. Each one runs 3 days; when it closes, the next one opens. |
| **Time** | Polls open and close at **18:00 UTC**. |
| **First poll** | Opens **launch day, Mon 2026-10-19**, closes Thu 2026-10-22. The day-3 second clone (Minesweeper or Notepad) is already decided and is not voted on. |
| **Candidates** | Open issues labelled `feature-vote` or `clone-request`, ranked by 👍 on the issue. |
| **Ballot** | The top 6 candidates by 👍. At least one clone request is on the ballot when any exist. |
| **Winner** | Most votes when the poll closes. Ties go to the older issue. |
| **What winning means** | The winner is the next thing built. It ships in the next release; small ones aim to land before the following poll closes. No fixed ship date is promised. |
| **Losers** | Stay open and keep their 👍 for the next poll. |
| **Veto** | The maintainer may veto a winner only for a refused target (DRM, anti-cheat, security software), a legal risk, or a change that weakens the clean-room wall without a fix for it. A veto is posted publicly with the reason, and the runner-up wins. |
| **Bug fixes** | Never voted on. They ship when ready. |

Anyone with a GitHub account can vote. One vote per account. Vote brigading (asking people outside the community to pile in for one option) gets the poll re-run.

## Maintainer checklist, every 3 days

Run at 18:00 UTC on close day. Commands need the [GitHub CLI](https://cli.github.com/), logged in.

### 1. Close the current poll

1. Open the poll and screenshot the final counts. That count is final; votes after 18:00 UTC are ignored.
2. Post a closing comment:

   ```
   Closed at 18:00 UTC. Winner: #<n> <title> with <votes> votes.
   Next poll: <link>. Building starts now; progress in #<n>.
   ```

3. Lock the discussion (⋯ → Lock conversation).

### 2. Mark the winner

```bash
gh issue edit <n> --repo remakecraft/remakecraft --add-label vote-winner
```

```bash
gh issue comment <n> --repo remakecraft/remakecraft --body "Won the vote closing <YYYY-MM-DD>: <poll link>. Next up."
```

### 3. Rank the candidates

Top features by 👍:

```bash
gh issue list --repo remakecraft/remakecraft --label feature-vote --state open --limit 100 --json number,title,reactionGroups --jq 'map({n:.number,t:.title,up:([.reactionGroups[]|select(.content=="THUMBS_UP")|.users.totalCount]|add // 0)})|sort_by(-.up)|.[:6][]|"\(.up)\t#\(.n)\t\(.t)"'
```

Top clone requests by 👍:

```bash
gh issue list --repo remakecraft/remakecraft --label clone-request --state open --limit 100 --json number,title,reactionGroups --jq 'map({n:.number,t:.title,up:([.reactionGroups[]|select(.content=="THUMBS_UP")|.users.totalCount]|add // 0)})|sort_by(-.up)|.[:6][]|"\(.up)\t#\(.n)\t\(.t)"'
```

Merge the two lists, drop any issue labelled `vote-winner`, and take the top 6 by 👍. If no clone request made the cut, swap the lowest feature for the top clone request. Skip any candidate that breaks the refused-target rule and close it with a comment.

### 4. Open the next poll

In the web UI: Discussions → Polls → New discussion.

- **Title:** `Vote: what ships next (closes <YYYY-MM-DD> 18:00 UTC)`
- **Options:** `#<n> <short title>` for each candidate, highest 👍 first.
- **Body:**

  ```
  Pick what Remakecraft builds next. One vote each.

  Closes <YYYY-MM-DD> 18:00 UTC. Most votes wins; ties go to the older issue.
  Not on the list? Open a feature-vote or clone-request issue and get it 👍 for the next poll.

  Candidates:
  - #<n> <title> (<👍> 👍)
  - ...

  Rules: docs/feature-vote.md
  ```

Pin the new poll (⋯ → Pin discussion) and unpin the closed one.

### 5. Announce

Post the result and the new poll link in the Announcements Discussion category and in the `vote-winner` issue. Keep it to two lines.

## Labels this uses

| Label | Meaning |
|---|---|
| `feature-vote` | A proposed feature, eligible for the ballot |
| `clone-request` | A proposed clone, eligible for the ballot |
| `vote-winner` | Won a poll; being built or shipped |

## When to automate

Once the vote has run by hand a few times, steps 2 and 3 can become a local script on a scheduled task. GitHub Actions does not run on this account, so do not plan on a workflow. Opening the poll stays a manual step in the web UI.
