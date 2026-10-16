# Installed extension FlareSolverr controls

The NAV01 fixture builds the production background, resolver and popup modules, substituting only its unique native host address. It installs the extension in an isolated Chromium profile and uses actual pointer input on its popup HTML loaded in a separate extension window. Browser toolbar activation and native desktop settings controls remain separate pending gates.

`node scripts/nav-fixtures/challenges/installed-solver-controls.mjs` verifies and copies the immutable native25.1 pair before execution. `NAV_BROWSER` selects Edge; `NAV_NATIVE_PAIR` selects the directory with the exact recorded pair. Settings are seeded through the real isolated native CLI, not claimed as desktop UI acceptance. The local fake solver is only a protocol/controls fixture, never real challenge-clearance evidence.

The gate requires disabled/routing UI refusal, actual Continue, stale-enabled native refusal, typed unsupported CAPTCHA recovery with no file requests, explicit manual retry to a independently hashed desktop file, matching synthetic User-Agent/cookie continuity, owned temporary-session cleanup and zero paid-provider work. Installed execution remains pending until all assertions finish.
