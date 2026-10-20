# Verified empty browser streams

Native source ca7927bb62d9bdc2802f03b11bfe8eacf3b49a39 (0.39.0), development build. Exact immutable service SHA256 d0cf3deb2d26b7d4957d3f1177252841af747abd557d95fb6c1f1c517c8c3c95 and CLI SHA256 64f79ae41c0596712e6ff44ca00098f8eb8983ea64d98de0a11d924a5f080650 are checked before copying and after each run. Installed extension/driver source aaa278aaaa7e7024f4badc230e2127e92f876d9d (0.39.2).

Actual installed Windows Chrome155, Edge155 and Firefox158 regular-profile Blob runs completed with observed terminal exit0. Each publishes zero bytes, reports native total0 and verifies empty SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. These exercise unknown-length admission followed by zero EOF. Native tests also cover explicit total0, no publication before EOF, checksum mismatch, foreign/stale identity, trailing bytes and idempotent EOF across restart. Full core158 tests pass with1 existing ignored test; strict core Clippy/format checks pass.

The initial Chrome pre-preview failure is retained in task-local artifacts and was not counted as native zero-path evidence. Source/runtime tracing is disabled in accepted runs. Live hosts/accounts, private/container/ESR/otherOS and Firefox binary form-navigation remain separate pending rows. This is completion correctness, not a large-transfer throughput or peak-memory qualification.
