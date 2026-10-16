# NAV-02/03 account qualification

The scoped account/session implementation is locally qualified on installed Chrome/Edge and supported Firefox page-owned Blob account lanes on Windows x64. All live g4u/ddownload/Rapidgator/Gofile layouts, accounts and APIs remain pending. Unknown forms stay manual.

## Installed Firefox account/container acceptance (0.28.9)

Firefox158 on Windows passed two consecutive exact-source runs for trusted saved-fill through the OS keyring and an existing entitled session in two real containers. Distinct payload hashes, exact cross-container native refusal, final browser/native authority, unchanged binary hashes and successful account cleanup are verified. See [qualification and explicit activation boundaries](firefox-qualification.md), [repeat 1](installed-firefox-accounts-repeat1.json), and [repeat 2](installed-firefox-accounts-repeat2.json).

Only the original-page fetch/owned-Blob direct stream is accepted here. Authenticated ordinary navigation GET attachment capture remains pending after an actual refusal; binary form-navigation, positive private-addon, Firefox ESR, other OS and live provider/API lanes remain pending. Bob's seed form and fixture Prepare use synthetic DOM dispatch; initial navigation invokes the unchanged registered menu listener. Saved-fill and premium confirmation use trusted Firefox pointer input against actual production controls.

## Historical installed production acceptance (0.9.10)

| Target | Account path | Result | Evidence |
| --- | --- | --- | --- |
| Chrome 155.0.8059.39 / Windows x64 | Explicit saved fill, native OS keyring | Passed | [Chrome saved](production-integrated-chrome-saved.json) |
| Edge 155.0.4283.45 / Windows x64 | Explicit saved fill, native OS keyring | Passed | [Edge saved](production-integrated-edge-saved.json) |
| Chrome 155.0.8059.39 / Windows x64 | Existing entitled browser session, no stored credential | Passed | [Chrome session](production-integrated-chrome-session.json) |
| Firefox158 stable | Scoped saved-fill / existing entitled-session owned Blob | Passed twice at 0.28.9 | [Firefox qualification](firefox-qualification.md) |
| Firefox ESR | Account flow and same-document lifecycle | Pending | No installed ESR acceptance claimed |
| macOS Intel / Apple Silicon, Ubuntu x64 | OS credential lifecycle and installed account flow | Pending | Native target unavailable in these runs |

Each accepted run creates exactly one owned tab, submits one sign-in, transfers one file and submits zero purchase/ad requests. The actual background/resolver and persistent native messaging sink publish 311,296 bytes with SHA-256 `de16d381af1835e9fb8fcf379da3f439db796cf46f4668fd2fcb778ff4f43cee`. The completed native job retains `ddownload.com`, original `/nav-adapters/ddownload/login`, current `/nav-adapters/ddownload/account`, and the qualified `local-fixture@1.0.0` adapter.

The tested tree is the pending merge of checked `c8ac54d` into D `c7d569f`, plus fixture assertions. Artifacts include exact source hashes and native/product version 0.9.10. They do not label uncommitted source as a commit. Generated profiles, local fixture URLs and credentials stay outside committed artifacts. Test account removal succeeds before browser shutdown; independent read-only audits confirm zero `site_account` records in each isolated database. The native removal command deletes its keyring reference before removing metadata. Only each fixture's unique temporary native-host registration is removed.

The UI driver detaches its fixture-page debugger immediately after explicit sign-in input, before production capture. Fixture packaging substitutes only the unique native host name and grants loopback fixture permissions. No browser/native transport mocks, byte relay or file import occur. Those historical runs do not establish permission-prompt/install UX, Firefox/ESR or private/container acceptance. The later Firefox container/Blob qualification above is separate; positive private, ESR and live provider acceptance remain pending.

## Other evidence

- [Windows keyring](keyring-windows.json): actual Windows OS-keyring create/read/delete and Engine one-use scoped grant/consume/remove using generated test credentials; cleanup verified.
- [Client DOM](client-dom.json): actual Headless Chromium 145 with the production form module, **mocked grant transport**. Cancellation and changed claim/form prevent stale fill; normal submission happens once. This does not prove installed-extension transport.
- [HTTP fixtures](http.json): four synthetic provider namespaces with authenticated permitted bytes and logout refusal. HTTP requests alone do not prove desktop publication.
- Historical [Chrome saved](production-chrome-saved.json), [Chrome session](production-chrome-session.json), [Chrome nonce](production-chrome-nonce.json) and [failed Edge continuation](production-edge-pending.json) are retained as earlier evidence. The failed Edge row claims zero acceptance; the final passing Edge row above supersedes its pending status.

Native/client tests separately cover MFA, rejected/expired credentials, unknown/expired/quota entitlement, mismatched account/profile/source/claim, private ephemeral metadata, credential edit/remove, same-URL nonce replacement without document ID, bounded attempts, duplicate consumption, cancellation, and competing account/session fences. Six locale dictionaries, keyboard focus, RTL and visible cancellation are implemented. Native desktop compilation does not establish native GUI visual acceptance.

## Reproduce

```powershell
$env:CARGO_TARGET_DIR = Join-Path $PWD '.local/cargo-accounts'
$env:CARGO_INCREMENTAL = '0'
cargo build -p downloader-service -p downloader-cli
cargo build -p downloader-service --example account_fixture_command
cargo run -p downloader-core --example qualify_accounts
node scripts/nav-fixtures/accounts/build.mjs
node scripts/nav-fixtures/accounts/http.test.mjs
node scripts/nav-fixtures/accounts/production-worker.mjs
$env:NAV_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/accounts/production-worker.mjs
Remove-Item Env:NAV_BROWSER
$env:NAV_EXISTING_SESSION = '1'
node scripts/nav-fixtures/accounts/production-worker.mjs
```

Use gstack `/browse` for the local DOM evaluator `scripts/nav-fixtures/accounts/browser-forms.js`; isolate `BROWSE_STATE_FILE`. Never place actual passwords, cookies, private URLs or signed links in evidence. Provider APIs require individual contracts and qualification; no payments, account hopping or premium bypass are implemented.

[Final check record](checks-integrated.json): 121 extension tests, six desktop tests, both typechecks/builds, 113 passing native fault-injection tests, strict all-target Clippy/fmt, isolated binaries, native Tauri compilation, fresh Windows keyring lifecycle and version/artifact checks passed. Four subprocess fixture entries are intentionally ignored in direct invocation.
