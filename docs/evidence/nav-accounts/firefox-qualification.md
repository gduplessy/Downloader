# Firefox account fixture qualification

The Firefox gate builds the production MV2 background and resolver entry points. Its only production source substitution is an isolated native-host address. It installs the addon through Firefox BiDi, uses actual Firefox container tabs, and invokes the unchanged registered context-menu handler with actual source-tab metadata. Native context-menu UI and ordinary background suspension remain unqualified.

## Gate

- `node scripts/nav-fixtures/accounts/firefox-qualification.mjs`
- Requires the immutable 0.25.1 native pair documented in the driver; each input and copied executable is verified against its full SHA-256.
- Build the unchanged trusted desktop helper separately: `cargo build -p downloader-service --example account_fixture_command`, using `CARGO_TARGET_DIR=.local/firefox-accounts-helper`.
- Alice uses explicit saved-fill through the Windows OS keyring. Bob uses an existing browser session seeded through synthetic DOM field assignment and `form.requestSubmit()` on the actual fixture form. Alice saved-fill is dispatched by trusted Firefox pointer input to the production button; the premium preview uses trusted Firefox keyboard input. The fixture Prepare action uses synthetic DOM `.click()`, then the driver invokes the real production `resolver_continue` message after Blob readiness. These are explicit fixture activation boundaries, not native context-menu or permission-dialog UI acceptance. No cookie injection or cookie export is used.
- The same cookie name is used in two actual containers. Distinct Alice/Bob file hashes and server account-label auditing detect session substitution. Cross-container account selection must fail with the exact native `account_session_mismatch` error; arbitrary helper failures do not count as a refusal.
- An explicit fixture-page Prepare action performs the original authenticated fetch and exposes an owned Blob. Production code streams that Blob directly into the desktop engine. The authenticated GET attachment response-filter lane failed in the initial run and remains pending, separately from binary form-navigation response capture. Neither lane is qualified by Blob success.
- Passwords are fixture-only and reach the trusted desktop helper over stdin. Cleanup counts successful account removals and requires no residual fixture account records or removal/list errors before publishing passed evidence. It removes only the created account records before stopping isolated processes. Generated profiles, databases and credential references stay ignored.

## Evidence status

Installed acceptance is pending. The initial attachment-response run reached authenticated saved-fill but Firefox refused capture and safely retained WaitingUser/zero bytes; it is not a successful transfer. A subsequent fixture adaptation lacked the explicit Prepare action and cannot qualify. Neither failure is evidence for premium file completion.

The existing HTTP fixture test and distinct account payload/audit contract test pass. They do not establish installed extension acceptance. Live providers/accounts, provider APIs, Firefox ESR, other operating systems, and positive private addon permission acceptance remain pending.
