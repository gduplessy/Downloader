# NAV-05: adapters and ambiguous controls

## Outcome and baseline

Make host-specific selection deterministic, explain uncertain candidates, and let the user select the intended control without exposing stale actions. Existing `decide()` uses text/id heuristics and stops for multiple candidates. Preserve that conservative generic fallback.

Owner: batch A. Dependencies: shared contracts. NAV-06 supplies provider fixtures; NAV-03 supplies premium eligibility; NAV-13 supplies custom challenge steps.

## Implementation increments

1. Add a bundled, versioned adapter registry with exact host/path matching, capability declarations and deterministic candidate extraction. Preserve a generic adapter and disable a broken host adapter independently.
2. Define candidate evidence, stable local ID, action kind, destination host, form method, confidence and rejection reasons. Thresholds are adapter-specific and fixture-backed, not an unexplained numeric score.
3. Reject ads, sponsors, purchase/torrent/magnet controls, hidden/disabled elements and unsafe protocols. Select one high-confidence eligible action; otherwise show a user preview of label, host and expected action.
4. Bind preview selection to tab/frame/session generation, adapter version and current DOM fingerprint. Reinspect on selection; reject replacement, redirect or stale controls. Scroll/highlight the selected control and submit once.
5. Preserve explicit g4u downstream-host selection and ordered link groups. Premium selection uses NAV-03 entitlement/session validation; generic free-download behavior remains separate.

## Tests and acceptance

- DOM fixtures cover duplicate Download buttons, injected ads, localized labels, nested panels, open shadow roots, replaced controls, GET/POST forms, disabled waits and unsafe links.
- A fixture verifies the selected control initiates the expected filename/host/hash, not just a matching label.
- No ambiguous candidate is clicked automatically. User selection is keyboard accessible and a stale preview requires refresh.
- A changed adapter fails visibly and falls back without clicking a purchase or unrelated host control.

## Boundaries

Closed/cross-origin frames need explicit supported capabilities/permissions; never infer access. No executable remote adapter downloads. New provider behavior enters through fixture-backed adapters. See [execution requirements](README.md).
