# Tasks

## 1. `DATA_EXPORT_DIRECTORY`, `TRUST_PROXY` y `BETTER_AUTH_URL` por ambiente

- [x] 1.1 En `backend/src/config/env.ts`, exigir `DATA_EXPORT_DIRECTORY` en producción desde
  `.superRefine`, y añadir `loadDataExportDirectory(env)` (design D2): en producción, sin crear
  nada, comprueba con `lstatSync` que la ruta existe, que es un directorio real (no un enlace
  simbólico), que pertenece al proceso (la regla de `package-files.ts#privateDirectory`) y, con
  `accessSync(R_OK | W_OK | X_OK)`, que el proceso puede usarlo; cada fallo es un `EnvError` que
  nombra la variable y la regla. `backend/src/main.ts` la llama con `loadOrExit` antes de
  `dataPortabilityModule` y de escuchar. Sin cambios en desarrollo ni en pruebas.

  Verificar con pruebas en `backend/test/env.test.ts`, con directorios temporales reales:
  - en producción, un directorio absoluto, existente, propio y utilizable: se acepta y se usa;
  - en producción, sin la variable: `EnvError` que nombra `DATA_EXPORT_DIRECTORY`, sin crear nada;
  - en producción, una ruta relativa: `EnvError`;
  - en producción, una ruta absoluta inexistente: `EnvError`, sin crearla;
  - en producción, un enlace simbólico a un directorio válido: `EnvError`;
  - en producción, un archivo que no es un directorio: `EnvError`;
  - en producción, un directorio de otro usuario (con el `uid` sustituido en la prueba, sin
    privilegios): `EnvError`;
  - en producción, un directorio sin permiso de escritura (modo `0500`; se omite si el proceso
    corre como root): `EnvError`;
  - un arranque real de `main.ts` en producción con un directorio inexistente termina con código
    1 antes de escuchar, con un mensaje que nombra la variable y la regla, sin una pila;
  - en desarrollo y en pruebas, sin la variable: sigue funcionando con el directorio temporal por
    defecto, como hasta ahora;
  - ningún mensaje de error contiene la ruta.
- [x] 1.2 En `backend/src/config/env.ts`, sustituir el `transform` de `TRUST_PROXY` por la
  gramática de design D3 (un entero de saltos mayor o igual que 1; una dirección IP; un bloque
  CIDR con prefijo de 1 en adelante; una lista separada por comas de direcciones o bloques; o
  `loopback`, solo), validada con `node:net.isIP` y una comprobación de CIDR propia, sin
  dependencias nuevas, y la misma en todos los ambientes. `false` solo se admite fuera de
  producción, donde es el valor por defecto; en producción, ausente o `false` es un error.

  Verificar con pruebas en `backend/test/env.test.ts`:
  - en producción: `1`, `2`, una dirección IPv4, una IPv6, un CIDR de cada familia, una lista con
    espacios y `loopback` se aceptan, con el valor normalizado que llega a Express;
  - en producción: ausente, `false` y `true` son `EnvError`;
  - en cualquier ambiente: `0`, `-1`, `01`, `1.5`, `linklocal`, `uniquelocal`, `loopback`
    mezclado en una lista, un texto arbitrario, una dirección malformada, un CIDR con prefijo fuera
    de rango, `0.0.0.0/0`, `::/0`, una máscara en notación de puntos, un elemento vacío y una
    dirección con zona o corchetes son `EnvError`;
  - en desarrollo y en pruebas, sin la variable: sigue en `false`, como hasta ahora;
  - el valor resuelto llega a `createApp` sin cambios de comportamiento para las formas ya
    admitidas (número y `false`), con una prueba de regresión sobre `trustProxy` en
    `backend/test/app.test.ts` o equivalente.
- [x] 1.3 En `backend/src/config/env.ts`, añadir a `.superRefine` la regla de design D4: en
  producción, si `BETTER_AUTH_URL` es `http:` y su `hostname` no es exactamente `localhost`,
  `127.0.0.1` ni `[::1]`, `EnvError`. No se toca `canonicalOrigin` ni la comparación de origen de
  H-03.

  Verificar con pruebas en `backend/test/env.test.ts`:
  - en producción, `https://…`: se acepta;
  - en producción, `http://localhost:…`, `http://127.0.0.1:…` y `http://[::1]:…`: se aceptan;
  - en producción, `http://` con otro host, incluidos `localhost.example.com` y
    `127.0.0.1.example.com`: `EnvError`;
  - una prueba de `backend/test/platform/request-origin.test.ts` o de integración confirma que la
    comparación exacta del origen canónico no cambia con un `BETTER_AUTH_URL` en `https:`.

  Verificar también que `corepack pnpm format:check` pasa.

## 2. `NODE_ENV` obligatorio

- [x] 2.1 En `backend/src/config/env.ts`, quitar `.default("development")` de `NODE_ENV` (design
  D1). Verificar con pruebas en `backend/test/env.test.ts`:
  - sin la variable: `EnvError` que nombra `NODE_ENV`, sin mostrar otro valor del entorno, también
    en un arranque real de `main.ts`, que termina antes de escuchar;
  - con `development`, `test` o `production` explícitos y el resto de la configuración válida para
    ese ambiente: se acepta;
  - con un valor fuera del enumerado: `EnvError`, sin repetir el valor.
- [x] 2.2 Declarar `NODE_ENV: "development"` en los arranques de design D1 que hoy no lo fijan:
  `scripts/check-dev-start.ts` y `backend/test/integration/e2e-backend.ts` (antes de
  `...options.env`). Revisar `backend/src/commands/admin-recover.ts` y confirmar que ya depende de
  `.env` (vía `--env-file-if-exists`), documentado en `backend/.env.example`; sin cambio de código
  si así es.

  Verificar que `corepack pnpm check:dev-start` sigue pasando, y que
  `backend/test/integration/e2e-request-protection.test.ts` sigue pasando con el control de origen
  de Better Auth activo.
- [x] 2.3 Declarar `NODE_ENV` en el objeto `valid` de `backend/test/env.test.ts` y en los
  arranques de `backend/test/integration/provisioning.test.ts` y
  `backend/test/integration/recovery.test.ts` (`development` donde no se prueba el ambiente a
  propósito), sin editar las pruebas que ya se comportan bien. Verificar que
  `corepack pnpm exec vitest run --project backend test/env.test.ts` y las pruebas de
  aprovisionamiento y de recuperación pasan.

## 3. `API_INTERNAL_URL` obligatorio en producción, al construir y al ejecutar

- [x] 3.1 Crear `frontend/src/lib/api-internal-url.ts` con la regla de design D5 (ausente: error
  si se exige, bucle local si no; presente: URL absoluta `http:` o `https:`, sin credenciales, solo
  un origen; los errores nombran la variable y la regla, nunca el valor). En
  `frontend/next.config.ts`, exportar una función de la fase que exige el destino en toda fase
  salvo `PHASE_DEVELOPMENT_SERVER`. En la ruta de descarga, exigirlo cuando
  `process.env.NODE_ENV === "production"`, y responder `500` con `Cache-Control: no-store`, sin
  contactar ningún destino, si falta o es inválido.

  Verificar con pruebas en `frontend/test/`:
  - el módulo: ausente exigido, vacío exigido, no URL, otro esquema, con credenciales, con ruta,
    consulta o fragmento son errores sin el valor en el mensaje; `http:` y `https:` de solo origen
    se aceptan; ausente no exigido da el bucle local;
  - la configuración de Next.js: en la fase de build, sin la variable o con un valor inválido,
    lanza un error que nombra `API_INTERNAL_URL`; con un valor válido, el reenvío de `/api` va a
    ese destino; en la fase de desarrollo, sin la variable, va al bucle local;
  - la ruta de descarga: en producción y sin la variable, responde `500` con `no-store` sin
    contactar el servidor de prueba; en pruebas, sigue reenviando como hasta ahora.
- [x] 3.2 Crear `scripts/build-for-verification.ts` (design D5), que ejecuta `corepack pnpm build`
  con `API_INTERNAL_URL=http://127.0.0.1:4000` explícito, sin shell, y devuelve su código, y usarlo
  en el paso `build` de `verify` en `package.json`. Verificar:
  - sin la variable, `corepack pnpm --filter @facturador/frontend build` falla con un mensaje que
    nombra `API_INTERNAL_URL`;
  - con `API_INTERNAL_URL` explícito, el build termina y el manifiesto reenvía a ese destino;
  - el paso de build de verificación termina y `check:web-security-policy` sigue pasando sobre él.

  Verificar que `corepack pnpm format:check` pasa.

## 4. Documentación

- [x] 4.1 Actualizar `docs/architecture/deployment.md` (design D3, D5, D7 y D8):
  - `NODE_ENV` entra en la tabla de variables, obligatorio, sin valor por defecto;
  - la fila de `TRUST_PROXY` describe la gramática validada, que es obligatoria en producción, y
    advierte que un número de saltos solo es correcto si el despliegue garantiza esa longitud de la
    cadena de proxies, con la verificación de la topología real en la prioridad 5;
  - la fila de `DATA_EXPORT_DIRECTORY` dice que en producción debe existir de antemano, propia y
    utilizable, sin autocreación;
  - la fila de `BETTER_AUTH_URL` menciona la exigencia de `https:` en producción y la excepción
    exacta de bucle local;
  - la fila de `API_INTERNAL_URL` (o la sección del frontend) dice que es obligatoria en el build y
    en la ejecución de producción, como URL `http:` o `https:` de solo origen, y que debe coincidir
    con el valor usado al construir ese build;
  - “Requisitos del servidor” deja de decir que la salud informa la desviación del reloj, y pasa a
    pedir evidencia operativa de sincronización (`chrony`, `systemd-timesyncd`/`timedatectl`,
    `node_exporter` o equivalente, sin imponer uno), con la mención a la prioridad 5 para el
    procedimiento concreto;
  - se retira `CORS_ORIGIN` de “Environment” y de los ejemplos de despliegue por rutas.
- [x] 4.2 Corregir `docs/architecture/non-functional-requirements.md`: la fila de CTX §20.5 pasa de
  “alerta de desviación en la salud” a evidencia operativa fuera de la aplicación, y la fila de
  RNF-012 ya no dice que la salud mide el reloj. Corregir igual la misma afirmación en
  `docs/architecture/fiscal-emission.md` y `docs/security/threat-model.md`.
- [x] 4.3 Corregir `docs/quality/definition-of-done.md`: el requisito de go-live sobre el reloj pide
  evidencia operativa de sincronización, no una medición de la aplicación.
- [x] 4.4 Actualizar `docs/quality/technical-debt.md` con el encargo a la prioridad 5: aprovisionar
  el directorio durable de exportación (propietario, permisos y volumen), el proxy inverso real con
  su valor de `TRUST_PROXY` para esa topología, TLS y HSTS, y la evidencia concreta de
  sincronización del reloj del host o del contenedor.

  Verificar que `corepack pnpm format:check` pasa y que ningún documento sigue afirmando que la
  salud de la aplicación mide la desviación del reloj ni que el proyecto usa `CORS_ORIGIN`
  (revisión de texto sobre los archivos de este grupo).

## 5. Verificación

- [ ] 5.1 Prueba de humo en modo producción, sin tráfico al SRI y solo con secretos sintéticos:
  backend con `NODE_ENV=production`, Postgres local de pruebas, una clave maestra de custodia
  sintética generada al azar solo para ese proceso (formato válido, distinta de la de ejemplo,
  nunca registrada, impresa ni versionada), un `BETTER_AUTH_SECRET` sintético, un
  `DATA_EXPORT_DIRECTORY` absoluto y preexistente, `TRUST_PROXY=loopback`,
  `BETTER_AUTH_URL=http://localhost:<puerto>` y `SRI_TRANSMISSION_ENABLED=0`; frontend construido
  para producción con `API_INTERNAL_URL` explícito y servido con `next start`. Sin credenciales,
  certificados, contraseñas ni datos reales o de la certificación. Verificar que la API arranca,
  que `/health/live` y `/health/ready` responden, que la interfaz carga, y que la API rechaza el
  arranque de producción con cada regla nueva incumplida, sin crear ni enviar ningún comprobante
  fiscal.
- [ ] 5.2 Ejecutar las pruebas dirigidas (`backend/test/env.test.ts` y las del frontend de 3.1),
  `corepack pnpm openspec:validate`, `corepack pnpm security:dependencies`,
  `corepack pnpm security:secrets` y el `corepack pnpm verify` completo. Si una prueba inestable ya
  registrada en `technical-debt.md` falla, informar el código de salida real con la evidencia
  aislada o de control, sin marcar la tarea como completa.
- [ ] 5.3 Publicar la rama del cambio (no `main`) y registrar la evidencia de su CI: `verify` y
  `security` en verde, con la validación estricta de OpenSpec dentro de `verify`.
