// Same production worker/resolver/native harness; only the entry scope changes.
process.env.NAV_PRIVATE = '1';
await import('./qualification.mjs');
