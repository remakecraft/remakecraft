# guessling: functional spec (version 2)

Rendered from `spec.json`. If the two disagree, spec.json wins. Features appear in the same order as in spec.json.

## Changes from v1

- P1: Arabic ISO-8859-6 is ISO-8859-6 under LEGACY_ISO and ALL, WINDOWS-1256 under MODERN_WEB, None under LEGACY_MAC (detect.arabic, detect.era-modern-web, detect.era-legacy-iso, detect.era-legacy-mac, detect.era-all, detect.corpus-summary).
- P2: bg/mac-cyrillic prints ISO-8859-8 under LEGACY_ISO, DOS and MAINFRAME (detect.era-legacy-iso, detect.era-dos, detect.era-mainframe, detect.era-always-on, detect.hebrew, detect.corpus-summary).
- P3: -l also renames ISO-8859-6 -> Windows-1256 and ISO-8859-8 -> Windows-1255; both ISO names and both Windows names join the output list (cli.legacy, cli.legacy-casing, output.result-line, detect.unprinted-names).
- P4: CP720 can be printed for some crafted inputs; recorded as observed examples, not required (detect.unprinted-names, detect.era-legacy-regional, output.result-line).
- P5: the interactive-stdin notice spells the key CTRL-D (cli.stdin-tty-notice).
- P6: 61 62 63 00 64 65 66 0A gives None in every era (detect.ascii, detect.empty-binary).
- P7: ASCII text with an overlong C0 AF gives WINDOWS-1250 (MODERN_WEB) and other single-byte names, not None (detect.empty-binary, detect.utf8-invalid).
- P8: English text between bare ~{ ~} markers is utf-8; HZ-GB-2312 needs GB2312 byte pairs between the markers (detect.escape, detect.ascii).
- P9: a truncated E2 82 at end of input gives utf-8 under MODERN_WEB and ALL (detect.utf8-invalid).
- P10: one multibyte character inside a long ASCII text gives WINDOWS-1252; a short line with one gives utf-8 (detect.utf8).
- P11: `- -` after a large stdin prints the result twice (cli.stdin).
- P12: nine evidence rows are marked [text-specific] (detect.era-legacy-iso, detect.era-dos, detect.era-all, detect.era-legacy-regional, cli.legacy, cli.legacy-casing, detect.corpus-summary).

## Definitions

- **launch**: The clone is a Node CLI started as `node <entry> [--minimal] [-l] [-e ERA] [input ...]`. Tests launch it as `process.execPath REMAKE_APP_BIN <args>`, so the same tests drive the original and the clone. Unless a check says otherwise, stdin is a pipe that is closed immediately with no bytes (never a terminal).
- **line-compare**: Output is compared line by line after splitting on LF and dropping one trailing CR per line. 'stdout is X' means the whole stdout, split that way, equals the listed lines with nothing before or after (one final empty element after the last LF is ignored).
- **name-check**: A check written `[opts] FILE -> NAME` means: run `--minimal [opts] FILE`; exit code is 0, stderr is empty and stdout is exactly one line equal to NAME. `-> None` means that line is the word None (no result).
- **corpus**: samples/ is the run's sample corpus of 257 files (public-domain texts re-encoded by the run, plus 7 edge files). In corpus lists an entry `<dir>/<stem>` means `samples/<dir>/<stem>.txt`; entries ending in `.bin` are written in full; `{a,b}/x` expands to `a/x` and `b/x`. Edge files: edge/empty.bin (0 bytes), edge/random-bytes.bin (4 KB seeded random), edge/nul-heavy.bin (4 KB mostly 0x00), edge/ascii-only, edge/bom-only-utf8 (EF BB BF only), edge/single-high-byte (Latin-1 French with one high byte), edge/utf8-one-char (one short ASCII line containing one 2-byte UTF-8 character).
- **TEXT_SPECIFIC**: A corpus entry followed by `[text-specific]` records what the original printed for that evidence file's exact bytes. Another text in the same language and encoding was observed to give a different name, so the entry is not a rule for that language/encoding: a test may pin it only for byte-identical input, and an implementation must not derive a general rule from it.
- **UTF8_SET**: The 28 BOM-less UTF-8 samples {ar,bg,cs,cy,de,el,en,es,fa,fi,fr,he,hu,it,ja,ko,lt,pl,pt,ro,ru,sk,th,tr,uk,vi,zh_hans,zh_hant}/utf-8. (eo/utf-8 is pure ASCII and belongs to the ascii group.)
- **TEXTS_SET**: The 39 UTF-8 source texts texts/{en,fr,de,es,pt,it,nl,sv,da,no,fi,is,pl,cs,hu,ro,sl,hr,sk,ru,uk,bg,sr,el,tr,he,ar,fa,th,vi,lt,et,cy,ga,eo,ja,zh_hans,zh_hant,ko}.
- **ALWAYS_ON**: 55 corpus files that give the same name under every era (MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL), with or without -l: ascii <- edge/ascii-only, en/ascii, en/cp437, en/cp850, en/latin-1, eo/iso8859-3, eo/utf-8, he/cp424, texts/eo | UTF-8-SIG <- edge/bom-only-utf8, {el,en,ja,ru}/utf-8-sig | UTF-16 <- {el,en,ja,ru}/utf-16le-bom, {el,en,ja,ru}/utf-16be-bom | UTF-32 <- {el,en,ja,ru}/utf-32le-bom, {el,en,ja,ru}/utf-32be-bom | utf-16le <- {el,en,ru}/utf-16le | utf-16be <- {el,en,ru}/utf-16be | utf-32le <- {el,en,ja,ru}/utf-32le | utf-32be <- {el,en,ja,ru}/utf-32be | ISO-2022-JP <- ja/iso2022_jp | ISO-2022-KR <- ko/iso2022_kr | HZ-GB-2312 <- zh_hans/hz | WINDOWS-1255 <- he/cp1255.short, he/cp1255, he/iso8859-8 | None <- ja/utf-16le, ja/utf-16be, edge/empty.bin, edge/nul-heavy.bin, edge/random-bytes.bin.
- **OTHER_202**: The 202 corpus files not in ALWAYS_ON. Every era table below lists names for these files only; ALWAYS_ON files are covered by detect.era-always-on.

---

## cli.invoke

**Covers:** cli.invoke, cli.input.multiple, cli.input.name-echo, behaviour.deterministic | **Layer:** ui | **Priority:** must | **Source:** watched

A command-line tool that takes zero or more input paths and prints one detection result per input, in argument order.

**Behaviour**
1. The program calls itself `guessling` in its usage text, error prefix and version line.
2. Each positional argument is a path. Its bytes are read raw: no decoding, no newline translation.
3. Exactly one output line is printed per positional argument, in the order given. A path given twice prints two lines.
4. The label in front of ': ' is the argument string exactly as typed: a relative path stays relative, an absolute path stays absolute, and slashes are kept as typed.
5. Each input is judged on its own bytes only. A file's result is the same whether it is given alone or among other files, and in any position.
6. Identical bytes with identical options give an identical name and confidence on every run.
7. With no positional argument the tool reads standard input (see cli.stdin).

**Inputs:** zero or more file paths; options anywhere on the line (see cli.parsing-conveniences)
**Outputs:** one stdout line per input, in argument order
**Edge cases:** the same path repeated; the same file given once relatively and once absolutely; a file listed among many others

**Acceptance**
- `samples/edge/ascii-only.txt samples/ru/koi8-r.txt` -> exit 0, stderr empty, stdout has exactly 2 lines; line 1 starts with `samples/edge/ascii-only.txt: ascii with confidence `, line 2 starts with `samples/ru/koi8-r.txt: KOI8-R with confidence `.
- `samples/edge/ascii-only.txt samples/edge/ascii-only.txt <absolute path of the same file>` -> 3 lines whose labels are, in order, the three arguments exactly as passed, each followed by `: ascii with confidence `.
- A path written with forward slashes is echoed with forward slashes, byte for byte.
- `--minimal` over all 257 corpus files in one invocation gives, line by line, the same names as 257 separate single-file runs.
- Two runs with identical arguments and stdin give byte-identical stdout.

## cli.stdin

**Covers:** cli.input.stdin | **Layer:** behaviour | **Priority:** must | **Source:** watched

Standard input is read when no path is given or when the argument '-' appears, and is labelled `<stdin>`.

**Behaviour**
1. With no positional argument, all of stdin is read until end of stream and judged as one input.
2. The positional argument `-` also means stdin and may be mixed with file paths; its line appears at its position.
3. The label for stdin is the literal text `<stdin>`.
4. If `-` is given more than once, stdin is reported once per occurrence, each line labelled `<stdin>`. For a small stdin (such as samples/ru/koi8-r.txt) the second and later occurrences report no result. For a larger stdin (observed with about 3 KB of Big5 or UTF-8 text) the second occurrence prints the same result again. The size at which this switches is not specified.

**Inputs:** bytes on stdin; the argument `-`
**Outputs:** `<stdin>: ...` result lines
**Edge cases:** empty stdin; `-` repeated with small and with large stdin; `-` between files

**Acceptance**
- No arguments, stdin = the bytes of samples/ru/koi8-r.txt -> exit 0, stdout is one line starting with `<stdin>: KOI8-R with confidence `.
- Argument `-` with the same stdin -> stdout identical to the previous check.
- `--minimal` with the same stdin -> stdout is `KOI8-R`.
- No arguments, empty stdin -> stdout is `<stdin>: no result`, exit 0.
- `--minimal -` with empty stdin -> stdout is `None`, exit 0.
- `samples/edge/ascii-only.txt -` with stdin = samples/ru/koi8-r.txt -> line 1 starts with `samples/edge/ascii-only.txt: ascii with confidence `, line 2 starts with `<stdin>: KOI8-R with confidence `.
- `- -` with stdin = samples/ru/koi8-r.txt -> line 1 starts with `<stdin>: KOI8-R with confidence `, line 2 is `<stdin>: no result`, exit 0.
- `- -` with any stdin -> exit 0, exactly 2 stdout lines; line 1 is the single-`-` result for that stdin; line 2 is either `<stdin>: no result` or starts with the same `<stdin>: NAME with confidence ` prefix as line 1.

## cli.stdin-tty-notice

**Covers:** cli.input.stdin-tty-notice | **Layer:** ui | **Priority:** could | **Source:** watched

When stdin is an interactive terminal and is about to be read, a short notice goes to stderr first.

**Behaviour**
1. If stdin is about to be read and it is a terminal or other character device (not a pipe, not a regular file), one line is written to stderr before reading, followed by one empty line.
2. The line, in the clone's own words, says that input is being read interactively, that pressing the key written exactly `CTRL-D` (upper case) twice at the start of a blank line ends input, and that --help shows usage.
3. The notice never goes to stdout and does not change the result or the exit code.
4. Nothing is written to stderr when stdin is a pipe or a regular file.

**Inputs:** stdin attached to a terminal or character device
**Outputs:** two stderr lines: the notice, then an empty line
**Edge cases:** character device that returns end of stream at once (no bytes)

**Acceptance**
- No arguments, stdin a pipe carrying samples/ru/koi8-r.txt -> stderr is empty.
- No arguments, stdin redirected from the regular file samples/ru/koi8-r.txt -> stderr is empty.
- No arguments, stdin a terminal or character device that yields 0 bytes -> stderr is exactly 2 lines: line 1 is non-empty and contains `CTRL-D` (case-sensitive) and `--help`, line 2 is empty; stdout is `<stdin>: no result`; exit 0.

## cli.help

**Covers:** cli.help, cli.usage-line | **Layer:** ui | **Priority:** should | **Source:** watched

-h/--help prints a usage block to stdout and exits 0; the same two-line usage header starts every argument error.

**Behaviour**
1. `-h` and `--help` print the help block to stdout and exit 0 without detecting anything.
2. Let M be the long option name `encoding-era` upper-cased with its hyphen replaced by an underscore. Usage line 1 is exactly `usage: guessling [-h] [--minimal] [-l] [-e M] [--version]` with M substituted. Usage line 2 is 17 spaces followed by `[input ...]` (it lines up after `usage: guessling `).
3. After the two usage lines: an empty line, one description sentence in the clone's own words, an empty line, a line `positional arguments:` followed by an entry for `input` saying it is a file to examine and that the default is stdin, an empty line, a line `options:` followed by entries for `-h, --help`, `--minimal`, `-l, --legacy`, `-e, --encoding-era M` and `--version`.
4. The `-e` entry states that the default is MODERN_WEB and lists the choices in this order: MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL.
5. Option descriptions are in the clone's own words; tests do not compare their wording.
6. The same two usage lines are printed to stderr in front of every argument error (see cli.unknown-option, cli.era-option, cli.unopenable).

**Inputs:** -h; --help
**Outputs:** help block on stdout
**Edge cases:** help requested together with other options (bundled -lh: see cli.parsing-conveniences)

**Acceptance**
- `--help` -> exit 0, stderr empty.
- `--help` stdout line 1 equals 'usage: guessling [-h] [--minimal] [-l] [-e ' + M + '] [--version]' where M = 'encoding-era'.toUpperCase().replace('-', '_').
- `--help` stdout line 2 equals ' '.repeat(17) + '[input ...]' and line 3 is empty.
- `--help` stdout contains a line exactly `positional arguments:` and, after it, a line exactly `options:`.
- `--help` stdout contains each of the substrings `-h, --help`, `--minimal`, `-l, --legacy`, `-e, --encoding-era`, `--version`, and each of the 7 era names.
- `-h` stdout is byte-identical to `--help` stdout.
- `--help` with a stdin pipe that is never closed still exits 0 within 5 seconds.

## cli.version

**Covers:** cli.version | **Layer:** ui | **Priority:** should | **Source:** watched

--version prints the program name and version and exits 0, overriding everything else on the line.

**Behaviour**
1. `--version` prints exactly `guessling 6.0.0dev0` to stdout and exits 0.
2. When `--version` appears, no input is opened or detected, even if files and other options are also given.

**Inputs:** --version
**Outputs:** one stdout line
**Edge cases:** --version with files and --minimal

**Acceptance**
- `--version` -> stdout is `guessling 6.0.0dev0`, stderr empty, exit 0.
- `--version --minimal samples/edge/ascii-only.txt` -> stdout is `guessling 6.0.0dev0` and nothing else, exit 0.

## cli.minimal

**Covers:** cli.option.minimal | **Layer:** ui | **Priority:** must | **Source:** watched

--minimal prints only the encoding name per input, or None when there is no result.

**Behaviour**
1. With `--minimal` each output line is just the encoding name, with no label and no confidence.
2. An input with no result prints the word `None`.
3. Lines stay one per input in argument order.
4. Detection is unchanged: the name equals the name in the full result line for the same input and options.

**Inputs:** --minimal
**Outputs:** one name or `None` per line
**Edge cases:** inputs mixing results and no results

**Acceptance**
- `--minimal samples/edge/ascii-only.txt samples/edge/random-bytes.bin samples/edge/empty.bin samples/ko/euc_kr.txt samples/el/utf-16le.txt` -> stdout is the 5 lines `ascii`, `None`, `None`, `EUC-KR`, `utf-16le`; exit 0.
- For every corpus file F, the `--minimal F` line equals the text between `F: ` and ` with confidence ` in the plain `F` line, or `None` when the plain line is `F: no result`.

## cli.legacy

**Covers:** cli.option.legacy, behaviour.legacy.rename-map | **Layer:** behaviour | **Priority:** must | **Source:** watched

-l/--legacy renames a fixed set of reported legacy names to their modern superset after detection.

**Behaviour**
1. `-l` and `--legacy` are the same switch. Detection and era filtering happen first; the rename is applied to the chosen name only.
2. Rename map: ISO-8859-1 -> Windows-1252, ISO-8859-2 -> Windows-1250, ISO-8859-5 -> Windows-1251, ISO-8859-6 -> Windows-1256, ISO-8859-7 -> Windows-1253, ISO-8859-8 -> Windows-1255, ISO-8859-9 -> Windows-1254, ISO-8859-11 -> CP874, ISO-8859-13 -> Windows-1257, EUC-KR -> CP949.
3. Every other name is printed unchanged, including ascii, utf-8, UTF-8-SIG, UTF-16, UTF-32, utf-16le/be, utf-32le/be, SHIFT_JIS, EUC-JP, GB18030, Big5, HZ-GB-2312, ISO-2022-JP, ISO-2022-KR, Johab, KOI8-R, KOI8-U, KZ1048, ISO-8859-3, ISO-8859-4, ISO-8859-10, ISO-8859-14, ISO-8859-15, ISO-8859-16, all Mac* names, all CPnnn names and all WINDOWS-125x names.
4. Which inputs get a result, and the confidence, are the same with and without -l.
5. Works with --minimal and with every era. In the default era the only visible change on the corpus is EUC-KR becoming CP949.

**Inputs:** -l; --legacy
**Outputs:** renamed names (casing: see cli.legacy-casing)
**Edge cases:** no-result inputs stay no result; -l given after the file arguments

**Acceptance**
- `-l` over the corpus gives the MODERN_WEB table (detect.era-modern-web) unchanged except `-l ko/euc_kr -> CP949` and `-l ko/euc_kr.short -> CP949`.
- `-l -e ALL` over the corpus gives the ALL table (detect.era-all) unchanged except: Windows-1251 <- bg/iso8859-5, ru/iso8859-5, sr/iso8859-5 | Windows-1250 <- cs/iso8859-2, hr/iso8859-2, hu/iso8859-2, pl/iso8859-2, sk/iso8859-2 | Windows-1253 <- el/cp1253.short, el/iso8859-7 | Windows-1257 <- et/cp1257, et/iso8859-13, et/iso8859-4, lt/cp1257, lt/iso8859-13 | Windows-1252 <- is/latin-1 [text-specific], texts/nl | Windows-1254 <- tr/iso8859-9 | Windows-1256 <- ar/iso8859-6 | CP949 <- ko/euc_kr, ko/euc_kr.short.
- `-l -e LEGACY_ISO ar/iso8859-6 -> Windows-1256`; `-l -e LEGACY_ISO bg/mac-cyrillic -> Windows-1255`; `-l -e DOS bg/mac-cyrillic -> Windows-1255`; `-l -e MAINFRAME bg/mac-cyrillic -> Windows-1255`.
- `-l -e ALL` leaves ISO-8859-3, ISO-8859-4, ISO-8859-10, ISO-8859-14, ISO-8859-15, ISO-8859-16, Johab, KOI8-R, KOI8-U, MacCyrillic and CP850 results unchanged (e.g. `-l -e ALL tr/iso8859-3 -> ISO-8859-3`, `-l -e ALL lt/iso8859-4 -> ISO-8859-4`, `-l -e ALL ro/iso8859-2 -> ISO-8859-16`, `-l -e ALL ko/johab -> Johab`).
- `-l -e LEGACY_ISO th/cp874 -> CP874` (ISO-8859-11 renamed).
- `-l samples/edge/empty.bin` (without --minimal) -> stdout is `samples/edge/empty.bin: no result`.
- `samples/ko/euc_kr.txt -l --minimal` -> stdout is `CP949`.

## cli.legacy-casing

**Covers:** behaviour.legacy.rename-casing | **Layer:** format | **Priority:** must | **Source:** watched

Windows names produced by the -l rename are spelled 'Windows-NNNN', while directly detected ones stay 'WINDOWS-NNNN'.

**Behaviour**
1. A Windows code page reported by detection is printed all upper-case: `WINDOWS-1250` ... `WINDOWS-1258`.
2. A Windows name produced by the -l rename is printed with only the W upper-case: `Windows-1250`, `Windows-1251`, `Windows-1252`, `Windows-1253`, `Windows-1254`, `Windows-1255`, `Windows-1256`, `Windows-1257`.
3. Both spellings can appear in one run.

**Inputs:** -l
**Outputs:** exact name casing
**Edge cases:** same code page reached directly and by rename in one run

**Acceptance**
- `--minimal -l -e ALL samples/el/cp1253.txt samples/el/iso8859-7.txt` -> stdout is `WINDOWS-1253` then `Windows-1253`.
- `-l -e ALL texts/nl -> Windows-1252`; `-l -e ALL ar/iso8859-6 -> Windows-1256`; `-l -e LEGACY_ISO bg/mac-cyrillic -> Windows-1255`; `-l -e ALL bg/iso8859-5 -> Windows-1251`; `-l -e ALL cs/iso8859-2 -> Windows-1250`; `-l -e ALL tr/iso8859-9 -> Windows-1254`; `-l -e ALL et/iso8859-13 -> Windows-1257`.
- `-l bg/cp1251 -> WINDOWS-1251`, `-l -e ALL tr/cp1254 -> WINDOWS-1254`, `-l he/cp1255 -> WINDOWS-1255` and `-l fa/cp1256 -> WINDOWS-1256` (direct detections keep upper case).

## cli.era-option

**Covers:** cli.option.encoding-era, cli.option.encoding-era.invalid | **Layer:** ui | **Priority:** must | **Source:** watched

-e/--encoding-era picks one era of encodings that may be reported; an invalid value is an argument error.

**Behaviour**
1. `-e VALUE` and `--encoding-era VALUE` take exactly one value from: MODERN_WEB (default), LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL.
2. The value selects which names may be reported; the effect of each era is in the detect.era-* features.
3. Values cannot be combined: a comma-separated list is just an invalid value.
4. On an invalid value the tool prints to stderr the two usage lines and then `guessling: error: invalid encoding era: 'V'. Choose from: MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL`, where V is the value as given, upper-cased. Exit code 2, stdout empty, no input is read.

**Inputs:** -e VALUE; --encoding-era VALUE
**Outputs:** era-filtered results; error on stderr
**Edge cases:** comma-separated values; unknown value

**Acceptance**
- `-e BOGUS samples/bg/cp855.txt` -> exit 2, stdout empty, stderr is exactly 3 lines: the two usage lines of cli.help, then `guessling: error: invalid encoding era: 'BOGUS'. Choose from: MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL`.
- `--encoding-era DOS,LEGACY_ISO samples/bg/cp855.txt` -> exit 2, stdout empty, last stderr line `guessling: error: invalid encoding era: 'DOS,LEGACY_ISO'. Choose from: MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL`.
- For each of the 7 values X: `-e X edge/ascii-only -> ascii`.
- `-e DOS bg/cp855 -> CP855` and, without -e, `bg/cp855 -> None`.
- `-e MODERN_WEB` gives, for every corpus file, the same name as no -e.

## cli.era-value-parsing

**Covers:** cli.option.encoding-era.case-insensitive, cli.option.encoding-era.last-wins | **Layer:** behaviour | **Priority:** should | **Source:** watched

The era value is case-insensitive, and when the option is repeated the last value wins.

**Behaviour**
1. The value is upper-cased before it is checked, so `all`, `Dos` and `DOS` are all valid.
2. If the era option appears more than once, only the last value counts.

**Inputs:** -e with any letter case; repeated -e
**Outputs:** same results as the canonical upper-case value
**Edge cases:** invalid lower-case value is echoed upper-cased

**Acceptance**
- `--encoding-era all bg/cp855 -> CP855`; `--encoding-era Dos bg/cp855 -> CP855`.
- `--encoding-era weird samples/bg/cp855.txt` -> exit 2, last stderr line `guessling: error: invalid encoding era: 'WEIRD'. Choose from: MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL`.
- `--encoding-era DOS --encoding-era MODERN_WEB samples/bg/cp855.txt samples/bg/cp1251.txt` -> line 1 is `samples/bg/cp855.txt: no result`, line 2 starts with `samples/bg/cp1251.txt: WINDOWS-1251 with confidence `, exit 0.

## cli.era-syntax

**Covers:** cli.option.encoding-era.forms | **Layer:** behaviour | **Priority:** could | **Source:** watched

The era value may be attached with '=', is always the next argument, and its absence is an argument error.

**Behaviour**
1. `--encoding-era=DOS` works like `--encoding-era DOS`.
2. The argument after `-e`/`--encoding-era` is always taken as the value, even if it looks like a file path; such a value is then rejected as an invalid era (echoed upper-cased).
3. `-e` or `--encoding-era` with nothing after it, or `-e` bundled last in a group such as `-le`, prints the usage lines and `guessling: error: argument -e/--encoding-era: expected one argument` to stderr and exits 2.

**Inputs:** --encoding-era=VALUE; -e at the end of the line; bundled -le
**Outputs:** results or stderr error
**Edge cases:** path taken as era value

**Acceptance**
- `--encoding-era=DOS bg/cp855 -> CP855`.
- `--encoding-era samples/bg/cp855.txt` -> exit 2, stdout empty, last stderr line `guessling: error: invalid encoding era: 'SAMPLES/BG/CP855.TXT'. Choose from: MODERN_WEB, LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME, ALL`.
- `--encoding-era` -> exit 2, stdout empty, last stderr line `guessling: error: argument -e/--encoding-era: expected one argument`.
- `-le` -> exit 2, stdout empty, last stderr line `guessling: error: argument -e/--encoding-era: expected one argument`.

## cli.unknown-option

**Covers:** cli.option.unknown | **Layer:** ui | **Priority:** must | **Source:** watched

An unrecognised option is an argument error with exit code 2.

**Behaviour**
1. An argument that starts with `-` and is not a known option (or unambiguous prefix of one) prints the two usage lines and `guessling: error: unrecognized arguments: <args>` to stderr, where <args> is the unrecognised argument(s) separated by single spaces.
2. Exit code 2; stdout empty; nothing is detected.

**Inputs:** unknown option
**Outputs:** stderr error
**Edge cases:** unknown option together with valid files

**Acceptance**
- `--bogus samples/edge/ascii-only.txt` -> exit 2, stdout empty, stderr is exactly the two usage lines followed by `guessling: error: unrecognized arguments: --bogus`.

## cli.parsing-conveniences

**Covers:** cli.option.prefix, cli.option.bundling, cli.option.order | **Layer:** behaviour | **Priority:** could | **Source:** watched

Long options may be abbreviated, short flags may be bundled, options may follow files, and '--' ends option parsing.

**Behaviour**
1. Any unambiguous prefix of a long option works like the full option (`--min` = `--minimal`).
2. Short flags can be bundled: `-lh` = `-l -h`.
3. Options are honoured wherever they appear, including after file arguments.
4. A bare `--` ends option parsing; every later argument is a file path, even if it starts with `-`.

**Inputs:** abbreviated long options; bundled short flags; options after files; --
**Outputs:** same results as the canonical form
**Edge cases:** `-- --minimal` with no such file

**Acceptance**
- `--min samples/bg/cp1251.txt` -> stdout is `WINDOWS-1251`.
- `-lh` -> exit 0, stdout byte-identical to `--help`.
- `samples/ko/euc_kr.txt -l --minimal` -> stdout is `CP949`.
- `-- --minimal` (no file named --minimal in the working directory) -> exit 2, stdout empty, last stderr line starts with `guessling: error: argument input: can't open '--minimal'`.

## cli.unopenable

**Covers:** cli.input.unopenable | **Layer:** ui | **Priority:** must | **Source:** watched

If any input path cannot be opened, the whole run fails with exit 2 before anything is printed to stdout.

**Behaviour**
1. All input paths are opened before any detection or output.
2. If one cannot be opened (missing, or a directory), stderr gets the two usage lines and `guessling: error: argument input: can't open '<arg>': <reason>`, where <arg> is the argument as typed.
3. For a missing file <reason> is `[Errno 2] No such file or directory: '<arg>'`. For a directory on Windows it is `[Errno 13] Permission denied: '<arg>'`.
4. Exit code 2. Nothing is written to stdout, not even results for valid files listed before the bad one.

**Inputs:** a missing path; a directory path
**Outputs:** stderr error, empty stdout
**Edge cases:** bad path in the middle of good ones

**Acceptance**
- `samples/edge/ascii-only.txt nonexistent-file.txt samples/edge/bom-only-utf8.txt` -> exit 2, stdout empty, stderr is exactly the two usage lines then `guessling: error: argument input: can't open 'nonexistent-file.txt': [Errno 2] No such file or directory: 'nonexistent-file.txt'`.
- `samples/edge` (a directory) -> exit 2, stdout empty, last stderr line starts with `guessling: error: argument input: can't open 'samples/edge': `; on Windows the whole line is `guessling: error: argument input: can't open 'samples/edge': [Errno 13] Permission denied: 'samples/edge'`.

## output.result-line

**Covers:** output.line, output.no-result, output.confidence | **Layer:** format | **Priority:** must | **Source:** watched

Each input prints '<label>: <NAME> with confidence <number>' or '<label>: no result'.

**Behaviour**
1. With a result the line is `<label>: <NAME> with confidence <C>`.
2. Without a result the line is `<label>: no result` (no confidence). This is not an error.
3. <C> is a confidence between 0 and 1 inclusive, written as a decimal number with a dot and at least one digit after it (a whole 1 is written `1.0`). Its value is not specified; tests only check that it is present and in range.
4. NAME is spelled exactly as one of: ascii, utf-8, UTF-8-SIG, UTF-16, utf-16le, utf-16be, UTF-32, utf-32le, utf-32be, Big5, SHIFT_JIS, EUC-JP, EUC-KR, CP949, GB18030, HZ-GB-2312, ISO-2022-JP, ISO-2022-KR, Johab, CP874, KOI8-R, KOI8-U, WINDOWS-1250, WINDOWS-1251, WINDOWS-1252, WINDOWS-1253, WINDOWS-1254, WINDOWS-1255, WINDOWS-1256, WINDOWS-1257, WINDOWS-1258, ISO-8859-1, ISO-8859-2, ISO-8859-3, ISO-8859-4, ISO-8859-5, ISO-8859-6, ISO-8859-7, ISO-8859-8, ISO-8859-9, ISO-8859-10, ISO-8859-11, ISO-8859-13, ISO-8859-14, ISO-8859-15, ISO-8859-16, MacCyrillic, MacGreek, MacIceland, MacLatin2, MacRoman, MacTurkish, CP1125, KOI8-T, KZ1048, PTCP154, CP437, CP737, CP775, CP850, CP852, CP855, CP856, CP857, CP860, CP861, CP863, CP865, CP866, CP869, CP037, CP875, CP1026, CP720; and, only via -l, Windows-1250, Windows-1251, Windows-1252, Windows-1253, Windows-1254, Windows-1255, Windows-1256, Windows-1257. (CP720 was observed only for crafted inputs, see detect.unprinted-names; it is allowed, not required.)
5. With --minimal the line is NAME alone, or `None` (cli.minimal).

**Inputs:** any input
**Outputs:** one stdout line per input
**Edge cases:** confidence exactly 1

**Acceptance**
- `samples/bg/cp1251.txt` -> stdout is one line that starts with `samples/bg/cp1251.txt: WINDOWS-1251 with confidence `; the rest of the line matches /^[01]\.[0-9]+$/ and parses to a number in [0, 1].
- `samples/edge/ascii-only.txt` -> the confidence token matches /^[01]\.[0-9]+$/ (value not checked).
- `samples/edge/empty.bin` -> stdout is exactly `samples/edge/empty.bin: no result`, exit 0.
- Over the whole corpus under every era, with and without -l, every printed name is in the list of behaviour 4.

## output.streams-exit

**Covers:** output.streams, output.exit-codes | **Layer:** behaviour | **Priority:** must | **Source:** watched

Results, help and version go to stdout with exit 0; argument and file errors go to stderr with exit 2.

**Behaviour**
1. Result lines, --minimal lines, help and version are written to stdout only.
2. Argument errors, file errors and the interactive stdin notice are written to stderr only.
3. Exit 0 after a normal run, even when some or all inputs give no result; exit 0 for --help and --version.
4. Exit 2 for any argument error: unknown option, invalid or missing era value, an input that cannot be opened.

**Inputs:** any invocation
**Outputs:** stream routing; exit code
**Edge cases:** every input gives no result

**Acceptance**
- `samples/edge/empty.bin samples/edge/random-bytes.bin samples/edge/nul-heavy.bin` -> exit 0, stderr empty, 3 stdout lines each ending in `: no result`.
- `samples/bg/cp1251.txt samples/edge/empty.bin` -> exit 0, stderr empty, 2 stdout lines.
- `--help` and `--version` -> exit 0, stderr empty, stdout non-empty.
- `--bogus`, `-e BOGUS samples/edge/ascii-only.txt`, `--encoding-era` and `nonexistent-file.txt` -> each exit 2, stdout empty, stderr non-empty.

## detect.input-limit

**Covers:** behaviour.input-limit | **Layer:** behaviour | **Priority:** should | **Source:** watched

Only the first 200,000 bytes of an input are analysed, which makes late non-ASCII bytes give no result.

**Behaviour**
1. Detection analyses at most the first 200,000 bytes (offsets 0 to 199,999) of each input.
2. An input whose bytes are all 7-bit throughout (no ESC) is ascii at any length.
3. An input whose first 200,000 bytes are all 7-bit but which has a byte >= 0x80 at offset 200,000 or later gives no result (not ascii).
4. An input with non-ASCII text inside the first 200,000 bytes is judged on that window; ASCII after it does not matter.

**Inputs:** inputs larger than 200,000 bytes
**Outputs:** name or no result
**Edge cases:** exactly 200,000 ASCII bytes; first high byte at offset exactly 200,000

**Acceptance**
- Let A(n) be n bytes made by repeating the ASCII line `The quick brown fox jumps over the lazy dog.\n` and cutting at n bytes, and U be the UTF-8 bytes of `Grüße aus Köln, schöne Straße.\n` repeated until at least 1,000 bytes.
- A(199000) + U -> utf-8.
- A(201000) + U -> None.
- A(200000) -> ascii.
- A(210000) -> ascii.
- A(200000) + the single byte E9 -> None.
- A(250000) + the Windows-1252 bytes of `Café crème brûlée.\n` -> None.
- U + A(210000) -> utf-8.

## detect.bom

**Covers:** behaviour.bom.utf8, behaviour.bom.utf16, behaviour.bom.utf32, encoding.utf-8-sig, encoding.utf-16, encoding.utf-32 | **Layer:** behaviour | **Priority:** must | **Source:** watched

A leading byte-order mark decides the result outright, in every era.

**Behaviour**
1. Input starting with EF BB BF is `UTF-8-SIG`, whatever follows (nothing, ASCII, or bytes that are not valid UTF-8).
2. Input starting with FF FE 00 00 or 00 00 FE FF is `UTF-32` (no byte order in the name), including a lone 4-byte mark. FF FE 00 00 is UTF-32, not UTF-16.
3. Otherwise input starting with FF FE or FE FF is `UTF-16` (no byte order in the name), including a lone 2-byte mark and an odd remaining length.
4. BOM results hold in every era and are not changed by -l. Their confidence is present (value unspecified).

**Inputs:** inputs beginning with a BOM
**Outputs:** UTF-8-SIG; UTF-16; UTF-32
**Edge cases:** BOM only; UTF-8 BOM followed by invalid UTF-8; UTF-16 BOM with odd length

**Acceptance**
- Bytes EF BB BF -> UTF-8-SIG.
- Bytes EF BB BF 68 65 6C 6C 6F 0A -> UTF-8-SIG, under each of the 7 eras.
- Bytes EF BB BF 63 61 66 E9 0A -> UTF-8-SIG.
- Bytes FF FE -> UTF-16; bytes FE FF -> UTF-16.
- Bytes FF FE 48 00 69 00 -> UTF-16; bytes FE FF 00 48 00 69 -> UTF-16; bytes FF FE 48 00 69 -> UTF-16.
- Bytes FF FE 00 00 -> UTF-32; bytes 00 00 FE FF -> UTF-32.
- Bytes FF FE 00 00 48 00 00 00 -> UTF-32; bytes 00 00 FE FF 00 00 00 48 -> UTF-32.
- edge/bom-only-utf8 and {el,en,ja,ru}/utf-8-sig -> UTF-8-SIG; {el,en,ja,ru}/utf-16le-bom and utf-16be-bom -> UTF-16; {el,en,ja,ru}/utf-32le-bom and utf-32be-bom -> UTF-32; each under all 7 eras.

## detect.unicode-no-bom

**Covers:** behaviour.unicode.no-bom-16, behaviour.unicode.no-bom-32, encoding.utf-16le, encoding.utf-16be, encoding.utf-32le, encoding.utf-32be | **Layer:** behaviour | **Priority:** must | **Source:** watched

BOM-less UTF-16 and UTF-32 are recognised and named with lower-case byte-order names, in every era.

**Behaviour**
1. BOM-less UTF-32 text is `utf-32le` or `utf-32be` (lower case) for every language tried, including Japanese.
2. BOM-less UTF-16 text with many zero bytes (Latin, Cyrillic, Greek scripts) is `utf-16le` or `utf-16be` (lower case).
3. BOM-less UTF-16 Japanese text (few zero bytes) gives no result, in every era.
4. A very short BOM-less UTF-16 input (4 bytes) gives no result.
5. These results are the same in every era and with -l.

**Inputs:** BOM-less UTF-16/32
**Outputs:** utf-16le; utf-16be; utf-32le; utf-32be; None
**Edge cases:** CJK UTF-16 without BOM; 4-byte UTF-16

**Acceptance**
- {el,en,ru}/utf-16le -> utf-16le and {el,en,ru}/utf-16be -> utf-16be, under all 7 eras.
- ja/utf-16le -> None and ja/utf-16be -> None, under all 7 eras.
- {el,en,ja,ru}/utf-32le -> utf-32le and {el,en,ja,ru}/utf-32be -> utf-32be, under all 7 eras.
- Bytes 48 00 69 00 -> None.

## detect.ascii

**Covers:** behaviour.ascii, encoding.ascii | **Layer:** behaviour | **Priority:** must | **Source:** watched

Input made only of 7-bit bytes, with no ESC byte and not looking like an escape-marker encoding, is 'ascii' in every era.

**Behaviour**
1. Input of at least one byte where every byte is 0x01-0x7F, no byte is 0x1B, and the text `~{` does not occur, is `ascii` in every era.
2. This includes CRLF text, a lone LF and a lone space.
3. NUL bytes: a file whose only byte is 0x00, and the short text 61 62 63 00 64 65 66 0A (`abc`, NUL, `def`, LF), give no result in every era (see detect.empty-binary). Whether a long 7-bit text with a single NUL is ascii is not specified.
4. 7-bit text containing `~{` is not ascii: it is utf-8 or HZ-GB-2312 (see detect.escape).
5. Samples saved in a legacy code page whose text happens to be pure ASCII are ascii (en/latin-1, en/cp437, en/cp850, eo/iso8859-3, eo/utf-8, he/cp424, texts/eo).

**Inputs:** 7-bit input
**Outputs:** ascii
**Edge cases:** single NUL inside short text gives None; single NUL alone; CRLF; `~{` in plain text

**Acceptance**
- Bytes `hello\r\nworld\r\n` -> ascii.
- Bytes 0A -> ascii; bytes 20 -> ascii.
- Bytes 61 62 63 20 64 65 66 0A (`abc def` LF) -> ascii, under each of the 7 eras; the same bytes with 20 replaced by 00 are covered by detect.empty-binary.
- edge/ascii-only, en/ascii, en/cp437, en/cp850, en/latin-1, eo/iso8859-3, eo/utf-8, he/cp424, texts/eo -> ascii, under all 7 eras and with -l.

## detect.ascii-esc

**Covers:** behaviour.ascii-with-esc | **Layer:** behaviour | **Priority:** should | **Source:** watched

7-bit text containing stray ESC bytes is reported as utf-8, not ascii.

**Behaviour**
1. 7-bit input containing one or more 0x1B bytes that do not form an ISO-2022-JP or ISO-2022-KR designator (for example terminal colour codes) is `utf-8`, with a confidence present (value unspecified).
2. Observed in MODERN_WEB and ALL; other eras unobserved.

**Inputs:** 7-bit input with ESC
**Outputs:** utf-8
**Edge cases:** ESC [ sequences

**Acceptance**
- Bytes of `plain ` + 1B + `[31mred` + 1B + `[0m\n` -> utf-8.
- `-e ALL` on the same bytes -> utf-8.

## detect.empty-binary

**Covers:** behaviour.empty, behaviour.binary | **Layer:** behaviour | **Priority:** must | **Source:** watched

Empty input and binary or undecodable input give no result, which is not an error.

**Behaviour**
1. A 0-byte file or empty stdin gives no result (`None` with --minimal), exit 0.
2. Random bytes, mostly-NUL data, a single 0x00, a single 0x80 and a single 0xFF give no result, in MODERN_WEB and ALL.
3. Short 7-bit text containing a NUL byte, e.g. 61 62 63 00 64 65 66 0A, gives no result in every era.
4. ASCII text containing the overlong UTF-8 pair C0 AF is not binary: it gets a single-byte name (see detect.utf8-invalid).
5. edge/empty.bin, edge/random-bytes.bin and edge/nul-heavy.bin give no result in every era.

**Inputs:** empty or binary input
**Outputs:** no result
**Edge cases:** single high byte alone; NUL inside short text; overlong UTF-8 is not binary

**Acceptance**
- edge/empty.bin -> None, edge/random-bytes.bin -> None, edge/nul-heavy.bin -> None, under all 7 eras.
- Bytes 00 -> None; bytes 80 -> None; bytes FF -> None; each also with -e ALL.
- Bytes 61 62 63 00 64 65 66 0A -> None, under each of the 7 eras.
- Bytes 61 62 63 C0 AF 64 65 66 0A -> WINDOWS-1250 (not None).
- Empty stdin with `--minimal` -> `None`, exit 0.

## detect.utf8

**Covers:** behaviour.utf8, encoding.utf-8 | **Layer:** behaviour | **Priority:** must | **Source:** watched

Valid multibyte UTF-8 without a BOM is 'utf-8' in MODERN_WEB and ALL.

**Behaviour**
1. Valid UTF-8 containing multibyte characters and no BOM is `utf-8` (lower case) in MODERN_WEB and ALL, for every language in the corpus.
2. Confidence is present and grows with the number of multibyte characters (value unspecified).
3. Exceptions: texts/nl (almost all ASCII) is WINDOWS-1252 in MODERN_WEB and ISO-8859-1 in ALL; edge/utf8-one-char (one multibyte character) is utf-8 in MODERN_WEB but CP861 in ALL.
4. One multibyte character is enough for utf-8 only in a short text: the single line `We had a café lunch.\n` (UTF-8) is utf-8 in MODERN_WEB, but the same line placed after a long ASCII text is WINDOWS-1252. The length at which this switches is not specified.
5. In LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS and MAINFRAME BOM-less UTF-8 is never reported as utf-8 (see detect.era-always-on).

**Inputs:** BOM-less UTF-8
**Outputs:** utf-8
**Edge cases:** one multibyte character in a short line (utf-8); one multibyte character in a long ASCII text (WINDOWS-1252); near-ASCII text

**Acceptance**
- Every file in UTF8_SET -> utf-8, and with -e ALL -> utf-8.
- Every file in TEXTS_SET except texts/eo and texts/nl -> utf-8, and with -e ALL -> utf-8.
- texts/nl -> WINDOWS-1252; -e ALL texts/nl -> ISO-8859-1.
- edge/utf8-one-char -> utf-8; -e ALL edge/utf8-one-char -> CP861.
- Bytes of `emoji 😀 here\n` (UTF-8) -> utf-8, and with -e ALL -> utf-8.
- UTF-8 bytes of `We had a café lunch.\n` -> utf-8.
- A(10000) (the ASCII filler defined in detect.input-limit) followed by the UTF-8 bytes of `We had a café lunch.\n` -> WINDOWS-1252.

## detect.utf8-invalid

**Covers:** behaviour.utf8-invalid | **Layer:** behaviour | **Priority:** should | **Source:** watched

Input with an invalid UTF-8 sequence before its end is not reported as utf-8; it gets a single-byte name. A multibyte sequence cut off by end of input does not always stop utf-8.

**Behaviour**
1. If the input contains a byte sequence that is not valid UTF-8 and is followed by more bytes (bad continuation, encoded surrogate, overlong form), the name is never `utf-8`.
2. Observed in MODERN_WEB: `caf` C3 28 -> WINDOWS-1250; an encoded surrogate ED A0 80 -> WINDOWS-1252; ASCII text containing the overlong pair C0 AF -> WINDOWS-1250.
3. Observed in ALL: `caf` C3 28 -> CP861; ED A0 80 -> WINDOWS-1252; ASCII with overlong C0 AF -> a single-byte name (not None, not utf-8).
4. Truncation at end of input: `caf` followed by a lone C3 as the last byte is not utf-8 (WINDOWS-1250 in MODERN_WEB, CP861 in ALL); a 3-byte sequence cut to E2 82 as the last two bytes of the input gives utf-8 in MODERN_WEB and ALL.

**Inputs:** malformed UTF-8
**Outputs:** a single-byte name, or utf-8 for an E2 82 tail
**Edge cases:** truncated final sequence; surrogate code point; overlong form

**Acceptance**
- Bytes 63 61 66 C3 28 0A -> stdout is not `utf-8` (exit 0, one line).
- Bytes 63 61 66 C3 -> not utf-8.
- Bytes 61 62 ED A0 80 63 0A -> not utf-8.
- Bytes 61 62 63 C0 AF 64 65 66 0A -> WINDOWS-1250.
- Each of the four above with -e ALL -> neither utf-8 nor None.
- UTF-8 bytes of `Price: 5 ` followed by E2 82 as the final two bytes -> utf-8, and with -e ALL -> utf-8.

## detect.escape

**Covers:** behaviour.escape-encodings, encoding.iso-2022-jp, encoding.iso-2022-kr, encoding.hz-gb-2312 | **Layer:** behaviour | **Priority:** must | **Source:** watched

7-bit input carrying ISO-2022 escape designators, or HZ '~{' '~}' markers around GB2312 byte pairs, is reported as that escape-based encoding, in every era.

**Behaviour**
1. 7-bit input containing ESC $ B (1B 24 42) and ESC ( B (1B 28 42) is `ISO-2022-JP`.
2. 7-bit input containing ESC $ ) C (1B 24 29 43) is `ISO-2022-KR`, even if nothing else follows but ASCII.
3. 7-bit input is `HZ-GB-2312` when `~{` ... `~}` encloses GB2312 byte pairs (two 7-bit bytes per character), even inside otherwise English text. A bare `~{` ... `~}` pair around plain English words is not enough: such text is `utf-8`.
4. These hold in every era and are not changed by -l.

**Inputs:** 7-bit input with escape markers
**Outputs:** ISO-2022-JP; ISO-2022-KR; HZ-GB-2312
**Edge cases:** escape designators with no other content; HZ markers around English words (utf-8, not HZ)

**Acceptance**
- ja/iso2022_jp -> ISO-2022-JP, ko/iso2022_kr -> ISO-2022-KR, zh_hans/hz -> HZ-GB-2312, under all 7 eras and with -l.
- Bytes 1B 24 42 + `abc` + 1B 28 42 + 0A -> ISO-2022-JP.
- Bytes 1B 24 29 43 + `hello\n` -> ISO-2022-KR.
- Bytes of `The word ~{` + 36 2C 4C 6C + `~} means winter.\n` -> HZ-GB-2312.
- Bytes of `Hello ~{ world ~} end\n` -> utf-8.

## detect.cjk

**Covers:** behaviour.cjk, encoding.big5, encoding.shift_jis, encoding.euc-jp, encoding.euc-kr, encoding.cp949, encoding.gb18030, encoding.johab | **Layer:** behaviour | **Priority:** must | **Source:** watched

Chinese, Japanese and Korean multibyte encodings are recognised in MODERN_WEB and ALL; Johab only in LEGACY_ISO and ALL.

**Behaviour**
1. Shift_JIS and CP932 Japanese are both `SHIFT_JIS` (underscore, upper case).
2. EUC-JP Japanese is `EUC-JP`; EUC-KR Korean is `EUC-KR`; CP949 Korean is `CP949`.
3. GB18030 and GB2312 Simplified Chinese are both `GB18030`; `GB2312` is never printed.
4. Big5 Traditional Chinese is `Big5`.
5. The 240-character excerpts give the same names as the full texts.
6. These names are reported only in MODERN_WEB and ALL; in LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS and MAINFRAME the same files give no result.
7. Johab Korean is `Johab` in LEGACY_ISO and ALL and gives no result in every other era.
8. A 2-byte Shift_JIS fragment gives no result in MODERN_WEB (CP737 in ALL).

**Inputs:** CJK multibyte text
**Outputs:** SHIFT_JIS; EUC-JP; EUC-KR; CP949; GB18030; Big5; Johab
**Edge cases:** short excerpts; 2-byte fragment

**Acceptance**
- ja/shift_jis, ja/shift_jis.short, ja/cp932 -> SHIFT_JIS; ja/euc_jp -> EUC-JP; ko/euc_kr, ko/euc_kr.short -> EUC-KR; ko/cp949 -> CP949; zh_hans/gb18030, zh_hans/gb18030.short, zh_hans/gb2312 -> GB18030; zh_hant/big5, zh_hant/big5.short -> Big5. The same names with -e ALL.
- Each file in the previous check -> None under -e LEGACY_ISO, -e LEGACY_MAC, -e LEGACY_REGIONAL, -e DOS and -e MAINFRAME.
- ko/johab -> None; -e LEGACY_ISO ko/johab -> Johab; -e ALL ko/johab -> Johab; -e LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME ko/johab -> None.
- Bytes 82 A0 (one Shift_JIS character) -> None.

## detect.era-modern-web

**Covers:** behaviour.era.default, behaviour.era.modern-web, behaviour.single-byte-ambiguity, encoding.koi8-r, encoding.koi8-u, encoding.cp874, encoding.windows-1250, encoding.windows-1251, encoding.windows-1252, encoding.windows-1253, encoding.windows-1254, encoding.windows-1255, encoding.windows-1256, encoding.windows-1257, encoding.windows-1258 | **Layer:** behaviour | **Priority:** must | **Source:** watched

The default era MODERN_WEB reports only web-era encodings; legacy-coded text maps to the nearest modern page or to no result.

**Behaviour**
1. Without -e the era is MODERN_WEB; results equal `-e MODERN_WEB`.
2. MODERN_WEB may report: ascii, utf-8, UTF-8-SIG, UTF-16, UTF-32, utf-16le/be, utf-32le/be, Big5, CP949, EUC-JP, EUC-KR, GB18030, HZ-GB-2312, ISO-2022-JP, ISO-2022-KR, SHIFT_JIS, CP874, KOI8-R, KOI8-U, WINDOWS-1250 to WINDOWS-1258.
3. Text in a legacy-only encoding is reported as the closest modern page (for example ISO-8859-15 French as WINDOWS-1252, ISO-8859-2 and CP852 Czech as WINDOWS-1250, CP865 Danish as WINDOWS-1257) or gives no result (for example CP037, CP850 German, CP855, CP866, ISO-8859-5 Russian, CP737, Johab).
4. When several code pages give identical bytes, one fixed name wins: Latin-1, ISO-8859-15 and Windows-1252 Western text -> WINDOWS-1252; ISO-8859-2 and ISO-8859-16 Central European -> WINDOWS-1250; ISO-8859-13 and ISO-8859-4 Baltic -> WINDOWS-1257; ISO-8859-7 Greek -> WINDOWS-1253; ISO-8859-9 Turkish -> WINDOWS-1254; Icelandic Latin-1, Windows-1252 and ISO-8859-10 -> WINDOWS-1250.
5. On OTHER_202 the names are exactly those in the acceptance table.

**Inputs:** any input, no -e or -e MODERN_WEB
**Outputs:** MODERN_WEB names
**Edge cases:** legacy-coded input; byte-identical code pages; a short English text with Windows-1252 curly quotes was reported WINDOWS-1258

**Acceptance**
- Every corpus file gives the same name with no -e as with `-e MODERN_WEB`.
- MODERN_WEB on OTHER_202 -> utf-8 <- UTF8_SET, every TEXTS_SET file except texts/eo and texts/nl, edge/utf8-one-char.
- MODERN_WEB -> WINDOWS-1252 <- cy/iso8859-14, da/cp1252, da/latin-1, de/cp1252.short, de/cp1252, de/iso8859-15, de/latin-1, de/mac-roman, edge/single-high-byte, en/cp1252.short, en/cp1252, en/mac-roman, es/cp1252, es/cp850, es/latin-1, fi/cp1252, fi/latin-1, fr/cp1252.short, fr/cp1252, fr/cp850, fr/cp863, fr/iso8859-15, fr/latin-1, ga/iso8859-14, ga/latin-1, is/mac-iceland, it/cp1252, it/latin-1, nl/cp1252, nl/latin-1, no/cp1252, no/latin-1, pl/cp852, pt/cp1252, pt/latin-1, sv/cp1252, sv/latin-1, texts/nl.
- MODERN_WEB -> WINDOWS-1250 <- cs/cp1250, cs/cp852, cs/iso8859-2, cs/mac-latin2, hr/cp1250, hr/iso8859-2, hu/cp1250, hu/iso8859-16, hu/iso8859-2, is/cp1252, is/iso8859-10, is/latin-1, no/cp865, pl/cp1250.short, pl/cp1250, pl/iso8859-16, pl/iso8859-2, ro/cp1250, ro/iso8859-16, ro/iso8859-2, sk/cp1250, sk/cp852, sk/iso8859-2, sl/cp1250, sl/iso8859-2, tr/mac-turkish.
- MODERN_WEB -> WINDOWS-1251 <- bg/cp1251, bg/mac-cyrillic, ru/cp1251.short, ru/cp1251, ru/mac-cyrillic, sr/cp1251, uk/cp1251.
- MODERN_WEB -> WINDOWS-1253 <- el/cp1253.short, el/cp1253, el/iso8859-7 | WINDOWS-1254 <- tr/cp1254.short, tr/cp1254, tr/iso8859-3, tr/iso8859-9 | WINDOWS-1256 <- ar/cp1256.short, ar/iso8859-6, fa/cp1256 | WINDOWS-1257 <- da/cp865, et/cp1257, et/iso8859-13, et/iso8859-4, lt/cp1257, lt/cp775, lt/iso8859-13, lt/iso8859-4 | WINDOWS-1258 <- vi/cp1258.
- MODERN_WEB -> KOI8-R <- ru/koi8-r | KOI8-U <- uk/koi8-u | CP874 <- th/cp874.short, th/cp874, th/iso8859-11, th/tis-620 | SHIFT_JIS <- ja/cp932, ja/shift_jis.short, ja/shift_jis | EUC-JP <- ja/euc_jp | EUC-KR <- ko/euc_kr.short, ko/euc_kr | CP949 <- ko/cp949 | GB18030 <- zh_hans/gb18030.short, zh_hans/gb18030, zh_hans/gb2312 | Big5 <- zh_hant/big5.short, zh_hant/big5.
- MODERN_WEB -> None <- ar/cp1256, ar/cp720, bg/cp855, bg/iso8859-5, de/cp037, de/cp850, de/cp858, el/cp737, el/cp869, el/cp875, el/mac-greek, en/cp037, en/cp500, fr/mac-roman, he/cp856, he/cp862, hu/cp852, is/cp861, ko/johab, pl/mac-latin2, pt/cp860, ru/cp855, ru/cp866, ru/iso8859-5, sr/iso8859-5, tr/cp1026, tr/cp857, uk/cp1125.

## detect.era-always-on

**Covers:** behaviour.era.always-on, behaviour.era.utf8-modern-only | **Layer:** behaviour | **Priority:** must | **Source:** watched

BOM forms, BOM-less UTF-16/32, ascii, escape-marker encodings and Hebrew are reported in every era; BOM-less UTF-8 and CJK multibyte only in MODERN_WEB and ALL.

**Behaviour**
1. Whatever era is chosen, these may be reported: ascii; UTF-8-SIG, UTF-16, UTF-32; utf-16le, utf-16be, utf-32le, utf-32be; ISO-2022-JP, ISO-2022-KR, HZ-GB-2312; and WINDOWS-1255 for Hebrew text in Windows-1255 or ISO-8859-8 bytes.
2. ISO-8859-8 is also printed outside its own tier: bg/mac-cyrillic gives ISO-8859-8 under LEGACY_ISO, DOS and MAINFRAME.
3. The ALWAYS_ON corpus files give the same name under all 7 eras.
4. BOM-less UTF-8 is reported as utf-8 only in MODERN_WEB and ALL. Under any other single era the same bytes become a code page of that era or give no result.
5. SHIFT_JIS, EUC-JP, EUC-KR, CP949, GB18030 and Big5 are reported only in MODERN_WEB and ALL.

**Inputs:** any -e value
**Outputs:** era-independent names
**Edge cases:** UTF-8 under a legacy era

**Acceptance**
- For each of the 7 eras, every ALWAYS_ON file gives the name listed for it in ALWAYS_ON.
- For each era in LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, DOS, MAINFRAME: no file in UTF8_SET or TEXTS_SET gives utf-8.
- -e MAINFRAME, -e LEGACY_REGIONAL: every file in UTF8_SET -> None.
- -e LEGACY_ISO de/utf-8 -> ISO-8859-1; -e LEGACY_MAC de/utf-8 -> MacRoman; -e DOS de/utf-8 -> CP850.
- -e LEGACY_ISO bg/mac-cyrillic -> ISO-8859-8; -e DOS bg/mac-cyrillic -> ISO-8859-8; -e MAINFRAME bg/mac-cyrillic -> ISO-8859-8.

## detect.era-legacy-iso

**Covers:** behaviour.era.legacy-iso, encoding.iso-8859-1, encoding.iso-8859-2, encoding.iso-8859-3, encoding.iso-8859-4, encoding.iso-8859-5, encoding.iso-8859-6, encoding.iso-8859-7, encoding.iso-8859-8, encoding.iso-8859-9, encoding.iso-8859-10, encoding.iso-8859-11, encoding.iso-8859-13, encoding.iso-8859-14, encoding.iso-8859-15, encoding.iso-8859-16 | **Layer:** behaviour | **Priority:** must | **Source:** watched

LEGACY_ISO reports ISO-8859 pages and Johab plus the always-on set; Windows pages, BOM-less UTF-8 and CJK multibyte are not reported.

**Behaviour**
1. Single-byte results come only from ISO-8859-1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -13, -14, -15, -16, plus Johab and the always-on set.
2. Windows code pages are not reported: Windows-1251 Bulgarian and Windows-1256 Arabic give no result; Windows-1252 Western text gives ISO-8859-15.
3. BOM-less UTF-8 is reported as an ISO page or Johab (e.g. German UTF-8 -> ISO-8859-1) or gives no result.
4. Thai (CP874, ISO-8859-11, TIS-620) -> ISO-8859-11. Hebrew ISO-8859-8 stays WINDOWS-1255. Arabic ISO-8859-6 gives ISO-8859-6. Mac Cyrillic Bulgarian (bg/mac-cyrillic) gives ISO-8859-8.
5. Rows marked [text-specific] hold for the evidence file's exact bytes only (see TEXT_SPECIFIC): other Icelandic texts gave ISO-8859-10, another Slovak UTF-8 text gave Johab, another Portuguese UTF-8 text gave ISO-8859-15.
6. On OTHER_202 the names are exactly those in the acceptance table; every OTHER_202 file not listed gives None.

**Inputs:** -e LEGACY_ISO
**Outputs:** ISO-8859-n names (including ISO-8859-6 and ISO-8859-8), Johab
**Edge cases:** UTF-8 Czech, Croatian, Norwegian and Swedish texts come out as Johab

**Acceptance**
- -e LEGACY_ISO -> ISO-8859-15 <- da/cp1252, da/cp865, da/latin-1, de/cp1252.short, de/cp1252, de/cp850, de/cp858, de/iso8859-15, de/latin-1, de/mac-roman, en/cp1252.short, en/cp1252, en/mac-roman, en/utf-8, es/cp1252, es/cp850, es/latin-1, es/utf-8, fi/cp1252, fi/latin-1, fi/utf-8, fr/cp1252.short, fr/cp1252, fr/cp850, fr/cp863, fr/iso8859-15, fr/latin-1, fr/mac-roman, is/cp861, it/cp1252, it/latin-1, nl/cp1252, nl/latin-1, no/cp1252, no/cp865, no/latin-1, pt/cp1252, pt/cp860, pt/latin-1, sv/cp1252, sv/latin-1, texts/en, texts/es, texts/fi.
- -e LEGACY_ISO -> ISO-8859-1 <- de/utf-8, edge/utf8-one-char, fr/utf-8, is/cp1252 [text-specific], is/latin-1 [text-specific], is/mac-iceland [text-specific], it/utf-8, pt/utf-8 [text-specific], texts/da, texts/de, texts/et, texts/fr, texts/is, texts/it, texts/nl, texts/pt.
- -e LEGACY_ISO -> ISO-8859-2 <- cs/cp1250, cs/cp852, cs/iso8859-2, cs/mac-latin2, hr/cp1250, hr/iso8859-2, hu/cp1250, hu/cp852, hu/iso8859-2, pl/cp1250.short, pl/cp1250, pl/iso8859-2, pl/mac-latin2, ro/utf-8, sk/cp1250, sk/cp852, sk/iso8859-2, sk/utf-8 [text-specific], texts/ro, texts/sk.
- -e LEGACY_ISO -> ISO-8859-16 <- hu/iso8859-16, hu/utf-8, pl/cp852, pl/iso8859-16, pl/utf-8, ro/cp1250, ro/iso8859-16, ro/iso8859-2, sl/cp1250, sl/iso8859-2, texts/hu, texts/pl, texts/sl.
- -e LEGACY_ISO -> ISO-8859-13 <- et/cp1257, et/iso8859-13, et/iso8859-4, lt/cp1257, lt/iso8859-13, lt/utf-8, texts/lt | ISO-8859-4 <- lt/cp775, lt/iso8859-4 | ISO-8859-14 <- cy/iso8859-14, cy/utf-8, ga/iso8859-14, ga/latin-1, texts/cy, texts/ga | ISO-8859-10 <- edge/single-high-byte, is/iso8859-10.
- -e LEGACY_ISO -> ISO-8859-5 <- bg/iso8859-5, ru/iso8859-5, sr/iso8859-5 | ISO-8859-7 <- el/cp1253.short, el/cp1253, el/iso8859-7 | ISO-8859-9 <- tr/cp1254.short, tr/cp1254, tr/iso8859-9, tr/utf-8, texts/tr | ISO-8859-3 <- tr/cp857, tr/iso8859-3, tr/mac-turkish | ISO-8859-11 <- th/cp874.short, th/cp874, th/iso8859-11, th/tis-620.
- -e LEGACY_ISO -> Johab <- cs/utf-8, ko/johab, texts/cs, texts/hr, texts/no, texts/sv.
- -e LEGACY_ISO -> ISO-8859-6 <- ar/iso8859-6 | ISO-8859-8 <- bg/mac-cyrillic.
- -e LEGACY_ISO -> None for every other OTHER_202 file (66 files), including bg/cp1251, ar/cp1256.short, fa/cp1256, ru/koi8-r, ja/shift_jis, zh_hans/gb18030, zh_hant/big5, ko/euc_kr, vi/cp1258, ru/utf-8 and texts/ja.

## detect.era-legacy-mac

**Covers:** behaviour.era.legacy-mac, encoding.maccyrillic, encoding.macgreek, encoding.maciceland, encoding.maclatin2, encoding.macroman, encoding.macturkish | **Layer:** behaviour | **Priority:** must | **Source:** watched

LEGACY_MAC reports the six Mac code pages plus the always-on set.

**Behaviour**
1. Single-byte results come only from MacCyrillic, MacGreek, MacIceland, MacLatin2, MacRoman and MacTurkish, plus the always-on set.
2. Every Mac-encoded sample is named correctly.
3. Western Windows-1252, Latin-1 and UTF-8 text comes out as MacRoman; Windows-1251 Cyrillic as MacCyrillic. Arabic ISO-8859-6 gives no result.
4. On OTHER_202 the names are exactly those in the acceptance table; every OTHER_202 file not listed gives None.

**Inputs:** -e LEGACY_MAC
**Outputs:** Mac* names
**Edge cases:** Baltic and Romanian text has no Mac page of its own and comes out MacRoman

**Acceptance**
- -e LEGACY_MAC -> MacRoman <- cs/cp1250, cs/iso8859-2, cs/utf-8, cy/iso8859-14, cy/utf-8, da/cp1252, da/cp865, da/latin-1, de/cp1252.short, de/cp1252, de/cp850, de/cp858, de/iso8859-15, de/latin-1, de/mac-roman, de/utf-8, en/cp1252.short, en/cp1252, en/mac-roman, en/utf-8, es/cp1252, es/cp850, es/latin-1, es/utf-8, et/cp1257, et/iso8859-13, et/iso8859-4, fi/cp1252, fi/latin-1, fi/utf-8, fr/cp1252.short, fr/cp1252, fr/cp850, fr/cp863, fr/iso8859-15, fr/latin-1, fr/mac-roman, fr/utf-8, ga/iso8859-14, ga/latin-1, is/cp861, it/cp1252, it/latin-1, it/utf-8, lt/cp1257, lt/cp775, lt/iso8859-13, lt/iso8859-4, lt/utf-8, nl/cp1252, nl/latin-1, no/cp1252, no/cp865, no/latin-1, pt/cp1252, pt/cp860, pt/latin-1, pt/utf-8, ro/cp1250, ro/iso8859-16, ro/iso8859-2, ro/utf-8, sv/cp1252, sv/latin-1, texts/cs, texts/cy, texts/da, texts/de, texts/en, texts/es, texts/et, texts/fi, texts/fr, texts/ga, texts/is, texts/it, texts/lt, texts/nl, texts/no, texts/pt, texts/ro, texts/sv.
- -e LEGACY_MAC -> MacLatin2 <- cs/cp852, cs/mac-latin2, hr/cp1250, hr/iso8859-2, hu/cp1250, hu/cp852, hu/iso8859-16, hu/iso8859-2, hu/utf-8, pl/cp1250.short, pl/cp1250, pl/cp852, pl/iso8859-16, pl/iso8859-2, pl/mac-latin2, pl/utf-8, sk/cp1250, sk/cp852, sk/iso8859-2, sk/utf-8, sl/cp1250, sl/iso8859-2, texts/hr, texts/hu, texts/pl, texts/sk, texts/sl.
- -e LEGACY_MAC -> MacCyrillic <- bg/cp1251, bg/mac-cyrillic, ru/cp1251.short, ru/cp1251, ru/mac-cyrillic, sr/cp1251, uk/cp1251 | MacIceland <- edge/single-high-byte, edge/utf8-one-char, is/cp1252, is/iso8859-10, is/latin-1, is/mac-iceland | MacGreek <- el/cp1253.short, el/cp1253, el/iso8859-7, el/mac-greek | MacTurkish <- tr/cp1254.short, tr/cp1254, tr/cp857, tr/iso8859-3, tr/iso8859-9, tr/mac-turkish, tr/utf-8, texts/tr.
- -e LEGACY_MAC -> None for every other OTHER_202 file (68 files), including ar/iso8859-6, bg/cp855, bg/iso8859-5, ru/koi8-r, th/cp874, ko/johab, ja/shift_jis and ru/utf-8.

## detect.era-legacy-regional

**Covers:** behaviour.era.legacy-regional, encoding.cp1125, encoding.koi8-t, encoding.kz1048, encoding.ptcp154 | **Layer:** behaviour | **Priority:** must | **Source:** watched

LEGACY_REGIONAL reports a few regional Cyrillic pages plus the always-on set; most input gives no result.

**Behaviour**
1. Single-byte results seen: CP1125, KZ1048, KOI8-T and PTCP154, plus the always-on set.
2. CP1125 Ukrainian and CP866 Russian give CP1125. Windows-1251 and MacCyrillic Cyrillic mostly give KZ1048; Serbian Windows-1251 gives PTCP154. KOI8-R Russian gives KOI8-T. The evidence's KOI8-U Ukrainian file also gives KOI8-T, but that is [text-specific]: another Ukrainian KOI8-U text gave no result.
3. Everything else in the evidence corpus gives no result: 196 of the 257 corpus files.
4. CP720 may also be printed in this era. Observed examples, not required outcomes: the input written `hi F0 9F 98 ok\n` (`hi`, the first three bytes of a 4-byte UTF-8 sequence, `ok`, LF) gave CP720; a long ASCII text containing one emoji also gave CP720.
5. On OTHER_202 the names are exactly those in the acceptance table; every OTHER_202 file not listed gives None.

**Inputs:** -e LEGACY_REGIONAL
**Outputs:** CP1125, KZ1048, KOI8-T, PTCP154, and possibly CP720
**Edge cases:** Arabic CP720 text (ar/cp720) gives no result; crafted inputs with a broken or isolated 4-byte UTF-8 sequence were observed to give CP720

**Acceptance**
- -e LEGACY_REGIONAL -> KZ1048 <- bg/cp1251, bg/mac-cyrillic, ru/cp1251.short, ru/cp1251, ru/mac-cyrillic, uk/cp1251 | CP1125 <- ru/cp866, uk/cp1125 | KOI8-T <- ru/koi8-r, uk/koi8-u [text-specific] | PTCP154 <- sr/cp1251.
- -e LEGACY_REGIONAL -> None for every other OTHER_202 file (191 files), including ar/cp720, bg/cp855, de/cp1252 and de/utf-8.
- -e LEGACY_REGIONAL over all 257 evidence corpus files: exactly 196 lines are None [text-specific].

## detect.era-dos

**Covers:** behaviour.era.dos, encoding.cp437, encoding.cp737, encoding.cp775, encoding.cp850, encoding.cp852, encoding.cp855, encoding.cp856, encoding.cp857, encoding.cp860, encoding.cp861, encoding.cp863, encoding.cp865, encoding.cp866, encoding.cp869 | **Layer:** behaviour | **Priority:** must | **Source:** watched

DOS reports OEM code pages plus the always-on set.

**Behaviour**
1. Single-byte results come from DOS code pages, plus the always-on set. Seen: CP437, CP737, CP775, CP850, CP852, CP855, CP856, CP857, CP860, CP861, CP863, CP865, CP866, CP869. Exception: bg/mac-cyrillic gives ISO-8859-8.
2. CP858 German gives CP850; CP862 Hebrew gives CP856; CP865 Danish and Norwegian give CP850; CP1125 Ukrainian gives CP866. Rows marked [text-specific] are not general rules: other texts gave CP861 (Icelandic, not CP865), CP850 (French UTF-8, not CP863), CP852 or CP775 (Lithuanian ISO-8859-4, not CP865) and CP860 (Spanish Latin-1, not CP850).
3. Arabic CP720, BOM-less UTF-8 Cyrillic/Greek/Asian text and Windows-1251 give no result.
4. On OTHER_202 the names are exactly those in the acceptance table; every OTHER_202 file not listed gives None.

**Inputs:** -e DOS
**Outputs:** CPnnn names
**Edge cases:** Latin UTF-8 text comes out as a DOS page

**Acceptance**
- -e DOS -> CP850 <- da/cp865, de/cp1252.short, de/cp1252, de/cp850, de/cp858, de/iso8859-15, de/latin-1, de/mac-roman, de/utf-8, es/cp1252, es/cp850, es/latin-1 [text-specific], es/utf-8, fi/utf-8, fr/cp1252.short, fr/cp863, fr/mac-roman, ga/iso8859-14, ga/latin-1, it/cp1252, it/latin-1, it/utf-8, nl/cp1252, nl/latin-1, no/cp1252, no/cp865, no/latin-1, pt/utf-8, sv/cp1252, sv/latin-1, tr/cp1254, tr/iso8859-3, tr/iso8859-9, texts/da, texts/de, texts/es, texts/fi, texts/ga, texts/it, texts/nl, texts/no, texts/pt.
- -e DOS -> CP852 <- cs/cp1250, cs/cp852, cs/iso8859-2, cs/mac-latin2, cs/utf-8, hr/cp1250, hr/iso8859-2, hu/cp1250, hu/cp852, hu/iso8859-16, hu/iso8859-2, hu/utf-8, pl/cp1250.short, pl/cp1250, pl/cp852, pl/iso8859-16, pl/iso8859-2, pl/mac-latin2, pl/utf-8, ro/cp1250, ro/iso8859-16, ro/iso8859-2, ro/utf-8, sk/cp1250, sk/cp852, sk/iso8859-2, sk/utf-8, sl/cp1250, sl/iso8859-2, texts/cs, texts/hr, texts/hu, texts/pl, texts/ro, texts/sk, texts/sl.
- -e DOS -> CP775 <- et/cp1257, et/iso8859-13, et/iso8859-4, fi/cp1252, fi/latin-1, lt/cp1257, lt/cp775, lt/iso8859-13, lt/utf-8, texts/et, texts/lt | CP437 <- cy/iso8859-14, cy/utf-8, en/cp1252.short, en/cp1252, en/mac-roman, en/utf-8, texts/cy, texts/en | CP865 <- da/cp1252, da/latin-1, is/cp1252 [text-specific], is/iso8859-10 [text-specific], is/latin-1 [text-specific], is/mac-iceland [text-specific], lt/iso8859-4 [text-specific], texts/sv.
- -e DOS -> CP863 <- fr/cp1252, fr/cp850, fr/iso8859-15, fr/latin-1, fr/utf-8 [text-specific], tr/cp1254.short, texts/fr | CP861 <- edge/single-high-byte, edge/utf8-one-char, is/cp861, texts/is | CP857 <- tr/cp857, tr/mac-turkish, tr/utf-8, texts/tr | CP860 <- pt/cp1252, pt/cp860, pt/latin-1.
- -e DOS -> CP855 <- bg/cp855, ru/cp855 | CP866 <- ru/cp866, uk/cp1125 | CP856 <- he/cp856, he/cp862 | CP737 <- el/cp737 | CP869 <- el/cp869.
- -e DOS -> ISO-8859-8 <- bg/mac-cyrillic.
- -e DOS -> None for every other OTHER_202 file (70 files), including ar/cp720, bg/cp1251, el/cp1253, en/cp037, ja/shift_jis, ru/koi8-r and ru/utf-8.

## detect.era-mainframe

**Covers:** behaviour.era.mainframe, encoding.cp037, encoding.cp875, encoding.cp1026 | **Layer:** behaviour | **Priority:** must | **Source:** watched

MAINFRAME reports EBCDIC code pages plus the always-on set.

**Behaviour**
1. Single-byte results come from EBCDIC: CP037, CP875 and CP1026, plus the always-on set. Exception: bg/mac-cyrillic gives ISO-8859-8.
2. CP500 English gives CP037 (leading zero kept in the name).
3. CP424 Hebrew is all 7-bit bytes and gives ascii in every era.
4. Windows-1252 and UTF-8 text give no result.
5. On OTHER_202 the names are exactly those in the acceptance table; every OTHER_202 file not listed gives None.

**Inputs:** -e MAINFRAME
**Outputs:** CP037, CP875, CP1026
**Edge cases:** EBCDIC text that is byte-identical across CP037 and CP500

**Acceptance**
- -e MAINFRAME -> CP037 <- de/cp037, en/cp037, en/cp500 | CP875 <- el/cp875 | CP1026 <- tr/cp1026 | ISO-8859-8 <- bg/mac-cyrillic.
- -e MAINFRAME -> None for every other OTHER_202 file (196 files), including de/cp1252, de/utf-8 and en/cp1252.
- -e MAINFRAME he/cp424 -> ascii.

## detect.era-all

**Covers:** behaviour.era.all | **Layer:** behaviour | **Priority:** must | **Source:** watched

ALL lets every tier compete, which often changes the default answer even for modern files.

**Behaviour**
1. With -e ALL every encoding of every tier may be reported.
2. Western European Windows-1252 or Latin-1 text is mostly ISO-8859-15; long English Windows-1252 is MacRoman; Dutch Windows-1252/Latin-1 is CP850; Arabic ISO-8859-6 is ISO-8859-6. The evidence's Russian Windows-1251 file gives MacCyrillic, but that is [text-specific]: another Russian Windows-1251 text gave WINDOWS-1251. The Icelandic rows marked [text-specific] are likewise not rules (other Icelandic texts gave ISO-8859-10).
3. Very short UTF-8 can lose to a DOS page (edge/utf8-one-char -> CP861); longer UTF-8 stays utf-8.
4. Only 7 of the 257 corpus files give no result.
5. On OTHER_202 the names are exactly those in the acceptance table.

**Inputs:** -e ALL
**Outputs:** any name
**Edge cases:** byte-identical neighbours: latin-1 as ISO-8859-15, cp865 as CP850, cp862 as CP856, cp866 as CP1125, cp500 as CP037

**Acceptance**
- -e ALL -> utf-8 <- UTF8_SET and every TEXTS_SET file except texts/eo and texts/nl.
- -e ALL -> ISO-8859-15 <- da/latin-1, de/cp1252.short, de/cp1252, de/iso8859-15, de/latin-1, es/latin-1, fi/cp1252, fi/latin-1, fr/cp1252.short, fr/cp1252, fr/iso8859-15, fr/latin-1, it/latin-1, no/cp1252, no/latin-1, pt/cp1252, pt/latin-1, sv/cp1252, sv/latin-1.
- -e ALL -> WINDOWS-1252 <- da/cp1252, en/cp1252.short, es/cp1252, is/cp1252 [text-specific], it/cp1252 | MacRoman <- de/mac-roman, en/cp1252, fr/mac-roman | CP850 <- da/cp865, de/cp850, de/cp858, es/cp850, fr/cp863, nl/cp1252, nl/latin-1, no/cp865 | CP863 <- fr/cp850 | CP437 <- en/mac-roman | CP860 <- pt/cp860 | CP037 <- de/cp037, en/cp037, en/cp500.
- -e ALL -> ISO-8859-1 <- is/latin-1 [text-specific], texts/nl | ISO-8859-10 <- edge/single-high-byte, is/iso8859-10 | CP861 <- edge/utf8-one-char, is/cp861 | MacIceland <- is/mac-iceland | ISO-8859-14 <- cy/iso8859-14, ga/iso8859-14, ga/latin-1.
- -e ALL -> WINDOWS-1250 <- cs/cp1250, hr/cp1250, hu/cp1250, pl/cp1250.short, pl/cp1250, ro/cp1250, sk/cp1250 | ISO-8859-2 <- cs/iso8859-2, hr/iso8859-2, hu/iso8859-2, pl/iso8859-2, sk/iso8859-2 | ISO-8859-16 <- hu/iso8859-16, pl/iso8859-16, ro/iso8859-16, ro/iso8859-2, sl/cp1250 | CP852 <- cs/cp852, hu/cp852, pl/cp852, sk/cp852, sl/iso8859-2 | MacLatin2 <- cs/mac-latin2, pl/mac-latin2.
- -e ALL -> WINDOWS-1251 <- bg/cp1251, sr/cp1251, uk/cp1251 | MacCyrillic <- bg/mac-cyrillic, ru/cp1251.short, ru/cp1251 [text-specific], ru/mac-cyrillic | ISO-8859-5 <- bg/iso8859-5, ru/iso8859-5, sr/iso8859-5 | CP855 <- bg/cp855, ru/cp855 | CP1125 <- ru/cp866, uk/cp1125 | KOI8-R <- ru/koi8-r | KOI8-U <- uk/koi8-u.
- -e ALL -> WINDOWS-1253 <- el/cp1253 | ISO-8859-7 <- el/cp1253.short, el/iso8859-7 | CP737 <- el/cp737 | CP869 <- el/cp869 | CP875 <- el/cp875 | MacGreek <- el/mac-greek.
- -e ALL -> WINDOWS-1254 <- tr/cp1254.short, tr/cp1254 | ISO-8859-9 <- tr/iso8859-9 | ISO-8859-3 <- tr/iso8859-3 | CP857 <- tr/cp857 | CP1026 <- tr/cp1026 | MacTurkish <- tr/mac-turkish.
- -e ALL -> ISO-8859-13 <- et/cp1257, et/iso8859-13, et/iso8859-4, lt/cp1257, lt/iso8859-13 | CP775 <- lt/cp775 | ISO-8859-4 <- lt/iso8859-4.
- -e ALL -> CP856 <- he/cp856, he/cp862 | WINDOWS-1256 <- ar/cp1256.short, fa/cp1256 | ISO-8859-6 <- ar/iso8859-6 | WINDOWS-1258 <- vi/cp1258 | CP874 <- th/cp874.short, th/cp874, th/iso8859-11, th/tis-620.
- -e ALL -> SHIFT_JIS <- ja/cp932, ja/shift_jis.short, ja/shift_jis | EUC-JP <- ja/euc_jp | EUC-KR <- ko/euc_kr.short, ko/euc_kr | CP949 <- ko/cp949 | Johab <- ko/johab | GB18030 <- zh_hans/gb18030.short, zh_hans/gb18030, zh_hans/gb2312 | Big5 <- zh_hant/big5.short, zh_hant/big5.
- -e ALL -> None <- ar/cp1256, ar/cp720 (plus the 5 None files of ALWAYS_ON: 7 in total over the corpus).

## detect.hebrew

**Covers:** behaviour.hebrew | **Layer:** behaviour | **Priority:** should | **Source:** watched

Hebrew in Windows-1255 or ISO-8859-8 is WINDOWS-1255 in every era; DOS Hebrew pages report as CP856.

**Behaviour**
1. Windows-1255 and ISO-8859-8 Hebrew both give WINDOWS-1255 in every era. The name ISO-8859-8 is never printed for Hebrew text; it was printed only for bg/mac-cyrillic (see detect.era-always-on).
2. CP856 and CP862 Hebrew give CP856 in DOS and ALL and no result in every other era.
3. CP424 Hebrew is pure 7-bit and gives ascii.

**Inputs:** Hebrew text
**Outputs:** WINDOWS-1255; CP856
**Edge cases:** EBCDIC Hebrew that is pure 7-bit

**Acceptance**
- he/cp1255, he/cp1255.short, he/iso8859-8 -> WINDOWS-1255 under each of the 7 eras.
- -e DOS he/cp862 -> CP856; -e ALL he/cp862 -> CP856; he/cp862 -> None; -e LEGACY_ISO, LEGACY_MAC, LEGACY_REGIONAL, MAINFRAME he/cp856 -> None.
- he/cp424 -> ascii under each of the 7 eras.

## detect.thai

**Covers:** behaviour.thai | **Layer:** behaviour | **Priority:** should | **Source:** watched

Thai single-byte text is CP874 in MODERN_WEB and ALL, ISO-8859-11 in LEGACY_ISO.

**Behaviour**
1. CP874, ISO-8859-11 and TIS-620 Thai all give CP874 in MODERN_WEB and ALL.
2. The same files give ISO-8859-11 in LEGACY_ISO and no result in LEGACY_MAC, LEGACY_REGIONAL, DOS and MAINFRAME.
3. TIS-620 is never printed.

**Inputs:** Thai text
**Outputs:** CP874; ISO-8859-11
**Edge cases:** short excerpt

**Acceptance**
- th/cp874, th/cp874.short, th/iso8859-11, th/tis-620 -> CP874, and with -e ALL -> CP874.
- -e LEGACY_ISO on the same four files -> ISO-8859-11.
- -e DOS th/cp874 -> None; -e LEGACY_MAC th/tis-620 -> None.

## detect.arabic

**Covers:** behaviour.arabic | **Layer:** behaviour | **Priority:** should | **Source:** watched

Arabic and Persian single-byte text is detected unreliably; the observed outcomes are specified exactly.

**Behaviour**
1. The short Arabic Windows-1256 excerpt and the Persian Windows-1256 text give WINDOWS-1256 in MODERN_WEB and ALL.
2. The full Arabic Windows-1256 excerpt gives no result in every era.
3. Arabic ISO-8859-6 gives WINDOWS-1256 in MODERN_WEB, ISO-8859-6 in LEGACY_ISO and ALL, and no result in LEGACY_MAC. With -l the ISO-8859-6 results print as Windows-1256.
4. Arabic CP720 gives no result in every era.

**Inputs:** Arabic and Persian text
**Outputs:** WINDOWS-1256, ISO-8859-6 or no result
**Edge cases:** longer text gives no result where the short excerpt succeeds

**Acceptance**
- ar/cp1256.short -> WINDOWS-1256; fa/cp1256 -> WINDOWS-1256; both also with -e ALL.
- ar/cp1256 -> None under each of the 7 eras.
- ar/iso8859-6 -> WINDOWS-1256; -e LEGACY_ISO ar/iso8859-6 -> ISO-8859-6; -e ALL ar/iso8859-6 -> ISO-8859-6; -e LEGACY_MAC ar/iso8859-6 -> None.
- -l -e ALL ar/iso8859-6 -> Windows-1256.
- ar/cp720 -> None under each of the 7 eras.

## detect.corpus-summary

**Covers:** behaviour.labels-comparison | **Layer:** behaviour | **Priority:** should | **Source:** watched

Aggregate agreement figures over the whole corpus, as a cross-check of the per-era tables.

**Behaviour**
1. MODERN_WEB: every Unicode transport form is named (BOM forms as UTF-8-SIG/UTF-16/UTF-32), except BOM-less Japanese UTF-16, which gives no result.
2. MODERN_WEB: every Windows-125x sample is named as its own page except Icelandic Windows-1252, which gives WINDOWS-1250. KOI8-R, KOI8-U, CP874, EUC-JP, EUC-KR, CP949, GB18030, Big5, ISO-2022-JP/KR and HZ samples name their own encoding.
3. MODERN_WEB: 33 of the 257 corpus files give no result.
4. ALL: most legacy samples name their own encoding, but byte-identical neighbours often win; 7 files give no result.
5. The per-era None counts depend on the exact corpus texts: rows marked [text-specific] in the era features can change with a different text.
6. Edge files: ascii-only -> ascii, bom-only-utf8 -> UTF-8-SIG, empty/random/NUL-heavy -> no result, single-high-byte -> WINDOWS-1252 (MODERN_WEB), utf8-one-char -> utf-8 (MODERN_WEB) and CP861 (ALL).

**Inputs:** the full corpus
**Outputs:** counts of no-result lines per era
**Edge cases:** edge files

**Acceptance**
- Over all 257 evidence corpus files [text-specific]: MODERN_WEB prints None for exactly 33; ALL for exactly 7; LEGACY_REGIONAL for exactly 196; MAINFRAME for exactly 201; DOS for exactly 75; LEGACY_ISO for exactly 71; LEGACY_MAC for exactly 73.
- is/cp1252 -> WINDOWS-1250; {bg,ru,sr,uk}/cp1251 -> WINDOWS-1251; el/cp1253 -> WINDOWS-1253; tr/cp1254 -> WINDOWS-1254; he/cp1255 -> WINDOWS-1255; et/cp1257 -> WINDOWS-1257; vi/cp1258 -> WINDOWS-1258.
- edge/single-high-byte -> WINDOWS-1252.

## library.api

**Covers:** library.detect, library.detect-all, library.incremental, behaviour.language | **Layer:** behaviour | **Priority:** could | **Source:** watched

Optional importable API mirroring the CLI: one-shot detection, an all-candidates call, and an incremental detector.

**Behaviour**
1. A one-shot call takes bytes and returns an object with `encoding` (name, or null when nothing is detected), `confidence` (0 to 1) and `language` (a language name, or the empty string when none applies).
2. Options: an era selection (default MODERN_WEB; unlike the CLI, eras may be combined), a legacy-rename switch, a byte limit (default 200,000) and an internal feed size (default 64 KB).
3. An all-candidates call with the same options returns every candidate result sorted by confidence, highest first; its first element equals the one-shot result.
4. An incremental detector accepts data in pieces, reports when it is already certain so the caller may stop early, yields its final result when closed, and can be reset for another input.
5. The CLI never prints the language; language values were not observed.

**Inputs:** bytes; options
**Outputs:** result objects
**Edge cases:** combined eras; feeding byte by byte

**Acceptance**
- If the clone exports a one-shot function, for every corpus file its `encoding` equals the CLI --minimal name for the same era and -l setting (null where the CLI prints None), and `confidence` is a number in [0, 1].
- If the clone exports an all-candidates function, its result is sorted by non-increasing confidence and its first element's `encoding` equals the one-shot `encoding`.
- If the clone exports an incremental detector, feeding a corpus file in 1,000-byte pieces then closing gives the same `encoding` as the one-shot call; after reset, a second file gives its own one-shot `encoding`.

## detect.unprinted-names

**Covers:** encoding.cp932, encoding.tis-620, encoding.cp720, encoding.cp1006, encoding.cp858, encoding.cp862, encoding.cp864, encoding.cp424, encoding.cp500 | **Layer:** format | **Priority:** could | **Source:** watched

Nine documented encodings are never printed for the corpus; eight were never printed at all, and CP720 appeared only for crafted inputs. Their samples resolve to other names.

**Behaviour**
1. CP932, TIS-620, CP1006, CP858, CP862, CP864, CP424 and CP500 belong to the documented tiers but were never printed for any input under any era.
2. CP720 can be printed (spelled exactly `CP720`), but never for the Arabic CP720 corpus file. Observed examples, not required outcomes: under LEGACY_REGIONAL the input `hi F0 9F 98 ok\n` gave CP720; a long ASCII text containing one emoji also gave CP720.
3. Their samples resolve as follows: CP932 Japanese -> SHIFT_JIS; TIS-620 Thai -> CP874 (ISO-8859-11 in LEGACY_ISO); CP720 Arabic -> no result; CP858 German -> CP850 (DOS, ALL); CP862 Hebrew -> CP856 (DOS, ALL); CP424 Hebrew -> ascii; CP500 English -> CP037 (MAINFRAME, ALL). No corpus sample exists for CP1006 or CP864.
4. The clone is not required to ever print these nine names. If it prints one of the eight never-printed names, the spelling must follow the pattern of its tier (CPnnn, TIS-620); exact spelling is unconfirmed.
5. ISO-8859-6 and ISO-8859-8 are no longer in this group: both are printed (see detect.era-legacy-iso, detect.arabic, detect.era-always-on).

**Inputs:** samples encoded in these pages; crafted inputs that may give CP720
**Outputs:** the substitute names above; CP720 (allowed, not required)
**Edge cases:** no sample for CP1006 or CP864; CP720 for crafted inputs only

**Acceptance**
- ja/cp932 -> SHIFT_JIS (and with -e ALL).
- th/tis-620 -> CP874; -e ALL th/tis-620 -> CP874; -e LEGACY_ISO th/tis-620 -> ISO-8859-11.
- -e DOS de/cp858 -> CP850; -e ALL de/cp858 -> CP850; -e DOS he/cp862 -> CP856.
- -e MAINFRAME en/cp500 -> CP037; -e ALL en/cp500 -> CP037; he/cp424 -> ascii under each of the 7 eras.
- ar/cp720 -> None under each of the 7 eras.
- Over all 257 corpus files, under all 7 eras, with and without -l, none of CP932, TIS-620, CP720, CP1006, CP858, CP862, CP864, CP424, CP500 is printed.

---

## Open questions

1. Exact spelling of the 8 never-printed names (CP932, TIS-620, CP1006, CP858, CP862, CP864, CP424, CP500), and whether any input can make them print.
2. Which inputs give CP720, and in which eras, beyond the two observed examples (P4).
3. The bytes before the truncated E2 82 tail in the oracle run were not supplied (P9); the acceptance line uses `Price: 5 ` as the prefix and should be confirmed against the original.
4. The length at which one multibyte character inside ASCII stops giving utf-8 (P10). The acceptance line uses 10,000 ASCII bytes before the line and should be confirmed.
5. The stdin size at which `- -` switches from 'result then no result' to 'result twice' (P11).
6. Whether a long 7-bit text with a single NUL byte is ascii or None (P6 covers only the short case).
7. For each [text-specific] row, what rule (if any) decides between the observed alternatives.
8. Line terminator of stdout and stderr (LF or CRLF) was not recorded; tests strip one trailing CR per line.
9. Precedence when several errors apply at once (invalid era plus unopenable file; --help vs --version vs a bad file that comes before them) was not observed.
10. Era behaviour of 7-bit text with stray ESC bytes outside MODERN_WEB and ALL was not observed.
11. The ISO-8859-11 -> CP874 rename under -l is stated by the observer but no run log shows it (no LEGACY_ISO + -l transcript).
12. Error reason text for a directory argument on non-Windows systems was not observed.
13. The `language` field values of the library API were never observed.
14. How the 200,000-byte limit interacts with a BOM or ESC byte beyond the limit was not observed.
15. Whether the interactive-stdin notice names a different end-of-input key on other platforms was not observed; CTRL-D is the observed spelling.
