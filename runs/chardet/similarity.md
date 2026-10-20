# Similarity scan: guessling against chardet

Run on the dirty side, in a scratch folder outside the run's room, after the build finished. Numbers and matched
file names only: the matched regions themselves are not published, because they would quote LGPL chardet code.

- **Clone:** guessling at `1b2b55b` (31 source files, JavaScript).
- **Original:** chardet 5.2.0, 6.0.0, 7.0.0 and 7.7.0 sdists from PyPI, sha256 checked.
- **Tools:** copydetect 0.5.0 (filtered and raw modes) and JPlag 6.3.0 in `-l text` mode. No JPlag grammar
  covers JavaScript against Python, so text mode is the only cross-language option, and these JPlag numbers are
  not comparable with Python-against-Python figures.

## Results

| guessling against chardet | 5.2.0 | 6.0.0 | 7.0.0 | 7.7.0 |
|---|---|---|---|---|
| copydetect, filtered | 0.0 | 0.0 | 0.0 | 0.0 |
| copydetect, raw, token-weighted | 0.41% | 0.35% | 0.74% | 0.62% |
| copydetect, raw, worst file | 16.7% | 16.6% | 16.7% | 3.6% |
| JPlag text, max / avg | 0.26% / 0.06% | 0.29% / 0.01% | 0.40% / 0.33% | 0.30% / 0.20% |

## Calibration and controls

| Check | Result |
|---|---|
| JPlag python3 between chardet versions | 7.0.0 vs 7.7.0 avg 27.3% / max 40.5%; 5.2.0 vs 6.0.0 avg 3.3% / max 80.1%; 7.0.0 vs 5.2.0 avg 1.2% |
| copydetect, 7.0.0 against 5.2.0 / 6.0.0 | token-weighted 2.4% / 3.2%, worst file 61.9% (`__main__.py`) |
| Positive control: a deliberate line-by-line JS port of 5.2.0 `utf8prober.py` | copydetect filtered 0.0, raw 14.1%; JPlag text max 15.6% |
| `src/detect/utf8.mjs` at `0606b22`, the formula recalled from training memory (review must-fix M3) | copydetect filtered 0.0, raw 0.0 |

## Top matched regions (raw mode), by file name

| guessling file | chardet file | Share | What it is |
|---|---|---|---|
| `src/legacy.mjs` | `universaldetector.py` (5.2.0), `equivalences.py` (7.0.0) | 16.7% of the file, 225 tokens | The ISO-to-Windows superset table (ISO-8859-1 reported as Windows-1252, and so on): output behaviour the spec captured, and the WHATWG mapping |
| `src/detect/sbcs/languages.mjs`, `src/detect/cjk.mjs` | `structural.py` (7.x) | 3–4% | Lines of `----` comment rules |
| `src/detect/sbcs/pages.mjs` | `languages.py` | under 1% | Lists of charset names |

All three are interface or formatting, not logic. The scanners only see literal overlap across languages: a full
port scores 14–16%, so guessling's under 1% rules out bulk translation. They are blind to a recalled one-liner,
which scored 0.0. The opus reviewer caught that one by reading the code.
