# Proposal

## Why

«Mi cuenta» es hoy una lista corta de datos de solo lectura y un formulario de contraseña: la persona
no puede corregir cómo se llama en el sistema ni reconocer su cuenta de un vistazo. El propietario
pidió convertirla en una página de perfil, con el diseño de su ejemplo (cabecera con avatar, nombre,
correo y rol, insignias, acciones, pestañas y un carril con el estado de la cuenta), donde cada
usuario, administrador u operador, edite su nombre, cargue su foto y cambie su contraseña.

## What Changes

- «Mi cuenta» pasa a ser una página de perfil: cabecera con el avatar (o las iniciales), el nombre,
  el correo de inicio de sesión y el rol, con insignias del rol y del estado de la cuenta y las
  acciones de la cabecera; pestañas «Resumen», «Seguridad» y «Preferencias»; y un carril con el
  estado de la cuenta y la empresa.
- Nuevo: cada usuario autenticado puede cambiar su propio nombre. El cambio queda en la auditoría y
  el nombre nuevo se ve en el resto de la aplicación (la barra superior, la lista de Usuarios).
- Nuevo: cada usuario puede cargar, reemplazar y quitar su propio avatar (PNG o JPEG, con un tamaño
  máximo configurable). El avatar se ve solo en su página de perfil y dentro de su propio menú de
  cuenta, junto a su nombre (decisión del propietario, 2026-10-24): nadie más lo consulta, ni otro
  usuario de su empresa, ni un administrador, ni otra empresa.
- El cambio de contraseña, que ya existe, se integra sin cambios en la pestaña «Seguridad».
- El punto de emisión predeterminado, que ya existe, se integra sin cambios en «Preferencias».

## Orden

El propietario pidió primero el avatar (2026-10-24): la inspección compartida, sus datos, su API, la
consulta del perfil que da su versión, la foto en la «Mi cuenta» actual y el avatar en el menú de
cuenta. El cambio del nombre y la página de perfil con pestañas siguen después, en este mismo cambio.

## Fuera de alcance

- Cambiar el correo de inicio de sesión: queda pospuesto hasta que el sistema envíe correos y pueda
  confirmar el correo nuevo (decisión del propietario, 2026-10-23; Q-24). Ni el usuario ni un
  administrador pueden cambiarlo en este cambio.
- Mostrar el avatar fuera del perfil y del menú de cuenta: ni en el botón de la barra superior, que
  conserva el icono del establecimiento, ni en la lista de Usuarios, ni en los comprobantes o el RIDE
  (decisiones del propietario, 2026-10-23 y 2026-10-24).
- Que un administrador cambie el nombre o el avatar de otro usuario.
- Incluir el avatar en el paquete de portabilidad: el paquete conserva de los usuarios solo su
  nombre, su correo, su rol y su estado.
- Recorte, rotación o edición de la imagen en el navegador.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `user-access`: la consulta de la cuenta propia se presenta como una página de perfil; se agregan el
  cambio del nombre propio y el avatar propio, privado del usuario.
- `audit-trail`: se audita el cambio del nombre propio. El avatar, de uso solo personal, no se
  audita.

## Impact

- **Backend (identidad):** operaciones nuevas bajo `/api/v1/me` para consultar el perfil, cambiar el
  nombre y cargar, consultar y quitar el avatar; almacenamiento nuevo del avatar con su migración;
  una variable de configuración para su tamaño máximo; un evento de auditoría nuevo.
- **Backend (plataforma):** la inspección de imágenes PNG y JPEG que hoy usa el logo pasa a un módulo
  compartido de `platform/`, sin cambiar su comportamiento.
- **Contratos:** esquemas nuevos del perfil y del cambio de nombre en `packages/contracts`.
- **Frontend:** «Mi cuenta» rediseñada; la sesión se actualiza al cambiar el nombre.
- **Documentación:** API, arquitectura de la interfaz y la pantalla, seguridad (datos personales) y
  configuración del despliegue.
