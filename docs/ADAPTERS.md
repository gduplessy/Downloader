# Adapter maintenance

Bundled source is the only adapter source. No executable remote rules are loaded.

## Selection contract

- `policy.ts` matches exact hostnames and path expressions. Disable a registry entry independently through `disabledAdapters` in the owned resolver context.
- Strong evidence is the existing conservative free-control policy or a versioned synthetic fixture control plus a safe request target. Localized labels and ordered provider panels require explicit selection. Numeric confidence is deliberately avoided.
- `dom.ts` inspects top-level and open shadow roots. Closed shadow and cross-origin frames require a separately qualified capability; no access is inferred.
- `preview.ts` binds tab, frame, scoped session, claim/document generation, page, adapter revision and SHA-256 DOM/form fingerprint. Form values are transient hash inputs; URLs/fields never appear in the preview or evidence logs.
- Selection reinspects before and after worker authorization, highlights the chosen element and consumes one authorization. Replacement nodes receive fresh weak identities even if their text/HTML is unchanged.
- Premium controls are excluded until the account owner supplies qualified entitlement validation. Downstream-host selection is explicit and ordered groups retain DOM order.

## Contribution format

Submit adapter source, a sanitized permitted layout fixture, request/file hash regression, and a matrix evidence row together. Record owner, exact host/path, version, declared capabilities, session sensitivity, layout evidence class, allowed action evidence and rejection policy. Every selector change increments the adapter version. Never commit cookies, account state, tokens or signed URLs.

No recorded or live provider layout was supplied for NAV-05/06. The four provider entries are unqualified registry records using conservative generic behavior, not claims that synthetic templates resemble their pages. A failing layout must become manual recovery; it must not broaden selectors to advertisements or purchase controls.

## Integration

The content script requests `resolver_context` from an owned tab. The worker supplies actual SessionScope and claim generation, rejects stale `resolver_step` bindings, records adapter/selected-host provenance, and authorizes actions only while the target job is active. Without that hook, the existing generic behavior remains available and scoped previews are not offered.

## Reproducible local checks

- `node scripts/nav-fixtures/adapters/qualify.mjs` checks four synthetic providers, filenames, byte hashes, redirects and single-use POST semantics on an ephemeral local port.
- `node scripts/nav-fixtures/adapters/evidence.test.mjs` rejects wrong hashes, URL-shaped host metadata, unobserved live layouts and expired support.
- `node scripts/nav-fixtures/adapters/build.mjs` builds the DOM harness; `node scripts/nav-fixtures/adapters/server.mjs` serves it on loopback port 18765.
- Run gstack browse against `/nav-adapters/g4u/ambiguous`, then `js 'window.navAdapterFixture.suite()'`. The suite inspects DOMs and dispatches actual selected clicks into an in-page synthetic fetch bridge to verify request method, filename and response hash. It is not native messaging/desktop storage acceptance.
- `js 'window.navAdapterFixture.preview("en")'` opens the real selection component; ArrowDown, Tab, Enter select a control through the keyboard. Same-HTML replacement invalidates the preview. `preview("ar")` verifies RTL rendering.
- `node scripts/nav-fixtures/adapters/live-smoke.mjs` prints usage without contacting any site. With explicit `--url` and `--browse`, it performs one read-only page observation in a separate local gstack state. It never logs the page URL or claims a qualified transfer.
