# Transfer qualification evidence — 2026-10-11

These records extend the [2026-10-10 baseline](../transfer-engine-2026-10-10/). Source revisions and product versions describe the tested binaries, rather than the version publishing these documents.

| Scope | Windows | macOS | Linux | Tested source / CI |
| --- | --- | --- | --- | --- |
| Network / PAC / performance | [44 cases](ci-windows-network.json) | [43 cases](ci-macos-network.json) | [43 cases](ci-linux-network.json) | 0.3.1 / `5bba63e` / [38108335654](https://github.com/gduplessy/Downloader/actions/runs/38108335654) |
| Actual filesystem failures | [NTFS](ci-windows-filesystem.json) | [HFS+](ci-macos-filesystem.json) | [ext4](ci-linux-filesystem.json) | 0.3.2 / `e5b641c` / [38108936320](https://github.com/gduplessy/Downloader/actions/runs/38108936320) |
| Real AD authentication CI | — | — | [9 NTLM/Kerberos checks](ci-linux-authentication.json) | 0.3.3 / `d1d4d45` / [38109846990](https://github.com/gduplessy/Downloader/actions/runs/38109846990) |
| Real AD authentication local | [4 native NTLM checks](local-authentication.json) | — | [9 Docker NTLM/Kerberos checks](local-authentication.json) | 0.3.2 engine plus in-development qualification fixtures; exact provenance in record |

The local and CI Linux authentication checks overlap; they are not 22 distinct scenarios. Each successful authenticated output is 1,028,096 bytes with SHA-256 `08e33aedf25337c87eb15e08c32a58f6f4caa21fe073d00b53014c57f8d148e0`. Complete jobs verify the engine lifecycle; transport probes also check the authentication handshake. Negative jobs must expose authentication recovery and publish no output. A rejected HTTP probe may receive a bounded error body, which is not a downloaded file.

Filesystem cases require real disk-full/restart recovery, readonly-file failure/recovery and cross-volume publication with collision preservation. Output is 33,554,432 bytes with SHA-256 `1cbd22e11bc209926b1e050d644779ba4105d7a023109c3b78bb35edf5c7c292`. HFS+ evidence does not qualify APFS.

PAC cases assert observed proxy traversal. Older baseline numeric-loopback PAC hash checks did not establish traversal. Local developer network runs explicitly skip the CI-only hostname/direct-fallback case; the three-platform CI executes it.

Records contain capabilities, fixture observations and measurements, without passwords, ticket caches, authorization headers or private host paths. Real-realm qualification uses a volatile credential adapter; OS credential-store integration, native macOS authentication, Windows domain-based Kerberos, enterprise proxy policies, final installer provenance and a successful IDM comparison remain separate acceptance gates. See [realm reproduction](../../AUTH_REALM.md) and the [roadmap](../../ROADMAP.md).
