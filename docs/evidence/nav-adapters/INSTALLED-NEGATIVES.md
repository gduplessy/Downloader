# Installed adapter negative acceptance

The recorded local acceptance uses actual Chrome 155 and Edge 155 production extension modules from `1524bbb09e0fd17bde5dac9949d478a7fee7a551` on Windows x64. Native service/CLI are copied immutable 0.18.3 binaries built from `d83fbbe608f83567d6429793004d449278a54c15`; exact binary, source and generated bundle hashes are in each JSON record. Product metadata 0.24.0 does not imply a new native build.

- Disabled adapter: actual accessibility-tree/Input selection of **Use generic controls** persists `local-fixture` in disabled adapters. The refreshed generic preview retains two ambiguous controls and performs no automatic action. Cancel closes only the preview.
- Changed layout: select an actual preview radio, mutate the original page link to the fixture purchase trap, then activate the actual **Continue** button. The production preview visibly requires refresh. Native remains `waiting_user`.
- Every qualified case requires zero payload and purchase-trap requests and no native completion. Each case uses separate native state, browser profile, copied binaries and fixture registry key. Disposal is fixture cleanup and does not qualify extension cancellation.

## Reproduce

Set `NAV_NATIVE_BINARY` and `NAV_CLI_BINARY` to a known matching pair and `NAV_NATIVE_REVISION` to its build revision. Use `NAV_BROWSER` for the installed Chrome/Edge executable and `NAV_ADAPTER_CASE=disabled` or `changed`, then run:

```powershell
node scripts/nav-fixtures/adapters/installed-negatives.mjs
```

The CLI creates a navigation task. Trusted production extension messages initiate owned navigation and resume the completed HTML page. This is an explicit activation boundary: desktop and native context-menu UI are not qualified. Preview selection and Continue/disable/Cancel controls use actual AX/Input events, without renderer authorization shims. Page DOM mutation is fixture stimulus. Unique native-host addressing and loopback permission grants isolate the fixture; production modules otherwise remain unchanged.

Live g4u, ddownload, Rapidgator and Gofile layouts/accounts, Firefox adapter negatives and unavailable platform/browser combinations remain pending. Existing Chromium DOM/request matrices remain separate evidence. A failed startup or missing preview is a failed fixture run, never negative-action acceptance.

## Recovery defect found during qualification

Some attempts lost the preview during asynchronous adapter-disable refresh. Successful rows prove their exact runs, not repeat reliability. The existing resolver closes its preview before awaiting owned context; a transient context rejection leaves no Refresh UI. A separate source correction and regression/installed repeats are required before claiming this defect resolved.

## Corrected source repetition

The four `postfix-*.json` records repeat both controls on Chrome 155 and Edge 155 at exact checked runtime `2656b52d2e1866d8ff6f28d7fd487b370b821ca2`. Disabled cases ended `waiting_user`; changed-layout cases showed the required stale-selection refresh UI and ended `waiting_browser`. All four had zero payload/trap requests and no native publication. These exact native state observations are preserved rather than inferred from UI text.

The correction retains stale recovery controls through all asynchronous replacement validation and coalesces overlapping Refresh requests. Three deterministic regressions cover failed context, overlapping refresh/generation advance, and worker-step rejection, with no action/authorization from stale authority. The full extension suite passes 187 tests; typecheck and fixture syntax/version checks pass. Native remains the explicitly recorded historical 0.18.3 pair.

## Installed Cancel during pending refresh

Chrome 155 and Edge 155 passed the real final-source Cancel race at main `d99c2f889c8d7819196b5790ed4f66f93e5a84e6`. The fixture pauses the actual installed production service worker with CDP, activates actual AX Refresh while its context reply is pending, activates actual AX Cancel, then resumes the worker. The preview stays closed after completion; a later trusted extension Continue produces a new actual preview. No context, native response or authorization is substituted. Both tasks remain `waiting_user`, with zero payload/purchase requests and no publication.

The two `installed-*-cancel-refresh.json` records preserve the frozen driver/source/bundle fingerprints and matching native 0.25.1 binaries built from `3b808ae1967a210fc5b3a3e461488b9f2ab6cb61`; hashes are checked after completion. This does not qualify native context-menu/desktop activation or Firefox pending-refresh pause control.

## Firefox installed adapter negatives

Firefox 158 on Windows x64 passed both supported local adapter negatives at checked revision `bb4912a18cd4bd21bd53b143e31bca84cb19985a`, with unchanged production runtime from merged main d99c2f8 and the copied matching native 0.25.1 pair. Actual BiDi keyboard input invokes the closed-shadow production controls; Firefox extension-world `openOrClosedShadowRoot` only reads the resulting UI. No control selection, click, context response or authorization is synthesized.

- Disable: trusted keyboard activation persists the disabled local adapter; wait for the actual refreshed generic preview with two enabled unchecked radios, disabled Continue and retained Cancel/Refresh. The old preview sampled before refresh completion is not acceptance.
- Changed layout: select a production radio, mutate the original fixture link to the purchase trap, then activate actual Continue. The rendered preview requires refresh and disables submission/radios.

Both cases remain `waiting_user`, with zero payload/trap requests and no publication. Exact driver, source, bundle and matching native hashes are in `installed-firefox-*.json`; screenshots were separately inspected and retained. Source diagnostic instrumentation is absent. Native context-menu/desktop activation, Firefox pending-refresh pause, private-addon/ESR/other-OS rows and live providers/accounts remain separate pending gates.
