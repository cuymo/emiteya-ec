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

### Requisitos del servidor

- Reloj sincronizado por NTP; la salud informa la desviación, porque el SRI rechaza firmas con fecha futura (CTX §20.5).
- Salida HTTPS hacia los hosts del SRI.
- Cifrado en reposo del volumen de artefactos y de la base de datos, o del disco que los aloja (Q-39).

### Número de instancias

- El MVP se despliega con **una sola instancia de API**. El límite de intentos de inicio de sesión guarda su estado en memoria del proceso, y con varias instancias cada una contaría por separado.
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

