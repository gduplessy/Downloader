# Batch F: NAV-12 handoff

## Implementation

- Service-owned atomically persisted bounded frontier with exact scope/generation/document fencing, deterministic order, deduplication, explicit origin permissions, domain/depth/page/byte/time filters and resource provenance.
- Individually allowlisted `discovery_list`, `discovery_claim`, `discovery_page_result`, `discovery_status`, `discovery_select` and `discovery_prepare` commands. Private projects are ephemeral from creation; existing public records cannot become private.
- Production extension discovery tabs use shared scheduler admission, bounded DOM readiness and isolated live-document proof. No arbitrary form submission or resource probing occurs during discovery.
- Selected resources become idempotent scoped navigation jobs. Their initial navigation stays on HTML provenance; exact selected-resource filtering precedes replay classification and original-response capture. Authenticated resources never receive anonymous transfer authority.
- Cross-origin selection reserves a bounded service preparation lease before reopening approved provenance in the original session. Native source identity plus actual browser permission, partition/container and document proof are rechecked before resolver enrollment; the preparation tab closes only after verified resolver ownership.
- Worker recovery restores current-epoch records. A new browser process refuses historical records until explicit original-session reauthorization; resume releases the old owned scheduler lease before opening a new tab.
- Desktop paged resource/progress/resume/cancel controls and extension session selection are localized in all six dictionaries.

## Dependencies and verification

The branch integrates checked coordinator bases c8ac54d, 91d0553 and 7e44b00, including latest main 16d8ec2. It preserves account/challenge grants, source replacement recovery, same-document startup coalescing, stream ownership and three-digit countdown tests. The batch PR targets `codex/nav-integration`; it must remain separate and must not be automatically merged or closed.

Focused 0.13.0/0.13.1 increments qualify actual stable Windows Chrome/Edge cross-origin authenticated discovery, service restart, extension ServiceWorker replacement and complete browser-process restart. Clean committed 7f752d3 evidence records exactly one authenticated GET, zero HEAD, 262,161 native bytes and matching SHA-256. The driver detaches from the byte-capture page before the real adapter preview submission; production chrome.debugger and native transport own the original response.

[Discovery evidence and reproduction](../../evidence/nav-discovery/README.md) names immutable source/binary revisions. The final combined increment runs frontend types, all client tests/builds, full native tests, strict Clippy, native compilation, Rustfmt and version checks. Eight real Engine discovery regressions and two retained-provenance race/document tests cover the specific fences.

## Remaining acceptance

- Live g4u/ddownload/Rapidgator/Gofile pages and entitled accounts remain pending as requested. Paid provider spend is $0.
- Firefox stable/ESR installed discovery/direct-stream, macOS/Linux browser runs, permission prompts, private/container installed fixtures and owner UI/native-language acceptance remain distinct pending release rows. Engine private/container semantics are covered by native tests; those tests do not qualify installed private browsing.
- Shared Firefox direct response capture remains with the integration owner. Offline mirror rewriting and scheduled synchronization are outside NAV-12.
