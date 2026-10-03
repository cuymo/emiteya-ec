# Stack Baseline

This is the default technology stack for new applications using this context.

## Package Manager

- Use pnpm through Corepack.
- Do not use npm or yarn for installs, scripts, audits, or lockfile updates.
- Keep the package manager version declared in `packageManager` when a code repo exists.

Recommended commands:

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
corepack pnpm verify
```

## Backend

- Node.js.
- TypeScript.
- Express.js for REST APIs.
- Zod for request, response, and environment validation.
- Better Auth for authentication.
- Prisma for database access.
- PostgreSQL as the primary database.
- Axios for external HTTP APIs.

## Frontend

- Next.js with TypeScript.
- React.
- Tailwind CSS.
- shadcn/ui for reusable UI components.
- lucide-react for icons.
- React Hook Form for forms.
- Zod for form schemas.
- shadcn charts or a chart library integrated through shadcn conventions for dashboards.
- Auto-animate or equivalent small motion helpers only when motion improves clarity.

## Persistence

- PostgreSQL is the production database.
- Prisma migrations are the schema source of truth.
- SQLite can be used only for disposable local experiments if explicitly documented.

## Authentication

- Better Auth owns sign-in, sign-out, sessions, cookies, password hashing, and auth tables.
- Do not implement custom password hashing or session tables unless an ADR replaces Better Auth.

## Deployment

- Docker is the default packaging target.
- The database can be remote in production.
- Containers must not destroy database data on redeploy.
- Health checks should exist for API containers.
- Frontend and API can share one public domain when routed by path, for example `/` and `/api`.

## Versiones fijadas en este proyecto

- Prisma permanece en la major 7 durante esta fase: Better Auth 1.7.7 no admite Prisma 8, y la etiqueta `latest` de Prisma apunta a una release candidate de la 8. `prisma`, `@prisma/client`, `@prisma/adapter-pg` y `@prisma/engines` se fijan en versión exacta (`7.10.0`), con el generador `prisma-client`, y con overrides del workspace, para que ninguna dependencia transitiva traiga otra.
- Better Auth se fija en la versión exacta validada por el spike S-1; su política de actualización está en `authentication.md`.
- Los binarios de Prisma y de Better Auth se ejecutan siempre desde las dependencias del repositorio (`corepack pnpm exec prisma …`, `corepack pnpm exec auth …`, o los scripts de `package.json`). Nunca con `npx prisma` ni `pnpm dlx` sin versión, que descargarían la última publicada.
- Las dependencias se añaden con versión exacta, y el lockfile se versiona.

Versiones de la base técnica (`bootstrap-application`); `check:versions` impide rangos y Prisma fuera de la major 7:

| Herramienta | Versión | Nota |
| --- | --- | --- |
| Node.js | 24 LTS (`.node-version`: 24.21.0; `engines`: `>=24.21.0 <25`) | Type stripping nativo en desarrollo (ADR 0016). `facturacion-electronica-ec` exige al menos 24.18.0. |
| Motor SRI | `facturacion-electronica-ec` 1.0.1 y `ec-sri-invoice-signer` 1.8.2, versiones exactas | Builders XML, clave de acceso, XSD, XAdES-BES y SOAP detrás de puertos propios, importados solo desde `modules/sri-engine/infrastructure` (ADR 0018). |
| Inspección de PKCS#12 | `node-forge` 1.4.0, versión exacta | Lee el certificado y la clave al cargar la firma, con los mismos formatos que el firmador (ADR 0019). |
| pnpm | 12.4.2 vía Corepack | `packageManager`; configuración en `pnpm-workspace.yaml`. |
| TypeScript | 6.0.3 | `typescript-eslint` no admite todavía la 7. |
| ESLint / typescript-eslint | 10.11.0 / 8.71.0 | Frontend sin `eslint-config-next` (ADR 0016). |
| Prettier | 3.9.9 | |
| Vitest | 5.0.3 | |
| Express | 5.2.1 | Validada por S-1. |
| Zod | 4.6.5 | Misma major que Better Auth. |
| Prisma / @prisma/client / @prisma/adapter-pg | 7.10.0 | Generador `prisma-client`. |
| PostgreSQL | 17 | Compose y CI. |
| pino / pino-http | 10.3.1 / 11.0.0 | |
| @prometheus-io/client | 0.16.1 | Sucesor oficial de `prom-client`. |
| helmet | 8.3.0 | |
| Next.js / React | 16.3.8 / 19.3.0 | |
| Tailwind CSS | 4.3.3 | |
| better-auth / @better-auth/core / CLI `auth` | 1.7.7 | Versión validada por S-1; se actualiza solo con los tests de contrato (`authentication.md`). |
| radix-ui | 1.6.7 | Primitivas accesibles de shadcn/ui (diálogo, menú, tooltip, grupo de radio, chips). |
| react-hook-form / @hookform/resolvers | 7.89.0 / 5.9.1 | Formularios con los esquemas Zod del contrato. |
| @tanstack/react-table | 8.21.3 | Tabla compartida. La 9, estable desde agosto de 2026, cambia la API; se adopta en su propio cambio. |
| @tanstack/react-query | 5.104.0 | Estado de servidor: cancelación de consultas obsoletas, invalidación tras mutaciones y deduplicación, que `frontend.md` exige y que no conviene reimplementar. |
| sonner | 2.0.8 | El sistema de avisos de shadcn/ui; un único toaster semántico. |

## Documentation

When a project deviates from this stack, create an ADR in `docs/architecture/adr/`.

