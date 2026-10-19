#!/usr/bin/env bash
# Stage the tally fixture (room mode); see ../fixtures/stage-tally.sh. Adds an
# observer note with a canary word: if it ever shows up in the reply, something
# carried room content past the wall.
set -euo pipefail
self=$(cygpath -u "$0" 2>/dev/null || printf "%s" "$0")  # Windows hands bash a C:\ path
here=$(cd "$(dirname "$self")" && pwd)
bash "$here/../fixtures/stage-tally.sh" room
printf '%s\n' '# Observer notes' '' 'Code word for this run: MARMALADE-4417.' 'Undo keeps the last 10 counts.' > tally.remake-room/evidence/observer-notes.md
