# Compatibility and acceptance

This is a development build. An implemented workflow is not a verified public release.

| Target                  | Build                         | Native GUI               | Browser capture                              | Install/upgrade | Status      |
| ----------------------- | ----------------------------- | ------------------------ | -------------------------------------------- | --------------- | ----------- |
| Windows 11 x64          | Local executable + NSIS built | Connected table observed | Hosted fixtures passed in Chrome for Testing | Not yet run     | Preview     |
| macOS 14+ Intel         | Not separately qualified      | Not yet run              | Not yet run                                  | Not yet run     | Unqualified |
| macOS 14+ Apple Silicon | Engine/client CI passed       | Not yet run              | Not yet run                                  | Not yet run     | Unqualified |
| Ubuntu 24.04+ x64       | Engine/client CI passed       | Not yet run              | Not yet run                                  | Not yet run     | Unqualified |

Chrome and Edge use Manifest V3. Firefox uses a separate WebExtension manifest.
The [engine evidence](TRANSFER_ENGINE.md) records actual protocol, proxy, PAC, ZIP64 and >4 GiB checks on Windows/macOS/Linux. The macOS CLI startup permission repair is awaiting confirmation. CI source compilation is distinct from installers and visible native workflows; macOS CI is Apple Silicon, not Intel.
Safari, mobile operating systems, Windows ARM, DRM circumvention, MMS, and system-wide network interception are not supported.

Hosted download pages are navigated in a real browser tab. Countdown timers are respected.
CAPTCHA, sign-in, payment, and ambiguous buttons require user interaction.
Non-replayable POST, blob, and one-use requests remain browser-managed.
No automatic premium purchase, CAPTCHA bypass, or anti-bot evasion is performed.

Current exclusions and unsupported workflows are tracked in the [complete roadmap](ROADMAP.md), including challenge automation/bypass research, premium/authorized protected-content integration, POST/blob/one-use transfer paths, Safari/mobile/ARM, legacy protocols, and system-wide interception. Roadmap inclusion does not change this preview's support matrix.

Download-engine fixtures, browser handoff tests, package builds, live-site checks,
and platform acceptance must be reported independently.
