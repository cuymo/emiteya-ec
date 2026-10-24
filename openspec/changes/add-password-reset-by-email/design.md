# Design

## Context

La autenticación es Better Auth 1.7.7 (Q-41), con su superficie HTTP cerrada por una lista permitida
(`CLIENT_ENDPOINTS` en `identity/infrastructure/better-auth/auth.ts`): iniciar sesión, cerrar sesión
y cambiar la contraseña propia. El módulo `email` envía con el servidor SMTP de cada empresa
(ADR 0029), con la contraseña sellada en la bóveda y el interruptor `EMAIL_DELIVERY_ENABLED`. Un
usuario puede tener membresías en varias empresas.

## Decisions

### D1. La recuperación de Better Auth, no una propia

Better Auth trae `POST /request-password-reset` y `POST /reset-password`:
- responde lo mismo exista o no la cuenta, y simula el trabajo cuando no existe;
- el token es aleatorio (24 caracteres) y de un solo uso: se consume al restablecer;
- `revokeSessionsOnPasswordReset` borra todas las sesiones del usuario;
- `onPasswordReset` permite el evento de seguridad.

Configuración: `resetPasswordTokenExpiresIn: 1800` (30 minutos), `revokeSessionsOnPasswordReset:
true` y `verification.storeIdentifier: "hashed"`, para que la tabla `verification` no guarde el
token en claro. Los dos endpoints entran en la lista permitida. `GET /reset-password/:token`, que
redirige con el token en la consulta, queda cerrado.

### D2. El enlace va al frontend, con el token en el fragmento

`sendResetPassword` recibe el token y arma `{origen público}/restablecer-contrasena#token={token}`,
con el origen canónico de `BETTER_AUTH_URL`. El fragmento no viaja en la petición de la página ni en
el `Referer`, así que no queda en los registros del proxy. La pantalla lo lee, lo quita de la
dirección con `history.replaceState` y lo envía en el cuerpo de `POST /reset-password`.

### D3. Envío con el servidor de la empresa, en segundo plano

- **Puerto.** `identity` declara `PasswordResetMailer`, que recibe el correo de la cuenta, las
  empresas de sus membresías activas en orden de antigüedad y el enlace. `main.ts` lo compone con el
  módulo `email`, que expone `sendPasswordReset`. `identity` nunca importa `email`.
- **Empresa.** Se usa la primera empresa con el correo configurado. Sin ninguna, o con
  `EMAIL_DELIVERY_ENABLED=0`, no se envía nada.
- **Membresía.** Una cuenta sin membresía activa no recibe enlace: no podría iniciar sesión.
- **Tiempo.** `sendResetPassword` programa el envío con `setImmediate` y vuelve enseguida: el tiempo
  de la respuesta no depende de la cuenta, del servidor de correo ni del resultado. Un fallo del
  envío solo queda en el evento de seguridad.
- **Mensaje.** Asunto «Restablece tu contraseña de EmiteYa»; texto y HTML con el enlace, su
  vencimiento en 30 minutos y que, si no lo pidió, puede ignorarlo. Remitente: el de la empresa.
- **Pruebas.** El correo de recuperación va a la cuenta también en el ambiente de Pruebas: no es un
  comprobante, y la regla del correo de prueba solo aplica a los comprobantes.

### D4. Límites y política

- **Por correo e IP:** como mucho 3 solicitudes cada 15 minutos (en memoria, como el límite de
  inicio de sesión). Pasado el límite, la respuesta es la misma de siempre y no se envía nada, para
  no revelar la cuenta.
- **Por IP:** las reglas de Better Auth para los dos endpoints, 10 cada 15 minutos.
- **Contraseña nueva:** `POST /reset-password` aplica la misma política de contraseñas que el
  cambio de la contraseña propia (`PASSWORD_POLICY`).

### D5. Eventos de seguridad

Son registros y métricas, no auditoría, como el cambio de la contraseña propia:
- `password_reset_requested`, con su resultado: `sent`, `no_account`, `inactive_membership`,
  `no_mail_server`, `send_failed` o `throttled`;
- `password_reset_completed`, con el usuario y su empresa.

Nunca llevan el correo en claro, el token ni el enlace.

### D6. Pantallas

- **Ingreso** (`/iniciar-sesion`): tarjeta centrada de unos 24rem, sobre el fondo de la aplicación.
  Arriba, el logo y «EmiteYa»; el título «Iniciar sesión» y una línea de ayuda. Debajo, el correo,
  la contraseña con «¿Olvidaste tu contraseña?» debajo, alineado a la derecha (decisión del propietario, 2026-10-24), y «Iniciar sesión» a todo el ancho.
- **Recuperar** (`/recuperar-contrasena`): el correo y «Enviar enlace». Después, siempre el mismo
  mensaje: si el correo pertenece a una cuenta activa y su empresa tiene el correo configurado,
  llega un enlace que vence en 30 minutos; si no llega, un administrador puede ponerle una
  contraseña nueva. Incluye el enlace para volver al ingreso.
- **Restablecer** (`/restablecer-contrasena`): contraseña nueva y su confirmación. Sin token, o con
  uno vencido o usado, explica que el enlace ya no sirve y ofrece pedir otro. Al guardar, avisa que
  se cerraron las sesiones y lleva al ingreso.
- Las tres comparten la tarjeta (`AuthCard`) y no requieren sesión. Una sesión activa en el ingreso
  sigue llevando a la aplicación.

## Risks

- **Empresa sin correo.** Su gente no recibe enlace: la pantalla lo advierte y remite al
  administrador.
- **Varias instancias.** El límite por correo vive en la memoria de cada instancia, igual que el de
  inicio de sesión: es una defensa contra ráfagas, no un límite global.
