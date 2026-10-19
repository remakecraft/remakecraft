#!/usr/bin/env bash
# Stages the tally fixture into an eval run's empty workspace (the current
# directory). Called by each case's scaffold.sh; runs only under --scaffold.
# Only docs/ is copied: impl/ is the hidden "original binary" and never
# reaches a run.
#
#   inbox  ./evidence-inbox/ holds the docs; the run creates everything else
#   room   the workspace is a run's app tree (remake.json, spec/, tests/,
#          src/) and ./tally.remake-room/evidence/ holds the docs
#
# In "room" mode the room sits inside the workspace, not beside it as
# init-run.mjs puts it: the hook's cwd is the workspace, so remake.json must be
# at its root, and the harness owns the directory above. The wall keys on the
# .remake-room name, so it treats both layouts the same.
set -euo pipefail

mode=${1:?usage: stage-tally.sh inbox|room}
self=$(cygpath -u "$0" 2>/dev/null || printf "%s" "$0")  # Windows hands bash a C:\ path
here=$(cd "$(dirname "$self")" && pwd)
docs="$here/toy-original/docs"
[ -f "$docs/MANUAL.md" ] || { echo "stage-tally: no fixture docs at $docs" >&2; exit 1; }

case "$mode" in
  inbox)
    mkdir -p evidence-inbox
    cp -R "$docs/." evidence-inbox/
    ;;
  room)
    mkdir -p spec tests/visible src tally.remake-room/evidence tally.remake-room/spec tally.remake-room/sealed
    cp -R "$docs/." tally.remake-room/evidence/
    printf '%s\n' '{' '  "app": "tally",' '  "stack": "web",' '  "builders": 1,' '  "cheap": true,' '  "blocked": []' '}' > remake.json
    printf '%s\n' '.remake/' 'node_modules/' > .gitignore
    ;;
  *)
    echo "stage-tally: unknown mode '$mode' (inbox|room)" >&2
    exit 2
    ;;
esac
