# Design

## Context

La motivación está en `proposal.md` y los requisitos en `specs/production-deployment/spec.md`. Este
es el estado observado durante la readiness (2026-10-13) que decide el enfoque:

- **Empaquetado.** `docs/architecture/stack.md` declara Docker como empaquetado por defecto, Node
  24.21.0 (`.node-version`), pnpm 12.4.2 por Corepack y PostgreSQL 17. No hay Dockerfiles ni
  `.dockerignore`; el único Compose es el de desarrollo (`postgres:17-alpine`, volumen con nombre,
  `pg_isready`).
- **Backend.** `node dist/main.js` lee `../package.json` al arrancar para la versión. El cliente de
  Prisma se genera en `src/generated/prisma` y se compila a `dist`; en ejecución usa
  `@prisma/adapter-pg`, sin motor nativo. `prisma` es dependencia de desarrollo, el `postinstall`
  ejecuta `prisma generate`, y las migraciones (`db:migrate:deploy` = `prisma migrate deploy`)
  necesitan el binario nativo `schema-engine` de Debian con OpenSSL 3. El arranque nunca migra.
  Los XSD (`dist/xsd/`) y las fuentes del RIDE (`dist/assets/fonts/noto-sans/`) quedan en el build y
  se verifican por hash al arrancar. Escribe en `DATA_EXPORT_DIRECTORY` y en el temporal del sistema
  (los XLSX de los reportes). Atiende `SIGTERM` y `SIGINT`: deja de aceptar conexiones, espera hasta
  10 s las peticiones en curso y cierra los jobs, los pools y la base de datos.
- **Frontend.** `next.config.ts` exporta una función de la fase que exige `API_INTERNAL_URL` en toda
  fase salvo `next dev`, e importa `src/lib/api-internal-url.ts`; `next start` la vuelve a evaluar
  en memoria. La salida `standalone` incrusta la configuración serializada en `server.js` y nunca
  la reevalúa. Todas las páginas son dinámicas por el nonce de la CSP. El reenvío de `/api` de
  Next.js corta a los 30 s y no reescribe `X-Forwarded-For`.
- **IP del cliente.** Better Auth y el límite de intentos toman la IP de `req.ip` (Express con
  `trust proxy`), y los eventos de seguridad la registran (`docs/quality/observability.md` lo
  admite); el log de petición no la registra.
- **Límites de cuerpo de la API.** 100 KB global; 8 KiB en `/api/auth`; logo hasta 2 MiB; firma
  hasta unos 2,7 MiB con el máximo configurable; borrador de guía 2 MiB; borrador de liquidación
  4 MiB, el mayor.
- **Portabilidad.** La generación es un job asíncrono; la descarga calcula el SHA-256 completo antes
  del primer byte (40 a 56 s para 5 GiB en disco giratorio). Un paquete listo sin su archivo falla
  al descargarse con `DATA_EXPORT_PACKAGE_MISSING` y un evento de auditoría.
- **Custodia.** El volcado guarda el P12 y su contraseña cifrados con AES-256-GCM y la clave de datos
  envuelta con la clave maestra, que nunca vive en PostgreSQL (ADR 0011). La validez del certificado
  expone si la clave está disponible (`vault.canOpen`), sin firmar nada.
- **Artefactos.** Viven en PostgreSQL (`bytea`, ADR 0010): un solo respaldo, el de la base de datos.
- **Imágenes oficiales vigentes** (manifiesto de `docker-library/official-images` y nginx.org, el
  2026-10-13): `node:24.21.0-bookworm-slim`; la línea estable de nginx 1.30.5, con
  `nginx:1.30.5-alpine`; `postgres:17-alpine`, hoy 17.11.

## Goals / Non-Goals

**Goals:**
- Un operador construye las imágenes y levanta la topología de referencia con un solo
  procedimiento documentado, sin secretos en el repositorio ni en las imágenes.
- Cada comportamiento del spec tiene una comprobación automática y repetible en la CI, con TLS
  efímero, secretos sintéticos y cero tráfico al SRI.
- La recuperación se demuestra restaurando en una base nueva, no solo volcando.

**Non-Goals:**
- Una plataforma de despliegue general: Kubernetes, varios hosts, alta disponibilidad, varias
  instancias de la API o un registro de imágenes.
- Cambiar el comportamiento del backend o del frontend: este cambio empaqueta y verifica lo que ya
  existe.
- Implementar el cifrado, la retención o el almacenamiento externo de los respaldos.

## Decisions

### D1. Artefactos de despliegue en `deploy/`, contexto de build en la raíz

Los Dockerfiles, el Compose de producción, la plantilla de nginx, la plantilla de entorno, el
override de salida al SRI y los scripts de respaldo y restauración viven en `deploy/`. El contexto de
build es la raíz del repositorio, porque el monorepo necesita el lockfile y el workspace de pnpm, y
lo protege un `.dockerignore` en la raíz (D10).

**Alternativa descartada:** un Dockerfile dentro de `backend/` y otro en `frontend/`, cada uno con
su propio contexto: ninguno de los dos alcanzaría el lockfile ni `packages/contracts`.

### D2. Imagen del backend: etapas, objetivo `migrate` y ejecución sin root

Un solo `deploy/backend.Dockerfile` multietapa sobre `node:24.21.0-bookworm-slim`, sin digest:
1. **Dependencias:** Corepack con pnpm 12.4.2 y `pnpm install --frozen-lockfile` del backend y de
   `packages/contracts`.
2. **Build:** `contracts` y luego el backend (`tsc`, `copy-xsd`, `copy-ride-assets`).
3. **Dependencias de producción:** solo las del backend, con los paquetes del workspace ya
   compilados, sin ejecutar scripts de instalación: el `postinstall` llamaría a la CLI de Prisma,
   que es de desarrollo, y el cliente ya está compilado en `dist`. El mecanismo concreto
   (`pnpm deploy --prod` u otro equivalente de pnpm 12) se confirma al implementar.
4. **Objetivo `migrate`:** parte del build, con la CLI de Prisma, `prisma/schema.prisma`,
   `prisma/migrations`, `prisma.config.ts` y el `schema-engine` de Debian con OpenSSL 3. Ejecuta el
   script canónico `db:migrate:deploy` como usuario `node`, con `CHECKPOINT_DISABLE=1`, y termina.
   Nunca es un servicio de larga duración, y la CLI de Prisma no pasa a las dependencias de
   ejecución.
5. **Objetivo `runtime`:** `dist`, las dependencias de producción y `package.json`, sin código
   fuente, pruebas ni dependencias de desarrollo; crea `/var/lib/facturador/exports` como `node` con
   modo `0700` (D6); `USER node`; `CMD ["node", "dist/main.js"]` en forma exec. No fija `NODE_ENV`:
   la despliega el entorno, y sin ella la imagen sigue fallando al arrancar (prioridad 4). Se
   retiran del runtime npm y Corepack si no los necesita nada en ejecución.

### D3. Imagen del frontend: `next start`, no `standalone`

`deploy/frontend.Dockerfile`, multietapa sobre la misma base:
- **Build:** `API_INTERNAL_URL` como argumento obligatorio, sin valor por defecto, y
  `NEXT_TELEMETRY_DISABLED=1`. Sin él, `next build` falla, como exige la prioridad 4.
- **Runtime:** `.next` sin su caché de build, las dependencias de producción del frontend,
  `package.json`, `next.config.ts` y `src/lib/api-internal-url.ts` (y `tsconfig.json` o `public/`
  solo si `next start` los necesita, lo que se comprueba al implementar); `USER node`; `next start
  --port 3000` en forma exec.
- **Coherencia del destino interno:** el Compose pasa la misma variable `API_INTERNAL_URL`
  (`http://backend:4000`) como argumento de build y como entorno de ejecución, de una sola fuente.

**Alternativa descartada:** la salida `standalone`, más pequeña, porque su `server.js` no reevalúa
`next.config.ts` y el frontend arrancaría sin `API_INTERNAL_URL`, contra lo aprobado en la
prioridad 4.

### D4. Topología, redes y `TRUST_PROXY` explícito

`deploy/compose.yaml` define `postgres`, `migrate`, `backend`, `frontend` y `proxy`:
- **Red `edge`:** puente normal, solo para `proxy`, que publica 443 y 80. Los puertos publicados son
  variables con 443 y 80 por defecto, para que las pruebas usen puertos altos.
- **Red `app`:** `internal: true`, sin salida a Internet, con una subred fija (propuesta
  `172.29.247.0/24`, con `ip_range` en la mitad alta para las direcciones dinámicas) y `proxy` en una
  dirección fija (propuesta `172.29.247.10`). `postgres`, `migrate`, `backend` y `frontend` solo
  están en `app`, sin puertos publicados.
- **`TRUST_PROXY`:** la dirección de `proxy` en `app`, tomada de la misma variable que su
  `ipv4_address`, de modo que cambiar la subred cambia los dos valores a la vez. Nunca `true`, un
  número de saltos, toda la subred, `0.0.0.0/0` ni `::/0`. La documentación avisa que la subred
  puede chocar con una red del host, y que entonces el operador cambia esa variable.
- **Origen público único:** `PUBLIC_ORIGIN` (por ejemplo, `https://facturas.ejemplo.test`) alimenta
  `BETTER_AUTH_URL` del backend y el destino de la redirección HTTP del borde.

**Alternativa descartada:** un número de saltos `1` como configuración canónica. Trataría como proxy
de confianza a cualquier par que llegue al backend, también el frontend u otro contenedor interno.

### D5. El borde nginx de referencia

`nginx:1.30.5-alpine` con una plantilla en `deploy/nginx/templates/`, que la imagen oficial
completa con `envsubst` al arrancar:
- **HTTP (80):** solo una redirección `301` a `${PUBLIC_ORIGIN}$request_uri`, nunca derivada de
  `Host`, sin HSTS.
- **HTTPS (443):** TLS 1.2 y 1.3 con el certificado y la clave montados de solo lectura;
  `server_tokens off`; HSTS `max-age=31536000`, con `always`, en todas las respuestas HTTPS. La API
  envía hoy su propia HSTS con `includeSubDomains` (el `helmet()` por defecto); el borde la descarta
  con `proxy_hide_header` y emite solo la suya, sin cambiar la aplicación. Como un `add_header` o un
  `proxy_hide_header` en un `location` anulan los heredados, ningún `location` los declara, y la
  prueba comprueba una sola HSTS en una página, en `/api`, en un `413` y en un rechazo de salud.
- **Rutas:**
  - `location /api/`: al backend, con 8 MiB de cuerpo y una espera de `${NGINX_PROXY_READ_TIMEOUT}`
    (60 s por defecto);
  - `location ~ ^/api/v1/data-exports/[^/]+/download$`: al backend, con
    `${NGINX_DOWNLOAD_READ_TIMEOUT}` (180 s por defecto), sin almacenar la respuesta
    (`proxy_buffering off`, `proxy_max_temp_file_size 0`);
  - `/health/` y `/metrics`: rechazados de forma explícita con `404`, sin reenviarlos;
  - `location /`: al frontend, con 1 MiB de cuerpo y la espera normal.
- **Cabeceras reenviadas:** `Host` del cliente, `X-Forwarded-For` sobrescrita con `$remote_addr`
  (nunca `$proxy_add_x_forwarded_for`), `X-Forwarded-Proto https`, y `Forwarded` y
  `X-Forwarded-Host` vacías. H-03 sigue sin usar cabeceras reenviadas para el origen.
- **Logs:** acceso y errores a stdout y stderr, con un formato mínimo como el del log de petición de
  la aplicación (método, ruta sin consulta, estado, bytes, duración): sin IP, cabeceras, cookies ni
  cuerpos. Un operador que necesite la IP en su borde documenta antes su propósito y retención
  (`docs/quality/observability.md`).
- **Privilegios:** el proceso maestro de la imagen oficial necesita los puertos 80 y 443; se evalúa
  al implementar el mínimo de capacidades con `no-new-privileges`, sin dar al proxy más privilegios
  que los de la imagen.

**Alternativas descartadas:** Caddy o Traefik como referencia adicional (el dueño eligió nginx, que
ya usa la documentación), y una espera de 180 s para toda la API.

### D6. Almacenamiento: volúmenes con nombre, sin autocreación en la aplicación

- **`postgres-data`:** el PGDATA de PostgreSQL. Se respalda.
- **`exports`:** montado en `/var/lib/facturador/exports`, que la imagen del backend ya trae como
  directorio de `node` con modo `0700`. Docker inicializa un volumen con nombre nuevo y vacío
  copiando ese directorio, con su propietario y su modo. La aplicación nunca lo crea, y la
  comprobación de la prioridad 4 sigue decidiendo al arrancar. Persiste entre reinicios; no se
  respalda, porque sus paquetes caducan y se regeneran desde la base de datos.
- **Temporales:** el temporal del sistema del backend, y la caché que `next start` necesite escribir.
- **Alternativa documentada:** un montaje de un directorio del host, que el operador aprovisiona
  antes de arrancar (propietario UID 1000, modo `0700`). Nunca una creación en el entrypoint.

### D7. Arranque, salud, migraciones y apagado

- **Orden:** `postgres` sano (`pg_isready`), luego `migrate` completado con éxito
  (`service_completed_successfully`), luego `backend`, luego `frontend` y `proxy`. Si `migrate`
  falla, Compose no arranca el backend. Nunca dos `migrate` a la vez, y nada repara el historial de
  migraciones.
- **Salud del contenedor:** el backend usa `/health/live` con `node` (las imágenes slim no traen
  curl), nunca `/health/ready`, para que una dependencia caída no provoque reinicios en bucle. El
  frontend usa `GET /iniciar-sesion`, sin una ruta nueva.
- **Preparación del despliegue:** el procedimiento documentado y las pruebas esperan
  `/health/ready` por la red privada antes de dar la API por lista.
- **Apagado:** `stop_grace_period: 30s`, por encima de los 10 s de gracia de las peticiones más el
  cierre de los recursos.
- **Seguridad de los contenedores de la aplicación:** `cap_drop: [ALL]` y
  `security_opt: [no-new-privileges:true]`. Raíz de solo lectura con `tmpfs` para las escrituras
  reales: se mide al implementar y se registra; no bloquea el cierre si el framework necesita una
  escritura que no se pueda aislar limpiamente. Sin root es obligatorio.

### D8. Secretos y configuración

- **Valores no secretos:** variables del Compose, con `NODE_ENV=production`,
  `SRI_TRANSMISSION_ENABLED=0`, `DATA_EXPORT_DIRECTORY`, `TRUST_PROXY`, `API_INTERNAL_URL`,
  `BETTER_AUTH_URL` y los demás de la prioridad 4, declarados de forma explícita.
- **Secretos:** un archivo de entorno del operador fuera del repositorio para `DATABASE_URL` y
  `BETTER_AUTH_SECRET`; archivos de solo lectura para `CERTIFICATE_MASTER_KEY_FILE`,
  `POSTGRES_PASSWORD_FILE`, y el certificado y la clave TLS. El usuario `node` (UID 1000) del
  contenedor tiene que poder leer el archivo de la clave maestra; la documentación da el
  propietario y el modo, y las pruebas lo resuelven dentro de un directorio temporal `0700`.
- **`deploy/production.env.example`:** solo marcadores, sin valores válidos, dominio real, identidad
  fiscal ni rutas privadas, con `SRI_TRANSMISSION_ENABLED=0`.

### D9. Salida a Internet: bloqueada por defecto, abierta solo por decisión del dueño

La red `app` es interna: ni el backend, ni el frontend, ni PostgreSQL tienen salida. El override
`deploy/compose.sri-egress.yaml` añade al backend una red con salida. Solo se usa cuando el dueño
habilita el uso real del SRI, junto con `SRI_TRANSMISSION_ENABLED=1`, y nunca en las pruebas, en la
CI ni en la topología por defecto. La CI solo comprueba, con `docker compose config`, que el
override no toca más que la red del backend; nunca lo levanta.

### D10. `.dockerignore` con lista de permitidos y su prueba

El `.dockerignore` de la raíz excluye todo (`*`) y vuelve a admitir solo:
- los manifiestos de la raíz (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`);
- `backend/`, `frontend/` y `packages/contracts/`, sin sus pruebas;
- las fuentes de los XSD bajo `docs/product/` que copia `copy-xsd`.

Después excluye de nuevo, en cualquier nivel: `node_modules`, `.next`, `dist`, `coverage`, logs,
exportaciones temporales, `.env` y `.env.*`, PKCS#12 y PFX, claves privadas, `archivosensible.env` y
las salidas locales de pruebas. Las rutas exactas de los XSD se fijan al implementar.

**Prueba:** un árbol temporal con el `.dockerignore` del repositorio, archivos permitidos y archivos
prohibidos sintéticos, construido con un Dockerfile de sonda (`FROM scratch` y `COPY . /`), sin
descargar ninguna imagen. Exporta el contexto recibido y comprueba qué llegó: ningún prohibido y
todos los permitidos. Además, una
búsqueda en las imágenes finales confirma que no traen archivos de entorno, PKCS#12, PFX ni claves
privadas bajo el directorio de la aplicación. Nunca se lee ni se imprime un archivo privado real.

### D11. Respaldo y restauración

`deploy/backup.sh` y `deploy/restore.sh` corren en el host del operador con Docker Compose y las
herramientas de la imagen de PostgreSQL 17, sin depender de las del host:
- **Respaldo:** `pg_dump -Fc` desde el contenedor de PostgreSQL a un archivo de modo `0600`, y su
  SHA-256 al lado. Imprime solo la ruta, el tamaño y la suma. El éxito exige el código 0 de
  `pg_dump` y la suma registrada.
- **Restauración:**
  1. comprueba la suma, y se niega si no coincide;
  2. comprueba que la base de destino está vacía (ningún objeto fuera de los esquemas del sistema), y
     se niega si no, salvo con `--replace-existing`, que borra y recrea la base de destino y está
     documentada como destructiva;
  3. `pg_restore --exit-on-error --no-owner`.
- **Después:** el operador aplica las migraciones (sin cambios si el esquema estaba al día) y
  arranca la aplicación.
- **Cifrado y retención:** del operador, fuera de los scripts. La documentación declara que el
  volcado contiene datos fiscales y del negocio, que se cifra en reposo bajo control del operador,
  que su clave no se guarda con él, y que la clave maestra se custodia aparte, porque el volcado
  solo no basta para recuperar la custodia de la firma.

### D12. Ensayos automáticos de la topología y de la recuperación

Dos scripts del repositorio en TypeScript (`scripts/deployment/`), que orquestan Docker sin shell,
generan sus secretos sintéticos y su certificado TLS efímero (con `node-forge`, ya dependencia del
proyecto) en un directorio temporal fuera del repositorio, nunca imprimen un secreto, y siempre
limpian sus proyectos de Compose, sus volúmenes y sus temporales.

**Topología** (proyecto propio, puertos altos, `PUBLIC_ORIGIN=https://localhost:<puerto>`):
- puertos publicados y alcance externo de los servicios internos;
- redirección HTTP, HSTS, enrutamiento de `/api` y de las páginas, salud y métricas rechazadas;
- inicio de sesión del administrador sintético con cookies `Secure`;
- **IP del cliente:** un contenedor cliente de prueba con dirección fija en `edge` provoca un evento
  de seguridad (inicio de sesión fallido); el script lee del log del backend solo el campo `ip` de
  ese evento y lo compara con la dirección del cliente, con y sin un `X-Forwarded-For` falsificado.
  La misma llamada desde el contenedor del frontend, directa al backend con la cabecera, se atribuye
  a la dirección del frontend;
- **cuerpos:** 4 MiB sintéticos a la ruta de borradores de liquidación, sin sesión y con el
  `Origin` canónico, reciben el sobre de la API (llegó a la aplicación); más de 8 MiB en `/api/` y
  más de 1 MiB fuera reciben `413` del borde;
- **salida:** un contenedor trampa solo en `edge`; el backend y el frontend no lo alcanzan y la
  trampa cuenta cero conexiones;
- procesos sin root;
- **migración fallida:** con una `DATABASE_URL` inválida solo para `migrate`, el backend no arranca;
- **apagado:** `docker compose stop` del backend termina con código 0, con sus mensajes de cierre y
  antes de 30 s;
- **persistencia:** datos sintéticos (empresa del aprovisionamiento, un operador, el logo sintético
  y una exportación de portabilidad lista), recreación de los contenedores sin borrar volúmenes, y
  los mismos datos y el mismo SHA-256 del paquete al descargarlo de nuevo.

**Espera del borde:**
- una comprobación de la configuración de producción ya renderizada (`nginx -T`): 180 s, sin
  almacenamiento, solo en la ruta de descarga, y 60 s en el resto;
- una prueba de comportamiento con la misma plantilla, con las esperas escaladas (por ejemplo 2 s y
  6 s) y un servidor de prueba que tarda 4 s en su primer byte: la ruta de descarga entrega la
  respuesta completa y otra ruta recibe un error de puerta de enlace.

Así no hace falta un paquete de varios GB ni esperar minutos.

**Recuperación:**
1. Siembra solo datos sintéticos no fiscales: el administrador y la empresa del aprovisionamiento,
   un operador con su membresía, la configuración de la empresa, el logo sintético (un artefacto
   con su SHA-256), un certificado sintético del generador del repositorio cargado en la custodia, y
   una exportación de portabilidad lista. Ninguna emisión fiscal.
2. Registra las huellas: la lista y las sumas de `_prisma_migrations`; el recuento de filas de cada
   tabla (cero antes y cero después vale como evidencia); un resumen de las filas sembradas; el
   SHA-256 de los artefactos y del contenido cifrado de la custodia, comparados dentro del script
   sin imprimirlos.
3. Respaldo con `deploy/backup.sh`.
4. Restauración con `deploy/restore.sh` en un proyecto de Compose independiente, con un PostgreSQL 17
   nuevo y vacío.
5. Migraciones y arranque completo del segundo proyecto sobre la base restaurada.
6. Comparación de las huellas y comprobaciones por la API:
   - con la misma clave sintética, la validez del certificado indica la clave disponible;
   - con otra clave sintética, la aplicación queda lista y el certificado aparece no disponible;
   - la descarga de la exportación sin su archivo da `DATA_EXPORT_PACKAGE_MISSING` y su evento de
     auditoría.
7. **Negativas:** un volcado alterado no pasa la suma y no toca el destino; un volcado truncado con su
   suma recalculada hace fallar `pg_restore`; una segunda restauración sobre la base ya restaurada,
   sin la opción destructiva, se niega y las huellas no cambian.
8. Registra las duraciones del respaldo y de la restauración como evidencia, nunca como un RTO o un
   RPO.

### D13. Workflow `deployment`

`.github/workflows/deployment.yml`, en `push`, `pull_request` y `workflow_dispatch`, con
`permissions: contents: read`, sin secretos del repositorio:
- **Jobs paralelos:** `topology` (la prueba del `.dockerignore`, las imágenes, la topología y la
  espera del borde) y `recovery` (las imágenes y el ensayo de la recuperación).
- **Herramientas:** `actions/checkout` y `actions/setup-node` con los mismos SHA que `verify.yml`,
  `corepack pnpm install --frozen-lockfile` para los scripts, y la CLI de Docker y Compose del
  runner. Sin acciones de registro, inicio de sesión ni publicación.
- **Sin artefactos:** ni volcados, ni claves, ni P12, ni archivos de entorno.
- **Duración:** un `timeout-minutes` acotado y una estimación de 12 a 20 min por job, que se mide al
  implementar. `verify` y `security` no cambian.

### D14. Documentación y ADR

- **ADR 0027:** la topología de despliegue de referencia (nginx en el borde, `/api` directo al
  backend, red privada sin salida, `TRUST_PROXY` explícito, recuperación por volcado lógico con la
  clave maestra aparte).
- **`stack.md`:** las versiones de las imágenes de nginx y Node.
- **`deployment.md`:** la topología, las imágenes, los volúmenes y su aprovisionamiento, las
  migraciones, el entorno de producción, `TRUST_PROXY` y su subred, TLS (certificado válido y su
  renovación, a elección del operador), HSTS (solo con HTTPS ya funcionando), el techo de cuerpo, la
  espera de la descarga, la salud y las métricas, la evidencia del reloj del host (`chronyc
  tracking`, `timedatectl` u otro equivalente, sin umbral), el respaldo y la restauración, la
  dependencia de la clave maestra, la persistencia, el override de salida y el procedimiento de los
  ensayos.
- **`README.md`:** instalación de producción, arranque y actualización, respaldo y restauración.
- **`definition-of-done.md`, `testing.md` y `technical-debt.md`:** el estado del go-live, las
  comprobaciones nuevas y la deuda que se cierra, solo con la evidencia en la mano.

### Brief de las operaciones sensibles (`docs/architecture/backend.md`)

El respaldo y la restauración son operaciones del operador sobre toda la instancia, no rutas de la
API:
- **Empresa:** una por instancia; el volcado es de toda la base.
- **Propietario:** el administrador técnico del host.
- **Idempotencia:** restaurar dos veces sobre el mismo destino se niega sin la opción destructiva, de
  modo que nunca mezcla dos estados.
- **Restricciones:** la suma antes de restaurar; la misma versión mayor de PostgreSQL.
- **Auditoría:** la de la aplicación no cambia; el procedimiento del operador registra cuándo se
  restauró.
- **Fugas:** los volcados con modo `0600`, nunca impresos ni subidos como artefactos de la CI; los
  scripts solo muestran rutas, tamaños, sumas y códigos de salida; ningún secreto en los argumentos
  visibles de los procesos.

No hay pantallas nuevas, migraciones de esquema ni cambios en los contratos de la API.

## Risks / Trade-offs

- **[`pnpm deploy` de pnpm 12 exige otra configuración para los paquetes del workspace]** → Se
  confirma al implementar; la alternativa es instalar solo las dependencias de producción del
  backend en una etapa limpia con el lockfile.
- **[`next start` escribe en `.next` en ejecución]** → Se mide con la raíz de solo lectura y
  `tmpfs`; si no se puede aislar, el frontend corre sin raíz de solo lectura, pero siempre sin root.
- **[La subred fija choca con una red del host]** → Documentada como variable del operador, que
  cambia a la vez la dirección del proxy y `TRUST_PROXY`.
- **[`add_header` de nginx no se hereda en un `location` que añade cabeceras]** → Ningún `location`
  añade cabeceras, y la prueba comprueba HSTS en varias clases de respuesta.
- **[La prueba de la espera usa valores escalados]** → La configuración de producción renderizada se
  comprueba aparte con sus valores reales.
- **[Archivos de secretos ilegibles para el usuario sin root]** → Propietario y modo documentados; en
  las pruebas, modo de lectura dentro de un directorio temporal `0700`.
- **[Límites de descarga anónima de Docker Hub en la CI]** → Pocas imágenes base (Node, nginx,
  PostgreSQL), una vez por job.
- **[La CI de despliegue tarda]** → Corre en paralelo y en jobs separados, sin alargar `verify`.
- **[`postgres:17-alpine` cambia de versión menor con el tiempo]** → El respaldo y la restauración
  usan la herramienta de la misma imagen; no se promete recuperación entre versiones mayores.

## Migration Plan

1. Imágenes y `.dockerignore`, con su prueba de contexto.
2. Topología Compose, nginx, plantilla de entorno y override de salida.
3. Ensayo de la topología y de la espera del borde.
4. Scripts de respaldo y restauración, y ensayo de la recuperación.
5. Workflow `deployment`.
6. Documentación, ADR y deuda.
7. Verificación local y en la CI de la rama (`verify`, `security`, `deployment`).

**Reversión:** revertir los commits del cambio. No toca la aplicación ni el esquema, así que una
instalación existente no se ve afectada.
