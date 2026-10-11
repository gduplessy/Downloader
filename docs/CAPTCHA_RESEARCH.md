# g4u custom CAPTCHA research

## Observed contract

The supplied [originating page](https://g4u.to/en/32305-ace-combat-8-wings-of-theve-deluxe-edition-hypervisor-multi13-elamigos) was reachable with HTTP 200 on 2026-10-10/11. It offers explicit nzb, ddownload, rapidgator and gofile selection. The selected research host was **ddownload**; no downstream file was downloaded.

Two sampled encrypted `/link/` URLs displayed an expiry page requiring a new CAPTCHA. Their signed values are intentionally excluded from the repository. Their expiry text is retained in deterministic and real-service regressions. Existing job `page_url` preserves the originating page, `navigation_url` tracks the current tab, and a resolved job's final `url` identifies the downstream host. A future host adapter must also retain the user's explicit host choice before link generation.

The visible custom image measured 400 × 140 intrinsic pixels and approximately 400 × 141.297 CSS pixels. It asks for a click in an open green circle and carries page/session/CSRF continuity. The page warns that opening another challenge invalidates competing challenges and an incorrect response replaces the image. These are observed page instructions, not a measured invalidation/expiry duration. No custom challenge was submitted, locally or externally.

FlareSolverr [v3.4.6 documentation](https://github.com/FlareSolverr/FlareSolverr/blob/v3.4.6/README.md) does not provide a working CAPTCHA solver adapter or arbitrary coordinate-click API. Its GET API cannot implement this interaction alone. Automatic handling of this CAPTCHA is therefore **unsupported** in this increment.

## Adapter specification for a subsequent increment

- Require an explicit source page and host choice. Select only that host's panel; group fresh links by download host while keeping the original page as provenance.
- Hold one browser-profile owner and one challenge on g4u at a time. Acquire a site-wide lock before opening a CAPTCHA. Suspend competing navigation and invalidate all pending answers when the challenge image changes.
- Read intrinsic dimensions and the actual content rectangle, accounting for CSS scaling, borders and device pixel ratio. Map source coordinates into CSS coordinates; reject points outside the image or with insufficient margin from the target boundary.
- Bind the challenge generation, image identity, CSRF token, profile and current URL in memory. Submit once through the existing browser session; never reconstruct a POST as GET or copy tokens into a solver profile.
- After acceptance, extract only fresh links for the chosen host. Discard expired links, preserve group ordering, and independently qualify each downstream host through the normal engine/manual workflow.
- On replacement, cancellation, owner change or timeout, discard the answer and reacquire a fresh challenge. Never let a late provider response click a replacement image.

## Candidates and measured feasibility

| Approach                 | Assessment                                                                                                                                                                           | Measured result                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local color/geometry     | Green-region segmentation and contour topology may identify an open circle. Require confidence, boundary margin and a rejection path for decoys/occlusion. No external transmission. | No image-solving trials; success rate and latency unknown.                                                                                                                       |
| Local vision model       | Can interpret the instruction, but coordinate accuracy and changing visual variants require labeled trials. Larger runtime and model-distribution cost than geometry.                | No model trials; success rate, latency and compute cost unknown.                                                                                                                 |
| FlareSolverr alone       | Browser protection/rendering candidate; no documented custom click workflow.                                                                                                         | Custom-CAPTCHA fixture correctly rejected with zero bytes in 3/3 successful integration runs; **0 actual g4u CAPTCHA submissions**. This measures fallback, not CAPTCHA success. |
| 2Captcha CoordinatesTask | First paid candidate because its output is image click coordinates; session-aware browser submission still belongs to Downloader.                                                    | **0 billable requests**, $0 spent, no images/session data sent to the provider. Real success, latency and unit cost unmeasured.                                                  |

The [official CoordinatesTask API](https://2captcha.com/api-docs/coordinates) accepts base64 JPEG/PNG/GIF images up to 600 kB and 1000 pixels per side, plus optional instructions. It returns coordinates and task cost. Its sample price is illustrative; it is not a measured quote for g4u.

For an opted-in paid trial, transmit only the challenge image and necessary instruction to the provider. Do not send cookies, CSRF tokens, page HTML, download links, local paths or browser profiles. The provider receives the image, instruction, account key and request-network metadata. Keep the key in the OS keyring; never include it in settings JSON, exports, traces or task evidence.

## Qualification gate

Before shipping a custom adapter, collect permitted labeled challenges and measure local candidates first. Test 1×, 0.75× and 0.5× display scaling, borders, device-pixel ratios, image replacement while solving, competing host selection, stale CSRF, session loss, URL expiry and cancellation. Record accepted clicks, fresh-link generation and downstream transfer as separate outcomes. Define the acceptable sample size, success threshold and latency budget before testing.

Paid trials additionally require separate external-solving opt-in, explicitly configured credentials and an enforced spending ceiling before any request. Reserve budget before submission, allow one task per live challenge, account for timeout/duplicate-task exposure, and report total cost, cost per fresh-link batch, p50/p95 latency and transmitted bytes. Image-size compatibility alone does not demonstrate server-side acceptance.

Fresh g4u links, actual challenge replacement behavior, expiry duration and downstream hosts remain unqualified. Paid adapter implementation is conditional on these results and is not included in this PR.
