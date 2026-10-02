# Spec Delta

## Purpose

Controla quién entra al facturador y qué puede hacer dentro de su empresa: identidad,
membresía con rol por empresa, sesión, administración de usuarios y credenciales sin correo,
y un contexto de autorización que solo el servidor determina.

## ADDED Requirements

### Requirement: Sin registro público
El sistema SHALL impedir que cualquier persona cree una cuenta por sí misma. Solo el aprovisionamiento de la instalación, un administrador o el administrador técnico desde el servidor pueden dar de alta una identidad.

#### Scenario: Intento de registro sin sesión
- **WHEN** una persona sin sesión intenta registrar una cuenta con correo y contraseña
- **THEN** el sistema rechaza la solicitud
- **AND** no existe ninguna cuenta nueva con ese correo

#### Scenario: Intento de registro de un usuario autenticado
- **WHEN** un operador con sesión intenta registrar otra cuenta por la vía de registro
- **THEN** el sistema rechaza la solicitud
- **AND** no existe ninguna cuenta nueva

### Requirement: Aprovisionamiento inicial de la instalación
Cuando la instalación aún no tiene empresa, el sistema SHALL crear, a partir de la configuración del servidor y en una sola operación, la empresa de la instalación sin datos tributarios y no preparada para emitir, el administrador inicial y su membresía con rol Administrador.

#### Scenario: Primer arranque
- **WHEN** el sistema arranca por primera vez con un correo y una contraseña de administrador inicial válidos en su configuración
- **THEN** existe exactamente una empresa, no preparada para emitir
- **AND** existe un usuario con ese correo y una membresía activa con rol Administrador en esa empresa
- **AND** ese usuario puede iniciar sesión con esa contraseña

#### Scenario: Arranques posteriores
- **WHEN** el sistema arranca de nuevo con una empresa ya aprovisionada, aunque la configuración del administrador inicial haya cambiado
- **THEN** no se crea otra empresa ni otro usuario
- **AND** la contraseña del administrador inicial no cambia

#### Scenario: Arranques simultáneos
- **WHEN** dos procesos del sistema arrancan al mismo tiempo sobre una instalación sin empresa
- **THEN** existe exactamente una empresa, un administrador inicial y una membresía

#### Scenario: Configuración inicial inválida
- **WHEN** el sistema arranca sin empresa y falta el correo del administrador inicial, o su contraseña no cumple la política de contraseñas
- **THEN** el sistema se niega a arrancar e indica qué configuración falta o es inválida, sin mostrar su valor
- **AND** no se crea ninguna empresa, usuario ni membresía

#### Scenario: Interrupción a mitad del aprovisionamiento
- **WHEN** el aprovisionamiento se interrumpe antes de terminar y el sistema vuelve a arrancar
- **THEN** el aprovisionamiento termina sin duplicar la empresa, el usuario ni la membresía

### Requirement: Inicio de sesión con correo y contraseña
El sistema SHALL abrir una sesión cuando un usuario con membresía activa presenta su correo y su contraseña correctos.

#### Scenario: Credenciales correctas
- **WHEN** un usuario con membresía activa inicia sesión con su correo y su contraseña
- **THEN** el sistema abre una sesión
- **AND** el usuario accede a la aplicación con el rol de su membresía

### Requirement: Fallas de inicio de sesión sin revelar cuentas
El sistema SHALL responder con el mismo mensaje genérico cuando el correo no existe, cuando la contraseña es incorrecta y cuando el usuario está desactivado, sin revelar cuál de los tres casos ocurrió.

#### Scenario: Contraseña incorrecta
- **WHEN** alguien inicia sesión con un correo existente y una contraseña incorrecta
- **THEN** el sistema rechaza el inicio de sesión con el mensaje genérico
- **AND** no se abre ninguna sesión

#### Scenario: Correo inexistente
- **WHEN** alguien inicia sesión con un correo que no pertenece a ninguna cuenta
- **THEN** el sistema responde con el mismo mensaje genérico que ante una contraseña incorrecta

#### Scenario: Usuario desactivado
- **WHEN** un usuario desactivado inicia sesión con su contraseña correcta
- **THEN** el sistema responde con el mismo mensaje genérico
- **AND** no se abre ninguna sesión

### Requirement: Protección contra intentos repetidos de autenticación
El sistema SHALL limitar temporalmente los intentos de inicio de sesión fallidos repetidos según una política configurable de intentos y ventana, para frenar la adivinación de contraseñas.

#### Scenario: Umbral superado
- **WHEN** se supera el número de intentos fallidos configurado dentro de la ventana configurada
- **THEN** el sistema rechaza los intentos siguientes hasta que termine la ventana, incluso con la contraseña correcta
- **AND** el mensaje indica que se intente más tarde, sin revelar si la cuenta existe

#### Scenario: Por debajo del umbral
- **WHEN** los intentos fallidos no alcanzan el umbral configurado
- **THEN** un inicio de sesión con credenciales correctas se acepta

### Requirement: Cierre de sesión
El sistema SHALL invalidar en el servidor la sesión del usuario que cierra sesión.

#### Scenario: Cerrar sesión
- **WHEN** un usuario cierra sesión
- **THEN** la sesión deja de autorizar cualquier operación protegida, aunque alguien reutilice su credencial de sesión

### Requirement: Acceso protegido con sesión y membresía activa
El sistema SHALL exigir una sesión válida y una membresía activa en la empresa para toda operación protegida.

#### Scenario: Sin sesión
- **WHEN** una persona sin sesión solicita una operación protegida
- **THEN** el sistema la rechaza por falta de autenticación
- **AND** no revela datos de la empresa

#### Scenario: Identidad sin membresía activa
- **WHEN** una identidad autenticada sin membresía activa en ninguna empresa solicita una operación protegida
- **THEN** el sistema la rechaza
- **AND** no revela datos de ninguna empresa

### Requirement: Contexto de autorización derivado en el servidor
El sistema SHALL determinar el usuario, la empresa y el rol de cada operación protegida exclusivamente a partir de la sesión autenticada y de la membresía vigente. Los valores de empresa o rol enviados por el cliente nunca alteran ese contexto.

#### Scenario: El cliente envía otra empresa
- **WHEN** un usuario de la empresa A envía una operación protegida que indica la empresa B en el cuerpo, la consulta o una cabecera
- **THEN** el sistema evalúa la operación en la empresa A
- **AND** en una escritura, un campo de empresa en el cuerpo hace que la solicitud se rechace sin efectos

#### Scenario: El cliente se atribuye otro rol
- **WHEN** un operador envía una operación reservada al administrador indicando el rol Administrador en el cuerpo, la consulta o una cabecera
- **THEN** el sistema la rechaza por falta de permiso
- **AND** nada cambia

#### Scenario: Cambio de rol durante una sesión abierta
- **WHEN** un administrador cambia el rol de un usuario que tiene una sesión abierta
- **THEN** la siguiente operación protegida de ese usuario se evalúa con el rol nuevo

### Requirement: Aislamiento de usuarios por empresa
El sistema SHALL tratar los usuarios y membresías de otra empresa como inexistentes para cualquier usuario que no pertenezca a ella.

#### Scenario: Consultar un usuario de otra empresa
- **WHEN** un administrador de la empresa A solicita un usuario cuya membresía pertenece a la empresa B
- **THEN** el sistema responde como si el usuario no existiera

#### Scenario: Modificar un usuario de otra empresa
- **WHEN** un administrador de la empresa A intenta cambiar el rol, desactivar, reactivar o establecer la contraseña de un usuario de la empresa B
- **THEN** el sistema responde como si el usuario no existiera
- **AND** el usuario de la empresa B no cambia

#### Scenario: Listar usuarios
- **WHEN** un administrador de la empresa A consulta los usuarios
- **THEN** solo aparecen usuarios con membresía en la empresa A

### Requirement: Administración de usuarios reservada al administrador
El sistema SHALL permitir consultar, crear, cambiar el rol, desactivar, reactivar y establecer la contraseña de usuarios solo a quien tiene rol Administrador en la empresa.

#### Scenario: Un operador intenta administrar usuarios
- **WHEN** un operador intenta consultar la lista de usuarios, crear uno, cambiar un rol, desactivar, reactivar o establecer una contraseña
- **THEN** el sistema rechaza la operación por falta de permiso
- **AND** nada cambia

### Requirement: Consultar los usuarios de la empresa
El sistema SHALL mostrar al administrador los usuarios de su empresa con su nombre, correo, rol y estado, con búsqueda por nombre o correo y paginación.

#### Scenario: Lista con usuarios activos y desactivados
- **WHEN** un administrador consulta los usuarios de su empresa
- **THEN** ve cada usuario con su nombre, correo, rol y estado activo o desactivado

#### Scenario: Búsqueda
- **WHEN** un administrador busca por parte del nombre o del correo
- **THEN** solo aparecen los usuarios de su empresa que coinciden

### Requirement: Crear un usuario
El sistema SHALL permitir al administrador crear un usuario con nombre, correo, contraseña inicial y rol, con una membresía activa en la empresa del administrador.

#### Scenario: Alta exitosa
- **WHEN** un administrador crea un usuario con nombre, correo, contraseña válida y rol Operador
- **THEN** el usuario existe con una membresía activa y rol Operador en la empresa del administrador
- **AND** puede iniciar sesión con esa contraseña

#### Scenario: Correo ya registrado
- **WHEN** un administrador crea un usuario con un correo que ya pertenece a una cuenta
- **THEN** el sistema rechaza el alta indicando que el correo ya está en uso
- **AND** no se crea ninguna cuenta ni membresía

#### Scenario: Datos inválidos
- **WHEN** un administrador crea un usuario sin nombre, con un correo con formato inválido o con un rol que no existe
- **THEN** el sistema rechaza el alta indicando el campo inválido
- **AND** no se crea nada

#### Scenario: Envío repetido
- **WHEN** la misma solicitud de alta llega dos veces
- **THEN** existe una sola cuenta y una sola membresía para ese correo
- **AND** la segunda solicitud informa que el correo ya está en uso

#### Scenario: Altas simultáneas con el mismo correo
- **WHEN** dos solicitudes de alta con el mismo correo llegan al mismo tiempo
- **THEN** exactamente una crea la cuenta y la otra se rechaza

### Requirement: Política de contraseñas
El sistema SHALL rechazar, en toda alta, cambio o restablecimiento de contraseña, las contraseñas que no cumplan la política de contraseñas configurada, que como mínimo fija una longitud mínima y una máxima, y SHALL permitir pegarlas en los campos de contraseña.

#### Scenario: Contraseña por debajo del mínimo configurado
- **WHEN** se intenta establecer una contraseña más corta que la longitud mínima configurada
- **THEN** el sistema la rechaza indicando la longitud mínima vigente
- **AND** la contraseña anterior no cambia

#### Scenario: Contraseña con la longitud mínima configurada
- **WHEN** se establece una contraseña con exactamente la longitud mínima configurada
- **THEN** el sistema la acepta

### Requirement: Cambiar el rol de un usuario
El sistema SHALL permitir al administrador asignar a otro usuario de su empresa el rol Administrador u Operador.

#### Scenario: Promover a administrador
- **WHEN** un administrador asigna el rol Administrador a un operador de su empresa
- **THEN** la membresía de ese usuario tiene rol Administrador

#### Scenario: Asignar el rol que ya tiene
- **WHEN** un administrador asigna a un usuario el rol que ya tiene, una o varias veces
- **THEN** el resultado es el mismo y no se registra un cambio de rol

#### Scenario: Cambiar el rol propio
- **WHEN** un administrador intenta cambiar su propio rol
- **THEN** el sistema lo rechaza
- **AND** su rol no cambia

### Requirement: Desactivar un usuario
El sistema SHALL permitir al administrador desactivar a otro usuario de su empresa. Un usuario desactivado pierde el acceso antes de su siguiente operación protegida, y sus registros y su auditoría se conservan.

#### Scenario: Desactivar a un usuario con sesión abierta
- **WHEN** un administrador desactiva a un operador que tiene una sesión abierta
- **THEN** la siguiente operación protegida de ese operador se rechaza
- **AND** el operador no puede volver a iniciar sesión

#### Scenario: Desactivar a un usuario ya desactivado
- **WHEN** un administrador desactiva a un usuario que ya está desactivado
- **THEN** el usuario sigue desactivado y no se registra un segundo cambio

#### Scenario: Desactivarse a sí mismo
- **WHEN** un administrador intenta desactivar su propia cuenta
- **THEN** el sistema lo rechaza y su cuenta sigue activa

#### Scenario: Los registros del usuario se conservan
- **WHEN** un administrador desactiva a un usuario
- **THEN** el usuario sigue apareciendo como desactivado en la lista
- **AND** la auditoría de sus acciones anteriores sigue atribuida a él

### Requirement: Reactivar un usuario
El sistema SHALL permitir al administrador reactivar a un usuario desactivado de su empresa, que recupera el acceso con su rol y su contraseña anteriores.

#### Scenario: Reactivación
- **WHEN** un administrador reactiva a un usuario desactivado
- **THEN** el usuario puede volver a iniciar sesión con su contraseña anterior y su rol anterior

#### Scenario: Reactivar a un usuario activo
- **WHEN** un administrador reactiva a un usuario que ya está activo
- **THEN** el usuario sigue activo y no se registra un cambio

### Requirement: Establecer la contraseña de otro usuario
El sistema SHALL permitir al administrador establecer una contraseña nueva para otro usuario de su empresa sin usar correo. La contraseña anterior deja de servir y las sesiones abiertas de ese usuario se invalidan.

#### Scenario: Restablecimiento por el administrador
- **WHEN** un administrador establece una contraseña nueva válida para un operador de su empresa
- **THEN** el operador puede iniciar sesión con la contraseña nueva y no con la anterior
- **AND** la siguiente operación protegida de cualquier sesión abierta del operador se rechaza

#### Scenario: Su propia contraseña
- **WHEN** un administrador intenta establecer su propia contraseña por esta vía
- **THEN** el sistema lo rechaza e indica que use el cambio de contraseña propio

### Requirement: Cambiar la contraseña propia
El sistema SHALL permitir a cualquier usuario autenticado cambiar su contraseña presentando la actual. Sus otras sesiones abiertas se invalidan.

#### Scenario: Cambio exitoso
- **WHEN** un usuario cambia su contraseña presentando la actual correcta y una nueva válida
- **THEN** puede iniciar sesión con la nueva y no con la anterior
- **AND** sus otras sesiones abiertas dejan de autorizar operaciones protegidas

#### Scenario: Contraseña actual incorrecta
- **WHEN** un usuario intenta cambiar su contraseña con una contraseña actual incorrecta
- **THEN** el sistema lo rechaza y la contraseña no cambia

### Requirement: Recuperación administrativa de emergencia
El sistema SHALL ofrecer, como única vía de recuperación sin correo cuando ningún administrador puede entrar, un comando de emergencia ejecutado en el servidor por el administrador técnico que establece una contraseña nueva para un usuario con rol Administrador y lo reactiva si estaba desactivado. No existe recuperación pública de contraseña.

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
- **WHEN** una persona sin sesión solicita recuperar su contraseña por correo
- **THEN** no existe ninguna operación de recuperación pública
- **AND** la pantalla de inicio de sesión indica que un administrador puede establecerle una contraseña nueva

### Requirement: Consultar la cuenta propia
El sistema SHALL permitir a un usuario autenticado consultar su nombre, su correo y su rol en la empresa.

#### Scenario: Consulta de la cuenta propia
- **WHEN** un operador autenticado consulta su cuenta
- **THEN** ve su nombre, su correo y el rol Operador
- **AND** la respuesta no contiene contraseñas, credenciales de sesión ni identificadores internos de autenticación
