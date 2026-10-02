# Access Control

Design the backend on the premise that the frontend is fully controlled by an attacker. Any
request can be edited by hand, replayed from curl, sent twice, or sent concurrently, and
every value in it can be changed.

Knowing an identifier is never authorization. An ID, UUID, slug, URL, transaction
reference, organization ID, or file ID proves only that the caller has seen it, not that the
caller may use it. Every access to private data is validated explicitly against the
authenticated identity and its authorization context.

When a convenient option competes with a slightly more complex secure one, choose the
secure one. Never trade data isolation for simpler code.

## Four Different Questions

| Question          | Meaning                                         | Answered by                                   |
| ----------------- | ----------------------------------------------- | --------------------------------------------- |
| Authentication    | Who is the caller?                              | Better Auth session, through auth middleware  |
| Authorization     | What may the caller do?                         | Server-side role and permission policy        |
| Ownership         | Which records may the caller act on?            | A scoped query against the server context     |
| Tenant isolation  | Whose account data may the caller see at all?   | The tenant filter on every private query      |

Passing one check never implies another. An authenticated admin of tenant A has no
ownership of any record in tenant B.

## Identity Comes From The Server

- Authenticate before anything else touches the request.
- Derive user, tenant, and role only from the validated session or the server-side membership record.
- Never decide permissions from a `userId`, `accountId`, `tenantId`, `organizationId`, `role`, or equivalent sent by the client.
- When the server can derive a value, ignore or reject the client-supplied copy.
- When a user belongs to several tenants, the tenant the client selects is a request for a context. Verify membership on every request before using it.

```ts
// Wrong: the client chooses whose data this is.
const accountId = req.body.accountId;

// Right: the authenticated context decides.
const accountId = req.auth.accountId;
```

Use cases receive this context as plain data, as `../architecture/backend.md` requires. They
never read identity from the request payload.

## Object-Level Authorization

Endpoint-level checks are not enough. A route guarded by authentication still serves every
record whose ID the caller can type. Authorize each object.

Scope the query itself. Never fetch by ID first and rely on the frontend not to display the
result.

```ts
// Wrong: any authenticated user can read any invoice by changing the ID.
const invoice = await prisma.invoice.findUnique({
  where: { id: req.params.invoiceId },
});

// Right: the record must belong to the caller's account, or it does not exist.
const invoice = await prisma.invoice.findFirst({
  where: { id: req.params.invoiceId, accountId: req.auth.accountId },
});
```

Rules:

- Check ownership for every verb and side door: read, create, update, delete, download, export, share.
- Check every referenced ID in a payload too. Creating a task with a `projectId` from another tenant is cross-tenant access through a foreign key.
- Mutate through the same scope: `update` and `delete` filter by tenant as well as by ID, so a record outside the scope fails as not found.
- Prefer a centralized, tenant-aware repository or policy layer so the scope cannot be forgotten in one handler.

Ownership checks matter most on files, private images, documents, orders, invoices, payments,
messages, conversations, reports, projects, API keys, settings, integrations, logs, exports,
and backups.

A UUID is not authorization, and an unguessable URL is not access control.

## Tenant Isolation

When the application serves several accounts, companies, organizations, workspaces, or
tenants, data isolation is an architectural requirement, not a feature.

- Every tenant-owned table carries an explicit tenant column. Pick one name per project, such as `tenant_id`, `organization_id`, `account_id`, or `workspace_id`, and use it everywhere.
- Every query on private data filters by that column, and its value comes from the authenticated server context.
- Make the unscoped query hard to write: repository methods for tenant-owned data require the tenant context as a parameter, and no `findById(id)` exists for them.

```sql
-- Wrong
SELECT * FROM documents WHERE id = $1;

-- Right
SELECT * FROM documents WHERE id = $1 AND tenant_id = $2;
```

Add defense in depth where the risk justifies it:

- composite indexes and uniques that lead with the tenant column, such as `(tenant_id, id)`;
- composite foreign keys, such as `(tenant_id, project_id) -> projects (tenant_id, id)`, so a child row cannot reference another tenant's parent;
- PostgreSQL Row-Level Security, with the tenant set per transaction and never per pooled connection;
- authorization middleware and tenant-scoped ORM extensions;
- access auditing, as described in `../quality/observability.md`.

See `../architecture/database.md` for the constraints themselves.

## Roles And Permissions

When roles exist, such as `owner`, `admin`, `manager`, `member`, and `viewer`, map them to
explicit permissions in one server-side policy, and check the permission for every sensitive
operation.

- Deny by default. An operation without an explicit rule is forbidden.
- Read the role from the server-side membership, not from the request.
- Prevent vertical escalation: nobody grants a role above their own, and nobody changes their own role.
- Prevent horizontal escalation: a permission applies inside the caller's tenant and its own records only.
- Hiding a button is presentation, not security. The frontend `PermissionGate` only mirrors what the API enforces.

### Roles de este producto

Matriz propuesta para Q-22. El ERS solo dice "permisos básicos"; la matriz no es definitiva
hasta que se acepte en el cambio `add-user-access`. Toda celda "No" responde `403` en el
servidor.

| Operación                                                    | `ADMIN` | `OPERATOR`        |
| ------------------------------------------------------------ | ------- | ----------------- |
| Configurar empresa, atributos tributarios y logo             | Sí      | No                |
| Cambiar el ambiente                                          | Sí      | No                |
| Gestionar establecimientos y puntos de emisión               | Sí      | No                |
| Ajustar secuenciales                                         | Sí      | No                |
| Cargar o reemplazar el certificado                           | Sí      | No                |
| Ver el estado de preparación para emitir                     | Sí      | Sí                |
| Ver metadatos del certificado                                | Sí      | Solo su vigencia  |
| Gestionar usuarios y roles                                   | Sí      | No                |
| Crear borradores y emitir los seis comprobantes              | Sí      | Sí                |
| Corregir un comprobante devuelto o con XML inválido          | Sí      | Sí                |
| Resolver revisión manual u ordenar una reconciliación        | Sí      | No                |
| Consultar la bandeja y descargar XML y RIDE                  | Sí      | Sí                |
| Crear y editar terceros y productos                          | Sí      | Sí                |
| Desactivar terceros y productos                              | Sí      | No                |
| Registrar entradas manuales de inventario                    | Sí      | Sí                |
| Registrar ajustes de inventario                              | Sí      | No                |
| Ver reportes y exportar XLSX                                 | Sí      | Sí                |
| Exportar todos los datos del contribuyente                   | Sí      | No                |
| Ver la auditoría                                             | Sí      | No                |

El establecimiento y el punto predeterminados solo preseleccionan; no restringen dónde emite
el operador (Q-23).

## Mass Assignment

Never pass the client payload straight to the ORM.

```ts
// Wrong: the caller can also send role, isAdmin, tenantId, or balance.
await prisma.user.update({ where: { id }, data: req.body });

// Right: parse an allowlist of editable fields and reject anything else.
const ProfileUpdate = z
  .object({ firstName: z.string().max(80), lastName: z.string().max(80), avatar: z.string().url() })
  .partial()
  .strict();

await prisma.user.update({
  where: { id: req.auth.userId },
  data: ProfileUpdate.parse(req.body),
});
```

Fields such as `role`, `isAdmin`, `permissions`, `tenantId`, `accountId`, `ownerId`,
`balance`, lifecycle status, and audit timestamps are never client-writable. They change only
through the workflow that owns them.

## Do Not Leak Existence

- A record outside the caller's tenant answers `404 Not Found`, exactly as if it did not exist.
- Inside the tenant, `403 Forbidden` is acceptable when the caller may know the record exists. For highly sensitive resources, answer `404` there too.
- Keep messages and timing uniform where they could reveal accounts or records.
- Error responses never carry debug detail, internal identifiers, stack traces, secrets, or another account's data.
- Sequential identifiers make enumeration trivial. Prefer non-sequential public identifiers, and authorize anyway.

## Downloads And Signed URLs

- Download and export routes authorize ownership like any other read.
- Generate a signed URL only after verifying ownership.
- Keep its lifetime short and its scope to one object and one operation.
- Never issue long-lived or reusable signed URLs, and never log them; a signed URL is a bearer credential.

## Review: Patterns To Hunt

Search proactively for:

- `findUnique({ where: { id } })`, `update({ where: { id } })`, or `delete({ where: { id } })` on tenant-owned data without a tenant filter;
- `req.body.userId`, `req.body.accountId`, `req.body.tenantId`, or `req.query.role` used to decide access;
- `GET`, `PATCH`, or `DELETE /resource/:id` handlers without an ownership check;
- `data: req.body` or a spread of the payload into a create or update;
- permission checks that exist only in the frontend;
- download routes or signed URL generators that skip ownership.

## Reject The Change When

- a private record is looked up by a client-supplied identifier alone;
- identity, tenant, or role is read from the request instead of the server context;
- a client payload reaches the ORM without an allowlist;
- a permission is enforced only in the interface;
- a new private endpoint has no cross-tenant or foreign-ID test;
- an authorization check was removed or loosened to make a test pass.

## Verification

- [ ] Identity, tenant, and role come only from the authenticated server context.
- [ ] Every private query is scoped by tenant and ownership, including updates and deletes.
- [ ] Every referenced ID in a payload is verified against the caller's tenant.
- [ ] Roles map to explicit permissions, denied by default, checked per operation.
- [ ] Writable fields are an explicit allowlist.
- [ ] Records outside the tenant are indistinguishable from missing ones.
- [ ] Downloads and signed URLs verify ownership, expire quickly, and are scoped to one object.
- [ ] The access tests in `../quality/testing.md` exist and pass.
