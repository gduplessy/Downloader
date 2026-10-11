# NAV adapter qualification evidence

Local fixtures qualify the bundled selection contract. They do not qualify live provider layouts, installed-extension/native handoff, or desktop byte storage.

- Browser: Headless Chromium 149.0.7827.55 (Chrome for Testing), Windows 11 Pro 10.0.26100 x64.
- Adapter revision: bundled source 1.0.0, based on implementation commit `386a213`; the final 0.6.3 qualification increment adds explicit empty-layout recovery. Exact tested source files are hashed in `qualification.json`.
- Synthetic DOM/request suite: 120 checks passed across g4u, ddownload, Rapidgator and Gofile templates. Actual selected DOM clicks drive an in-page fetch bridge, preserving request method/filename and response bytes for SHA-256 validation.
- Synthetic HTTP fixtures: 72 page cases and eight verified file requests. GET redirects and one-use POST replay refusal passed.
- Expected response SHA-256: `75737f26e923cdcb29cf17e4b02c5a3697b15b91b3c9d6c6cdf6ff73982ce483`.
- Keyboard ArrowDown/Tab/Enter selected the intended fixture control; same-HTML replacement required refresh. English and Arabic RTL screenshots were inspected.
- Live host/account acceptance, stable Chrome/Edge/Firefox/ESR, other native platforms and combined worker ownership/desktop-transfer acceptance remain pending.

Reproduce using the commands in [adapter maintenance](../../ADAPTERS.md). The JSON record distinguishes the selected synthetic host label from the actual loopback transport host.
