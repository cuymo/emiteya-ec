# Backend Architecture

## Runtime

- Language: TypeScript.
- Runtime: Node.js.
- Framework: Express.js.
- Package manager: pnpm through Corepack.
- Database access: Prisma.
- Database: PostgreSQL.
- Authentication: Better Auth.
- Validation: Zod.
- External HTTP: Axios.

## Estructura del backend en este proyecto

```text
backend/src/
├── main.ts          arranque, validación del entorno y apagado ordenado
├── app.ts           createApp(deps): arma la aplicación HTTP
├── config/          entorno validado con Zod (env.ts)
├── platform/        http (correlación, errores, 404), logging, metrics, health, lifecycle, db
├── generated/       cliente de Prisma generado (no versionado)
├── commands/        comandos de servidor sin ruta HTTP (admin:recover)
└── modules/         un directorio por módulo con domain / application / infrastructure
```

Orden de middleware de `createApp` (ADR 0016):

1. `requestId`: acepta un `x-request-id` entrante válido (8 a 128 caracteres `[A-Za-z0-9._-]`) o genera un UUID, y lo devuelve en la respuesta.
2. `pino-http`: un log por petición con `req.id`, método, URL y estado. No registra cabeceras, IP ni cuerpos; la redacción de `authorization`, `cookie`, `set-cookie`, `password`, `token` y `secret` es una segunda defensa.
3. `helmet`: cabeceras de seguridad; `x-powered-by` deshabilitado.
4. Métricas HTTP por patrón de ruta.
5. Endpoints operacionales: `/health/live`, `/health/ready` y `/metrics`, fuera de `/api` y fuera de la API pública. Restringir su exposición corresponde al despliegue (`deployment.md`).
6. `mountBeforeBodyParser`: punto de montaje para routers que necesitan el cuerpo sin procesar. Monta Better Auth en `/api/auth/*`, precedido del middleware que escribe la IP del cliente y la correlación como cabeceras propias del servidor.
7. `express.json` con límite de 100 KB.
8. `/api/v1`: el router de aplicación que recibe `createApp` (ADR 0015).
9. Manejador 404 y manejador de errores.

Contrato de errores:

- Respuesta: `{ error: { code, message, requestId } }`, con el esquema de `@facturador/contracts`.
- `AppError` lleva un código estable, el estado HTTP y un mensaje para el usuario; `NotFoundError`, `ConflictError` y `ValidationError` (desde un `ZodError`) son sus variantes genéricas.
- Errores del parser: `413 PAYLOAD_TOO_LARGE` y `400 INVALID_JSON`.
- Cualquier otro error responde `500 INTERNAL_ERROR` con un mensaje genérico; el detalle y el stack quedan solo en el log, con el mismo `requestId`.

Ejecución: en desarrollo, `node --watch --env-file-if-exists=.env --conditions=development src/main.ts` (type stripping nativo, sin `tsx`); en producción, `tsc -p tsconfig.build.json` y `node dist/main.js`. El código respeta las restricciones de `erasableSyntaxOnly` descritas en ADR 0016.

## Layers

### Domain

Responsibilities:

- Entities.
- Value objects.
- Domain errors.
- Business invariants.

Forbidden dependencies:

- HTTP frameworks.
- Database clients.
- External SDKs.

### Application / Use Cases

Responsibilities:

- Workflows.
- Ports/interfaces.
- DTOs.
- Transaction boundaries when applicable.

Forbidden dependencies:

- Concrete infrastructure.
- HTTP request/response objects.

### Infrastructure

Responsibilities:

- HTTP controllers/routes.
- Database repositories.
- External service clients.
- Background jobs.
- Runtime configuration.

## REST / API Conventions

- Versioning: application routes live under `/api/v1/`; library-owned routes such as Better Auth's `/api/auth/*` stay outside the prefix (ADR 0015).
- Success response shape: use a consistent envelope, for example `{ data, meta? }`.
- Error response shape: use a consistent envelope, for example `{ error: { code, message, details? } }`.
- Pagination: return page metadata with large collections.
- Auth: protect custom routes with middleware backed by Better Auth sessions.
- Validation: validate request params, query, body, environment variables, and external payloads.
- Idempotency: mutations whose repetition would duplicate an effect accept an `Idempotency-Key` header. See `idempotency.md`.
- Status codes: `404` for any record outside the caller's tenant, `409` for state conflicts and in-flight duplicates, `422` for an idempotency key reused with a different payload.

## Auth Boundary

- Better Auth owns `/api/auth/*` or the equivalent auth route prefix.
- Register Better Auth before JSON middleware when the framework requires raw request access.
- Application routes must not manually hash passwords.
- Application use cases receive the authenticated user, tenant, and role as plain data resolved from the session, never from the request payload and never as framework objects.

## Database Boundary

- Prisma Client is infrastructure.
- Repositories map Prisma records into domain/application objects.
- Use migrations for schema changes.
- Do not use ad hoc SQL in application code unless documented and isolated.
- Repositories for tenant-owned data take the tenant context as a required parameter and scope every query with it, including updates and deletes. No unscoped lookup by ID exists for private records. See `../security/access-control.md`.

## External Service Boundary

- Use Axios in infrastructure clients.
- Define typed payloads and normalized application responses.
- Provider tokens come from validated environment/runtime settings.
- Provider errors are normalized before reaching UI code.

## Background Jobs

- Job ownership: el módulo `fiscal` es dueño de los jobs de recepción, autorización, reconciliación, recuperación, validez y RIDE; `taxpayer`, del aviso de vencimiento del certificado; `reports`, de las exportaciones grandes si la medición las exige. Detalle en `fiscal-emission.md`.
- Persistence: tabla de jobs en PostgreSQL, en la misma base de datos que los comprobantes, para encolar un job en la misma transacción que la transición de estado (ADR 0012).
- Retry policy: backoff exponencial con jitter, configurable por tipo de job. Las consultas al SRI se reintentan; el envío a recepción nunca se reintenta sin reconciliar antes (CTX §33). La autorización se consulta hasta 24 horas desde `RECIBIDA` (Q-06).
- Cancellation: los jobs fiscales no se cancelan, porque el comprobante ya tiene efectos ante el SRI; un administrador puede llevar el comprobante a revisión manual. Los jobs de exportación sí se cancelan.
- Progress reporting: el estado fiscal del comprobante es el progreso visible; las exportaciones informan su avance.

Use persisted jobs for long-running work that must continue after browser refresh.

Jobs may run more than once. Give each a deduplication key and make its handler idempotent;
see `idempotency.md`.

## Sensitive Operations

A sensitive operation reads or changes private data, money, inventory, permissions, files,
or anything another account must not see. Before writing one, answer these in the design of
its OpenSpec change:

1. Who may execute this action?
2. Which tenant does the caller belong to?
3. Which tenant does the resource belong to?
4. How is ownership validated?
5. Can changing an ID in the request reach another account's data?
6. What happens if the request arrives twice?
7. What happens if two requests arrive at once?
8. Does the operation need idempotency, and by which mechanism?
9. Which database constraints protect its invariants?
10. Does it need an audit record?
11. Which authorization tests must be added?
12. Is there any path for data to leak between accounts?

An unanswered question blocks implementation, as the screen brief does for interfaces.

### Pipeline

Process a sensitive operation in this order. Each step depends on the ones before it.

```text
authentication
  -> user context
  -> tenant context
  -> authorization
  -> ownership validation
  -> input validation
  -> idempotency claim, when required
  -> transaction or atomic operation
  -> persistence
  -> audit record
  -> sanitized response
```

Authentication and context resolution live in HTTP middleware. Authorization, ownership,
idempotency, and the transaction live in the use case and its tenant-aware repository. Parse
only the identifiers that ownership needs before authorizing, and validate the rest of the
payload afterwards, so an unauthorized caller learns nothing from validation errors.

### Reporting Format

When implementing a sensitive operation, report in this order:

1. The relevant risks.
2. The authorization boundaries.
3. Whether it needs idempotency, and by which mechanism.
4. The implementation.
5. The validations added.
6. The database constraints added.
7. The tests added.
8. Security risks found in existing code, even outside the task.

Never weaken an authorization control to make a test pass, and never trade data isolation for
simpler code.
