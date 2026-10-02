# Tasks

## 1. Repositorio y workspace

- [ ] 1.1 Inicializar Git con `git init -b main`, `.gitignore` (dependencias, `dist/`, `.next/`, `backend/src/generated/`, `.env*` salvo `.env.example`, cobertura y logs) y `.gitattributes` (`* text=auto eol=lf`); verificar con `git status --ignored` que `node_modules/`, `.env` y la salida de build quedan ignorados
- [ ] 1.2 Reemplazar el `package.json` de `npm init` por uno raíz privado y ESM, con `packageManager` `pnpm@12.4.2`, `engines` de Node 24 y sin campo `license` hasta resolver Q-33, y añadir `.node-version`; verificar que `corepack pnpm --version` informa 12.4.2 dentro del repositorio
- [ ] 1.3 Crear `pnpm-workspace.yaml` con los paquetes `backend`, `frontend` y `packages/*`, guardado de versiones exactas, overrides de `prisma`, `@prisma/client`, `@prisma/adapter-pg` y `@prisma/engines` en `7.10.0`, y aprobación explícita de los scripts de instalación de Prisma; verificar que `corepack pnpm install` crea `pnpm-lock.yaml` sin advertencias de configuración ignorada
- [ ] 1.4 Escribir en `README.md` los requisitos (Node 24, Corepack, Docker) y la instalación desde cero, con la prohibición de `npx` y `pnpm dlx` sin versión para Prisma; verificar siguiendo el README en un clon limpio hasta `corepack pnpm install`

## 2. Base de calidad compartida

- [ ] 2.1 Añadir `tsconfig.base.json` con TypeScript 6.0.3 exacto y las opciones de D3 (`target` `esnext`, `module` y `moduleResolution` `nodenext`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`, `strict`, `noUncheckedIndexedAccess`, sin `paths`), y Prettier 3 con los scripts `format` y `format:check`; verificar que `corepack pnpm format:check` pasa y que un archivo de prueba con un `enum` o una propiedad de parámetro hace fallar el typecheck
- [ ] 2.2 Configurar ESLint 10 plano con `typescript-eslint` y las reglas de capas de D4 por `no-restricted-imports`; verificar con una prueba que ejecuta ESLint sobre fixtures que un archivo de `domain/` que importa `express` o `infrastructure/`, y un archivo de `application/` que importa `infrastructure/`, producen error, y que los mismos imports en `infrastructure/` no lo producen
- [ ] 2.3 Configurar Vitest 5 con proyectos por paquete en `vitest.config.ts` y los scripts `lint`, `typecheck`, `test` y `build` recursivos; verificar que cada script corre en todos los paquetes
- [ ] 2.4 Añadir el script `check:versions`, que falla si el lockfile resuelve algún paquete de Prisma fuera de la major 7 o alguna dependencia directa con rango en lugar de versión exacta, y el script `verify` con la cadena de D4 (los pasos que dependen de grupos posteriores se añaden en su grupo); verificar que `check:versions` falla con un lockfile de prueba que resuelve Prisma 8 y que `corepack pnpm verify` pasa

## 3. Contratos compartidos

- [ ] 3.1 Crear `packages/contracts` (`@facturador/contracts`, ESM, Zod 4 exacto, `exports` con condición `development` hacia `src/*.ts` y por defecto hacia `dist/*.js`) con los esquemas de los sobres `{ data, meta? }` y `{ error: { code, message, requestId } }`; verificar con pruebas unitarias que aceptan sobres válidos y rechazan los inválidos
- [ ] 3.2 Añadir el registro de rutas y el generador `openapi:generate` de D12, que escribe `docs/generated/openapi.json` con la conversión nativa de Zod 4; verificar con una prueba que una ruta registrada solo en la prueba aparece en el documento con sus esquemas, y que con el registro real vacío el documento tiene `paths` vacío
- [ ] 3.3 Añadir `openapi:check`, que regenera el documento y falla si difiere del versionado, e incluirlo en `verify`; documentar el flujo en `docs/generated/README.md`; verificar que modificar el registro sin regenerar hace fallar `openapi:check`

## 4. Backend base

- [ ] 4.1 Crear `backend/` (`@facturador/backend`) con la estructura de D10, `backend/src/modules/README.md` con la convención de capas, y los scripts `dev` (`node --watch --env-file-if-exists=.env --conditions=development src/main.ts`), `build` (`tsc` con `rewriteRelativeImportExtensions`) y `start` (`node dist/main.js`); verificar que `dev` arranca sin `tsx` y que `corepack pnpm --filter @facturador/backend build` produce `dist/` ejecutable con `node`
- [ ] 4.2 Implementar el esquema de entorno de D7 con Zod y `.env.example`; verificar con pruebas que falta `DATABASE_URL` o un `PORT` inválido hacen terminar el arranque con el nombre de la variable y sin su valor
- [ ] 4.3 Implementar logs con pino y pino-http (redacción de D9) y el identificador de correlación de D5; verificar con pruebas que la respuesta devuelve `x-request-id`, que un identificador entrante válido se conserva, y que `authorization`, `cookie` y un campo `password` no aparecen en los logs capturados
- [ ] 4.4 Implementar `createApp` con helmet, el punto de montaje previo al parser JSON, el parser con límite de 100 KB, el router `/api/v1` vacío, el manejador 404 y el manejador de errores con `AppError`; verificar con pruebas que una ruta inexistente responde `404` con el sobre de error, que un error desconocido responde `500` sin stack ni detalle interno y con su `requestId` en el log, que un cuerpo mayor al límite responde `413` con el sobre, y que están las cabeceras de helmet
- [ ] 4.5 Implementar `/metrics` con prom-client (métricas de proceso e histograma por patrón de ruta) y el apagado ordenado de `main.ts`; verificar con pruebas que `/metrics` expone el histograma con el patrón de ruta y no la URL concreta, y que ante `SIGTERM` el servidor deja de aceptar conexiones y cierra la base de datos
- [ ] 4.6 Documentar en `docs/architecture/backend.md` la estructura de D10, el orden de middleware de D5 y el contrato de errores; verificar que el documento coincide con `createApp`

## 5. Base de datos y Prisma 7

- [ ] 5.1 Crear `compose.yaml` (PostgreSQL 17, volumen nombrado, puerto en `127.0.0.1` configurable y script que crea `facturador_dev` y `facturador_test`); verificar que `docker compose up -d` deja ambas bases accesibles
- [ ] 5.2 Añadir Prisma 7.10.0 exacto (`prisma`, `@prisma/client`, `@prisma/adapter-pg`) y `pg`, `backend/prisma.config.ts`, `schema.prisma` sin modelos con el generador `prisma-client` de D8 (salida `../src/generated/prisma`, `runtime` `nodejs`, `moduleFormat` `esm`, `importFileExtension` `ts`), `db:generate` en `postinstall`, y añadir `@prisma/client-runtime-utils` solo si la instalación demuestra que hace falta, y los scripts `db:generate`, `db:migrate:dev`, `db:migrate:deploy` y `db:status` con `pnpm exec prisma`; verificar que `prisma validate`, `db:generate` y `db:status` pasan y que `pnpm why prisma` solo muestra 7.10.0
- [ ] 5.3 Implementar el `PrismaClient` único con `@prisma/adapter-pg` en `platform/db`, inyectado en `createApp`, y los endpoints `/health/live` y `/health/ready` de D6; verificar con pruebas de integración contra `facturador_test` que `live` responde `200`, que `ready` responde `200` con la base disponible, y que responde `503` dentro del tiempo límite cuando la base no responde
- [ ] 5.4 Añadir el script `check:dev-start` de D3, que arranca el backend con el comando de desarrollo sin `--watch`, espera `200` en `/health/live` y `/health/ready` y lo detiene, e incluirlo en `verify`; verificar que pasa y que falla si se introduce en `src/` una construcción no borrable
- [ ] 5.5 Hacer que las pruebas de integración fallen con un mensaje que indica `docker compose up -d` cuando PostgreSQL no está disponible; verificar deteniendo el contenedor
- [ ] 5.6 Documentar en `README.md` el arranque de PostgreSQL, las migraciones y la regla de no ejecutar comandos destructivos de Prisma sin consentimiento humano, y en `docs/architecture/deployment.md` los endpoints internos de D6 y que el proxy público no los expone; verificar siguiendo el README en un clon limpio

## 6. Frontend base

- [ ] 6.1 Crear `frontend/` (`@facturador/frontend`) con Next.js 16, React 19, TypeScript 6.0.3, `eslint-config-next`, Tailwind CSS 4, shadcn/ui inicializado y lucide-react, todos con versión exacta; verificar que `build` y `lint` del frontend pasan
- [ ] 6.2 Implementar los tokens semánticos de `design-foundations.md` con next-themes (claro, oscuro y preferencia del sistema) y el shell de D11 (cabecera con nombre y selector de tema, barra lateral vacía y página técnica de marcador); verificar con pruebas de componente que el shell se renderiza en ambos temas y que el selector cambia el tema, y comprobar en el navegador el foco visible por teclado, la barra lateral colapsada en móvil y los ítems aplicables de `docs/quality/frontend-checklist.md`
- [ ] 6.3 Implementar `apiFetch` sobre los sobres de `@facturador/contracts` y los `rewrites` de `/api/*` hacia `API_INTERNAL_URL`, con `frontend/.env.example`; verificar con pruebas unitarias que un sobre `{ data }` se devuelve tipado, que un sobre `{ error }` lanza un error tipado con `code` y `requestId`, y que una respuesta no JSON lanza un error genérico
- [ ] 6.4 Añadir al script `dev` raíz el arranque paralelo de backend y frontend, y documentar en `README.md` el desarrollo local y las URLs; verificar que con `corepack pnpm dev` la página carga en el navegador y una petición a `/api/v1/no-existe` llega al backend y devuelve el sobre `404`

## 7. CI y verificación integral

- [ ] 7.1 Crear `.github/workflows/verify.yml` de D13 sin modificar los archivos de OpenSpec generados en `.github/`; verificar ejecutando en local, contra PostgreSQL de Compose, los mismos pasos del workflow: `pnpm install --frozen-lockfile`, `db:generate`, `db:migrate:deploy` y `verify`, incluido `check:dev-start`
- [ ] 7.2 Actualizar `docs/architecture/stack.md` con la tabla de versiones de D2, `docs/quality/testing.md` con cómo correr pruebas unitarias e integración, confirmar los comandos de verificación de `AGENTS.md` y marcar el ADR 0016 como Accepted tras la revisión; verificar que cada comando documentado funciona tal como está escrito
- [ ] 7.3 Proponer al usuario la división de commits de D14 sin commitear; verificar que la propuesta separa la importación de la documentación existente de cada grupo de tareas
- [ ] 7.4 Desde un clon limpio, ejecutar `corepack pnpm install`, `docker compose up -d`, `corepack pnpm --filter @facturador/backend db:migrate:deploy` y `corepack pnpm verify`; verificar que todo pasa sin pasos manuales no documentados
