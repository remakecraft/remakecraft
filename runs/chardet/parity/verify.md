# Verify: guessling @ 1b2b55b

**Hashes: OK (no app/spec/visible-test changes, sealedChanged 0). Stubs: none (32 files scanned). Neither fails the run.**

Parity 96% (241/251). Mode: clean-room. Parity exit code 0 (parity.json exitCode 0, ok true). Build ok.

| layer | visible | sealed | overall |
|---|---|---|---|
| behaviour | 131/131 | 51/60 | 95.2% |
| pixel | - | - | - |
| format | 13/13 | 4/5 | 94.4% |
| ui | 29/29 | 13/13 | 100% |

Total visible 173/173, sealed 68/78 (previous run: 173/173, 68/78).

## Visible failures
None.

## Sealed results (counts only, features with failures)
| feature | sealed |
|---|---|
| cli.legacy-casing | 0/1 |
| output.streams-exit | 1/2 |
| detect.utf8 | 2/3 |
| detect.era-modern-web | 2/3 |
| detect.era-always-on | 1/2 |
| detect.era-legacy-iso | 1/2 |
| detect.era-dos | 1/2 |
| detect.era-mainframe | 1/2 |
| detect.era-all | 1/2 |
| detect.corpus-summary | 0/1 |

## Likely overfitting (visible beats sealed by >15 points)
All ten features above are flagged as likely overfitting.

## emptyBodies warnings
None.
