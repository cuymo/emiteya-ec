# Deployment Architecture

## Docker

Applications should be deployable with Docker.

Recommended services:

- `api`: Express.js backend.
- `frontend`: Next.js frontend.
- Remote PostgreSQL database for production.

### Imágenes de producción

Las imágenes se construyen desde la raíz del repositorio, con el contexto acotado por `.dockerignore`
(`harden-deployment-proxy-and-recovery`, ADR 0027):

| Imagen | Dockerfile y objetivo | Contenido |
| --- | --- | --- |
| API | `deploy/backend.Dockerfile`, `runtime` | `node dist/main.js` sobre `node:24.21.0-bookworm-slim`: `dist` (con los XSD y las fuentes del RIDE), las dependencias de producción y `package.json`. Usuario `node` (UID 1000), sin npm, Corepack ni pnpm, y sin `NODE_ENV` fijado: el despliegue lo declara. |
| Migraciones | `deploy/backend.Dockerfile`, `migrate` | Un solo uso: ejecuta `db:migrate:deploy` (`prisma migrate deploy`) como `node` y termina. Trae la CLI de Prisma, el esquema, las migraciones y su `schema-engine` de Debian con OpenSSL 3, sin salida a la red al ejecutarse. |
| Interfaz | `deploy/frontend.Dockerfile`, `runtime` | `next start --port 3000`, no la salida `standalone`, para que Next.js vuelva a evaluar `next.config.ts` y exija `API_INTERNAL_URL`. Solo `.next`, las dependencias de producción, `package.json`, `next.config.ts` y su resolución de `API_INTERNAL_URL`. Usuario `node`. |

- **`API_INTERNAL_URL` de la interfaz** es un argumento obligatorio del build y la misma variable al ejecutar; sin ella, ni el build ni `next start` arrancan.
- **El contexto de build** admite solo los manifiestos del workspace, el código del backend, del frontend y de los contratos, y los XSD que copia el build. Excluye en cualquier nivel `node_modules`, `.next`, `dist`, archivos de entorno, PKCS#12, PFX, claves privadas y salidas locales. `corepack pnpm deployment:context` lo comprueba con archivos sintéticos y busca esos archivos en las imágenes construidas.
- **Las dependencias de producción** de la API incluyen las dependencias entre pares que el lockfile resuelve para `better-auth` y `@prisma/client` (por ejemplo, el paquete `prisma` sin sus motores); no son dependencias de desarrollo del backend ni se ejecutan.

## Environment

Keep runtime configuration in environment variables:

- `NODE_ENV`
- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `TRUST_PROXY` and `DATA_EXPORT_DIRECTORY` (required in production)
- `API_INTERNAL_URL` (frontend)
- `INITIAL_USER_EMAIL`
- `INITIAL_USER_PASSWORD`
- External service tokens as needed.

Rules:

- Do not commit real `.env` files.
- Provide `.env.example` in application repos.
- Validate required environment variables at startup.
- Keep secrets server-side.

## Dokploy / Reverse Proxy

Two common layouts:

### Same Domain With Path Routing

- Frontend: `https://app.example.com/`
- API: `https://app.example.com/api`

Frontend environment (the internal address of the API service, at build and at runtime):

```text
API_INTERNAL_URL=http://api:4000
```

Backend environment:

```text
NODE_ENV=production
BETTER_AUTH_URL=https://app.example.com
TRUST_PROXY=<the proxy's address or CIDR, as seen by the API>
DATA_EXPORT_DIRECTORY=/var/lib/facturador/exports
```

### Separate API Domain

- Frontend: `https://app.example.com/`
- API: `https://api.example.com/`

Use this when path routing is not available or when API isolation matters.

En este proyecto, el navegador siempre llama a `/api` en el origen del frontend: Next.js lo reenvía
a `API_INTERNAL_URL` (ADR 0016). Un dominio de API separado al que llamara el navegador exigiría un
cambio de la política de seguridad (`connect-src`), de CORS y de la regla de origen de `/api/v1`, no
solo de configuración.

### Techo de cuerpo del proxy

El proxy inverso que enruta `/api` no puede admitir menos que el cuerpo legítimo más grande de la
API, el borrador de una liquidación de compra (4 MiB). El borrador de una guía de remisión admite
2 MiB, el logo, `LOGO_MAX_BYTES`, y el avatar, `AVATAR_MAX_BYTES`. Si el techo del proxy es menor, el proxy corta la petición antes
de que la API pueda responder con su mensaje.

- El ejemplo de Nginx de "Configuración de la empresa" (`client_max_body_size 1m;`) cubre el logo
  por defecto, pero no los borradores.
- La topología de referencia fija 8 MiB en `/api/` y 1 MiB en el resto (ver "Topología de
  referencia").
- Los límites de la propia API no cambian con el techo del proxy: siguen rechazando con 413 lo que
  supera el límite de cada ruta.

### Cabeceras de seguridad y caché de los documentos

El frontend escribe en cada documento HTML su `Content-Security-Policy` y las cabeceras de semántica
del navegador (ADR 0025). El proxy inverso:
- **No añade otra CSP**, ni en una cabecera ni de otra forma: el frontend es su única autoridad.
- **Conserva sin cambios las cabeceras de la aplicación:** `Content-Security-Policy`,
  `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` y `Cross-Origin-Opener-Policy`.
- **No guarda los documentos HTML en una caché compartida** ni sustituye su `Cache-Control` privado:
  cada documento lleva un nonce de un solo uso. Los recursos de `/_next/static` sí se pueden guardar
  con su caché pública e inmutable.
- **Configura HSTS** (`Strict-Transport-Security`): solo el proxy que termina TLS sabe si la conexión
  llegó por HTTPS, y el frontend no la envía.
  - El borde de referencia emite `max-age=31536000`, sin `includeSubDomains` ni `preload`, solo en
    HTTPS, y descarta la HSTS que la API añade por su cuenta (el `helmet()` por defecto, con
    `includeSubDomains`).
  - En el borde real se activa solo cuando HTTPS ya funciona con un certificado válido: un navegador
    que la recibe no vuelve a aceptar HTTP en ese host durante un año.

## Data Safety

- Redeploying the application must not delete database data.
- Production migrations should be explicit and reviewed.
- Initial broad database privileges can be used to run migrations, then reduced to least privilege.
- Volumes should be used only for files that must persist outside the database.

## Instalación self-hosted

El producto se instala por contribuyente, una empresa por instancia, en un servidor Linux
que opera el administrador técnico. Lo que sigue es la topología objetivo; el instalador de
un solo paso es P2.

### Topología de referencia

`deploy/compose.yaml` es la topología de producción de referencia: un solo host con Docker Compose
(`harden-deployment-proxy-and-recovery`, ADR 0027, spec `production-deployment`).

| Servicio | Imagen | Redes | Público |
| --- | --- | --- | --- |
| `proxy` | `nginx:1.30.5-alpine` | `edge` y `app` (IP fija) | 443 (TLS) y 80 (solo redirige) |
| `frontend` | `emiteya-frontend` (`next start`) | `app` | No |
| `backend` | `emiteya-backend` (`runtime`) | `app` | No |
| `migrate` | `emiteya-migrate` (un solo uso) | `app` | No |
| `postgres` | `postgres:17-alpine` | `app` | No |

- **Redes.** `app` es interna: la interfaz, la API, las migraciones y PostgreSQL no tienen salida a
  Internet ni puertos publicados en el host. Solo `proxy` está también en `edge`, la red con los
  puertos publicados. Construir las imágenes sí necesita red (registros de imágenes y de paquetes);
  la topología en ejecución no.
- **`TRUST_PROXY`.** La IP fija de `proxy` en `app` (`PROXY_APP_IP`, `172.29.247.10` por defecto)
  es la única de confianza: la misma variable alimenta su `ipv4_address` y `TRUST_PROXY` de la API.
  Si la subred (`APP_SUBNET`, `172.29.247.0/24`, con las direcciones dinámicas en `APP_IP_RANGE`,
  `172.29.247.128/25`) choca con una red del host, se cambian las tres a la vez. Nunca un número de
  saltos, toda la subred ni `true`: la interfaz u otro contenedor interno no son proxies de
  confianza.
- **Enrutamiento del borde.** `/api/*` va directo a la API y el resto a la interfaz, en el mismo
  origen; el reenvío de `/api` de Next.js queda para el desarrollo. `/health*` y `/metrics*` se
  rechazan con `404` sin reenviarlos.
- **TLS.** El borde termina TLS 1.2 y 1.3 con el certificado y la clave del directorio de secretos.
  El certificado real es válido y de confianza pública, y su emisión y su renovación (ACME o la del
  proveedor) son del operador. HTTP solo redirige con `301` al mismo recurso en `PUBLIC_ORIGIN`,
  nunca a un destino derivado de `Host`.
- **HSTS.** `max-age=31536000`, sin `includeSubDomains` ni `preload`, en todas las respuestas HTTPS,
  también en los errores; nunca por HTTP (ver "Cabeceras de seguridad y caché de los documentos").
- **Cabeceras reenviadas.** `Host` del cliente, `X-Forwarded-For` sobrescrita con la IP que observa
  el borde (nunca la cadena que traiga el cliente), `X-Forwarded-Proto https`, y `Forwarded` y
  `X-Forwarded-Host` vacías.
- **Techo de cuerpo y esperas.** 8 MiB en `/api/` y 1 MiB en el resto; 60 s de espera de la respuesta,
  y 180 s solo en la descarga de portabilidad, sin almacenarla en el borde. Los límites de cada ruta
  de la API no cambian.
- **Logs.** A stdout y stderr. El log de acceso del borde lleva la hora, el método, la ruta sin
  consulta, el estado, los bytes y la duración: sin IP, cabeceras, cookies ni cuerpos. El log de
  errores de nginx incluye la IP del cliente cuando un error es de una petición; si un operador
  necesita la IP en su log de acceso, documenta antes su propósito y su retención
  (`../quality/observability.md`).
- **Volúmenes.** `postgres-data` (PGDATA, se respalda) y `exports` (`DATA_EXPORT_DIRECTORY`,
  persiste entre reinicios y no se respalda). La imagen de la API trae
  `/var/lib/facturador/exports` del usuario `node` con modo `0700`, y Docker inicializa así un volumen
  con nombre nuevo; la API nunca lo crea y sigue comprobándolo al arrancar. Con un directorio del host
  en lugar del volumen, el operador lo aprovisiona antes de arrancar
  (`install -d -o 1000 -g 1000 -m 0700 <directorio>`).
- **Secretos.** Nunca en el repositorio ni en las imágenes. `EMITEYA_ENV_FILE`, fuera del
  repositorio, trae `DATABASE_URL`, `BETTER_AUTH_SECRET` y, en el primer arranque, el administrador
  inicial. `EMITEYA_SECRETS_DIR` trae `postgres_password`, `certificate_master_key` (legible por el
  UID 1000), `tls_certificate` y `tls_private_key`. `deploy/production.env.example` lista las
  variables con marcadores.
- **Configuración fijada.** `NODE_ENV=production`, `SRI_TRANSMISSION_ENABLED=0`,
  `EMAIL_DELIVERY_ENABLED=0`, `EMAIL_ALLOW_PLAINTEXT_SMTP=0`, `BETTER_AUTH_URL=${PUBLIC_ORIGIN}`, `TRUST_PROXY=${PROXY_APP_IP}`, `API_INTERNAL_URL` (argumento de
  build y entorno de la interfaz) y `DATA_EXPORT_DIRECTORY`, declarados en el Compose.
- **Arranque.** `postgres` sano (`pg_isready`), luego `migrate` terminado con éxito, luego `backend`
  (salud de vida `/health/live`), luego `frontend` (`GET /iniciar-sesion`) y `proxy`. Si una
  migración falla, la API no arranca. El despliegue da la API por lista cuando `/health/ready`
  responde por la red interna; la salud de vida nunca depende de la base de datos, para no reiniciar
  el contenedor por una dependencia caída.
- **Apagado.** `stop_grace_period: 30s`: la API espera hasta 10 s las peticiones en curso y cierra sus
  jobs, sus pools y la base de datos.
- **Privilegios.** La interfaz, la API y las migraciones corren como `node` (UID 1000), sin
  capacidades (`cap_drop: ALL`) y con `no-new-privileges`; la API y la interfaz, con la raíz de solo
  lectura y `tmpfs` en sus escrituras (`/tmp`, `.next/cache`). nginx conserva el modelo de su imagen
  oficial con el mínimo medido de capacidades: `CHOWN`, `NET_BIND_SERVICE`, `SETGID` y `SETUID`.
- **Salida al SRI.** La topología por defecto no tiene salida a Internet, además de
  `SRI_TRANSMISSION_ENABLED=0`. Para el uso real del SRI, el dueño da dos pasos separados y
  deliberados: añadir `deploy/compose.sri-egress.yaml`, que solo conecta la API a una red con salida,
  y declarar `SRI_TRANSMISSION_ENABLED=1`. Ni las pruebas ni la CI levantan ese override.
- **Salida al servidor de correo** (`add-email-delivery`). También son dos pasos separados y
  deliberados, independientes de los del SRI:
  - añadir `deploy/compose.smtp-egress.yaml`, que solo conecta la API a una red con salida;
  - declarar `EMAIL_DELIVERY_ENABLED=1` con un override propio del operador (el Compose de
    referencia la fija en `0`).

  Compose no restringe puertos ni destinos: limita en el firewall del host la salida de la API al
  servidor y al puerto SMTP de la empresa (465 o 587). El servidor, el usuario y la contraseña se
  registran en la aplicación (Configuración → Correos), nunca en el entorno.
- **Entregabilidad.** El correo sale con el remitente que configura cada empresa. Para que no llegue
  como spam, el dominio del remitente necesita sus registros SPF, DKIM y DMARC, que configura su
  proveedor de correo; el sistema no los firma.
- **Buzón de pruebas en la revisión local** (`deploy/compose.mailpit.yaml`). Agrega Mailpit, que
  atrapa los correos sin entregarlos a nadie y los muestra en `http://127.0.0.1:8025`:
  - su SMTP (1025) solo se alcanza por la red interna `app`, y la API sigue sin salida;
  - publica su página solo en el bucle local, por la red `mailpit-ui`, y no tiene relevo configurado;
  - es el único override que pone `EMAIL_DELIVERY_ENABLED=1` y `EMAIL_ALLOW_PLAINTEXT_SMTP=1`;
  - en Configuración → Correos se registra el servidor `mailpit`, puerto 1025, sin cifrado y sin
    usuario.

  Nunca se usa en producción: un servidor sin cifrado solo se admite con esa variable.

### Servicios

| Servicio     | Rol                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------- |
| `api`        | Express: API, casos de uso y runner de jobs.                                                 |
| `frontend`   | Next.js.                                                                                     |
| PostgreSQL   | Remoto, o un contenedor con volumen nombrado persistente. Ningún redeploy borra sus datos.   |
| Artefactos   | En PostgreSQL al inicio, detrás de un puerto de almacenamiento: el respaldo de la base de datos los cubre (ADR 0010, Q-39). |
| Proxy        | Termina TLS. Obligatorio en producción.                                                      |

### Endpoints operacionales

| Ruta | Respuesta | Uso |
| --- | --- | --- |
| `GET /health/live` | `200` mientras el proceso atiende | Liveness del contenedor. |
| `GET /health/ready` | `200` si el paquete de XSD se verificó al arrancar, PostgreSQL responde a `SELECT 1` en 2 s, el pool criptográfico funciona y, con la transmisión al SRI habilitada, se cumplen sus precondiciones; si no, `503`. El cuerpo añade `sriTransmission` (`disabled` o `enabled`) | Readiness y healthcheck. |
| `GET /metrics` | Formato Prometheus | Métricas de proceso y de peticiones, `xsd_registry_available`, las de la firma, `invoice_emission_stage_duration_seconds`, `sri_transmission_enabled` y las de la transmisión al SRI (`../quality/observability.md`). |

- Existen en el servicio `api`, fuera de `/api` (ADR 0016), como endpoints operacionales. No pertenecen a la API pública del producto: no están bajo `/api/v1` ni en `docs/generated/openapi.json`.
- Su exposición no está restringida por la aplicación: el backend los sirve a cualquiera que alcance el servicio. Restringirlos es responsabilidad del despliegue, y ningún despliegue puede publicarlos. En la topología de referencia, el borde los rechaza con `404` sin reenviarlos, y solo se consultan por la red interna.
- `/metrics` publica información del proceso (memoria, CPU, rutas y tiempos de respuesta); si una instalación necesita consultarla desde fuera de la red interna, debe protegerla con autenticación en el proxy.

### Configuración adicional

Además de las variables de la sección Environment. Los nombres son propuestas que fija el
cambio que los introduzca:

- Adaptador y ubicación del almacenamiento de artefactos.
- Zona horaria de las fechas fiscales: `America/Guayaquil` (ERS RNF-010).

### Autenticación y aprovisionamiento

Variables que valida la API al arrancar (`backend/src/config/env.ts`). Los defaults son los de
`../security/hardening.md`; son configuración, no contrato. `CORS_ORIGIN` no se usa: frontend y
API comparten origen (ADR 0016).

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `NODE_ENV` | Sí | | `development`, `test` o `production`, declarado en cada arranque: sin él, o con otro valor, la API no arranca. Con `production` rigen las reglas de producción: cookies `Secure`, rechazo del secreto y de la clave de ejemplo, custodia de la firma obligatoria, y las exigencias de `BETTER_AUTH_URL`, `TRUST_PROXY` y `DATA_EXPORT_DIRECTORY`. |
| `BETTER_AUTH_SECRET` | Sí | | Secreto de Better Auth, de al menos 32 caracteres. El de `.env.example` se rechaza en producción. Generar con `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | Sí | | Origen público de la aplicación, el mismo del frontend (por ejemplo, `https://app.example.com`). Deriva el único origen de confianza, también de `/api/v1`: debe ser el origen exacto que ve el navegador (esquema, host y puerto), nunca la dirección interna. Si no coincide, toda mutación de `/api/v1` recibe 403; sin un origen `http` o `https` válido, la API no arranca. En producción debe usar `https:`; `http:` solo se admite con los hosts exactos `localhost`, `127.0.0.1` y `[::1]`, para una prueba de humo local del software de producción (un host que solo se les parece, como `localhost.example.com`, se rechaza). |
| `INITIAL_USER_EMAIL`, `INITIAL_USER_PASSWORD` | Solo sin empresa | | Administrador inicial del primer arranque. La contraseña cumple la política de contraseñas. |
| `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH` | No | 12, 128 | Política de contraseñas. |
| `LOGIN_MAX_FAILURES`, `LOGIN_FAILURE_WINDOW_MINUTES` | No | 5, 15 | Límite de inicios fallidos por correo e IP. |
| `LOGIN_IP_MAX_REQUESTS`, `LOGIN_IP_WINDOW_SECONDS` | No | 30, 60 | Límite de inicios de sesión por IP, contra ráfagas. |
| `TRUST_PROXY` | En producción, sí | `false` fuera de producción | Proxies de confianza, para que la IP del cliente sea la real; sin confianza, se usa la IP del socket. Solo admite: un número de saltos desde 1; una dirección IP; un bloque CIDR con prefijo desde 1; una lista separada por comas de direcciones o bloques; o `loopback`, solo. Cualquier otro valor (`true`, `0`, `linklocal`, `uniquelocal`, un bloque `/0`, texto arbitrario) impide arrancar en cualquier ambiente. En producción, ausente o `false` también impide arrancar. Un número de saltos solo es correcto si el despliegue garantiza que la cadena de proxies delante de la API tiene exactamente esa longitud: si no, un cliente puede falsear su IP con `X-Forwarded-For`. Por eso se prefieren las direcciones o los bloques del proxy. En la topología de referencia es la IP fija de nginx en la red interna (ver "Topología de referencia"). |

### Frontend

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `API_INTERNAL_URL` | En el build y en la ejecución de producción, sí | `http://127.0.0.1:4000` solo con `next dev` | Origen interno del servicio `api` al que Next.js reenvía `/api` (ADR 0016) y al que la descarga de portabilidad envía cada petición. Debe ser una URL `http:` o `https:` de solo origen, sin credenciales, ruta, consulta ni fragmento; no se exige HTTPS en este salto interno. Nunca se deriva de `Host` ni de una cabecera reenviada. Sin ella, o con un valor inválido, `next build` y `next start` fallan con un mensaje que nombra la variable, sin mostrar su valor, y la descarga responde `500` sin contactar a nadie. |

- **El mismo valor al construir y al ejecutar.** El reenvío de `/api` queda fijado en el build (`.next/routes-manifest.json`), mientras que la descarga lee la variable en cada petición. El operador construye y ejecuta cada build con el mismo `API_INTERNAL_URL`; un valor distinto al ejecutar reparte las peticiones entre dos destinos. No hay una comprobación automática de esa igualdad.
- `corepack pnpm verify` construye su build con `API_INTERNAL_URL=http://127.0.0.1:4000` explícito (`corepack pnpm build:verification`), el destino de bucle local que después sirve `check:web-security-policy`. `corepack pnpm build` a secas falla sin la variable, como cualquier build de producción.

### Firma electrónica

La custodia de la firma (ADR 0011) y el pool criptográfico (design D18 de
`add-signing-certificate`) se validan al arrancar.

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `CERTIFICATE_MASTER_KEY` o `CERTIFICATE_MASTER_KEY_FILE` | Sí, una de las dos, mientras la custodia esté habilitada | | Clave maestra de la custodia de firmas: 32 bytes en base64, en la variable o en un archivo de secreto. Nunca va a la base de datos. La de `.env.example` se rechaza en producción. Generar con `openssl rand -base64 32`. |
| `CERTIFICATE_MASTER_KEY_VERSION` | No | `1` | Identificador de la clave maestra, que se guarda con cada secreto para poder rotarla. |
| `CERTIFICATE_CUSTODY` | No | `enabled` | `disabled` arranca sin custodia de firmas: solo en desarrollo y pruebas, y prohibido en producción. |
| `CERTIFICATE_MAX_BYTES` | No | 65536 | Tamaño máximo del PKCS#12 decodificado, entre 8192 y 1048576. Es configuración, no un límite del SRI: se ajusta si una firma real con su cadena completa lo necesita. Es el único límite que ve el usuario: la API lo publica y la carga de la firma lo muestra. |
| `CRYPTO_WORKERS` | No | 2 | Workers del pool criptográfico (1 a 8): inspección y firma fuera del event loop. |
| `CRYPTO_TASK_TIMEOUT_MS` | No | 30000 | Límite por tarea del pool, en milisegundos (1000 a 120000). Al agotarse, el worker se reemplaza. |

- Sin clave válida, la API no arranca: el error nombra la variable sin mostrar su valor ni la ruta del archivo.
- La clave se respalda aparte de la base de datos (ver Respaldo y restauración).
- Perderla o cambiarla deja las firmas cargadas como no disponibles hasta que cada administrador vuelve a cargar el mismo P12 con su contraseña, que restablece su custodia con la clave configurada (riesgo R-15). Para cambiarla a propósito, «Sustitución de la clave maestra».

### Emisión de facturas

Variables de `add-invoice-emission` (design D2 y D11):

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `XSD_DIRECTORY` | No | `dist/xsd/` en el build; `docs/product/` en desarrollo | Raíz del paquete de XSD del registro de esquemas. Las rutas lógicas del registro (`sri-xsd/…`, `w3c-xsd/…`) se resuelven bajo ella. |
| `XSD_VALIDATION_CONCURRENCY` | No | 2 | Validaciones XSD simultáneas (1 a 8), cada una con su worker de WebAssembly. |
| `XSD_VALIDATION_QUEUE` | No | 16 | Validaciones en espera (0 a 256). Con la cola llena, la etapa falla con `VALIDATOR_BUSY`, reintentable. |
| `XSD_VALIDATION_TIMEOUT_MS` | No | 10000 | Duración máxima de una validación, en milisegundos (1000 a 60000). Al vencer, `VALIDATOR_TIMEOUT`, reintentable. |
| `INVOICE_MAX_LINES` | No | 100 | Líneas por factura (1 a 1000). Es una defensa de recursos de la aplicación, no un límite del SRI ni del XSD. |
| `WITHHOLDING_MAX_SUPPORTS` | No | 10 | Documentos sustento por comprobante de retención (1 a 30). Defensa de recursos del sistema (design D25 de `add-withholding-receipts`): acota el trabajo de la vista previa, el cálculo, el XML, la firma y el RIDE. No es un límite del SRI ni guarda relación con el tamaño del envío (Q-47). |
| `WITHHOLDING_MAX_ITEMS_PER_SUPPORT` | No | 5 | Retenciones por documento sustento (1 a 10). Defensa de recursos del sistema, no un límite del SRI. |
| `WITHHOLDING_MAX_TAXES_PER_SUPPORT` | No | 5 | Impuestos declarados por documento sustento (1 a 10). Defensa de recursos del sistema, no un límite del SRI. |
| `WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT` | No | 5 | Formas de pago por documento sustento (1 a 10). Defensa de recursos del sistema, no un límite del SRI. |
| `SHIPPING_GUIDE_MAX_RECIPIENTS` | No | 10 | Destinatarios por guía de remisión (1 a 50). Defensa de recursos del sistema (design D23 de `add-shipping-guides`): acota el trabajo de la vista previa, el XML, la firma y el RIDE. Se aplica junto con los dos siguientes. No es un límite del SRI ni del XSD ni guarda relación con el tamaño del envío (Q-47). |
| `SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT` | No | 50 | Detalles por destinatario de una guía (1 a 100). Defensa de recursos del sistema, no un límite del SRI. |
| `SHIPPING_GUIDE_MAX_DETAILS` | No | 100 | Detalles por guía (1 a 300). Rige aunque los dos anteriores permitan más. Defensa de recursos del sistema, no un límite del SRI. Crear y actualizar un borrador admiten un cuerpo JSON de hasta 2 MiB, una defensa de recursos HTTP del proyecto que no se configura: un borrador en los máximos absolutos, con textos multibyte de longitud máxima, llega a estos límites sin `413`. Las demás rutas JSON sin límite propio conservan el límite global de 100 KB. |
| `PURCHASE_SETTLEMENT_MAX_LINES` | No | 100 | Líneas por liquidación de compra (1 a 500). Defensa de recursos del sistema (design D22 de `add-purchase-settlements`): acota el trabajo de la vista previa, el cálculo, el XML, la firma y el RIDE; el máximo de 500 mantiene el RIDE del peor caso dentro de 1 s. No es un límite del SRI ni del XSD ni guarda relación con el tamaño del envío (Q-47). |
| `PURCHASE_SETTLEMENT_MAX_PAYMENTS` | No | 10 | Pagos por liquidación de compra (1 a 20). Defensa de recursos del sistema, no un límite del SRI. Crear y actualizar un borrador de liquidación admiten un cuerpo JSON de hasta 4 MiB, una defensa de recursos HTTP del proyecto que no se configura: un borrador en los máximos absolutos, con textos multibyte de longitud máxima, llega a estos límites sin `413`. La emisión y las demás rutas JSON sin límite propio conservan el límite global de 100 KB. |
| `EMISSION_STAGE_TIMINGS` | No | 0 | `1` añade a la respuesta de la emisión de la factura, de la nota de crédito y de la nota de débito la cabecera `Server-Timing` con la duración de cada etapa, para `bench:emission`, `bench:credit-notes`, `bench:debit-notes` y el diagnóstico local. El esquema de entorno la rechaza en producción. |

- El build del backend copia los XSD del registro a `dist/xsd/` y `check:xsd-artifact` comprueba cada archivo con su SHA-256.
- Al arrancar, la API verifica el paquete completo: cada XSD e import del registro vigente, presente y con su SHA-256. Si falta alguno o un hash no coincide, registra qué archivo falla, `xsd_registry_available` vale 0 y `/health/ready` responde `503`: la instalación no se declara lista. Nunca descarga esquemas ni usa otros como sustitutos.
- Con o sin `EMISSION_STAGE_TIMINGS`, cada emisión alimenta el histograma `invoice_emission_stage_duration_seconds{stage,outcome}` (design D16):
  - `stage`: `total`, `reservation_tx`, `validation_snapshot`, `arithmetic`, `xml`, `xsd`, `sign` y `persist`;
  - `outcome`: `signed`, `reserved` (falló una etapa posterior a la reserva), `replayed` (repetición de la misma solicitud), `rejected` (respuesta `4xx`) o `error`;
  - `total` y `reservation_tx` cuentan su tiempo completo; las demás etapas excluyen las anidadas en ellas (`validation_snapshot` no incluye `arithmetic`); `xsd` suma la validación antes y después de firmar.

Primer arranque:

1. Aplicar las migraciones: `corepack pnpm --filter @facturador/backend db:migrate:deploy` (en producción, `prisma migrate deploy` en el contenedor de la API).
2. Arrancar la API con `INITIAL_USER_EMAIL` e `INITIAL_USER_PASSWORD`. Antes de aceptar tráfico crea, en una sola transacción, la empresa con un nombre provisional, su consumidor final, el administrador inicial y su membresía `ADMIN`, y registra el evento de auditoría con el actor sistema. Si falta una variable o la contraseña no cumple la política, la API no arranca, nombra la variable sin mostrar su valor y no crea nada.
3. Retirar `INITIAL_USER_PASSWORD` del entorno después de ese arranque. Una vez aprovisionada la empresa, las dos variables se ignoran: cambiarlas no crea otro usuario ni cambia la contraseña.

Dos arranques simultáneos sobre una instalación vacía crean una sola empresa: el
aprovisionamiento toma un advisory lock de PostgreSQL y vuelve a comprobar dentro de él.

Orden de cada arranque, antes de aceptar tráfico (design D5 de `add-parties-and-products`):

1. Cargar los catálogos fiscales de la versión instalada.
2. Aprovisionar la empresa si falta. Se crea con su consumidor final, cuya identidad sale de la política de consumidor final vigente.
3. Reponer el consumidor final de las empresas que no lo tengan, por ejemplo las anteriores a esta versión. Es idempotente.
4. Si alguna empresa sigue sin consumidor final, la API no arranca.
5. Verificar el paquete de XSD del registro de esquemas (`add-invoice-emission`, design D11). Si es inválido, la API arranca pero `/health/ready` responde `503`.

### Transmisión al SRI

Variables de `add-sri-transmission` (design D5 y D22). Son configuración operativa, no reglas
normativas:

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `SRI_TRANSMISSION_ENABLED` | No | 0 | `1` habilita la transmisión. Nace apagada: un despliegue nunca transmite por accidente. |
| `SRI_JOB_WORKERS` | No | 2 | Workers de la cola en el proceso de la API (0 a 8; 0 los desactiva). |
| `SRI_JOB_LEASE_SECONDS` | No | 120 | Duración del arriendo de un job (30 a 3600). Debe superar el presupuesto del transporte (10 s de conexión, más los plazos de cabeceras y cuerpo) con 10 s de margen; si no, la API no arranca. |
| `SRI_JOB_POLL_INTERVAL_MS` | No | 2000 | Sondeo de la cola sin trabajo (100 a 60000), con jitter de ±50 %. |
| `SRI_REQUEST_TIMEOUT_MS` | No | 30000 | Plazo hasta recibir las cabeceras, desde el inicio de la llamada (1000 a 300000). |
| `SRI_BODY_TIMEOUT_MS` | No | 30000 | Plazo de lectura del cuerpo de la respuesta (1000 a 300000). |
| `SRI_RESPONSE_MAX_BYTES` | No | 5242880 | Tamaño máximo de una respuesta, 5 MiB (64 KiB a 50 MiB). Una mayor se corta y el intento queda incierto. |
| `SRI_AUTHORIZATION_FIRST_DELAY_SECONDS` | No | 5 | Espera tras `RECIBIDA` antes de la primera consulta de autorización (0 a 3600; CTX §23.1). |
| `SRI_POLL_BACKOFF_BASE_SECONDS`, `SRI_POLL_BACKOFF_CAP_SECONDS` | No | 10 y 1800 | Base y tope del backoff exponencial con jitter completo de las consultas y de los reintentos del envío. El tope no puede ser menor que la base. |
| `SRI_CONCLUSION_WINDOW_HOURS` | No | 24 | Ventana de conclusión desde la primera evidencia de recepción (1 a 168; CTX §23.1). |
| `SRI_ERROR70_DELAY_SECONDS` | No | 120 | Espera tras el error 70 antes de reconciliar (0 a 86400). |
| `SRI_TRANSMIT_MAX_ATTEMPTS`, `SRI_TRANSMIT_DEADLINE_HOURS` | No | 10 y 24 | Límites del envío: al agotarlos, el job queda detenido sin cambiar el estado fiscal. |
| `SRI_SWEEP_INTERVAL_SECONDS` | No | 300 | Intervalo del barrido que encola los firmados sin job (10 a 86400). |
| `SRI_BREAKER_FAILURES`, `SRI_BREAKER_COOLDOWN_SECONDS` | No | 5 y 60 | Fallos de transporte seguidos que abren el circuit breaker por servicio y ambiente, y su pausa. |
| `SRI_ENDPOINT_{TEST,PRODUCTION}_{RECEPTION,AUTHORIZATION,VALIDITY}` | No | Módulo central de endpoints (CTX §7) | Sobrescriben un endpoint. En producción exigen `https`. |

- **Deshabilitada** (por defecto): el runner no toma jobs `sri.*`, que siguen `PENDING` sin arriendo, sin consumir intentos y sin ninguna llamada de red. La firma y el barrido siguen creándolos, de modo que al habilitarla avanzan los existentes. La instalación puede estar lista, y lo deja ver: `/health/ready` responde `sriTransmission: "disabled"`, la métrica `sri_transmission_enabled` vale 0 y el arranque registra el estado sin secretos ni URLs.
- **Habilitada:** exige sus precondiciones técnicas, endpoints válidos, al menos un worker y la base de datos. Si falta una, `/health/ready` responde `503`, el log nombra la precondición que falta y los jobs `sri.*` siguen pausados. El interruptor nunca salta una invariante fiscal: la integridad, el tamaño y la evidencia previa se comprueban en cada envío.
- **Apagado:** el runner deja de tomar trabajo, espera hasta 8 s a los jobs en curso y vence los arriendos de los que no terminaron, para que otra instancia los retome. El plazo de parada del orquestador debe cubrirlo.
- **Política de tamaño:** la readiness publica `sriSizePolicy`, sin identificar el comprobante:
  - la fuente `PRODUCT_CONSERVATIVE_POLICY_V1`;
  - `limitBytes` (40 000);
  - la última comprobación: las tres medidas, `allowed` y `blockReason`.

  No hay variable para cambiar el límite ni una sesión de certificación.
- **Habilitación:** solo después de las compuertas previas a la transmisión real (S-3 online con un P12 ecuatoriano real validado y un RUC habilitado en Pruebas; el vector oficial de la clave se cumplió el 2026-10-04 y Q-47 quedó resuelta por política de producto el 2026-10-09), y primero en Pruebas. El procedimiento y el estado de cada compuerta están en `docs/quality/sri-certification.md`.

### RIDE y archivo documental

Variables de `add-document-archive` (design D6). Son configuración operativa, no reglas normativas:

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `RIDE_WORKERS` | No | 2 | Workers del pool del RIDE (1 a 8), independiente del criptográfico. El defecto sale del benchmark de S-4: P95 de 182–191 ms por documento con menos memoria que 4 workers. |
| `RIDE_QUEUE` | No | 4 | Renders en espera del pool (1 a 64). Con la cola llena, el job se reprograma sin gastar su intento. |
| `RIDE_TASK_TIMEOUT_MS` | No | 30000 | Plazo de un render, en milisegundos (5000 a 120000). Al vencer, el worker se reemplaza y el intento falla con backoff. |
| `RIDE_JOB_MAX_ATTEMPTS` | No | 5 | Intentos del job `document.render_ride` (1 a 50). Al agotarlos, la generación queda detenida y visible; el comprobante sigue autorizado. |
| `RIDE_SWEEP_INTERVAL_SECONDS` | No | 300 | Intervalo del barrido que encola el RIDE de los autorizados sin RIDE ni job (10 a 86400). |
| `RIDE_FONTS_DIRECTORY` | No | `dist/assets/fonts/noto-sans/` en el build; `assets/fonts/noto-sans/` en desarrollo | Directorio de las fuentes del RIDE, su licencia y su manifiesto. |

- El build copia las fuentes Noto Sans 2.015 (Regular y Bold), su licencia OFL y `manifest.json` a `dist/assets/fonts/noto-sans/`, y `check:ride-assets` comprueba cada archivo con el hash que fija el código. Es una comprobación distinta de `check:xsd-artifact`; `verify` ejecuta las dos.
- Al arrancar, la API verifica las fuentes. Si falta un archivo, el manifiesto no coincide o un hash no coincide, registra qué archivo falla (sin rutas absolutas), `ride_assets_available` vale 0 y `/health/ready` responde `503` con `rideAssets: "unavailable"`, un detalle propio distinto del de los XSD. El RIDE nunca usa fuentes del sistema.


### Entrega por correo

Variables de `add-email-delivery` (design D5 a D7). Son configuración operativa, no reglas
normativas. El servidor SMTP de cada empresa se registra en la aplicación (Configuración → Correos),
con su contraseña cifrada con la clave maestra de custodia; ninguna variable lo contiene.

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `EMAIL_DELIVERY_ENABLED` | No | 0 | `1` habilita el envío. Nace apagado: apagado, el sistema no conecta con ningún servidor de correo, los envíos quedan desactivados y encenderlo después no los envía. |
| `EMAIL_ALLOW_PLAINTEXT_SMTP` | No | 0 | `1` admite un servidor sin cifrado. Solo para el buzón de pruebas del despliegue de revisión; prohibido en producción. |
| `EMAIL_SMTP_CONNECTION_TIMEOUT_MS` | No | 10000 | Plazo de la conexión y del saludo del servidor, cada uno (1000 a 120000). |
| `EMAIL_SMTP_SOCKET_TIMEOUT_MS` | No | 60000 | Inactividad máxima del socket durante el envío (5000 a 300000). |
| `EMAIL_JOB_WORKERS` | No | 2 | Workers de la cola `email.` en el proceso de la API (0 a 4; 0 los desactiva). Un servidor lento no frena el RIDE ni la transmisión. |
| `EMAIL_JOB_LEASE_SECONDS` | No | 300 | Arriendo de un envío (30 a 3600). Debe cubrir dos veces el plazo de conexión más el del socket y 30 s de margen; si no, la API no arranca. |
| `EMAIL_JOB_POLL_INTERVAL_MS` | No | 2000 | Sondeo de la cola del correo (100 a 60000). |
| `EMAIL_JOB_MAX_ATTEMPTS` | No | 12 | Intentos de un envío (1 a 50). Al agotarlos, el envío queda fallido con su motivo. |
| `EMAIL_RETRY_BASE_SECONDS`, `EMAIL_RETRY_CAP_SECONDS` | No | 60 y 7200 | Espera creciente entre intentos de un fallo temporal: base (1 a 3600) y techo (60 a 86400, no menor que la base). |
| `EMAIL_DELIVERY_DEADLINE_HOURS` | No | 26 | Plazo total de los reintentos (24 a 168): cubre al menos 24 h. |

### Exportación de los reportes

Variables de `add-reports-export` (design D11). Son defensas de recursos del proyecto, no límites
del ERS. `bench:reports` fijó los valores por defecto y los rangos el 2026-10-08, con el volumen de
Q-26 (`../quality/benchmarks/reports-2026-10-08.md`):

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `REPORT_EXPORT_MAX_ROWS` | No | 100000 | Filas de una exportación (1 a 250000). Si el reporte tiene más, la exportación responde `409 REPORT_EXPORT_ROW_LIMIT` antes de generar nada y pide acotar los filtros; nunca entrega un archivo truncado. La lista paginada no tiene este límite. |
| `REPORT_EXPORT_MAX_CONCURRENT` | No | 2 | Exportaciones simultáneas por instancia (1 a 4), con un semáforo local, sin cola. Una exportación de más responde `503 REPORT_EXPORT_BUSY` con `Retry-After` sin afectar a las que están en curso. Con varias instancias, el total es este valor por instancia. |

- **Valores medidos:**
  - con 100 000 filas, la exportación tarda unos 4 s, con 2,7 s de CPU de la API y unos 11 MiB más de memoria residente;
  - su transacción `REPEATABLE READ` dura lo mismo que la generación (unos 4 s);
  - a unos 40 µs por fila, el máximo de 250 000 acota la transacción a unos 10 s y queda lejos de las 1 048 575 filas de una hoja de Excel.
- **Concurrencia:** la generación usa la CPU de la instancia.
  - Con 10 exportaciones de 100 000 filas a la vez, todas tardaron 16 s, con 16 s de transacción cada una.
  - Con 2 lugares, las dos generadas tardaron 5,8 s y las otras ocho se rechazaron al instante.
  - Más de 4 lugares solo alargan cada exportación y sus transacciones.

### Portabilidad de datos

Variables de `add-data-portability` (design D14 y D20). Son defensas de recursos del proyecto, no
límites del ERS. `bench:data-portability` confirmó sus valores por defecto el 2026-10-08
(`../quality/benchmarks/data-portability-2026-10-08.md`):

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `DATA_EXPORT_DIRECTORY` | En producción, sí | Fuera de producción, un subdirectorio del temporal del sistema | Directorio privado (`0700`) y absoluto de los paquetes de portabilidad, fuera de cualquier directorio público o estático. Debe ser un volumen persistente que sobreviva un reinicio durante la vigencia del paquete: el temporal del sistema puede ser `tmpfs` o vaciarse al reiniciar. En producción se aprovisiona antes de arrancar: la API nunca lo crea, y no arranca si falta, si es relativo, si no existe, si es un enlace simbólico o no es un directorio, si no pertenece al usuario del proceso o si ese usuario no puede leerlo, escribir en él o recorrerlo; el mensaje nombra la regla incumplida, sin la ruta. |
| `DATA_EXPORT_MAX_CONCURRENT` | No | 1 | Generaciones a la vez por instancia (1 a 2). Las demás esperan en la cola durable; cada empresa tiene como máximo una generación activa. |
| `DATA_EXPORT_TTL_HOURS` | No | 24 | Vigencia de un paquete listo (1 a 168 horas), contada desde que queda listo y no desde la solicitud. Al caducar se borra el paquete, nunca los datos de la empresa. |
| `DATA_EXPORT_DISK_HEADROOM_PERCENT` | No | 10 | Margen sobre el tamaño sin comprimir del paquete (0 a 100) que el disco debe tener libre antes de copiar los artefactos. |
| `DATA_EXPORT_DISK_RESERVE_MIB` | No | 512 | Reserva fija de disco (64 a 65 536 MiB) que se suma al margen; también se exige antes de leer la base. |
| `DATA_EXPORT_SWEEP_INTERVAL_SECONDS` | No | 300 | Intervalo del barrido de caducidad y recuperación (10 a 86 400 s), que también corre al arrancar. |

- **Disco:** el paquete puede pesar varios GB: 3.68 GB y 592 630 entradas con el volumen de Q-26, con un pico de 3.7 GiB en el directorio durante la generación. Antes de copiar los artefactos, la generación exige el tamaño sin comprimir más el margen y la reserva, más que ese pico. Con una exportación por instancia, cada empresa ocupa como máximo un paquete vigente y una generación en curso.
- **CPU y memoria:** con el volumen de Q-26, una generación tarda unos 10 min (54 s de la lectura consistente y 530 s de los artefactos), usa unos 0,9 núcleos y llega a 723 MiB de memoria residente en el proceso de la API, sin afectar a sus listas (P95 de 20,5 ms durante la generación). Por eso `DATA_EXPORT_MAX_CONCURRENT` es 1: dos generaciones duplican la lectura de la base y la escritura del disco.
- **Varias instancias:** el MVP tiene una (ver "Número de instancias"). Con varias, `DATA_EXPORT_DIRECTORY` debe ser compartido o la descarga debe llegar a la instancia que generó el paquete.
- **No es un respaldo:** el paquete no contiene la firma, los secretos ni los datos internos de autenticación, y no se restaura (ver "Respaldo y restauración").
- **Proxy inverso y descarga:** el backend calcula el SHA-256 completo del paquete antes de enviar la primera cabecera, así que la respuesta de `GET /api/v1/data-exports/{id}/download` tarda en empezar. Medido en un disco giratorio: entre 40 y 56 s para 5 GiB, unos 8 a 11 s por GiB (`openspec/changes/archive/2026-10-08-add-data-portability/ui-review.md`); en un SSD, entre 2.5 y 7.6 s para el paquete de Q-26, de caché caliente a fría (`bench:data-portability`). La verificación completa se mantiene en cada descarga por decisión del dueño del producto (2026-10-08).
  - **Topología de referencia:** el borde espera 180 s en esa ruta, solo en ella, y la entrega por streaming sin guardarla (ver "Topología de referencia").
  - **Requisito del go-live:** el proxy que enruta `/api` al backend debe esperar la respuesta de esa ruta **al menos 120 s** antes del primer byte (por ejemplo, `proxy_read_timeout` de nginx, cuyo valor por defecto es 60 s, o el plazo de respuesta del upstream de Traefik), sin almacenar el cuerpo (`proxy_buffering off`, o el equivalente del proxy). Antes del go-live, el tiempo se vuelve a medir con el almacenamiento real de producción y el margen se ajusta si hace falta.
  - Es un requisito operativo del despliegue, no una constante fiscal ni un requisito del ERS.
  - El reenvío general de `/api` de Next.js corta a los 30 s; por eso el frontend atiende la descarga en su ruta propia del mismo origen, `app/api/v1/data-exports/[id]/download/route.ts`, sin plazo y por streaming. Ese plazo de 30 s no se reintroduce en la descarga.

### Actualizaciones y reversión

- **Invariante de esquema.** Desde `add-parties-and-products`, el esquema exige que cada empresa tenga exactamente un consumidor final. La migración `20261003210000_require_consumer_final` lo hace cumplir con un trigger de restricción diferido sobre `organization`.
- **Downgrade binario.** Una vez aplicada esa migración, volver a una versión anterior de la aplicación no es compatible de forma automática, porque esa versión no conoce la invariante.
- **Estrategia normal:** avanzar, corrigiendo con una versión nueva.
- **Si hiciera falta volver atrás,** se sigue un runbook explícito revisado para ese caso, o se restaura una copia compatible tomada antes de migrar (ver "Respaldo y restauración").
- **Lo que nunca se hace:** quitar una protección de integridad, como ese trigger, para seguir operando con una versión anterior.
- Hoy no existe un sistema de reversión de migraciones.
- **Matriz de casos especiales versión 2** (`block-unsupported-special-cases-before-emission`): la
  reversión es compatible. Ensayo del 2026-10-13 sobre un esquema sintético, sin tráfico al SRI:
  1. la versión nueva aplica la versión 2;
  2. la versión publicada anterior (`a85fade`) arranca sobre la misma base, su cargador reconoce sus
     quince datasets sin error y omite la versión que no conoce, y su consulta de la matriz devuelve
     la última versión guardada, con el anexo 24 fuera del MVP;
  3. la versión nueva vuelve a arrancar sobre la misma base.

  Limitación: la versión anterior sigue bloqueando el anexo 24 en la factura, porque lee la matriz
  guardada, pero vuelve a emitir sin bloqueo la liquidación de compra, la nota de crédito y la nota
  de débito de una empresa declarada gran contribuyente. El bloqueo del anexo 26 vuelve a cubrir
  solo la factura. La matriz que ven los usuarios sigue siendo la correcta.

  Clasificación: **compatible en estructura, limitada en semántica.** Volver a una imagen anterior a
  `block-unsupported-special-cases-before-emission` reabre vías de emisión no soportadas, y esa
  imagen no tiene la misma seguridad fiscal. Regla del operador, si una reversión de emergencia lo
  exige:
  - no reanudar la emisión de una empresa declarada gran contribuyente ni con un RUC proveedor de un
    tercero mientras corra la imagen anterior;
  - preferir corregir y avanzar a la imagen con el bloqueo.

### Configuración de la empresa

Variable que valida la API al arrancar (cambio `add-taxpayer-setup`, design D5):

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `LOGO_MAX_BYTES` | No | 524288 (512 KiB) | Tamaño máximo del logo de la empresa, entre 16384 (16 KiB) y 2097152 (2 MiB). Fuera de ese rango la API no arranca y nombra la variable sin mostrar su valor. |
| `AVATAR_MAX_BYTES` | No | 524288 (512 KiB) | Tamaño máximo del avatar propio de cada usuario (`redesign-account-profile`), entre 16384 (16 KiB) y 2097152 (2 MiB). Fuera de ese rango la API no arranca y nombra la variable sin mostrar su valor. |

El logo se carga con `PUT /api/v1/taxpayer/logo` como cuerpo binario. El proxy inverso debe
admitir cuerpos de al menos `LOGO_MAX_BYTES` en las rutas `/api`; si su límite es menor, el
proxy rechaza la carga antes de que la API pueda responder con su mensaje (por ejemplo, en Nginx,
`client_max_body_size 1m;` cubre el valor por defecto del logo, pero no los borradores: ver "Techo
de cuerpo del proxy"). Los formatos admitidos (PNG y JPEG) y el
máximo de 4096 px por lado son valores de diseño del módulo, no configuración.

### Recuperación administrativa de emergencia

Si ningún administrador puede entrar, el administrador técnico ejecuta en el servidor, con el
mismo entorno de la API:

```bash
# Desarrollo, desde la raíz del repositorio
corepack pnpm --filter @facturador/backend admin:recover --email admin@example.com
# Producción, en el contenedor de la API (directorio del backend compilado)
node dist/commands/admin-recover.js --email admin@example.com
```

- Pide la contraseña nueva por la entrada estándar, sin mostrarla; también la acepta por una tubería. Nunca se pasa como argumento.
- Solo actúa sobre usuarios con rol `ADMIN`: establece la contraseña, reactiva la membresía si estaba desactivada, invalida todas sus sesiones y registra un evento de auditoría con el administrador técnico como actor. Con el correo de un operador o de una cuenta inexistente termina con error y no cambia nada.
- No existe ninguna ruta HTTP equivalente.

### Requisitos del servidor

- Reloj del host, o del contenedor, sincronizado por NTP o un mecanismo equivalente, porque el SRI rechaza firmas con fecha futura (CTX §20.5).
  - Es responsabilidad de la infraestructura del despliegue. La aplicación no mide la desviación: ni `/health/ready` ni las métricas informan del reloj, y no hay un umbral normativo de desviación.
  - En la topología de referencia, los contenedores comparten el reloj del kernel del host: ningún contenedor ejecuta NTP, y la sincronización y su evidencia son del host o de la plataforma.
  - **Evidencia del go-live:** antes de habilitar el uso real, el operador guarda la salida de la herramienta de su host o de su proveedor, sin imponer un servicio concreto: `chronyc tracking` (y `chronyc sources`) con chrony; `timedatectl show -p NTPSynchronized` o `timedatectl timesync-status` con systemd-timesyncd; las métricas `node_timex_sync_status` y `node_timex_offset_seconds` de `node_exporter`; o el equivalente de la plataforma. La evidencia muestra que el host está sincronizado; no se fija un umbral numérico ni se compara con el SRI.
  - La revisión final del go-live pide esa evidencia del host real.
- Salida HTTPS hacia los hosts del SRI.
- Cifrado en reposo del volumen de la base de datos, que guarda también los artefactos, o del disco que lo aloja (ADR 0010, Q-39).

### Número de instancias

- El MVP se despliega con **una sola instancia de API**. Las dos capas del límite de intentos de inicio de sesión (por correo e IP, y el límite nativo de Better Auth por IP) guardan su estado en memoria del proceso: con varias instancias cada una contaría por separado, y un reinicio pone los contadores a cero.
- Desplegar más de una instancia exige, antes del despliegue, mover ese estado a un almacenamiento compartido (`secondaryStorage` de Better Auth u otro equivalente para ambas capas del límite). No bloquea el MVP.
- La reserva de secuenciales usa la configuración de transacción por defecto de Prisma (`maxWait` 2 s, `timeout` 5 s), respaldada por la medición de ERS AC-04: 120 reservas simultáneas en dos instancias, con una espera máxima de 750 ms por reserva (design D5 de `add-fiscal-numbering`). Si la carga real difiere sustancialmente de esa medición (más instancias, más reservas simultáneas sobre un mismo contador u otro tamaño del pool de conexiones), hay que volver a medir la contención antes de cambiar esos valores.

### Respaldo y restauración

Un respaldo completo tiene tres partes, y la restauración necesita las tres (ERS RNF-007,
AC-10):

1. Volcado de PostgreSQL.
2. Almacenamiento de artefactos. Con el adaptador actual viven en PostgreSQL (ADR 0010), así que el
   volcado los incluye.
3. Clave maestra de la custodia de firmas (`CERTIFICATE_MASTER_KEY`, con su versión), guardada por separado de las dos anteriores. El volcado de PostgreSQL solo contiene la firma cifrada.

- **El volcado solo no basta para la custodia de la firma.** Sin la misma clave maestra, la
  aplicación restaurada arranca y funciona, pero cada certificado custodiado aparece no disponible
  (`KEY_UNAVAILABLE`) y la firma queda bloqueada hasta que su administrador vuelve a cargar el mismo
  P12 con su contraseña, que restablece la custodia con la clave configurada. La clave maestra y su
  versión se guardan fuera del volcado, del respaldo, del repositorio y de las imágenes.
- **Respaldo** (topología de referencia; `harden-deployment-proxy-and-recovery`, ADR 0027):
  `deploy/backup.sh <directorio>`, con las mismas variables de Compose del despliegue. Ejecuta
  `pg_dump -Fc` de PostgreSQL 17 dentro del contenedor, por su socket local y sin contraseña en los
  argumentos, y deja el volcado y su `.sha256`, con modo `0600`, imprimiendo solo la ruta, el tamaño y
  la suma. El éxito exige el código 0 de `pg_dump` y la suma registrada.
- **Restauración:** con la aplicación detenida y solo `postgres` en marcha,
  `deploy/restore.sh <volcado>`:
  1. comprueba el SHA-256 antes de tocar nada (código 3 si no coincide);
  2. se niega si la base de destino tiene objetos (código 4); `--replace-existing` la borra y la
     recrea antes, y es destructiva: solo se usa a propósito;
  3. `pg_restore --exit-on-error --no-owner` (código 5 si falla, y la base no se da por recuperada).

  Después se aplican las migraciones (`docker compose -f deploy/compose.yaml up migrate`, sin cambios
  si el esquema estaba al día) y se arranca la aplicación con la misma clave maestra.
- **Lo que no se respalda:** el volumen `exports`. Sus paquetes caducan y se regeneran desde la base;
  tras restaurar, un paquete que figuraba listo queda `FAILED` con `DATA_EXPORT_PACKAGE_MISSING` y su
  evento de auditoría, y la empresa genera uno nuevo.
- **Versiones:** `pg_dump` y `pg_restore` de la misma versión mayor (17), los de la imagen de
  PostgreSQL. No se promete recuperar entre versiones mayores.
- **Sin RTO ni RPO aprobados.** El ensayo registra la duración del respaldo y de la restauración con
  sus datos sintéticos solo como evidencia (`../quality/testing.md`).
- Los respaldos se cifran (ERS SEC-008) y nunca incluyen el P12 sin cifrar (CTX §20.4). El volcado
  contiene datos fiscales y del negocio: su cifrado en reposo, su retención y su copia fuera del
  servidor son del operador, que guarda la clave de ese cifrado aparte del respaldo. La revisión
  final del go-live pide la evidencia del mecanismo elegido.
- El procedimiento de restauración se prueba antes de cada release (ERS §20).
- El SRI no es un sistema de respaldo (CTX §31).
- La exportación de portabilidad (`data-portability`) no es un respaldo: no contiene la firma, los secretos ni los datos internos de autenticación, y no se restaura. AC-10 se verifica restaurando este respaldo.

### Sustitución de la clave maestra

Procedimiento operativo probado para cambiar la clave maestra de la custodia de firmas (ADR 0011;
`repair-signing-certificate-reseal-after-master-key-change`). La aplicación no vuelve a cifrar los
secretos por su cuenta: cada empresa restablece la custodia de su firma volviendo a cargar el mismo
P12. Lo ensaya `backend/test/integration/e2e-master-key-replacement.test.ts`, que reinicia el
backend real con otra clave sobre el mismo esquema, con material sintético.

**Antes de empezar:** cada empresa con firma custodiada tiene a mano su P12 y su contraseña, y la
sustitución se hace en una ventana de mantenimiento: la vuelta atrás descarta lo escrito después
del respaldo.

1. **Respaldo verificado.** Un volcado nuevo con `deploy/backup.sh` y su SHA-256 comprobado. Lo
   ideal es haber ensayado su restauración (sección anterior).
2. **La clave antigua, en custodia segura y aparte,** con su versión: fuera del volcado, del
   repositorio y de las imágenes. Es la única forma de volver atrás.
3. **La clave nueva:** `openssl rand -base64 32` en el archivo de secreto del despliegue
   (`certificate_master_key` en la topología de referencia) y una versión nueva en
   `CERTIFICATE_MASTER_KEY_VERSION` (por ejemplo, de `1` a `2`), que la auditoría registra.
4. **Reinicio o redespliegue** del backend con la clave nueva.
5. **Las firmas custodiadas quedan `KEY_UNAVAILABLE`,** como se espera. El arranque registra cada
   una, sin secretos («la firma vigente no se puede abrir con la clave de custodia configurada», con
   la empresa y la firma), y la métrica `signing_certificate_usable` la muestra en 0.
6. **Cada administrador vuelve a cargar el mismo P12 con su contraseña** en la pantalla de la firma.
   La carga pasa todas las validaciones de una carga normal, y una contraseña incorrecta o un
   archivo inválido no cambian nada.
7. **La recuperación sella la custodia con la clave actual:** la misma firma, con sus metadatos, y
   el evento `signing_certificate.custody_restored` con la versión anterior y la nueva.
8. **Comprobar `VALID`** en la pantalla o en la métrica.
9. **Repetir por empresa** hasta que ninguna firma vigente quede `KEY_UNAVAILABLE`.
10. **La clave antigua:** se conserva o se retira según la política del operador, y solo cuando
    todas las empresas recuperaron su firma.
11. **Vuelta atrás:** restaurar juntos el respaldo del paso 1 y la clave antigua. Volver solo a la
    clave antigua no sirve: las firmas ya recuperadas quedan selladas con la nueva y vuelven a
    `KEY_UNAVAILABLE` (lo comprueba el ensayo). La aplicación no guarda dos claves a la vez.

- **El volcado solo no recupera la custodia:** sin la clave con la que se sellaron, las firmas
  restauradas quedan no disponibles hasta volver a cargarlas.
- **Ninguna clave, ningún P12 y ninguna contraseña** van a los registros, a la auditoría ni al
  volcado: el volcado solo contiene los secretos cifrados.
- **Una empresa que no puede volver a cargar su firma** (perdió el P12 o la contraseña) carga una
  firma nueva de su entidad certificadora, que reemplaza a la anterior. Si eso no es posible a
  tiempo, se vuelve atrás la operación completa (paso 11).
- **Una firma vencida no se recupera:** la carga exige un certificado vigente, así que se carga uno
  nuevo.
- La rotación automática de la clave (volver a cifrar los secretos sin volver a cargarlos) no existe
  y sigue como deuda (ADR 0011).

### Responsabilidades del operador

La documentación de instalación declara dónde residen los datos y qué le corresponde al
operador: TLS, respaldos, NTP, actualizaciones, revisión normativa antes de actualizar y
decisión sobre el RUC proveedor del Anexo 26 (ERS SEC-009; CTX §37, Q-37).

- El go-live de v1 soporta solo el uso propio o el suministro no comercial de EmiteYa: el RUC
  proveedor queda vacío. Vender, licenciar o prestar EmiteYa como sistema o servicio de pago no
  está soportado hasta que el producto escriba el campo «RUC Proveedor» del Anexo 26 (Q-37).
- Al entregar impresa una liquidación de compra, dos ejemplares de su RIDE firmados por el receptor
  (Q-53, `../quality/go-live-normative-review-2026-10-13.md`).

