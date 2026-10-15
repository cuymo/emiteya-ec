# Spec Delta

## ADDED Requirements

### Requirement: Acción principal de la lista de facturas
La lista de facturas SHALL ofrecer en su encabezado «Nueva factura» como su única acción principal a
quien puede preparar borradores de factura. Elegirla SHALL llevar a la pantalla de nueva factura sin
crear un borrador, reservar un número, firmar ni contactar al SRI. Sin permiso para preparar
borradores, la acción no SHALL aparecer.

#### Scenario: Crear desde la lista
- **WHEN** un operador elige «Nueva factura» en el encabezado de la lista de facturas
- **THEN** llega a la pantalla de nueva factura
- **AND** no se crea ningún borrador ni se reserva ningún número por haberla elegido

#### Scenario: Una sola acción principal
- **WHEN** un operador abre la lista de facturas
- **THEN** «Nueva factura» es la única acción principal de la pantalla
- **AND** la creación rápida del shell sigue disponible como acción secundaria

#### Scenario: Sin permiso para preparar borradores
- **WHEN** un usuario cuyo rol no permite preparar borradores de factura abre la lista
- **THEN** no ve la acción «Nueva factura»

### Requirement: Vistas y filtro de estado de la lista de facturas
La lista SHALL ofrecer las vistas «Todas» y «Requiere atención», esta con el número de facturas de
la empresa que la componen, y un filtro por uno de los estados del glosario que se combina con la
vista. «Requiere atención» SHALL reunir lo que el servidor define así: verificando con el SRI,
requiere revisión o transmisión detenida. Ningún filtro SHALL ofrecer una consulta que el servidor
no admite.

#### Scenario: Requiere atención con su número
- **WHEN** la empresa tiene una factura verificando con el SRI, otra en revisión manual y otra firmada con la transmisión detenida, y un operador elige «Requiere atención»
- **THEN** ve esas tres facturas y la vista indica que son 3

#### Scenario: El número no depende de la página ni de los filtros
- **WHEN** un operador cambia de página, de filas por página, de estado o de búsqueda
- **THEN** el número de «Requiere atención» sigue contando todas las facturas de la empresa que requieren atención, sin volver a pedirse por ese cambio

#### Scenario: Vista y estado combinados
- **WHEN** un operador elige «Requiere atención» y el estado «Pendiente de envío»
- **THEN** ve solo las facturas firmadas cuya transmisión está detenida

#### Scenario: Cualquier estado del glosario
- **WHEN** un operador filtra por «Pendiente de autorización»
- **THEN** ve solo las facturas recibidas por el SRI que esperan autorización

#### Scenario: El número solo cuenta la empresa
- **WHEN** otra empresa de la instalación tiene facturas en revisión manual
- **THEN** el número de «Requiere atención» de un operador no las cuenta y ninguna aparece en su lista

### Requirement: Búsqueda de la lista de facturas
La búsqueda SHALL declarar lo que busca, el número, el comprador o la identificación del comprador,
y consultar al servidor sobre todas las facturas de la empresa tras una breve pausa al escribir. La
lista no SHALL presentar resultados filtrados u ordenados solo en el navegador como si fueran
globales, ni sugerir un orden por columna que el servidor no ofrece.

#### Scenario: Búsqueda por identificación
- **WHEN** un operador escribe la identificación de un comprador en la búsqueda
- **THEN** ve las facturas de su empresa emitidas a ese comprador, de todas las páginas

#### Scenario: Alcance declarado
- **WHEN** un operador mira el campo de búsqueda de la lista
- **THEN** su nombre y su texto de ayuda dicen que busca por número, comprador o identificación

#### Scenario: Sin orden falso
- **WHEN** un operador mira los encabezados de las columnas
- **THEN** ninguno se presenta como ordenable, y la lista muestra primero las facturas más recientes, como las entrega el servidor

### Requirement: Estado de la lista de facturas en la dirección
La vista, el estado, la búsqueda, la página y las filas por página SHALL quedar en la dirección de
la pantalla, para que recargar, compartir el enlace o volver desde una factura conserve la lista.
Cambiar un filtro SHALL volver a la primera página. Cada filtro activo SHALL verse y poder quitarse,
y «Limpiar filtros» SHALL aparecer solo con algún filtro activo.

#### Scenario: Volver desde una factura
- **WHEN** un operador filtra por «Devuelto», va a la página 2, abre una factura y vuelve
- **THEN** encuentra la lista en «Devuelto» y en la página 2

#### Scenario: Cambios rápidos seguidos
- **WHEN** un operador elige una vista y, enseguida, un estado
- **THEN** la lista aplica los dos cambios y ninguno se pierde

#### Scenario: Limpiar filtros solo con filtros
- **WHEN** un operador abre la lista sin filtros y luego busca un comprador
- **THEN** «Limpiar filtros» no aparece hasta que la búsqueda está activa, y al elegirlo vuelve a todas las facturas

#### Scenario: Enlaces existentes
- **WHEN** alguien abre un enlace anterior de la lista con el filtro «Requiere atención»
- **THEN** la lista se abre en la vista «Requiere atención»

### Requirement: Presentación del estado de las facturas
Cada factura SHALL mostrar su estado con el texto del glosario y un icono, nunca solo con color.
«Verificando con el SRI» SHALL presentarse como una verificación en curso, nunca como fallo ni
rechazo, y explicar que no hay que volver a emitir la venta. «Requiere revisión» SHALL distinguirse
de «Devuelto» y «No autorizado». La transmisión detenida SHALL verse como indicador aparte del
estado.

#### Scenario: Verificando con el SRI
- **WHEN** un operador ve una factura cuyo envío al SRI es incierto
- **THEN** su estado dice «Verificando con el SRI», no se presenta como rechazo ni error, y puede leer que el envío pudo haber llegado y que no debe emitir esa venta nuevamente

#### Scenario: Requiere revisión
- **WHEN** un operador ve una factura en revisión manual junto a una devuelta y una no autorizada
- **THEN** «Requiere revisión» se presenta como una advertencia que pide intervención, distinta de los rechazos «Devuelto» y «No autorizado»

#### Scenario: Transmisión detenida
- **WHEN** la transmisión de una factura firmada se detuvo al agotar sus intentos
- **THEN** la fila muestra su estado «Pendiente de envío» y, además, que la transmisión está detenida

#### Scenario: Factura que requiere atención
- **WHEN** una factura cumple lo que define «Requiere atención»
- **THEN** su fila lo indica con una marca discreta que tiene nombre accesible, sin colorear la fila entera

### Requirement: Ambiente de cada factura en la lista
La lista SHALL indicar con texto, junto a la identidad de la factura, el ambiente de cada factura
emitida en un ambiente distinto del vigente de la empresa. Si el ambiente vigente no puede
confirmarse, SHALL indicar el ambiente de cada factura. El ambiente SHALL tomarse solo del dato de
la propia factura. Una factura de Pruebas SHALL indicar que no tiene validez tributaria. El ambiente
es contexto y no SHALL presentarse como éxito ni rechazo, ni mezclarse con el estado. Con el
ambiente vigente confirmado, las facturas de ese ambiente no SHALL llevar esa indicación, y la lista
no SHALL ofrecer un filtro de ambiente.

#### Scenario: Factura de Pruebas en una empresa en Producción
- **WHEN** una empresa ya en Producción tiene facturas emitidas en Pruebas y un operador abre la lista
- **THEN** cada factura de Pruebas indica con texto «Pruebas» y que no tiene validez tributaria, y las de Producción no llevan indicación de ambiente

#### Scenario: Autorizada en Pruebas
- **WHEN** una factura de Pruebas está autorizada y la empresa está en Producción
- **THEN** la fila muestra el estado «Autorizado» y, aparte, la indicación de Pruebas, sin presentarla como rechazada

#### Scenario: Factura de Producción en una empresa en Pruebas
- **WHEN** una factura de la lista es de Producción y la empresa está en Pruebas
- **THEN** la fila indica con texto «Producción» como contexto, sin la presentación de éxito

#### Scenario: Ambiente vigente desconocido
- **WHEN** no se puede confirmar el ambiente vigente de la empresa y la lista tiene facturas de Pruebas y de Producción
- **THEN** cada factura de Pruebas indica «Pruebas» y que no tiene validez tributaria, y cada factura de Producción indica «Producción» como contexto
- **AND** ninguna fila queda sin indicación de ambiente

### Requirement: Apertura de una factura desde la lista
Cada factura SHALL abrirse desde un enlace con su número, alcanzable con el teclado, y también al
pulsar una zona no interactiva de su fila. Sus acciones secundarias SHALL ir en un menú por fila con
un nombre accesible que identifica la factura, con solo las acciones que su estado y el rol
permiten. Ninguna acción fiscal SHALL ofrecerse desde la lista.

#### Scenario: Abrir con el teclado
- **WHEN** un operador llega con Tab al número de una factura y pulsa Enter
- **THEN** se abre el detalle de esa factura

#### Scenario: Abrir desde la fila
- **WHEN** un operador pulsa el comprador o la fecha de una fila
- **THEN** se abre el detalle de esa factura
- **AND** pulsar el menú de acciones de la fila, o seleccionar texto en ella, no la abre

#### Scenario: Acciones de una factura
- **WHEN** un operador abre el menú de acciones de cualquier factura
- **THEN** encuentra «Ver factura» y «Copiar número»
- **AND** no encuentra «Descargar RIDE» ni la creación de notas de crédito o débito, que siguen en el detalle de la factura

#### Scenario: Copiar el número
- **WHEN** un operador elige «Copiar número»
- **THEN** se copia solo el número visible de la factura y una confirmación accesible lo anuncia

#### Scenario: Sin acciones fiscales
- **WHEN** un operador abre el menú de acciones de cualquier factura
- **THEN** no encuentra acciones para reintentar la firma, reconciliar, anular, reenviar ni duplicar

#### Scenario: Sin consultas por fila
- **WHEN** la lista muestra una página de facturas
- **THEN** no pide el detalle, el RIDE ni el estado de cada factura por separado

### Requirement: Carga, vacío y error de la lista de facturas
Mientras la lista carga, el encabezado y las herramientas SHALL mantenerse y la tabla SHALL mostrar
su estructura sin cifras de paginación. Sin facturas, SHALL explicar qué aparece ahí y ofrecer
«Nueva factura» a quien puede crearla. Sin resultados por los filtros, SHALL ofrecer limpiarlos y no
crear. Ante un error, SHALL mantener la pantalla y ofrecer reintentar, sin detalles técnicos.

#### Scenario: Primera carga
- **WHEN** la lista de facturas todavía se está cargando
- **THEN** el encabezado y las herramientas están en su lugar, la tabla muestra su estructura, y no aparece ninguna cifra de paginación como «0 de 0»

#### Scenario: Empresa sin facturas
- **WHEN** un operador abre la lista de una empresa que aún no emitió facturas
- **THEN** la pantalla explica que ahí aparecen las facturas que emite y le ofrece «Nueva factura», sin paginación

#### Scenario: Sin resultados por los filtros
- **WHEN** la búsqueda o los filtros activos no coinciden con ninguna factura
- **THEN** la pantalla dice que no hay facturas con esos filtros y ofrece «Limpiar filtros», no crear una factura

#### Scenario: Error al cargar
- **WHEN** el servidor no responde al pedir la lista
- **THEN** la pantalla mantiene su encabezado y sus herramientas, explica que no pudo cargar las facturas y ofrece reintentar

#### Scenario: Página fuera de rango
- **WHEN** alguien abre la lista en una página posterior a la última
- **THEN** la lista muestra la última página con facturas

### Requirement: Lectura de la lista de facturas a cualquier anchura
A cualquier anchura soportada, cada factura SHALL leerse con su número, su estado, su comprador y su
total, sin que el número ni el total se partan en varias líneas. Si la tabla no cabe, SHALL
desplazarse dentro de su propia superficie, sin desbordar la página ni convertirse en tarjetas.

#### Scenario: Portátil
- **WHEN** un operador abre la lista a 1024 px de ancho, con la barra lateral expandida
- **THEN** el número y el total de cada factura ocupan una sola línea, y el número y el estado se leen juntos

#### Scenario: Teléfono
- **WHEN** un operador abre la lista en un teléfono
- **THEN** lee el número, el comprador, el estado y el total de cada factura dentro de la tabla, y la página no se desplaza a lo ancho
