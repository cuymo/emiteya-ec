# EmiteYa

Facturador electrónico open source y self-hosted para contribuyentes ecuatorianos: configura un
contribuyente y emite, conserva, envía por correo y exporta los seis comprobantes electrónicos del
SRI en el esquema off-line. No es un ERP, un POS ni un sistema contable.

**Estado:** la aplicación está completa para su primera versión pública (`CHANGELOG.md`). Quedó
certificada en el ambiente de Pruebas del SRI el 2026-10-11, con los siete comprobantes de la
matriz autorizados (`docs/quality/sri-certification.md`). La transmisión al SRI viene apagada
(`SRI_TRANSMISSION_ENABLED=0`): habilitar el ambiente de Producción es una decisión de cada
instalación, con su propia firma electrónica y la lista de la sección «Fuera de este runbook:
go-live» de ese documento. El alcance de v1 es el uso propio o el suministro no comercial
(`docs/product/overview.md`).

El contexto del producto está en `docs/product/` y la arquitectura en `ARCHITECTURE.md` y
`docs/architecture/`.

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

- El frontend reenvía `/api/*` al backend; cambia el destino con `API_INTERNAL_URL` en `frontend/.env.local` (ver `frontend/.env.example`). La descarga del paquete de portabilidad tiene su propia ruta del mismo origen, que lee la misma variable.
- El backend corre con el soporte nativo de TypeScript de Node 24 y se reinicia al guardar. Respeta las restricciones de ADR 0016: sin `enum`, `namespace` con contenido, propiedades de parámetro ni alias de `paths`, e imports relativos con extensión `.ts`.

El primer arranque del backend crea la empresa y el administrador inicial con
`INITIAL_USER_EMAIL` e `INITIAL_USER_PASSWORD` de `backend/.env`; con ellos se inicia sesión.
Recuperación de emergencia de un administrador: `docs/architecture/deployment.md`.

## Despliegue de producción

La topología de referencia es `deploy/compose.yaml`: nginx como único servicio público (TLS en
443 y redirección en 80), y la interfaz, la API y PostgreSQL 17 en una red interna sin salida a
Internet. El detalle está en `docs/architecture/deployment.md` ("Topología de referencia" y
"Respaldo y restauración") y en ADR 0027.

**Instalación**, en un servidor Linux con Docker y Docker Compose:

1. Crea fuera del repositorio el archivo de entorno y el directorio de secretos que describe
   `deploy/production.env.example`: la contraseña de PostgreSQL, la clave maestra de la custodia
   (32 bytes en base64, legible por el UID 1000), el certificado TLS válido con su clave, y
   `DATABASE_URL`, `BETTER_AUTH_SECRET` y el administrador inicial.
2. Exporta las variables de Compose (`EMITEYA_ENV_FILE`, `EMITEYA_SECRETS_DIR`, `PUBLIC_ORIGIN` y,
   si la subred choca con la del host, `APP_SUBNET`, `APP_IP_RANGE` y `PROXY_APP_IP` juntas).
3. Construye las imágenes y arranca:

   ```bash
   docker compose -f deploy/compose.yaml build
   docker compose -f deploy/compose.yaml up -d
   ```

   PostgreSQL arranca, las migraciones se aplican una vez y solo entonces arranca la API. La
   instalación está lista cuando `/health/ready` responde 200 por la red interna:

   ```bash
   docker compose -f deploy/compose.yaml exec backend \
     node -e "fetch('http://127.0.0.1:4000/health/ready').then((r) => process.exit(r.ok ? 0 : 1))"
   ```

4. Inicia sesión con el administrador inicial y retira después `INITIAL_USER_PASSWORD` del archivo
   de entorno.

La transmisión al SRI nace apagada (`SRI_TRANSMISSION_ENABLED=0`) y la red de la aplicación no
tiene salida. El uso real del SRI exige dos pasos deliberados del dueño, documentados en
`docs/architecture/deployment.md`.

**Actualización:** respalda la base, actualiza el repositorio a la versión nueva y repite el paso 3
(`build` y `up -d`): Compose aplica las migraciones antes de recrear la API y la interfaz, y una
migración fallida deja la API sin arrancar.

**Respaldo**, con las mismas variables de Compose:

```bash
deploy/backup.sh /ruta/de/respaldos
```

Deja un volcado `pg_dump -Fc` de PostgreSQL 17 y su `.sha256`. Contiene datos fiscales y del
negocio: cífralo y guárdalo fuera del servidor bajo tu control. La clave maestra de la custodia no
va en el volcado y se respalda aparte: sin ella, los certificados custodiados no se recuperan.

**Restauración**, con la aplicación detenida y una base vacía:

```bash
docker compose -f deploy/compose.yaml up -d postgres
deploy/restore.sh /ruta/de/respaldos/emiteya-<fecha>.dump
docker compose -f deploy/compose.yaml up -d
```

`restore.sh` comprueba la suma antes de tocar nada y se niega a escribir sobre una base con datos;
su opción `--replace-existing` es destructiva.

## Verificación

```bash
corepack pnpm verify
```

Los ensayos del despliegue (`corepack pnpm deployment:context`, `deployment:topology` y
`deployment:recovery`) necesitan Docker y corren aparte, también en el workflow `deployment` de la
CI (`docs/quality/testing.md`).

Encadena formato, versiones fijadas, generación del cliente de Prisma, lint, typecheck,
pruebas (las de integración exigen PostgreSQL en marcha), OpenAPI, el arranque del backend en
modo desarrollo y el build. Si PostgreSQL no está disponible, las pruebas de integración
fallan con la indicación de levantarlo.

## Reglas sobre versiones

- Las dependencias se instalan con versión exacta y el lockfile se versiona.
- Prisma permanece en la major 7. Ejecuta sus binarios solo desde el repositorio:
  `corepack pnpm exec prisma …` o los scripts `db:*`. Nunca uses `npx prisma` ni
  `pnpm dlx prisma` sin versión: descargarían la última publicada, que puede ser Prisma 8.

## Contribuir y seguridad

- Cómo contribuir: `CONTRIBUTING.md`. Conducta: `CODE_OF_CONDUCT.md`.
- Vulnerabilidades: repórtalas en privado como indica `SECURITY.md`, nunca en un issue público.

## Licencia

EmiteYa se publica bajo la [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
Puedes usarlo, estudiarlo, modificarlo y compartirlo. Si lo ofreces a otras personas como servicio
en red con cambios, debes publicar el código de esos cambios bajo la misma licencia.

Copyright (C) 2026 los colaboradores de EmiteYa.
