# Design

## Context

Motivación y alcance en `proposal.md`. Estado observado: la raíz solo contiene documentación
(`docs/`, `openspec/`, `AGENTS.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `.agents/`, `.claude/`,
`.codex/`, `.github/`) y un `package.json` de `npm init` con licencia ISC por defecto y
`"type": "commonjs"`. No es un repositorio Git.

Restricciones que gobiernan el diseño:

- `docs/architecture/stack.md` (incluidas sus versiones fijadas), `ARCHITECTURE.md`, `backend.md`, `frontend.md`, `deployment.md`, `bootstrap.md` y su nota de proyecto.
- ADR 0015: las rutas de aplicación viven bajo `/api/v1/`.
- `docs/quality/version-control.md`: `.gitignore`, lockfile versionado y commits por unidad, solo cuando el usuario lo pide.
- Comandos de verificación de `AGENTS.md`: `format`, `lint`, `test`, `typecheck`, `build` y `verify`, siempre con `corepack pnpm`.
- Lo validado que el bootstrap debe respetar sin implementarlo: Express 5.2.1, Prisma 7.10.0 con `@prisma/adapter-pg` y PostgreSQL 17 (spike S-1), y Better Auth 1.7.7 sobre el generador `prisma-client` de Prisma 7 (prueba de compatibilidad, más abajo).

## Prueba de compatibilidad: Better Auth 1.7.7 y Prisma 7 con `prisma-client`

S-1 se ejecutó con `prisma-client-js`. Antes de fijar el generador actual de Prisma 7 se hizo
una prueba mínima, el 2026-10-02, en un workspace temporal con PostgreSQL 17, Prisma 7.10.0,
`@prisma/adapter-pg` 7.10.0, Better Auth 1.7.7 (plugins admin y Organization) y
`@better-auth/core` 1.7.7. El esquema usó `provider = "prisma-client"` con salida explícita,
`runtime = "nodejs"`, `moduleFormat = "esm"` e `importFileExtension = "ts"`.

| Comprobación | Resultado |
| --- | --- |
| Generación del cliente en la ruta explícita | Cumple: TypeScript ESM con imports relativos `.ts`, sin `enum`, `namespace` ni propiedades de parámetro. |
| Conexión con `@prisma/adapter-pg` | Cumple: `SELECT 1`. |
| Inicialización del adapter Prisma de Better Auth con ese cliente | Cumple. |
| Escritura y lectura mínimas | Cumple: `auth.api.createUser` y `auth.api.signInEmail`. |
| Mecanismos de S-1 | Cumple: `runWithAdapter` con un adapter ligado a la transacción revierte un alta; escrituras sobre `member` con el adapter; `auth.$context` (`password.hash`, `updatePassword`, `deleteUserSessions`). |
| Type stripping nativo de Node 24 | Cumple: la prueba corrió con `node --test compat.test.ts`, sin `tsx`. |
| `tsc` 6.0.3 con las opciones de D3 | Cumple: sin errores; la salida reescribe los imports a `.js` y la misma prueba compilada pasa. |

No apareció ninguna incompatibilidad que obligue a mantener `prisma-client-js`.

## Goals / Non-Goals

**Goals:**

- Que un clon nuevo quede listo con `corepack pnpm install`, `docker compose up -d` y `corepack pnpm verify`.
- Que cada vertical slice posterior encuentre dónde poner cada capa y qué reglas de dependencia rigen, sin inventar estructura.
- Que ninguna instalación ni comando sin versión introduzca Prisma 8 ni rangos de versión.

**Non-Goals:**

- Cualquier comportamiento de `add-user-access` o de módulos de negocio.
- Componentes de interfaz compartidos, imágenes de despliegue o runner de jobs.

## Decisions

### D1. Workspace y estructura del repositorio

```text
/
├── backend/              @facturador/backend: API Express
├── frontend/             @facturador/frontend: Next.js
├── packages/contracts/   @facturador/contracts: esquemas Zod y tipos compartidos
├── compose.yaml          PostgreSQL de desarrollo y pruebas
├── pnpm-workspace.yaml   paquetes, overrides y aprobación de scripts de instalación
├── package.json          scripts de verificación, packageManager y engines
├── tsconfig.base.json, eslint.config.js, configuración de Prettier, vitest.config.ts
├── .node-version, .gitignore, .gitattributes, .env.example
├── .github/workflows/verify.yml
└── README.md
```

- `ARCHITECTURE.md` ya fija `backend/` y `frontend/`. `packages/contracts/` sigue `frontend.md` ("shared Zod schemas where client/server contracts permit reuse"): los esquemas de la API se definen una vez y los usan el backend, el frontend y la generación de OpenAPI.
- El `package.json` raíz es privado, ESM y declara `packageManager` y `engines`. El campo `license` desaparece hasta resolver Q-33: ISC fue un valor por defecto de `npm init`, no una decisión.
- Alternativas: un solo paquete con ambas aplicaciones (rechazado: Next.js y Express tienen ciclos de build distintos); Turborepo o Nx (rechazado: los scripts recursivos de pnpm alcanzan para tres paquetes, y cada herramienta es una dependencia más).

### D2. Toolchain y versiones fijadas

| Herramienta | Versión | Motivo |
| --- | --- | --- |
| Node.js | 24 LTS (probado con 24.15.0) | `engines` y `.node-version`. Necesario para correr TypeScript de forma nativa en desarrollo (D3). |
| pnpm | 12.4.2 vía Corepack | `packageManager`. Su configuración vive en `pnpm-workspace.yaml`, porque pnpm 12 ya no lee el campo `pnpm` de `package.json`. |
| TypeScript | 6.0.3 | `typescript-eslint` 8.71 solo admite TypeScript menor que 6.1; la major 7, el compilador nativo, queda fuera hasta que el ecosistema la soporte. |
| Prisma | 7.10.0 exacto | Better Auth 1.7.7 no admite Prisma 8 (`stack.md`). |

- Todas las dependencias se añaden con versión exacta (`--save-exact`) y el lockfile se versiona.
- `pnpm-workspace.yaml` declara overrides que fijan `prisma`, `@prisma/client`, `@prisma/adapter-pg` y `@prisma/engines` en `7.10.0`, de modo que ninguna dependencia transitiva traiga otra versión. También aprueba de forma explícita los scripts de instalación de los motores de Prisma.
- Un script `check:versions` falla si el lockfile resuelve cualquier paquete de Prisma fuera de la major 7. Forma parte de `verify`.
- Los binarios se ejecutan con `corepack pnpm exec` o con los scripts de `package.json`; la documentación prohíbe `npx` y `pnpm dlx` sin versión.

### D3. Módulos ESM y TypeScript nativo de Node 24

- Todos los paquetes son ESM (`"type": "module"`).
- Desarrollo: el backend corre con el type stripping nativo de Node 24, sin `tsx` ni `ts-node`: `node --watch --env-file-if-exists=.env --conditions=development src/main.ts`.
- Producción: `tsc` compila a `dist/` y se ejecuta JavaScript.
- `tsconfig` del backend y de los contratos, compatible con el type stripping:

| Opción | Valor | Motivo |
| --- | --- | --- |
| `target` | `esnext` | Node 24 ejecuta la sintaxis moderna sin bajarla. |
| `module` / `moduleResolution` | `nodenext` | La misma resolución ESM que usa Node en runtime. |
| `erasableSyntaxOnly` | `true` | El typecheck rechaza la sintaxis que el type stripping no puede borrar. |
| `verbatimModuleSyntax` | `true` | Los imports de tipos son `import type` y desaparecen sin análisis. |
| `rewriteRelativeImportExtensions` | `true` | El código importa con `.ts` relativo, como exige Node, y `tsc` lo reescribe a `.js` al compilar. |
| `strict`, `noUncheckedIndexedAccess` | `true` | Rigor del proyecto. |

- Restricciones de este modo, que el typecheck y el lint hacen cumplir:
  - sin `enum`, `namespace` con contenido en runtime, propiedades de parámetro (`constructor(private x)`), `import =`, `export =` ni decoradores;
  - sin alias de `paths` de `tsconfig` en código que se ejecuta: Node no los resuelve. Se usan imports relativos con extensión `.ts` y los nombres de paquete del workspace;
  - imports de tipos siempre con `import type`.
- Paquetes del workspace: `@facturador/contracts` expone en `exports` una condición `development` que apunta a `src/*.ts` y una por defecto que apunta a `dist/*.js`. El backend en desarrollo y las pruebas usan la condición `development`; el build y producción usan `dist/`. El frontend la consume mediante `transpilePackages` de Next.js.
- Garantía en `verify` y CI: un script `check:dev-start` arranca el backend con el mismo comando de desarrollo, sin `--watch`, espera `200` en `/health/live` y en `/health/ready`, y lo detiene. Falla si el modo nativo deja de poder arrancar el backend.
- Si mantener estas restricciones empieza a perjudicar el código o las herramientas, se introduce `tsx` de forma explícita, con un ADR, antes que crear soluciones alternativas.

### D4. Calidad: formato, lint, typecheck y pruebas

- Prettier 3 para el formato (`format`, `format:check`).
- ESLint 10 con configuración plana, `typescript-eslint` (reglas con información de tipos en backend y contratos) y `eslint-config-next` en el frontend.
- Reglas de capas con `no-restricted-imports` por patrón de carpeta, sin plugins adicionales:
  - `modules/*/domain/**` no importa `express`, `@prisma/*`, código generado ni `infrastructure/`.
  - `modules/*/application/**` no importa `infrastructure/` ni `express`.
  - El frontend no importa nada de `backend/`.
  Las restricciones propias de un cambio, como confinar Better Auth a su módulo, las añade ese cambio.
- Vitest 5 en todos los paquetes, con proyectos en un `vitest.config.ts` raíz. Las pruebas de integración del backend usan PostgreSQL real (base `facturador_test`).
- `corepack pnpm verify` encadena `format:check`, `check:versions`, `db:generate`, `lint`, `typecheck`, `test`, `openapi:check`, `check:dev-start` y `build`, y falla en el primer error. Las pruebas de integración exigen PostgreSQL; si no está disponible, fallan con un mensaje que indica `docker compose up -d`, en lugar de saltarse.
- Alternativa: Biome en lugar de ESLint y Prettier (menos dependencias). Se descarta por ahora porque las reglas con información de tipos de `typescript-eslint` y la configuración de Next.js dependen de ESLint.

### D5. Backend: aplicación HTTP base

- `createApp(deps)` arma la aplicación y `main.ts` la arranca: valida el entorno, abre la conexión, escucha y, ante `SIGTERM` o `SIGINT`, deja de aceptar tráfico, espera las peticiones en curso con un tiempo límite y cierra la base de datos.
- Orden de middleware:
  1. Identificador de correlación: acepta un `x-request-id` entrante si tiene formato válido, o genera uno, y lo devuelve en la respuesta.
  2. Logs de petición (pino-http).
  3. Cabeceras de seguridad (helmet), que `hardening.md` exige.
  4. Endpoints internos `/health/*` y `/metrics`.
  5. Punto de montaje reservado para routers que necesitan el cuerpo sin procesar, antes del parser JSON. `add-user-access` lo usará para Better Auth; el bootstrap no monta nada ahí.
  6. Parser JSON con límite de tamaño (100 KB).
  7. Router `/api/v1` vacío (ADR 0015).
  8. Manejador 404 y manejador de errores.
- Errores: una clase `AppError` con código estable, estado HTTP y mensaje para el usuario, y subclases genéricas (`NotFoundError`, `ValidationError` desde Zod, `ConflictError`). El manejador responde `{ error: { code, message, requestId } }`; un error desconocido responde `500` con un mensaje genérico y deja el detalle solo en el log.
- `trust proxy` de Express se configura con `TRUST_PROXY` (sin proxies por defecto), para que `req.ip` sea correcto detrás de un proxy declarado.
- Sin CORS: en desarrollo, Next.js reenvía `/api` al backend (D11); en producción, el proxy enruta por ruta en el mismo dominio (`deployment.md`). Un dominio de API separado añadirá CORS en su propio cambio.

### D6. Endpoints internos de salud y métricas

| Ruta | Respuesta | Uso |
| --- | --- | --- |
| `GET /health/live` | `200` mientras el proceso atiende | Liveness del contenedor. |
| `GET /health/ready` | `200` si PostgreSQL responde a `SELECT 1` dentro de 2 s; si no, `503` | Readiness; los cambios fiscales añadirán reloj y disponibilidad del SRI. |
| `GET /metrics` | Formato Prometheus | Métricas de proceso y duración de peticiones. |

- Viven fuera de `/api`: no son API de aplicación (ADR 0015) y el proxy público solo enruta `/api` y `/`, de modo que quedan internos. `deployment.md` lo documenta.
- Las métricas HTTP usan el patrón de ruta, no la URL concreta, para no disparar la cardinalidad.
- Fuente: ERS RNF-012 y `stack.md` ("Health checks should exist for API containers").

### D7. Configuración por entorno

- Un esquema Zod en `backend/src/config/env.ts` valida al arrancar: `NODE_ENV`, `PORT`, `DATABASE_URL`, `LOG_LEVEL` y `TRUST_PROXY`. Si falta una variable o es inválida, el proceso termina indicando qué variable falló, sin imprimir su valor.
- `.env.example` en la raíz y en `frontend/` con valores de ejemplo; los `.env` reales están en `.gitignore`.
- Desarrollo: Node carga `.env` con `--env-file-if-exists`, sin `dotenv`.
- Las variables de un cambio futuro (Better Auth, zona horaria fiscal, SRI) las añade ese cambio al mismo esquema.

### D8. Base de datos y Prisma 7

- `compose.yaml`: servicio `postgres` con `postgres:17-alpine`, volumen nombrado, puerto ligado a `127.0.0.1` y configurable, y un script de inicialización que crea `facturador_dev` y `facturador_test`.
- `backend/prisma.config.ts` lee `DATABASE_URL`. `backend/prisma/schema.prisma` declara el datasource y el generador actual de Prisma 7, sin ningún modelo:

  ```prisma
  generator client {
    provider            = "prisma-client"
    output              = "../src/generated/prisma"
    runtime             = "nodejs"
    moduleFormat        = "esm"
    importFileExtension = "ts"
  }
  ```

  El cliente se importa desde `src/generated/prisma/client.ts`, que está ignorado por Git y se regenera con `db:generate`, incluido en `postinstall`, en `verify` y en CI.
- `backend/prisma/migrations/` empieza vacío. Scripts: `db:generate`, `db:migrate:dev`, `db:migrate:deploy` y `db:status`, todos con `pnpm exec prisma`.
- `@prisma/client-runtime-utils` no se añade: solo hizo falta con `prisma-client-js` en S-1. Se añadiría únicamente si la instalación real demuestra que el cliente generado no la resuelve.
- Un único `PrismaClient` con `@prisma/adapter-pg` en `platform/db`, inyectado en `createApp` y cerrado en el apagado.
- Comandos destructivos (`migrate reset`, `db push --accept-data-loss`): Prisma los bloquea cuando los ejecuta un agente sin consentimiento explícito del usuario. El README lo documenta, y ningún script del proyecto los usa.
- Este cambio no crea tablas ni migraciones: ninguna estructura de datos cambia.

### D9. Logs y métricas

- pino con salida JSON, nivel de `LOG_LEVEL` y redacción de `authorization`, `cookie`, `set-cookie` y de cualquier campo `password`, `token` o `secret`. Cada línea lleva el identificador de correlación. Nunca se registran cuerpos de petición.
- prom-client con métricas de proceso por defecto y un histograma de duración de peticiones HTTP.
- Fuente: ERS RNF-012 y `docs/quality/observability.md`.

### D10. Estructura de módulos del backend

```text
backend/src/
├── main.ts          arranque y apagado
├── app.ts           createApp
├── config/          entorno validado
├── platform/        http (correlación, errores, 404), logging, metrics, health, db
├── generated/       cliente de Prisma (no versionado)
└── modules/         vacío; README con la convención domain / application / infrastructure
```

`backend/src/modules/README.md` documenta la convención de `backend.md`; las reglas de capas de
D4 la hacen cumplir desde el primer módulo.

### D11. Frontend base

- Next.js 16 con App Router y React 19, Tailwind CSS 4, shadcn/ui inicializado (`components.json` y la utilidad `cn`), lucide-react y next-themes para los temas claro y oscuro con los tokens semánticos de `design-foundations.md`.
- Shell de layout: cabecera con el nombre del producto y el selector de tema, y una barra lateral vacía, lista para que los módulos registren sus destinos. Sin autenticación ni destinos.
- Cliente tipado de la API (`apiFetch`) que interpreta los sobres de `packages/contracts` y convierte `{ error }` en un error tipado.
- Desarrollo en el mismo origen: los `rewrites` de Next.js envían `/api/*` al backend (`API_INTERNAL_URL`).
- Página inicial técnica de marcador: nombre del producto y un texto que indica que la aplicación está en construcción. No es una pantalla de producto: `add-user-access` la reemplaza por el inicio de sesión. Brief: usuario, quien desarrolla; objetivo, comprobar que el frontend arranca y respeta los temas; sin decisión ni acción principal. P0: nombre del producto. Sin P1 a P3.
- Sin React Hook Form ni componentes compartidos de tablas o diálogos: llegan con el primer formulario o tabla real.

### D12. OpenAPI desde los contratos

- `packages/contracts` exporta un registro de rutas (método, ruta, esquemas Zod de entrada y salida).
- Un script `openapi:generate` arma un documento OpenAPI 3.1 a partir del registro, con la conversión a JSON Schema nativa de Zod 4, y lo escribe en `docs/generated/openapi.json`. CI falla si el archivo generado difiere del versionado.
- Con el registro vacío, el documento solo tiene la información general y `paths` vacío. `add-user-access` registrará sus rutas.
- Alternativa: `@asteasolutions/zod-to-openapi`. Se descarta porque Zod 4 ya convierte a JSON Schema, y el armado del documento es poco código propio.

### D13. CI

- `.github/workflows/verify.yml`: en cada push y pull request, Node 24 con Corepack, `pnpm install --frozen-lockfile`, servicio PostgreSQL 17, `db:generate`, `db:migrate:deploy` contra la base de pruebas y `corepack pnpm verify`, incluida la comprobación de OpenAPI.
- No toca los prompts, skills ni instrucciones de OpenSpec generados en `.github/`.
- Lo exigen las verificaciones "en CI" de `docs/architecture/non-functional-requirements.md`. El repositorio todavía no tiene remoto, así que el workflow se valida ejecutando sus pasos en local.

### D14. Git

- `git init -b main`, con `.gitignore` (dependencias, `dist/`, `.next/`, `backend/src/generated/`, `.env*` salvo `.env.example`, cobertura, logs) y `.gitattributes` con `* text=auto eol=lf`.
- Commits por unidad (`version-control.md`), solo cuando el usuario lo pide. Antes de commitear se propone la división: primero la importación de la documentación y la planificación existentes, y después un commit por grupo de tareas.

### D15. Dependencias de producción nuevas

| Paquete | Motivo |
| --- | --- |
| `express` 5.2.1 | Stack; versión validada por S-1. |
| `zod` 4.x | Validación del entorno y contratos; misma major que usa Better Auth. |
| `@prisma/client`, `@prisma/adapter-pg` 7.10.0; `pg` 8.x | Stack, S-1 y prueba de compatibilidad. |
| `pino`, `pino-http` | Logs estructurados con redacción (ERS RNF-012). |
| `prom-client` | Métricas (ERS RNF-012). |
| `helmet` | Cabeceras de seguridad (`hardening.md`). |
| `next`, `react`, `react-dom`, `tailwindcss`, shadcn/ui, `lucide-react` | Stack del frontend. |
| `next-themes` | Temas claro y oscuro sin parpadeo; `design-foundations.md` exige ambos temas. |

Cada una pasa la revisión de `hardening.md` (nombre exacto, mantenimiento, licencia y vulnerabilidades conocidas) al instalarla.

### Validación, migraciones, observabilidad y rendimiento

- Validación: el entorno en el arranque (D7) y los sobres de respuesta en los contratos.
- Migraciones: infraestructura sin migraciones (D8).
- Observabilidad: D6 y D9.
- Rendimiento: sin presupuestos nuevos; `/health/ready` tiene un tiempo límite para que una base lenta no bloquee al orquestador.
- Operaciones sensibles: ninguna. El bootstrap no lee ni escribe datos privados.

## Risks / Trade-offs

- [El type stripping nativo de Node 24 no cubre algún caso] → `erasableSyntaxOnly` lo detecta en el typecheck y `check:dev-start` en `verify`; si las restricciones perjudican el código, se introduce `tsx` con un ADR.
- [TypeScript 6.0 queda atrás frente a la major 7] → Restricción impuesta por `typescript-eslint`; se revisa cuando el ecosistema soporte la 7.
- [pnpm 12 cambia dónde se declaran overrides o la aprobación de scripts] → Ambos van en `pnpm-workspace.yaml`, y `check:versions` detecta una resolución fuera de Prisma 7.
- [La conversión nativa de Zod 4 a JSON Schema no cubre algún esquema] → El generador falla con el esquema concreto; se resuelve al registrar la primera ruta.
- [El workflow de CI no se ha ejecutado en GitHub] → Sus pasos se ejecutan en local antes de dar por terminado el grupo; la primera ejecución remota se revisa.
- [El shell del frontend se rehace con los primeros destinos] → Es deliberadamente mínimo: cabecera, barra lateral vacía y temas.

## Migration Plan

1. Inicializar Git y el workspace; reemplazar el `package.json` de `npm init`.
2. Instalar con `corepack pnpm install`, levantar PostgreSQL con `docker compose up -d` y ejecutar `corepack pnpm verify`.
3. Rollback: el cambio no tiene datos; revertirlo es borrar los paquetes nuevos y restaurar el `package.json` anterior.

## Open Questions

Ninguna que cambie el alcance o las tareas.
