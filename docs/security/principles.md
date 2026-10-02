# Security Principles

- Design the backend as if the frontend were fully controlled by an attacker.
- Knowing an identifier is never authorization. Scope every private query by tenant and ownership.
- Derive identity, tenant, and role from the session, never from the request.
- Make every critical side effect idempotent, and enforce critical invariants in the database.
- Secrets are never committed.
- Provider tokens stay server-side.
- Validate input at every boundary.
- Use least-privilege credentials in production.
- Do not expose internal provider details unless users need them.
- Authentication and authorization must be explicit on protected routes.
- Avoid storing sensitive data unless there is a clear product need.
- Use Better Auth instead of custom auth primitives.
- Store sessions in the configured Better Auth persistence layer.
- Use PostgreSQL credentials with the minimum privileges needed after migrations.
- Use HTTP-only cookies for sessions.

## Environment Variables

Document required variables in the app repo, not in this template.

Use placeholders only:

```text
SERVICE_API_TOKEN=replace-with-token
DATABASE_URL=replace-with-url
```
