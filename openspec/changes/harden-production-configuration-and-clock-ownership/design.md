# Design

## Context

La motivación y el modelo de amenazas están en `proposal.md`, y los requisitos en
`specs/production-configuration/spec.md`. Este es el estado observado en el código durante la
readiness (2026-10-12):

- **`backend/src/config/env.ts`.** Un esquema Zod con `NODE_ENV` por defecto `"development"` y
  reglas de `.superRefine` condicionadas a `env.NODE_ENV === "production"` (el secreto de ejemplo,
  la clave de ejemplo, la custodia deshabilitada, los tiempos por etapa, los endpoints del SRI sin
  TLS). `TRUST_PROXY` se parsea con un `z.string().transform`: `"false"` → `false`, un entero →
  `Number`, `"true"` → error, cualquier otro texto → se devuelve tal cual, sin validar, y llega a
  `app.set("trust proxy", …)`.
- **`DATA_EXPORT_DIRECTORY`** es `z.string().refine(isAbsolute).optional()`. Sin valor,
  `dataPortabilityModule` usa `defaultDirectory()` (`join(tmpdir(), "facturador-data-exports")`).
  `createPackageFiles(root).init()` ya comprueba, para cualquier directorio: lo crea si falta
  (`mkdir recursive`), rechaza un enlace simbólico o algo que no es un directorio, y corrige el
  modo a `0700`; con `process.getuid`, rechaza uno que no pertenece al proceso. Un fallo ahí sale
  como una excepción sin controlar de `main.ts`, con su pila.
- **`BETTER_AUTH_URL`** es `z.url({ protocol: /^https?$/ })`, sin restricción adicional de esquema
  por ambiente. `authSettingsFromEnv` fija `secureCookies: env.NODE_ENV === "production"`.
- **`frontend/next.config.ts`** lee `process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"` al
  construir, para el reenvío de `/api`. `frontend/src/app/api/v1/data-exports/[id]/download/route.ts`
  lee la misma variable, con el mismo valor por defecto, en tiempo de ejecución. El paso `build` de
  `corepack pnpm verify` construye el frontend sin declararla, y `check:web-security-policy` sirve
  después ese build con `next start`, leyendo el puerto del reenvío del manifiesto
  (`apiPortOfBuild()`).
- **Arranques de `main.ts` sin `NODE_ENV` explícito:**
  - `scripts/check-dev-start.ts` hereda `process.env` del shell y no lo fija.
  - El arnés end-to-end (`backend/test/integration/e2e-backend.ts`) **no** hereda `process.env`:
    pasa al hijo solo `PATH` y variables explícitas. Hoy su hijo corre, por el valor por defecto,
    en `development`, también fuera de Vitest (`check:web-security-policy`, los scripts de
    rendimiento de `backend/scripts/` y el sandbox manual). `e2e-request-protection.test.ts`
    depende de ese ambiente: la defensa de origen propia de Better Auth no está activa con
    `NODE_ENV=test`.
  - `backend/test/env.test.ts` (`startupWith`) y `backend/test/integration/provisioning.test.ts`
    arrancan `main.ts` con `PATH` y un entorno explícito, sin `NODE_ENV`, y
    `backend/test/integration/recovery.test.ts` arranca así `admin-recover.ts`.
  - `backend/package.json` (`dev`, `admin:recover`) usa `--env-file-if-exists=.env`, y
    `backend/.env.example` ya documenta `NODE_ENV=development`.
- **La gramática de `trust proxy` de Express** (`proxy-addr`) admite: un número de saltos, una
  dirección o varias separadas por coma, un bloque CIDR (también con máscara en notación de
  puntos), o los nombres `loopback` (`127.0.0.1/8`, `::1/128`), `linklocal` (`169.254.0.0/16`,
  `fe80::/10`) y `uniquelocal` (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`). Este
  cambio acepta un subconjunto más estrecho (D3).
- **La documentación afirma una medición que no existe.** `deployment.md:355` y
  `non-functional-requirements.md:22` y `:54` dicen que la salud informa la desviación del reloj.
  `backend/src/platform/health/health.ts` no tiene ningún campo de reloj, y no hay cliente NTP ni
  comparación de reloj en el código. `docs/quality/definition-of-done.md:91-92` ya habla del «reloj
  del servidor sincronizado» como una verificación de contrato del WSDL, no de la aplicación.
- **Sin umbral normativo.** Ni el ERS, ni CTX §20.5, ni ningún documento del proyecto fijan un
  número de segundos de desviación aceptable.

## Goals / Non-Goals

**Goals:**
- Un despliegue real no puede arrancar ni construirse con una configuración que solo tiene sentido
  en desarrollo.
- Ningún rechazo revela un secreto ni el entorno completo.
- El comportamiento de desarrollo y de pruebas no cambia, salvo que cada arranque declara su
  ambiente y que `TRUST_PROXY` solo admite la gramática de D3.
- La documentación deja de afirmar una medición de reloj que la aplicación no hace.

**Non-Goals:**
- Medir la desviación del reloj dentro de la aplicación, con cualquier fuente.
- Fijar un umbral de desviación.
- Un guardia fiscal basado en el reloj.
- El proxy inverso real, HSTS o el límite de frecuencia.
- Un mecanismo que demuestre en código que el destino interno del build y el de la ejecución
  coinciden (D5).

## Decisions

### D1. `NODE_ENV` sin valor por defecto

Se quita `.default("development")` del campo `NODE_ENV` del esquema. Falta la variable: Zod ya
produce `invalid_type`, que `toEnvError` convierte en «NODE_ENV: es obligatoria», igual que
`DATABASE_URL` hoy; un valor fuera del enumerado da «NODE_ENV: valor inválido», sin repetirlo.
`main.ts` ya convierte un `EnvError` en un mensaje y una salida con código 1 antes de escuchar.

**Arranques que hay que ajustar**, porque hoy no la fijan:
- `scripts/check-dev-start.ts`: añade `NODE_ENV: "development"` al entorno del hijo.
- `backend/test/integration/e2e-backend.ts`: añade `NODE_ENV: "development"` a su entorno
  explícito, antes de `...options.env` (una prueba puede sustituirlo). Conserva el ambiente
  efectivo de hoy para todos sus usuarios, dentro y fuera de Vitest, incluido el control de origen
  de Better Auth que `e2e-request-protection.test.ts` necesita.
- `backend/test/env.test.ts`: el objeto `valid` declara `NODE_ENV: "development"`; `startupWith` y
  las pruebas que ya fijan `"production"` siguen igual, y las pruebas de la ausencia de la
  variable la quitan a propósito.
- `backend/test/integration/provisioning.test.ts` y `backend/test/integration/recovery.test.ts`: su
  arranque declara `NODE_ENV: "development"`.

Las pruebas que ya se comportan bien con el cambio no se editan.

**Alternativas descartadas:**
- **Detectar producción por heurística** (por ejemplo, un `BETTER_AUTH_URL` que no parece de
  desarrollo): añade una segunda fuente de verdad y el owner la descartó.
- **Un valor por defecto distinto, como `"production"`:** rompería el arranque de desarrollo sin
  variables, que es el caso común hoy.

### D2. `DATA_EXPORT_DIRECTORY` obligatorio y preaprovisionado en producción

En el esquema, con `env.NODE_ENV === "production"`, `.superRefine` exige la variable (ausente →
error nombrando la variable); la regla de ruta absoluta (`.refine(isAbsolute)`) no cambia.

Una función nueva de `env.ts`, `loadDataExportDirectory(env)`, siguiendo el patrón de
`loadCertificateCustody` y `loadCanonicalOrigin`, hace la comprobación previa del sistema de
archivos. `main.ts` la llama con `loadOrExit`, antes de `dataPortabilityModule` y de escuchar. En
desarrollo y en pruebas devuelve la variable tal cual (o nada). En producción, sin crear nada:
1. `lstatSync`: si la ruta no existe → «no existe (producción no lo crea)»;
2. un enlace simbólico → «es un enlace simbólico»;
3. algo que no es un directorio → «no es un directorio»;
4. con `process.getuid` disponible, un propietario distinto del proceso → «no pertenece al usuario
   del proceso», la misma regla de `package-files.ts#privateDirectory`;
5. `accessSync(dir, R_OK | W_OK | X_OK)`: si falla → «el proceso no puede leerlo, escribir en él o
   recorrerlo».

Cada fallo es un `EnvError` que nombra `DATA_EXPORT_DIRECTORY` y la regla, nunca la ruta ni un
volcado de `lstat` o de la excepción del sistema. Las dependencias del sistema de archivos y el
`uid` entran por un parámetro opcional, para probar el caso ajeno sin privilegios.

`createPackageFiles(...).init()` sigue igual y sigue aplicando su regla privada (modo `0700`) al
directorio ya existente. `defaultDirectory()` y la creación perezosa de `privateDirectory` solo se
alcanzan en desarrollo y en pruebas, porque en producción la comprobación previa ya exige que el
directorio exista.

**Por qué una comprobación aparte y no solo el esquema.** Comprobar el sistema de archivos no es
responsabilidad de Zod, y ya existe el mismo patrón para la custodia de la firma y el origen
canónico: una función que lee `env` y lanza `EnvError`.

**Por qué `access` y no un archivo de prueba.** `access` comprueba los permisos efectivos del
proceso, incluido un sistema de archivos de solo lectura (`EROFS`), sin escribir nada al arrancar.

**Alternativas descartadas:**
- **Dejar que `privateDirectory` cree el directorio también en producción:** permite que un error de
  ruta cree una carpeta en el volumen equivocado en vez de fallar.
- **Escribir y borrar un archivo de prueba:** añade una escritura en cada arranque solo para
  diagnosticar, lo que `access` ya cubre.

### D3. Gramática validada de `TRUST_PROXY`

Una función de parseo nueva, en el mismo archivo, sustituye el `transform` actual. La misma
gramática vale en todos los ambientes; solo `false` depende del ambiente:
1. `"false"` → `false`. Es el valor por defecto fuera de producción; en producción, `.superRefine`
   lo rechaza, como la ausencia.
2. Un entero decimal mayor o igual que 1, sin ceros a la izquierda (`/^[1-9]\d*$/`) y dentro de
   `Number.isSafeInteger` → `Number` (saltos de confianza).
3. `"loopback"`, solo → la cadena `"loopback"`.
4. Si no, se divide por comas, se recortan los espacios de cada elemento, y cada uno debe ser:
   - una dirección IPv4 o IPv6 aceptada por `node:net.isIP`, sin identificador de zona (`%`) ni
     corchetes; o
   - un bloque CIDR `dirección/prefijo`, con el prefijo decimal sin ceros a la izquierda, entre 1
     y 32 para IPv4 o entre 1 y 128 para IPv6.

   Si todos son válidos y no hay elementos vacíos, se devuelve la lista normalizada, unida por
   comas, que es el formato que espera `app.set("trust proxy", …)`. Si alguno no lo es, error.

Todo lo demás es un error en cualquier ambiente y nunca llega a Express: `true`, `0`, un negativo,
un número malformado, `linklocal`, `uniquelocal`, `loopback` mezclado con otras entradas, un texto
arbitrario, una dirección o un bloque malformados, una máscara en notación de puntos y un bloque
de longitud 0 (`0.0.0.0/0`, `::/0`), que confía en cualquier dirección igual que `true`.

En `.superRefine`, con `NODE_ENV === "production"`: `TRUST_PROXY` ausente o resuelto a `false` es
un error.

**El número de saltos.** Solo es correcto si el despliegue garantiza que la cadena de proxies
delante de la API tiene exactamente esa longitud; si no, un cliente puede falsear su dirección con
`X-Forwarded-For`. La documentación del despliegue lo advierte, y la prioridad 5 verifica la
topología real y su valor.

**Alternativas descartadas:**
- **Aceptar cualquier texto no vacío en producción:** es el estado actual, que la readiness marcó
  como el hueco.
- **Aceptar `linklocal` y `uniquelocal`:** confían en rangos privados enteros, que en una red
  compartida incluyen equipos que no son el proxy.
- **Una gramática distinta en desarrollo:** dos gramáticas son dos sitios donde equivocarse; nadie
  usa en desarrollo las formas que se dejan de admitir.
- **Añadir una dependencia de parseo de IP:** el proyecto ya evita dependencias nuevas sin
  justificarlas, y `node:net.isIP` cubre el caso de una dirección suelta.

### D4. `BETTER_AUTH_URL` con HTTPS en producción, salvo bucle local

En `.superRefine`, con `NODE_ENV === "production"`: si `new URL(env.BETTER_AUTH_URL).protocol` es
`"http:"` y el `hostname` no es exactamente `localhost`, `127.0.0.1` ni `[::1]` (el analizador de
URL conserva los corchetes de IPv6), error. Es una igualdad exacta del `hostname` ya normalizado,
nunca un prefijo ni un sufijo: `localhost.example.com` o `127.0.0.1.example.com` fallan. La
comparación de origen de H-03 (`canonicalOrigin`, `evaluateRequestOrigin`) no cambia: sigue siendo
una igualdad exacta contra `BETTER_AUTH_URL`, cualquiera que sea su esquema.

**Por qué el bucle local.** Es el único despliegue de producción que se puede arrancar y apagar en
esta máquina sin exponerlo (el plan de prueba de humo de la tarea de verificación), y los
navegadores tratan `localhost` como un origen seguro para las cookies aunque el esquema sea HTTP.

### D5. `API_INTERNAL_URL` obligatorio en producción, al construir y al ejecutar

Un módulo nuevo del frontend, `frontend/src/lib/api-internal-url.ts`, resuelve el destino para los
dos lectores, con una sola regla:
- ausente o vacío: si se exige, error «API_INTERNAL_URL: es obligatoria en producción»; si no, el
  bucle local de desarrollo `http://127.0.0.1:4000`;
- presente: debe ser una URL absoluta `http:` o `https:`, sin credenciales, y solo un origen (sin
  ruta, consulta ni fragmento, porque el reenvío conservaría una ruta que la descarga perdería);
  si no, error que nombra la variable y la regla, nunca el valor. No se exige HTTPS para el salto
  interno. Se devuelve el `origin` normalizado.

**Al construir.** `next.config.ts` pasa a exportar una función de la fase de Next.js. Solo la fase
`next dev` (`PHASE_DEVELOPMENT_SERVER`) admite el bucle local por defecto; cualquier otra fase,
incluido `next build`, lo exige. Un error detiene el build con el mensaje del módulo.

**Al ejecutar.** La ruta de descarga resuelve el destino en cada petición con el mismo módulo,
exigiéndolo cuando `process.env.NODE_ENV === "production"` (Next.js lo fija en un build de
producción). Si falla, responde `500` con `Cache-Control: no-store`, sin cuerpo y sin contactar
ningún destino, y registra en el servidor solo el mensaje del módulo. El destino nunca se deriva
de `Host` ni de una cabecera reenviada.

**El build de `verify`.** El paso `build` de `corepack pnpm verify` construye el frontend que
`check:web-security-policy` sirve después con su backend en el puerto del manifiesto. Un script
nuevo, `scripts/build-for-verification.ts`, ejecuta `corepack pnpm build` con
`API_INTERNAL_URL=http://127.0.0.1:4000` explícito (el mismo destino que hoy), sin shell, y
devuelve su código de salida; `verify` lo usa en lugar de `corepack pnpm build`. Así el build de
producción sigue fallando sin la variable, `corepack pnpm verify` sigue siendo un solo comando, y
la CI no cambia.

**Coherencia entre el build y la ejecución.** El reenvío queda fijado en el build
(`routes-manifest.json`), y la ruta de descarga lee la variable en tiempo de ejecución. No se
puede garantizar en código que ambos valores coincidan entre un build y un contenedor de ejecución
distintos: la documentación de despliegue deja explícito que el operador debe usar el mismo valor
para construir y para ejecutar ese build, en la misma sección donde ya avisa sobre
`apiPortOfBuild()` (H-02).

**Alternativa descartada:** una huella del build o una comprobación en tiempo de ejecución que
compare el valor con el manifiesto. El manifiesto no guarda la variable original, solo el destino
ya resuelto; la garantía queda en el contrato documentado, sin código adicional.

### D6. Mensajes de rechazo sin secretos

Todas las reglas nuevas usan el estilo de `toEnvError` y de las funciones de arranque existentes:
nombran la variable y la regla (“no es una ruta absoluta”, “no existe”, “no tiene una sintaxis
admitida”, “usa http fuera del bucle local”), nunca el valor. Las pruebas comprueban que un rechazo
no contiene las credenciales de `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CERTIFICATE_MASTER_KEY`, una
contraseña de certificado ni el entorno completo, como ya hacen las pruebas existentes de
`env.test.ts` con el secreto y la clave de custodia.

### D7. Documentación del reloj: propiedad de la infraestructura

Se corrige, sin inventar un mecanismo nuevo:
- `deployment.md`: “Reloj sincronizado por NTP (o equivalente)” pasa a los **requisitos del
  servidor**, sin la frase “la salud informa la desviación”. Se añade que la evidencia de
  sincronización es operativa, verificada fuera de la aplicación con la herramienta del host o del
  proveedor (por ejemplo, el estado de `chrony`, de `systemd-timesyncd` con `timedatectl`, las
  métricas `node_timex_*` de `node_exporter`, u otro equivalente), sin imponer un servicio
  concreto, y que la prioridad 5
  deja concreto el procedimiento de la topología elegida.
- `non-functional-requirements.md`: la fila de CTX §20.5 pasa de “alerta de desviación en la salud”
  a “evidencia operativa de sincronización, fuera de la aplicación”; la fila de RNF-012 quita
  “reloj” de lo que mide la salud de la aplicación.
- `definition-of-done.md`: el requisito de go-live sobre el reloj pasa a pedir esa evidencia
  operativa, sin implicar que la aplicación la mida.

El requisito en sí —que el reloj del servidor esté sincronizado— no se retira: solo cambia quién lo
demuestra y cómo.

### D8. `CORS_ORIGIN` fuera de la documentación

`deployment.md` todavía lista `CORS_ORIGIN` en “Environment” y en un ejemplo de despliegue por
rutas, aunque el proyecto no usa CORS (H-03 mantiene todo en el mismo origen). Se retira de la
lista y del ejemplo; ya hay una nota aparte, en la sección de autenticación, que dice que no se
usa.

## Risks / Trade-offs

- **[Un desarrollador olvida `NODE_ENV` al arrancar fuera de un arnés conocido]** → El mensaje de
  `EnvError` nombra la variable; `.env.example` ya la documenta, y el flujo de copiarlo a `.env` no
  cambia.
- **[Una instalación real ya en producción no tiene `TRUST_PROXY` ni `DATA_EXPORT_DIRECTORY`
  configurados]** → Es exactamente el caso que este cambio hace fallar a propósito, antes de
  aceptar tráfico, en vez de correr con cookies inseguras o un límite de intentos que cuenta a todos
  los clientes como uno.
- **[La gramática de `TRUST_PROXY` rechaza una sintaxis de Express que un operador esperaba]** →
  Es deliberado: solo quedan las formas que nombran al proxy de forma explícita (saltos, direcciones
  o bloques, bucle local). El mensaje nombra la regla y la documentación da los ejemplos.
- **[Un número de saltos que no corresponde a la topología]** → No se puede detectar en código; la
  documentación lo advierte y la prioridad 5 verifica la topología real.
- **[`API_INTERNAL_URL` distinto entre el build y la ejecución]** → Sin una comprobación posible en
  código, queda como responsabilidad documentada del operador, igual que ya ocurre con
  `apiPortOfBuild()` en H-02. Su ausencia al ejecutar sí falla siempre.
- **[Se corrige la documentación del reloj, pero una instalación real nunca mide su desviación]** →
  Es la decisión del dueño: la aplicación no tiene una referencia de hora confiable, y un falso
  positivo no debe bloquear la emisión fiscal legítima. La prioridad 5 hace concreta la evidencia
  operativa.

## Migration Plan

1. Validar `DATA_EXPORT_DIRECTORY`, `TRUST_PROXY` y `BETTER_AUTH_URL` con las pruebas nuevas, sin
   tocar aún la ausencia de `NODE_ENV`.
2. Quitar el valor por defecto de `NODE_ENV` y ajustar los arranques identificados en D1.
3. `API_INTERNAL_URL` obligatorio en el build y en la ejecución de producción del frontend, con el
   build de `verify` declarándolo.
4. Corregir la documentación del reloj y retirar `CORS_ORIGIN`.
5. Verificar en local con el software en modo producción (sin SRI), y en la CI de la rama.

**Reversión:** revertir los commits del cambio. Una instalación que ya declaraba todo lo exigido
sigue arrancando igual; una que no lo declaraba dejará de arrancar hasta declararlo, que es el
comportamiento buscado.
