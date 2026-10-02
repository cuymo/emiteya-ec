---
name: harden-security
description: Use when adding or changing a boundary that handles untrusted input, authentication, authorization, tenant data, secrets, file uploads, webhooks, external services, or side effects that must not repeat. Also use when reviewing a change for security defects.
---

# Harden Security

## Context To Load

Read:

- `docs/security/hardening.md`
- `docs/security/access-control.md`
- `docs/architecture/idempotency.md`
- The sensitive operation section of `docs/architecture/backend.md`.
- `docs/security/principles.md`
- `docs/security/threat-model.md`
- `docs/architecture/authentication.md` for auth work.
- The OpenSpec change being implemented, for the permissions the product requires.

## Workflow

1. Answer the sensitive operation brief in `docs/architecture/backend.md` before writing code.
2. List the boundaries the change touches: HTTP, environment, tenant, database, auth, files, webhooks, external services, background jobs.
3. For each boundary, name what is untrusted and where it is validated.
4. Confirm identity, tenant, and role come from the session, and every private query, including updates, deletes, and referenced IDs, is scoped by tenant and ownership.
5. Confirm writes accept only allowlisted fields.
6. Decide how each side effect is idempotent, and confirm critical invariants are database constraints.
7. Confirm secrets stay server-side and out of code, logs, responses, and the client bundle.
8. Confirm errors reaching the user are sanitized, records outside the tenant answer `404`, and diagnostics stay in logs.
9. Add the access control and idempotency tests from `docs/quality/testing.md`, covering rejection paths and not only accepted ones.
10. Report in the format of `docs/architecture/backend.md`, including residual risk and risks found in existing code.

## Guardrails

- Do not trust a frontend check as authorization.
- Do not look up a private record by a client-supplied identifier alone.
- Do not read identity, tenant, or role from the request.
- Do not pass a client payload to the ORM.
- Do not ship a critical mutation that can run twice, or an idempotency check that reads before it claims.
- Do not loosen an authorization check or a constraint to make a test pass.
- Do not build queries, paths, or commands by concatenating user input.
- Do not accept an identifier from the client without verifying the caller may act on that record.
- Do not return provider payloads, stack traces, storage paths, or secret references.
- Do not add a dependency without verifying its name, maintenance, vulnerabilities, and license.
- Do not implement custom authentication primitives when the documented provider covers the need.
- Do not silence a security finding by narrowing its test.
