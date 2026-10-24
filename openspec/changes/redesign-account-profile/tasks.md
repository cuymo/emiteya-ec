# Tasks

## 1. Inspección de imágenes compartida

- [x] 1.1 Mover la inspección de PNG/JPEG de `taxpayer/domain/logo.ts` a `backend/src/platform/images/` como inspección genérica (formato por contenido, 4096 px por lado), y hacer que el logo la use sin cambiar su comportamiento; verificar con las pruebas existentes del logo y unas pruebas unitarias nuevas de la inspección (PNG, JPEG, SVG, GIF, firma falsa, dimensiones excesivas).

## 2. Datos del avatar y configuración

- [x] 2.1 Agregar al esquema de Prisma la tabla del avatar (identidad como clave primaria con borrado en cascada, contenido binario, tipo, tamaño, SHA-256, momento) y su migración; verificar con `db:generate` y aplicando la migración en la base de pruebas.
- [ ] 2.2 Agregar `AVATAR_MAX_BYTES` a la configuración (por defecto 512 KB, entre 16 KB y 2 MB) y a `backend/.env.example`; verificar con las pruebas de configuración (valor por defecto y rango) y documentarla en `docs/architecture/deployment.md`.

## 3. Contratos y permiso

- [ ] 3.1 Agregar a `packages/contracts` los esquemas del perfil propio (`name`, `email`, `role`, `membershipStatus`, `memberSince`, `avatar: { version } | null`) y del cambio de nombre (`userNameSchema` sin saltos de línea), y regenerar el OpenAPI; verificar con las pruebas de contratos y `openapi:check`.
- [ ] 3.2 Agregar el permiso `account.updateProfile` a los roles Administrador y Operador en `access-policy.ts`; verificar con las pruebas de la política y documentarlo en `docs/security/access-control.md`.

## 4. API del perfil y del nombre propio

- [ ] 4.1 Implementar `GET /api/v1/me/profile` con el usuario de la sesión; verificar con pruebas de integración: perfil propio sin credenciales ni ids internos, `401` sin sesión, `403` sin membresía activa.
- [ ] 4.2 Implementar `PUT /api/v1/me/name` con compara y cambia en una transacción y el evento `user.name_changed` (anterior y nuevo); verificar con pruebas de integración: cambio exitoso visible en la lista de Usuarios, nombre inválido (vacío, largo, salto de línea), mismo nombre sin evento, dos solicitudes iguales a la vez con un solo evento, sin ruta para cambiar a otro usuario, y el evento en la empresa activa.

## 5. API del avatar propio

- [ ] 5.1 Implementar `PUT`, `GET` y `DELETE /api/v1/me/avatar` (cuerpo binario PNG/JPEG, inspección compartida, límite configurable, upsert por usuario, sin auditoría; `GET` con `private, no-cache`, `ETag` y `nosniff`); verificar con pruebas de integración: cargar, reemplazar, quitar, formato no admitido, tamaño y dimensiones excesivos, la misma imagen dos veces con una sola fila, cargas a la vez con una sola fila, `404` sin avatar.
- [ ] 5.2 Verificar el aislamiento con pruebas de integración: un administrador de la misma empresa y un usuario de otra empresa no pueden leer, cambiar, quitar ni detectar un avatar ajeno; la lista de Usuarios y el paquete de portabilidad no incluyen avatares; ningún evento de auditoría por el avatar.
- [ ] 5.3 Documentar las operaciones nuevas de `/api/v1/me` en la documentación de la API y el avatar como dato personal en `docs/security/` (quién lo ve, retención y exclusión de la portabilidad).

## 6. Avatar en la interfaz (primero, decisión del propietario, 2026-10-24)

- [ ] 6.1 Agregar en el frontend la consulta del perfil y las mutaciones del avatar (reducción a 512 px en el navegador con `createImageBitmap` y `canvas`, con el archivo tal cual como respaldo); verificar con pruebas unitarias de la API y de la reducción con su respaldo.
- [ ] 6.2 Agregar a la «Mi cuenta» actual la sección «Foto de perfil» (avatar o iniciales, «Cambiar foto» y «Quitar foto»); verificar con pruebas de componentes: sin avatar, con avatar, cargar, quitar, formato rechazado y tamaño excedido junto al control, y teclado.
- [ ] 6.3 Mostrar el avatar (o las iniciales) dentro del menú de cuenta, junto al nombre, leyendo el perfil solo al abrirlo; verificar con pruebas de componentes: con avatar, sin avatar, mientras carga y el botón de la barra superior sin avatar.

## 7. Página de perfil y nombre en la interfaz

- [ ] 7.1 Agregar en el frontend la mutación del nombre, invalidando la sesión al cambiarlo; verificar con pruebas unitarias.
- [ ] 7.2 Rediseñar «Mi cuenta» como página de perfil (cabecera con avatar o iniciales, «Cambiar foto» y «Quitar foto», nombre, «correo · rol», insignias del rol y «Activo», «Editar perfil»; pestañas Resumen, Seguridad y Preferencias con `?pestana=`; carril con el estado de la cuenta y la empresa), con el cambio de contraseña y el punto predeterminado existentes en sus pestañas; verificar con pruebas de componentes: carga, error con reintento, sin avatar, con avatar, editar el nombre (éxito, error junto al campo, el nombre nuevo en el menú de cuenta), la nota del correo, las pestañas con el teclado y la dirección, y el carril debajo en pantallas angostas.
- [ ] 7.3 Revisar la página con la lista de comprobación del frontend (`docs/quality/`) en escritorio y teléfono, solo tema claro, y documentar la pantalla y sus componentes en `docs/architecture/` (navegación y sistema de componentes); verificar con capturas.

## 8. Verificación

- [ ] 8.1 Ejecutar `corepack pnpm verify` y confirmar que pasa completo, incluidas las pruebas de integración del backend, `openapi:check` y la política de seguridad del navegador.
