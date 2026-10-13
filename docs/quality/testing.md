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
| Política del navegador   | Build de producción en un Chrome real: CSP aplicada con nonce por documento, script inyectado bloqueado, sin enmarcado, cabeceras y caché de los documentos, y flujos legítimos sin violaciones (`check:web-security-policy`). | ADR 0025 |
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
- **Origen de las peticiones:** las pruebas en proceso llaman a la aplicación como un navegador del mismo origen.
  - `backend/test/support/http-client.ts` es un reemplazo directo de `supertest(app)` que envía `Origin: TEST_ORIGIN` en `post`, `put`, `patch` y `delete`. `buildTestApp` y `buildAuthApp` arman la aplicación con ese mismo origen canónico.
  - Una prueba negativa construye la petición en el cliente: `request(app, { origin: null })` no envía `Origin`, y `.set("Origin", …)` o `.set("Sec-Fetch-Site", …)` lo cambian.
  - La aplicación no tiene cabeceras ni envoltorios de prueba. Un archivo que mute con `supertest` directo recibe el 403 de la guarda.
  - El arnés end-to-end (`startE2eBackend`), los benchmarks y `check:web-security-policy` envían su propio `Origin`.
- Aislamiento: cada archivo de integración crea su propio esquema PostgreSQL dentro de `facturador_test`, le aplica las migraciones con `prisma migrate deploy` sin el advisory lock global de Prisma (`PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`: cada esquema es nuevo y lo migra un solo archivo, y el lock solo encolaba esquemas independientes hasta agotar su espera) y lo elimina al terminar (`createMigratedSchema`), de modo que los archivos corren en paralelo sin compartir datos y el aprovisionamiento puede partir de una instalación vacía. Las fixtures incluyen siempre dos empresas.
- Frontend: Vitest con jsdom y Testing Library; las consultas se hacen por rol y nombre accesible, lo que también verifica la accesibilidad básica. `frontend/test/harness.tsx` monta los proveedores reales con la navegación de Next simulada y un `fetch` que responde por método y ruta.
- Herramientas: las reglas de capas de ESLint y `check:versions` tienen sus propias pruebas.
- **Política de seguridad del navegador:** `corepack pnpm check:web-security-policy`, después de
  `corepack pnpm build:verification` (el build con `API_INTERNAL_URL` explícito). `verify` la corre
  detrás de ese build.
  - Arranca el backend con el arnés end-to-end, la firma sintética y un SRI simulado (nunca el SRI
    real).
  - Arranca `next start` del build en `http://localhost:3000`, con el backend en el puerto al que el
    build reenvía `/api`. Necesita ese puerto, el 3000 y el 3001 libres, PostgreSQL y el Chrome del
    sistema.
  - Recorre los flujos en Chrome con `playwright-core` y falla ante cualquier violación inesperada de
    la política.
  - **Origen de `/api/v1`** (puntos 24 a 26, `enforce-api-origin-and-body-limits`): con la sesión
    abierta, dos páginas atacantes en el puerto 3001, `localhost` (del mismo sitio) y `127.0.0.1`
    (de otro sitio), envían una solicitud de impresión sin cuerpo y navegan a la exportación de un
    reporte.
    - Las dos peticiones se rechazan por el `Sec-Fetch-Site` esperado. La impresión se confirma en
      el registro de seguridad del backend, porque Chrome oculta la respuesta opaca del `POST`
      (ORB); la exportación, por su 403 en la navegación.
    - La API confirma que no se registró ninguna impresión ni exportación.
    - Usan un contexto propio del navegador, fuera del recuento de violaciones de la política.
  - Con `--measure-styles`, mide además las variantes de estilos del design D4 como políticas solo
    informativas.
  - Dura unos 20 segundos en local, e informa sus tiempos por fase.
- Prueba manual con navegador: `corepack pnpm --filter @facturador/backend sandbox:mvp <estado.json>` arranca `main.ts` real sobre un esquema propio de `facturador_test`, con la transmisión dirigida solo a un SRI simulado local (también los endpoints de Producción) a través de un proxy que rechaza cualquier otro host, P12 sintéticos del generador del repositorio y la política conservadora de tamaño del código. Un control en `127.0.0.1:4699` elige el comportamiento del SRI simulado por secuencial: recibido, retenido, clave ajena, devuelto, no autorizado o caído. Al detenerse conserva el esquema; `--resume` lo reanuda con la misma clave maestra sintética y `--clean` lo borra. Nunca usa credenciales, certificados ni endpoints reales y se niega a arrancar con `NODE_ENV=production`. El registro de la pasada del 2026-10-09 está en `manual-mvp-test-2026-10-09.md`.
- **Validación de OpenSpec:** `corepack pnpm openspec:validate` ejecuta `openspec validate --all --strict` con la CLI fijada en el repositorio (`@fission-ai/openspec` 1.14.0), nunca una global, e imprime la versión que usa.
  - `verify` la ejecuta justo después de `format:check`, antes de las pruebas y el build, así que el job `verify` de la CI la corre en cada push y pull request.
  - Sus pruebas (`scripts/openspec-validate.test.ts`) usan una CLI simulada para el entorno y los códigos de salida, y la CLI real para el `PATH`, un repositorio temporal inválido y la ausencia de cambios en `openspec/` (`docs/quality/change-lifecycle.md`).
- **Despliegue de referencia** (`harden-deployment-proxy-and-recovery`, spec `production-deployment`,
  ADR 0027): ensayos con Docker y Docker Compose sobre `deploy/compose.yaml`, fuera de `verify`.
  Necesitan Docker, la CLI de OpenSSL y los puertos 18443 a 18445 y 18080 a 18082 libres
  (`DEPLOYMENT_HTTPS_PORT` y `DEPLOYMENT_HTTP_PORT` los cambian).
  - **Contexto de build:** `corepack pnpm deployment:context [--image <imagen>…]` construye con el
    `.dockerignore` del repositorio un árbol temporal de archivos permitidos y prohibidos sintéticos,
    exporta lo que recibe el build (`FROM scratch` y `COPY . /`) y comprueba que no llega ningún
    prohibido; con `--image`, busca además archivos de entorno, PKCS#12 y claves en `/app` de cada
    imagen. Nunca lee un archivo privado real.
  - **Topología:** `corepack pnpm deployment:topology` construye las imágenes (salvo con
    `DEPLOYMENT_SKIP_BUILD=1`) y levanta la topología en un proyecto propio, con secretos sintéticos
    aleatorios y un certificado TLS efímero generados en un directorio temporal fuera del
    repositorio, en el que solo confía el cliente de la prueba. Comprueba:
    - que una migración fallida impide arrancar el backend, y el orden de arranque;
    - que solo el borde publica puertos y que un cliente de otra red no alcanza los servicios
      internos;
    - la redirección HTTP, una sola HSTS exacta también en un `413` y en un rechazo, el enrutamiento
      de `/api` y de las páginas, y la salud y las métricas rechazadas por fuera y vivas por dentro;
    - el inicio de sesión del administrador sintético con cookies `Secure`;
    - la IP del cliente: un contenedor cliente en la red pública provoca inicios de sesión fallidos,
      con y sin un `X-Forwarded-For` falsificado, y la prueba compara el campo `ip` de esos eventos de
      seguridad con su dirección; la misma llamada desde la interfaz, directa a la API, se atribuye a
      la interfaz;
    - el techo de cuerpo (4 MB llegan a la API; más de 8 MiB en `/api/` y más de 1 MiB fuera reciben
      `413` del borde);
    - la salida bloqueada: un contenedor trampa en la red pública no recibe ninguna conexión de la API
      ni de la interfaz;
    - los procesos sin root y sin capacidades, la raíz de solo lectura y el mínimo de capacidades de
      nginx;
    - las esperas: la configuración renderizada (180 s solo en la descarga, sin almacenarla; 60 s en
      el resto) y, con la misma plantilla y esperas escaladas, una descarga de primer byte tardío que
      se entrega completa mientras otra ruta recibe `504`;
    - la persistencia: datos sintéticos no fiscales (la configuración de la empresa, un operador, un
      logo sintético, una exportación de reporte y una de portabilidad lista) sobreviven a recrear los
      contenedores sin borrar volúmenes, y el paquete conserva su SHA-256;
    - el apagado del backend con código 0, sus mensajes de cierre y dentro del plazo de gracia.

    Nunca contacta el SRI ni otro servicio externo: corre con `SRI_TRANSMISSION_ENABLED=0`, sin salida
    a Internet en la red de la aplicación y sin el override de salida. Siempre borra sus proyectos,
    volúmenes y temporales. Dura unos 5 minutos en local con las imágenes ya construidas.
  - **Recuperación:** `corepack pnpm deployment:recovery`, con tres proyectos simultáneos en subredes
    propias (la IP del proxy y `TRUST_PROXY` las siguen):
    1. siembra en el origen solo datos sintéticos no fiscales: la configuración de la empresa, un
       operador, un logo sintético, un certificado del generador de P12 del repositorio en la
       custodia y una exportación de portabilidad lista; ninguna emisión ni firma;
    2. detiene la aplicación (no PostgreSQL) para que nada cambie, toma la huella de la base
       (migraciones con su suma, y recuento y resumen del contenido de cada tabla, que se comparan
       sin imprimirse) y respalda con `deploy/backup.sh`;
    3. comprueba las negativas en un PostgreSQL vacío: un volcado alterado no pasa la suma y no toca
       el destino; uno truncado con su suma recalculada hace fallar `pg_restore`;
    4. restaura con `deploy/restore.sh` en un PostgreSQL 17 nuevo e independiente, compara las
       huellas, comprueba que una segunda restauración se niega sin cambiar nada y que las
       migraciones no cambian datos;
    5. arranca la aplicación sobre lo restaurado con la misma clave maestra sintética: el
       administrador, el operador y el logo vuelven, el certificado está disponible y la exportación
       sin su archivo queda `FAILED` con `DATA_EXPORT_PACKAGE_MISSING`, auditada y sin entregarse;
    6. con otra clave maestra sintética, la aplicación queda lista, el certificado aparece
       `KEY_UNAVAILABLE` y el registro no lleva secretos.

    Registra las duraciones del respaldo y de la restauración como evidencia, nunca como un RTO o un
    RPO. Los volcados y los secretos viven en un directorio temporal `0700` fuera del repositorio y se
    borran siempre.
- **Workflow de seguridad** (`.github/workflows/security.yml`, ADR 0026):
  - **Cuándo:** en cada push y pull request, cada lunes y a mano.
  - **Cómo:** dos jobs paralelos e independientes de `verify`, sin secretos y con permisos de solo
    lectura.
  - **`dependency-security`:** `security:dependencies`, sin instalar dependencias.
  - **`secret-security`:**
    - instala las dependencias de desarrollo sin scripts e instala Gitleaks verificado por suma;
    - ejecuta `test:secret-rules` y `security:secrets --ci`;
    - su checkout trae el historial completo (`fetch-depth: 0`), y Gitleaks revisa lo alcanzable
      desde el commit del evento: en un push, la rama empujada; en una pull request, el commit de
      fusión con sus commits y su base.

    No se traen otras referencias. Cada rama empujada tiene su propia corrida.
  - **Duración medida** en la primera corrida (38265133725, 2026-10-12): `dependency-security` tardó
    25 s y `secret-security` 38 s, en paralelo con `verify`, sin alargar el camino crítico.
- **Seguridad de las dependencias:** `corepack pnpm security:dependencies`, sin tokens ni
  instalación, con salida a la red solo hacia el registro de npm. Termina en
  `DEPENDENCY SECURITY: PASS`, `FAIL` o `ERROR`.

  Para reproducir cada fallo sin tocar el lockfile:
  - **Un aviso HIGH sin excepción y una excepción vencida:** las pruebas de
    `scripts/check-dependency-security.test.ts`, con salidas de muestra y fechas inyectadas.
  - **En el repositorio real:** `node scripts/check-dependency-security.ts --exceptions <archivo>`
    con una copia del archivo de excepciones sin una entrada (`FAIL`) o con un `expires` pasado
    (`FAIL`).
  - **Un `ERROR` de la fuente:** las mismas pruebas, con una salida vacía o no JSON.
- **Seguridad de los secretos:** `corepack pnpm security:secrets`.
  - **Gitleaks local:** exige exactamente la versión de `security/gitleaks.json`, y falla si falta o
    es otra. Se instala desde el artefacto oficial de esa release, comprobando su SHA-256; el
    comando nunca lo descarga.
  - **Alcance:** revisa el historial de HEAD y lo preparado para el commit, nunca el directorio de
    trabajo.
  - **Pruebas de las reglas:** `corepack pnpm test:secret-rules` las ejecuta contra el binario fijado
    (`GITLEAKS_BIN` o el `PATH`).
  - **Reproducir un hallazgo** sin secretos reales: esas pruebas crean repositorios git temporales
    con valores sintéticos generados al vuelo, y nunca empujan nada. Para probarlo a mano, crear
    fuera del proyecto un repositorio con un valor sintético, copiar `.gitleaks.toml` y
    `security/gitleaks.json`, y ejecutar `node <proyecto>/scripts/check-secret-security.ts --ci`
    desde ese repositorio.
  - **El instalador de la CI** (`scripts/security/install-gitleaks.sh`) tiene su prueba en el
    proyecto `scripts`: con una suma incorrecta no extrae ni ejecuta nada y termina en `ERROR`.
- Rendimiento de la búsqueda: `corepack pnpm --filter @facturador/backend bench:search` es un gate dedicado, fuera de `test` y de `verify`, para que la carga de un runner compartido no lo vuelva inestable. Se ejecuta sobre una PostgreSQL 17 sin carga ajena y escribe el entorno, los tiempos y los planes de consulta en `docs/quality/benchmarks/` (`performance.md`). La suite normal comprueba el comportamiento, los índices (`migrations.test.ts`) y los planes de las búsquedas por prefijo (`search-plans.test.ts`).

## Test Data

- Use deterministic fixtures.
- Avoid real secrets.
- Avoid relying on unstable external services in CI.
- Mock external APIs behind typed client ports.
