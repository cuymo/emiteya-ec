# Deployment Architecture

## Docker

Applications should be deployable with Docker.

Recommended services:

- `api`: Express.js backend.
- `frontend`: Next.js frontend.
- Remote PostgreSQL database for production.

## Environment

Keep runtime configuration in environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `CORS_ORIGIN`
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

Frontend environment:

```text
NEXT_PUBLIC_API_BASE_URL=https://app.example.com
```

Backend environment:

```text
CORS_ORIGIN=https://app.example.com
BETTER_AUTH_URL=https://app.example.com
```

### Separate API Domain

- Frontend: `https://app.example.com/`
- API: `https://api.example.com/`

Use this when path routing is not available or when API isolation matters.

## Data Safety

- Redeploying the application must not delete database data.
- Production migrations should be explicit and reviewed.
- Initial broad database privileges can be used to run migrations, then reduced to least privilege.
- Volumes should be used only for files that must persist outside the database.

## Instalación self-hosted

El producto se instala por contribuyente, una empresa por instancia, en un servidor Linux
que opera el administrador técnico. Lo que sigue es la topología objetivo; el instalador de
un solo paso es P2.

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
- Su exposición no está restringida por la aplicación: el backend los sirve a cualquiera que alcance el servicio. Restringirlos (red interna, reglas del proxy o autenticación) es una responsabilidad obligatoria del despliegue, que todavía está fuera de alcance; ningún despliegue puede publicarlos sin esa restricción. El diseño previsto es que el proxy público solo enrute `/` al frontend y `/api` al backend, y que el orquestador y el sistema de métricas los consulten por la red interna, pero esa garantía se implementará con el despliegue.
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
| `BETTER_AUTH_SECRET` | Sí | | Secreto de Better Auth, de al menos 32 caracteres. El de `.env.example` se rechaza en producción. Generar con `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | Sí | | Origen público de la aplicación, el mismo del frontend (por ejemplo, `https://app.example.com`). Deriva los orígenes de confianza. |
| `INITIAL_USER_EMAIL`, `INITIAL_USER_PASSWORD` | Solo sin empresa | | Administrador inicial del primer arranque. La contraseña cumple la política de contraseñas. |
| `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH` | No | 12, 128 | Política de contraseñas. |
| `LOGIN_MAX_FAILURES`, `LOGIN_FAILURE_WINDOW_MINUTES` | No | 5, 15 | Límite de inicios fallidos por correo e IP. |
| `LOGIN_IP_MAX_REQUESTS`, `LOGIN_IP_WINDOW_SECONDS` | No | 30, 60 | Límite de inicios de sesión por IP, contra ráfagas. |
| `TRUST_PROXY` | No | `false` | Número de proxies de confianza o sus direcciones. Detrás del proxy público, declararlo para que la IP del cliente sea la real; sin él, se usa la IP del socket. |

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
- Perderla o cambiarla deja las firmas cargadas como no disponibles hasta volver a cargarlas (riesgo R-15). La rotación verificada es requisito del go-live (ADR 0011).

### Emisión de facturas

Variables de `add-invoice-emission` (design D2 y D11):

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `XSD_DIRECTORY` | No | `dist/xsd/` en el build; `docs/product/` en desarrollo | Raíz del paquete de XSD del registro de esquemas. Las rutas lógicas del registro (`sri-xsd/…`, `w3c-xsd/…`) se resuelven bajo ella. |
| `XSD_VALIDATION_CONCURRENCY` | No | 2 | Validaciones XSD simultáneas (1 a 8), cada una con su worker de WebAssembly. |
| `XSD_VALIDATION_QUEUE` | No | 16 | Validaciones en espera (0 a 256). Con la cola llena, la etapa falla con `VALIDATOR_BUSY`, reintentable. |
| `XSD_VALIDATION_TIMEOUT_MS` | No | 10000 | Duración máxima de una validación, en milisegundos (1000 a 60000). Al vencer, `VALIDATOR_TIMEOUT`, reintentable. |
| `INVOICE_MAX_LINES` | No | 100 | Líneas por factura (1 a 1000). Es una defensa de recursos de la aplicación, no un límite del SRI ni del XSD. |
| `EMISSION_STAGE_TIMINGS` | No | 0 | `1` añade a la respuesta de la emisión de la factura y de la nota de crédito la cabecera `Server-Timing` con la duración de cada etapa, para `bench:emission`, `bench:credit-notes` y el diagnóstico local. El esquema de entorno la rechaza en producción. |

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
- **Habilitada:** exige sus precondiciones técnicas, endpoints válidos, una política de tamaño vigente (Q-47), al menos un worker y la base de datos. Si falta una, `/health/ready` responde `503`, el log nombra la precondición que falta y los jobs `sri.*` siguen pausados. El interruptor nunca salta una invariante fiscal: la integridad, el tamaño y la evidencia previa se comprueban en cada envío.
- **Apagado:** el runner deja de tomar trabajo, espera hasta 8 s a los jobs en curso y vence los arriendos de los que no terminaron, para que otra instancia los retome. El plazo de parada del orquestador debe cubrirlo.
- **Habilitación:** solo después de las compuertas previas a la transmisión real (la cifra exacta en bytes de Q-47 publicada en su política, y S-3 online con un P12 ecuatoriano real validado y un RUC habilitado en Pruebas; el vector oficial de la clave se cumplió el 2026-10-04), y primero en Pruebas. El procedimiento y el estado de cada compuerta están en `docs/quality/sri-certification.md`.

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

### Actualizaciones y reversión

- **Invariante de esquema.** Desde `add-parties-and-products`, el esquema exige que cada empresa tenga exactamente un consumidor final. La migración `20261003210000_require_consumer_final` lo hace cumplir con un trigger de restricción diferido sobre `organization`.
- **Downgrade binario.** Una vez aplicada esa migración, volver a una versión anterior de la aplicación no es compatible de forma automática, porque esa versión no conoce la invariante.
- **Estrategia normal:** avanzar, corrigiendo con una versión nueva.
- **Si hiciera falta volver atrás,** se sigue un runbook explícito revisado para ese caso, o se restaura una copia compatible tomada antes de migrar (ver "Respaldo y restauración").
- **Lo que nunca se hace:** quitar una protección de integridad, como ese trigger, para seguir operando con una versión anterior.
- Hoy no existe un sistema de reversión de migraciones.

### Configuración de la empresa

Variable que valida la API al arrancar (cambio `add-taxpayer-setup`, design D5):

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `LOGO_MAX_BYTES` | No | 524288 (512 KiB) | Tamaño máximo del logo de la empresa, entre 16384 (16 KiB) y 2097152 (2 MiB). Fuera de ese rango la API no arranca y nombra la variable sin mostrar su valor. |

El logo se carga con `PUT /api/v1/taxpayer/logo` como cuerpo binario. El proxy inverso debe
admitir cuerpos de al menos `LOGO_MAX_BYTES` en las rutas `/api`; si su límite es menor, el
proxy rechaza la carga antes de que la API pueda responder con su mensaje (por ejemplo, en Nginx,
`client_max_body_size 1m;` cubre el valor por defecto). Los formatos admitidos (PNG y JPEG) y el
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

- Reloj sincronizado por NTP; la salud informa la desviación, porque el SRI rechaza firmas con fecha futura (CTX §20.5).
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
2. Almacenamiento de artefactos.
3. Clave maestra de la custodia de firmas (`CERTIFICATE_MASTER_KEY`, con su versión), guardada por separado de las dos anteriores. El volcado de PostgreSQL solo contiene la firma cifrada.

- Los respaldos se cifran (ERS SEC-008) y nunca incluyen el P12 sin cifrar (CTX §20.4).
- El procedimiento de restauración se prueba antes de cada release (ERS §20).
- El SRI no es un sistema de respaldo (CTX §31).

### Responsabilidades del operador

La documentación de instalación declara dónde residen los datos y qué le corresponde al
operador: TLS, respaldos, NTP, actualizaciones, revisión normativa antes de actualizar y
decisión sobre el RUC proveedor del Anexo 26 (ERS SEC-009; CTX §37, Q-37).

