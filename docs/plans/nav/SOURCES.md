# Verified API constraints

Checked on 2026-10-11 with gstack `/browse`. These document API design constraints; they are not proof that a Downloader extension successfully captures any particular browser/download lane. Recheck against the actual tested browser versions during implementation.

## Chromium

- Chrome's permissions documentation excludes `debugger` from permissions that can be requested optionally. The owner selected one build declaring it at installation and keeping the capture feature off by default. [Chrome permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- The debugger transport exposes the Fetch and IO domains. It targets tabs/related targets and reports detach; opening DevTools can terminate attachment. Enterprise policies can refuse attachment. Scope capture to owned tabs rather than unrelated browsing. [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- `Fetch.takeResponseBodyAsStream` requires a response paused at HeadersReceived and returns a sequential stream. After taking it, the original request cannot simply continue; the client must cancel it or provide response bytes. Avoid full-body string buffering and do not assume browser fallback survives takeover. [DevTools Fetch domain](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#method-takeResponseBodyAsStream)

## Firefox

`webRequest.filterResponseData` returns a response stream filter; the extension must write and close or disconnect it. Required permissions include `webRequest`, `webRequestBlocking` and relevant host access. MV3 and service-worker-script interception have additional version-specific permissions. The current Downloader Firefox manifest is MV2; changing manifest versions is separate work. [Mozilla filterResponseData API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData)

## 2Captcha

CoordinatesTask accepts base64 JPEG/PNG/GIF images up to 600 kB and 1000 pixels per side, with optional instructions/click constraints. Task creation and result polling are separate operations; results include coordinates and cost. These compatibility fields do not demonstrate actual server-side challenge acceptance or establish a measured price. Tests in this run use a mock provider because the owner selected a $0 live budget. [Official CoordinatesTask API](https://2captcha.com/api-docs/coordinates)
