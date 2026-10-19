# Targeted private authority reads

Private stream frames still validate current tab/store/partition, resolver scope, source and claim authority on each frame. Targeted navigation-storage reads now request only each key and its private-nav prefixed counterpart, rather than cloning the entire session store twice. Full enumeration is retained only for explicit all-record reads.

Regressions cover string, array and defaults-object requests with 2000 unrelated private records; targeted reads are forbidden from requesting all records. Prefixed current records retain precedence over marked legacy records, unmarked legacy primitives stay excluded, and no durable local writes occur. A separate full-enumeration regression preserves legacy filtering and private primitive identities. All three targeted cases fail on prior main4deafc1.

This establishes bounded key retrieval for requested authority, not a measured large-transfer throughput improvement or a global memory bound. No ownership result is cached, and no native durability or browser authority fence is removed. Installed private/context and large-transfer performance matrices remain separate acceptance gates.
