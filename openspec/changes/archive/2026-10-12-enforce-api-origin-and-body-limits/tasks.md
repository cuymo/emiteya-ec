# Tasks

## 1. Guarda de origen y Fetch Metadata en `/api/v1`

- [x] 1.1 Crear `backend/src/platform/http/request-origin.ts`, sin efectos (design D2, D3, D4 y D8):
  - **`canonicalOrigin(url)`:** devuelve `URL.origin`, y falla si no es un origen `http` o `https`.
  - **La evaluación de una petición:** recibe el método y las cabeceras, y devuelve que sigue o una
    de las seis categorías.
    - `OPTIONS` sigue sin evaluarse.
    - Fetch Metadata se aplica a todos los demás métodos.
    - El origen exacto se exige en `POST`, `PUT`, `PATCH` y `DELETE`.
  - **La categoría gruesa de la ruta:** el primer segmento tras `/api/v1`, o `unknown`.

  Verificar con `backend/test/platform/request-origin.test.ts`:
  - **Origen:** el canónico sigue; se rechazan uno ajeno, uno de un sitio hermano, otro esquema y
    otro puerto, uno ausente, `null` y los malformados (con ruta, barra final, usuario o espacios).
  - **Fetch Metadata:** `same-origin`, `none`, la ausencia y un valor desconocido siguen;
    `same-site` y `cross-site` se rechazan, también en `GET` y `HEAD`.
  - **Exenciones:** `OPTIONS` sigue siempre.
  - **Cabeceras reenviadas:** `Host`, `X-Forwarded-Host`, `Forwarded` y `X-Forwarded-Proto`
    falsificados no cambian el resultado.
  - **`canonicalOrigin`:** descarta la ruta y rechaza `file:`, `ftp:` y los valores inválidos.
  - **La categoría:** no contiene identificadores.
- [x] 1.2 Montar la guarda en `createApp` (`backend/src/app.ts`), con la dependencia nueva
  `requestOrigin`, entre `mountBeforeBodyParser` y el parser JSON (design D1).
  - **Error:** el rechazo pone `Cache-Control: no-store` y sale con `REQUEST_ORIGIN_REJECTED` 403
    por el manejador de errores (design D7 y D8).
  - **Arranque:** `main.ts` deriva el origen canónico de `BETTER_AUTH_URL`. Si no es utilizable,
    falla con un `EnvError` que nombra la variable sin su valor (design D4).
  - **Observabilidad:** se añade el tipo `request_origin_rejected` a `SecurityEvent`, con el método,
    la categoría de la ruta, el motivo y la correlación, su log y el contador
    `http_request_origin_rejections_total{method, reason}` en `security-event-log.ts`.
  - **Pruebas en proceso:** `buildTestApp` y `buildAuthApp` arman la aplicación con el origen
    canónico `TEST_ORIGIN`. No envuelven ni cambian las peticiones.

  Verificar:
  - las pruebas de entorno: un `BETTER_AUTH_URL` inutilizable impide arrancar y el mensaje no
    muestra el valor;
  - las pruebas de `security-event-log`: el evento sin URL cruda y las etiquetas del contador;
  - `typecheck` y `lint`.
- [x] 1.3 Crear el cliente compartido `backend/test/support/http-client.ts` (design D9).
  - `request(app, options?)` es un reemplazo directo de `supertest(app)`.
  - En `post`, `put`, `patch` y `delete` envía `Origin: TEST_ORIGIN`.
  - `request(app, { origin: null })` no envía `Origin`, y `.set("Origin", …)` lo sustituye.
  - `get`, `head` y `options` no añaden nada.

  En los archivos de prueba que mutan con `supertest`, cambiar solo la línea de importación al
  cliente compartido, sin tocar sus llamadas. La aplicación no recibe ninguna cabecera de prueba.

  Verificar que `corepack pnpm exec vitest run --project backend` sigue en verde con la guarda
  activa.
- [x] 1.4 Crear `backend/test/integration/request-origin.test.ts` sobre `buildAuthApp`, construyendo
  las peticiones negativas en el cliente: `{ origin: null }`, `.set("Origin", …)` y
  `.set("Sec-Fetch-Site", …)`. Cubrir los escenarios del spec:
  - **Mutaciones:** la mutación válida con el origen canónico; un origen ajeno, uno de un sitio
    hermano, uno ausente, `null`, uno malformado, otro esquema y otro puerto.
  - **`POST` sin cuerpo:** con un origen ajeno, la solicitud de impresión no se registra.
  - **Orden de las reglas:** un cuerpo de más de 100 KiB con un origen ajeno recibe 403 y no 413;
    una petición sin sesión con un origen ajeno recibe 403 y no 401.
  - **Sin cambios en la seguridad existente:** con el origen canónico, sin sesión sigue el 401, y
    un rol sin permiso sigue con su denegación.
  - **Cabeceras reenviadas:** un `Host` o un `X-Forwarded-Host` falsificados no amplían la
    confianza.
  - **Fetch Metadata:** `same-origin` y `none` funcionan; la exportación de un reporte con
    `cross-site` recibe 403 y no deja ninguna auditoría `report.exported`; un `GET` `same-site`
    recibe 403; un `GET` sin `Sec-Fetch-Site` funciona; las dos reglas se suman.
  - **`OPTIONS`:** con origen ajeno y `cross-site`, el mismo estado que antes del cambio y ninguna
    cabecera `Access-Control-*`. Ninguna respuesta lleva `Access-Control-Allow-Origin`.
  - **El 403:** el sobre con el código común, `Cache-Control: no-store` y ningún rastro del origen
    canónico.
  - **Observabilidad:** el evento de seguridad lleva la categoría y no la URL con el identificador;
    el contador sube por método y motivo. Los logs no tienen el cuerpo, la cookie ni los valores de
    `Origin` o `Referer`.
  - **Límites de cuerpo:** el JSON general de más de 100 KiB sigue recibiendo 413, y las rutas con
    límite propio siguen aceptando sus cuerpos grandes.

  Verificar que el archivo pasa.
- [x] 1.5 Documentar el grupo:
  - `docs/security/hardening.md`: la frontera de confianza y el origen canónico;
  - `docs/architecture/backend.md`: el orden de los middleware con la guarda;
  - `docs/quality/observability.md`: el evento y el contador;
  - `docs/quality/testing.md`: el cliente compartido y cómo omitir o sustituir el origen;
  - `docs/architecture/deployment.md`: que `BETTER_AUTH_URL` sea el origen público exacto, y el
    requisito del techo de cuerpo del borde (al menos 4 MiB, objetivo de 8 MiB en el hardening del
    despliegue), señalando que el ejemplo de 1 MiB no cubre los borradores;
  - `docs/quality/technical-debt.md`: `SIDE_EFFECTING_GET_SEMANTICS` (exportación de reportes) y
    el techo del proxy pendiente.

  Verificar que `corepack pnpm format:check` pasa y que los requisitos no se copian en la
  documentación.

## 2. Cuerpo acotado de Better Auth

- [x] 2.1 En `backend/src/modules/identity/infrastructure/better-auth/http.ts`, sustituir
  `toNodeHandler(auth)` por el adaptador acotado (design D6):
  1. 415 `UNSUPPORTED_MEDIA_TYPE` si la petición declara un cuerpo que no es `application/json`,
     sin leerlo;
  2. `express.raw({ type: "application/json", limit: 8192 })`;
  3. un `Request` con el origen canónico más la ruta y la consulta reales, las cabeceras de Node sin
     las de salto a salto ni las de encuadre, y el `Buffer` leído;
  4. `auth.handler(request)`;
  5. la escritura de la respuesta con el estado, las cabeceras (cada `Set-Cookie` por separado) y
     el cuerpo.

  La construcción del `Request` y la escritura de la respuesta quedan como funciones probables por
  separado.

  Verificar las pruebas de paridad en `backend/test/identity/better-auth-adapter.test.ts`, con un
  manejador simulado:
  - **De la petición:** el método, la ruta, la consulta, las cookies, `Origin`, `Sec-Fetch-*`, la IP
    del servidor y las cabeceras normales, la URL canónica aunque lleguen un `Host` y un
    `X-Forwarded-*` falsificados, los bytes exactos del cuerpo y ningún cuerpo cuando está vacío.
  - **Cabeceras descartadas:** `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`,
    `upgrade`, `proxy-authorization`, `proxy-authenticate`, `content-length` y las nombradas en
    `Connection`.
  - **De la respuesta:** el estado, el cuerpo, el `Content-Type`, dos `Set-Cookie` distintas
    conservadas por separado y las demás cabeceras.
  - **Corte:** una petición cortada antes de terminar no llama al manejador.

  Verificar también que las pruebas de contrato de Better Auth (`better-auth-contract.test.ts`) y
  las de `auth-harness` siguen en verde: inicio y cierre de sesión, cambio de contraseña, límite de
  intentos, allowlist y cookies.
- [x] 2.2 Crear `backend/test/integration/auth-body-limits.test.ts` sobre `buildAuthApp`, con un
  cliente HTTP de Node crudo para controlar `Content-Length` y `chunked`:
  - **Funciona igual:** el inicio de sesión normal en JSON, el cierre de sesión con `{}` y el
    cambio de contraseña.
  - **Límite exacto:** un cuerpo JSON válido de exactamente 8192 bytes se procesa, y uno de 8193
    recibe 413.
  - **`Content-Length`:** uno declarado mayor que 8192 recibe 413 sin enviar el cuerpo.
  - **Sin `Content-Length`:** un cuerpo válido funciona.
  - **`chunked`:** un cuerpo de menos de 8192 bytes funciona, y uno de más recibe 413.
  - **Tipo de contenido:** `application/json; charset=utf-8` se acepta; `text/plain`,
    `application/x-www-form-urlencoded`, `multipart/form-data` y otro tipo no vacíos reciben 415;
    una petición sin cuerpo y sin `Content-Type` no recibe 415.
  - **Errores:** el sobre de 413 y 415 no repite el cuerpo.
  - **Logs:** no contienen la contraseña, la cookie ni el cuerpo.

  Si Node rechaza un encuadre malformado antes del código de la aplicación, documentarlo como
  frontera de transporte, sin pruebas que reinterpreten el flujo crudo (design D6). Verificar que
  el archivo pasa.
- [x] 2.3 En una prueba end-to-end con `startE2eBackend`, donde la defensa propia de Better Auth
  está activa, comprobar:
  - un inicio de sesión con `Origin` ajeno sigue recibiendo el 403 de Better Auth;
  - un inicio de sesión de más de 8192 bytes recibe 413.

  Documentar en `docs/architecture/authentication.md` el adaptador, el límite, el tipo de
  contenido y la frontera del encuadre HTTP. Verificar que la prueba y `corepack pnpm format:check`
  pasan.

## 3. Contratos y OpenAPI

- [x] 3.1 En `packages/contracts/src/api/routes.ts`, ampliar la descripción compartida del 403 con
  el rechazo por origen y la descripción general de la API con la regla de origen y Fetch Metadata,
  sin el origen canónico. Regenerar `docs/generated/openapi.json`. Verificar que
  `corepack pnpm openapi:check` pasa.

## 4. Comprobación de navegador

- [x] 4.1 Ampliar `scripts/check-web-security-policy.ts` (design D10):
  - una página atacante en `http://localhost:3001` (mismo sitio) y otra en
    `http://127.0.0.1:3001` (otro sitio);
  - con la sesión abierta, desde cada una: un `POST` sin cuerpo con credenciales a
    `/api/v1/documents/{id}/print-requests` y una navegación de nivel superior a la exportación de
    un reporte;
  - comprobar por la API que no se registró ninguna solicitud de impresión ni ninguna exportación;
  - mantener todas las comprobaciones de H-02 y documentar las nuevas en `docs/quality/testing.md`.

  Verificar que `corepack pnpm check:web-security-policy` termina en 0 después del build.

## 5. Verificación y cierre de H-03 en la aplicación

- [x] 5.1 Ejecutar `corepack pnpm verify` completo y `openspec validate --all --strict`. Si falla
  una prueba inestable ya registrada en `technical-debt.md`, informar el código de salida real y
  aportar la evidencia aislada o de control, sin marcar la tarea como completa.
- [x] 5.2 Marcar H-03 como «APPLICATION LAYER COMPLETE» en
  `docs/quality/manual-mvp-test-2026-10-09.md` y en `docs/quality/definition-of-done.md`, con el
  techo de cuerpo del borde diferido al hardening del despliegue. Verificar que
  `corepack pnpm format:check` pasa.
