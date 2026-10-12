# Design

## Context

La motivación y el modelo de amenazas están en `proposal.md`, y los requisitos en
`specs/api-request-protection/spec.md`. Este es el estado observado en el código durante la
readiness (2026-10-12):

- **`createApp`** (`backend/src/app.ts`) monta, en este orden:
  1. `requestId`;
  2. `pino-http`, sin cabeceras, IP ni cuerpos;
  3. `helmet`;
  4. las métricas HTTP;
  5. `/health` y `/metrics`;
  6. `mountBeforeBodyParser`, donde va Better Auth;
  7. `express.json({ limit: "100kb" })`, salvo `jsonBodyExceptions`;
  8. `/api/v1`, cuyo router empieza con `requireContext`.

  No hay CORS ni `urlencoded`. `trust proxy` sale de `TRUST_PROXY`, por defecto `false`.
- **Excepciones de cuerpo.** Firma: JSON de hasta el límite derivado de `CERTIFICATE_MAX_BYTES`.
  Guía: 2 MiB. Liquidación: 4 MiB. Logo: `express.raw` de hasta `LOGO_MAX_BYTES`. Las grandes se
  leen dentro de su router, después de `requireContext`. El desborde ya responde 413
  `PAYLOAD_TOO_LARGE`, y el logo responde 415 `UNSUPPORTED_MEDIA_TYPE` ante otro tipo.
- **Better Auth.** Lo monta `mountAuth`:
  - una allowlist con tres endpoints: `POST /sign-in/email`, `/sign-out` y `/change-password`;
  - `serverHeaders`, que escribe la IP con `req.ip`;
  - `reportRateLimits`;
  - `toNodeHandler(auth)`.

  `toNodeHandler` (better-call 1.4.0) lee el cuerpo **sin `bodySizeLimit`** y arma la URL con
  `X-Forwarded-Proto` y `Host`.
- **La defensa propia de Better Auth** (1.7.7). En los métodos distintos de `GET`, `HEAD` y
  `OPTIONS`, con cookie, valida `Origin` (o `Referer`) contra `BETTER_AUTH_URL` y responde 403. En
  el primer inicio de sesión usa Fetch Metadata y `Origin`. Se relaja con `NODE_ENV=test`, así que
  las pruebas en proceso no la ejercitan; el backend que arranca el arnés end-to-end sí.
- **El frontend** envía las tres llamadas de autenticación como JSON. El cierre de sesión envía
  `{}`, un cuerpo no vacío de 2 bytes. Ninguno de los tres endpoints necesita otro tipo de
  contenido.
- **`OPTIONS /api/v1/...`** llega hoy a `requireContext` y, sin sesión, responde 401 sin cabeceras
  `Access-Control-*`. Un preflight nunca lleva cookies.
- **Las pruebas de integración** arman la aplicación con `buildAuthApp`
  (`backend/test/integration/auth-harness.ts`) o `buildTestApp` (`backend/test/helpers.ts`), y
  llaman con `supertest`. Treinta y siete archivos mutan `/api/v1` sin `Origin`. El arnés
  end-to-end, los benchmarks y `check:web-security-policy` ya lo envían.
- **Eventos de seguridad.** Una unión `SecurityEvent` con log estructurado y contadores
  (`backend/src/modules/identity/infrastructure/security-event-log.ts`), sin base de datos ni
  auditoría.

## Goals / Non-Goals

**Goals:**
- Rechazar antes del cuerpo y de la autenticación las mutaciones de `/api/v1` sin el origen
  canónico, y las peticiones `same-site` o `cross-site` según Fetch Metadata.
- Acotar a 8192 bytes reales el cuerpo de `/api/auth/*` y exigir JSON en un cuerpo no vacío, sin
  dejar a Better Auth sin su cuerpo.
- Mantener sin cambios el comportamiento de las peticiones legítimas, de `OPTIONS` y de la defensa
  propia de Better Auth.

**Non-Goals:**
- CORS, varios orígenes y clientes fuera del navegador.
- Cambiar la semántica de los `GET` con efectos.
- Configurar el proxy.
- Tocar los controles de CSRF de Better Auth o su límite de intentos.
- Cambiar los límites de cuerpo de `/api/v1`.

## Decisions

### D1. Una guarda en `/api/v1`, antes del parser y de `requireContext`

`createApp` recibe la dependencia nueva `requestOrigin: { canonical: string; onRejected?:
(rejection) => void }`. Monta `app.use("/api/v1", requestOriginGuard(...))` entre
`mountBeforeBodyParser` y el parser JSON:

```text
requestId → pino-http → helmet → métricas → /health, /metrics → Better Auth (/api/auth)
→ guarda de /api/v1 → express.json (con sus excepciones) → /api/v1 (requireContext, rutas)
```

Así el rechazo ocurre antes de leer cualquier cuerpo, incluidos los de 2 y 4 MiB que se leen
dentro de los routers. También ocurre antes de consultar la sesión y antes de cualquier lógica de
dominio. Las métricas HTTP registran el 403 como cualquier otra respuesta.

**Orden dentro de la guarda:**
1. **`OPTIONS`** sigue sin evaluar nada, y conserva el 401 actual (D5).
2. **Fetch Metadata** (D3), en todos los demás métodos.
3. **Origen** (D2), solo en `POST`, `PUT`, `PATCH` y `DELETE`.

La primera regla que falla decide la categoría del rechazo.

**Alternativas descartadas:**
- **La guarda dentro de `requireContext` o del router de `/api/v1`:** llegaría después del parser
  JSON general.
- **La guarda en el proxy de Next.js o en el proxy inverso:**
  - el `proxy.ts` de Next excluye `/api` a propósito (H-02);
  - con `proxy.ts` activo, Next trunca sin error los cuerpos de más de 10 MB
    (`proxyClientMaxBodySize`);
  - el proxy inverso no existe todavía en el repositorio.

  La autoridad sobre el origen es la aplicación.

### D2. Comparación exacta con el origen canónico

Para una mutación, la guarda lee la cabecera `Origin`, sin unirla con otras ni usar `Referer`:

| Caso | Categoría |
| --- | --- |
| Ausente | `missing_origin` |
| `null` | `null_origin` |
| No se analiza como URL, o su `URL.origin` difiere del valor recibido (trae ruta, barra final, usuario o espacios) | `malformed_origin` |
| Bien formado pero distinto del canónico (otro esquema, host o puerto) | `origin_mismatch` |
| Igual al canónico, carácter por carácter | Sigue |

Los navegadores serializan `Origin` en minúsculas, sin barra y sin puerto por defecto, igual que
`URL.origin`, así que la comparación exacta no rechaza peticiones legítimas.

`Host`, `X-Forwarded-Host`, `Forwarded` y `X-Forwarded-Proto` no intervienen, y `TRUST_PROXY` no
cambia el resultado.

### D3. Fetch Metadata en todos los métodos salvo `OPTIONS`

Si `Sec-Fetch-Site` está presente y vale `same-site` o `cross-site`, la guarda rechaza con la
categoría `fetch_site_same_site` o `fetch_site_cross_site`. `same-origin`, `none` o la ausencia de la
cabecera siguen hacia la regla de origen.

- **Cubre los `GET` con efectos**, como la exportación de reportes: una navegación de nivel
  superior desde otro sitio lleva la cookie `Lax`, pero también `Sec-Fetch-Site: cross-site`.
- **No rechaza al servidor del frontend.** La ruta de descarga de Next reenvía un `GET` sin
  `Sec-Fetch-*` porque solo copia `cookie`, `accept`, `accept-language` y `user-agent`.
- **No rechaza el uso normal de la interfaz.** El reenvío general de `/api` lleva las cabeceras del
  navegador, con `same-origin`.

Un valor desconocido de `Sec-Fetch-Site` no se rechaza por sí solo: la regla de origen sigue
aplicando a las mutaciones.

### D4. Origen canónico al arrancar, sin forma de desactivarlo

`main.ts` deriva el origen canónico de `env.BETTER_AUTH_URL` con `new URL(...).origin`. El esquema
de entorno ya exige una URL `http` o `https`; el arranque comprueba además que el origen resultante
sea `http(s)://…` y no `null`. Si no lo es, falla con un `EnvError` que nombra `BETTER_AUTH_URL` sin
mostrar su valor.

No hay ninguna variable para desactivar la guarda ni para añadir orígenes. Better Auth ya usa el
mismo `BETTER_AUTH_URL` como origen de confianza, así que la API y la autenticación comparten la
única fuente.

### D5. Ni CORS ni `OPTIONS` nuevos

No se añade ninguna cabecera `Access-Control-*`. `OPTIONS` atraviesa la guarda sin evaluarse y
sigue en `requireContext` con su 401 actual: un preflight entre orígenes falla igual que hoy.

Se evita que Fetch Metadata convierta ese 401 en un 403, porque ambos fallan el preflight, pero la
decisión del dueño es conservar el comportamiento. La prueba de regresión lo fija: mismo estado y
ninguna cabecera `Access-Control-*`.

### D6. Adaptador acotado para Better Auth

`mountAuth` sustituye `toNodeHandler(auth)` por un adaptador propio, tras la allowlist,
`serverHeaders` y `reportRateLimits`:

1. **Tipo de contenido.** Si la petición declara un cuerpo (`Content-Length` mayor que 0 o
   cualquier `Transfer-Encoding`) y no es `application/json` (con o sin parámetros), responde 415
   `UNSUPPORTED_MEDIA_TYPE` sin leer el cuerpo.
   - La regla se decide con las cabeceras, no con `type-is.hasBody`, que considera un cuerpo a
     `Content-Length: 0`.
   - Un cuerpo `chunked` vacío y sin tipo de contenido cuenta como declarado. Ningún cliente actual
     lo envía: el cierre de sesión manda `{}` en JSON.
2. **Lectura acotada.**
   - **Con `Content-Length` mayor que 8192:** el adaptador responde 413 al ver la cabecera, sin leer
     nada. El parser de Express no basta para este caso: detecta el exceso sin acumular, pero
     descarta el cuerpo entero antes de informar el error, y el cliente tendría que terminar de
     enviarlo para recibir la respuesta (corrección durante la implementación).
   - **En modo `chunked` o sin `Content-Length`:** `express.raw({ type: "application/json", limit:
     8192 })`, que usa `raw-body`, como el logo, cuenta los bytes que Node entrega para esta
     petición. Al pasar de 8192 deja de acumular, descarta el resto y falla con
     `entity.too.large`.

   El manejador de errores convierte ambos casos en el 413 `PAYLOAD_TOO_LARGE` de la API. La
   memoria queda acotada al límite más un fragmento del flujo.

   **Frontera del encuadre HTTP (revisión).** La aplicación controla el cuerpo tal como Node lo
   analiza y lo entrega.
   - Un mensaje con un encuadre malformado o ambiguo es un asunto de la frontera de transporte del
     servidor y del proxy. Por ejemplo, un `Content-Length` contradictorio con `chunked`, o bytes
     de más tras el cuerpo declarado.
   - Este cambio no reinterpreta el flujo HTTP crudo en Express ni lo convierte en un proyecto de
     *request smuggling*.
   - Si Node rechaza el encuadre antes del código de la aplicación, se acepta y se documenta esa
     frontera.
3. **Petición para Better Auth.** Con el cuerpo ya en un `Buffer` de como máximo 8192 bytes, arma
   un `Request`:
   - **URL:** el origen canónico de `BETTER_AUTH_URL` más la ruta y la consulta reales
     (`req.originalUrl`). Nunca se toma de `Host`, `X-Forwarded-Host`, `Forwarded` ni
     `X-Forwarded-Proto`.
   - **Método:** el de la petición.
   - **Cabeceras:** las de Node, sin las de salto a salto ni las de encuadre. Se descartan
     `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`,
     `proxy-authorization`, `proxy-authenticate` y `content-length`, que el `Request` recalcula,
     además de cualquier cabecera que nombre `Connection`. También `content-encoding`, porque el
     parser entrega el cuerpo ya descomprimido, y el límite cuenta esos bytes. Se conservan la cookie, `Origin`,
     `Referer`, `Sec-Fetch-*`, `Accept`, `User-Agent`, `Content-Type` y la IP que escribe el
     servidor, y las demás cabeceras de aplicación pasan como hoy.
   - **Cuerpo:** el `Buffer`, o ninguno si está vacío.

   Luego llama a `auth.handler(request)`.
4. **Respuesta.** Escribe en la respuesta de Node el estado, las cabeceras de Better Auth (cada
   `Set-Cookie` por separado, con `getSetCookie()`, y el resto tal cual) y el cuerpo.
5. **Cancelación y error.** Si el cliente corta la petición o el flujo falla antes de terminar,
   `raw-body` falla, `auth.handler` no se llama y el manejador de errores responde según el tipo
   de error, sin datos del cuerpo.

**Paridad con `toNodeHandler` (revisión).** El reemplazo es sensible para la seguridad, así que
pruebas explícitas fijan que se conserva lo observable:
- **De la petición:** el método, la ruta, la consulta, las cookies y las cabeceras normales, la URL
  canónica y los bytes del cuerpo.
- **De la respuesta:** el estado, el cuerpo, el `Content-Type`, varias `Set-Cookie` y las demás
  cabeceras de Better Auth.
- **El corte o error** de la petición.
- **Las cabeceras de salto a salto** no llegan al `Request`.

Estas pruebas se suman a las de contrato de Better Auth que ya existen.

**Por qué funciona:**
- Better Auth recibe exactamente los bytes leídos, nunca un flujo vacío.
- Nunca hay un búfer sin tope.
- `Content-Length` es solo una optimización, porque la cota real la impone el conteo de
  `raw-body`.

**Cuerpo vacío.** Una petición sin `Content-Length` ni `Transfer-Encoding`, o con
`Content-Length: 0`, no exige tipo de contenido, y Better Auth la recibe sin cuerpo.

**Alternativas descartadas:**
- **`getRequest({ bodySizeLimit })` de better-call:** el exceso se convierte en un error dentro del
  análisis del cuerpo de Better Auth, sin un 413 garantizado. Además depende de better-call, que es
  una dependencia transitiva.
- **Un contador propio sobre el flujo:** duplica `raw-body`, que ya resuelve `chunked`, el
  `Content-Length` declarado y el corte al pasar el límite.
- **Dejar que Better Auth lea el flujo y medirlo después:** el búfer ya no tendría tope.

### D7. Contrato de error

| Rechazo | Estado | Código | Mensaje |
| --- | --- | --- | --- |
| Origen o Fetch Metadata en `/api/v1` | 403 | `REQUEST_ORIGIN_REJECTED` | «La solicitud no proviene de la aplicación.» |
| Cuerpo de `/api/v1` | 413 | `PAYLOAD_TOO_LARGE` (sin cambios) | El actual |
| Cuerpo de `/api/auth` | 413 | `PAYLOAD_TOO_LARGE` | «El cuerpo de la solicitud es demasiado grande.» |
| Tipo de contenido de `/api/auth` | 415 | `UNSUPPORTED_MEDIA_TYPE` | Genérico, el mismo código que el logo |

- Todos usan el sobre `{ error: { code, message, requestId } }`, sin el origen canónico, la
  categoría ni el cuerpo.
- La categoría queda solo en el evento de seguridad.
- En los contratos, la descripción compartida del 403 de la API pasa a incluir el rechazo por
  origen, y `openapi.json` se regenera.

### D8. Evento de seguridad y contador

- **Evento.** Nuevo tipo `request_origin_rejected` en `SecurityEvent`: `{ method, route, reason,
  correlationId }`.
  - `route` es una categoría gruesa de la API (revisión): el primer segmento tras `/api/v1`, como
    `documents`, `reports` o `invoices`, o `unknown` si no encaja en `[a-z0-9-]+`.
  - Nunca es la URL cruda: la guarda corre antes del enrutamiento, cuando todavía no hay plantilla
    de ruta, y los identificadores de la ruta no deben guardarse.
  - `reason` es una de las seis categorías de D2 y D3.
- **Log.** `security-event-log` lo escribe en `warn`.
- **Contador.** `http_request_origin_rejections_total`, con las etiquetas `method` y `reason`. La
  ruta queda fuera de las etiquetas para mantener baja la cardinalidad.
- **Lo que no se registra:** el `Origin` recibido, `Referer`, las cookies, los cuerpos, las
  contraseñas, el conjunto de cabeceras y cualquier registro de auditoría de dominio.
- **Respuesta sin caché (revisión).** La guarda pone `Cache-Control: no-store` antes de pasar el
  error, para que ningún intermediario guarde un 403 que depende de la política.
- **Rechazos de la autenticación.** Los 413 y 415 de `/api/auth` aparecen en el log de petición de
  `pino-http`, que ya registra el método, la URL y el estado, sin cabeceras ni cuerpos. No se crea
  otro sistema de eventos.

### D9. Clientes de prueba que envían el origen, como el navegador (revisión)

El origen lo pone el **cliente**, nunca el servidor. La aplicación bajo prueba recibe cada petición
exactamente como en producción. No hay ningún envoltorio que cambie la petición al entrar ni
ninguna cabecera de prueba que entienda el código de la aplicación.

**El cliente:**
- `backend/test/support/http-client.ts` exporta `request(app, options?)`, un reemplazo directo de
  `supertest(app)` con los mismos métodos.
- En `post`, `put`, `patch` y `delete`, el cliente envía `Origin: TEST_ORIGIN`
  (`http://localhost:3000`).
- `TEST_ORIGIN` es el mismo valor que `BASE_URL` del arnés de autenticación, que el
  `BETTER_AUTH_URL` del arnés end-to-end y que el origen canónico con que `buildTestApp` y
  `buildAuthApp` arman la aplicación.
- `get`, `head` y `options` no añaden nada, como un navegador en una petición del mismo origen.

**Las pruebas negativas** construyen la petición sin origen o con otro, en la capa del cliente:
- `request(app, { origin: null })` no envía `Origin`;
- `.set("Origin", "https://otro.ejemplo")` lo sustituye;
- `.set("Sec-Fetch-Site", "cross-site")` lo añade.

**Bajo cambio:** los archivos que mutan con `supertest` cambian solo su línea de importación
(`import request from "supertest"` por el cliente compartido), sin literales de origen ni cambios
en sus llamadas. Los archivos que ya envían su `Origin` lo conservan, porque `.set` lo reemplaza.

El arnés end-to-end (`startE2eBackend`), los benchmarks y `check:web-security-policy` ya envían
`E2E_ORIGIN`.

**Alternativas descartadas:**
- **Un envoltorio del servidor que ponga el origen al entrar:** cambia la petición después de que
  llega a la aplicación, y lo descartó la revisión.
- **Un alias de módulo que sustituya `supertest` en silencio:** esconde el cambio.
- **Literales de origen en cada llamada:** mucho cambio y fácil de olvidar.

### D10. Comprobación de navegador

`check:web-security-policy` sirve dos páginas atacantes desde puertos propios:

- **`http://localhost:3001`:** del mismo sitio que `http://localhost:3000`, porque el sitio no
  depende del puerto. La cookie `Lax` viaja con la petición.
- **`http://127.0.0.1:3001`:** de otro sitio.

Desde cada una, con la sesión del operador abierta en la pestaña de la aplicación:
- un `POST` sin cuerpo y con credenciales a `/api/v1/documents/{id}/print-requests`, enviado como
  petición simple;
- una navegación de nivel superior a la exportación de un reporte.

La comprobación verifica, por la API como administrador, que no se registró ninguna solicitud de
impresión ni ninguna exportación. Sin H-03, el caso del mismo sitio sí registraría la solicitud. Los
puertos son fijos y el resultado es determinista.

Las comprobaciones de H-02 se mantienen todas.

### D11. Documentación y deuda

- `docs/security/hardening.md`: la frontera de confianza, el origen canónico y por qué las cabeceras
  reenviadas no cuentan. Sin copiar los requisitos.
- `docs/architecture/backend.md`: el orden de los middleware.
- `docs/architecture/authentication.md`: el adaptador acotado, el límite y el tipo de contenido.
- `docs/architecture/deployment.md`:
  - `BETTER_AUTH_URL` debe ser el origen público exacto, o toda mutación recibe 403;
  - el techo de cuerpo del borde no puede ser menor que el cuerpo legítimo más grande (4 MiB), con
    8 MiB como objetivo del hardening del despliegue;
  - el ejemplo actual de `client_max_body_size 1m` cubre el logo, pero no los borradores de 2 y 4
    MiB.
- `docs/quality/observability.md`: el evento y el contador.
- `docs/quality/testing.md`: el cliente compartido que envía el origen y cómo lo omiten o sustituyen las pruebas negativas.
- `docs/quality/technical-debt.md`: los `GET` con efectos (exportación de reportes) y el techo del
  proxy.
- H-03 en `manual-mvp-test-2026-10-09.md` y en `definition-of-done.md`.

## Risks / Trade-offs

- **[Un despliegue con `BETTER_AUTH_URL` distinto de su origen público rechaza toda mutación]** →
  Lo documenta `deployment.md`. Better Auth ya falla con ese desajuste, así que no es un modo de
  fallo nuevo.
- **[El adaptador de Better Auth cambia algo que `toNodeHandler` hacía]** → Las pruebas de contrato
  de autenticación y las end-to-end de inicio y cierre de sesión, cambio de contraseña, límite de
  intentos y allowlist deben seguir en verde. El adaptador solo cambia la lectura del cuerpo y la
  base de la URL.
- **[Un archivo de prueba sigue con `supertest` directo y muta sin origen]** → Recibe el 403 de la
  guarda y falla: el fallo señala el archivo que debe usar el cliente compartido. No hay ningún
  atajo del servidor que lo esconda.
- **[Un cambio de contraseña con contraseñas extremas supera 8 KiB]** → Con el máximo configurable
  de 1024 caracteres de 3 bytes cada uno, el cuerpo ronda 6,2 KiB. Solo contraseñas hechas de
  caracteres de control, que JSON escapa a 6 bytes, lo superarían; esas reciben 413.
- **[Fetch Metadata rechaza un uso legítimo de otro sitio]** → No existe ninguno: frontend y API
  comparten origen, y no hay integraciones de terceros.
- **[Navegadores sin Fetch Metadata]** → Siguen protegidos por la regla de origen en las
  mutaciones. Para los `GET` queda la cookie `Lax` y la deuda de semántica HTTP.

## Migration Plan

1. Desplegar el backend. No hay migraciones. El frontend no cambia: el navegador ya envía `Origin`
   y `Sec-Fetch-Site`.
2. El operador confirma que `BETTER_AUTH_URL` es el origen público exacto (esquema, host y puerto).
3. **Reversión:** volver a la versión anterior del backend. No hay datos que migrar.
