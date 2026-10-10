# Testing Strategy

## Test Pyramid

- Unit tests for pure domain logic.
- Use-case tests for application behavior.
- Integration tests for database, HTTP, auth, and external boundaries.
- End-to-end tests for critical user workflows.

## What Must Be Tested

- Validation boundaries, including the rejection paths and not only the accepted input.
- Auth and permissions, including access to a record the caller does not own.
- Error responses.
- Data persistence.
- Background jobs and cancellation.
- External service failure modes.
- Better Auth protected-route behavior.
- Prisma repository behavior for critical writes.
- PostgreSQL migration assumptions.
- React Hook Form validation paths.
- Table search, filters, sorting, pagination, column visibility, and row actions.
- Modal focus management, dismissal, scroll containment, and submission states.
- Toast semantics and retry behavior for successful and failed actions.
- Responsive layout, long text, empty collections, large collections, and dark mode.
- Permission-driven navigation and action visibility.

## Access Control Tests

Every endpoint that touches private data carries these cases:

| Case                                                          | Expected                                            |
| ------------------------------------------------------------- | --------------------------------------------------- |
| User A acts on resource A                                     | Allowed                                             |
| User B acts on resource A                                     | `404`, as if the resource did not exist             |
| User A edits the ID in the path to reach resource B           | `404`, and nothing is returned or changed           |
| User A sends another tenant's ID in the body or query         | Ignored or rejected; the session tenant still holds |
| User A references another tenant's record as a foreign key    | Rejected                                            |
| A user without the required role calls an admin operation     | `403`, and nothing changes                          |
| The payload carries `role`, `tenantId`, `isAdmin`, or `balance` | Rejected by the strict schema, and nothing changes |

Cover IDOR, BOLA, tenant hopping, role manipulation, mass assignment, and parameter
tampering explicitly. Fixtures always include at least two tenants, so a missing filter
fails a test instead of passing silently.

## Idempotency Tests

| Case                                       | Expected                                  |
| ------------------------------------------ | ----------------------------------------- |
| First request with a key                   | Processed normally                        |
| Same request repeated with the same key    | Same outcome, effect not repeated         |
| Two simultaneous requests with the same key | Exactly one effect                       |
| Same key in different tenants              | Completely independent outcomes           |
| Same key with a different payload          | `422`, and nothing executes               |
| Same key while the first is still running  | `409`, and nothing runs concurrently      |
| Same webhook event delivered twice         | One effect, both deliveries acknowledged  |
| Same job executed twice                    | One effect                                |

Test concurrency with genuinely parallel requests against PostgreSQL, not sequential calls
against a mock. A race the test cannot produce is a race the test cannot catch.

Never loosen an authorization check or a constraint to make one of these tests pass.

## Pruebas obligatorias del producto

Fuentes: ERS §18.1 y CTX §19.4, §49–52, §61.

| Área                     | Pruebas                                                                                                    | Fuente             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------ |
| Clave de acceso          | Vector oficial de la ficha, longitud incorrecta, caracteres no numéricos, cambio de un dígito, secuenciales 1, 9, 10 y 999999999; propiedades: 49 dígitos, dígito verificador válido, determinismo con código numérico fijo. | CTX §8.3, §51 |
| Dinero                   | Unitarias de cálculos y redondeo; propiedades con cantidades, descuentos, tarifas y fracciones aleatorias que verifican las invariantes de totales. | ERS §18.1; CTX §10.7, §51 |
| Máquina de estados       | Cada transición permitida, el rechazo de las no permitidas y las invariantes I-15 e I-16.                  | ERS §18.1; CTX §61 |
| Builders XML             | Por tipo: caso mínimo y completo válidos, obligatorio faltante, fuera de orden, longitud, decimal, fecha y catálogo inválidos, escapado y XML sobre el límite; contra el XSD oficial. | CTX §19.4 |
| Golden files             | Fixtures propios o anonimizados por tipo, normalizando solo lo legítimamente variable de la firma.        | CTX §50            |
| Firma                    | Con certificados de prueba controlados: vigente, vencido, sin clave privada y contraseña incorrecta.        | ERS §18.1          |
| Secuenciales             | 100+ reservas paralelas contra PostgreSQL sin duplicados.                                                  | ERS AC-04; CTX §51 |
| Idempotencia             | La misma clave N veces produce un comprobante, un secuencial y una clave de acceso.                        | ERS AC-05; CTX §51 |
| Recuperación             | Casos A–E con clientes SRI simulados: timeout, error 70, caída tras `RECIBIDA`, caída tras autorizar, clave registrada. | ERS AC-06; CTX §52 |
| Invariantes              | I-01..I-20 como pruebas o restricciones.                                                                   | CTX §61            |
| Inventario               | Un reintento o una reconciliación no duplica la salida de stock.                                           | ERS AC-08          |
| Exportación              | El XLSX respeta los filtros, conserva identificaciones como texto e importes como números.                 | ERS AC-09          |
| Respaldo                 | Restauración completa de configuración, comprobantes y artefactos.                                         | ERS AC-10          |
| Seguridad                | Firma y contraseña ausentes de logs y respuestas; escaneo de dependencias y de secretos.                   | ERS §18.1, §20     |
| Certificación SRI        | Matriz por tipo en el ambiente de Pruebas del SRI: camino feliz, XSD inválido, firma inválida, devuelto, autorizado, no autorizado y timeout con reconciliación. Fuera de CI y nunca como prueba de carga. La factura empieza con S-3 online (`sri-certification.md`). | ERS AC-03; CTX §49 |

Aunque el MVP tiene una sola empresa por instalación, los fixtures incluyen al menos dos
empresas, para que un filtro de tenant faltante falle una prueba (ADR 0009).

## Cómo correr las pruebas en este proyecto

- Todas: `corepack pnpm test` (Vitest con un proyecto por paquete: `backend`, `contracts`, `frontend` y `scripts`). `corepack pnpm verify` las incluye.
- ERS AC-04 en ejecución aislada:
  - `corepack pnpm test` corre primero la suite normal y después `backend/test/integration/fiscal-ac04.test.ts` sola, con `backend/vitest.ac04.config.ts` (`corepack pnpm --filter @facturador/backend test:ac04`). Si cualquiera de las dos falla, `test` y `verify` fallan.
  - La razón: la prueba mide 120 reservas simultáneas con la configuración de transacción por defecto de Prisma. En paralelo con el resto de la suite, con la máquina saturada, el tiempo para empezar una transacción (`maxWait`, 2 s) se agotaba por la carga, igual con distintas versiones de Node, mientras que aislada se mantiene por debajo de 1 s.
  - Separarla elimina esa interferencia; no cambia sus invariantes, su volumen ni `maxWait`.
- Un paquete: `corepack pnpm exec vitest run --project backend` (o `contracts`, `frontend`, `scripts`).
- Integración: las pruebas de `backend/test/integration/` usan PostgreSQL real, la base `facturador_test` de `compose.yaml` o `DATABASE_URL_TEST`. Levántala con `docker compose up -d --wait`. Si no está disponible, fallan con esa indicación; nunca se saltan.
- Aislamiento: cada archivo de integración crea su propio esquema PostgreSQL dentro de `facturador_test`, le aplica las migraciones con `prisma migrate deploy` sin el advisory lock global de Prisma (`PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`: cada esquema es nuevo y lo migra un solo archivo, y el lock solo encolaba esquemas independientes hasta agotar su espera) y lo elimina al terminar (`createMigratedSchema`), de modo que los archivos corren en paralelo sin compartir datos y el aprovisionamiento puede partir de una instalación vacía. Las fixtures incluyen siempre dos empresas.
- Frontend: Vitest con jsdom y Testing Library; las consultas se hacen por rol y nombre accesible, lo que también verifica la accesibilidad básica. `frontend/test/harness.tsx` monta los proveedores reales con la navegación de Next simulada y un `fetch` que responde por método y ruta.
- Herramientas: las reglas de capas de ESLint y `check:versions` tienen sus propias pruebas.
- Prueba manual con navegador: `corepack pnpm --filter @facturador/backend sandbox:mvp <estado.json>` arranca `main.ts` real sobre un esquema propio de `facturador_test`, con la transmisión dirigida solo a un SRI simulado local (también los endpoints de Producción) a través de un proxy que rechaza cualquier otro host, P12 sintéticos del generador del repositorio y la política conservadora de tamaño del código. Un control en `127.0.0.1:4699` elige el comportamiento del SRI simulado por secuencial: recibido, retenido, clave ajena, devuelto, no autorizado o caído. Al detenerse conserva el esquema; `--resume` lo reanuda con la misma clave maestra sintética y `--clean` lo borra. Nunca usa credenciales, certificados ni endpoints reales y se niega a arrancar con `NODE_ENV=production`. El registro de la pasada del 2026-10-09 está en `manual-mvp-test-2026-10-09.md`.
- Rendimiento de la búsqueda: `corepack pnpm --filter @facturador/backend bench:search` es un gate dedicado, fuera de `test` y de `verify`, para que la carga de un runner compartido no lo vuelva inestable. Se ejecuta sobre una PostgreSQL 17 sin carga ajena y escribe el entorno, los tiempos y los planes de consulta en `docs/quality/benchmarks/` (`performance.md`). La suite normal comprueba el comportamiento, los índices (`migrations.test.ts`) y los planes de las búsquedas por prefijo (`search-plans.test.ts`).

## Test Data

- Use deterministic fixtures.
- Avoid real secrets.
- Avoid relying on unstable external services in CI.
- Mock external APIs behind typed client ports.
