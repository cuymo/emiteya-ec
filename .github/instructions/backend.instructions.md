# Backend Instructions

Apply to backend files.

- Keep domain logic framework-free.
- Define application ports before adding infrastructure adapters.
- Validate all external input at the boundary.
- Keep secrets server-side.
- Update API documentation when routes or response shapes change.
- Enforce authorization server-side per record, not only per route.
- Derive identity, tenant, and role from the session, never from the request payload.
- Scope every query on private data by tenant and ownership; a known ID is not authorization.
- Allowlist writable fields; never pass the request body to the ORM.
- Make critical mutations idempotent, deduplicate webhooks, and enforce invariants with database constraints.
- Paginate every list endpoint and never load a relation inside a loop.
- Measure before optimizing, and revert an optimization that does not beat its baseline.

