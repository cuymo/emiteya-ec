# Spec Delta

## Purpose

Permitir a cada empresa preparar facturas como borradores editables y emitirlas, con el cálculo
exacto de sus importes, los impuestos de sus productos, el consumidor final, las formas de pago y
los campos del emisor, y consultar las facturas emitidas.

## ADDED Requirements

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
El sistema SHALL listar las facturas emitidas de la empresa con paginación, filtro por estado y búsqueda por número o comprador. El detalle muestra el estado, el número, la clave de acceso, la fecha, el comprador, las líneas, los totales y las formas de pago tomados del snapshot, y el diagnóstico del último intento si sigue reservada. Ni el listado ni el detalle exponen el XML firmado.

#### Scenario: Factura firmada
- **WHEN** un usuario consulta una factura firmada
- **THEN** ve su número, su clave de acceso, sus totales y el estado firmado, sin diagnóstico

#### Scenario: Factura reservada con diagnóstico
- **WHEN** un usuario consulta una factura reservada cuya firma falló
- **THEN** ve la etapa y el motivo del último intento, si es reintentable, y la acción de reintentar si tiene permiso

#### Scenario: Búsqueda por número
- **WHEN** un usuario busca `001-001-000000012`
- **THEN** el resultado contiene solo esa factura de su empresa

### Requirement: Reintento de firma de una factura
Un usuario con permiso SHALL poder reintentar llevar a firmada una factura reservada. El reintento reutiliza la factura, su snapshot, su número y su clave de acceso, y nunca reserva otro número. Sobre una factura ya firmada no tiene efecto. Mientras otro intento de esa factura está en curso, devuelve el estado actual sin iniciar otro.

#### Scenario: Reintento exitoso
- **WHEN** un usuario reintenta una factura reservada cuyo fallo anterior fue reintentable
- **THEN** la factura queda firmada con su mismo número y su misma clave

#### Scenario: Reintento de una factura firmada
- **WHEN** un usuario reintenta una factura ya firmada
- **THEN** el sistema devuelve la factura sin cambios y no crea otro artefacto

### Requirement: Permisos de facturas
Cada operación de facturas SHALL exigir su permiso antes de leer o escribir datos: consultar facturas (`invoices.read`), gestionar borradores (`invoices.draft`), emitir (`invoices.emit`) y reintentar la firma (`invoices.retrySigning`). Sin sesión, el sistema responde no autenticado; si la política de acceso no concede el permiso, responde prohibido, sin efecto. La empresa y el rol salen siempre de la sesión. Con la matriz de acceso vigente, administradores y operadores tienen los cuatro permisos: crear borradores, emitir y corregir un comprobante con XML inválido corresponde a ambos roles.

#### Scenario: Permiso exigido por cada operación
- **WHEN** se consulta una factura, se guarda o elimina un borrador, se emite o se reintenta la firma, y la política de acceso no concede el permiso de esa operación
- **THEN** el sistema responde prohibido antes de leer o escribir datos

#### Scenario: Matriz vigente
- **WHEN** se consulta la política de acceso
- **THEN** administradores y operadores tienen los cuatro permisos de facturas

#### Scenario: Operador emite
- **WHEN** un operador emite un borrador válido
- **THEN** la factura se emite y queda registrada con el operador como autor

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión intenta emitir o consultar facturas
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
