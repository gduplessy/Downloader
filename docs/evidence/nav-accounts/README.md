# NAV-02/03 account qualification

- `keyring-windows.json`: actual Windows x64 OS-keyring lifecycle and Engine save/select/one-use grant/consume/remove. Only generated test credentials; cleanup verified.
- `client-dom.json`: actual Headless Chromium 145 DOM forms and production account form module. Grant transport explicitly mocked. Cancellation and changed claim/form prevent stale fill; normal submission occurs once. This is not installed-extension acceptance.
- `http.json`: four synthetic provider fixture contracts; authenticated permitted bytes have an expected SHA-256, and logout rejects the same cookie. This is HTTP fixture acceptance, not desktop publication.

Browser/native full worker acceptance is being integrated. Windows Chrome/Edge installed-extension rows and Firefox stable/ESR rows are tracked separately. macOS/Linux native credential targets and all real g4u/ddownload/Rapidgator/Gofile accounts/layouts remain pending. No provider API integration, payments, account hopping or real credentials are used.

Reproduce:

```powershell
$env:CARGO_TARGET_DIR = Join-Path $PWD '.local/cargo-accounts'
cargo run -p downloader-core --example qualify_accounts
node scripts/nav-fixtures/accounts/build.mjs
node scripts/nav-fixtures/accounts/http.test.mjs
node scripts/nav-fixtures/accounts/server.mjs
```

Use the gstack `/browse` skill for the local DOM evaluator `scripts/nav-fixtures/accounts/browser-forms.js`; isolate `BROWSE_STATE_FILE`. Never store actual credentials, cookies or private URLs in qualification artifacts.
