# Disposable AD and Kerberos acceptance

Run from the repository root with Docker's Linux engine available:

```sh
# PowerShell: $env:CARGO_TARGET_DIR="$PWD\.local\engine-target"
CARGO_TARGET_DIR=.local/engine-target cargo build --release -p downloader-core --example qualify
node scripts/qualify-auth-realm.mjs
```

On Windows, build the native example using the PowerShell environment assignment in the comment. The harness builds a Debian/Rust fixture image, provisions the `DOWNLOADER.TEST` Samba AD realm, creates a fixture user and HTTP service principal, and starts a separate Linux Downloader client. The first run downloads the image, packages and Rust dependencies. Compilation is bounded to two jobs to limit memory use.

## Tests

- NTLM handshakes are verified by Samba's domain controller through `ntlm_auth`, with valid and wrong-password cases.
- Kerberos uses a real `kinit` ticket and HTTP service keytab. Apache accepts only the Kerberos mechanism; Basic authentication and NTLM fallback are disabled for that endpoint.
- Complete engine jobs must publish the expected SHA-256. Rejected jobs must report authentication recovery without publishing an output file.
- Windows additionally exercises its native libcurl/Schannel NTLM implementation against the same realm through a temporary localhost port.
- Fixture credential references use a volatile, read-only keyring adapter in the qualification example. The ordinary engine transport/job code is exercised, but this does **not** qualify OS credential-store integration.

## Isolation and evidence

Every run owns unique containers, a Docker network and a build volume. Domain-controller ports remain inside that network; only the NTLM fixture is mapped to a random `127.0.0.1` port. No host domain join, Windows registry, host Kerberos configuration, DNS settings or existing containers are modified. Container provisioning uses user ACL attributes, without privileged mode or added capabilities.

Passwords are generated per run, mounted read-only from ignored `.local` files, omitted from process arguments on the host, and removed during cleanup. Case files are removed after each test. The harness deletes its own containers/network/build volume and leaves sanitized result files under `.local/auth-realm-*`; the reusable Docker image remains cached.

This fixture establishes only the clients and mechanisms recorded in its results. A Debian container does not qualify native macOS or Windows domain-based Kerberos, enterprise federation, proxy SSO, managed WPAD/PAC policies or the final installer dependency provenance. Keep those roadmap gates open until their specific acceptance evidence exists.
