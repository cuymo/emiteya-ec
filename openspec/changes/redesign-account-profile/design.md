# Design

## Context

- «Mi cuenta» (`frontend/src/features/account/account-screen.tsx`) muestra nombre, correo y rol de
  solo lectura, el cambio de contraseña y el punto predeterminado (`default-point-section.tsx`).
- `GET /api/v1/me` devuelve solo `{ name, email, role }` (`meSchema`, objeto estricto) y la sesión
  del frontend lo usa en toda la aplicación (barra superior, permisos).
- El cambio de contraseña pasa por Better Auth (`/change-password`), con las otras sesiones
  revocadas; es un evento de seguridad, no de auditoría. Better Auth tiene cerrados `/update-user` y
  `/change-email`, y no hay envío de correos (Q-24).
- La tabla de usuarios tiene un `image` de texto sin uso. No existe almacenamiento de imágenes por
  usuario; el logo de la empresa usa activos de configuración versionados por empresa
  (`ConfigurationAsset`) y la inspección de PNG/JPEG de `taxpayer/domain/logo.ts`.
- La política de seguridad del navegador solo admite imágenes del mismo origen (`img-src 'self'`).

## Goals / Non-Goals

**Goals:**

- Una página de perfil con el diseño del ejemplo del propietario, adaptada a lo que el sistema sabe.
- El cambio del nombre propio y el avatar propio, con el usuario resuelto siempre desde la sesión.

**Non-Goals:**

- Un perfil público o visible para otros usuarios; un directorio de personas.
- Cambiar `GET /api/v1/me` ni la forma de la sesión del frontend más allá del nombre actualizado.

## Decisions

### D1. Operaciones bajo `/api/v1/me`, sin identificadores en la ruta

- `GET /me/profile`: nombre, correo, rol, estado de la membresía, `memberSince` (fecha de alta de la
  identidad) y `avatar: { version } | null`, donde `version` son los primeros 16 caracteres del
  SHA-256 de la imagen, para la URL de la imagen.
- `PUT /me/name` con `{ name }`: devuelve el perfil.
- `PUT /me/avatar` con la imagen como cuerpo binario (`image/png` o `image/jpeg`, `express.raw`,
  como el logo); `DELETE /me/avatar`; `GET /me/avatar` sirve la imagen.
- El usuario sale siempre del contexto de la sesión: no hay id en la ruta ni en el cuerpo, así que
  cambiar un id no alcanza a otra cuenta.
- Alternativa descartada: ampliar `GET /me`. Obligaría a cambiar `meSchema` y todos sus usos y
  fixtures por datos que solo usa el perfil.

### D2. Permiso `account.updateProfile` para los dos roles

- Se agrega a `PERMISSIONS` y a los roles Administrador y Operador, como `account.changePassword`.
- Exige una membresía activa en la empresa activa de la sesión, igual que `account.read`.

### D3. Nombre: compara y cambia en una transacción, con su auditoría

- Valida con `userNameSchema` (1 a 120, recortado) más un rechazo explícito de saltos de línea.
- En una transacción: bloquea la fila del usuario, compara el nombre recortado con el vigente; si es
  igual, termina sin cambio ni evento; si no, actualiza y escribe el evento `user.name_changed`
  (`changes: { name: { from, to } }`, actor y afectado el usuario, empresa la activa).
- Dos solicitudes iguales a la vez: la segunda encuentra el nombre ya cambiado y no hace nada, así
  que hay un solo cambio y un solo evento (idempotencia natural por comparación, sin clave).
- Alternativa descartada: abrir `/update-user` de Better Auth. No escribe la auditoría en la misma
  transacción ni respeta el contexto de membresía.

### D4. Avatar: tabla propia por usuario, una fila como máximo

- Tabla nueva con la identidad como clave primaria (relación con borrado en cascada): contenido
  binario, tipo, tamaño, SHA-256 y momento de actualización. Una fila por usuario: reemplazar
  sobrescribe, quitar borra.
- Se descarta `ConfigurationAsset`: es de la empresa, versionado e inmutable; el avatar es de la
  persona, no tiene historial y no se audita. Se descarta el campo `image`: es texto y Better Auth lo
  expone en sus respuestas.
- `PUT` con la misma imagen (mismo SHA-256) no cambia nada. La carga es un upsert sobre la clave
  primaria, así que dos cargas a la vez dejan una sola fila (la última).
- Tamaño máximo: variable `AVATAR_MAX_BYTES`, por defecto 512 KB, entre 16 KB y 2 MB, como el logo.

### D5. La inspección de imágenes pasa a `platform/`

- `inspectLogo` y sus constantes de formato y dimensión pasan a `backend/src/platform/images/` como
  una inspección genérica de PNG/JPEG (por contenido, máximo 4096 px por lado). El logo y el avatar
  la usan; el comportamiento del logo no cambia y sus pruebas siguen pasando.

### D6. Servir la imagen solo a su dueño

- `GET /me/avatar`: `404` sin avatar; con avatar, el contenido con su tipo,
  `Cache-Control: private, no-cache`, `ETag` con el SHA-256 y `X-Content-Type-Options: nosniff`.
- No existe otra ruta que lea un avatar, y la lista de Usuarios y la portabilidad no lo incluyen.
- El frontend usa `<img src="/api/v1/me/avatar?v=<version>">`: mismo origen, sin `blob:` ni
  `data:`, así que la política de seguridad no cambia.

### D7. Reducir la imagen en el navegador antes de subirla

- Las fotos de un teléfono suelen superar el máximo. Antes de subirla, el navegador la reduce a
  512 px por el lado mayor con `createImageBitmap` y un `canvas`, y la vuelve a codificar (PNG se
  queda en PNG, por la transparencia; lo demás, JPEG). El servidor valida igual.
- Sin `createImageBitmap` (pruebas con jsdom, navegadores antiguos) se sube el archivo tal cual y
  manda el límite del servidor.
- No es edición: no hay recorte ni rotación (fuera de alcance).

### D8. Página de perfil

Brief de la pantalla:

1. **Quién:** cualquier usuario, Administrador u Operador; uso ocasional; en escritorio primero.
2. **Para qué:** confirmar con qué cuenta trabaja y corregir su nombre, su foto, su contraseña o su
   punto predeterminado.
3. **Decisión principal:** si los datos de su cuenta son correctos y qué actualizar.
4. **Información mínima:** nombre, correo, rol, estado y empresa.
5. **Acción principal:** «Editar perfil» en la cabecera (el nombre); en «Seguridad», «Cambiar
   contraseña».

- **Si se equivoca:** el nombre se corrige otra vez; el avatar se reemplaza o se quita; la
  contraseña pide la actual. Ninguna acción es irreversible: sin confirmaciones, con avisos.
- **Después de actuar:** un aviso y el dato nuevo a la vista (el nombre también en la barra
  superior).
- **Niveles:** P0 el avatar o las iniciales, el nombre y las insignias del rol y del estado; P1 el
  correo, la empresa y «Cuenta desde»; P2 el punto predeterminado y el formulario de contraseña, en
  sus pestañas; P3 nada.
- **Composición** (ejemplo del propietario):
  - Cabecera a todo el ancho: el avatar en un círculo grande con «Cambiar foto» y «Quitar foto»; el
    nombre (`h1`), «correo · rol»; insignias del rol y «Activo»; a la derecha, «Editar perfil»
    (`FormDialog` con el nombre).
  - Pestañas (`Tabs`, con `?pestana=` en la dirección): «Resumen» (los datos de la cuenta en una
    rejilla de etiqueta y valor, como «Work details»), «Seguridad» (el cambio de contraseña y la nota
    de que el correo todavía no se puede cambiar) y «Preferencias» (el punto predeterminado).
  - Carril de 20rem a la derecha desde 57,5rem (debajo en pantallas angostas): «Estado de la cuenta»
    (Activa, el rol y lo que permite) y «Empresa» (su nombre y el ambiente).
- **Componentes:** `Avatar`, `Badge`, `Tabs`, `FormDialog`, `FormField` con sus ayudas en tooltip,
  `PasswordField` y `DefaultPointSection` existentes. El avatar se carga con un botón y un
  `<input type="file">` oculto, como el logo.
- **Estados:** carga (esqueleto de la cabecera), error con reintento, sin avatar (iniciales),
  guardando, éxito (aviso), errores del servidor junto al campo. Solo tema claro (decisión del
  propietario, 2026-10-22). Teclado: las pestañas con flechas; «Cambiar foto» y «Quitar foto»
  enfocables.

### D9. Sesión y nombre

- Al guardar el nombre, el frontend invalida la consulta de la sesión (`/me`) y la del perfil: la
  barra superior y el menú de cuenta muestran el nombre nuevo sin recargar.

## Operaciones sensibles

| Pregunta | Nombre propio | Avatar propio |
| --- | --- | --- |
| ¿Quién? | Cualquier usuario con membresía activa y `account.updateProfile` | Igual |
| Inquilino del llamador | La empresa activa de la sesión | Igual |
| Inquilino del recurso | La identidad es del usuario; el evento, de la empresa activa | El avatar es de la identidad; no pertenece a una empresa |
| Propiedad | El usuario sale de la sesión; no hay id en la solicitud | Igual |
| ¿Un id alcanza otra cuenta? | No: no hay id | No: no hay id |
| Dos veces | La segunda no cambia nada ni audita | La misma imagen no cambia nada |
| A la vez | Fila bloqueada: un cambio por valor distinto, cada uno con su evento | Upsert por clave primaria: una sola fila |
| Idempotencia | Natural, por comparación | Natural, por SHA-256 |
| Restricciones | Longitud y formato validados; correo y unicidad sin tocar | Clave primaria por usuario; tipo y tamaño validados antes de escribir |
| Auditoría | `user.name_changed`, en la misma transacción | No (decisión del propietario: uso solo personal) |
| Pruebas de autorización | Sin sesión `401`; sin membresía activa `403`; sin rutas con id | Igual, y que otro usuario o empresa no lee ni detecta un avatar |
| Fugas | Ninguna: solo devuelve el perfil propio | Solo `GET /me/avatar` lo sirve, a su dueño; no está en Usuarios ni en la portabilidad |

## Risks / Trade-offs

- [Un usuario con varias empresas cambia su nombre en todas] → La identidad es una sola; el evento
  queda en la empresa activa, que es donde actuó.
- [Un avatar grande ocupa la base de datos] → Máximo configurable de 2 MB y reducción en el
  navegador a 512 px; una fila por usuario.
- [El avatar de un usuario desactivado sigue guardado] → Nadie lo ve; se borra en cascada si la
  identidad se elimina, y el usuario puede quitarlo al volver.
- [Se agrega un evento de auditoría que no es de acceso] → Requisito propio en `audit-trail`, sin
  ampliar el de los cambios administrativos.

## Migration Plan

- Una migración de Prisma agrega la tabla del avatar; no toca datos existentes.
- Variable nueva `AVATAR_MAX_BYTES` con valor por defecto: el despliegue no necesita configurarla.
- Reversión: revertir el código y la migración borra la tabla y con ella los avatares cargados; nada
  más depende de ella.
