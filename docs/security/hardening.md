# Security Hardening

`principles.md` states why. `threat-model.md` states what is defended against. This document
states which controls to implement at each boundary. `access-control.md` specifies
object-level authorization and tenant isolation in depth.

## Untrusted Input

Everything crossing a boundary is untrusted until validated: HTTP params, query, body and
headers, environment variables, external API responses, webhooks, uploaded files, background
job payloads, imported files, and configuration.

- Validate shape, type, range, and length at the boundary, before the value reaches business logic.
- Validate environment variables at startup and refuse to start when a required one is missing or malformed.
- Reject unknown fields when the contract is closed, instead of ignoring them.
- Allowlist the fields a client may write, so privileged fields such as role, tenant, or balance cannot ride along. See `access-control.md`.
- Normalize and re-validate values that were stored earlier by an untrusted source.
- Return a business message on failure and keep the diagnostic detail in logs.

## Injection

- Use the ORM's parameterized queries. Never build SQL by string concatenation.
- Isolate, document, and parameterize any raw query.
- Never interpolate user input into shell commands, file paths, or expressions evaluated at runtime.
- Canonicalize and verify any user-influenced path before touching the filesystem.
- Constrain user-supplied sort fields, filter fields, and column names to an allowlist.

## Output

- Encode values that reach HTML; prefer rendering text over trusted-HTML injection.
- Sanitize any rich content that must render as markup.
- Set a Content Security Policy and the standard security headers.
  - En este proyecto, la API las envía con helmet (`../architecture/backend.md`).
  - Las del frontend tienen una sola autoridad, Next.js: `frontend/src/proxy.ts` aplica la política
    de `frontend/src/lib/web-security-policy.ts` a cada documento, con un nonce por petición
    (ADR 0025).
  - El proxy inverso no añade otra CSP. HSTS pertenece al proxy que termina TLS
    (`../architecture/deployment.md`).
- Sanitize errors that reach the client. See `../architecture/feedback-and-states.md`.

## Authentication And Authorization

- Enforce authorization server-side on every protected route. The frontend gate is presentation only.
- Check ownership, not only identity: confirm this user may act on this specific record.
- Derive user, tenant, and role from the session, never from the request. See `access-control.md`.
- Deny by default; a route without an explicit rule is closed.
- Rate limit authentication, password reset, and expensive or enumerable endpoints.
- Keep session cookies HTTP-only, Secure, and same-site.
- Do not leak account existence through differing error messages or response timing.
- Invalidate the server session on logout and on credential change.

### Valores por defecto del proyecto

Las specs exigen la garantía; los valores son configuración técnica. No provienen del ERS ni
de CTX, y se cambian sin modificar las specs. La interfaz no fija la política de contraseñas: solo exige que el
campo no esté vacío y muestra el mensaje del servidor, que indica la longitud vigente en el alta,
en la contraseña establecida por un administrador y en el cambio de la propia. El estado de ambos límites de inicio de sesión
vive en memoria y solo es válido con una instancia de API (`../architecture/deployment.md`).

| Control | Default propuesto | Configurable | Origen de la garantía |
| --- | --- | --- | --- |
| Política de contraseñas | 12 a 128 caracteres, sin reglas de composición, pegado permitido | Sí, mínimo y máximo | CognitiveStack (`authentication.md`, `navigation-responsive.md`); hash de ERS SEC-001 |
| Límite de inicio de sesión por correo e IP | 5 intentos fallidos cada 15 minutos; un inicio correcto reinicia el contador | Sí, intentos y ventana | CognitiveStack ("Rate limit authentication") |
| Límite de inicio de sesión por IP | 30 peticiones por minuto, solo contra ráfagas y tolerante a oficinas detrás de NAT | Sí, peticiones y ventana | CognitiveStack; ajuste derivado del spike S-1 |

### Origen de las peticiones

Defensa en profundidad de `/api/v1` frente a las peticiones que un navegador envía desde otro sitio
con la cookie de sesión. No sustituye la sesión, el rol ni el aislamiento por empresa. Los
requisitos están en la spec `api-request-protection`.

- **Frontera de confianza.** El único origen aceptado es el canónico, el de `BETTER_AUTH_URL`, que
  también usa Better Auth. Sin un origen `http` o `https` válido, la API no arranca. No hay lista
  adicional, comodines ni forma de desactivarlo.
- **Las cabeceras reenviadas no cuentan.** `Host`, `X-Forwarded-Host`, `Forwarded` y
  `X-Forwarded-Proto` llegan del cliente o del reenvío. `TRUST_PROXY` solo decide la IP del
  cliente, nunca el origen.
- **Por qué hace falta.** La cookie `SameSite=Lax` viaja también desde un subdominio hermano o
  desde otro puerto del mismo host. Algunos `POST` no llevan cuerpo y salen sin preflight, y la
  exportación de reportes es un `GET` con efectos.
- **Dos reglas.** Las mutaciones exigen el `Origin` exacto. Fetch Metadata rechaza además
  `same-site` y `cross-site` en todos los métodos salvo `OPTIONS`.
- **Antes del cuerpo y de la sesión.** La guarda corre antes del parser JSON
  (`../architecture/backend.md`), y su 403 no revela el origen esperado.
- **Sin CORS.** La API no envía cabeceras `Access-Control-Allow-*`.
- **`/api/auth`.** La guarda no se aplica: Better Auth conserva su propia comprobación de origen y
  su CSRF. La aplicación solo acota su cuerpo a 8192 bytes y exige JSON en un cuerpo no vacío
  (`../architecture/authentication.md`, "Adaptador acotado").

## Secrets

- Never in code, logs, error messages, client bundles, or version control.
- Only variables explicitly intended to be public may reach the browser.
- A leaked secret is rotated, not merely deleted in a later commit.

### Escaneo de secretos en este proyecto

`corepack pnpm security:secrets` (`scripts/check-secret-security.ts`) ejecuta Gitleaks, fijado por
versión y SHA-256 en `security/gitleaks.json`, y corre en la CI en el workflow de seguridad
(`add-ci-dependency-and-secret-scanning`).

- **Reglas:** las de Gitleaks por defecto (`[extend] useDefault = true` en `.gitleaks.toml`) más las
  del proyecto:
  - **por ruta:** `*.p12`, `*.pfx`, `archivosensible.env` y los `.env` reales (no los
    `.env.example`);
  - **por contenido:** la clave maestra de la custodia, el secreto de Better Auth y las URL de
    PostgreSQL con una contraseña;
  - **las claves privadas PEM**, con la regla por defecto.
- **Lo que no se trata como secreto:** las claves de acceso del SRI, los identificadores fiscales,
  los números de autorización, las firmas XML ni los certificados públicos. Ninguna regla los marca
  solo por largos.
- **Archivos binarios y vacíos.** Gitleaks no informa las reglas por ruta de estos archivos en modo
  git, y un PKCS#12 real es binario. El comprobador revisa además, solo con git, cada ruta del
  historial y del índice preparado con las mismas reglas.
- **Alcance:** solo datos de git.
  - En la CI, el historial alcanzable desde el commit del evento.
  - En local, además, lo preparado para el commit.
  - Nunca el directorio de trabajo, así que no lee archivos sin versionar como `archivosensible.env`
    ni nada fuera del repositorio.
- **Falsos positivos:**
  - **Allowlists acotadas:** solo para valores ya marcados como de pruebas o solo de CI, los ejemplos
    documentados que la API rechaza en producción, la credencial de la base local de desarrollo y
    las claves de idempotencia.
  - **Huellas:** lo que quede se suprime en `.gitleaksignore`, con un comentario.
  - **Lo que no se suprime:** las reglas por ruta. Los comentarios `gitleaks:allow` tampoco
    suprimen nada.
  - **Sin exclusiones** de directorios, de pruebas ni de documentos.
- **Salida redactada:** solo la regla, el archivo, la línea, el commit corto y un identificador
  opaco.
  - Nunca el valor, el campo `Match`, la huella cruda ni el autor del commit.
  - Para un archivo prohibido, solo la categoría y el directorio, porque el nombre podría contener
    la identidad de un contribuyente.
  - El informe de Gitleaks es temporal y se borra siempre. No hay SARIF ni artefactos.
- **Respuesta ante un hallazgo real:**
  1. contener;
  2. rotar o revocar el secreto donde aplique;
  3. evaluar la exposición;
  4. decidir aparte si conviene reescribir el historial.

  Reescribirlo, o forzar un push, exige autorización explícita del dueño. Encontrar un secreto no
  autoriza a modificar el historial publicado, ni a imprimir o mover el valor por la automatización.
- Keep production credentials at least privilege after provisioning.

## File Handling

- Validate type, size, and content server-side; client-side checks are early feedback only.
- Generate the stored filename; never trust the name supplied by the client.
- Store outside the served root or in object storage, never at a client-controlled path.
- Authorize every read as well as every write.
- Enforce per-user and total size limits.
- Keep storage paths, buckets, and provider names out of responses and the interface.

### Avatar propio (`redesign-account-profile`)

- **Qué es:** una foto del propio usuario, PNG o JPEG reconocida por su contenido con la inspección
  compartida de `platform/images` (como el logo), de hasta `AVATAR_MAX_BYTES` (512 KB por defecto)
  y 4096 px por lado. SVG y GIF se rechazan.
- **Dónde vive:** en la tabla `user_avatar`, una fila por identidad, borrada en cascada con ella. No
  se escribe en disco ni tiene una ruta controlada por el cliente.
- **Quién lo ve:** solo su dueño, en su perfil y en su menú de cuenta. `PUT`, `GET` y
  `DELETE /api/v1/me/avatar` resuelven al usuario desde la sesión, sin identificador en la ruta. No
  existe ninguna operación para leer o quitar el avatar de otro: ni un administrador de la misma
  empresa ni otra empresa pueden leerlo, cambiarlo ni saber si existe.
- **Respuesta:** `GET` lo sirve con `Cache-Control: private, no-cache`, `ETag` con su SHA-256 y
  `X-Content-Type-Options: nosniff`, desde el mismo origen. La CSP no cambia.
- **Dato personal:** no se audita, no está en la lista de Usuarios ni en el paquete de
  portabilidad, y se conserva hasta que el usuario lo quita o se borra su identidad.

## Correo saliente

Proyecto (`add-email-delivery`; ADR 0029):

- **Contraseña SMTP.** Cifrada en reposo con el sobre de `platform/secrets` y la clave maestra de
  custodia; nunca vuelve en una respuesta (la consulta dice `passwordSet`), en un log ni en la
  auditoría, que registra `smtpLoginChanged` sin valores. Sin custodia, no se guarda.
- **Transporte.** TLS directo o STARTTLS con el certificado verificado y TLS 1.2 o superior; la
  conexión sin cifrado se rechaza salvo con `EMAIL_ALLOW_PLAINTEXT_SMTP=1`, que solo pone el buzón de
  pruebas local. nodemailer no lee archivos ni URL: los adjuntos son bytes en memoria verificados
  por SHA-256.
- **Salida de red.** La API no tiene salida por defecto; el override `compose.smtp-egress.yaml` es
  una decisión explícita, separada del interruptor `EMAIL_DELIVERY_ENABLED` (apagado por defecto).
- **Datos personales.** Las direcciones de los receptores están en sus terceros (hasta tres) y en el
  historial de cada envío, que las conserva aunque el tercero cambie. El reenvío las audita. Los logs
  del correo llevan solo los identificadores del envío y del comprobante y el código del fallo,
  nunca direcciones, contenido ni la respuesta completa del servidor. El paquete de portabilidad
  incluye los correos de los terceros, pero no el historial de envíos.
- **Límites.** Correo de prueba: 5 por minuto y empresa. Reenvío: de 1 a 10 direcciones, solo de
  comprobantes autorizados, idempotente por clave.

## Dependencies And Supply Chain

- Prefer the standard library or an existing utility. Every dependency is a liability.
- Verify the exact package name before installing; typosquatting relies on a glance.
- Audit for known vulnerabilities and check that the package is still maintained.
- Confirm the license is compatible before adopting.
- Commit the lockfile and review its diff; a single direct bump can pull in many indirect changes.
- Treat an unmaintained dependency on a security-relevant path as a finding.

### Escaneo de dependencias en este proyecto

`corepack pnpm security:dependencies` (`scripts/check-dependency-security.ts`) consulta `pnpm audit`
sobre el lockfile y corre en la CI en el workflow de seguridad (`add-ci-dependency-and-secret-scanning`).

- **Bloquean:** los avisos HIGH y CRITICAL, de producción y de desarrollo, directos y transitivos,
  sin período de gracia. MODERATE, LOW e INFO se informan sin bloquear.
- **`ERROR` no es `PASS`.** Una salida vacía, malformada o no JSON de la fuente de avisos es `ERROR`,
  distinto de un hallazgo (`FAIL`). Ninguno de los dos pasa.
- **Excepciones:** `security/dependency-audit-exceptions.json`. Cada excepción lleva:
  - el GHSA y el paquete exactos;
  - las rutas de dependencias que cubre, que deben ser todas las del hallazgo;
  - el motivo con su contexto de explotabilidad, el responsable, la fecha de revisión y el
    vencimiento, de como máximo 90 días.
- **Cuándo falla una excepción:** si vence, si le falta un campo, si usa comodines o campos extra, si
  está duplicada, si su revisión está en el futuro, o si ya no corresponde a un hallazgo bloqueante
  o a alguna de sus rutas (obsoleta).
- **Una ruta nueva hacia un paquete exceptuado** vuelve a bloquear.
- **Lo que no se usa:**
  - `pnpm audit --ignore-unfixable`, que ignora en bloque y sin dejar rastro;
  - los ignorados de `pnpm-workspace.yaml`, sin motivo, responsable ni vencimiento, que además
    ocultan el aviso en local.
- **Corrección:** se corrige la dependencia en un cambio propio, o se registra una excepción
  revisada. Nunca se suprime un aviso solo para obtener la CI en verde.

## Logging

- Never log passwords, tokens, cookies, full auth headers, or full sensitive payloads.
- Include a correlation identifier so an error reported to a user can be traced.
- Log authorization failures and suspicious input, and keep them reviewable.

## Verification

- [ ] Every new boundary validates its input before use.
- [ ] No query, path, or command is built by concatenating user input.
- [ ] Every protected route enforces authorization and record ownership server-side.
- [ ] No secret reaches code, logs, responses, or the client bundle.
- [ ] Uploads validate server-side, store a generated name, and authorize reads.
- [ ] New dependencies were verified, audited, and justified, with the lockfile committed.
- [ ] Errors returned to users are sanitized and diagnostics stay in logs.
