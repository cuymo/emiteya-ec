# Design

## Context

Motivación y alcance en `proposal.md`; comportamiento en `specs/user-access/spec.md` y
`specs/audit-trail/spec.md`.

Estado actual: no existe código de aplicación. Este cambio asume aplicado el cambio
`bootstrap-application` (repositorio, Express, Next.js, Prisma, PostgreSQL de pruebas,
comando `verify`), que es un requisito de `/opsx:apply`, no de esta propuesta.

Restricciones que gobiernan el diseño:

- ADR 0009 (Accepted): `User` es identidad, `Company` es tenant, `Membership` une usuario, empresa y rol. Todo recurso privado se aísla por `companyId`, y el contexto se deriva en el servidor.
- `docs/architecture/stack.md` y `authentication.md`: Better Auth gestiona el inicio de sesión, las sesiones, los hashes y sus tablas. No se escribe autenticación propia.
- `docs/security/access-control.md`, `docs/architecture/backend.md` (pipeline y brief de operación sensible) e `idempotency.md`.
- Patrones de interfaz de `docs/architecture/` (`cognitive-architecture.md`, `component-selection.md`, `component-system.md`, `forms-and-workflows.md`, `data-tables.md`, `feedback-and-states.md`, `navigation-responsive.md`).

## Spike S-1: ejecutado

S-1 se ejecutó el 2026-10-02 en un workspace temporal descartable, fuera del repositorio,
con PostgreSQL 17 en un contenedor y la integración concreta: Better Auth 1.7.7 (core, plugin
Organization y plugin admin), `@better-auth/core` 1.7.7, Express 5.2.1, Prisma 7.10.0 con
`@prisma/adapter-pg`, y el CLI oficial `auth` 1.7.7 para generar el esquema. Resultado final:
14 pruebas de integración en verde, 11 criterios y 3 verificaciones adicionales. El código
del spike no forma parte del producto.

### Resultados de S-1

| # | Criterio | Resultado | Evidencia y mecanismo |
| - | -------- | --------- | --------------------- |
| 1 | Registro público deshabilitado | Cumple | `emailAndPassword.disableSignUp`: `/sign-up/email` responde 4xx con y sin sesión, y bloquea también la llamada de servidor. |
| 2 | El administrador crea un usuario | Cumple | `auth.api.createUser` del plugin admin, invocado desde el servidor sin sesión. |
| 3 | El usuario se autentica | Cumple | `/sign-in/email` abre sesión. |
| 4 | Membresía en Company A con rol de esa empresa | Cumple | Plugin Organization: `organization` es la empresa y `member` la membresía, con roles propios `ADMIN` y `OPERATOR` y el campo adicional `status`. |
| 5 | Empresa y rol desde estado del servidor | Cumple | El middleware lee la sesión de Better Auth y la membresía `ACTIVE`; un cambio de rol rige en la siguiente petición con el mismo token. |
| 6 | `companyId` o `role` del cliente no alteran el contexto | Cumple | Cuerpo, consulta y cabeceras sin efecto; el cuerpo con `companyId` se rechaza. Los endpoints de cliente de los plugins Organization y admin responden `404`. |
| 7 | Desactivar invalida las sesiones antes de la siguiente operación | Cumple | `internalAdapter.deleteUserSessions` más el filtro de membresía `ACTIVE` del middleware; la siguiente petición responde `401`. |
| 8 | El usuario desactivado no vuelve a iniciar sesión | Cumple, tras corregir | `databaseHooks.session.create.before` rechaza la sesión. La primera versión respondía `FAILED_TO_CREATE_SESSION`, distinto del mensaje genérico; corregido lanzando el mismo error que una contraseña incorrecta. |
| 9 | El administrador establece una contraseña sin correo | Cumple | `ctx.password.hash` más `internalAdapter.updatePassword` y `deleteUserSessions`; la anterior deja de servir y las sesiones se revocan. |
| 10 | Una membresía de A nunca autoriza recursos de B | Cumple | Rol, estado y contraseña de un usuario de B responden `404` para un administrador de A, y la lista solo muestra A. |
| 11 | Operación de Better Auth y evento de auditoría atómicos | Cumple | `prisma.$transaction` con `runWithAdapter` de `@better-auth/core/context` y un adapter de Prisma ligado a la transacción: un fallo inyectado al auditar revierte el alta (sin usuario ni cuenta) y el cambio de contraseña. |
| E1 | Correo sin distinguir mayúsculas | Cumple | Better Auth guarda el correo en minúsculas; el alta duplicada con otra capitalización responde `409`. |
| E2 | Longitud de contraseña configurable sin código propio | Cumple parcialmente | `minPasswordLength` y `maxPasswordLength` rigen en `/change-password`, pero `createUser` del plugin admin **no** los aplica: el esquema de la aplicación debe validarlos en toda alta y restablecimiento. |
| E3 | Límite de intentos y dónde queda la IP | Cumple, tras corregir | El limitador nativo cuenta todas las peticiones por IP y ruta: tras una IP compartida (NAT), el sexto inicio *correcto* recibía `429`. Better Auth toma la IP solo de cabeceras (`x-forwarded-for` por defecto), y guardaba la IP en `session.ipAddress`. Corregido con la configuración de D9. |

Hallazgos sin criterio propio que el diseño incorpora:

- El plugin Organization expone 36 endpoints de cliente (`set-active`, `update-member-role`, `leave`, `create`…), y el plugin admin 15 (`impersonate-user`, `set-role`…) que operan sobre los usuarios de todas las empresas. Una lista de rutas deshabilitadas dejaría abiertos los endpoints que traiga una versión futura; se bloquean por prefijo (D2).
- Las operaciones de admin que exigen sesión (`set-user-password`, `ban-user`, `revoke-user-sessions`) requieren el rol global `admin` de Better Auth, que vale para todas las empresas. Ningún usuario recibe ese rol; esas operaciones usan el contexto de servidor `auth.$context`.
- El esquema generado no trae `UNIQUE (organizationId, userId)` en `member` y exige `name` y `slug` únicos en `organization`. Regenerar con el CLI sobrescribe el esquema de Prisma.
- Prisma 7 con `prisma-client-js` en una ruta propia necesita `@prisma/client-runtime-utils` como dependencia directa bajo pnpm. Better Auth 1.7.7 admite Prisma hasta la versión 7; la etiqueta `latest` de Prisma apunta hoy a una release candidate de la 8.
- Prisma bloquea `db push --accept-data-loss` y comandos destructivos similares cuando los ejecuta un agente sin consentimiento explícito del usuario.

Ningún criterio exigió una membresía propia ni código de autenticación propio: no hace falta
ADR de desviación. Q-41 queda resuelta.

## Goals / Non-Goals

**Goals:**

- Un único punto de resolución del contexto de petición que haga imposible autorizar con datos del cliente.
- Una política de autorización central, denegada por defecto, que los cambios futuros amplían con sus propias filas.
- Aislamiento por empresa verificable con dos empresas en las pruebas desde el primer cambio.
- Ninguna línea de autenticación propia: hashes, sesiones y verificación de credenciales son de Better Auth.

**Non-Goals:**

- Optimizar la consulta de membresía por petición con caché: se mide primero.
- Diseñar la pantalla de auditoría o el modelo de permisos de módulos futuros.

## Decisions

### D1. Modelo conceptual sobre Better Auth

| Concepto     | Implementación                                     | Notas |
| ------------ | -------------------------------------------------- | ----- |
| `User`       | Tabla `user` de Better Auth                        | Identidad y credenciales. Global: no lleva `companyId`. |
| `Company`    | Tabla `organization` del plugin Organization       | Tenant: su `id` es el `companyId` de todo recurso privado. El aprovisionamiento crea la fila con un nombre y un slug provisionales; los datos tributarios vivirán en una tabla propia del módulo `taxpayer`, con `companyId`, no como campos del plugin. |
| `Membership` | Tabla `member` del plugin Organization             | `organizationId`, `userId`, `role` (`ADMIN` u `OPERATOR`, definidos con el control de acceso del plugin) y el campo adicional `status` (`ACTIVE` o `DEACTIVATED`). |

- La autorización lee solo el rol de la membresía. El rol global que añade el plugin admin (`user.role`) no concede nada, nunca se asigna `admin` y no se expone al cliente.
- La desactivación es un estado de la membresía; en el MVP, sin membresía activa no se abre sesión (D6).
- Alternativa descartada tras S-1: tablas de membresía propias. El plugin cumplió los once criterios, de modo que una implementación propia no tenía justificación.
- Coste aceptado del plugin: tablas y endpoints que el MVP no usa (invitaciones, equipos, roles dinámicos), cerrados por D2.

### D2. Integración con Better Auth

- Montada en Express en `/api/auth/{*any}` (sintaxis de Express 5), antes de `express.json()`.
- Adapter de Prisma con `transaction: true`. Prisma en la major 7, con versiones exactas que fija `bootstrap-application` (`prisma`, `@prisma/client` y `@prisma/adapter-pg` en `7.10.0`, con el generador `prisma-client`, compatible con Better Auth 1.7.7 según la prueba registrada en el diseño de `bootstrap-application`), y `@better-auth/core` como dependencia directa para `runWithAdapter`.
- El esquema se genera con el CLI `auth` instalado como dependencia de desarrollo en versión exacta, y se ejecuta con `corepack pnpm exec auth` y `corepack pnpm exec prisma`, nunca con `npx` ni con `pnpm dlx` sin versión, que podrían descargar Prisma 8 o un CLI distinto.
- `emailAndPassword` con `disableSignUp: true` y las longitudes de contraseña de la configuración (D9).
- Sesiones en base de datos con `session.cookieCache` deshabilitado, para que la revocación rija en la siguiente petición.
- Plugins: Organization (`allowUserToCreateOrganization: false`, roles `ADMIN` y `OPERATOR`, campo adicional `status` en `member`) y admin, usado solo por `auth.api.createUser` desde el servidor.
- Un `hooks.before` rechaza con `404` toda petición HTTP cuya ruta empiece por `/organization/` o `/admin/`, incluidas las que agreguen versiones futuras. Las llamadas de servidor (`auth.api.*`) no son peticiones HTTP y no se ven afectadas. Se prefiere a `disabledPaths` porque una lista se queda corta al actualizar.
- Atomicidad con la auditoría: los casos de uso que combinan Better Auth y escrituras propias corren en `prisma.$transaction(tx => runWithAdapter(prismaAdapter(tx, { transaction: false })(auth.options), fn))`, de modo que Better Auth y la auditoría escriben en la misma transacción.
- Cookies HTTP-only, Secure en producción, `SameSite=Lax`. Frontend y API comparten origen (ADR 0016), de modo que los orígenes de confianza se derivan de `BETTER_AUTH_URL` y no hace falta CORS.
- Telemetría de Better Auth deshabilitada.
- Versión exacta, sin rangos: `better-auth`, `@better-auth/core` y el CLI `auth` en `1.7.7`, la versión validada por S-1.

### D2b. Módulo único de integración con Better Auth

- Todo el código que toca Better Auth vive en un solo módulo de infraestructura, `backend/src/modules/identity/infrastructure/better-auth/`: configuración, plugins, hooks, montaje del handler, helper transaccional y operaciones de identidad.
- Usos que no pertenecen claramente a la API pública estable y que solo pueden aparecer dentro de ese módulo: `runWithAdapter` de `@better-auth/core/context`; `auth.$context` (`internalAdapter.updatePassword`, `internalAdapter.deleteUserSessions`, `password.hash`); escrituras sobre `member` con el adapter de Better Auth (`getCurrentAdapter(...).create` y `update`).
- Hacia el resto de la aplicación, el módulo expone un puerto de identidad con operaciones del dominio: obtener el contexto de sesión, crear identidad con membresía, cambiar rol, cambiar estado, establecer contraseña, revocar sesiones y ejecutar un caso de uso en transacción con la auditoría. Los casos de uso y el dominio dependen solo de ese puerto.
- Una regla de ESLint (`no-restricted-imports`) prohíbe importar `better-auth` o `@better-auth/*` fuera del módulo; romperla hace fallar `pnpm verify`.
- Tests de contrato del módulo, contra PostgreSQL real: replican los once criterios y las verificaciones adicionales de S-1 sobre el puerto y sobre la configuración (registro deshabilitado, endpoints de plugins cerrados, mensaje genérico, revocación inmediata, atomicidad con la auditoría, IP no persistida, límites de intentos).
- Política de actualización: una actualización de Better Auth, incluido un parche, solo se acepta si los tests de contrato pasan con la nueva versión exacta y se revisaron sus notas de versión. Un test de contrato que falla bloquea la actualización; no se ajusta el test para que pase sin revisar el diseño. La política queda en `docs/architecture/authentication.md`.

### D3. Resolución del contexto de petición

Pipeline de `backend.md`, con este reparto:

```text
middleware: sesión Better Auth -> userId
         -> membresía ACTIVE de ese userId (consulta indexada, sin caché)
         -> RequestContext { userId, companyId, role, requestId }
caso de uso: autorización -> pertenencia del recurso -> validación -> transacción -> auditoría -> respuesta saneada
```

- Ningún código lee `companyId` ni el rol del usuario de la petición. Los esquemas Zod de escritura son estrictos y rechazan `companyId` y cualquier campo desconocido. `role` solo se acepta donde es el rol que se asigna a otro usuario (alta y cambio de rol).
- Los casos de uso reciben `RequestContext` como datos simples, nunca el objeto de Express.
- Sin sesión: `401`. Sesión sin membresía activa: `401` con el mismo cuerpo, para no revelar si la identidad existe.
- Alternativa descartada: guardar `companyId` y rol dentro de la sesión. Un cambio de rol o una desactivación tardarían hasta que la sesión se renueve, y la spec exige efecto en la siguiente operación.

### D4. Política de autorización central

Un mapa de rol a permisos, denegado por defecto, consultado por cada caso de uso:

| Permiso                 | `ADMIN` | `OPERATOR` |
| ----------------------- | ------- | ---------- |
| `account.read`          | Sí      | Sí         |
| `account.changePassword` | Sí     | Sí         |
| `users.read`            | Sí      | No         |
| `users.create`          | Sí      | No         |
| `users.changeRole`      | Sí      | No         |
| `users.changeStatus`    | Sí      | No         |
| `users.setPassword`     | Sí      | No         |

- Orden: primero el permiso, luego la pertenencia del usuario objetivo a la empresa (`404` si no pertenece) y después la validación del resto del payload. Así quien no tiene permiso no aprende nada de los errores de validación.
- Códigos: `400` validación, `401` sin autenticación, `403` sin permiso dentro de la empresa, `404` fuera de la empresa o inexistente, `409` conflicto de regla (correo en uso o cambio sobre la propia cuenta), `429` límite de intentos.
- Cada `403` y cada `404` de administración de usuarios emite un evento de seguridad (D13); no entra en el rastro de auditoría.
- Los cambios futuros añaden sus permisos a este mapa; ninguno se concede por omisión.

### D5. Sin auto-modificación de acceso

- Nadie cambia su propio rol (`access-control.md`) ni se desactiva a sí mismo. Con un único administrador, ninguna acción suya puede dejar a la empresa sin administrador.
- No se garantiza un mínimo de administradores ante solicitudes simultáneas. Si dos administradores se degradan o desactivan mutuamente al mismo tiempo, la empresa podría quedar sin administrador activo. Se acepta para el MVP porque es raro y la recuperación de emergencia (D8) lo resuelve; un invariante con bloqueo por empresa queda como mejora futura si el uso real lo pide.
- Alternativa descartada en esta revisión: bloquear la fila de la empresa en cada cambio de rol o estado. Era comportamiento inventado durante la propuesta y ampliaba el primer cambio sin una fuente que lo exigiera.

### D6. Desactivación, reactivación y credenciales

- Desactivar: dentro de la transacción de D2, `status = DEACTIVATED` en `member` mediante el adapter de Better Auth y `internalAdapter.deleteUserSessions`. `databaseHooks.session.create.before` impide abrir una sesión sin membresía `ACTIVE` y lanza el mismo error que una contraseña incorrecta (`INVALID_EMAIL_OR_PASSWORD`), para no revelar la desactivación. El filtro de D3 rechaza cualquier sesión que sobreviviera.
- Reactivar: `status = ACTIVE`; conserva rol y contraseña.
- Contraseña establecida por un administrador: `ctx.password.hash` e `internalAdapter.updatePassword` de `auth.$context`, más `deleteUserSessions`, en la transacción de D2. No se usa `set-user-password` del plugin admin porque exige el rol global `admin`.
- Contraseña propia: endpoint de Better Auth `/change-password` con `revokeOtherSessions: true`, que exige la contraseña actual y aplica la longitud configurada. Emite un evento de seguridad (D13), no un evento de auditoría.
- Las operaciones de estado y rol son `PUT` de estado deseado: repetirlas da el mismo resultado y no registra un cambio nuevo.

### D7. Aprovisionamiento al arrancar

- Antes de aceptar tráfico, la API comprueba si existe la empresa. Si no existe, toma un advisory lock de PostgreSQL, vuelve a comprobar y ejecuta pasos idempotentes: crear la empresa, buscar o crear la identidad del administrador inicial, buscar o crear su membresía `ADMIN` y registrar el evento con el actor sistema.
- Que el MVP tenga una sola empresa es una política operativa del aprovisionamiento, no una restricción del modelo de datos. La garantizan el advisory lock, la comprobación previa (si ya existe una empresa, el aprovisionamiento no crea otra) y la ausencia de cualquier vía para crear empresas: ninguna ruta de la API lo permite y el endpoint `create` del plugin Organization está bloqueado (D2). No existe índice, `CHECK` ni trigger que limite el número de empresas, de modo que multiempresa (P2) solo añadirá un flujo de creación y de selección de empresa, sin migrar el modelo de tenancy del ADR 0009.
- Los pasos corren en la transacción de D2, con `auth.api.createUser` para la identidad, de modo que el aprovisionamiento es atómico; además, cada paso busca antes de crear, por si un arranque anterior quedó a medias (spec: "Interrupción a mitad del aprovisionamiento").
- `INITIAL_USER_EMAIL` e `INITIAL_USER_PASSWORD` se validan solo cuando falta la empresa; la contraseña se valida con la política de D9. Una vez aprovisionada la empresa, se ignoran. La documentación recomienda retirar la contraseña del entorno tras el primer arranque.
- Alternativa: un comando de instalación explícito. Se descarta como único mecanismo porque añade un paso manual, pero el comando de recuperación de D8 cubre el caso de emergencia.

### D8. Recuperación administrativa de emergencia (break-glass)

- Comando de servidor del paquete de la API, por ejemplo `admin:recover --email <correo>`. Lee la contraseña nueva por la entrada estándar, nunca por argumentos, para que no quede en el historial del shell ni en la lista de procesos.
- Solo actúa sobre membresías `ADMIN`: establece la contraseña, reactiva la membresía si estaba desactivada, revoca las sesiones y registra el evento con el actor administrador técnico, con los mecanismos de D6 en la transacción de D2.
- Es una operación de emergencia del administrador técnico, que requiere acceso al servidor. No existe ninguna ruta HTTP equivalente, ni pública ni autenticada, y el código del comando no se importa desde el servidor HTTP.
- El MVP no tiene recuperación pública por correo; para un operador o un administrador que todavía tiene colegas con acceso, la vía normal es que un administrador le establezca una contraseña nueva.

### D9. Contraseñas, correos, límite de intentos e IP

- La spec exige la garantía; los valores son configuración, con defaults propuestos en `docs/security/hardening.md`. Ninguno proviene del ERS ni de CTX.
- Contraseñas: `minPasswordLength` y `maxPasswordLength` de Better Auth y un esquema Zod de la aplicación que lee los mismos valores de configuración. El esquema es obligatorio en el alta y en el restablecimiento, porque `createUser` del plugin admin no aplica la longitud (S-1, E2). El hash es de Better Auth.
- Correo: Better Auth lo guarda en minúsculas y su unicidad no distingue mayúsculas. Es una regla técnica de identidad, no un requisito de producto.
- IP del cliente: Better Auth la lee solo de cabeceras. Un middleware de Express escribe una cabecera propia del servidor (`x-app-client-ip`) con `req.ip`, sobrescribiendo cualquier valor del cliente, y `advanced.ipAddress.ipAddressHeaders` lee solo esa cabecera. `req.ip` respeta la configuración `trust proxy` de Express: sin proxies declarados usa la IP del socket, de modo que un `X-Forwarded-For` de un cliente directo no cambia nada (S-1, E3).
- La IP no se persiste: `databaseHooks.session.create.before` guarda la sesión con `ipAddress: null`, y el estado del límite vive en memoria.
- Límite de intentos en dos capas, ambas en memoria:
  1. Por correo e IP, mediante `hooks.before` y `hooks.after` de Better Auth sobre `/sign-in/email`: tras los fallos configurados (default 5 en 15 minutos), los intentos siguientes de esa combinación reciben `429`, incluso con la contraseña correcta; un inicio correcto reinicia el contador.
  2. Por IP, con el limitador nativo de Better Auth sobre `/sign-in/email`, solo contra ráfagas y tolerante a oficinas detrás de NAT (default 30 por minuto).
- Ambas capas guardan su estado en memoria del proceso: los contadores son por instancia y se reinician al reiniciar. Es válido solo con **una instancia de API**, que es la topología del MVP. Desplegar más de una instancia exige antes mover ambas capas a un almacenamiento compartido (`secondaryStorage` de Better Auth para el límite nativo y el mismo almacenamiento para el contador por correo e IP). Con varias instancias y estado en memoria, el límite real se multiplicaría por el número de instancias. No bloquea el MVP; queda documentado en `docs/architecture/deployment.md`.

### D10. API

Rutas bajo el prefijo general `/api/v1/` de ADR 0015; Better Auth queda en `/api/auth/*`.

| Método y ruta                         | Permiso                  | Notas                                                                  |
| ------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `GET /api/v1/me`                      | `account.read`           | Nombre, correo y rol.                                                  |
| `GET /api/v1/users`                   | `users.read`             | `search`, `status`, `page`, `pageSize` (25 por defecto, máximo 100).   |
| `POST /api/v1/users`                  | `users.create`           | `name`, `email`, `password`, `role`. `201`; `409` si el correo existe. |
| `PUT /api/v1/users/:userId/role`      | `users.changeRole`       | `{ role }`. Estado deseado.                                            |
| `PUT /api/v1/users/:userId/status`    | `users.changeStatus`     | `{ status: "ACTIVE" \| "DEACTIVATED" }`. Estado deseado.               |
| `PUT /api/v1/users/:userId/password`  | `users.setPassword`      | `{ password }`. Revoca sesiones del objetivo.                          |
| `POST /api/auth/change-password` (Better Auth) | `account.changePassword` | `currentPassword`, `newPassword`, `revokeOtherSessions: true`. |

- Envoltorios `{ data, meta? }` y `{ error: { code, message } }`. Mensajes de error en español y sin detalle interno.
- `:userId` es el identificador no secuencial de Better Auth; siempre se resuelve contra la membresía de la empresa del contexto.
- Las respuestas se arman con listas permitidas: nunca incluyen hashes, sesiones, cuentas de Better Auth ni el rol global de Better Auth.
- OpenAPI de estas rutas en `docs/generated/`, con la herramienta que fije `bootstrap-application` (ERS API-005).

### D11. Datos

- Tablas de Better Auth (`user`, `session`, `account`, `verification`) y del plugin Organization (`organization`, `member`, `invitation`), generadas con el CLI oficial `auth`.
- Restricciones propias sobre tablas del plugin, en el SQL de la migración: `UNIQUE (organizationId, userId)` en `member`; `CHECK` de `role` (`ADMIN`, `OPERATOR`) y de `status` (`ACTIVE`, `DEACTIVATED`). Ninguna restricción limita el número de empresas (D7).
- Regenerar el esquema con el CLI lo sobrescribe: los modelos propios y las restricciones se vuelven a aplicar tras cada generación, y una prueba de migración verifica que siguen presentes.
- `audit_event`, modelo propio: `company_id` (clave foránea a `organization` con `ON DELETE RESTRICT`), tipo de actor (`USER`, `SYSTEM`, `TECHNICAL_ADMIN`), usuario actor opcional, acción, usuario afectado, cambios redactados (JSON), identificador de correlación y momento. Índice `(company_id, occurred_at)`. Solo registra cambios exitosos y no guarda direcciones IP (`docs/quality/observability.md`).
- Solo de agregado: un trigger rechaza `UPDATE` y `DELETE` sobre `audit_event`, verificado en S-1. Se elige trigger frente a privilegios separados porque una instalación self-hosted puede usar un solo usuario de base de datos.
- `member` referencia `organization` y `user` con el borrado en cascada que define el plugin. No tiene efecto porque el producto nunca borra usuarios ni empresas, y los endpoints de borrado están cerrados (D2).
- Ningún código de aplicación escribe en las tablas de Better Auth con Prisma: lo hace mediante la API de servidor, `auth.$context` o el adapter de Better Auth. La lectura de `member` para el contexto (D3) es una consulta propia.

### D12. Interfaz

Tres pantallas. Briefs según `cognitive-architecture.md`.

**Iniciar sesión**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Cualquier usuario, incluidos los que entran por primera vez. |
| Objetivo | Entrar a la aplicación. |
| Decisión principal | Ninguna: presentar credenciales. |
| Información mínima | Correo, contraseña, error si ocurre. |
| Acción principal | `Iniciar sesión`. |
| Frecuencia y riesgo | Diaria, riesgo bajo. |

- P0: formulario, nombre del producto, mensaje de error. P1: texto de ayuda "¿Olvidaste tu contraseña? Pide a un administrador que la restablezca", porque no hay correo. P2 y P3: nada.
- Controles: campo de correo con `autocomplete="username"`; `PasswordField` con mostrar u ocultar, que permite pegar; `AsyncButton`.
- Estados: verificación de sesión sin pantalla en blanco; envío pendiente; mensaje genérico; mensaje de límite de intentos; redirección al shell si ya hay sesión; regreso a la URL de origen tras una sesión expirada, con el aviso "Tu sesión terminó".

**Usuarios** (destino de barra lateral en el grupo inferior `Configuración`, visible solo para `ADMIN`)

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador. |
| Objetivo | Encontrar a una persona, entender su acceso y ajustarlo. |
| Decisión principal | Si cambiar el rol, el estado o la contraseña de alguien, o dar acceso a alguien nuevo. |
| Información mínima | Nombre, correo, rol y estado. |
| Acción principal | `Crear usuario`. |
| Frecuencia y riesgo | Ocasional; riesgo medio: retirar acceso es reversible. |

- P0: tabla con nombre, correo, rol y estado, más `Crear usuario`. P1: búsqueda y filtro de estado (chips `Todos`, `Activos`, `Desactivados`, con `Todos` por defecto). P2: fecha de alta como columna opcional. P3: identificadores, auditoría e historial, fuera de esta pantalla.
- `AppDataTable` con paginación de servidor; el estado se muestra con `StatusBadge` (icono más texto, nunca solo color).
- Acciones de fila, todas sensibles al estado y al permiso: `Cambiar rol`, `Establecer contraseña` y `Desactivar` o `Reactivar`. En la fila del propio administrador las acciones de rol y estado no aparecen; un tooltip explica "No puedes cambiar tu propio acceso".
- `Crear usuario`: `FormDialog` con nombre, correo, contraseña inicial (`PasswordField`) y rol con `SelectionCardGroup` (Administrador: "Configura la empresa y gestiona usuarios"; Operador: "Emite y consulta comprobantes"). El rol por defecto es Operador, el de menor privilegio.
- `Cambiar rol`: `FormDialog` con el mismo `SelectionCardGroup`; acción `Guardar rol`.
- `Desactivar`: cambio reversible, de un paso, con `Deshacer` en el toast, que reactiva (escalera de confirmación). El toast nombra al usuario y avisa que sus sesiones se cerraron.
- `Establecer contraseña`: `FormDialog` con `PasswordField`, sin campo de repetición porque el campo permite ver la contraseña; el texto avisa que se cerrarán sus sesiones; acción `Establecer contraseña`.
- Toda mutación pasa por `useMutationFeedback`.
- Estados: skeleton con la geometría de la tabla; sin coincidencias con `Limpiar filtros`; error con reintento; sin permiso (un operador que abre la URL directamente ve `EmptyState` de permiso, y la API responde `403`); vista de tarjetas en móvil según `data-tables.md`.

**Mi cuenta** (desde el menú del avatar en la cabecera)

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Cualquier usuario. |
| Objetivo | Ver su acceso y cambiar su contraseña. |
| Decisión principal | Si cambiar la contraseña. |
| Información mínima | Nombre, correo, rol; contraseña actual y nueva. |
| Acción principal | `Cambiar contraseña`. |
| Frecuencia y riesgo | Rara, riesgo bajo. |

- Página completa, porque no es una fila de ninguna tabla (`forms-and-workflows.md`).
- P0: sección de cambio de contraseña. P1: nombre, correo y rol como etiquetas de solo lectura. P2 y P3: nada.
- Tras el éxito, toast que informa que las demás sesiones se cerraron.

Comunes: cabecera con menú de avatar (`Mi cuenta`, `Cerrar sesión`); `PermissionGate` solo
como presentación; una respuesta `401` durante el uso lleva al inicio de sesión conservando
la URL de origen.

### D13. Eventos de seguridad y observabilidad

Los eventos de seguridad son un concepto distinto del rastro de auditoría
(`docs/quality/observability.md`): pueden no tener empresa, no son inmutables y no se guardan
en la base de datos.

| Evento | Empresa | Datos |
| --- | --- | --- |
| Inicio de sesión fallido (correo inexistente, contraseña incorrecta o usuario desactivado) | Desconocida | Categoría interna, IP del cliente y correlación; nunca el correo en claro |
| Límite de intentos alcanzado | Desconocida | IP del cliente y correlación |
| Denegación de autorización (`403` o `404` en administración de usuarios) | Conocida | Actor, empresa, acción intentada y correlación |
| Contraseña propia cambiada | Conocida | Actor, empresa y correlación |

- Se emiten como logs estructurados y métricas; su retención es la del sistema de logs del operador (90 días por defecto propuesto).
- La IP del cliente sirve para el límite de intentos y la detección de abusos. Express confía en `X-Forwarded-For` solo para el número de proxies declarado en la configuración; sin esa configuración, usa la IP del socket.
- Nunca se registran contraseñas, hashes, tokens, cookies ni cabeceras de autenticación completas.
- Métricas: inicios de sesión fallidos, límites alcanzados y denegaciones de autorización.

### D14. Rendimiento

- D3 añade una consulta indexada por petición. Se acepta sin caché: la corrección de la revocación inmediata pesa más. Se mide con el presupuesto de ERS RNF-005 y solo se optimiza si no lo cumple.
- La lista de usuarios pagina en el servidor.

### Brief de operaciones sensibles

Responde las doce preguntas de `backend.md` para aprovisionamiento, alta, cambio de rol,
cambio de estado, contraseña establecida por un administrador, contraseña propia y
recuperación.

| # | Pregunta | Respuesta |
| - | -------- | --------- |
| 1 | ¿Quién puede ejecutarla? | Administración de usuarios: `ADMIN`. Cuenta propia: cualquier membresía activa. Aprovisionamiento: el sistema al arrancar. Recuperación: el administrador técnico desde el servidor, sin HTTP. |
| 2 | ¿Tenant del llamante? | La empresa de la membresía activa resuelta en D3. |
| 3 | ¿Tenant del recurso? | La empresa de la membresía del usuario objetivo. |
| 4 | ¿Cómo se valida la pertenencia? | La membresía objetivo se busca con `company_id` del contexto y `user_id` de la ruta; si no existe, `404`. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No: un `userId` de otra empresa responde `404` sin cambios, y un `companyId` en el cuerpo se rechaza por esquema estricto. |
| 6 | ¿Y si llega dos veces? | Alta: el correo único convierte la repetición en `409`. Rol, estado y contraseña: `PUT` de estado deseado, mismo resultado. Aprovisionamiento: pasos de buscar o crear y una sola empresa. |
| 7 | ¿Y si llegan dos a la vez? | Alta: la restricción única deja ganar a una. Rol y estado: el último en escribir gana, porque son estados deseados; la degradación mutua simultánea es un riesgo aceptado (D5). Aprovisionamiento: advisory lock. |
| 8 | ¿Necesita idempotencia, y cómo? | Natural: correo único, estado deseado y empresa única. No hace falta `Idempotency-Key`, porque ninguna operación crea un efecto sin clave natural. |
| 9 | ¿Qué restricciones la protegen? | Correo único; `UNIQUE (company_id, user_id)`; claves foráneas compuestas; una sola empresa; `CHECK` de rol y estado; trigger de solo agregado en la auditoría. |
| 10 | ¿Auditoría? | Sí, cada cambio exitoso, en la misma transacción que las escrituras de Better Auth (D2, verificado en S-1). Los intentos denegados son eventos de seguridad (D13). |
| 11 | ¿Pruebas de autorización? | Matriz de `docs/quality/testing.md` con dos empresas: propia, ajena por ruta, ajena por cuerpo, operador sobre operación de administrador, payload con `companyId` o rol propio, sesión revocada y usuario desactivado. |
| 12 | ¿Hay vías de fuga entre cuentas? | Lista filtrada por empresa; `404` uniforme fuera de la empresa; mensaje genérico de inicio de sesión; `/me` con campos mínimos; respuestas con listas permitidas; auditoría y eventos de seguridad sin secretos ni datos de otra empresa. |

## Risks / Trade-offs

- [Una actualización de Better Auth cambia la semántica de hooks, `runWithAdapter` o `auth.$context`] → Versión exacta fijada, usos no públicos confinados al módulo de D2b y tests de contrato obligatorios antes de aceptar la actualización.
- [Una versión nueva de un plugin añade endpoints de cliente] → El bloqueo por prefijo de D2 los cierra sin cambiar código; una prueba recorre las rutas de los plugins.
- [Regenerar el esquema con el CLI borra restricciones propias] → Se vuelven a aplicar tras cada generación y una prueba de migración las verifica (D11).
- [Contadores del límite en memoria] → Válidos solo con una instancia de API; escalar exige almacenamiento compartido antes del despliegue (D9).
- [Una instalación o un comando sin versión introduce Prisma 8, que Better Auth 1.7.7 no admite] → Versiones exactas de Prisma 7.10.0, overrides en el workspace y comandos solo con `pnpm exec`.
- [La consulta de membresía por petición añade latencia] → Índice dedicado y medición; caché solo si se mide un problema y si conserva la revocación inmediata.
- [Quedarse sin ningún administrador con acceso, por ejemplo por una degradación mutua simultánea] → Riesgo aceptado (D5); la recuperación de emergencia de D8 lo resuelve desde el servidor.
- [La contraseña inicial queda en el entorno] → Solo se usa en el primer arranque, nunca se registra, y la documentación recomienda retirarla.
- [Desactivar por error] → Acción reversible con `Deshacer` inmediato; el usuario solo tiene que volver a iniciar sesión.
- [Los defaults de contraseña o de intentos no encajan con una instalación] → Son configuración (`hardening.md`), no contrato; se ajustan sin cambiar las specs.

## Migration Plan

1. Primera migración del producto: tablas de Better Auth, empresa, membresía y auditoría, con restricciones y trigger. No hay datos previos.
2. Despliegue: definir `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `INITIAL_USER_EMAIL` e `INITIAL_USER_PASSWORD`, y arrancar. El aprovisionamiento ocurre una vez.
3. Rollback: antes de existir datos de producción, revertir la migración. Después, solo se avanza con migraciones nuevas, porque la auditoría es de solo agregado.

## Open Questions

Ninguna que cambie las specs. Valores configurables sin efecto en las specs: duración de la
sesión, longitudes de contraseña y umbrales del límite de intentos (defaults en D9 y
`docs/security/hardening.md`).

## Trazabilidad de requisitos

Fuente de cada requisito. "Inventado en propose" marca comportamiento que no venía de ERS,
CTX, un ADR, CognitiveStack ni una decisión explícita del usuario.

**`user-access`**

| Requisito | Fuente | Motivo |
| --- | --- | --- |
| Sin registro público | CognitiveStack (`authentication.md`); decisión explícita del usuario | Solo un administrador da acceso. |
| Aprovisionamiento inicial | ADR 0009; CognitiveStack (administrador inicial por entorno); ERS §4.1 | Sin él nadie puede entrar. Los escenarios de concurrencia e interrupción aplican la regla de idempotencia de `openspec/config.yaml`. |
| Inicio de sesión con correo y contraseña | ERS RF-001 | Usuarios locales. |
| Fallas sin revelar cuentas | CognitiveStack (`hardening.md`) | No filtrar la existencia de cuentas. |
| Protección contra intentos repetidos | CognitiveStack (`hardening.md`) | Frenar la adivinación; los valores son configuración. |
| Cierre de sesión | CognitiveStack (`authentication.md`) | Invalidar la sesión en el servidor. |
| Acceso protegido con sesión y membresía | ERS SEC-005; ADR 0009 | Toda operación protegida exige contexto. |
| Contexto derivado en el servidor | ADR 0009; decisión explícita; CognitiveStack (`access-control.md`) | El cliente no altera empresa ni rol. "Cambio de rol con sesión abierta" se deriva de leer la membresía en cada petición. |
| Aislamiento por empresa | ADR 0009; decisión explícita (S-1, criterio 10); regla de tenant de `openspec/config.yaml` | Otra empresa es inexistente. |
| Administración reservada al administrador | ERS §4, RF-002 | Solo el administrador configura usuarios. |
| Consultar los usuarios | ERS §4; búsqueda y paginación de CognitiveStack (`data-tables.md`, DoD) | Gestionar exige ver a quién. |
| Crear un usuario | ERS §4; decisión explícita | Los escenarios de repetición y concurrencia aplican la regla de `openspec/config.yaml`. |
| Política de contraseñas | CognitiveStack (`authentication.md`, `navigation-responsive.md`); ERS SEC-001 | Garantía de longitud; valores en `hardening.md`. |
| Cambiar el rol | ERS RF-002, §4; "no cambiar el propio rol" de CognitiveStack (`access-control.md`) | Ajustar acceso. |
| Desactivar un usuario | ERS RF-409; decisión explícita (S-1, criterios 7 y 8) | Retirar acceso sin borrar historial. "No desactivarse a sí mismo" es inventado en propose, por analogía con el rol propio; se mantiene porque impide que el único administrador se bloquee. |
| Reactivar un usuario | Inventado en propose; aceptado como decisión explícita | Revertir una desactivación sin crear otra cuenta. |
| Establecer la contraseña de otro usuario | Decisión explícita (credenciales sin correo); ERS §21; invalidación de sesiones de CognitiveStack (`hardening.md`) | Recuperación sin correo. "La propia no se establece por esta vía" es inventado en propose; se mantiene para que el cambio propio exija la contraseña actual. |
| Cambiar la contraseña propia | CognitiveStack (`authentication.md`) | Reemplazar la contraseña inicial. |
| Recuperación administrativa de emergencia | Inventado en propose; aceptado como decisión explícita | Única salida si nadie puede entrar. |
| Consultar la cuenta propia | Inventado en propose, derivado de la interfaz | La cabecera y los permisos visibles necesitan nombre y rol. |

**`audit-trail`**

| Requisito | Fuente | Motivo |
| --- | --- | --- |
| Cambios administrativos de acceso | CognitiveStack (`observability.md`: cambios de rol y permisos); ERS RNF-006 | El ERS RF-003 no lista usuarios; la obligación viene de CognitiveStack. |
| Registro atómico con el cambio | CognitiveStack (`observability.md`) | No hay cambio sin evento. |
| Sin secretos | CognitiveStack (`observability.md`); ERS SEC-004 | |
| Inmutable y aislada por empresa | CognitiveStack (solo agregado); ADR 0009 | |

Retirado en la revisión previa a S-1, por inventado o por ser configuración: el mínimo de
administradores ante concurrencia, los escenarios de correo con otra capitalización (ahora
regla técnica en D9), los valores 12–128 y 5/15 (ahora defaults en `hardening.md`), la
auditoría de intentos denegados y del cambio de contraseña propia (ahora eventos de
seguridad) y la IP en la auditoría.

Alcance de `audit-trail`: se mantiene como capacidad, pero mínima. ERS y CTX no exigen
auditar la administración de usuarios; CognitiveStack sí exige auditar cambios de rol y
permisos, y `add-taxpayer-setup` necesitará el mismo rastro para ERS RF-003, RF-105 y
SEC-007. Introducirlo aquí con cuatro requisitos evita crear dos mecanismos.
