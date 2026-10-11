# NAV-05/06 integration handoff

## Runtime hooks

- `resolver_context` is an owned-content-tab request. Return `{tabId,frameId,scope:SessionScope,selectedHost?,disabledAdapters?,capabilities?:{pageBlob?:boolean},locale}` or null for stale/unowned jobs. `adapters/context.ts` exports the pure `scopeKey(scope)` serializer.
- `resolver_step` adds `binding:{tabId,frameId,sessionKey,claimGeneration,documentGeneration,page,adapterId,adapterVersion,fingerprint}` plus `selected_host`, `adapter_id`, `adapter_version` when submitting a selected action. The worker must compare actual sender tab/frame/session/claim, current document/source generation and URL before authorizing. Document generation is local to the loaded document, not monotonic across navigations.
- `resolver_disable_adapter` accepts `{adapterId}` only from the owned tab, independently disables the current matching bundled adapter in local settings, and returns true. The preview then refreshes under the generic policy. No remote executable adapter source is supported.
- Step authorization `{click:true,repeat}` permits one DOM submission after content reinspection. `{direct:true}` means the stream owner handled the page/blob transfer and the resolver must not click again. Missing context preserves conservative legacy behavior without scoped preview.

## Other batch hooks

- `adapters/dom.ts` exports `collectControls`, `requestFor`, `domFingerprint`, `collectWait`, `allElements`, `isVisible`. Form submitter overrides are honored. Script/reset/type=button controls never become guessed form requests.
- Wait decisions include `decision.wait:{duration_ms?,fingerprint,expires_at_ms?}` from visible countdowns/disabled download controls. Largest duration is bounded to seven days; `repeat:false` lets scheduler alarms own recovery.
- Blockers remain typed as `browser_challenge`, `captcha`, `authentication`, `expired`, `countdown`. Password/CAPTCHA/browser-protection controls stop automatic submission. Newly appeared blockers invalidate preview selection.
- Same-origin blob controls are explicitly selectable only when the stream owner supplies `capabilities.pageBlob:true`. They are never automatically selected. Premium/account controls remain excluded until the account batch supplies entitlement evidence.
- Explicit provider panels retain selected downstream host and ordered group provenance. Synthetic `data-download-host` evidence is not a live g4u selector claim.

## Evidence and limits

- Unit policy/binding regressions, synthetic GET/one-use POST filename/hash fixtures and real Chromium DOM/request/hash fixtures cover duplicates, ad injection, localized labels, open shadow roots, replacement nodes, forms, countdowns, unsafe links and selected-host groups.
- Chromium DOM tests use an in-page synthetic request bridge to keep response bytes for hashing. They are separate from installed extension/native messaging/desktop-storage acceptance; combined ownership/stream acceptance belongs to the integration coordinator.
- English stale-preview recovery and Arabic RTL are visibly captured. Keyboard ArrowDown/Tab/Enter selects the intended control and produces the expected response hash.
- g4u, ddownload, Rapidgator and Gofile live layouts/accounts remain unqualified. Stable Chrome/Edge/Firefox/ESR and macOS/Linux native acceptance remain pending. All browser activity used local fixtures only.
