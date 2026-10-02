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
| Certificación SRI        | Matriz por tipo en el ambiente de Pruebas del SRI: camino feliz, XSD inválido, firma inválida, devuelto, autorizado, no autorizado y timeout con reconciliación. Fuera de CI y nunca como prueba de carga. | ERS AC-03; CTX §49 |

Aunque el MVP tiene una sola empresa por instalación, los fixtures incluyen al menos dos
empresas, para que un filtro de tenant faltante falle una prueba (ADR 0009).

## Test Data

- Use deterministic fixtures.
- Avoid real secrets.
- Avoid relying on unstable external services in CI.
- Mock external APIs behind typed client ports.
