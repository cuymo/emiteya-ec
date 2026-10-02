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
| Artefactos   | Volumen persistente o almacenamiento S3-compatible, según el adaptador elegido (ADR 0010, Q-39). |
| Proxy        | Termina TLS. Obligatorio en producción.                                                      |

### Endpoints operacionales

| Ruta | Respuesta | Uso |
| --- | --- | --- |
| `GET /health/live` | `200` mientras el proceso atiende | Liveness del contenedor. |
| `GET /health/ready` | `200` si PostgreSQL responde a `SELECT 1` en 2 s; si no, `503` | Readiness y healthcheck. |
| `GET /metrics` | Formato Prometheus | Métricas de proceso y de peticiones. |

- Existen en el servicio `api`, fuera de `/api` (ADR 0016), como endpoints operacionales. No pertenecen a la API pública del producto: no están bajo `/api/v1` ni en `docs/generated/openapi.json`.
- Su exposición no está restringida por la aplicación: el backend los sirve a cualquiera que alcance el servicio. Restringirlos (red interna, reglas del proxy o autenticación) es una responsabilidad obligatoria del despliegue, que todavía está fuera de alcance; ningún despliegue puede publicarlos sin esa restricción. El diseño previsto es que el proxy público solo enrute `/` al frontend y `/api` al backend, y que el orquestador y el sistema de métricas los consulten por la red interna, pero esa garantía se implementará con el despliegue.
- `/metrics` publica información del proceso (memoria, CPU, rutas y tiempos de respuesta); si una instalación necesita consultarla desde fuera de la red interna, debe protegerla con autenticación en el proxy.

### Configuración adicional

Además de las variables de la sección Environment. Los nombres son propuestas que fija el
cambio que los introduzca:

- Endpoints del SRI por ambiente y servicio; los valores por defecto están en el módulo central de endpoints (CTX §7).
- Timeouts del cliente SRI, intervalo inicial y ventana de la consulta de autorización.
- Clave maestra de cifrado del certificado, por variable o archivo de secreto, nunca en la base de datos (ADR 0011).
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

Primer arranque:

1. Aplicar las migraciones: `corepack pnpm --filter @facturador/backend db:migrate:deploy` (en producción, `prisma migrate deploy` en el contenedor de la API).
2. Arrancar la API con `INITIAL_USER_EMAIL` e `INITIAL_USER_PASSWORD`. Antes de aceptar tráfico crea, en una sola transacción, la empresa con un nombre provisional, el administrador inicial y su membresía `ADMIN`, y registra el evento de auditoría con el actor sistema. Si falta una variable o la contraseña no cumple la política, la API no arranca, nombra la variable sin mostrar su valor y no crea nada.
3. Retirar `INITIAL_USER_PASSWORD` del entorno después de ese arranque. Una vez aprovisionada la empresa, las dos variables se ignoran: cambiarlas no crea otro usuario ni cambia la contraseña.

Dos arranques simultáneos sobre una instalación vacía crean una sola empresa: el
aprovisionamiento toma un advisory lock de PostgreSQL y vuelve a comprobar dentro de él.

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
- Cifrado en reposo del volumen de artefactos y de la base de datos, o del disco que los aloja (Q-39).

### Número de instancias

- El MVP se despliega con **una sola instancia de API**. Las dos capas del límite de intentos de inicio de sesión (por correo e IP, y el límite nativo de Better Auth por IP) guardan su estado en memoria del proceso: con varias instancias cada una contaría por separado, y un reinicio pone los contadores a cero.
- Desplegar más de una instancia exige, antes del despliegue, mover ese estado a un almacenamiento compartido (`secondaryStorage` de Better Auth u otro equivalente para ambas capas del límite). No bloquea el MVP.

### Respaldo y restauración

Un respaldo completo tiene tres partes, y la restauración necesita las tres (ERS RNF-007,
AC-10):

1. Volcado de PostgreSQL.
2. Almacenamiento de artefactos.
3. Clave maestra de cifrado, guardada por separado de las dos anteriores.

- Los respaldos se cifran (ERS SEC-008) y nunca incluyen el P12 sin cifrar (CTX §20.4).
- El procedimiento de restauración se prueba antes de cada release (ERS §20).
- El SRI no es un sistema de respaldo (CTX §31).

### Responsabilidades del operador

La documentación de instalación declara dónde residen los datos y qué le corresponde al
operador: TLS, respaldos, NTP, actualizaciones, revisión normativa antes de actualizar y
decisión sobre el RUC proveedor del Anexo 26 (ERS SEC-009; CTX §37, Q-37).

