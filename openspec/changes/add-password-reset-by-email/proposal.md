# Proposal

## Why

El propietario pidió (2026-10-24) una pantalla de ingreso más profesional, con el logo de EmiteYa,
y que quien olvidó su contraseña pueda recuperar su cuenta. Hoy la especificación prohíbe la
recuperación pública: solo un administrador puede poner una contraseña nueva, y el comando de
emergencia del servidor cubre al último administrador. El propietario eligió (2026-10-24) un enlace
por correo, enviado con el servidor de correo de la empresa del usuario.

## What Changes

- **Ingreso:** una tarjeta centrada con el logo y el nombre de EmiteYa, el correo, la contraseña,
  «Iniciar sesión» y el enlace «¿Olvidaste tu contraseña?». El diseño toma el de la tarjeta de
  ingreso de 21st.dev (`login-card-1`), rehecho con las primitivas del proyecto. No se instala el
  registro: reescribiría `button`, `card`, `input` y otras primitivas, y agregaría paquetes
  `@radix-ui/*` sin versión fija.
- **Recuperar la contraseña** (`/recuperar-contrasena`): pide el correo y siempre responde lo mismo,
  exista o no la cuenta. Si la cuenta tiene una membresía activa y una de sus empresas tiene el
  correo configurado y encendido, le llega un enlace de un solo uso que vence en 30 minutos.
- **Poner una contraseña nueva** (`/restablecer-contrasena`): con el enlace, la contraseña nueva y
  su confirmación, con la política de contraseñas. Al guardarla se cierran todas las sesiones de la
  cuenta. Un enlace vencido o usado lleva a pedir otro.
- **Seguridad:** el token se guarda con hash, viaja en el fragmento de la dirección (no llega al
  servidor en la navegación ni en el `Referer`), el envío corre en segundo plano para que el tiempo
  de respuesta no revele la cuenta, y hay límites por correo e IP. Cada solicitud y cada cambio deja
  un evento de seguridad, sin el correo en claro ni el token.
- La recuperación administrativa de emergencia sigue igual. Deja de decir «no existe recuperación
  pública».

## Capabilities

### Modified Capabilities

- `user-access`: requisito nuevo «Recuperación de la contraseña por correo»; «Recuperación
  administrativa de emergencia» deja la prohibición de la recuperación pública.

## Impact

- Backend: la configuración de Better Auth (dos endpoints más en la lista permitida, el envío del
  enlace y la política de contraseñas en el restablecimiento), un puerto de envío que `main.ts`
  compone con el módulo `email`, eventos de seguridad nuevos y sus pruebas con el servidor SMTP
  falso.
- Frontend: la pantalla de ingreso, dos pantallas nuevas en `(auth)` y las funciones del cliente de
  autenticación.
- Documentación: seguridad (control de acceso y modelo de amenazas), `backend.md`, `frontend.md` y
  el script de la política de seguridad.
- Sin migraciones: Better Auth usa su tabla `verification`.
