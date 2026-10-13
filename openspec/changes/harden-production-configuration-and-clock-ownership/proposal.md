# Proposal

## Why

Es la prioridad 4 del hardening del go-live: configuración segura de producción y la propiedad de
la sincronización del reloj (`docs/quality/sri-certification.md`). La readiness del 2026-10-12
encontró que la API nunca sabe con certeza que corre en producción, y que la documentación afirma
una comprobación de salud que no existe.

**Evidencia de la readiness:**
- **`NODE_ENV` tiene un valor por defecto** (`development`) en `backend/src/config/env.ts`. Toda la
  seguridad que depende de `NODE_ENV === "production"` (cookies `Secure`, el rechazo del secreto y
  la clave de ejemplo, exigir la custodia de la firma) queda desactivada en silencio si la variable
  falta al arrancar en un servidor real.
- **`DATA_EXPORT_DIRECTORY` es opcional**, incluso documentado como obligatorio en producción
  (`docs/architecture/deployment.md`). Sin valor, cae en un subdirectorio del temporal del sistema,
  que un contenedor puede vaciar al reiniciar, y los paquetes de portabilidad listos se pierden.
- **`TRUST_PROXY` acepta cualquier cadena sin validar** y la pasa tal cual a Express. El esquema
  solo rechaza `"true"`; cualquier otro texto, incluido uno malformado, llega al `trust proxy` de
  Express sin comprobación.
- **`BETTER_AUTH_URL` admite `http:` en producción**, aunque las cookies pasan a `Secure` con
  `NODE_ENV=production` (`better-auth/index.ts`): una sesión real con un origen público HTTP
  fallaría en silencio.
- **`API_INTERNAL_URL` del frontend cae en `http://127.0.0.1:4000`** si falta al construir el
  build de producción (`frontend/next.config.ts`), y la ruta de descarga de portabilidad lee la
  misma variable en tiempo de ejecución, sin relación garantizada con el valor del build.
- **La documentación afirma algo que no existe.** `deployment.md:355` y
  `non-functional-requirements.md:22` y `:54` dicen que la salud informa la desviación del reloj;
  `backend/src/platform/health/health.ts` no mide nada de eso, y no hay ningún cliente NTP ni
  comparación de reloj en el código.
- **No hay un umbral de desviación normativo** en el ERS, en CTX ni en ningún documento del
  proyecto, y comparar el reloj de la aplicación con el de PostgreSQL no demuestra cuál de los dos,
  si alguno, está sincronizado con la hora real.

## What Changes

- **`NODE_ENV` pasa a ser obligatorio en el backend**, sin valor por defecto. Falta o un valor fuera
  de `development`, `test` o `production` impide arrancar, con el mismo estilo de `EnvError` que ya
  usa el resto del esquema. Cada lanzamiento del backend (desarrollo, pruebas, producción) lo
  declara de forma explícita.
- **`DATA_EXPORT_DIRECTORY` es obligatorio en producción**, y debe ser:
  - una ruta absoluta;
  - un directorio que ya existe, no un enlace simbólico;
  - propiedad del proceso y de uso privado, con las mismas reglas que ya aplica
    `backend/src/modules/data-portability/infrastructure/package-files.ts` al leerlo;
  - utilizable por el proceso (lectura, escritura y acceso).

  Producción nunca crea el directorio ni cae en el temporal del sistema, y un incumplimiento
  detiene el arranque antes de escuchar con un error controlado, sin una pila. En desarrollo y en
  pruebas, sigue siendo opcional, con la conveniencia actual.
- **`TRUST_PROXY` se valida con una gramática explícita y estrecha** en vez de pasar cualquier
  texto a Express: un número de saltos mayor o igual que 1, una dirección IP, un bloque CIDR, una
  lista separada por comas de direcciones o bloques, o `loopback`, solo. Todo lo demás (`true`,
  `0`, negativos, `linklocal`, `uniquelocal`, un bloque `/0`, texto arbitrario) se rechaza en
  cualquier ambiente. En producción es obligatorio: ni ausente ni `false`. En desarrollo y en
  pruebas, sigue por defecto en `false`. La documentación advierte que un número de saltos solo es
  correcto si el despliegue garantiza esa longitud de la cadena de proxies.
- **`BETTER_AUTH_URL` exige `https:` en producción**, salvo para el bucle local (exactamente
  `localhost`, `127.0.0.1` o `::1`; un host que solo se les parece falla), reservado a una prueba de humo del software de producción sin exponerlo de
  verdad. No cambia el origen canónico de H-03 ni su comparación exacta.
- **`API_INTERNAL_URL` del frontend es obligatorio en producción, al construir y al ejecutar**,
  sin caer en `127.0.0.1:4000` en ninguna de las dos fases: el build de producción falla si falta o
  no es una URL `http:` o `https:` válida, y la ruta de descarga falla de forma determinista en
  producción si falta. Nunca se deriva de `Host` ni de una cabecera reenviada. El build de
  `verify` lo declara de forma explícita. La documentación deja explícito que el valor de la
  ejecución debe coincidir con el usado al construir ese build; no se añade una huella del build.
- **La documentación deja de afirmar una medición que no existe.** La salud y las métricas no
  miden la desviación del reloj; la sincronización del reloj del servidor (NTP o equivalente) es
  responsabilidad de la infraestructura del despliegue, con su propia evidencia operativa, no de la
  aplicación. El requisito de un reloj sincronizado se mantiene; solo cambia quién lo mide y cómo se
  demuestra.
- **Documentación corregida de `CORS_ORIGIN`**, una variable de la plantilla original que el
  proyecto no usa (H-03 mantiene la API en el mismo origen, sin CORS).

**Fuera de alcance:**
- Cualquier medición de reloj dentro de la aplicación: sin cliente NTP, sin servicio externo de
  hora, sin comparación con el reloj de PostgreSQL como prueba de exactitud, sin umbral de
  desviación y sin campo nuevo en `/health/ready`.
- Un guardia de emisión o de firma fiscal basado en la desviación del reloj.
- El proxy inverso real, HSTS y el límite de frecuencia: quedan para la prioridad 5.
- Cambiar `SRI_TRANSMISSION_ENABLED`, que ya nace deshabilitado y solo `1` lo habilita.
- `XSD_DIRECTORY` y `RIDE_FONTS_DIRECTORY`: su verificación por hash y su reflejo en `/health/ready`
  no cambian.
- La rotación de la clave maestra, el escaneo de dependencias o de secretos, y cualquier cambio
  fiscal. Ningún paso contacta el SRI, ni Pruebas ni Producción.

## Capabilities

### New Capabilities
- `production-configuration`: la aplicación exige y valida al arrancar, o al construir el frontend,
  la configuración que solo tiene sentido en un despliegue real: el ambiente declarado, el
  directorio de los paquetes de portabilidad, el límite de confianza del proxy, el origen público
  de la autenticación y el destino interno de la API. Un valor ausente o inseguro impide arrancar o
  construir, antes de aceptar tráfico.

### Modified Capabilities
<!-- Ninguna: `api-request-protection` (H-03) y `data-portability` no cambian sus requisitos; solo
ganan una condición más, ya cubierta por `production-configuration`, para que su configuración sea
válida en producción. -->

## Impact

- **Backend:**
  - `backend/src/config/env.ts`: `NODE_ENV` sin valor por defecto, la validación de
    `DATA_EXPORT_DIRECTORY`, `TRUST_PROXY` y `BETTER_AUTH_URL` condicionada al ambiente;
  - `backend/src/main.ts`: la comprobación previa del directorio de exportación, antes de
    escuchar;
  - `backend/src/commands/admin-recover.ts`: sin cambio de código, ya lee `.env`.
- **Frontend:** `frontend/src/lib/api-internal-url.ts` (nuevo), `frontend/next.config.ts` y la ruta
  de descarga de portabilidad exigen `API_INTERNAL_URL` en producción.
- **Arneses y scripts:** `scripts/check-dev-start.ts`, `backend/test/integration/e2e-backend.ts` y
  los arranques de `backend/test/env.test.ts` y `provisioning.test.ts` declaran `NODE_ENV` de forma
  explícita; `scripts/build-for-verification.ts` (nuevo) construye el build de `verify` con
  `API_INTERNAL_URL` explícito.
- **Documentación:**
  - `docs/architecture/deployment.md`: `NODE_ENV`, la nueva gramática de `TRUST_PROXY`, el
    directorio de exportación preaprovisionado, el origen de Better Auth, `API_INTERNAL_URL` y la
    corrección sobre el reloj; se retira `CORS_ORIGIN`;
  - `docs/architecture/non-functional-requirements.md`: la fila de RNF-012 y la de CTX §20.5, sin la
    medición de la aplicación;
  - `docs/quality/definition-of-done.md`: la evidencia del go-live sobre el reloj pasa a ser
    operativa de la infraestructura;
  - `docs/quality/technical-debt.md`: el encargo a la prioridad 5 (aprovisionar el directorio
    durable, el proxy inverso, el valor de `TRUST_PROXY` de esa topología y la evidencia de
    sincronización del reloj).
- **Sin cambios** en el motor fiscal, la transmisión al SRI, los endpoints de salud (más allá de lo
  ya dicho) ni la evidencia de la certificación.
