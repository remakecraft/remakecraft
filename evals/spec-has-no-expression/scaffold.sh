#!/usr/bin/env bash
# Stage the tally fixture (room mode); see ../fixtures/stage-tally.sh.
set -euo pipefail
self=$(cygpath -u "$0" 2>/dev/null || printf "%s" "$0")  # Windows hands bash a C:\ path
here=$(cd "$(dirname "$self")" && pwd)
exec bash "$here/../fixtures/stage-tally.sh" room
