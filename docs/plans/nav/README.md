# NAV implementation plans

Baseline: `origin/main` at `78736ab` (product 0.5.5), fetched on 2026-10-11. Planning branch: `codex/nav-plans`. These plans cover every NAV row with unfinished work, including NAV-01 qualification and the newly separated NAV-13 custom CAPTCHA scope. Planning does not close roadmap items.

## Owner decisions

- Qualify g4u, ddownload, Rapidgator, and Gofile first. Preserve the explicit downstream-host selection and original source provenance.
- NAV-13: local solving first; optional 2Captcha integration disabled by default. Live paid qualification budget is **$0**; use a fake provider for implementation tests.
- NAV-03: use existing entitled browser sessions first. Add official provider APIs only after provider-specific qualification.
- NAV-07/08: **direct streaming into desktop storage is required**. Browser completion followed by file import does not satisfy these plans.
- Ship one Chromium extension build declaring the required `debugger` permission. Direct capture remains disabled until the user explicitly enables it; explain the install-time permission and visible attachment state. Chrome cannot declare this permission as optional. Prove each capture lane before claiming coverage.
- NAV-10: default three active navigation tabs, configurable from one to twenty. Session-sensitive host workflows remain serial.
- Keep a separate plan per NAV item; group coupled implementation into six agent/worktree/PR batches. Commit focused, verified increments often.

## Plans and implementation ownership

| Plan                | Outcome                                                     | Batch |
| ------------------- | ----------------------------------------------------------- | ----- |
| [NAV-01](NAV-01.md) | Qualify existing FlareSolverr and visible recovery          | E     |
| [NAV-02](NAV-02.md) | Scoped login and session refresh with MFA handoff           | D     |
| [NAV-03](NAV-03.md) | Downloads through existing premium entitlements             | D     |
| [NAV-04](NAV-04.md) | Recoverable waits and readiness notification                | C     |
| [NAV-05](NAV-05.md) | Versioned adapters and explicit ambiguous-control selection | A     |
| [NAV-06](NAV-06.md) | Host compatibility fixtures, matrix, and smoke tests        | A     |
| [NAV-07](NAV-07.md) | Direct, single-submission POST response streaming           | B     |
| [NAV-08](NAV-08.md) | Bounded blob/page stream transfer to desktop                | B     |
| [NAV-09](NAV-09.md) | Replay-risk classification and one-use ownership            | B     |
| [NAV-10](NAV-10.md) | Configurable navigation queue and host admission            | C     |
| [NAV-11](NAV-11.md) | Qualified profile/container/private-session isolation       | B     |
| [NAV-12](NAV-12.md) | Durable browser-rendered discovery and owned handoff        | F     |
| [NAV-13](NAV-13.md) | Local image solver and optional paid-provider adapter       | E     |

## Shared contracts and integration

Before feature behavior is integrated, the coordinator records and implements a small shared contract increment, with tests and its own commit. Agents may develop isolated feature modules against these agreed contracts concurrently. Avoid broad refactors. Define the following interfaces and extension dispatch hooks; feature behavior belongs to the batch owners:

- `SessionScope`: browser/profile identifier, private flag, cookie-store/container identity, top-level partition identity, and a claim generation. Capability detection is explicit; missing scope cannot silently select a default cookie store.
- `NavigationTask`: job/project identifier, purpose, source provenance, selected host, owner generation, typed status/reason, adapter identifier/version, and optional wait metadata. Keep secrets and challenge images out of durable metadata.
- Adapter contract: host matching, session-lock key, login/challenge/countdown signals, candidate discovery, replay disposition, and selected-host extraction. It does not execute downloaded scripts or remote adapter code.
- Stream contract: owner-bound begin/chunk/ack/end/abort operations, opaque stream ID, ordered offsets, bounded frames, backpressure, durable acknowledgements, terminal verification, and capability negotiation. Existing 1 MiB native frames remain a hard limit until deliberately negotiated otherwise. Use a persistent native messaging port for byte transport rather than spawning a native host for every chunk; measure throughput and bounded memory with slow writers.
- Feature registration points in the extension worker/resolver, core command dispatcher, browser projection, and desktop feature components. New commands remain denied by default on the native bridge until individually allowlisted and ownership-checked.

The coordinator owns shared dispatch/wiring in `background.ts`, `resolver.ts`, `resolver-policy.ts`, `engine.rs`, `model.rs`, `store.rs`, `lib.rs`, `App.tsx`, desktop types, extension manifests/build entries, and shared translation registration. Feature agents primarily add their assigned modules, tests, and feature UI components; request coordinator integration patches for shared files. Once only one batch is active, ownership may be transferred explicitly. Every agent is told it is not alone in the codebase and must preserve other agents' edits.

## Execution batches

| Batch / suggested branch           | Exclusive feature responsibility                                                                                                                       | Dependencies                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| A / `codex/nav-adapters`           | NAV-05/06; `apps/extension/src/navigation/adapters/`, candidate policy/selection UI, `scripts/nav-fixtures/adapters/`, host matrix                     | Shared contracts                                                 |
| B / `codex/nav-browser-streams`    | NAV-07/08/09/11; `apps/extension/src/navigation/session/`, `streams/`, replay policy, `crates/core/src/browser_stream/`, stream and isolation fixtures | Shared contracts; run feasibility checks first                   |
| C / `codex/nav-scheduling`         | NAV-04/10; `apps/extension/src/navigation/scheduler/`, wait modules, navigation settings UI, scheduler fixtures                                        | Shared contracts; A host rules and B scope for final integration |
| D / `codex/nav-accounts`           | NAV-02/03; `apps/extension/src/navigation/accounts/`, `crates/core/src/site_accounts/`, account UI and fixtures                                        | A/B integrated                                                   |
| E / `codex/nav-challenges`         | NAV-01/13; `apps/extension/src/navigation/challenges/`, `crates/core/src/captcha/`, challenge UI, solver qualification                                 | A/B/C integrated                                                 |
| F / `codex/nav-rendered-discovery` | NAV-12; `apps/extension/src/navigation/discovery/`, `crates/core/src/rendered_grabber/`, discovery UI and fixtures                                     | A/B/C integrated; D session refresh hook if used                 |

Run at most three feature agents simultaneously. First wave: A/B/C. B must resolve direct-stream feasibility before investing in a full bridge. Second wave: D/E/F after their prerequisites compile and pass integration checks. The coordinator handles shared wiring and monitors tests, versions, dependencies, and evidence.

Each batch gets a managed worktree with a `codex/` branch and an explicit goal containing its plan IDs. Do not share output databases, browser profiles, fixture ports, or Cargo target directories. Inspect existing worktree attachments first. Run setup from the returned worktree path, never from the original checkout.

Commit the planning package before branching. Dependent work may use a coordinator integration branch containing reviewed local merges of prerequisite commits; record exact parent revisions. This is a staging branch, not permission to merge PRs to main. Independent PRs target main; dependent PRs initially target the pushed integration/prerequisite branch so their diffs exclude prerequisite work. Name all prerequisite PRs; retarget and revalidate after prerequisites land. Preserve all individual batch PRs and do not automatically merge, close, or delete them.

## Commit and PR requirements

- Typical increments: contracts/policy and tests; backend/bridge; browser behavior; desktop controls/translations; qualification/evidence. Keep every commit buildable.
- Follow `CONTRIBUTING.md`: each focused commit increments `0.MINOR.PATCH`, updates README/roadmap/changelog, and passes version checks. Documentation-only planning increments use a patch bump. Feature increments use a minor bump as appropriate.
- Allocate non-overlapping feature minor versions centrally after checking current main. Coordinate version surfaces and lockfiles; do not independently reuse a version. Reconcile monotonic versions before retargeting/merging stacked work.
- Run affected deterministic checks before each commit. Before a PR: Rust formatting/tests/Clippy, TypeScript checks/tests/build, version/artifact checks, native compilation and fixture acceptance appropriate to the change.
- Open one PR per batch, attach every created PR to this chat, and report its exact branch/base/commit. PRs describe behavior, test results, dependencies, and unresolved acceptance rows. No fabricated live-host/browser evidence.
- Agents pursue the full accepted implementation goal. If browser APIs cannot meet a required case, preserve a runnable feasibility fixture, identify the exact unsupported case, and escalate to the coordinator. Research evidence does not become an implementation-complete claim.

## Common acceptance

- Existing transfers and FlareSolverr behavior remain covered. No unauthorized bridge commands, duplicate POSTs, guessed GETs, secret persistence, session mixing, or falsely completed jobs.
- Deterministic local hosts exercise success, missing permissions, cancellation, service/worker restart, stale claims, redirects, session expiry, and zero-byte refusal. Verify actual file hashes for successful transfers.
- Record actual browser name/version, OS/architecture, extension/service revision, adapter version, fixture identifier, outcome, and limitations. Synthetic tests, Chrome for Testing, stable browser results, and owner/live-host acceptance are distinct.
- Preserve the existing release matrix: Windows 11 x64, macOS 14+ Intel/Apple Silicon, Ubuntu 24.04+ x64; Chrome/Edge stable and Firefox stable/ESR. Native runs unavailable on this machine remain pending, with reproducible commands or CI jobs.
- Complete all six locale dictionaries, keyboard navigation, clear permission/capture state, cancellation, and actionable recovery messages for new UI.
- Keep evidence in `docs/evidence/nav-*` with sanitized public fixtures. Private URLs, accounts, cookies, CSRF tokens, CAPTCHA images, and signed links stay out of commits and PRs.

## Accepted qualification boundaries

- Implement and qualify local fixtures now. Live host/account acceptance for all four hosts stays pending until permitted URLs/accounts are available. Do not block fixture-backed implementation or pretend local fixtures qualify live providers.
- Preserve the current browser release matrix. Present exact lane failures from the feasibility matrix rather than silently reducing the required direct-stream scope.
- Live paid solver qualification remains deferred at the owner-selected $0 budget.
- On 2026-10-13 the owner explicitly chose to keep the tested Firefox 157 binary form-navigation/download capture lane pending while finishing supported direct-stream lanes and PRs. Controlled local response-filter evidence distinguishes ASCII document responses, binary MIME sniffing, page-owned fetch, and unsuccessful attachment-header normalization. This boundary does not waive supported Firefox Blob or other available local lifecycle qualification.

## Verification and references

- [Verified browser/provider API constraints](SOURCES.md) were checked through gstack `/browse` on 2026-10-11.
- Planning validation checks local Markdown links, coverage of NAV-01 through NAV-13, and product-version synchronization. Runtime tests listed in each plan belong to implementation acceptance.

Status: plans complete and ready for implementation dispatch. Live host/account and paid-provider acceptance remain separate gates as selected by the owner.
