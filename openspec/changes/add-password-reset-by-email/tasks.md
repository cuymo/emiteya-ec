## 1. Servidor

- [x] 1.1 Habilitar la recuperación de Better Auth con el token con hash de 30 minutos, el cierre de todas las sesiones, los dos endpoints en la lista permitida, la política de contraseñas, los límites por correo e IP y los eventos de seguridad; verificar con pruebas de la configuración, de la lista permitida y de los límites.
- [x] 1.2 Agregar el puerto `PasswordResetMailer` y `sendPasswordReset` del módulo `email`, compuestos en `main.ts`, con el envío en segundo plano y el mensaje; verificar con pruebas de integración con el servidor SMTP falso: enlace recibido, contraseña nueva, sesiones cerradas, un solo uso, vencimiento, cuenta inexistente o desactivada y empresa sin correo.

## 2. Pantallas

- [x] 2.1 Rediseñar el ingreso como una tarjeta con el logo y «¿Olvidaste tu contraseña?», y agregar `/recuperar-contrasena` y `/restablecer-contrasena`; verificar con pruebas de las tres pantallas.

## 3. Documentación y revisión

- [ ] 3.1 Actualizar la seguridad, `backend.md`, `frontend.md` y el script de la política de seguridad, y revisar las pantallas en escritorio y teléfono.
