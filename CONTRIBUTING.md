# Contributing

Build and test instructions are in README.md. Public release acceptance and pending requirements are recorded under docs.

- Keep networking, job ownership and durable state outside the webview.
- Include a deterministic regression fixture for changes to transfer, recovery or handoff correctness.
- Preserve browser ownership until a desktop job is durable and its transfer viable.
- Never publish request headers, cookies, signed query strings, private downloads or local paths in diagnostics.
- Keep translations complete across the six supported locales; native-language review is a separate release gate.
- Use original code, text and assets. Submit contributions under GPL-3.0-only.

Before submitting, run cargo fmt, the Rust tests, Clippy, pnpm typecheck, pnpm test and pnpm build. Platform/browser evidence must name the actual target tested.

## Versioning

- Use `0.MINOR.PATCH`. Major remains `0` until all supported IDM parity workflows and platform acceptance gates are complete.
- Bump minor and reset patch for substantial functionality, architectural changes, or UI changes. Bump patch for fixes, maintenance, or documentation-only changes.
- Each focused change commit increments the product version. Update README, roadmap status, and CHANGELOG in the same commit; do not rewrite historical commits to add version bumps.
- Run `pnpm version:set 0.2.1` with the next appropriate version. Cargo workspace metadata is the source of truth; the script synchronizes Cargo.lock, npm packages, Tauri, README, and roadmap.
- Extension manifests read their package version at build time; the libcurl User-Agent reads the Rust package version at compile time. Wire protocol and database migration versions are independent.
- Run `pnpm version:check` before committing. CI also checks generated Chromium/Firefox manifest versions after building.
