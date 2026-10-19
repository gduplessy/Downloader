# Final installed Firefox host guard

Exact extension source: d37f26a2bd0c544e009c2a700fb8453fe03f803b (0.33.17), Firefox 158 on Windows. Matching immutable native source: 3b808ae1967a210fc5b3a3e461488b9f2ab6cb61 (0.25.1). The JSON records retain driver and binary hashes.

- Fresh: one accepted gofile CAPTCHA POST and one original file GET, no HEAD; 253952 bytes, SHA256 3956ab3c089f6def510fd6fafb24e11c5a6a0ddc8a521c99994746ee3756bc51.
- Replaced host input: actual visible expired/unsupported refusal, WaitingUser, zero bytes and no challenge POST.
- Both runs verify native FormData(form, submitter) includes the named successful submitter, unlike FormData(form).

Records were recovered from completed driver JSON logs after the coordinating agent interruption. Prior records keep their original revision. These local fixtures qualify the supported original page-fetch-to-owned-Blob path. Firefox binary navigation capture, live accounts/hosts, private/ESR and other platforms remain pending.
