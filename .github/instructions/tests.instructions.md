# Test Instructions

Apply to test files.

- Cover risky behavior and cross-boundary contracts.
- Prefer focused tests for narrow changes.
- Add broader tests when shared behavior or user workflows change.
- Test error states, validation, auth, and permissions.
- For private endpoints, cover cross-tenant access, ID tampering, and mass assignment, with at least two tenants in the fixtures.
- For critical mutations, cover repeated, concurrent, and cross-tenant uses of the same idempotency key.

