# Capture and destination setup controls

The extension options page reports Blob and original-response API/scope/permission/opt-in readiness for a requested site. Readiness is checked again at capture admission. Firefox page-owned response support remains distinct from pending binary navigation capture. Destination reads report the desktop default; category rules and existing job paths remain authoritative.

The fixed destination setup request carries only a UUID and expiry (maximum 15 seconds). Queue insertion and one-use consumption persist atomically across restarts. Browser event projections exclude setup events, and native browser callers cannot consume setup requests or mutate desktop settings. The running desktop consumes before showing its existing window and focusing the destination field. The extension reports queued rather than claiming focus succeeded.

Automated coverage includes localized DOM status and fixed RPC shape, stale status clearing and offline controls, readiness states, frontend expiry/replay rejection, native expiry and duplicate consumption, persistence across restart, and browser projection/allowlist boundaries. No installed UI, keyboard/screen-reader, private/context matrix, live host/account, or paid-provider acceptance is claimed by this change.
