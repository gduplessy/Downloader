# Host compatibility

Live acceptance is pending for every provider. Local fixtures qualify the selection contract only.

| Host           | Adapter/version  | Workflow                                 | Layout known | Evidence | Browser/OS             | Outcome     | Recovery                                              |
| -------------- | ---------------- | ---------------------------------------- | ------------ | -------- | ---------------------- | ----------- | ----------------------------------------------------- |
| g4u.to         | g4u/1.0.0        | Chosen downstream host and ordered links | No           | None     | Release matrix pending | Unqualified | Select manually; supply permitted file/layout         |
| ddownload.com  | ddownload/1.0.0  | Free/entitled navigation                 | No           | None     | Release matrix pending | Unqualified | Browser login/download; supply permitted file/account |
| rapidgator.net | rapidgator/1.0.0 | Free/entitled navigation                 | No           | None     | Release matrix pending | Unqualified | Browser login/download; supply permitted file/account |
| gofile.io      | gofile/1.0.0     | File/folder selection                    | No           | None     | Release matrix pending | Unqualified | Select manually; supply permitted file/layout         |

Evidence rows must name adapter revision, workflow, browser/version, OS/architecture, UTC test date, source revision, fixture identifier, evidence class (`synthetic`, `recorded-layout`, `live`), expected/requested host, expected/actual file hash, outcome, reason and recovery. Recorded/live support expires after 30 days and must be requalified; passing historical evidence remains historical. Synthetic evidence never promotes live support.
