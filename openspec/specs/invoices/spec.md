# invoices Specification

## Purpose

Permitir a cada empresa preparar facturas como borradores editables y emitirlas, con el cálculo
exacto de sus importes, los impuestos de sus productos, el consumidor final, las formas de pago y
los campos del emisor, y consultar las facturas emitidas.

## Requirements

### Requirement: Borradores de factura
El sistema SHALL permitir guardar, corregir y eliminar borradores de factura sin consumir el secuencial ni crear ningún dato fiscal. Cada borrador registra quién lo creó y quién lo cambió por última vez, con fecha y hora, y lleva una versión para corregirlo de forma segura. Un borrador emitido deja de poder corregirse o eliminarse.

#### Scenario: Guardar un borrador
- **WHEN** un usuario guarda un borrador con un comprador, un punto de emisión y una línea
- **THEN** el borrador queda guardado sin número ni clave de acceso, con su autor y su fecha
- **AND** el contador del punto de emisión no cambia

#### Scenario: Borrador incompleto
- **WHEN** un usuario guarda un borrador todavía sin comprador ni líneas
- **THEN** el borrador queda guardado, y su emisión se rechazará mientras le falten

#### Scenario: Versión desactualizada
- **WHEN** un usuario corrige un borrador con una versión que ya no es la vigente
- **THEN** el sistema rechaza el cambio por conflicto de versión y el borrador no cambia

#### Scenario: Eliminar un borrador
- **WHEN** un usuario elimina un borrador
- **THEN** el borrador deja de existir y no queda ningún rastro fiscal

#### Scenario: Borrador ya emitido
- **WHEN** un usuario intenta corregir o eliminar un borrador que ya se emitió
- **THEN** el sistema rechaza la solicitud y la factura emitida no cambia

### Requirement: Contenido de la factura
Un borrador SHALL indicar el punto de emisión, el comprador, al menos una línea y al menos una forma de pago. El comprador es un tercero activo con rol de cliente o el consumidor final del sistema. Cada línea refiere un producto activo e indica cantidad (18 dígitos, 6 decimales) y descuento (2 decimales, entre 0 y el subtotal). El precio unitario sin impuestos es el del producto al emitir y no se edita.

#### Scenario: Comprador cliente
- **WHEN** un usuario emite un borrador cuyo comprador es un tercero activo con rol de cliente
- **THEN** la factura lleva el tipo y número de identificación, la razón social y la dirección del tercero

#### Scenario: Comprador sin rol de cliente
- **WHEN** un usuario emite un borrador cuyo comprador es un tercero solo con rol de proveedor
- **THEN** el sistema rechaza la emisión antes de reservar e indica que el comprador debe ser un cliente

#### Scenario: Producto desactivado
- **WHEN** un usuario emite un borrador con una línea cuyo producto se desactivó después de agregarlo
- **THEN** el sistema rechaza la emisión antes de reservar e identifica la línea

#### Scenario: Descuento mayor que el subtotal
- **WHEN** un usuario emite un borrador con una línea cuyo descuento supera la cantidad por el precio
- **THEN** el sistema rechaza la emisión antes de reservar e identifica la línea

#### Scenario: Precio del producto al emitir
- **WHEN** un administrador cambia el precio de un producto después de agregarlo a un borrador, y el borrador se emite
- **THEN** la línea lleva el precio vigente del producto al emitir, que queda congelado en el snapshot

#### Scenario: Precio enviado en la línea
- **WHEN** un usuario envía un precio unitario en una línea del borrador
- **THEN** el sistema rechaza la solicitud por contener un campo no permitido

#### Scenario: Escala de la cantidad
- **WHEN** un usuario guarda un borrador con una cantidad de 7 decimales
- **THEN** el sistema rechaza la solicitud indicando el máximo de 6 decimales y no la redondea

#### Scenario: Límite de líneas de la aplicación
- **WHEN** un usuario guarda un borrador con más líneas que el límite configurado de la aplicación, 100 por defecto
- **THEN** el sistema rechaza la solicitud indicando el límite, que es una defensa de recursos y no una regla del SRI

### Requirement: Cálculo exacto de la factura
El sistema SHALL calcular con decimal exacto, sin redondeos intermedios. Subtotal de línea: cantidad por precio. Base imponible: subtotal menos descuento, materializada HALF_UP a 2 decimales. Impuesto de línea: porcentaje de la base ya materializada, materializado HALF_UP. Los totales por tarifa, sin impuestos, de descuento e importe total MUST sumar los valores de línea ya materializados. Es una política del producto (Q-14), no una regla textual del SRI.

#### Scenario: Empates HALF_UP
- **WHEN** una factura tiene una línea de 1 × 1.005 con IVA del 5 % y otra de 1 × 0.10 con IVA del 15 %
- **THEN** sus bases son `1.01` y `0.10`, y sus impuestos `0.05` y `0.02`

#### Scenario: Totales desde valores materializados
- **WHEN** una factura tiene tres líneas de 1 × 0.10 con IVA del 15 %
- **THEN** el impuesto total de esa tarifa es `0.06`, la suma de los impuestos de línea, no el 15 % de `0.30`

#### Scenario: Varias líneas con descuento
- **WHEN** una factura tiene 3 × 8.75 con descuento 1.25 al 15 %, 1.5 × 0.015 al 15 %, 2.5 × 0.01 al 0 %, 1 × 1.005 al 5 %, 1 × 0.10 al 15 % y 3 × 0.333333 al 15 %
- **THEN** sus totales son: sin impuestos `27.16`, descuento `1.25`, IVA del 15 % `3.92` sobre `26.12`, del 5 % `0.05` sobre `1.01`, del 0 % `0.00` sobre `0.03`, e importe total `31.13`

#### Scenario: Importe fuera del esquema
- **WHEN** el importe total calculado supera los 14 dígitos que admite el XSD
- **THEN** el sistema rechaza la emisión antes de reservar e indica el límite

#### Scenario: Vista previa del borrador
- **WHEN** un usuario consulta un borrador completo
- **THEN** ve los totales calculados por el servidor con las tarifas vigentes hoy, marcados como vista previa no fiscal

### Requirement: Impuestos de las líneas por la fecha del documento
Los impuestos de cada línea SHALL salir de las referencias fiscales de su producto, resueltas con la fecha de emisión. Cada referencia MUST estar habilitada para la empresa, tener versión aplicable en esa fecha y datos de cálculo completos. Si una línea necesita ICE, IRBPNR o IVA diferenciado sin datos de cálculo, o una referencia no es utilizable, la emisión se rechaza antes de reservar, sin valores por defecto. El producto puede seguir existiendo como incompleto.

#### Scenario: IVA del 15 %
- **WHEN** un usuario emite una factura con un producto cuyo IVA es la tarifa `4` (15 %), habilitada y vigente
- **THEN** la línea lleva el código de impuesto `2`, el código de tarifa `4` y la tarifa `15`

#### Scenario: Producto con ICE
- **WHEN** un usuario emite un borrador con un producto que lleva un código de ICE sin tarifa transcrita
- **THEN** el sistema rechaza la emisión antes de reservar e indica que el ICE de esa línea no tiene datos de cálculo

#### Scenario: IVA diferenciado
- **WHEN** un usuario emite un borrador con un producto con IVA diferenciado (código `8`)
- **THEN** el sistema rechaza la emisión antes de reservar e indica que falta la tarifa aplicable

#### Scenario: Tarifa deshabilitada
- **WHEN** un usuario emite un borrador con un producto cuya tarifa de IVA la empresa deshabilitó
- **THEN** el sistema rechaza la emisión antes de reservar e identifica la línea y la tarifa

### Requirement: Consumidor final en la factura
Una factura a consumidor final SHALL permitirse solo si su importe total es menor o igual que el monto máximo de la política vigente en la fecha de emisión. `importeTotal` es la correspondencia explícita con el "valor de la factura" de la ficha. Por encima del monto, el sistema MUST rechazar la emisión antes de reservar y pedir un comprador identificado. El monto sale de la política versionada, nunca de una constante.

#### Scenario: Por debajo del monto
- **WHEN** un usuario emite a consumidor final una factura de importe total `49.99` con el monto vigente de USD 50.00
- **THEN** la factura se emite con la identidad `07`, `9999999999999` y `CONSUMIDOR FINAL`

#### Scenario: Exactamente el monto
- **WHEN** un usuario emite a consumidor final una factura de importe total `50.00`
- **THEN** la factura se emite

#### Scenario: Por encima del monto
- **WHEN** un usuario emite a consumidor final una factura de importe total `50.01`
- **THEN** el sistema rechaza la emisión antes de reservar e indica que debe identificar al comprador

### Requirement: Formas de pago
Cada forma de pago SHALL ser una entrada del catálogo de formas de pago utilizable en la fecha de emisión, con su importe. Una sola forma de pago sin importe cubre el importe total. Con varias, todas llevan importe y MUST sumar exactamente el importe total; si no, la emisión se rechaza antes de reservar.

#### Scenario: Una forma de pago
- **WHEN** un usuario emite una factura con una sola forma de pago `01` sin importe
- **THEN** la factura lleva esa forma de pago por el importe total

#### Scenario: Pagos que no suman el total
- **WHEN** un usuario emite una factura de `31.13` con dos formas de pago de `20.00` y `11.00`
- **THEN** el sistema rechaza la emisión antes de reservar e indica la diferencia

#### Scenario: Forma de pago inexistente
- **WHEN** un usuario guarda un borrador con una forma de pago que no está en el catálogo
- **THEN** el sistema rechaza la solicitud e identifica la forma de pago

### Requirement: Datos del emisor en la factura
La factura SHALL llevar los datos fiscales vigentes del emisor al reservarla: RUC, razón social, nombre comercial, dirección matriz y del establecimiento, ambiente y obligado a llevar contabilidad. Lleva además el número de contribuyente especial, `agenteRetencion` con la resolución del agente de retención y `contribuyenteRimpe` con el texto fijo del XSD, solo cuando la empresa los declara.

#### Scenario: Agente de retención
- **WHEN** la empresa declara la resolución de agente de retención `1` y emite una factura
- **THEN** el XML lleva `agenteRetencion` con `1` después de la dirección matriz

#### Scenario: Contribuyente RIMPE
- **WHEN** la empresa declara una categoría RIMPE y emite una factura
- **THEN** el XML lleva `contribuyenteRimpe` con `CONTRIBUYENTE RÉGIMEN RIMPE`

#### Scenario: Sin condiciones declaradas
- **WHEN** la empresa no declara agente de retención ni RIMPE
- **THEN** el XML no lleva `agenteRetencion` ni `contribuyenteRimpe`

### Requirement: Importes exactos en el XML de la factura
El XML de la factura SHALL escribir cada cantidad, precio, tarifa e importe exactamente como su valor materializado, sin pasar por números binarios de coma flotante. Un valor válido de 17 o 18 dígitos se escribe sin alterar, y el orden de los elementos es el del XSD 1.1.0.

#### Scenario: Precio de 18 dígitos
- **WHEN** una factura tiene líneas con precio unitario `123456789012.123456` y `99999999999.999999`
- **THEN** el XML lleva exactamente esos precios, bases de `123456789012.12` y `100000000000.00`, e importe total `256975307363.94`

#### Scenario: Cantidad de 18 dígitos
- **WHEN** una factura tiene líneas con cantidad `123456789012.123456` y `99999999999.999999` a precio 1
- **THEN** el XML lleva exactamente esas cantidades

### Requirement: Consulta de facturas
El sistema SHALL listar las facturas emitidas de la empresa con paginación, filtro por estado y búsqueda por número o comprador. El detalle muestra el estado, el número, la clave de acceso, la fecha, el comprador, las líneas, los totales y las formas de pago tomados del snapshot, y el diagnóstico del último intento si sigue reservada. Desde la transmisión, muestra también los mensajes del SRI del último resultado, los datos de la autorización y el historial de la transmisión. Ni el listado ni el detalle exponen el XML firmado, el XML autorizado ni las respuestas originales del SRI.

#### Scenario: Factura firmada
- **WHEN** un usuario consulta una factura firmada
- **THEN** ve su número, su clave de acceso, sus totales y el estado firmado, sin diagnóstico

#### Scenario: Factura reservada con diagnóstico
- **WHEN** un usuario consulta una factura reservada cuya firma falló
- **THEN** ve la etapa y el motivo del último intento, si es reintentable, y la acción de reintentar si tiene permiso

#### Scenario: Búsqueda por número
- **WHEN** un usuario busca `001-001-000000012`
- **THEN** el resultado contiene solo esa factura de su empresa

#### Scenario: Factura autorizada
- **WHEN** un usuario consulta una factura autorizada
- **THEN** ve el estado autorizado, el número y la fecha de autorización y el ambiente confirmado

#### Scenario: Factura devuelta o no autorizada
- **WHEN** un usuario consulta una factura devuelta o no autorizada
- **THEN** ve todos los mensajes del SRI con su identificador, su mensaje y su información adicional

#### Scenario: Historial de la transmisión
- **WHEN** un usuario consulta el historial de la transmisión de una factura
- **THEN** ve sus transiciones y un resumen de cada intento con el SRI (operación, momento, resultado y mensajes), sin la respuesta original

#### Scenario: Filtro por estado de transmisión
- **WHEN** un usuario filtra las facturas por un estado de la transmisión, como resultado incierto o revisión manual
- **THEN** el resultado contiene solo las facturas de su empresa en ese estado

#### Scenario: Transmisión detenida
- **WHEN** un usuario consulta una factura cuya transmisión se detuvo al agotar sus intentos
- **THEN** ve que la transmisión está detenida y su último motivo, sin datos técnicos sensibles

### Requirement: Reintento de firma de una factura
Un usuario con permiso SHALL poder reintentar llevar a firmada una factura reservada. El reintento reutiliza la factura, su snapshot, su número y su clave de acceso, y nunca reserva otro número. Sobre una factura ya firmada no tiene efecto. Mientras otro intento de esa factura está en curso, devuelve el estado actual sin iniciar otro.

#### Scenario: Reintento exitoso
- **WHEN** un usuario reintenta una factura reservada cuyo fallo anterior fue reintentable
- **THEN** la factura queda firmada con su mismo número y su misma clave

#### Scenario: Reintento de una factura firmada
- **WHEN** un usuario reintenta una factura ya firmada
- **THEN** el sistema devuelve la factura sin cambios y no crea otro artefacto

### Requirement: Permisos de facturas
Cada operación de facturas SHALL exigir su permiso antes de leer o escribir datos: consultar facturas (`invoices.read`), gestionar borradores (`invoices.draft`), emitir (`invoices.emit`), reintentar la firma (`invoices.retrySigning`) y pedir una reconciliación con el SRI (`invoices.reconcile`). Sin sesión, el sistema responde no autenticado; si la política de acceso no concede el permiso, responde prohibido, sin efecto. La empresa y el rol salen siempre de la sesión. Con la matriz de acceso vigente, administradores y operadores tienen los cuatro primeros permisos: crear borradores, emitir y corregir un comprobante con XML inválido corresponde a ambos roles. Pedir una reconciliación es solo del administrador.

#### Scenario: Permiso exigido por cada operación
- **WHEN** se consulta una factura, se guarda o elimina un borrador, se emite, se reintenta la firma o se pide una reconciliación, y la política de acceso no concede el permiso de esa operación
- **THEN** el sistema responde prohibido antes de leer o escribir datos

#### Scenario: Matriz vigente
- **WHEN** se consulta la política de acceso
- **THEN** administradores y operadores tienen los permisos de consultar, gestionar borradores, emitir y reintentar la firma, y solo los administradores tienen el de reconciliar

#### Scenario: Operador emite
- **WHEN** un operador emite un borrador válido
- **THEN** la factura se emite y queda registrada con el operador como autor

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión intenta emitir, consultar o reconciliar facturas
- **THEN** el sistema responde no autenticado

### Requirement: Aislamiento de las facturas por empresa
Los borradores y facturas de una empresa SHALL ser invisibles para cualquier otra. Ningún identificador enviado por el cliente cambia la empresa. Un borrador no puede referir puntos, terceros, productos ni formas de pago de otra empresa.

#### Scenario: Factura de otra empresa
- **WHEN** un usuario de la empresa A consulta, reintenta o intenta emitir un borrador o una factura de la empresa B
- **THEN** el sistema responde que no existe y no revela ningún dato

#### Scenario: Referencias de otra empresa
- **WHEN** un usuario de la empresa A guarda un borrador con un tercero o un producto de la empresa B
- **THEN** el sistema rechaza la solicitud como referencia inexistente

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un usuario envía un `companyId` en el cuerpo de un borrador o de una emisión
- **THEN** el sistema rechaza la solicitud por contener un campo no permitido

### Requirement: Aviso de existencias en el borrador
La vista previa de un borrador SHALL avisar, sin bloquear su emisión, cuando la cantidad pedida de un producto con inventario activo (la suma de todas sus líneas) supera su saldo vigente, y cuando un producto marcado como controlado no tiene el inventario inicializado. El aviso es orientativo: otra operación puede cambiar el saldo antes de la autorización.

#### Scenario: Cantidad mayor que el saldo
- **WHEN** un borrador pide 3 y 4 unidades de un producto con saldo 5
- **THEN** la vista previa avisa que la cantidad pedida, 7, supera el saldo, 5, y el borrador se puede emitir

#### Scenario: Producto sin inventario inicializado
- **WHEN** un borrador incluye un producto marcado como controlado sin inventario inicializado
- **THEN** la vista previa avisa que el producto no tiene inventario inicializado, sin tratar su saldo como cero, y el borrador se puede emitir

#### Scenario: Saldo suficiente
- **WHEN** un borrador pide 2 unidades de un producto con saldo 5
- **THEN** la vista previa no avisa nada sobre ese producto

#### Scenario: Aviso que no bloquea
- **WHEN** un usuario emite un borrador con avisos de existencias y sin otros problemas
- **THEN** la factura se emite

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
