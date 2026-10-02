# ADR 0016: Estructura del repositorio y herramientas base

## Status

Accepted, 2026-10-02. Aprobado con el cambio `bootstrap-application`, tras la prueba de compatibilidad de Better Auth 1.7.7 con el generador `prisma-client` de Prisma 7.

## Context

El repositorio no tenía código. `stack.md` fija el stack (Express, Next.js, Prisma,
PostgreSQL, pnpm), pero no la estructura del workspace, las herramientas de calidad, el modo
de ejecutar TypeScript, dónde viven los endpoints operativos ni cómo se genera OpenAPI. Cada
vertical slice necesita esas reglas antes de empezar.

## Decision

- Workspace pnpm con `backend/`, `frontend/` y `packages/contracts/`; todos los paquetes son ESM.
- Node.js 24 LTS, pnpm 12.4.2 vía Corepack, TypeScript 6.0.3 y Prisma 7.10.0, todos con versión exacta; overrides de Prisma en `pnpm-workspace.yaml` y una comprobación de versiones dentro de `verify`.
- Backend en desarrollo con el type stripping nativo de Node 24, sin `tsx`; en producción, JavaScript compilado con `tsc`. El `tsconfig` usa `target` `esnext`, `module` `nodenext`, `erasableSyntaxOnly`, `verbatimModuleSyntax` y `rewriteRelativeImportExtensions`. No se permiten `enum`, `namespace` con contenido en runtime, propiedades de parámetro, decoradores ni alias de `paths` en código ejecutable. `check:dev-start`, dentro de `verify` y CI, arranca el backend con el mismo comando de desarrollo. Si las restricciones perjudican el código, se introduce `tsx` con un ADR nuevo.
- Prisma 7 con su generador actual, `prisma-client`, con salida explícita en `backend/src/generated/prisma/` (`runtime` `nodejs`, `moduleFormat` `esm`, `importFileExtension` `ts`) y `@prisma/adapter-pg`. La prueba de compatibilidad confirmó Better Auth 1.7.7 y los mecanismos de S-1 con ese cliente, también bajo el type stripping nativo y compilado con `tsc`.
- Paquetes del workspace con una condición `development` en `exports` (fuente TypeScript) y salida compilada por defecto.
- Calidad: Prettier, ESLint con `typescript-eslint` y reglas de capas por `no-restricted-imports`, y Vitest; `corepack pnpm verify` las encadena.
- Logs con pino, sin cabeceras, IP ni cuerpos en los logs de petición y con redacción como segunda defensa; métricas con `@prometheus-io/client`, el sucesor oficial de `prom-client` (deprecado); cabeceras con helmet.
- ESLint 10 en todo el repositorio. El frontend usa `@next/eslint-plugin-next` y `eslint-plugin-react-hooks` directamente, porque `eslint-config-next` depende de `eslint-plugin-react` y `eslint-plugin-jsx-a11y`, que solo admiten ESLint 9 o anterior; la accesibilidad se cubre con pruebas por roles y nombres accesibles y con el checklist de frontend hasta que esos plugins soporten ESLint 10.
- `pg` no es dependencia directa: llega con `@prisma/adapter-pg`.
- Endpoints operacionales (`/health/live`, `/health/ready`, `/metrics`) fuera de `/api`: no son API de aplicación en el sentido de ADR 0015 ni forman parte de la API pública del producto. La aplicación no restringe su exposición; restringirla es una responsabilidad obligatoria del despliegue futuro (`deployment.md`).
- Frontend y API en el mismo origen: `rewrites` de Next.js en desarrollo y enrutamiento por ruta en producción; sin CORS hasta que exista un dominio de API separado.
- OpenAPI 3.1 generado desde un registro de rutas en `packages/contracts`, con la conversión nativa de Zod 4 a JSON Schema, en `docs/generated/openapi.json`, comprobado en CI.

Alternativas descartadas: Turborepo o Nx; `tsx` en desarrollo; Biome en lugar de ESLint y
Prettier; `@asteasolutions/zod-to-openapi`; TypeScript 7; el generador `prisma-client-js`. Los motivos están en el diseño de
`bootstrap-application`.

## Consequences

- Un clon nuevo se verifica con tres comandos, y cada cambio encuentra la estructura y las reglas de capas ya aplicadas.
- Menos dependencias de desarrollo, a cambio de depender del soporte nativo de TypeScript de Node 24.
- TypeScript 7 queda bloqueado hasta que `typescript-eslint` lo soporte.
- Un dominio de API separado exigirá CORS y la configuración de orígenes de Better Auth en su propio cambio.
