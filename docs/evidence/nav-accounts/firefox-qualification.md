# Firefox account fixture qualification

The Firefox gate builds the production MV2 background and resolver entry points. Its only production source substitution is an isolated native-host address. It installs the addon through Firefox BiDi, uses actual Firefox container tabs, and invokes the unchanged registered context-menu handler with actual source-tab metadata. Native context-menu UI and ordinary background suspension remain unqualified.

## Gate

- `node scripts/nav-fixtures/accounts/firefox-qualification.mjs`
- Requires the immutable 0.25.1 native pair documented in the driver; each input and copied executable is verified against its full SHA-256.
- Build the unchanged trusted desktop helper separately: `cargo build -p downloader-service --example account_fixture_command`, using `CARGO_TARGET_DIR=.local/firefox-accounts-helper`.
- Alice uses explicit saved-fill through the Windows OS keyring. Bob uses an existing browser session seeded through synthetic DOM field assignment and `form.requestSubmit()` on the actual fixture form. Alice saved-fill is dispatched by trusted Firefox pointer input to the production button; the premium preview uses trusted Firefox pointer input after read-only inspection of the actual closed-shadow controls. The fixture Prepare action uses synthetic DOM `.click()`, then the driver invokes the real production `resolver_continue` message after Blob readiness. These are explicit fixture activation boundaries, not native context-menu or permission-dialog UI acceptance. No cookie injection or cookie export is used.
- The same cookie name is used in two actual containers. Distinct Alice/Bob file hashes and server account-label auditing detect session substitution. Cross-container account selection must fail with the exact native `account_session_mismatch` error; arbitrary helper failures do not count as a refusal.
- An explicit fixture-page Prepare action performs the original authenticated fetch and exposes an owned Blob. Production code streams that Blob directly into the desktop engine. The authenticated GET attachment response-filter lane failed in the initial run and remains pending, separately from binary form-navigation response capture. Neither lane is qualified by Blob success.
- Passwords are fixture-only and reach the trusted desktop helper over stdin. Cleanup counts successful account removals and requires no residual fixture account records or removal/list errors before publishing passed evidence. It removes only the created account records before stopping isolated processes. Generated profiles, databases and credential references stay ignored.

## Installed evidence (0.28.9)

Two consecutive runs passed on frozen source `02388d4043419b0ef33f97adb4d9e20424b8d375`, Firefox **158.0** on Windows, with the copied immutable native **0.25.1** pair built from `3b808ae1967a210fc5b3a3e461488b9f2ab6cb61`. The unchanged trusted desktop fixture helper was built separately from `d99c2f8` (0.25.2); its exact executable hash is recorded and rechecked after the run.

| Actual container | Account path | Verified bytes | SHA-256 |
| --- | --- | --- | --- |
| `firefox-container-6` | Alice saved-fill / Windows keyring | 327,680 | `f6bde2527231239afeb4c82f575de6905408cb98730af6fc7d52ef9575b1bbf0` |
| `firefox-container-7` | Bob existing entitled session | 311,334 | `4b1812569ae59d85633238d9021b5397b6745f1dcb5b6cb0b88d889bbf775ba5` |

[Repeat 1](installed-firefox-accounts-repeat1.json) and [repeat 2](installed-firefox-accounts-repeat2.json) preserve exact driver/server, compiled runtime-input/bundle, native/helper, browser and scope provenance. Both runs assert final native cookie-store/container/profile/private/source/claim identity against the actual owning tab; native verified hashes also match independent published-file hashes. The same cookie name is used in both containers. Alice-to-Bob selection must return exactly `account_session_mismatch`.

Each run submits two logins, makes exactly one authenticated original page fetch per account, and makes zero HEAD, purchase or advertisement requests. Actual production snapshot observation waits for the desktop-selected account claim/source before Continue. The production resolver refresh runs after the page-owned Blob is ready, and actual premium radio/Continue controls are selected with trusted pointer input. These fixture synchronization steps do not modify production runtime or replay payload requests.

Both runs remove two created accounts successfully, report zero residual accounts and zero cleanup errors, and pass an independent read-only SQLite audit of zero persisted `site_account` records. Profiles, raw databases, local URLs and credential references remain ignored. Public evidence contains fixed fixture account labels and request paths, without cookies, passwords, grants or capability tokens.

Firefox actually refused the temporary addon's private-window request with `Extension does not have permission for incognito mode`. That refusal is recorded; it does not qualify a positive private account lane. Ordinary authenticated navigation GET attachment capture failed in the earlier fixture run and remains pending separately from binary form-navigation response capture. Blob success does not qualify those response-filter lanes.

The existing 52-assertion HTTP fixture test and distinct account payload/audit contract test pass independently. They are contract evidence, not installed acceptance. Live provider layouts/accounts/APIs, Firefox ESR, other operating systems, native context-menu/permission-dialog UI and ordinary background suspension remain pending.
