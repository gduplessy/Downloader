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
