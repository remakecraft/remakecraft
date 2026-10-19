```
 _        _ _
| |_ __ _| | |_  _
|  _/ _` | | | || |
 \__\__,_|_|_|\_, |
              |__/   Count on it.
```

# tally 1.0 user manual

> *Every shepherd needs a stick with notches. This is yours.*

## Why tally?

Because a sticky note can't undo. tally was born on a rainy Tuesday when its
author lost count of espresso shots and decided the terminal should remember
for him. It does one thing, keeps one number, and never asks for a login.

## Running it

tally is a command-line program. You run it as `tally <command> [argument]`
in any directory. Each directory has its own count, kept in a save file named
`.tally` in that directory.

| Command | Argument | What it does |
|---|---|---|
| `tally` or `tally show` | none | Prints the current count |
| `tally add [n]` | optional amount, default 1 | Adds `n` to the count, prints the new count |
| `tally sub [n]` | optional amount, default 1 | Subtracts `n`, never going below 0, prints the new count |
| `tally reset` | none | Sets the count to 0, prints 0 |
| `tally undo` | none | Restores the count from before the last change, prints it |
| `tally help`, `tally --help`, `tally -h` | none | Prints a short usage summary |

Every command that prints a count prints it as a plain decimal number followed
by a newline on standard output, and exits with status 0.

### The count

- The count is a whole number, 0 or more. A directory without a `.tally` file
  has a count of 0.
- `sub` stops at 0: subtracting more than the count leaves 0.
- Showing the count never creates or changes the save file.

### Amounts

- An amount is a whole number from 1 to 999999, written in plain decimal
  digits with no sign, no leading zero, no spaces and no decimal point.
- Anything else (`0`, `-3`, `007`, `1.5`, `1000000`, `ten`) is rejected: tally
  prints `tally: amount must be a whole number from 1 to 999999` to standard
  error, changes nothing, and exits with status 2.

### Changes and undo

- A **change** is any `add`, `sub` or `reset` that makes the count different
  from what it was. A command that would leave the count the same (`reset` when
  the count is already 0, or `sub` when it is 0) prints the count and does
  nothing else: it is not a change, it is not recorded for undo, and the save
  file is not written.
- tally remembers the count from before each change, up to the **last 10
  changes**. When an 11th change happens, the oldest remembered count is
  forgotten.
- `undo` restores the most recently remembered count, forgets it, and prints
  it. Undo is not itself a change and cannot be undone; there is no redo.
- `undo` with nothing remembered prints `tally: nothing to undo` to standard
  error, changes nothing, and exits with status 1.

### Mistakes

| Situation | Standard error | Exit status |
|---|---|---|
| Unknown command, for example `tally inc` | `tally: unknown command 'inc' (try 'tally help')` | 2 |
| Bad amount | `tally: amount must be a whole number from 1 to 999999` | 2 |
| Too many arguments (`tally add 1 2`, `tally reset now`, `tally help me`) | `tally: too many arguments` | 2 |
| Nothing to undo | `tally: nothing to undo` | 1 |
| Damaged save file (see below) | `tally: save file .tally is damaged` | 3 |

Nothing is printed to standard output in these cases, and the save file is
left exactly as it was. The command is checked before the arguments, and the
arguments before the save file is read.

The usage summary printed by `help` is for people; its wording may change
between versions and is not part of tally's contract. It always goes to
standard output with exit status 0.

## The save file

`.tally` is a UTF-8 text file. Lines end with a single line feed (no carriage
returns), and the file ends with a line feed.

1. Line 1 is exactly `tally 1`.
2. Line 2 is the current count.
3. Every following line is one remembered count for undo, oldest first, so
   the last line is the one `undo` restores next. There are 0 to 10 of them.

Every count is written in plain decimal digits with no leading zeros (`0` is
written as `0`). A file holding count 7 with two remembered counts, 0 then 5:

```
tally 1
7
0
5
```

tally writes the file only when a change or an undo happens.

A save file is **damaged** if it does not end with a line feed, if line 1 is
not exactly `tally 1`, if there is no count line, if any count line is not a
plain decimal number, or if it remembers more than 10 counts. tally refuses to
use a damaged file (see Mistakes) and never repairs or replaces it; delete it
by hand to start over.

## Colophon

tally keeps its undo ring in an array called `hist` and persists through a
`flushState()` routine that writes `.tally.tmp` and renames it over `.tally`,
so a crash mid-write never leaves half a file. Hand-set in a terminal near you.
