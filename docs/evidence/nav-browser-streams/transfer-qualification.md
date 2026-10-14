# Installed two-profile navigation transfer

Installed Windows x64 Chrome155.0.8059.39 and Edge155.0.4283.45 pass the exact rows in [the sanitized matrix](transfer-browser-matrix.json), using unchanged production background, resolver and receiver options on checked de2ab0d (0.16.2). The fixture records each selected native-host/daemon, CLI and restricted desktop-IPC executable SHA before launch and rechecks them at completion. The service has no self-reported version; CLI version is separate evidence.

## Verified sequence

- Create a source browser profile and establish its actual cookie-store membership. Complete a separate original-profile control file; 262,161 native bytes hash to `ea7079c478bfa028ecbe546e3f39bbf22aa9e5a5d575fd3854105c3c05d6a862`.
- Create a fresh source-owned waiting task with zero bytes and no partial artifact. Only then create the recipient profile. Both profiles use the identical HTTP URL and cookie name `fixture_session`, with different values and independently generated original page Blobs. Their actual cookie-store labels are both `0`; the observed profile identities differ.
- Browser bridge DesktopPrepare is refused. The guarded desktop IPC example prepares the transfer with the exact native source scope. Prepare advances source/claim1/1 to2/2.
- In the actual production options page, use Reload tabs, enter the bearer code, Preview transfer and Accept in this session. The receiver worker derives every scope field from real tab/cookie APIs. The code clears after preview; preview does not fetch the source page. Accept changes owner and claim to3 while retaining the already advanced source2.
- Original-scope status, stream admission, force claim, account and CAPTCHA requests are refused. A force claim using the frozen current source2 but the original profile is also refused, independently establishing the profile fence.
- Use the production file preview radio and Continue. The recipient native artifact completes 262,161 bytes with SHA `fc55ee5d7a5516e4f888e2bb43fa66637b1c1a26d69f3298b6e8701cfb651d83`, distinct from the source artifact. Neither original anchor is clicked; the desktop makes no origin request and the original page is not replayed after prepare.
- Reusing the consumed code is refused. The token is absent from both profiles' extension local/session storage and the native DB/WAL.

The parent driver keeps the bearer code only in memory and piped IPC output; it never writes it to a fixture file or logs it. CDP operates controls and observes metadata, never transporting file response bytes. Profiles, native registration, data directory, port and output directories are unique to each run.

## Reproduce

```powershell
cargo build -p downloader-service -p downloader-cli
cargo build -p downloader-service --example navigation_transfer_fixture
node scripts/nav-fixtures/streams/transfer-qualification.mjs
$env:NAV_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/nav-fixtures/streams/transfer-qualification.mjs
```

The desktop helper requires an absolute `DOWNLOADER_DATA_DIR` and an owned `navigation-transfer-fixture-owned` marker. It accepts only NavigationTransfer commands from bounded piped input. Browser DesktopPrepare remains disallowed. The runner prepares its own helper directory/marker and uses the same selected service executable for the native host and daemon; never substitute a user data directory.

## Boundaries

- Desktop preparation uses the restricted fixture IPC caller; the native desktop panel's actual click/clipboard/rendering acceptance belongs to the coordinator.
- Settings setup is a trusted fixture action. Receiver transfer and file previews use actual production UI controls and trusted mouse/input events.
- This is a regular-session two-profile row. Private/container/partition combinations, complete browser-process restart, OS matrices and live host/account acceptance remain separate gates.
- Preliminary runs opened the recipient before source ownership and did not show the control preview. Their local failure artifacts are preserved; those runs are not transfer passes and do not qualify competing unclaimed-task scheduling.

## Verification

- Both client type checks, 150 extension tests, 6 desktop tests, Chromium/Firefox builds and product version checks pass.
- Rust formatting, full workspace tests and strict all-target Clippy pass on the qualification candidate. The workspace includes 16 handoff and 15 direct-stream regression tests.
- The actual browser rows use the separately fingerprinted native 0.16.2 executables recorded in the matrix; metadata/check builds at 0.19.0 do not retroactively change their provenance.
