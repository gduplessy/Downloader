# Challenge runtime handoff

Feature branch: codex/nav-challenges. Current coordinator parent integrated: 1da6fa6. Later coordinator capture/authority commits must merge before installed fixture acceptance.

## Runtime contract

The resolver sets globalThis.__downloaderDocumentNonce once per actual isolated document and keeps its genuine documentGeneration counter. Context and challenge messages carry document: {nonce, generation}. verifyLiveDocument in apps/extension/src/navigation/session/document.ts reads that marker from the current top-frame isolated world. Chromium additionally checks the live scripting result documentId against the sender when available. Missing markers, wrong frames, old same-URL documents and regressing generations refuse authority.

ResolverContext requires sourceGeneration, documentGeneration and documentNonce. The native source generation is never defaulted. Existing scope/profile/private/container/partition checks remain enforced.

Challenge messages:

- resolver_challenge_select: explicit selectedHost plus document claim. The worker checks the current owned tab, live document and scheduler admission, then calls scoped navigation_selection with the bundled adapter identity. An absent selected host is handled by a closed-shadow choice action before any solve.
- resolver_challenge_authorize: complete ChallengeBinding plus document claim. Worker and content both revalidate after asynchronous admission; one authorization is consumed once. This authorizes an original browser form POST returning HTML; it must not arm file capture.
- resolver_challenge_paid: start/poll/cancel plus binding and document claim. Only the compatible image and fixed instruction can leave the browser. The worker forwards exact owner/scope/source fences to the native captcha command.

ChallengeBinding contains scope, source/document generations, the live document nonce, page, selected host, image digest, CSRF digest, full form digest and expiry. Form digests also bind action, method, encoding and submitter. Sensitive source values stay transient.

## Coordinator integration

General adapter prepare/commit/abort should carry the same document claim and call verifyLiveDocument before acting. A context request alone cannot authorize a later document. Keep current source changes, cancellation and tab recovery work intact when reconciling shared files.

The challenge page helper requires the explicit qualified open-circle image/form contract. Other variants remain manual. Its successful POST yields fresh selected-host links that continue through normal adapter/stream ownership. Fresh links and final native file hashes remain separate evidence from coordinate accuracy.

## Evidence

Corpus and DOM/CLI/native-backed React control reports are under docs/evidence/nav-challenges. The production worker/resolver installed path remains pending until the final combined fixture passes. Live g4u/ddownload/Rapidgator/Gofile, paid-provider and unavailable browser/platform rows remain pending. Budget is $0 and all provider tests use injected mocks.
