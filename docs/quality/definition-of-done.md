# Definition Of Done

A change is done only when:

- The implementation matches the specs of its OpenSpec change.
- Every scenario in those specs is satisfied, or the specs were explicitly updated.
- Verification commands pass.
- API, database, architecture, security, or user workflow docs are updated when behavior changes.
- New dependencies are justified, and upgrades were reviewed one package at a time with the lockfile diff.
- New boundaries validate untrusted input, and authorization is enforced server-side per record.
- Performance-sensitive changes carry before and after numbers; neutral results were reverted.
- Generated files are produced by scripts or documented sources, not manually edited.
- No secrets are committed.
- Work is split into coherent commits, each one verified and reviewable on its own.
- Commit subjects describe what changed, and bodies stay short or absent.
- pnpm/Corepack commands were used.
- Stack decisions remain aligned with `docs/architecture/stack.md` or an ADR explains the deviation.

For backend work:

- Use cases do not import infrastructure.
- Domain code remains framework-free.
- HTTP validation and error handling are explicit.
- Protected endpoints use documented auth middleware.
- Better Auth owns auth behavior.
- Prisma migrations exist for schema changes.
- PostgreSQL behavior is considered for production.
- Sensitive operations answer the brief in `docs/architecture/backend.md`.
- Identity, tenant, and role come from the session, and every private query is scoped by tenant and ownership.
- Writes accept only allowlisted fields.
- Mutations with meaningful side effects are idempotent, and critical invariants are database constraints.
- Webhooks are verified and deduplicated by event ID.
- Access control and idempotency tests exist, with at least two tenants in the fixtures.

For fiscal work:

- Cada tipo de comprobante cumple la Definition of Done del motor fiscal de CTX §58 antes de declararse implementado.
- El cambio responde el checklist de PR fiscal de CTX §65 y cita la fuente oficial que lo respalda.

For frontend work:

- The screen brief is recorded, and information is tiered P0-P3.
- Exactly one action carries primary weight, within the documented action budget.
- Nothing is displayed only because the backend returns it.
- Visual values come from the documented scales; no arbitrary spacing, color, radius, or duration.
- Interactive elements cover their states, and every animation explains a change.
- Controls are chosen from the user's intent rather than the data type, and add no complexity the task does not need.
- Every state looks as deliberate as the happy path.
- No control ships without backend support, and no screen ships on mocked data.
- Loading, empty, success, and error states are handled.
- Forms use validation.
- Large lists are paginated or virtualized.
- Text and controls fit on supported viewports.
- shadcn/ui conventions are followed.
- Authenticated and unauthenticated states are handled.
- Shared patterns are used for tables, pagination, filters, forms, dialogs, toasts, tooltips, date inputs, and navigation.
- Every module's list, create, edit, detail, and removal paths work against the real backend.
- Sections with their own records, actions, or permissions are sidebar submodules, not tabs.
- Every mutation reports pending, success, and error through the shared feedback helper.
- Destructive actions follow the confirmation ladder in `docs/architecture/forms-and-workflows.md`.
- No raw IDs, storage paths, provider internals, auth implementation names, secret references, or backend-only metadata are exposed without a documented user need.
- Module headings, summaries, cards, helper copy, and controls are not duplicated.
- Action feedback is semantic and transient; persistent page banners are reserved for states that remain relevant after the action ends.
- Row actions are permission-aware, state-aware, labeled by accessible tooltips, and usable with keyboard and touch.
- Light/dark themes and desktop/mobile layouts pass `docs/quality/frontend-checklist.md`.

## Go-Live v1.0

El MVP se libera solo si cumple todos los no negociables del ERS §20 y la Definition of Done
de integración SRI de CTX §59:

- Los seis tipos se generan y validan contra el XSD oficial registrado, con su hash.
- Existe evidencia de autorización en el ambiente de Pruebas del SRI para los seis tipos.
- No hay secuenciales duplicados bajo pruebas de concurrencia.
- La idempotencia de la emisión está demostrada, y un timeout no crea otro comprobante.
- La validación XSD está activa y no puede desactivarse en Producción.
- El dinero se calcula con decimal exacto.
- La firma y su contraseña no aparecen en logs ni respuestas de la API.
- Al menos un proveedor validado: un P12 real de una entidad certificadora ecuatoriana, preferentemente la del primer cliente piloto, se carga, se valida, firma un comprobante autorizado en Pruebas y se le extrae el RUC, y el `CERTIFICATE_MAX_BYTES` configurado admite el archivo con su cadena completa (spike S-6). Un P12 sintético no sustituye esta prueba, y un proveedor no figura como validado sin ella.
- Los certificados custodiados pueden rotarse o volver a cifrarse con una clave maestra nueva, o existe un procedimiento operativo documentado y probado para sustituirlos de forma segura (ADR 0011).
- Los comprobantes firmados y autorizados tienen archivo durable con hash.
- Un respaldo completo se restaura con éxito.
- El proxy de producción que enruta `/api` permite el tiempo de verificación previo al primer byte de una descarga de portabilidad: al menos 120 s de espera de la respuesta en esa ruta, sin almacenar el cuerpo, con el tiempo medido de nuevo sobre el almacenamiento real de producción (`../architecture/deployment.md`, "Proxy inverso y descarga"). Es un requisito operativo, no fiscal ni del ERS.
- Las páginas del frontend envían una Content Security Policy (con `frame-ancestors`, o `X-Frame-Options` como equivalente), `X-Content-Type-Options: nosniff` y `Referrer-Policy`, con una sola autoridad, Next.js o el proxy inverso, sin políticas duplicadas ni contradictorias. Es una compuerta de seguridad del go-live (H-02 de `manual-mvp-test-2026-10-09.md`); la API ya las envía con helmet.
  - **Capa de aplicación: completa** (2026-10-11, ADR 0025). Next.js es la única autoridad, con un nonce por petición, y la comprobación es `check:web-security-policy`.
  - **HSTS: pendiente en el borde TLS.** Se difiere al hardening del despliegue y del proxy (`../architecture/deployment.md`). La compuerta completa del go-live sigue abierta hasta que ese cambio configure y verifique HSTS.
- La política de proxy, CORS y CSRF del despliegue real está revisada, incluida la comprobación del `Origin` en `/api/v1` como defensa en profundidad (H-03 de `manual-mvp-test-2026-10-09.md`; no se encontró una vía de CSRF desde un navegador).
  - **Capa de aplicación: completa** (2026-10-12, `enforce-api-origin-and-body-limits`). Las mutaciones de `/api/v1` exigen el origen canónico de `BETTER_AUTH_URL`, Fetch Metadata rechaza `same-site` y `cross-site`, la API sigue sin CORS y el cuerpo de `/api/auth` queda acotado a 8192 bytes de JSON (spec `api-request-protection`). La comprobación en Chrome es `check:web-security-policy`.
  - **Techo de cuerpo del proxy: pendiente en el borde.** El proxy que enruta `/api` no puede admitir menos de 4 MiB, con 8 MiB como objetivo (`../architecture/deployment.md`, "Techo de cuerpo del proxy"). Se difiere al hardening del despliegue y del proxy; la compuerta completa del go-live sigue abierta hasta que ese cambio revise la política del proxy real.
- Los reportes XLSX principales funcionan.
- El reloj del servidor está sincronizado (NTP o equivalente), con evidencia operativa de la
  infraestructura obtenida fuera de la aplicación (`../architecture/deployment.md`, "Requisitos del
  servidor"). La aplicación no mide la desviación ni tiene un umbral propio.
- Los contratos WSDL de Pruebas y Producción están verificados. Es una verificación de contrato, no
  de conectividad:
  - **Pruebas:** contra los artefactos oficiales registrados en `docs/product/sri-wsdl/`, con su
    SHA-256, y la evidencia de la certificación en Pruebas (`sri-certification.md`).
  - **Producción:** solo offline, contra la documentación y los artefactos oficiales que publica el
    SRI (servicio, host, ruta y versión). La implementación debe ser coherente con ese contrato.
  - **Sin red contra Producción.** La verificación offline no incluye consultas DNS, conexiones TCP,
    peticiones HTTP, SOAP, descarga del WSDL en vivo, pruebas de conectividad, pruebas de humo ni
    verificación de credenciales.
  - La conectividad real con Producción queda fuera del alcance del proyecto, y la prohibición de
    contactar Producción no cambia.
- Las reglas de consumidor final vigentes y el Anexo 26 están revisados (Q-37), y los casos especiales no soportados están bloqueados.
- La matriz normativa está revisada contra la ficha vigente.
- El README cubre instalación, configuración, actualización y respaldo.
- Existen `SECURITY.md` con un canal para reportar vulnerabilidades, la licencia (Q-33), `CONTRIBUTING.md` y un `CHANGELOG` que registra la versión de ficha y XSD compatible.
