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
