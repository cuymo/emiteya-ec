# Facturador SRI open source

Facturador electrónico self-hosted para contribuyentes ecuatorianos: configura un
contribuyente y emite, conserva y exporta los seis comprobantes electrónicos del SRI en el
esquema off-line. No es un ERP, un POS ni un sistema contable.

Estado: base técnica (`bootstrap-application`). Ninguna funcionalidad de producto está
implementada todavía. El contexto del producto está en `docs/product/` y la arquitectura en
`ARCHITECTURE.md` y `docs/architecture/`.

## Requisitos

- Node.js 24 LTS (`.node-version` indica la versión probada).
- Corepack, incluido con Node.js. El proyecto usa pnpm con la versión fijada en `package.json`; no uses npm ni yarn.
- Docker con Docker Compose, para PostgreSQL en desarrollo.

## Instalación desde cero

```bash
corepack enable
corepack pnpm install
```

## Base de datos local

PostgreSQL 17 corre en Docker Compose con dos bases: `facturador_dev` para desarrollo y
`facturador_test` para las pruebas de integración.

```bash
docker compose up -d --wait
cp backend/.env.example backend/.env
corepack pnpm --filter @facturador/backend db:migrate:deploy
corepack pnpm --filter @facturador/backend db:status
```

- `POSTGRES_PORT` cambia el puerto local (por defecto 5432); ajusta entonces las URLs de `backend/.env`.
- `db:status` informa el estado de las migraciones una vez inicializada la base con `db:migrate:deploy`.
- Para crear una migración a partir de cambios en `backend/prisma/schema.prisma`:
  `corepack pnpm --filter @facturador/backend db:migrate:dev --name <nombre>`.
- El cliente de Prisma se genera en `backend/src/generated/prisma/` (no versionado) al instalar, y con `db:generate`.
- Para regenerar los modelos de Better Auth tras cambiar sus plugins o su versión:
  `corepack pnpm --filter @facturador/backend db:auth-schema` (ver `docs/architecture/database.md`).

### Comandos destructivos de Prisma

`prisma migrate reset`, `prisma db push --accept-data-loss` y equivalentes borran datos.
Ningún script del proyecto los usa. Solo los ejecuta una persona, de forma explícita, y un
agente nunca los ejecuta sin el consentimiento expreso del usuario. Prisma bloquea estos
comandos cuando detecta que los lanza un agente sin ese consentimiento.

## Desarrollo local

Con PostgreSQL en marcha y `backend/.env` creado (ver la sección anterior):

```bash
corepack pnpm dev
```

| Servicio | URL |
| --- | --- |
| Frontend (Next.js) | http://localhost:3000 |
| API, a través del frontend (mismo origen) | http://localhost:3000/api/v1/… |
| Backend directo | http://localhost:4000 |
| Salud y métricas del backend (operacionales; no son API pública) | http://localhost:4000/health/live, /health/ready, /metrics |

- El frontend reenvía `/api/*` al backend; cambia el destino con `API_INTERNAL_URL` en `frontend/.env.local` (ver `frontend/.env.example`).
- El backend corre con el soporte nativo de TypeScript de Node 24 y se reinicia al guardar. Respeta las restricciones de ADR 0016: sin `enum`, `namespace` con contenido, propiedades de parámetro ni alias de `paths`, e imports relativos con extensión `.ts`.

## Verificación

```bash
corepack pnpm verify
```

Encadena formato, versiones fijadas, generación del cliente de Prisma, lint, typecheck,
pruebas (las de integración exigen PostgreSQL en marcha), OpenAPI, el arranque del backend en
modo desarrollo y el build. Si PostgreSQL no está disponible, las pruebas de integración
fallan con la indicación de levantarlo.

## Reglas sobre versiones

- Las dependencias se instalan con versión exacta y el lockfile se versiona.
- Prisma permanece en la major 7. Ejecuta sus binarios solo desde el repositorio:
  `corepack pnpm exec prisma …` o los scripts `db:*`. Nunca uses `npx prisma` ni
  `pnpm dlx prisma` sin versión: descargarían la última publicada, que puede ser Prisma 8.
