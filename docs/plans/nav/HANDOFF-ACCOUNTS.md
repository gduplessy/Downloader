# NAV-02/03 implementation handoff

Batch D implements explicit scoped accounts, manual MFA recovery, optional saved fills and existing-session premium selection. Live forms remain unqualified and manual; APIs await provider qualification. Parent integration already includes committed D increments through `c7d569f`; final 0.9.10 adopts `c8ac54d` and records combined installed acceptance.

## Contracts

- Desktop-only `site_account` saves/edits nonsecret metadata, selects free/premium/manual for an explicitly chosen owned job, and removes native credential references. No generic keyring reads are exposed to the browser bridge. Private metadata is ephemeral and saved credentials are rejected for private sessions.
- Browser `browser_account` exposes only selection/observe/grant/consume, bound to exact owner/session/source/claim and validated current top-frame document nonce/generation plus Chromium document ID when available.
- Native credential grants expire after 15 seconds and consume atomically once before keyring read. Form/action/method/field fingerprint and account revision remain exact; delayed fills revalidate after each asynchronous stage and honor cancellation. Attempts remain bounded across same-session continuation.
- Premium grants have a distinct purpose and token map. Prepare/commit rechecks selected qualified account, fresh authenticated identity/active entitlement, source/session/document authority, and exact adapter. A premium label alone never authorizes a transfer.
- Intentional account/session selection, edit/removal and claim/source renewal invalidate older grants and entitlement observations. Scope renewal cannot transfer profile/private/store/container/partition. Startup is serialized per job; the fresh claim is persisted before heartbeat. Closed-tab release cleanup uses exact current epoch/native authority without requiring an open tab.
- Shared `ResolverContext` requires `sourceGeneration`, `documentNonce`, `documentGeneration`; action messages carry `document:{nonce,generation}`. E isolated-world document verification, root monotonic metadata writes, stream ownership and tombstone privacy remain intact.

## Production hooks

`site_accounts` in core and narrow service dispatcher; desktop Settings account controls; `navigation/accounts` policy/form/worker/premium modules; background account routing and premium authorization; resolver observation/panel/once-only fill; local-fixture adapter entitled control support. Six locale labels, status/focus/RTL/Cancel controls are included.

## Evidence and limitations

[Account evidence](../../evidence/nav-accounts/README.md) distinguishes installed Chrome/Edge/native hashes, OS keyring, HTTP fixtures and mocked grant DOM checks. Final installed Chrome saved, Edge saved and Chrome existing-session runs each publish the expected 311,296-byte file with one login, one file request, zero purchases, selected ddownload and original provenance. Fixture accounts and unique registrations are removed.

Firefox stable/ESR account acceptance, installed private/container account flows, permission prompts, native GUI visual acceptance, macOS/Linux keyring targets and all live provider/account/API rows remain pending. No real credentials, paid CAPTCHA calls, account hopping, payment submission, guessed premium bypass or legacy private database purge occurred.
