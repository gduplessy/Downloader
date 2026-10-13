# Challenge runtime handoff

Feature branch: codex/nav-challenges. Current coordinator parent integrated: c8ac54d (0.12.4); feature increment 0.10.9. Four local installed Chrome challenge-to-native-hash rows pass.

## Runtime contract

The resolver sets globalThis.__downloaderDocumentNonce once per actual isolated document and keeps its genuine documentGeneration counter. Context and challenge messages carry document: {nonce, generation}. verifyLiveDocument in apps/extension/src/navigation/session/document.ts reads that marker from the current top-frame isolated world. Chromium additionally checks the live scripting result documentId against the sender when available. Missing markers, wrong frames, old same-URL documents and regressing generations refuse authority.

ResolverContext requires sourceGeneration, documentGeneration and documentNonce. The native source generation is never defaulted. Existing scope/profile/private/container/partition checks remain enforced.

Challenge messages:

- resolver_challenge_select: explicit selectedHost plus document claim. The worker checks the current owned tab, live document and scheduler admission, then calls scoped navigation_selection with the bundled adapter identity. An absent selected host is handled by a closed-shadow choice action before any solve.
- resolver_challenge_authorize: complete ChallengeBinding plus document claim. Worker and content both revalidate after asynchronous admission; one authorization is consumed once. This authorizes an original browser form POST returning HTML; it must not arm file capture.
- resolver_challenge_paid: start/poll/cancel plus binding and document claim. Only the compatible image and fixed instruction can leave the browser. The worker forwards exact owner/scope/source fences to the native captcha command.

ChallengeBinding contains scope, source/document generations, the live document nonce, page, selected host, image digest, CSRF digest, full form digest and expiry. Form digests also bind action, method, encoding and submitter. Sensitive source values stay transient.

## Coordinator integration

General adapter step/commit/disable messages now carry the same document claim and call verifyLiveDocument before acting. NavigationAuthorizationBinding requires documentNonce and its canonical key includes it; failed current-context commits burn the token. A same-URL Firefox reload regression rejects and consumes old nonce authority. Abort remains cleanup-only. A context request alone cannot authorize a later document. Keep current source changes, cancellation and tab recovery work intact when reconciling shared files.

The challenge page helper requires the explicit qualified open-circle image/form contract. Other variants remain manual. Its successful POST yields fresh selected-host links that continue through normal adapter/stream ownership. Fresh links and final native file hashes remain separate evidence from coordinate accuracy.

## Evidence

Corpus, twelve stale DOM cases, DOM/CLI, native-backed React controls and the production installed Chrome report are under docs/evidence/nav-challenges. All four original CAPTCHA POSTs yield fresh gofile.io links and verified 253,952-byte desktop files. The trusted extension Continue action resumes each fresh HTML page; automatic post-navigation preview is not inferred. Live g4u/ddownload/Rapidgator/Gofile, paid-provider and unavailable browser/platform rows remain pending. Budget is $0 and all provider tests use injected mocks.


## Native byte endpoint

newSink explicitly injects browser.runtime.connectNative(HOST) into NativeStreamPort, so controls and bytes share the canonical native registration. A missing, non-integer or nonpositive sourceGeneration refuses capture before any native stream begins; blob readers receive the same validated counter. Keep strict frame, URL, method, scope, source, claim and live document checks. The fixture does not patch transport or capture modules and does not relay response bytes through CDP.

The qualified driver detaches its page CDP session before the final scheduled preview click lets production chrome.debugger own the byte response. Existing exact direct-stream ownership continues to fence legacy download observers. Preserve the merged account and serialized scheduler startup/renewal hooks.
