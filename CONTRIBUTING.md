# Contributing

Build and test instructions are in README.md. Public release acceptance and pending requirements are recorded under docs.

- Keep networking, job ownership and durable state outside the webview.
- Include a deterministic regression fixture for changes to transfer, recovery or handoff correctness.
- Preserve browser ownership until a desktop job is durable and its transfer viable.
- Never publish request headers, cookies, signed query strings, private downloads or local paths in diagnostics.
- Keep translations complete across the six supported locales; native-language review is a separate release gate.
- Use original code, text and assets. Submit contributions under GPL-3.0-only.

Before submitting, run cargo fmt, the Rust tests, Clippy, pnpm typecheck, pnpm test and pnpm build. Platform/browser evidence must name the actual target tested.
