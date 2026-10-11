# Local FlareSolverr setup

Downloader's optional integration handles rendered pages and some browser protection. Custom image CAPTCHAs, login, payment, countdowns and ambiguous controls still require browser input. A ready service or API `status: ok` does not establish a usable download. See [qualification and limits](FLARESOLVERR_QUALIFICATION.md).

## Prerequisites

- Docker Engine or Docker Desktop with Linux containers and Docker Compose v2 supporting `up --wait`.
- Downloader 0.5.1 or newer. Enable the extension's permissions for the sites you navigate.
- Internet access from the container. Its Chromium browser is included in the image.
- A free local port. If a service already uses 9191, keep it running and use 19191 for this walkthrough.

The [Compose file](../docker-compose.flaresolverr.yml) pins the locally qualified Linux amd64 image by digest, publishes **127.0.0.1:9191:8191**, uses `unless-stopped`, disables HTML logging and reduces ordinary log verbosity. It creates no persistent browser-profile volume. Docker on other architectures and native Linux/macOS operation remain separate qualification gates.

## Start and check readiness

Run from the repository root:

```sh
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml config
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml up -d --wait --wait-timeout 120
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml ps
```

For an isolated deployment alongside an existing service, set the port before all Compose commands:

```powershell
$env:FLARESOLVERR_PORT = '19191'
```

```sh
export FLARESOLVERR_PORT=19191
```

Check the root endpoint, substituting your chosen port:

```powershell
Invoke-RestMethod http://localhost:9191/ | Select-Object msg,version
```

```sh
curl --fail http://localhost:9191/
```

Expect `FlareSolverr is ready!` and version `3.4.6` for this digest. The health check tests readiness, not challenge clearance. If startup exceeds the wait deadline, inspect `ps` before retrying; Chromium startup can take time.

## Configure Downloader

1. Open **Settings → Networking → FlareSolverr**.
2. Set the local service URL to `http://localhost:9191/`, or `http://localhost:19191/` for the isolated deployment. HTTP loopback root URLs are required.
3. Keep the default timeout of 60 seconds (supported range: 1–120).
4. Choose **Test connection** and check the service version.
5. Choose **Direct** under proxy routing. The container cannot inherit system, PAC or manual proxy settings. Direct routing does not prove that VPN/container egress IPs match; qualify that separately for protected hosts.
6. Enable FlareSolverr and **Save changes**.

Add a hosted page using **Navigate download page**. A recognized browser challenge gets one automatic attempt. **Try FlareSolverr** in the selected desktop job or extension popup permits a manual retry. It creates a new session and never imports your browser's cookies or login. Private or credential-backed jobs remain manual. The extension keeps profile ownership while solving and retains browser fallback until the engine transfer is viable.

## Test download

Use a permitted small file with a known SHA-256. This repository supplies a generated 2 MiB fixture; no production file is needed:

```sh
cargo build -p downloader-cli -p downloader-service
node scripts/qualify-solver.mjs
```

For the isolated port:

```powershell
$env:SOLVER_ENDPOINT = 'http://localhost:19191/'
node scripts/qualify-solver.mjs
```

```sh
SOLVER_ENDPOINT=http://localhost:19191/ node scripts/qualify-solver.mjs
```

The script uses a separate Downloader data directory under `.local`, quits that service afterward, and prints sanitized evidence. It checks a JavaScript-generated link/cookie, matching User-Agent, byte ranges, pause/resume and SHA-256; CAPTCHA and expiry cases must return to manual navigation with zero bytes. Its temporary HTTP fixture binds all interfaces on an ephemeral port so the container can reach it. Docker Desktop's `host.docker.internal` must also resolve on the host. On other configurations, set `FIXTURE_HOST` to an address reachable from both host and container; that environment requires separate qualification.

A successful fixture is not evidence that a particular live site's challenge can be cleared. Qualify source-page resolution and downstream-host transfer independently.

## Troubleshooting

| Symptom                            | Action                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port already allocated             | Use 19191 and update Downloader's endpoint; preserve the existing service.                                                                                    |
| Connection test fails              | Check Compose `ps`, the chosen port, and the root endpoint. Keep the URL at `/`, without credentials or query parameters.                                     |
| Service healthy, source unresolved | Inspect the browser page. Complete custom CAPTCHA/login/countdown manually, select the intended host and continue navigation.                                 |
| Routing mismatch                   | Use explicitly qualified Direct routing, or keep the job browser-managed. A local container cannot transparently share OS/PAC/proxy/VPN routing.              |
| Link expired / HTML response       | Generate a fresh link from the originating page. Do not retry a saved signed URL indefinitely.                                                                |
| Session cleanup failed             | Restore the service, then use **Test connection** to retry owned cleanup, or restart Downloader. Pending cleanup blocks new solving for that job.             |
| Interrupted or changed page        | Continue from the current tab and retry with a fresh session. Late results are discarded.                                                                     |
| Fixture cannot reach host          | Check `host.docker.internal` resolution and firewall/network reachability; use an explicitly reachable `FIXTURE_HOST`. Do not open the solver API to the LAN. |

Avoid enabling HTML/debug logging when collecting diagnostics. Container logs can still include URLs; inspect locally and redact signed URLs before sharing. Cookies, returned HTML and User-Agent context are temporary and excluded from Downloader records, exports and diagnostics. The local Chromium service contacts the destination sites normally.

## Stop, remove, upgrade and roll back

```sh
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml stop
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml start
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml down
```

These affect this Compose project. Keep the same project name and port environment when operating the isolated deployment. `down` removes its container and network, retaining the downloaded image. No service data volume needs deletion.

Before upgrading, save the current Compose file and digest. Select an explicit replacement digest, test it under a separate project on 19191, and rerun the fixture plus your live host checks. Only then update the primary deployment:

```sh
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml pull
docker compose -p downloader-solver -f docker-compose.flaresolverr.yml up -d --force-recreate --wait --wait-timeout 120
```

For rollback, restore the saved file containing the previous digest and repeat `up --force-recreate --wait`. Solver sessions are disposable; continue affected jobs with fresh browser context. A replacement image has not been qualified merely because it starts successfully.
