# NAV-13: local custom CAPTCHA and optional 2Captcha

## Outcome and baseline

Solve qualified custom/image challenges locally first, submit the answer in its owning browser session, and generate fresh links for the explicitly selected host. Add an optional 2Captcha adapter disabled by default and tested against mocks. Owner authorized **$0 paid qualification**, so no live billable requests or external challenge uploads occur in this run.

Owner: batch E. Dependencies: NAV-05/06 adapters, NAV-04/10 waiting/site locks, NAV-09/11 ownership. Reuse NAV-01 protection resolution without treating it as custom-click capability.

## Implementation increments

1. Implement challenge discovery/extraction in an owned adapter: image/instruction, intrinsic dimensions, CSS content rectangle, challenge generation, selected host, CSRF/session continuity and expiry. Keep sensitive payloads transient. Historical g4u observations must be revalidated on permitted samples.
2. Build a local color/geometry candidate for qualified open-circle challenges, with confidence rejection, decoy/border handling and coordinate margin. Use a labeled synthetic/owner-permitted corpus; evaluate a local vision runtime only if geometry fails the agreed quality gate and distribution/latency justify it.
3. Map source coordinates into CSS coordinates accounting for scale, borders, clipping and DPR. Revalidate image identity, generation, owner, URL and selected host immediately before one browser-session submission. Replacement, cancellation and late answers are discarded.
4. Hold an adapter-defined whole-site challenge lock. On success extract fresh links only for the selected host, preserve ordered grouping and source provenance, then use normal replay/stream ownership for downstream transfers.
5. Add a service-owned 2Captcha client with keyring key references, explicit external-solving opt-in, per-task/total budget reservation, bounded polling, cancellation and terminal accounting. The checked CoordinatesTask contract accepts JPEG/PNG/GIF up to 600 kB and 1000 pixels per side, with coordinate results and cost; enforce these bounds and validate coordinates. Recheck API details when implementing; [sources](SOURCES.md). Transmit only the compatible challenge image and required instruction; never cookies/CSRF/page HTML/signed links.
6. Mock creation/poll/cost/refusal/timeouts/late results and uncertain charge exposure. Once a request may be billable, retain its reservation until reconciled; worker restart cannot reset the spend ceiling. Live requests are blocked by the current $0 budget.
7. Add local/paid/manual controls, capability explanation, confidence/failure/expiry states, spent/reserved budget and six-locale UI. Manual completion always remains available; no repeated blind clicks.

## Tests and acceptance

- Corpus coverage: scale 1/0.75/0.5, DPR 1/1.25/2, borders/decoys/occlusion, ambiguous targets, replacement, stale CSRF, URL expiry, selected-host changes and competing workers.
- Local release gate: at least 100 held-out synthetic/permitted images, at least 99% correct accepted coordinates, at least 80% non-abstention, and p95 local solve time at most two seconds on the recorded test machine. Require zero stale/wrong-session submissions in lifecycle fixtures. Publish corpus split, accepted-click accuracy, abstention, fresh-link rate and p50/p95 latency separately; do not tune on the held-out set. Live accepted-click/fresh-link performance remains pending, not inferred from synthetic accuracy.
- Submission tests prove a valid selected-host link batch; downstream tests separately verify the intended output hash. Solver coordinates alone are not success.
- Provider mocks prove no call at zero budget/without opt-in/key, enforced reservations, no duplicate paid tasks, and no secret payloads in artifacts.
- Live paid success/cost remains explicitly pending at $0. Do not mark paid-provider qualification complete from mocks.

## Research boundary

Unknown CAPTCHA variants and premium/instant-download bypass do not become universal support. Retain precise unsupported reasons and a runnable corpus/reproducer for failed feasibility. See [execution requirements](README.md).
