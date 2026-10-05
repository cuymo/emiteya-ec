# Idempotency And Concurrency

Users double-click, browsers retry, mobile clients reconnect, proxies resend, webhooks arrive
twice, and jobs run more than once. An operation that is not idempotent will eventually run
twice, and every critical non-idempotent operation is a duplicate effect waiting to happen.

An idempotent operation produces its effect once, however many times the same request
arrives.

## Which Operations Need It

`GET`, `PUT`, and `DELETE` are idempotent by HTTP definition, and the implementation must keep
that promise. `POST` and `PATCH` are not; they need an explicit design whenever repeating
them would duplicate an effect:

- creating payments, charges, or refunds;
- processing or confirming orders and purchases;
- recording financial movements, granting credits, or consuming balance;
- creating reservations or invoices;
- sending webhooks, emails, or notifications;
- processing callbacks and inbound webhooks;
- executing jobs;
- creating any resource from an action the user might repeat.

The design of each OpenSpec change declares, for each mutation, whether it is idempotent and
by which mechanism.

## Prefer Natural Idempotency

Before adding a key, check whether the operation can be idempotent by construction.

| Mechanism                | Example                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Set state, not deltas    | `PUT` the full desired value instead of incrementing it                                          |
| Guarded state transition | `UPDATE orders SET status = 'paid' WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`      |
| Unique natural key       | `UNIQUE (tenant_id, external_payment_id)` turns a duplicate into a conflict, not a second row    |
| Conditional arithmetic   | `UPDATE accounts SET balance = balance - $3 WHERE id = $1 AND tenant_id = $2 AND balance >= $3`  |

Check the affected row count of every guarded update. Zero means the precondition no longer
held, and the operation must not report success.

Natural mechanisms live in the database, so they survive restarts, concurrency, and every
client. Use an idempotency key when the operation has no natural key, such as creating a new
payment.

## Idempotency Keys

The client sends a key with the non-idempotent request:

```http
POST /api/payments
Idempotency-Key: 9f1c4b7e-2d1a-4c55-9a0e-7f3b2c1d8e60
```

The server stores the outcome under that key. When the same operation arrives again, it
returns the stored outcome instead of executing again.

### Scope

A key only means something inside its context. Store and look it up by:

```text
tenant_id + user_id + operation + idempotency_key
```

Never use a key as a global identifier. Two users, or two tenants, may legitimately send the
same value.

### Claim Before Executing

Check-then-act races:

```text
find key
if not found:
    execute operation
    save key
```

Two simultaneous requests both pass the check, and both execute. Claim the key atomically
first, then execute only if the claim succeeded:

```sql
INSERT INTO idempotency_records (tenant_id, user_id, operation, key, request_hash, status)
VALUES ($1, $2, $3, $4, $5, 'processing')
ON CONFLICT (tenant_id, user_id, operation, key) DO NOTHING
RETURNING id;
```

Only the request whose insert returned a row executes. Every other request reads the
existing record.

```prisma
enum IdempotencyStatus {
  PROCESSING
  COMPLETED
}

model IdempotencyRecord {
  id           String            @id @default(cuid())
  tenantId     String
  userId       String
  operation    String
  key          String
  requestHash  String
  status       IdempotencyStatus @default(PROCESSING)
  responseCode Int?
  responseBody Json?
  createdAt    DateTime          @default(now())
  expiresAt    DateTime

  @@unique([tenantId, userId, operation, key])
  @@index([expiresAt])
}
```

With Prisma, the claim is a `create` that treats the unique violation `P2002` as "already
claimed", or the raw `INSERT ... ON CONFLICT DO NOTHING` above.

### Replay Rules

| When the key already exists           | Response                                                      |
| ------------------------------------- | ------------------------------------------------------------- |
| Same payload, completed               | The stored status and body; nothing executes again            |
| Same payload, still processing        | `409 Conflict` with a retry hint; nothing runs concurrently   |
| Different payload                     | `422 Unprocessable Content`: the key was reused inconsistently |
| Same value, other tenant or user      | Invisible: the scoped lookup treats it as a new key           |

Detect a different payload by hashing the validated, canonicalized payload at claim time and
comparing on replay. Never silently execute a different request under a used key.

An operation the API declares as requiring a key rejects a request without one with
`400 Bad Request`. It never falls back to running unprotected.

### Completing The Record

- When the effect is a database write, commit the effect and mark the record completed in the same transaction.
- When execution fails before any effect is committed, release the claim so a retry can run.
- When the operation reached a definitive business outcome, including a rejection, store it and replay it.
- Keep records for a declared window, such as 24 hours, then purge them. State the window in the API contract.

### Keys Never Cross Accounts

A key never grants access to another account's result. If a user in tenant A creates a
transaction with `Idempotency-Key: abc123`, and a user in tenant B later sends `abc123`,
tenant B must never receive tenant A's result.

```text
Right:  WHERE tenant_id = :currentTenant AND user_id = :currentUser AND key = :providedKey
Wrong:  WHERE key = :providedKey
```

The tenant and user in that filter come from the session, as `../security/access-control.md`
requires.

### Client Responsibilities

- Generate one key per user intent with `crypto.randomUUID()` when the submission starts.
- Reuse that key for automatic retries and for retrying the same failed attempt.
- Generate a new key when the user changes the payload or starts a new intent.
- Let the shared mutation helper own this; see `feedback-and-states.md`.

Disabling a button prevents most double clicks. Only the server guarantees a single effect.

### En este proyecto: emisión de facturas (Q-30)

`add-invoice-emission` (design D8) implementa la primera operación con clave de idempotencia:
`POST /api/v1/invoices`, operación `invoice.emit`. Se aparta de la plantilla anterior donde Q-30
lo decidió:

| Tema | Plantilla | Este proyecto |
| --- | --- | --- |
| Alcance | Tenant, usuario, operación y clave | Empresa, operación y clave, sin usuario. La empresa sale del contexto autenticado, nunca del cliente. El efecto (un número del contador de la empresa) es de la empresa: otro usuario de la misma empresa que repite la clave con la misma solicitud recibe la misma factura. |
| Reclamo | Registro `PROCESSING` antes de ejecutar | Sin estado `PROCESSING`. El registro se inserta en la misma transacción que la reserva del número (paso 9 de la transacción de `RESERVED`), y la clave primaria `(company_id, operation, idempotency_key)` es la última defensa. |
| Solicitud distinta con la misma clave | `422` | `409 IDEMPOTENCY_KEY_REUSED` |
| Rechazos | Se guardan y se repiten | Un rechazo antes de reservar no tiene efecto fiscal: la transacción se revierte sin registro, y la misma clave puede reintentarse después de corregir. |
| Duración | Ventana declarada, por ejemplo 24 horas, y purga | Sin TTL ni purga durante la vida fiscal útil del documento. `idempotency_record` es de solo agregado (trigger). |

- **Cabecera.** Obligatoria, de 1 a 100 caracteres ASCII visibles. Sin ella o con otro formato, `400 IDEMPOTENCY_KEY_REQUIRED`, y la emisión no se ejecuta.
- **Huella.** SHA-256 del JSON canónico `{ operation, draftId, expectedVersion }` (`requestFingerprint` en `platform/idempotency`). La versión del borrador identifica su contenido.
- **Repetición.** Antes de abrir la transacción se busca la clave:
  - misma huella: `200` con la factura; si sigue `RESERVED`, se lanza un intento hacia `SIGNED`;
  - otra huella: `409 IDEMPOTENCY_KEY_REUSED`.
- **Concurrencia.**
  - Misma clave y mismo borrador: el bloqueo de fila del borrador serializa. La segunda transacción encuentra el borrador `EMITTED`, se revierte, lee el registro ya confirmado y responde como repetición.
  - Misma clave y borradores distintos: la segunda transacción falla en el índice único al confirmarse la primera y se revierte, así que su número nunca se confirmó. Después responde `409 IDEMPOTENCY_KEY_REUSED`.
  - Otra clave sobre un borrador ya emitido: `409 INVOICE_DRAFT_ALREADY_EMITTED`, con el id de la factura.
- **Operaciones sin clave.**
  - Los borradores no tienen efecto fiscal, y su edición usa `expectedVersion`.
  - El reintento de la firma (`POST /api/v1/invoices/{id}/signing-attempts`) es idempotente por construcción: transición guardada, arriendo del intento y artefacto único por comprobante.
- **Cliente.** El editor genera la clave al abrir la confirmación de la emisión y la repite en los reintentos de esa misma solicitud.

### En este proyecto: entradas y ajustes del inventario

`add-minimal-inventory` (design D7) aplica el mismo contrato a las entradas manuales
(`POST /api/v1/inventory/items/{productId}/entries`, operación `inventory.entry`) y a los ajustes
(`POST /api/v1/inventory/items/{productId}/adjustments`, operación `inventory.adjust`):

- **Alcance.** Empresa, operación y clave, sin usuario. La misma clave sirve en otra empresa y entre una entrada y un ajuste: son alcances distintos.
- **Registro.** No hay una tabla aparte: el movimiento guarda su operación, su clave y la huella de su solicitud, y la restricción única `stock_movement_idempotency_key` sobre `(company_id, idempotency_operation, idempotency_key)` es la última defensa. Sin TTL ni purga: el kárdex es de solo agregado.
- **Huella.** SHA-256 del JSON canónico de la operación, el producto y los datos funcionales exactos, con la cantidad canónica (`10` y `10.00` son la misma solicitud): `{ operation, productId, quantity, note }` en la entrada y `{ operation, productId, delta, reason }` en el ajuste.
- **Respuestas.** Movimiento nuevo: `201`. Misma clave y misma huella: `200` con el mismo movimiento. Otra huella: `409 IDEMPOTENCY_KEY_REUSED`. Sin clave o con otro formato: `400 IDEMPOTENCY_KEY_REQUIRED`.
- **Concurrencia.** La operación toma el lock del control de stock del producto y busca la clave dentro de él. Dos solicitudes simultáneas con la misma clave sobre productos distintos chocan en la restricción única; la perdedora se revierte, lee la ganadora en una transacción nueva y responde como repetición o con `409`.
- **Cliente.** Cada diálogo genera su clave al abrirse y la repite en los reintentos; volver a abrirlo es otra intención y otra clave.
- **Operaciones sin clave.** La inicialización es única por producto (un segundo intento responde `409 INVENTORY_ALREADY_INITIALIZED`), fijar el control es idempotente por estado y la salida de una factura es única por comprobante, producto y tipo.

## Concurrency

Always ask what happens when:

- the user double-clicks;
- the browser or HTTP client retries;
- a mobile client loses and regains its connection;
- a proxy resends the request;
- two requests arrive at the same time;
- a webhook arrives twice;
- a job runs more than once.

Rules:

- Enforce critical invariants in the database: unique constraints, check constraints, foreign keys, and guarded updates. Checks in application code alone race.
- Wrap multi-step mutations in a transaction.
- When two writers can touch the same row, use a row lock (`SELECT ... FOR UPDATE`) or optimistic concurrency with a version column.
- For money and inventory, never read, modify, and write in application code without a lock or a conditional update.

## Events, Webhooks, And Jobs

Delivery is at least once. Every consumer is designed for duplicates.

- Inbound webhooks: verify them, record the provider event ID under a unique constraint, and skip effects already applied. See `integrations.md`.
- Jobs: give each one a deduplication key, make handlers idempotent, and guard their effects with state transitions.
- Outbound calls: send our own idempotency key to providers that accept one. A timeout is ambiguous, because the provider may have succeeded, and the retry must not charge twice.
- Do not assume ordering. Check the current state before applying an event.

## Verification

- [ ] Every mutation with a meaningful side effect declares how it is idempotent.
- [ ] Natural idempotency was preferred wherever the operation allows it.
- [ ] Keys are scoped by tenant, user, and operation, and claimed atomically before execution.
- [ ] Replays return the stored outcome; payload mismatches and in-flight duplicates are rejected.
- [ ] Critical invariants are database constraints or guarded updates, not code checks alone.
- [ ] Webhook, job, and outbound-call handlers tolerate duplicates.
- [ ] The idempotency tests in `../quality/testing.md` exist and pass.
