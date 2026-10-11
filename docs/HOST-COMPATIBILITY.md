# Host compatibility

Live acceptance is pending for every provider. Local fixtures qualify the selection contract only.

| Host           | Adapter/version  | Workflow                                 | Layout known | Evidence | Browser/OS             | Outcome     | Recovery                                              |
| -------------- | ---------------- | ---------------------------------------- | ------------ | -------- | ---------------------- | ----------- | ----------------------------------------------------- |
| g4u.to         | g4u/1.0.0        | Chosen downstream host and ordered links | No           | None     | Release matrix pending | Unqualified | Select manually; supply permitted file/layout         |
| ddownload.com  | ddownload/1.0.0  | Free/entitled navigation                 | No           | None     | Release matrix pending | Unqualified | Browser login/download; supply permitted file/account |
| rapidgator.net | rapidgator/1.0.0 | Free/entitled navigation                 | No           | None     | Release matrix pending | Unqualified | Browser login/download; supply permitted file/account |
| gofile.io      | gofile/1.0.0     | File/folder selection                    | No           | None     | Release matrix pending | Unqualified | Select manually; supply permitted file/layout         |

Evidence rows must name adapter revision, workflow, browser/version, OS/architecture, UTC test date, source revision, fixture identifier, evidence class (`synthetic`, `recorded-layout`, `live`), expected/requested host, expected/actual file hash, outcome, reason and recovery. Recorded/live support expires after 30 days and must be requalified; passing historical evidence remains historical. Synthetic evidence never promotes live support.

## Local contract evidence

All four synthetic templates use local-fixture/1.0.0 on loopback. Headless Chromium 149.0.7827.55 on Windows 11 x64 passed 120 DOM/request/hash checks; 72 HTML page fixtures and eight HTTP file hashes passed. [Evidence](evidence/nav-adapters/README.md) records exact source hashes and the distinction between selected-host labels and actual loopback transport. Live support remains unqualified for every row above.

The [machine-readable host/workflow matrix](evidence/nav-adapters/host-matrix.json) records adapter revision, exact source hashes, workflow, browser/version, OS, date, outcome and recovery for each synthetic passing and live pending lane. Regenerate with node scripts/nav-fixtures/adapters/matrix.mjs; each row passes the evidence schema and synthetic rows never grant live support.
