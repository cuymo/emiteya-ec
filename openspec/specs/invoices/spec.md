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

### Requirement: Vista previa de un borrador sin guardar
El sistema SHALL calcular la vista previa de un contenido de borrador sin guardarlo: los totales,
los impuestos por línea y los problemas que impedirían emitirlo, con la misma evaluación y la misma
fecha que la vista previa de un borrador guardado. No SHALL crear ni cambiar ningún borrador, ni
consumir el secuencial. Las referencias se resuelven en la empresa de la sesión, y una que no existe
en ella se rechaza como en el guardado. Exige el mismo permiso que preparar borradores.

#### Scenario: Mismos totales que al guardar
- **WHEN** un usuario pide la vista previa de un contenido y después lo guarda tal cual
- **THEN** la vista previa y la del borrador guardado tienen los mismos totales, impuestos y problemas
- **AND** pedir la vista previa no creó ningún borrador

#### Scenario: Contenido incompleto
- **WHEN** un usuario pide la vista previa de un contenido sin comprador ni punto de emisión
- **THEN** la vista previa dice qué le falta al borrador, sin guardarlo

#### Scenario: Referencia de otra empresa
- **WHEN** un usuario pide la vista previa con un comprador de otra empresa
- **THEN** el sistema la rechaza como un comprador inexistente

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

### Requirement: Acción siguiente en el editor de facturas
El editor de facturas SHALL distinguir guardar el borrador de emitir la factura, y SHALL destacar
«Emitir factura» como la acción principal, con «Guardar borrador» como secundaria. Guardar SHALL
estar disponible siempre que no haya un guardado o una emisión en curso, también con el borrador
incompleto o con problemas. Emitir SHALL estar disponible cuando el contenido que se ve está completo,
su vista previa del servidor está al día y no tiene problemas, y el usuario tiene permiso para
emitir; no SHALL exigir guardar antes. Si hay cambios sin guardar o no hay borrador, la confirmación
de la emisión SHALL guardar primero esa versión y emitirla. Mientras emitir no está disponible, SHALL
decir qué falta en palabras del usuario. Un guardado o una emisión que el servidor rechaza SHALL
explicar el motivo junto al dato que lo causa, o con la forma de recuperarse, sin perder lo escrito.
Sin permiso para emitir, la acción de emitir no SHALL aparecer y guardar SHALL ser la principal.

#### Scenario: Factura nueva
- **WHEN** un operador abre la pantalla de nueva factura
- **THEN** «Emitir factura» es la acción principal, no está disponible y dice qué falta, como el comprador y los productos
- **AND** «Guardar borrador» es una acción secundaria disponible

#### Scenario: Factura completa sin guardar
- **WHEN** un operador elige el comprador y agrega un producto a una factura nueva, sin guardarla
- **THEN** «Emitir factura» queda disponible en cuanto llega la vista previa sin problemas
- **AND** al confirmar la emisión, el borrador se guarda y esa versión se emite

#### Scenario: Borrador incompleto
- **WHEN** un operador guarda una factura nueva sin comprador ni líneas
- **THEN** el borrador queda guardado y «Emitir factura» sigue diciendo qué falta

#### Scenario: Borrador con problemas
- **WHEN** la vista previa de un borrador dice que su comprador no es un cliente
- **THEN** el problema se muestra junto al comprador, «Guardar borrador» sigue disponible y «Emitir factura» pide resolver lo indicado

#### Scenario: Guardado en curso
- **WHEN** un operador elige guardar el borrador
- **THEN** mientras se guarda, guardar se muestra en curso, el formulario no se puede editar y «Emitir factura» no está disponible

#### Scenario: Guardado rechazado
- **WHEN** el servidor rechaza un guardado porque el borrador cambió en otra sesión
- **THEN** el editor explica el conflicto, ofrece recargar el borrador y conserva lo escrito hasta que el operador decida

#### Scenario: Rechazo al emitir
- **WHEN** entre la vista previa y la emisión cambia una condición, como la firma electrónica, y el servidor rechaza la emisión
- **THEN** no se emite ninguna factura, el editor muestra el motivo y vuelve a calcular la vista previa con los problemas actuales

#### Scenario: Sin permiso para emitir
- **WHEN** un usuario con permiso para preparar borradores pero no para emitir abre un borrador listo
- **THEN** no ve la acción de emitir y guardar es la acción principal

### Requirement: Totales veraces en el editor de facturas
El editor SHALL mostrar los totales, los impuestos y los problemas que calcula el servidor para el
contenido que se ve, mientras se escribe y sin guardar, con la vista previa de un borrador sin
guardar. No SHALL calcular impuestos ni totales en el navegador; solo SHALL sumar los importes que
el usuario reparte entre varias formas de pago, para decir cuánto falta o cuánto sobra. Mientras la
vista previa del contenido actual no ha llegado, SHALL mostrar la anterior atenuada y decir que se
actualiza. Sin productos, SHALL decir dónde aparecerá el total, sin importes ni ceros. Mientras
alguna línea no pueda calcularse, SHALL decirlo en lugar de mostrar importes parciales o ceros.
Cada línea SHALL mostrar su IVA y su subtotal del servidor.

#### Scenario: Factura nueva sin guardar
- **WHEN** un operador agrega un producto a una factura nueva sin guardarla
- **THEN** el resumen muestra el subtotal sin impuestos, el descuento, cada IVA y el total que calculó el servidor, y no se guardó ningún borrador

#### Scenario: Totales al editar
- **WHEN** un operador cambia la cantidad de una línea
- **THEN** la línea y el resumen muestran los importes nuevos del servidor en cuanto deja de escribir, sin guardar

#### Scenario: Sin productos
- **WHEN** un operador abre una factura nueva sin productos
- **THEN** el resumen dice que el total aparecerá al agregar el primer producto, sin importes ni ceros

#### Scenario: Línea que no se puede calcular
- **WHEN** la vista previa tiene una línea cuyo impuesto no puede calcularse
- **THEN** el resumen no muestra totales ni ceros, dice que los totales aparecen cuando todas las líneas se pueden calcular, y el problema va junto a la línea

### Requirement: Ambiente junto a la emisión
El editor SHALL mostrar el ambiente fiscal vigente junto a la acción de emitir. En Pruebas, SHALL
decir allí que la factura no tendrá validez tributaria. Producción SHALL mostrarse como contexto,
sin la presentación de éxito. Si el ambiente no puede confirmarse, SHALL decirlo y no presentarlo
como Producción.

#### Scenario: Empresa en Pruebas
- **WHEN** un operador prepara una factura en una empresa en Pruebas
- **THEN** junto a la acción de emitir lee que el ambiente es Pruebas y que la factura no tendrá validez tributaria

#### Scenario: Empresa en Producción
- **WHEN** un operador prepara una factura en una empresa en Producción
- **THEN** junto a la acción de emitir ve «Producción» como contexto, sin la presentación de éxito

#### Scenario: Ambiente desconocido
- **WHEN** el ambiente de la empresa no puede confirmarse
- **THEN** el editor dice que no pudo confirmar el ambiente y no muestra «Producción»

### Requirement: Confirmación de la emisión desde el editor
Emitir desde el editor SHALL pedir una confirmación explícita que diga que la emisión reserva el
número, firma la factura y no puede deshacerse, y que muestre el comprador con su identificación,
el número de productos, las formas de pago, el ambiente y el total del servidor. En Pruebas, SHALL
recordar que la factura no tendrá validez tributaria. Con consumidor final, SHALL advertir sus
restricciones de anulación y corrección. Confirmar dos veces la misma emisión SHALL producir una sola
factura, y reintentar la misma versión SHALL repetir su clave de idempotencia.

#### Scenario: Confirmar
- **WHEN** un operador elige emitir una factura lista
- **THEN** ve la confirmación con el comprador, los productos, el pago, el ambiente y el total, y la factura solo se emite si confirma

#### Scenario: Cancelar
- **WHEN** un operador abre la confirmación y la cancela
- **THEN** no se reserva ningún número y el borrador no cambia

#### Scenario: Pruebas
- **WHEN** un operador confirma la emisión en una empresa en Pruebas
- **THEN** la confirmación dice que la factura no tendrá validez tributaria

#### Scenario: Consumidor final
- **WHEN** un operador va a emitir una factura a consumidor final
- **THEN** la confirmación advierte que tiene restricciones para anularse o corregirse con una nota de crédito

#### Scenario: Confirmación repetida
- **WHEN** un operador confirma la emisión y la solicitud se repite por un doble clic o un reintento
- **THEN** se emite una sola factura con un solo número

### Requirement: Formas de pago en el editor de facturas
El editor SHALL pedir las formas de pago cuando la factura tiene al menos un producto. Con una sola
forma de pago, SHALL mostrar como su importe el total de la factura, sin pedirlo. Al dividir el pago,
cada forma de pago SHALL llevar su importe, y el editor SHALL decir al momento cuánto falta por
asignar o cuánto se asignó de más, y ofrecer asignar lo pendiente a una forma de pago sin importe.
Cada forma de pago SHALL mostrar su nombre corriente y, como detalle, su código y su nombre oficial
del SRI. La acción para quitar una forma de pago SHALL identificarla y quedar asociada a su fila a
cualquier anchura; al volver a una sola, su importe vuelve a ser el total. Las reglas de las formas
de pago no cambian.

#### Scenario: Una forma de pago
- **WHEN** un operador prepara una factura con una sola forma de pago
- **THEN** su importe es el total de la factura, sin escribirlo, y ve «Efectivo» con el detalle «SRI 01»

#### Scenario: Dividir el pago
- **WHEN** un operador divide el pago y asigna USD 10,00 de un total de USD 28,75 a la primera forma de pago
- **THEN** el editor dice que faltan USD 18,75 y ofrece asignarlos a la segunda

#### Scenario: Asignar de más
- **WHEN** las formas de pago suman más que el total
- **THEN** el editor dice cuánto se asignó de más y «Emitir factura» dice que falta la forma de pago

#### Scenario: Quitar en un teléfono
- **WHEN** un operador ve dos formas de pago en un teléfono
- **THEN** cada acción de quitar está junto a su forma de pago y su nombre accesible dice cuál quita

### Requirement: Cambios sin guardar en el editor de facturas
El editor SHALL indicar el estado del guardado como texto discreto y neutro junto al resumen,
nunca como una advertencia: «Sin guardar», «Guardando…» o «Guardado». Al cerrar o recargar la
pestaña con cambios sin guardar, el navegador SHALL pedir confirmación antes de descartarlos. El
estado y el aviso SHALL limpiarse solo tras un guardado que el servidor confirma, u otra operación
confirmada que persista la versión que se ve. Un guardado fallido SHALL conservar los cambios y el
estado. Sin cambios, salir del editor no SHALL pedir nada.

#### Scenario: Estado del guardado
- **WHEN** un operador cambia la cantidad de una línea de un borrador guardado
- **THEN** el resumen dice «Sin guardar» hasta que el servidor confirma el guardado, y entonces dice «Guardado»

#### Scenario: Guardado fallido
- **WHEN** un operador con cambios sin guardar guarda y el servidor rechaza el guardado
- **THEN** sus cambios siguen en el formulario, el editor sigue diciendo «Sin guardar» y cerrar la pestaña sigue pidiendo confirmación

#### Scenario: Cerrar la pestaña con cambios
- **WHEN** un operador intenta cerrar o recargar la pestaña con cambios sin guardar
- **THEN** el navegador le pide confirmar antes de descartarlos

#### Scenario: Salir sin cambios
- **WHEN** un operador recarga la pestaña de un borrador sin cambios sin guardar
- **THEN** el navegador no pide ninguna confirmación

### Requirement: Borrador de otra empresa en el editor
El editor SHALL abrir solo borradores de la empresa de la sesión. Un borrador de otra empresa SHALL
tratarse como inexistente, sin revelar sus datos ni su existencia.

#### Scenario: Dirección de un borrador ajeno
- **WHEN** un operador abre la dirección de un borrador de factura de otra empresa
- **THEN** ve que el borrador no existe y no ve ningún dato de ese borrador

### Requirement: Lectura del editor de facturas a cualquier anchura
A cualquier anchura soportada, el editor SHALL mantener legibles el comprador, el punto de emisión,
las líneas, las formas de pago, el resumen y las acciones, sin desplazamiento horizontal de la página
y sin que un panel lateral reduzca el formulario hasta cortar sus valores. Cuando no haya espacio
para el resumen al lado, el resumen y las acciones SHALL quedar debajo del formulario, y las
acciones SHALL seguir alcanzables sin volver al principio de la pantalla.

#### Scenario: Portátil con la barra expandida
- **WHEN** un operador abre el editor a 1024 px con la barra lateral expandida
- **THEN** la forma de pago y el importe se leen completos, y el resumen queda debajo del formulario en lugar de estrecharlo

#### Scenario: Escritorio amplio
- **WHEN** un operador abre el editor a 1440 px
- **THEN** el resumen y las acciones quedan al lado del formulario y siguen a la vista al desplazarse

#### Scenario: Teléfono
- **WHEN** un operador prepara una factura en un teléfono
- **THEN** lee cada línea y cada forma de pago sin desplazar la página a lo ancho, y alcanza guardar y emitir sin volver al principio
