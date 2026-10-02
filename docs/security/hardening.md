# Security Hardening

`principles.md` states why. `threat-model.md` states what is defended against. This document
states which controls to implement at each boundary. `access-control.md` specifies
object-level authorization and tenant isolation in depth.

## Untrusted Input

Everything crossing a boundary is untrusted until validated: HTTP params, query, body and
headers, environment variables, external API responses, webhooks, uploaded files, background
job payloads, imported files, and configuration.

- Validate shape, type, range, and length at the boundary, before the value reaches business logic.
- Validate environment variables at startup and refuse to start when a required one is missing or malformed.
- Reject unknown fields when the contract is closed, instead of ignoring them.
- Allowlist the fields a client may write, so privileged fields such as role, tenant, or balance cannot ride along. See `access-control.md`.
- Normalize and re-validate values that were stored earlier by an untrusted source.
- Return a business message on failure and keep the diagnostic detail in logs.

## Injection

- Use the ORM's parameterized queries. Never build SQL by string concatenation.
- Isolate, document, and parameterize any raw query.
- Never interpolate user input into shell commands, file paths, or expressions evaluated at runtime.
- Canonicalize and verify any user-influenced path before touching the filesystem.
- Constrain user-supplied sort fields, filter fields, and column names to an allowlist.

## Output

- Encode values that reach HTML; prefer rendering text over trusted-HTML injection.
- Sanitize any rich content that must render as markup.
- Set a Content Security Policy and the standard security headers.
- Sanitize errors that reach the client. See `../architecture/feedback-and-states.md`.

## Authentication And Authorization

- Enforce authorization server-side on every protected route. The frontend gate is presentation only.
- Check ownership, not only identity: confirm this user may act on this specific record.
- Derive user, tenant, and role from the session, never from the request. See `access-control.md`.
- Deny by default; a route without an explicit rule is closed.
- Rate limit authentication, password reset, and expensive or enumerable endpoints.
- Keep session cookies HTTP-only, Secure, and same-site.
- Do not leak account existence through differing error messages or response timing.
- Invalidate the server session on logout and on credential change.

### Valores por defecto del proyecto

Las specs exigen la garantía; los valores son configuración técnica. No provienen del ERS ni
de CTX, y se cambian sin modificar las specs. La interfaz no fija la política de contraseñas: solo exige que el
campo no esté vacío y muestra el mensaje del servidor, que indica la longitud vigente en el alta,
en la contraseña establecida por un administrador y en el cambio de la propia. El estado de ambos límites de inicio de sesión
vive en memoria y solo es válido con una instancia de API (`../architecture/deployment.md`).

| Control | Default propuesto | Configurable | Origen de la garantía |
| --- | --- | --- | --- |
| Política de contraseñas | 12 a 128 caracteres, sin reglas de composición, pegado permitido | Sí, mínimo y máximo | CognitiveStack (`authentication.md`, `navigation-responsive.md`); hash de ERS SEC-001 |
| Límite de inicio de sesión por correo e IP | 5 intentos fallidos cada 15 minutos; un inicio correcto reinicia el contador | Sí, intentos y ventana | CognitiveStack ("Rate limit authentication") |
| Límite de inicio de sesión por IP | 30 peticiones por minuto, solo contra ráfagas y tolerante a oficinas detrás de NAT | Sí, peticiones y ventana | CognitiveStack; ajuste derivado del spike S-1 |

## Secrets

- Never in code, logs, error messages, client bundles, or version control.
- Only variables explicitly intended to be public may reach the browser.
- A leaked secret is rotated, not merely deleted in a later commit.
- Keep production credentials at least privilege after provisioning.

## File Handling

- Validate type, size, and content server-side; client-side checks are early feedback only.
- Generate the stored filename; never trust the name supplied by the client.
- Store outside the served root or in object storage, never at a client-controlled path.
- Authorize every read as well as every write.
- Enforce per-user and total size limits.
- Keep storage paths, buckets, and provider names out of responses and the interface.

## Dependencies And Supply Chain

- Prefer the standard library or an existing utility. Every dependency is a liability.
- Verify the exact package name before installing; typosquatting relies on a glance.
- Audit for known vulnerabilities and check that the package is still maintained.
- Confirm the license is compatible before adopting.
- Commit the lockfile and review its diff; a single direct bump can pull in many indirect changes.
- Treat an unmaintained dependency on a security-relevant path as a finding.

## Logging

- Never log passwords, tokens, cookies, full auth headers, or full sensitive payloads.
- Include a correlation identifier so an error reported to a user can be traced.
- Log authorization failures and suspicious input, and keep them reviewable.

## Verification

- [ ] Every new boundary validates its input before use.
- [ ] No query, path, or command is built by concatenating user input.
- [ ] Every protected route enforces authorization and record ownership server-side.
- [ ] No secret reaches code, logs, responses, or the client bundle.
- [ ] Uploads validate server-side, store a generated name, and authorize reads.
- [ ] New dependencies were verified, audited, and justified, with the lockfile committed.
- [ ] Errors returned to users are sanitized and diagnostics stay in logs.
