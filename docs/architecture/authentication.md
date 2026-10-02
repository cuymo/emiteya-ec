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
- Ningún endpoint de cliente de los plugins Organization o admin está disponible: un hook de Better Auth rechaza por prefijo toda petición HTTP a `/organization/*` y `/admin/*`. La administración de usuarios pasa solo por la API propia, que aplica la política, el aislamiento y la auditoría.
- Las operaciones que combinan Better Auth y escrituras propias corren en una transacción de Prisma con `runWithAdapter` de `@better-auth/core/context`. Detalle en el diseño de `add-user-access`.

## Integración y actualización de Better Auth

- Todo el código que toca Better Auth vive en un único módulo de integración (`backend/src/modules/identity/infrastructure/better-auth/`). Solo ese módulo puede usar APIs que no pertenecen claramente a la API pública estable de Better Auth, como `runWithAdapter`, `auth.$context` o escrituras con su adapter. El resto de la aplicación usa un puerto de identidad. Una regla de lint impide importar `better-auth` o `@better-auth/*` fuera del módulo.
- `better-auth`, `@better-auth/core` y el CLI `auth` se fijan en la versión exacta validada por el spike S-1 (`1.7.7`), sin rangos.
- El módulo tiene tests de contrato contra PostgreSQL que replican los criterios de S-1.
- Una actualización de Better Auth, incluido un parche, se acepta solo si: (1) se revisaron sus notas de versión; (2) los tests de contrato pasan con la nueva versión exacta; (3) el CLI `auth` se actualiza a la misma versión y el esquema regenerado conserva las restricciones propias. Un test de contrato que falla bloquea la actualización; no se modifica el test para que pase sin revisar el diseño.
- Los usuarios se desactivan, no se eliminan: una cuenta desactivada no inicia sesión y sus sesiones se invalidan, pero sus comprobantes y su auditoría persisten (ERS RF-409).
- El establecimiento y el punto de emisión predeterminados son preferencias del usuario en la aplicación, no datos de autenticación (ERS RF-113).
- Los procesos del sistema, como los jobs, actúan con un actor de sistema explícito en la auditoría, nunca con la identidad de un usuario.
- El MVP no tiene recuperación pública de contraseña por correo. Un usuario que olvida su contraseña la recupera mediante un administrador, que le establece una nueva.
- Si ningún administrador puede entrar, el administrador técnico usa un comando de recuperación administrativa (break-glass) en el servidor. Es una operación de emergencia: no existe ni puede existir en la API pública ni en ninguna ruta HTTP, y deja un evento de auditoría con el administrador técnico como actor.

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

