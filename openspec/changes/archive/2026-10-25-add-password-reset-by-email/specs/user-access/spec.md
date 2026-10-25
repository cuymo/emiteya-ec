## ADDED Requirements

### Requirement: Recuperación de la contraseña por correo
El sistema SHALL permitir que una persona sin sesión pida un enlace para poner una contraseña nueva, con su correo. La respuesta SHALL ser la misma exista o no la cuenta. El enlace SHALL llegar solo a una cuenta con membresía activa, con el servidor de correo de una de sus empresas, servir una sola vez y vencer en 30 minutos. Poner la contraseña nueva SHALL aplicar la política de contraseñas y cerrar todas las sesiones de la cuenta.

#### Scenario: Cuenta activa con correo configurado
- **WHEN** una persona pide recuperar la contraseña de una cuenta activa cuya empresa tiene el correo configurado
- **THEN** recibe en ese correo un enlace que vence en 30 minutos
- **AND** con el enlace pone una contraseña nueva, inicia sesión con ella y sus sesiones anteriores dejan de autorizar operaciones

#### Scenario: Correo sin cuenta
- **WHEN** alguien pide recuperar la contraseña de un correo que no pertenece a ninguna cuenta, o de una cuenta desactivada
- **THEN** ve la misma respuesta que con una cuenta activa
- **AND** no se envía ningún correo

#### Scenario: Empresa sin correo configurado
- **WHEN** un usuario activo pide recuperar su contraseña y ninguna de sus empresas tiene el correo configurado o el envío está apagado
- **THEN** ve la misma respuesta, que le recuerda que un administrador puede ponerle una contraseña nueva
- **AND** no se envía ningún correo

#### Scenario: Enlace usado o vencido
- **WHEN** alguien usa un enlace por segunda vez o después de 30 minutos
- **THEN** el sistema rechaza el cambio y ofrece pedir otro enlace

#### Scenario: Solicitudes repetidas
- **WHEN** se piden más de tres enlaces para el mismo correo desde la misma dirección en 15 minutos
- **THEN** la respuesta sigue siendo la misma y no se envían más correos

## MODIFIED Requirements

### Requirement: Recuperación administrativa de emergencia
El sistema SHALL ofrecer, como vía de recuperación sin correo cuando ningún administrador puede entrar, un comando de emergencia ejecutado en el servidor por el administrador técnico que establece una contraseña nueva para un usuario con rol Administrador y lo reactiva si estaba desactivado.

#### Scenario: Administrador sin acceso
- **WHEN** el administrador técnico ejecuta el comando de recuperación con el correo de un administrador y una contraseña válida
- **THEN** ese administrador queda activo y puede iniciar sesión con la contraseña nueva
- **AND** sus sesiones anteriores quedan invalidadas

#### Scenario: El correo no es de un administrador
- **WHEN** el administrador técnico ejecuta el comando con el correo de un operador o de una cuenta inexistente
- **THEN** el comando termina con error y nada cambia

#### Scenario: Sin vía remota
- **WHEN** alguien intenta ejecutar la recuperación administrativa a través de la API o de cualquier ruta HTTP
- **THEN** no existe ninguna operación que lo permita

#### Scenario: Sin recuperación pública por correo
- **WHEN** una persona sin sesión pide recuperar su contraseña por correo
- **THEN** solo existe la recuperación por correo con un enlace de un solo uso, que nunca establece una contraseña sin ese enlace ni reactiva una cuenta
