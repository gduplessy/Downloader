# NAV-02: scoped sign-in and authenticated refresh

## Outcome and baseline

Detect supported login states, reuse the explicitly selected browser session, optionally fill saved site credentials, and recover expiry/logout without crossing profiles. MFA remains a visible browser step. Existing keyring helpers store generic credentials; they do not implement host-specific form automation or scoped account lifecycle.

Owner: batch D. Dependencies: NAV-05/06 adapters and NAV-09/11 ownership. Shares account modules with NAV-03.

## Implementation increments

1. Define account metadata keyed by exact permitted origin/provider, account ID and session scope. Keep passwords/API tokens in the OS credential store; persist only references and nonsecret labels. Add create/select/remove and scope-validation commands to the desktop-only account boundary.
2. Add adapter login-state signals: signed out, authenticated, expired, MFA required, rejected credentials, and unknown. Prefer the existing selected browser session; request saved-credential fill only through an explicit user setting and an owned, validated login form.
3. Fill and submit once in the owning tab. Revalidate origin, adapter version and generation immediately before fill; never inject into unrelated frames, redirects, hidden forms, or unsupported forms. Stop for MFA/challenge and resume through Continue.
4. Implement expiry/logout invalidation, bounded refresh, selected-session switching and removal. Source refresh must preserve engine revision checks; no incompatible partial-data merging.
5. Add account controls and session/recovery state in desktop/extension UI, including all six locales and keyboard focus. Do not expose generic keyring read access to extensions.

## Tests and acceptance

- Fixtures cover wrong passwords, MFA, redirects to another origin, logout, expired cookies, removed credentials, user cancellation, and repeated worker events.
- Two accounts/profiles/containers with identical cookie names never share credentials or session material.
- An authenticated fixture produces a hash-verified file; expiry yields a scoped browser refresh or explicit user action, never an unlimited login loop.
- Keyring create/read/delete works on tested native targets; fake keyring unit tests alone do not establish platform acceptance.
- Supported live hosts receive explicit login-adapter matrix rows. Unknown forms remain manual with a precise reason.

## Scope boundary

No password/MFA collection in chat, automatic premium purchase, generalized arbitrary login automation, or hidden session export. Provider APIs are an extension of NAV-03 after provider qualification. See [execution requirements](README.md).
