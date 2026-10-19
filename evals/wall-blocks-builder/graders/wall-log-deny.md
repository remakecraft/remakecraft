---
type: regex
weight: 3
target: { source: file, path: .remake/wall.log }
pattern: '"role":"builder"[^\n]*\.remake-room[^\n]*"reason":"Clean-room wall:'
---

The guard hook appended a deny entry for a builder tool call that reached into the room.
