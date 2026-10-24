## MODIFIED Requirements

### Requirement: Consultar la cuenta propia
El sistema SHALL permitir a un usuario autenticado consultar su perfil: su nombre, su correo de
inicio de sesión, su rol y el estado de su membresía en la empresa activa, la empresa, desde cuándo
tiene su cuenta y si tiene un avatar. Cada usuario consulta solo su propio perfil.

#### Scenario: Consulta de la cuenta propia
- **WHEN** un operador autenticado consulta su cuenta
- **THEN** ve su nombre, su correo, el rol Operador, la empresa, el estado activo y desde cuándo tiene su cuenta
- **AND** la respuesta no contiene contraseñas, credenciales de sesión ni identificadores internos de autenticación

#### Scenario: Solo el perfil propio
- **WHEN** un administrador consulta su cuenta
- **THEN** recibe solo su propio perfil, y no existe ninguna operación para consultar el perfil de otro usuario por esta vía

## ADDED Requirements

### Requirement: Página de perfil
«Mi cuenta» SHALL presentarse como una página de perfil: una cabecera con el avatar, o las iniciales
sin avatar, el nombre, el correo y el rol, con insignias del rol y del estado y sus acciones; tres
pestañas, «Resumen», «Seguridad» y «Preferencias»; y un carril con el estado de la cuenta y la
empresa. El cambio de contraseña SHALL estar en «Seguridad» y el punto predeterminado en
«Preferencias».

#### Scenario: Perfil de un operador
- **WHEN** un operador abre Mi cuenta
- **THEN** ve su avatar o sus iniciales, su nombre, su correo, las insignias Operador y Activo, y las pestañas Resumen, Seguridad y Preferencias

#### Scenario: Sin avatar
- **WHEN** un usuario sin avatar abre Mi cuenta
- **THEN** la cabecera muestra sus iniciales en lugar de la imagen

#### Scenario: Correo sin cambio
- **WHEN** un usuario busca cambiar su correo de inicio de sesión en Mi cuenta
- **THEN** la página dice que el correo todavía no se puede cambiar, sin ofrecer ninguna operación para hacerlo

### Requirement: Cambiar el nombre propio
El sistema SHALL permitir a cualquier usuario autenticado con una membresía activa cambiar su propio
nombre, de 1 a 120 caracteres sin saltos de línea y sin espacios al inicio ni al final. El nombre
nuevo SHALL verse desde ese momento donde la aplicación muestra el nombre del usuario.

#### Scenario: Cambio exitoso
- **WHEN** un operador cambia su nombre de «Ana Ruiz» a «Ana María Ruiz»
- **THEN** su perfil, su menú de cuenta y la lista de Usuarios del administrador muestran «Ana María Ruiz»

#### Scenario: Nombre inválido
- **WHEN** un usuario intenta guardar un nombre vacío, de más de 120 caracteres o con un salto de línea
- **THEN** el sistema lo rechaza indicando el motivo y el nombre no cambia

#### Scenario: Mismo nombre
- **WHEN** un usuario guarda el mismo nombre que ya tiene, o el mismo con espacios al inicio o al final
- **THEN** el nombre no cambia y la operación termina sin error

#### Scenario: Solicitudes repetidas
- **WHEN** el mismo cambio de nombre llega dos veces, por un doble clic o un reintento
- **THEN** el nombre queda con el valor nuevo y el cambio se aplica una sola vez

#### Scenario: Sin cambiar a otro usuario
- **WHEN** un usuario, incluido un administrador, intenta cambiar el nombre de otro usuario por esta vía
- **THEN** no existe ninguna operación que lo permita

### Requirement: Avatar propio
El sistema SHALL permitir a cada usuario autenticado cargar, reemplazar y quitar su propio avatar:
una imagen PNG o JPEG, reconocida por su contenido, de un tamaño máximo configurable y de a lo sumo
4096 píxeles por lado.

#### Scenario: Cargar un avatar
- **WHEN** un usuario carga una imagen PNG válida dentro del tamaño máximo
- **THEN** su perfil muestra esa imagen como avatar

#### Scenario: Reemplazar y quitar
- **WHEN** un usuario carga otra imagen y después quita su avatar
- **THEN** el perfil muestra primero la imagen nueva y después sus iniciales

#### Scenario: Formato no admitido
- **WHEN** un usuario carga un SVG, un GIF o un archivo que dice ser PNG sin serlo
- **THEN** el sistema lo rechaza diciendo que se admiten PNG o JPEG, y el avatar no cambia

#### Scenario: Imagen demasiado grande
- **WHEN** un usuario carga una imagen que supera el tamaño máximo o los 4096 píxeles por lado
- **THEN** el sistema lo rechaza indicando el límite, y el avatar no cambia

#### Scenario: La misma imagen dos veces
- **WHEN** la carga de la misma imagen llega dos veces, por un doble clic o un reintento
- **THEN** el usuario queda con un solo avatar, esa imagen

### Requirement: Avatar privado del usuario
El avatar de un usuario SHALL verse solo en su propia página de perfil y dentro de su propio menú
de cuenta, junto a su nombre; el botón del menú en la barra superior no lo muestra. Ningún otro
usuario, de su empresa o de otra, con cualquier rol, SHALL poder consultarlo, cambiarlo, quitarlo ni
saber si existe.

#### Scenario: Menú de cuenta
- **WHEN** un usuario con avatar abre su menú de cuenta
- **THEN** ve su avatar junto a su nombre, su correo y su rol, y el botón de la barra superior sigue mostrando el icono del establecimiento

#### Scenario: Menú de cuenta sin avatar
- **WHEN** un usuario sin avatar abre su menú de cuenta
- **THEN** ve sus iniciales en el lugar del avatar

#### Scenario: Administrador de la misma empresa
- **WHEN** un administrador intenta consultar o quitar el avatar de un operador de su empresa
- **THEN** no existe ninguna operación que lo permita, y la lista de Usuarios no muestra avatares

#### Scenario: Otra empresa
- **WHEN** un usuario de la empresa B intenta consultar el avatar de un usuario de la empresa A
- **THEN** no existe ninguna operación que lo permita, y nada en la respuesta revela si ese avatar existe
