# Proposal

## Why

El repositorio solo tiene documentación y planificación: no existe código, ni un comando que
verifique nada, ni un repositorio Git. Ningún cambio con comportamiento, empezando por
`add-user-access`, puede aplicarse sin una base ejecutable y verificable que fije las
herramientas, las versiones y la estructura de módulos de la arquitectura aprobada. El
bootstrap da esa base a quien desarrolla y a los agentes, sin implementar ninguna
funcionalidad del producto.

## What Changes

- Repositorio Git con `.gitignore`, `.gitattributes` y lockfile versionado.
- Workspace pnpm con Corepack, que reemplaza el `package.json` generado por `npm init`: `backend/` (Express), `frontend/` (Next.js) y `packages/contracts/` (contratos compartidos).
- Versiones fijadas: Node.js 24 LTS, pnpm, TypeScript 6.0, y Prisma en la major 7 con versiones exactas y overrides.
- Base de calidad: formato, lint con reglas de capas, typecheck, pruebas y un `corepack pnpm verify` que las encadena.
- Backend: configuración por entorno validada al arrancar, logs estructurados con redacción, identificador de correlación, métricas, manejo base de errores, endpoints internos de salud y preparación, apagado ordenado y la estructura de módulos `domain` / `application` / `infrastructure`.
- Base de datos: PostgreSQL local con Docker Compose, Prisma 7 con su adapter de PostgreSQL, infraestructura de migraciones sin ninguna tabla, y una base de pruebas.
- Generación de OpenAPI desde los esquemas de los contratos, para las rutas que agreguen los cambios futuros.
- Frontend: Next.js con Tailwind CSS, shadcn/ui, temas claro y oscuro, un shell sin navegación ni autenticación, y un cliente tipado de la API.
- CI que ejecuta la verificación completa con PostgreSQL.
- README para ejecutar el proyecto desde cero y documentación de arquitectura actualizada.

Fuera de alcance:

- Better Auth, sesiones, login, autorización, aprovisionamiento inicial y cualquier tabla de usuarios, empresas o membresías: cambio `add-user-access`.
- UI autenticada, componentes compartidos de interfaz (tablas, diálogos, formularios) y React Hook Form: se crean con el primer módulo que los necesite.
- Entidades de negocio, lógica tributaria, catálogos e integración con el SRI.
- Runner de jobs (ADR 0012), almacenamiento de artefactos (ADR 0010) y secretos de firma (ADR 0011).
- Imágenes Docker de la aplicación, despliegue e instalador; Compose solo levanta PostgreSQL para desarrollo.
- CORS para un dominio de API separado: en desarrollo el frontend accede a la API por el mismo origen.
- Elegir la licencia del proyecto (Q-33).

## Capabilities

### New Capabilities

Ninguna. El cambio no introduce comportamiento de producto: salud, preparación, entorno y
errores son infraestructura, que las specs no describen. Declara `skip_specs: true`, como
indicaba la secuencia de `docs/product/capabilities.md`.

### Modified Capabilities

Ninguna.

## Impact

- Repositorio: inicialización de Git, workspace pnpm, lockfile y configuración compartida en la raíz.
- Código nuevo: `backend/`, `frontend/` y `packages/contracts/`, sin funcionalidad de negocio.
- Infraestructura local: `compose.yaml` con PostgreSQL 17 y una base de pruebas.
- CI: un workflow de verificación en `.github/workflows/`, sin tocar los archivos de OpenSpec generados en `.github/`.
- Dependencias de producción nuevas, cada una justificada en el diseño: Express, Zod, Prisma con su adapter, `pg`, pino, prom-client, helmet, Next.js, React, Tailwind CSS, shadcn/ui, lucide-react y next-themes.
- Documentación: `README.md`, `docs/architecture/backend.md`, `deployment.md`, `stack.md`, `docs/quality/testing.md` y una ADR nueva (0016) con la estructura del repositorio y las herramientas base.
- Habilita `/opsx:apply add-user-access`, que requiere este cambio aplicado.
