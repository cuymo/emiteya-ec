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

Dos roles por membresía, `ADMIN` y `OPERATOR` (ERS RF-002). El rol global que añade el plugin
admin de Better Auth no concede nada. Toda celda "No" responde `403` en el servidor, y un
usuario de otra empresa responde `404`.

Permisos implementados (cambios `add-user-access`, design D4; `add-taxpayer-setup`, design D10;
`add-fiscal-numbering`, design D10; `add-signing-certificate`, design D10; `add-fiscal-catalogs`, design D12; `add-parties-and-products`, design D12; `add-invoice-emission`, design D14; `add-credit-notes`, design D17; y `add-shipping-guides`, design D24). Son las filas del mapa central `backend/src/modules/identity/domain/access-policy.ts`,
denegado por defecto;
`backend/test/identity/access-policy-doc.test.ts` comprueba que esta tabla coincide con él:

| Permiso | Operación | `ADMIN` | `OPERATOR` |
| --- | --- | --- | --- |
| `account.read` | Consultar la cuenta propia | Sí | Sí |
| `account.changePassword` | Cambiar la contraseña propia | Sí | Sí |
| `account.updateProfile` | Cambiar el nombre propio y cargar o quitar el avatar propio (`redesign-account-profile`) | Sí | Sí |
| `users.read` | Consultar los usuarios de la empresa | Sí | No |
| `users.create` | Crear un usuario | Sí | No |
| `users.changeRole` | Cambiar el rol de otro usuario | Sí | No |
| `users.changeStatus` | Desactivar o reactivar a otro usuario | Sí | No |
| `users.setPassword` | Establecer la contraseña de otro usuario | Sí | No |
| `account.setDefaultEmissionPoint` | Definir el punto de emisión predeterminado propio | Sí | Sí |
| `taxpayer.read` | Consultar los datos tributarios, la versión vigente, el bloqueo de la identidad y el logo | Sí | No |
| `taxpayer.configure` | Registrar o corregir los datos y atributos, y cargar, reemplazar o eliminar el logo | Sí | No |
| `environment.change` | Cambiar el ambiente SRI | Sí | No |
| `establishments.read` | Consultar establecimientos y puntos de emisión | Sí | Sí |
| `establishments.manage` | Crear establecimientos y puntos, corregir la dirección de un establecimiento, y activar y desactivar ambos | Sí | No |
| `readiness.read` | Consultar el ambiente y la preparación para emitir | Sí | Sí |
| `sequences.read` | Consultar los secuenciales por ambiente, punto y tipo | Sí | No |
| `sequences.adjust` | Ajustar el siguiente secuencial de un contador | Sí | No |
| `certificate.read` | Consultar la firma electrónica vigente: titular, emisor, serie, vigencia y RUC | Sí | No |
| `certificate.manage` | Cargar o reemplazar la firma electrónica y fijar la anticipación de su aviso de vencimiento | Sí | No |
| `certificateValidity.read` | Consultar solo la vigencia de la firma (utilizable, por vencer, vencida) | Sí | Sí |
| `fiscalCatalogs.read` | Consultar los catálogos fiscales oficiales, la habilitación de la empresa, la política de consumidor final, el registro de esquemas y la matriz de casos especiales | Sí | Sí |
| `fiscalCatalogs.manage` | Habilitar o deshabilitar entradas de catálogos fiscales para la empresa | Sí | No |
| `parties.read` | Consultar y buscar terceros, incluido el consumidor final | Sí | Sí |
| `parties.manage` | Registrar y corregir terceros (nunca el consumidor final) | Sí | Sí |
| `parties.changeStatus` | Desactivar y reactivar terceros (nunca el consumidor final) | Sí | No |
| `products.read` | Consultar y buscar productos, su estado tributario y sus recuentos | Sí | Sí |
| `products.manage` | Registrar y corregir productos, su precio y sus impuestos | Sí | Sí |
| `products.changeStatus` | Desactivar y reactivar productos | Sí | No |
| `invoices.read` | Consultar y buscar facturas, con su diagnóstico | Sí | Sí |
| `invoices.draft` | Crear, consultar, corregir y eliminar borradores de factura | Sí | Sí |
| `invoices.emit` | Emitir una factura desde un borrador: reserva el número y la firma localmente | Sí | Sí |
| `invoices.retrySigning` | Reintentar la firma de una factura reservada, con el mismo número y la misma clave | Sí | Sí |
| `invoices.reconcile` | Pedir la reconciliación de una factura con el SRI: resolver una revisión manual o reactivar una transmisión detenida, con motivo | Sí | No |
| `archive.read` | Consultar la bandeja de comprobantes, los documentos disponibles de cada uno y su historial de entregas | Sí | Sí |
| `archive.download` | Descargar el RIDE, el XML autorizado y el XML firmado guardados, y solicitar la impresión del RIDE | Sí | Sí |
| `archive.retryRide` | Reintentar la generación detenida del RIDE de un comprobante autorizado que todavía no lo tiene | Sí | Sí |
| `email.configure` | Consultar y cambiar el servidor de correo de la empresa (sin ver nunca la contraseña) y enviar correos de prueba | Sí | No |
| `email.resend` | Enviar o reenviar por correo un comprobante autorizado, con sus direcciones, y ver sus direcciones propuestas | Sí | Sí |
| `inventory.read` | Consultar la lista de inventario, el detalle de un producto y su kárdex | Sí | Sí |
| `inventory.entry` | Registrar una entrada manual de existencias | Sí | Sí |
| `inventory.adjust` | Registrar un ajuste de existencias, positivo o negativo, con motivo | Sí | No |
| `inventory.initialize` | Inicializar el inventario de un producto con su movimiento `INICIAL` | Sí | No |
| `inventory.configure` | Activar o desactivar el control de stock de un producto con inventario inicializado | Sí | No |
| `creditNotes.read` | Consultar y buscar notas de crédito, con su diagnóstico y su transmisión, y el crédito de una factura | Sí | Sí |
| `creditNotes.draft` | Buscar facturas elegibles y crear, consultar, corregir y eliminar borradores de nota de crédito | Sí | Sí |
| `creditNotes.emit` | Emitir una nota de crédito desde un borrador, con las declaraciones de elegibilidad del usuario: reserva el número y la capacidad y la firma localmente | Sí | Sí |
| `creditNotes.retrySigning` | Reintentar la firma de una nota de crédito reservada, con el mismo número y la misma clave | Sí | Sí |
| `creditNotes.reconcile` | Pedir la reconciliación de una nota de crédito con el SRI, con motivo, como la de una factura | Sí | No |
| `debitNotes.read` | Consultar y buscar notas de débito, con su diagnóstico y su transmisión | Sí | Sí |
| `debitNotes.draft` | Buscar facturas elegibles y crear, consultar, corregir y eliminar borradores de nota de débito | Sí | Sí |
| `debitNotes.emit` | Emitir una nota de débito desde un borrador, con la declaración del usuario: reserva el número y la firma localmente | Sí | Sí |
| `debitNotes.retrySigning` | Reintentar la firma de una nota de débito reservada, con el mismo número y la misma clave | Sí | Sí |
| `debitNotes.reconcile` | Pedir la reconciliación de una nota de débito con el SRI, con motivo, como la de una factura | Sí | No |
| `withholdings.read` | Consultar y buscar comprobantes de retención, con su diagnóstico y su transmisión | Sí | Sí |
| `withholdings.draft` | Buscar proveedores, consultar las opciones del catálogo y crear, consultar, corregir y eliminar borradores de retención | Sí | Sí |
| `withholdings.emit` | Emitir un comprobante de retención desde un borrador: reserva el número y lo firma localmente | Sí | Sí |
| `withholdings.retrySigning` | Reintentar la firma de una retención reservada, con el mismo número y la misma clave | Sí | Sí |
| `withholdings.reconcile` | Pedir la reconciliación de una retención con el SRI, con motivo, como la de una factura | Sí | No |
| `shippingGuides.read` | Consultar y buscar guías de remisión, con su diagnóstico y su transmisión | Sí | Sí |
| `shippingGuides.draft` | Buscar transportistas, destinatarios y facturas elegibles con sus mercancías sugeridas, consultar las opciones y crear, consultar, corregir y eliminar borradores de guía | Sí | Sí |
| `shippingGuides.emit` | Emitir una guía de remisión desde un borrador, con la confirmación de las excepciones declaradas: reserva el número y la firma localmente | Sí | Sí |
| `shippingGuides.retrySigning` | Reintentar la firma de una guía reservada, con el mismo número y la misma clave | Sí | Sí |
| `shippingGuides.reconcile` | Pedir la reconciliación de una guía de remisión con el SRI, con motivo, como la de una factura | Sí | No |
| `purchaseSettlements.read` | Consultar y buscar liquidaciones de compra, con sus declaraciones, su diagnóstico y su transmisión | Sí | Sí |
| `purchaseSettlements.draft` | Buscar proveedores, consultar las opciones (política de procedencia, tarifas de IVA y formas de pago) y crear, consultar, corregir y eliminar borradores de liquidación | Sí | Sí |
| `purchaseSettlements.emit` | Emitir una liquidación de compra desde un borrador, confirmando las cuatro declaraciones de procedencia: reserva el número y la firma localmente | Sí | Sí |
| `purchaseSettlements.retrySigning` | Reintentar la firma de una liquidación reservada, con el mismo número y la misma clave | Sí | Sí |
| `purchaseSettlements.reconcile` | Pedir la reconciliación de una liquidación de compra con el SRI, con motivo, como la de una factura | Sí | No |
| `reports.read` | Consultar los cinco reportes (Documentos emitidos, Facturas, Retenciones, Inventario y Clientes y proveedores) con sus filtros, por páginas | Sí | Sí |
| `reports.export` | Exportar un reporte a XLSX con los mismos filtros de su lista; cada exportación generada queda auditada (`report.exported`) | Sí | Sí |
| `dataPortability.export` | Solicitar, listar, consultar y descargar las exportaciones de portabilidad de los datos y artefactos de la empresa; la solicitud, la generación y el inicio de cada descarga quedan auditados (`data_export.*`) | Sí | No |

Nadie cambia su propio rol, se desactiva a sí mismo ni establece su propia contraseña por la vía
de administración (`409`).

Matriz propuesta para los módulos futuros (Q-22). El ERS solo dice "permisos básicos"; cada
cambio confirma las filas de sus propias operaciones al añadirlas al mapa. `add-parties-and-products` confirmó las dos filas de terceros y productos. `add-invoice-emission` confirmó, para la factura, "Crear borradores y emitir" y "Corregir un comprobante con XML inválido" (el reintento de la firma) para ambos roles; `add-sri-transmission` confirmó "Resolver revisión manual u ordenar una reconciliación" solo para el administrador (`invoices.reconcile`); `add-document-archive` confirmó "Consultar la bandeja y descargar XML y RIDE" para ambos roles (`archive.read` y `archive.download`), y bajo esa misma fila el reintento de una generación detenida del RIDE (`archive.retryRide`): solo vuelve a programar el mismo documento que el usuario ya puede descargar, sin efecto fiscal, sin reemplazar un RIDE y sin dejar dos generaciones activas; `add-minimal-inventory` confirmó "Registrar entradas manuales de inventario" (ambos roles) y "Registrar ajustes de inventario" (administrador), y añadió las tres filas del inventario de abajo; `add-credit-notes` confirmó, para la nota de crédito, "Crear borradores y emitir" y "Corregir un comprobante con XML inválido" (el reintento de la firma) para ambos roles, y "Resolver revisión manual u ordenar una reconciliación" solo para el administrador (`creditNotes.reconcile`); `add-debit-notes` confirmó las mismas tres filas para la nota de débito (`debitNotes.*`, con `debitNotes.reconcile` solo para el administrador); `add-withholding-receipts` confirmó las mismas tres filas para el comprobante de retención (`withholdings.*`, con `withholdings.reconcile` solo para el administrador), y crear un proveedor desde la retención usa `parties.manage`; `add-reports-export` confirmó "Ver reportes y exportar XLSX" para ambos roles (`reports.read` y `reports.export`), sin ampliar lo que cada rol ya consulta en los comprobantes, el inventario y los terceros. `add-data-portability` confirmó "Exportar todos los datos del contribuyente" solo para el administrador (`dataPortability.export`): el paquete incluye la configuración, los metadatos de las firmas, los usuarios y la auditoría, que el operador no consulta. `add-email-delivery` añadió el servidor de correo y su correo de prueba solo para el administrador (`email.configure`), y el reenvío del correo de un comprobante autorizado para ambos roles (`email.resend`), como las descargas; el historial de envíos de un comprobante se consulta con `archive.read`. Quien emite una nota confirma sus declaraciones de elegibilidad: son del usuario que emite, sin un permiso aparte:

| Operación                                                    | `ADMIN` | `OPERATOR`        |
| ------------------------------------------------------------ | ------- | ----------------- |
| Gestionar usuarios y roles                                   | Sí      | No                |
| Crear borradores y emitir los seis comprobantes              | Sí      | Sí                |
| Corregir un comprobante devuelto o con XML inválido          | Sí      | Sí                |
| Resolver revisión manual u ordenar una reconciliación        | Sí      | No                |
| Consultar la bandeja y descargar XML y RIDE                  | Sí      | Sí                |
| Crear y editar terceros y productos                          | Sí      | Sí                |
| Desactivar terceros y productos                              | Sí      | No                |
| Registrar entradas manuales de inventario                    | Sí      | Sí                |
| Registrar ajustes de inventario                              | Sí      | No                |
| Consultar el inventario y el kárdex                          | Sí      | Sí                |
| Inicializar el inventario de un producto                     | Sí      | No                |
| Activar o desactivar el control de stock de un producto con inventario | Sí | No       |
| Ver reportes y exportar XLSX                                 | Sí      | Sí                |
| Exportar todos los datos del contribuyente                   | Sí      | No                |
| Ver la auditoría                                             | Sí      | No                |

La marca de control de stock de un producto (`stockTracked`) tiene dueño explícito (design D11 de
`add-minimal-inventory`): mientras el inventario del producto no está inicializado, la cambian el
administrador y el operador con la corrección del producto ("Crear y editar terceros y
productos"). Con el inventario inicializado, solo el administrador, desde el inventario
(`inventory.configure`); la corrección del producto la rechaza con
`409 STOCK_TRACKING_MANAGED_BY_INVENTORY`. El servidor lo aplica en las dos rutas.

El establecimiento y el punto predeterminados de la membresía solo preseleccionan; no
restringen dónde emite el usuario ni introducen autorización por punto (Q-23, resuelta).

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
