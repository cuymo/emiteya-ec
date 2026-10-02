# Generated References

Use this directory for generated or mechanically derived documentation.

Examples:

- API reference.
- Database schema reference.
- OpenAPI exports.
- Route maps.

Rules:

- Do not manually edit generated files unless explicitly documented.
- Regenerate them when source behavior changes.
- Keep generated docs small enough to be useful for agents.

## OpenAPI

`openapi.json` es la especificación OpenAPI 3.1 de las rutas bajo `/api/v1` (ERS API-005).
Se genera desde el registro de rutas de `packages/contracts/src/api/routes.ts`, con la
conversión nativa de Zod 4 a JSON Schema.

- Para registrar una ruta, añádela con `defineRoute` al registro y regenera el documento con `corepack pnpm openapi:generate`.
- `corepack pnpm openapi:check` (incluido en `verify` y en CI) falla si el documento versionado no coincide con el registro.
- No edites `openapi.json` a mano. Los endpoints operacionales (`/health/*`, `/metrics`) y los de Better Auth (`/api/auth/*`) no forman parte de este documento.
