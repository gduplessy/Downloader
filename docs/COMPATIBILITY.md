# Compatibility and acceptance

This is a development build. An implemented workflow is not a verified public release.

| Target                  | Build                         | Native GUI               | Browser capture                              | Install/upgrade | Status      |
| ----------------------- | ----------------------------- | ------------------------ | -------------------------------------------- | --------------- | ----------- |
| Windows 11 x64          | Local executable + NSIS built | Connected table observed | Hosted fixtures passed in Chrome for Testing | Not yet run     | Preview     |
| macOS 14+ Intel         | Not separately qualified      | Not yet run              | Not yet run                                  | Not yet run     | Unqualified |
| macOS 14+ Apple Silicon | Engine/client CI passed       | Not yet run              | Not yet run                                  | Not yet run     | Unqualified |
| Ubuntu 24.04+ x64       | Engine/client CI passed       | Not yet run              | Not yet run                                  | Not yet run     | Unqualified |

Chrome and Edge use Manifest V3. Firefox uses a separate WebExtension manifest.
The [engine evidence](TRANSFER_ENGINE.md) records actual protocol, proxy, PAC, ZIP64, >4 GiB and real native-messaging/CLI checks on Windows/macOS/Linux, including macOS socket permission/rebind and service restart. CI source compilation is distinct from installers and visible native workflows; macOS CI is Apple Silicon, not Intel.

Ordered PAC failover passes on all three CI platforms. Real filesystem recovery is qualified on Windows NTFS, macOS HFS+ and Linux ext4 disposable images. A Samba AD realm qualifies native Windows NTLM and Docker Debian Linux NTLM/Kerberos. Native macOS authentication, Windows domain-based Kerberos and OS credential-store integration remain separate acceptance rows; see [realm scope](AUTH_REALM.md).
Safari, mobile operating systems, Windows ARM, DRM circumvention, MMS, and system-wide network interception are not supported.

Hosted download pages are navigated in a real browser tab. Countdown timers are respected.
Custom CAPTCHA, sign-in, payment, and ambiguous buttons require user interaction.
Non-replayable POST, blob, and one-use requests remain browser-managed.
Optional loopback FlareSolverr integration attempts recognized browser protection once after opt-in and supports manual retry. The pinned 3.4.6 Linux amd64 image was qualified on Docker Desktop/Windows using a generated GET/cookie fixture and a hash-verified range/resume transfer. This does not establish live Cloudflare, g4u CAPTCHA or downstream-host compatibility. See [solver qualification](FLARESOLVERR_QUALIFICATION.md) and [Docker setup](FLARESOLVERR_DOCKER.md). Premium purchase and custom CAPTCHA automation remain unsupported.

Current exclusions and unsupported workflows are tracked in the [complete roadmap](ROADMAP.md), including challenge automation/bypass research, premium/authorized protected-content integration, POST/blob/one-use transfer paths, Safari/mobile/ARM, legacy protocols, and system-wide interception. Roadmap inclusion does not change this preview's support matrix.

Download-engine fixtures, browser handoff tests, package builds, live-site checks,
and platform acceptance must be reported independently.
