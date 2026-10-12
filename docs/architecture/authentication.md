# Authentication Architecture

## Default

Use Better Auth.

Better Auth owns:

- User registration when enabled.
- Sign-in and sign-out.
- Password hashing.
- Session persistence.
- Session cookies.
- Auth database tables.
- Auth route handlers.

## Application Rules

- Public registration is disabled unless the product's specs require it.
- Protected REST routes must use an auth middleware.
- The middleware resolves user, tenant, and role from the session. Handlers never read them from the request. See `../security/access-control.md`.
- The frontend should call backend auth endpoints rather than handling credentials manually.
- Session cookies should be HTTP-only.
- Password changes and profile changes should go through authenticated routes.
- Logout should invalidate the server session and clear client-side cached user state.

## Reglas del proyecto

- Usuarios locales con usuario y contraseña (ERS RF-001); sin registro público. El administrador crea las cuentas.
- Dos roles, `ADMIN` y `OPERATOR` (ERS RF-002), guardados en la membresía de la empresa, nunca en la petición. La matriz de permisos está en `../security/access-control.md` (Q-22).
- La membresía vincula usuario, empresa y rol desde el primer día, aunque exista una sola empresa (ADR 0009). Validado por el spike S-1 (Q-41), se implementa con el plugin Organization de Better Auth: la empresa es una fila de `organization` y la membresía una fila de `member`, con roles `ADMIN` y `OPERATOR` y el campo adicional `status`. El plugin admin se usa solo para `auth.api.createUser` desde el servidor, y nadie recibe su rol global `admin`.
- La superficie HTTP de Better Auth se deniega por defecto. Solo tres operaciones llegan a Better Auth desde el cliente (`CLIENT_ENDPOINTS` del módulo de integración); cualquier otra ruta o método responde `404`, también los endpoints que traiga una versión futura:

  | Endpoint | Uso |
  | --- | --- |
  | `POST /api/auth/sign-in/email` | Iniciar sesión. |
  | `POST /api/auth/sign-out` | Cerrar sesión. |
  | `POST /api/auth/change-password` | Cambiar la contraseña propia; el servidor fuerza `revokeOtherSessions` y valida la política de contraseñas. |

- La cuenta y la sesión actuales se leen con `GET /api/v1/me`, que el servidor resuelve con `auth.api.getSession`; `/get-session` no está expuesto. Tampoco `/update-user` (editar el perfil está fuera de alcance), `/verify-password` (operación de servidor), `/list-sessions` (no hay gestión de sesiones), el registro, la recuperación por correo ni ningún endpoint de los plugins Organization y admin. La administración de usuarios pasa solo por la API propia, que aplica la política, el aislamiento y la auditoría.
- La allowlist se aplica dos veces: en Express, por método y ruta exactos antes de llegar a Better Auth, y en un hook de Better Auth sobre el endpoint resuelto. Las llamadas de servidor (`auth.api.*`, `auth.$context`) no son peticiones HTTP y no se ven afectadas. Ampliarla exige una spec que necesite la operación.
- Las operaciones que combinan Better Auth y escrituras propias corren en una transacción de Prisma con `runWithAdapter` de `@better-auth/core/context`. Detalle en el diseño de `add-user-access`.
- **Adaptador acotado.** Better Auth no recibe la petición de Node con `toNodeHandler`, sino con un adaptador propio de `http.ts` (`enforce-api-origin-and-body-limits`). `toNodeHandler` lee el cuerpo sin límite y arma la URL con `Host` y `X-Forwarded-Proto`. El adaptador decide en este orden:
  1. **Tipo de contenido.** Un cuerpo declarado, con `Content-Length` mayor que 0 o con cualquier `Transfer-Encoding`, tiene que ser `application/json`, con o sin parámetros. Si no, la respuesta es `415 UNSUPPORTED_MEDIA_TYPE`, sin leerlo. Una petición sin cuerpo no exige `Content-Type`. Los tres endpoints envían JSON; el cierre de sesión, `{}`.
  2. **Tamaño.** El cuerpo admite como máximo 8192 bytes. Un `Content-Length` mayor recibe `413 PAYLOAD_TOO_LARGE` al leer la cabecera. En modo `chunked`, `express.raw` cuenta los bytes que entrega Node, deja de acumular al pasar del límite y descarta el resto antes del 413. Un cuerpo comprimido cuenta sus bytes ya descomprimidos. El cuerpo legítimo más grande, un cambio de contraseña con el máximo configurable de la política, ronda los 6,2 KiB.
  3. **Petición web.** La URL es el origen canónico de `BETTER_AUTH_URL` con la ruta y la consulta reales, nunca `Host` ni `X-Forwarded-*`. Se descartan las cabeceras de un salto (`connection`, `keep-alive`, `te`, `trailer`, `upgrade`, `proxy-authorization`, `proxy-authenticate` y las que nombre `Connection`) y las del encuadre del cuerpo ya leído (`transfer-encoding`, `content-length` y `content-encoding`). Las demás, incluidas la cookie, `Origin`, `Referer`, `Sec-Fetch-*` y la IP que escribe el servidor, llegan como antes.
  4. **Respuesta.** El estado, el cuerpo y las cabeceras de Better Auth, con cada `Set-Cookie` por separado. Una petición cortada o un error de lectura no llega a Better Auth.

  Better Auth conserva su propia comprobación de `Origin`, `Referer` y Fetch Metadata y su CSRF; el adaptador no los duplica ni los cambia. Las pruebas de paridad (`backend/test/identity/better-auth-adapter.test.ts`) fijan lo que el reemplazo conserva.
- **Frontera del encuadre HTTP.** La aplicación controla el cuerpo tal como Node lo analiza y lo entrega. Un mensaje con un encuadre malformado o ambiguo, como un `Content-Length` que contradice `chunked`, es responsabilidad del servidor HTTP de Node y del proxy, y Node lo rechaza antes del código de la aplicación. El adaptador no reinterpreta el flujo crudo.

## Integración y actualización de Better Auth

- Todo el código que toca Better Auth vive en un único módulo de integración (`backend/src/modules/identity/infrastructure/better-auth/`). Solo ese módulo puede usar APIs que no pertenecen claramente a la API pública estable de Better Auth, como `runWithAdapter`, `auth.$context` o escrituras con su adapter. El resto de la aplicación usa un puerto de identidad. Una regla de lint impide importar `better-auth` o `@better-auth/*` fuera del módulo.
- `better-auth`, `@better-auth/core` y el CLI `auth` se fijan en la versión exacta validada por el spike S-1 (`1.7.7`), sin rangos.
- El módulo tiene tests de contrato contra PostgreSQL que replican los criterios de S-1: `backend/test/integration/better-auth-contract.test.ts` (registro, inicio y cierre de sesión, mensaje genérico, allowlist exacta y `404` para todo otro endpoint que exponga la versión instalada, IP no persistida, límites de intentos, sin recuperación pública), `identity-transaction.test.ts` (atomicidad con la auditoría) y `migrations.test.ts` (el esquema regenerado con el CLI conserva las restricciones propias). Se ejecutan con:

  ```bash
  corepack pnpm exec vitest run --project backend test/integration/better-auth-contract.test.ts test/integration/identity-transaction.test.ts test/integration/migrations.test.ts
  ```

- Una actualización de Better Auth, incluido un parche, se acepta solo si: (1) se revisaron sus notas de versión; (2) los tests de contrato pasan con la nueva versión exacta; (3) el CLI `auth` se actualiza a la misma versión y el esquema regenerado conserva las restricciones propias. Un test de contrato que falla bloquea la actualización; no se modifica el test para que pase sin revisar el diseño.
- Los usuarios se desactivan, no se eliminan: una cuenta desactivada no inicia sesión y sus sesiones se invalidan, pero sus comprobantes y su auditoría persisten (ERS RF-409).
- El establecimiento y el punto de emisión predeterminados son preferencias del usuario en la aplicación, no datos de autenticación (ERS RF-113).
- Los procesos del sistema, como los jobs, actúan con un actor de sistema explícito en la auditoría, nunca con la identidad de un usuario.
- El MVP no tiene recuperación pública de contraseña por correo. Un usuario que olvida su contraseña la recupera mediante un administrador, que le establece una nueva.
- Si ningún administrador puede entrar, el administrador técnico usa un comando de recuperación administrativa (break-glass) en el servidor. Es una operación de emergencia: no existe ni puede existir en la API pública ni en ninguna ruta HTTP, y deja un evento de auditoría con el administrador técnico como actor.
- El comando es `admin:recover --email <correo>`; uso, variables y aprovisionamiento inicial en `deployment.md` ("Autenticación y aprovisionamiento" y "Recuperación administrativa de emergencia").
- El correo de inicio de sesión no distingue mayúsculas: Better Auth lo guarda en minúsculas. Es una regla técnica de identidad.
- Better Auth lee la IP del cliente de una cabecera propia del servidor (`x-app-client-ip`) que Express escribe con `req.ip`, sobrescribiendo cualquier valor del cliente; la IP solo vive en memoria para el límite de intentos y la sesión se guarda sin ella.

## Initial Admin User

For internal tools, a first user can be seeded from environment variables:

```text
INITIAL_USER_EMAIL=admin@example.com
INITIAL_USER_PASSWORD=replace-with-secure-password
```

Rules:

- Never commit real credentials.
- Validate password length at startup.
- Do not expose initial credentials in frontend code.

## Frontend UX

- Show only login when public registration is disabled.
- Communicate invalid credentials clearly.
- Do not leave users on a blank screen during auth checks.
- Redirect authenticated users to the application shell.

## Security

- Keep `BETTER_AUTH_SECRET` server-side.
- Set production cookie and origin configuration explicitly.
- CORS must match the deployed frontend origin.
- Do not log passwords, tokens, cookies, or full auth headers.

