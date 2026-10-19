# Edge original POST reader idle acceptance

Installed Edge 155.0.4283.62 on Windows, exact extension/driver source 605c61fbe89360a8bd4a1ee90e407b5da917d26e (0.37.1), matching immutable native 3b808ae (0.25.1). Driver terminated successfully. The JSON retains full native/CLI/driver/source graph provenance.

The original POST delivered a 196608-byte durable prefix, paused upstream for 60065 milliseconds after that prefix was observed, then completed 8388625 bytes. Native verified SHA256 c454f05473a97ef2f7a2c8d9ec8d08bc0de4268315e2c77ea6f16f7b91894a27 matches the independently generated payload. Exactly one original POST, no replay or HEAD request. No driver attachment to the capture target and no file-byte relay through CDP.

The initial 0.37.0 fixture attempt failed before transfer because its historical manifest omitted webNavigation. The corrected isolated fixture declares and verifies current navigation permissions; no product authorization changes. Runtime permission prompts, owner GUI controls, other stream/context lanes, live hosts/accounts and peak-memory bounds remain separate gates.

## Larger Chrome diagnostic remains pending

Two subsequent 67108881-byte Chrome runs at4bb588f retained the original response and one POST through the sixty-second idle, but remained browser_downloading at total fixture deadlines of150 and300 seconds (58589184 and56229888 durable bytes respectively). Neither completed its final hash gate. The retained negative JSON records are diagnostic evidence, not accepted large-transfer completion or a peak-memory bound. This needs throughput/deadline investigation before the larger lane can be qualified.
