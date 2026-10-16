# taxpayer-setup Specification

## Purpose

Configura a la empresa como contribuyente emisor: sus datos y atributos tributarios versionados,
su identidad tributaria, su logo, el ambiente SRI, sus establecimientos y puntos de emisión, el
punto predeterminado de cada usuario y la verificación de qué le falta para poder emitir.

## Requirements

### Requirement: Registro de los datos de la empresa
El sistema SHALL permitir que un administrador registre los datos de su empresa: RUC, razón social y dirección matriz como datos obligatorios, y nombre comercial, teléfono y correo como opcionales, junto con los atributos tributarios. Una configuración solo se guarda completa y válida: nunca queda guardada a medias.

#### Scenario: Primer registro
- **WHEN** un administrador registra por primera vez el RUC, la razón social, la dirección matriz y los atributos tributarios obligatorios de su empresa
- **THEN** la empresa tiene una configuración vigente con esos valores, en su versión 1
- **AND** el administrador ve esos valores al volver a consultar los datos de la empresa

#### Scenario: Falta un dato obligatorio
- **WHEN** un administrador intenta guardar los datos sin la razón social
- **THEN** el sistema rechaza la solicitud e indica el campo que falta
- **AND** la configuración vigente no cambia

#### Scenario: Datos opcionales vacíos
- **WHEN** un administrador guarda los datos sin nombre comercial, teléfono ni correo
- **THEN** la configuración se guarda y esos campos quedan vacíos

### Requirement: Formatos conforme a los esquemas oficiales
El sistema SHALL validar el formato y la longitud de cada dato de la empresa conforme a los XSD oficiales vigentes del SRI: RUC de 13 dígitos terminado en `001`; razón social, nombre comercial y dirección matriz de 1 a 300 caracteres sin saltos de línea; número de contribuyente especial de 3 a 13 caracteres alfanuméricos; número de resolución de agente de retención de hasta 8 dígitos. No rechaza un RUC por un algoritmo de dígito verificador.

#### Scenario: RUC con formato inválido
- **WHEN** un administrador guarda un RUC de 12 dígitos, uno con letras o uno de 13 dígitos que no termina en `001`
- **THEN** el sistema rechaza la solicitud e indica el formato esperado

#### Scenario: RUC con formato válido
- **WHEN** un administrador guarda un RUC de 13 dígitos terminado en `001`, aunque no supere un cálculo local de dígito verificador
- **THEN** el sistema acepta el RUC

#### Scenario: Límite de longitud de un texto
- **WHEN** un administrador guarda una razón social de 300 caracteres
- **THEN** el sistema la acepta
- **AND** si guarda una de 301 caracteres, el sistema la rechaza e indica el máximo

#### Scenario: Salto de línea en un texto
- **WHEN** un administrador guarda una dirección matriz que contiene un salto de línea
- **THEN** el sistema rechaza la solicitud e indica el campo

#### Scenario: Número de resolución de agente de retención inválido
- **WHEN** un administrador declara como número de resolución de agente de retención un valor con letras o de 9 dígitos
- **THEN** el sistema rechaza la solicitud e indica el formato esperado

#### Scenario: Correo inválido
- **WHEN** un administrador guarda un correo de la empresa sin formato de correo electrónico
- **THEN** el sistema rechaza la solicitud e indica el campo

### Requirement: Atributos tributarios declarados por el administrador
El sistema SHALL guardar los atributos tributarios tal como los declara el administrador, sin inferirlos de otros datos: obligado a llevar contabilidad, que debe declararse explícitamente como sí o no; y número de contribuyente especial, número de resolución de agente de retención, gran contribuyente, categoría RIMPE (Emprendedor o Negocio popular) y RUC proveedor, que solo existen si el administrador los declara.

#### Scenario: Obligado a llevar contabilidad sin declarar
- **WHEN** un administrador guarda los datos sin indicar si la empresa está obligada a llevar contabilidad
- **THEN** el sistema rechaza la solicitud e indica que debe declararse

#### Scenario: Atributos opcionales no declarados
- **WHEN** un administrador guarda los datos sin declarar contribuyente especial, agente de retención, gran contribuyente, categoría RIMPE ni RUC proveedor
- **THEN** la configuración vigente no contiene ninguno de esos atributos
- **AND** el sistema no los completa a partir del RUC ni de ningún otro dato

#### Scenario: RUC proveedor
- **WHEN** un administrador no declara un RUC proveedor
- **THEN** el RUC proveedor queda vacío y el sistema nunca lo llena con un valor propio ni ficticio
- **AND** si lo declara, el sistema exige el mismo formato que el RUC de la empresa

### Requirement: Historial inmutable de la configuración
El sistema SHALL crear una versión nueva e inmutable de la configuración tributaria con cada cambio exitoso de los datos, los atributos, el logo o el ambiente, numerada de forma consecutiva por empresa. La versión vigente es la última; las anteriores se conservan íntegras para que los comprobantes puedan referenciar la versión con que se emitieron.

#### Scenario: Corrección de un dato
- **WHEN** un administrador corrige la dirección matriz de una empresa cuya configuración vigente es la versión 2
- **THEN** la configuración vigente pasa a ser la versión 3 con la dirección nueva
- **AND** la versión 2 conserva la dirección anterior

#### Scenario: Guardado sin cambios
- **WHEN** un administrador guarda los mismos valores de la configuración vigente
- **THEN** no se crea una versión nueva

#### Scenario: Versiones anteriores intactas
- **WHEN** cualquier usuario, incluido un administrador, intenta modificar o eliminar una versión de la configuración
- **THEN** no existe ninguna operación que lo permita y la versión permanece intacta

### Requirement: Cambios concurrentes de la configuración
El sistema SHALL rechazar un cambio de la configuración tributaria preparado sobre una versión que ya no es la vigente, sin sobrescribir la versión vigente, salvo que el cambio pida exactamente los valores vigentes.

#### Scenario: Dos administradores editan a la vez
- **WHEN** dos administradores parten de la versión 3 y ambos guardan valores distintos
- **THEN** el primer cambio crea la versión 4
- **AND** el segundo se rechaza con un conflicto que pide recargar los datos, y la versión 4 no cambia

#### Scenario: Envío repetido
- **WHEN** un administrador envía dos veces el mismo cambio preparado sobre la versión 3
- **THEN** existe una sola versión nueva con esos valores
- **AND** el segundo envío responde con la configuración vigente sin crear otra versión

### Requirement: Corrección del RUC mientras la identidad tributaria no esté bloqueada
El sistema SHALL permitir que un administrador corrija el RUC de su empresa mientras la identidad tributaria de la empresa no esté bloqueada, y SHALL mostrar al administrador si está bloqueada o no.

#### Scenario: Corrección del RUC sin bloqueo
- **WHEN** un administrador corrige el RUC de una empresa cuya identidad tributaria no está bloqueada
- **THEN** la configuración vigente pasa a una versión nueva con el RUC corregido
- **AND** la versión anterior conserva el RUC anterior

#### Scenario: Empresa nueva
- **WHEN** un administrador consulta los datos de una empresa que todavía no ha emitido nada
- **THEN** el sistema indica que la identidad tributaria no está bloqueada y que el RUC puede corregirse

### Requirement: RUC inmutable con la identidad tributaria bloqueada
Una vez bloqueada la identidad tributaria de una empresa, el sistema SHALL rechazar cualquier cambio de su RUC, por cualquier operación y para cualquier usuario, y SHALL mantener el bloqueo de forma permanente. Los demás datos siguen siendo corregibles. Usar otro RUC exige otra empresa.

#### Scenario: Intento de cambiar el RUC bloqueado
- **WHEN** un administrador intenta cambiar el RUC de una empresa con la identidad tributaria bloqueada
- **THEN** el sistema rechaza la solicitud y explica que el RUC ya no puede cambiar en esta empresa
- **AND** la configuración vigente no cambia

#### Scenario: Corrección de otros datos con el RUC bloqueado
- **WHEN** un administrador corrige la dirección matriz de una empresa con la identidad tributaria bloqueada
- **THEN** la configuración vigente pasa a una versión nueva con la dirección corregida y el mismo RUC

#### Scenario: El bloqueo no se revierte
- **WHEN** cualquier usuario, incluido un administrador, intenta desbloquear la identidad tributaria de su empresa
- **THEN** no existe ninguna operación que lo permita y la identidad sigue bloqueada

### Requirement: Carga y reemplazo del logo
El sistema SHALL permitir que un administrador cargue o reemplace el logo de una empresa con datos registrados, en un formato de imagen admitido, reconocido por su contenido y no por el nombre ni por el tipo declarado, y dentro de los límites de tamaño configurados. Cargar o reemplazar el logo crea una versión nueva de la configuración; las versiones anteriores conservan el logo que tenían.

#### Scenario: Carga de un logo válido
- **WHEN** un administrador carga una imagen en un formato admitido y dentro de los límites
- **THEN** la configuración vigente pasa a una versión nueva con ese logo
- **AND** el administrador puede ver el logo vigente

#### Scenario: Contenido que no corresponde a un formato admitido
- **WHEN** un administrador carga un archivo declarado como una imagen admitida cuyo contenido no corresponde a ningún formato admitido
- **THEN** el sistema rechaza el archivo e indica los formatos admitidos
- **AND** la configuración vigente no cambia

#### Scenario: Logo demasiado grande
- **WHEN** un administrador carga una imagen que supera un límite configurado
- **THEN** el sistema rechaza el archivo e indica el límite
- **AND** la configuración vigente no cambia

#### Scenario: Reemplazo del logo
- **WHEN** un administrador reemplaza el logo de la versión 4 por otro
- **THEN** la versión 5 tiene el logo nuevo
- **AND** la versión 4 conserva el logo anterior con su contenido intacto

#### Scenario: Mismo logo otra vez
- **WHEN** un administrador carga una imagen idéntica al logo vigente
- **THEN** no se crea una versión nueva

#### Scenario: Logo sin datos registrados
- **WHEN** un administrador intenta cargar un logo antes de registrar los datos de la empresa
- **THEN** el sistema rechaza la solicitud e indica que primero deben registrarse los datos

### Requirement: Eliminación del logo
El sistema SHALL permitir que un administrador elimine el logo vigente creando una versión nueva de la configuración sin logo, sin borrar el logo de las versiones anteriores.

#### Scenario: Eliminación del logo
- **WHEN** un administrador elimina el logo de la versión 5
- **THEN** la versión 6 no tiene logo
- **AND** la versión 5 conserva su logo con su contenido intacto

#### Scenario: Eliminación sin logo vigente
- **WHEN** un administrador elimina el logo de una configuración que no tiene logo
- **THEN** no se crea una versión nueva

### Requirement: Ambiente SRI
El sistema SHALL mantener para cada empresa un ambiente SRI, `Pruebas` o `Producción`, que es `Pruebas` mientras un administrador no lo cambie. El ambiente solo cambia con una operación explícita y separada de la edición de los datos, una vez registrados los datos, y cada cambio crea una versión nueva de la configuración.

#### Scenario: Ambiente inicial
- **WHEN** se consulta el ambiente de una empresa recién aprovisionada o de una cuyo ambiente nunca se cambió
- **THEN** el ambiente es `Pruebas`

#### Scenario: Paso a Producción
- **WHEN** un administrador confirma explícitamente el cambio del ambiente a `Producción`
- **THEN** la configuración vigente pasa a una versión nueva con el ambiente `Producción` y los mismos datos

#### Scenario: Cambio cancelado
- **WHEN** un administrador inicia el cambio a `Producción` y no lo confirma
- **THEN** el ambiente sigue siendo `Pruebas`

#### Scenario: La edición de datos no cambia el ambiente
- **WHEN** un administrador guarda los datos de la empresa
- **THEN** el ambiente de la versión nueva es el de la versión anterior

#### Scenario: Ambiente sin datos registrados
- **WHEN** un administrador intenta cambiar el ambiente antes de registrar los datos de la empresa
- **THEN** el sistema rechaza la solicitud e indica que primero deben registrarse los datos

#### Scenario: Mismo ambiente
- **WHEN** un administrador pide el ambiente que ya está vigente
- **THEN** no se crea una versión nueva

### Requirement: Aviso persistente del ambiente
Mientras el ambiente vigente sea `Pruebas`, el sistema SHALL mostrar a todo usuario autenticado, en
todas las pantallas, una franja de ancho completo encima de la barra superior que no puede cerrarse
y dice que los comprobantes no tienen validez tributaria. En `Producción` no SHALL mostrarse esa
franja.

#### Scenario: Operador en Pruebas
- **WHEN** un operador navega por cualquier pantalla de una empresa en `Pruebas`
- **THEN** ve encima de la barra superior la franja de Pruebas, que dice que los comprobantes no tienen validez tributaria, y no puede cerrarla

#### Scenario: Empresa en Producción
- **WHEN** un usuario navega por una empresa en `Producción`
- **THEN** no ve la franja de Pruebas

#### Scenario: Cambio de ambiente durante una sesión
- **WHEN** un administrador cambia el ambiente mientras otro usuario tiene una sesión abierta
- **THEN** ese usuario ve el ambiente nuevo a más tardar al recargar la pantalla, sin volver a iniciar sesión

### Requirement: Alta y edición de establecimientos
El sistema SHALL permitir que un administrador cree establecimientos con un código de exactamente tres dígitos, único dentro de su empresa, y una dirección de 1 a 300 caracteres sin saltos de línea. Después del alta, la dirección puede corregirse y el código no cambia.

#### Scenario: Alta de un establecimiento
- **WHEN** un administrador crea el establecimiento `001` con su dirección
- **THEN** el establecimiento existe, activo, con ese código y esa dirección

#### Scenario: Código duplicado
- **WHEN** un administrador crea un establecimiento con un código que ya existe en su empresa, activo o inactivo
- **THEN** el sistema rechaza la solicitud con un conflicto
- **AND** no se crea ningún establecimiento

#### Scenario: Altas simultáneas con el mismo código
- **WHEN** dos solicitudes crean al mismo tiempo el establecimiento `002` en la misma empresa
- **THEN** existe un solo establecimiento `002`
- **AND** la otra solicitud se rechaza con un conflicto

#### Scenario: Código con formato inválido
- **WHEN** un administrador crea un establecimiento con el código `1`, `0001` o `A01`
- **THEN** el sistema rechaza la solicitud e indica que el código tiene tres dígitos

#### Scenario: Corrección de la dirección
- **WHEN** un administrador corrige la dirección de un establecimiento
- **THEN** el establecimiento conserva su código y tiene la dirección nueva

#### Scenario: Intento de cambiar el código
- **WHEN** un administrador intenta cambiar el código de un establecimiento existente
- **THEN** el sistema rechaza la solicitud y el código no cambia

### Requirement: Activación y desactivación de establecimientos
El sistema SHALL permitir que un administrador desactive y reactive un establecimiento, sin eliminarlo. Mientras un establecimiento está inactivo, ninguno de sus puntos de emisión está disponible para emitir, aunque conserven su propio estado.

#### Scenario: Desactivación
- **WHEN** un administrador desactiva un establecimiento con dos puntos activos
- **THEN** el establecimiento queda inactivo y sus dos puntos dejan de estar disponibles para emitir

#### Scenario: Reactivación
- **WHEN** un administrador reactiva ese establecimiento
- **THEN** sus puntos que seguían activos vuelven a estar disponibles para emitir

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un establecimiento que ya está inactivo
- **THEN** el estado no cambia

### Requirement: Alta de puntos de emisión
El sistema SHALL permitir que un administrador cree puntos de emisión dentro de un establecimiento de su empresa, con un código de exactamente tres dígitos único dentro de ese establecimiento. Después del alta, ni el código ni el establecimiento del punto cambian.

#### Scenario: Mismo código en establecimientos distintos
- **WHEN** un administrador crea el punto `001` en el establecimiento `001` y el punto `001` en el establecimiento `002`
- **THEN** existen ambos puntos

#### Scenario: Código duplicado en un establecimiento
- **WHEN** un administrador crea en un establecimiento un punto con un código que ya existe en ese establecimiento
- **THEN** el sistema rechaza la solicitud con un conflicto
- **AND** no se crea ningún punto

#### Scenario: Altas simultáneas con el mismo código
- **WHEN** dos solicitudes crean al mismo tiempo el punto `002` en el mismo establecimiento
- **THEN** existe un solo punto `002` en ese establecimiento

#### Scenario: Intento de cambiar el código de un punto
- **WHEN** un administrador intenta cambiar el código de un punto de emisión existente o moverlo a otro establecimiento
- **THEN** el sistema rechaza la solicitud y el punto no cambia

### Requirement: Activación y desactivación de puntos de emisión
El sistema SHALL permitir que un administrador desactive y reactive un punto de emisión, sin eliminarlo. Un punto está disponible para emitir solo si él y su establecimiento están activos.

#### Scenario: Desactivación de un punto
- **WHEN** un administrador desactiva un punto de emisión de un establecimiento activo
- **THEN** el punto queda inactivo y deja de estar disponible para emitir

#### Scenario: Reactivación de un punto
- **WHEN** un administrador reactiva un punto de emisión de un establecimiento activo
- **THEN** el punto vuelve a estar disponible para emitir

### Requirement: Punto de emisión predeterminado propio
El sistema SHALL permitir que cada usuario, administrador u operador, elija como predeterminado un punto de emisión disponible de su empresa, que determina también su establecimiento predeterminado, o que lo quite. El predeterminado solo sirve para preseleccionar: no concede ni restringe ningún acceso.

#### Scenario: Elección de un punto disponible
- **WHEN** un operador elige como predeterminado el punto `002` del establecimiento `001`, ambos activos
- **THEN** su cuenta muestra como predeterminados el establecimiento `001` y el punto `002`

#### Scenario: Punto no disponible
- **WHEN** un usuario elige como predeterminado un punto inactivo o un punto de un establecimiento inactivo
- **THEN** el sistema rechaza la solicitud e indica que el punto no está disponible

#### Scenario: Predeterminado que deja de estar disponible
- **WHEN** un administrador desactiva el punto que un usuario tenía como predeterminado
- **THEN** la cuenta de ese usuario indica que su punto predeterminado no está disponible
- **AND** ese punto no se preselecciona hasta que vuelva a estar disponible o el usuario elija otro

#### Scenario: Quitar el predeterminado
- **WHEN** un usuario quita su punto predeterminado
- **THEN** su cuenta no tiene establecimiento ni punto predeterminados

#### Scenario: Sin efecto de autorización
- **WHEN** un usuario tiene un punto predeterminado
- **THEN** sigue viendo todos los establecimientos y puntos de su empresa
- **AND** sus permisos son los mismos que sin predeterminado

### Requirement: Permisos de la configuración tributaria
El sistema SHALL reservar al administrador la consulta y el cambio de los datos, atributos y logo de la empresa, el cambio del ambiente y la gestión de establecimientos y puntos de emisión. Administradores y operadores pueden consultar el ambiente, la preparación para emitir y los establecimientos y puntos de su empresa, y elegir su propio predeterminado.

#### Scenario: Operador intenta configurar
- **WHEN** un operador intenta cambiar los datos de la empresa, cargar o eliminar el logo, cambiar el ambiente o crear, editar, activar o desactivar un establecimiento o un punto de emisión
- **THEN** el sistema rechaza la solicitud por falta de permiso
- **AND** nada cambia

#### Scenario: Operador consulta los datos tributarios
- **WHEN** un operador intenta consultar los datos tributarios o el logo de la empresa
- **THEN** el sistema rechaza la solicitud por falta de permiso

#### Scenario: Operador consulta lo que le corresponde
- **WHEN** un operador consulta el ambiente, la preparación para emitir o los establecimientos y puntos de su empresa
- **THEN** el sistema responde con la información de su empresa

### Requirement: Aislamiento de la configuración por empresa
El sistema SHALL limitar toda consulta y todo cambio de la configuración tributaria, el logo, los establecimientos, los puntos de emisión y los predeterminados a la empresa del usuario autenticado, y SHALL responder a un recurso de otra empresa igual que a uno inexistente.

#### Scenario: Establecimiento de otra empresa
- **WHEN** un administrador de la empresa B intenta consultar, editar o desactivar un establecimiento de la empresa A usando su identificador
- **THEN** el sistema responde como si el establecimiento no existiera
- **AND** el establecimiento de la empresa A no cambia

#### Scenario: Punto de otra empresa como predeterminado
- **WHEN** un usuario de la empresa B elige como predeterminado un punto de emisión de la empresa A
- **THEN** el sistema responde como si el punto no existiera

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un administrador incluye en una solicitud de configuración un identificador de empresa
- **THEN** el sistema rechaza el campo o lo ignora, y el cambio solo puede afectar a la empresa de su sesión

### Requirement: Preparación para emitir
El sistema SHALL mostrar a administradores y operadores la preparación para emitir de su empresa como una lista de requisitos, cada uno cumplido o pendiente: datos de la empresa registrados, al menos un punto de emisión disponible y una firma electrónica utilizable. La empresa está preparada para emitir solo si todos se cumplen. La lista muestra también el ambiente vigente.

#### Scenario: Empresa nueva
- **WHEN** un usuario consulta la preparación de una empresa recién aprovisionada
- **THEN** la empresa no está preparada para emitir
- **AND** los tres requisitos figuran como pendientes y el ambiente es `Pruebas`

#### Scenario: Configuración mínima completa sin firma
- **WHEN** la empresa tiene sus datos registrados y un punto de emisión disponible
- **THEN** esos dos requisitos figuran como cumplidos
- **AND** la firma electrónica figura como pendiente y la empresa no está preparada para emitir

#### Scenario: Se desactiva el último punto disponible
- **WHEN** un administrador desactiva el único punto de emisión disponible
- **THEN** el requisito de punto de emisión vuelve a figurar como pendiente

#### Scenario: Empresa preparada para emitir
- **WHEN** la empresa tiene sus datos registrados, un punto de emisión disponible y una firma electrónica utilizable
- **THEN** los tres requisitos figuran como cumplidos y la empresa está preparada para emitir

#### Scenario: Firma por vencer
- **WHEN** la firma electrónica de la empresa está por vencer pero sigue vigente
- **THEN** el requisito de firma electrónica sigue cumplido

#### Scenario: Firma que deja de ser utilizable
- **WHEN** la firma electrónica de la empresa vence o su secreto ya no puede abrirse
- **THEN** el requisito de firma electrónica vuelve a figurar como pendiente y la empresa no está preparada para emitir
