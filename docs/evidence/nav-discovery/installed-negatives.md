# Installed discovery negative qualification

This fixture builds unchanged production background, discovery, content and resolver modules. Its only source substitution is a unique native-host address. Loopback permissions and an isolated extension page provide test activation; desktop Cancel UI and permission prompts are separate acceptance boundaries.

It requires the fingerprinted matching 3b808ae/native0.25.1 pair. `NAV_NATIVE_PAIR` locates the directory containing both executables. Each run verifies full SHA-256, copies both binaries into its unique fixture directory and records production source/bundle/driver fingerprints.

```powershell
$env:NAV_DISCOVERY_CASE='cancel' # or tab-loss / auth-expiry
node scripts/nav-fixtures/discovery/installed-negatives.mjs
# NAV_BROWSER can select the installed Edge executable.
```

Cancellation and tab loss require actual native document enrollment before interruption. Normal production alarm/poll handling drives cleanup/recovery. Authentication expiry removes only the synthetic fixture cookie; login resumes the same owned browser context. No resource is selected: every case must retain original/unrelated user tabs, create zero jobs, and make zero payload/HEAD requests.

Actual installed rows remain pending. The fixture writes evidence only after all assertions pass; failures remain separate artifacts. Local fixture results do not qualify live hosts/accounts, Firefox, other OS targets or owner GUI acceptance.

## Lost-tab lease correction

The production-alarm-verified Chrome run at 703850a created a replacement tab but retained the scheduler lease bound to the old tab ID. Native rejected the replacement heartbeat with Navigation tab mismatch; the project retained its frontier in waiting_browser, with zero resource/HEAD requests or published jobs. This is a failed recovery observation, not acceptance.

The correction verifies the original source session, then uses the existing wait_browser action to release the stale lease before readmission. This action preserves the original discovery time budget; automatic recovery does not use resume. Missing or changed original sessions and native generation refusal retain the frontier without opening a replacement. Deterministic regressions cover these cases. Installed acceptance of the correction remains pending.
