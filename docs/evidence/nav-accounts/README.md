# NAV-02/03 account qualification

- `keyring-windows.json`: actual Windows x64 OS-keyring lifecycle and Engine save/select/one-use grant/consume/remove. Only generated test credentials; cleanup verified.
- `client-dom.json`: actual Headless Chromium 145 DOM forms and production account form module. Grant transport explicitly mocked. Cancellation and changed claim/form prevent stale fill; normal submission occurs once. This is not installed-extension acceptance.
- `http.json`: four synthetic provider fixture contracts; authenticated permitted bytes have an expected SHA-256, and logout rejects the same cookie. This is HTTP fixture acceptance, not desktop publication.

`production-chrome-saved.json` and `production-chrome-session.json` record installed Chrome 155 on Windows x64 using production background/resolver/native transports. Both local fixtures publish 311,296 bytes with the expected SHA-256, one login, one file transfer and zero purchase/ad requests. The existing-session row stores no credential. Test account removal runs before browser shutdown.

`production-edge-pending.json` records the failed Edge continuation row with zero file bytes; no Edge acceptance is claimed. Windows Edge and Firefox stable/ESR rows remain pending. macOS/Linux native credential targets and all real g4u/ddownload/Rapidgator/Gofile accounts/layouts remain pending. No provider API integration, payments, account hopping or real credentials are used.

Reproduce:

```powershell
$env:CARGO_TARGET_DIR = Join-Path $PWD '.local/cargo-accounts'
cargo run -p downloader-core --example qualify_accounts
node scripts/nav-fixtures/accounts/build.mjs
node scripts/nav-fixtures/accounts/http.test.mjs
node scripts/nav-fixtures/accounts/server.mjs
```

Use the gstack `/browse` skill for the local DOM evaluator `scripts/nav-fixtures/accounts/browser-forms.js`; isolate `BROWSE_STATE_FILE`. Never store actual credentials, cookies or private URLs in qualification artifacts.

Production fixture reproduction:

```powershell
node scripts/nav-fixtures/accounts/production-worker.mjs
$env:NAV_EXISTING_SESSION = '1'
node scripts/nav-fixtures/accounts/production-worker.mjs
```

The UI driver detaches its fixture-page debugger after input, before production capture. Fixture packaging only substitutes the unique native host name; no native/browser transport mocks, byte relay or file import occur. Native release, private/container coverage and same-URL document replacement remain separately fenced and tested; unavailable browser/OS acceptance stays pending.
