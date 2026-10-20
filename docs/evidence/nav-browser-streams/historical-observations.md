# Retained historical fixture observations

These JSON records preserve previously local observations at the exact source revisions and browser versions named in each file. They are historical evidence, not reruns of the current integration head.

- `nav-challenges/firefox-*-0.33.12.json`: regular Firefox synthetic challenge cases, including successful page-owned Blob transfer and negative/manual cases. Their recorded limits remain controlling.
- `nav-challenges/edge-fresh-stale-control-0.35.2.json`: failed fixture interaction with stale disabled controls; not a passing transfer or proof of a production cause.
- `nav-scheduling/retry-after-*-initial.json`: synthetic initial-response wait/header observations; readiness HTML acknowledgement is not file-transfer proof.

No live-host/account acceptance, paid calls, Firefox binary form-navigation support, or current-head UI acceptance is established by retaining these files.
