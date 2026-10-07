# shipping-guides Specification

## Purpose

Sustentar con una guía de remisión 1.1.0 el traslado de mercadería que hace la empresa como remitente, con su transportista, su placa, sus destinatarios y su detalle sin precios, y por cada destinatario una factura propia autorizada o una excepción declarada del Reglamento de Comprobantes de Venta.

## Requirements

### Requirement: Guía de remisión
La guía SHALL ser un comprobante propio (tipo 06, versión 1.1.0) que la empresa emite como remitente, con su secuencial independiente de los demás tipos, su clave de acceso y su snapshot. Lleva los datos del emisor vigentes al reservar, la dirección de partida, el transportista, la placa, las fechas del transporte y uno o más destinatarios con su detalle. No tiene precios, impuestos ni total monetario.

#### Scenario: Numeración propia
- **WHEN** un usuario emite la primera guía de un punto que ya emitió 40 facturas y 2 comprobantes de retención
- **THEN** la guía recibe el número 000000001 de ese punto, y la siguiente factura sigue en 41

#### Scenario: XML del comprobante
- **WHEN** se firma una guía
- **THEN** su XML lleva el tipo 06, valida contra el XSD oficial `GuiaRemision_V1.1.0` antes y después de firmar, y no lleva precios, impuestos ni totales

#### Scenario: Fecha de emisión en la clave
- **WHEN** se reserva una guía
- **THEN** su fecha de emisión es la fecha de Ecuador de la reserva, va en la clave de acceso y no cambia en los reintentos de firma ni en la transmisión

### Requirement: Transportista de la guía
El transportista SHALL tener un origen explícito: transporte propio, con la identidad tributaria de la empresa (RUC, tipo 04 y razón social), o un tercero de la empresa, activo, con el rol de transportista, identificado con RUC, cédula o pasaporte. Su identificación no supera 13 caracteres (ficha v2.34, anexo 3). El sistema lo comprueba antes de reservar y nunca asigna el rol de transportista por su cuenta.

#### Scenario: Transporte propio
- **WHEN** un usuario emite una guía con transporte propio
- **THEN** el transportista de la guía es la empresa, con su RUC, el tipo 04 y su razón social, y no se crea ningún tercero

#### Scenario: Tercero transportista
- **WHEN** un usuario elige como transportista un tercero activo con el rol de transportista y una cédula
- **THEN** la guía lleva su cédula, el tipo 05 y su nombre

#### Scenario: Tercero sin rol de transportista
- **WHEN** un usuario elige como transportista un tercero que no tiene el rol de transportista
- **THEN** el sistema rechaza la solicitud indicando que primero debe configurarse como transportista, no le asigna el rol y no reserva número

#### Scenario: Identificación demasiado larga
- **WHEN** el transportista es un tercero con un pasaporte de 15 caracteres
- **THEN** el sistema rechaza la emisión citando el máximo de 13 caracteres de la ficha técnica, sin reservar número

#### Scenario: Tipo de identificación no admitido
- **WHEN** se intenta usar como transportista el consumidor final o un tercero con identificación del exterior
- **THEN** el sistema rechaza la solicitud sin reservar número

#### Scenario: Transportista inactivo
- **WHEN** el tercero transportista está desactivado al emitir
- **THEN** el sistema rechaza la emisión sin reservar número

### Requirement: Placa de la guía
Cada guía SHALL llevar exactamente una placa obligatoria: texto fiscal sin espacios en los extremos, de 1 a 20 caracteres y sin saltos de línea. El sistema MUST NOT exigir un formato vehicular que ninguna fuente de la guía establece. Una guía no admite varios vehículos ni conductores.

#### Scenario: Placa con espacios
- **WHEN** un usuario escribe la placa con espacios al inicio y al final
- **THEN** la guía guarda y escribe la placa sin esos espacios

#### Scenario: Placa sin formato vehicular
- **WHEN** un usuario escribe una placa que no sigue el formato de las placas nacionales
- **THEN** el sistema la acepta si tiene de 1 a 20 caracteres sin saltos de línea

#### Scenario: Placa vacía o demasiado larga
- **WHEN** la placa está vacía o tiene 21 caracteres
- **THEN** el sistema rechaza la emisión indicando el campo, sin reservar número

#### Scenario: Varios vehículos
- **WHEN** una solicitud envía varias placas o varios transportistas
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: Fechas del transporte
La fecha de inicio del transporte SHALL no ser anterior a la fecha de emisión de la guía (requisito oficial: error 82 de la ficha v2.34), y la de fin SHALL no ser anterior a la de inicio (validación del proyecto). No hay duración máxima. Las fechas son reales y de los años 2000 a 2099 (XSD). La reserva compara con su propia fecha de emisión.

#### Scenario: Inicio el mismo día
- **WHEN** la fecha de inicio es la fecha de emisión de la guía
- **THEN** el sistema la acepta

#### Scenario: Inicio anterior a la emisión
- **WHEN** la fecha de inicio es anterior a la fecha de emisión
- **THEN** el sistema rechaza la emisión citando la regla oficial de la fecha de inicio, sin reservar número

#### Scenario: Borrador emitido otro día
- **WHEN** un borrador se guardó con la fecha de inicio de hoy y se emite al día siguiente
- **THEN** la reserva compara con su propia fecha de emisión y rechaza la emisión, sin reservar número

#### Scenario: Fin anterior al inicio
- **WHEN** la fecha de fin es anterior a la de inicio
- **THEN** el sistema rechaza la emisión como una validación del proyecto, sin reservar número

#### Scenario: Traslado largo
- **WHEN** la fecha de fin es 60 días posterior a la de inicio
- **THEN** el sistema la acepta

### Requirement: Dirección de partida
La guía SHALL llevar una dirección de partida obligatoria: la de un establecimiento propio activo que el usuario elige como origen, derivada y congelada con su identidad, o un texto libre de 1 a 300 caracteres sin saltos de línea, que el borrador propone con la dirección del establecimiento del punto de emisión. Un traslado entre establecimientos propios exige un origen elegido; un texto libre no lo prueba.

#### Scenario: Origen elegido
- **WHEN** un usuario elige el establecimiento 001 como origen
- **THEN** la dirección de partida de la guía es la del establecimiento 001, y la guía guarda su identidad, su código y su dirección

#### Scenario: Dirección propuesta
- **WHEN** un usuario crea un borrador en un punto de emisión sin elegir un origen
- **THEN** la dirección de partida propuesta como texto es la del establecimiento de ese punto, sin que cuente como origen elegido

#### Scenario: Partida desde otro lugar
- **WHEN** el usuario escribe como partida la dirección de una bodega no registrada en una guía sin traslados entre establecimientos propios
- **THEN** la guía lleva la dirección que el usuario escribió

#### Scenario: Sin dirección de partida
- **WHEN** la guía no tiene origen elegido y la dirección de partida está vacía al emitir
- **THEN** el sistema rechaza la emisión indicando el campo, sin reservar número

#### Scenario: Dirección libre en un traslado propio
- **WHEN** una guía con un destinatario en traslado entre establecimientos propios tiene una dirección de partida libre y ningún origen elegido
- **THEN** el sistema rechaza la emisión pidiendo el establecimiento de origen, sin reservar número

### Requirement: Destinatarios de la guía
La guía SHALL tener uno o más destinatarios, en orden. Cada uno lleva su identificación, su razón social, una dirección de destino obligatoria de 1 a 300 caracteres, su motivo del traslado, su sustento y uno o más detalles. Un mismo tercero puede aparecer en varios destinatarios. Ningún destinatario representa por sí solo a la guía.

#### Scenario: Varios destinatarios
- **WHEN** un usuario emite una guía con dos destinatarios
- **THEN** la guía lleva los dos, en el orden del borrador, cada uno con su dirección, su motivo, su sustento y su detalle

#### Scenario: Mismo tercero dos veces
- **WHEN** una guía lleva dos destinatarios con el mismo tercero y facturas distintas
- **THEN** el sistema la acepta con dos destinatarios

#### Scenario: Sin destinatarios
- **WHEN** un borrador no tiene destinatarios al emitir
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Destinatario sin detalle
- **WHEN** un destinatario no tiene ningún detalle
- **THEN** el sistema rechaza la emisión indicando el destinatario, sin reservar número

### Requirement: Destinatario externo
Un destinatario externo SHALL ser un tercero de la empresa, activo, identificado con RUC, cédula o pasaporte, con cualquier rol o sin roles. El consumidor final y la identificación del exterior MUST NOT ser destinatarios. La guía no asigna roles al tercero. Su dirección de destino se propone desde el tercero, se puede cambiar y se congela al reservar.

#### Scenario: Tercero sin roles
- **WHEN** un usuario emite una guía a un tercero que no tiene roles
- **THEN** el sistema la emite, y el tercero sigue sin roles: la guía no le asigna el de cliente

#### Scenario: Consumidor final
- **WHEN** un usuario elige como destinatario el consumidor final del sistema
- **THEN** el sistema lo rechaza: el destinatario se identifica

#### Scenario: Identificación del exterior
- **WHEN** un usuario elige como destinatario un tercero con identificación del exterior
- **THEN** el sistema lo rechaza por estar fuera del alcance actual

#### Scenario: Tercero sin dirección
- **WHEN** el tercero no tiene dirección registrada
- **THEN** el usuario escribe la dirección de destino, y sin ella la emisión se rechaza indicando el destinatario

### Requirement: Traslado entre establecimientos propios
En un traslado entre establecimientos de la empresa, el destinatario SHALL ser la propia empresa, con su RUC y su razón social vigentes al reservar. La guía SHALL tener un establecimiento de origen y el destinatario uno de destino, ambos propios, activos y distintos, que el usuario elige; el destino aporta la dirección y el código de destino. No se compara con el establecimiento del punto. No se crea un tercero. Su sustento es siempre la excepción de este caso.

#### Scenario: Traslado entre dos establecimientos
- **WHEN** un usuario emite una guía con origen en el establecimiento 001 y un destinatario que es la propia empresa en el establecimiento 002
- **THEN** la partida es la dirección del 001, el destinatario lleva el RUC y la razón social de la empresa, la dirección del 002 y el código de destino 002, la guía guarda la identidad de los dos establecimientos, y no existe un tercero nuevo

#### Scenario: Mismo establecimiento
- **WHEN** el establecimiento de destino es el mismo que el de origen
- **THEN** el sistema rechaza la solicitud: el traslado es entre establecimientos distintos

#### Scenario: Emisión desde un tercer establecimiento
- **WHEN** la guía se emite desde un punto del establecimiento 003, con origen en el 001 y destino en el 002
- **THEN** el sistema la acepta

#### Scenario: Emisión desde el destino
- **WHEN** la guía se emite desde un punto del establecimiento 002, con origen en el 001 y destino en el 002
- **THEN** el sistema la acepta: el establecimiento emisor puede ser el de origen, el de destino u otro

#### Scenario: Establecimiento inactivo
- **WHEN** el establecimiento de origen o el de destino está desactivado al emitir
- **THEN** el sistema rechaza la emisión indicando cuál, sin reservar número

#### Scenario: Otra clase de sustento
- **WHEN** un destinatario que es la propia empresa lleva una factura o una excepción distinta del traslado entre establecimientos propios
- **THEN** el sistema rechaza la solicitud

### Requirement: Motivo, ruta y establecimiento de destino
Cada destinatario SHALL llevar un motivo del traslado obligatorio, texto libre de 1 a 300 caracteres, sin catálogo. La ruta es opcional, texto de hasta 300 caracteres. El código del establecimiento de destino tiene 3 dígitos: obligatorio para la propia empresa, opcional y declarado por el usuario para un tercero, y nunca toma por defecto el establecimiento emisor.

#### Scenario: Motivo libre
- **WHEN** un usuario escribe el motivo "Venta de maquinaria"
- **THEN** la guía lleva ese texto tal cual, sin un código de motivo

#### Scenario: Sin motivo
- **WHEN** un destinatario no tiene motivo al emitir
- **THEN** el sistema rechaza la emisión indicando el destinatario, sin reservar número

#### Scenario: Código declarado para un tercero
- **WHEN** un usuario declara el código de destino 003 para un tercero
- **THEN** la guía lleva el código 003 como declarado por el usuario, sin verificarlo

#### Scenario: Tercero sin código de destino
- **WHEN** un destinatario tercero no tiene código de destino
- **THEN** la guía no lleva código de destino para él, ni el del establecimiento emisor

#### Scenario: Código mal formado
- **WHEN** el código de destino no tiene exactamente 3 dígitos
- **THEN** el sistema lo rechaza indicando el campo

#### Scenario: Ruta
- **WHEN** un usuario escribe la ruta "Quito - Cayambe" para un destinatario y deja vacía la de otro
- **THEN** la guía lleva la ruta solo en el primero

### Requirement: Sustento de cada destinatario
Cada destinatario SHALL llevar exactamente un sustento, de una de dos clases: una factura propia o una excepción declarada por el usuario de las que admite el MVP. La guía no exige una factura a nivel de guía. Un sustento con las dos clases, sin clase o con una clase desconocida se rechaza. La venta itinerante y los comprobantes de venta externos no son sustentos admitidos.

#### Scenario: Clases distintas en una guía
- **WHEN** una guía tiene un destinatario con factura y otro con una excepción declarada
- **THEN** el sistema la acepta

#### Scenario: Sin sustento
- **WHEN** un destinatario no tiene sustento al emitir
- **THEN** el sistema rechaza la emisión indicando el destinatario, sin reservar número

#### Scenario: Comprobante externo
- **WHEN** una solicitud envía para un destinatario el número, la autorización o la fecha de un comprobante escritos a mano
- **THEN** el sistema la rechaza por contener campos no permitidos

#### Scenario: Venta itinerante
- **WHEN** una solicitud declara la excepción de venta itinerante
- **THEN** el sistema la rechaza por estar fuera del alcance actual

### Requirement: Factura como sustento
Una factura sustento SHALL ser una factura emitida por este sistema, de la misma empresa y del mismo ambiente que la guía, autorizada e íntegra. El sistema toma de su documento inmutable el tipo 01, su número, su número de autorización y su fecha de emisión; el usuario no los escribe. Una factura a consumidor final es sustento con un destinatario identificado (política del MVP). La factura no cambia, varias guías la referencian y no hay saldo por despachar.

#### Scenario: Factura autorizada
- **WHEN** un destinatario lleva como sustento una factura autorizada de la empresa
- **THEN** la guía lleva el tipo 01, el número `001-001-000000123` de la factura, su número de autorización de 49 dígitos y su fecha de emisión

#### Scenario: Factura sin autorizar
- **WHEN** la factura elegida está reservada, firmada, recibida, verificando, devuelta, no autorizada o en revisión manual
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Factura de otro ambiente
- **WHEN** la factura se autorizó en Pruebas y la empresa emite la guía en Producción
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Factura alterada
- **WHEN** el snapshot o los artefactos de la factura no están íntegros
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Otro tipo de comprobante
- **WHEN** el sustento elegido es una nota de crédito, una nota de débito, un comprobante de retención u otra guía
- **THEN** el sistema lo rechaza: solo una factura es sustento

#### Scenario: Varias guías de una factura
- **WHEN** dos guías referencian la misma factura con cantidades que, sumadas, superan lo facturado
- **THEN** el sistema emite las dos y la factura no cambia: no hay saldo por despachar

#### Scenario: Destinatario distinto del comprador
- **WHEN** el destinatario es un tercero identificado distinto del comprador de la factura
- **THEN** el sistema acepta la guía

#### Scenario: Factura a consumidor final
- **WHEN** el sustento es una factura autorizada emitida a consumidor final y el destinatario es un tercero identificado
- **THEN** el sistema acepta la guía, y el destinatario es ese tercero, nunca el consumidor final

### Requirement: Excepción declarada
Una excepción declarada SHALL ser un caso del art. 30, numeral 8, del Reglamento que admite el MVP: cantidad o precio determinado después del traslado, consignación, traslado entre establecimientos propios, o exhibición o demostración. Es una declaración del usuario (`USER_DECLARED`): al emitir, el usuario la confirma, y la guía guarda el caso, la versión de la política, el actor y el momento, fuera del XML.

#### Scenario: Consignación declarada
- **WHEN** un usuario emite una guía con un destinatario en consignación y confirma la declaración
- **THEN** la guía guarda el caso, la versión de la política, el usuario y el momento, y su XML no lleva sustento ni la declaración

#### Scenario: Emisión sin confirmar
- **WHEN** una guía con una excepción declarada se emite sin la confirmación de la declaración
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Versión de la política distinta
- **WHEN** la confirmación cita una versión de la política que no es la vigente
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Caso de establecimientos propios con un tercero
- **WHEN** un destinatario tercero declara el traslado entre establecimientos propios
- **THEN** el sistema lo rechaza: ese caso es solo para la propia empresa

#### Scenario: Declaración presentada como del usuario
- **WHEN** un usuario abre una guía con una excepción declarada
- **THEN** la ve como declarada por el usuario que emitió, con su caso y su momento, nunca como verificada por el sistema

### Requirement: Detalle de la guía
Cada detalle SHALL llevar una descripción obligatoria de 1 a 300 caracteres, que identifica lo trasladado con su unidad y sus características, y una cantidad. Puede referir un producto activo de tipo bien, cuyos códigos y nombre se congelan, o ser una línea libre con códigos opcionales de hasta 25 caracteres. No lleva precio, impuesto, total ni detalles adicionales.

#### Scenario: Producto de tipo bien
- **WHEN** un detalle refiere un producto activo de tipo bien
- **THEN** la guía lleva su código principal, su código auxiliar y la descripción del detalle, y un cambio posterior del producto no la altera

#### Scenario: Servicio
- **WHEN** un detalle refiere un producto de tipo servicio
- **THEN** el sistema lo rechaza: un servicio no se traslada

#### Scenario: Producto inactivo
- **WHEN** el producto del detalle está desactivado al emitir
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Línea libre
- **WHEN** un detalle no refiere un producto y tiene la descripción "10 cajas de 12 botellas de 1 litro"
- **THEN** la guía lleva esa descripción, con los códigos solo si el usuario los escribió

#### Scenario: Precio en el detalle
- **WHEN** una solicitud envía un precio, un impuesto o detalles adicionales en un detalle
- **THEN** el sistema la rechaza por contener campos no permitidos

#### Scenario: Descripción fuera de sus límites
- **WHEN** la descripción está vacía o tiene más de 300 caracteres
- **THEN** el sistema rechaza la emisión indicando el detalle, sin reservar número

### Requirement: Precarga desde la factura
El sistema SHALL ofrecer, como sugerencia no autoritativa, las líneas de una factura sustento con sus datos históricos: sugiere marcadas las que hoy se resuelven como un bien activo y ofrece las demás para agregarse como línea libre con sus datos históricos. El tipo vigente del producto no se presenta como la naturaleza de la línea facturada ni decide la elegibilidad. El usuario confirma las mercancías; la guía congela su detalle.

#### Scenario: Sugerencias de la factura
- **WHEN** un usuario carga las mercancías de una factura con dos líneas cuyo producto es hoy un bien activo y una cuyo producto es hoy un servicio
- **THEN** recibe marcadas las dos primeras con su cantidad facturada, y la tercera sin marcar, ofrecida como línea libre con sus datos históricos, sin rotularla como servicio ni como no trasladable

#### Scenario: Línea agregada como libre
- **WHEN** el usuario agrega como línea libre una línea de la factura cuyo producto ya no está activo
- **THEN** el detalle lleva la descripción, los códigos y la cantidad históricos de la línea, editables, sin referencia a un producto

#### Scenario: Cantidad editada
- **WHEN** el usuario reduce la cantidad sugerida de una línea antes de emitir
- **THEN** la guía lleva la cantidad editada y la factura no cambia

#### Scenario: Elegibilidad independiente de los productos
- **WHEN** ninguna línea de una factura autorizada se resuelve hoy como un bien activo
- **THEN** la factura sigue siendo un sustento válido y el usuario escribe las mercancías

### Requirement: Cantidad del detalle
La cantidad SHALL ser un decimal exacto mayor que cero, de hasta 18 dígitos en total y 6 decimales. El sistema la guarda y la escribe en su forma canónica, sin redondearla. Cero, un negativo, más de 6 decimales o más de 18 dígitos se rechazan, aunque el XSD admita cero (política del proyecto).

#### Scenario: Seis decimales
- **WHEN** la cantidad es `10.254632`
- **THEN** la guía lleva `10.254632`

#### Scenario: Cantidad cero
- **WHEN** la cantidad es `0`
- **THEN** el sistema la rechaza como política del proyecto, sin reservar número

#### Scenario: Más de seis decimales
- **WHEN** la cantidad es `1.1234567`
- **THEN** el sistema la rechaza sin redondearla

#### Scenario: Forma canónica
- **WHEN** la cantidad es `2.500`
- **THEN** la guía la guarda y la escribe como `2.5`

#### Scenario: Máximo
- **WHEN** la cantidad es `999999999999.999999`
- **THEN** el sistema la acepta y la escribe completa

### Requirement: Límites de recursos de la guía
El sistema SHALL limitar los destinatarios por guía, los detalles por destinatario y los detalles por guía con valores configurables, y aplicar los tres a la vez. Son defensas de recursos del producto, no límites del SRI ni del XSD, y no se presentan como reglas fiscales. Las rutas que reciben el borrador completo (crearlo y actualizarlo) SHALL admitir un cuerpo JSON de hasta 2 MiB, como defensa de recursos HTTP del proyecto, para que un borrador dentro de los máximos absolutos llegue siempre a estos límites, que se aplican después de leer el cuerpo; las demás rutas JSON sin límite propio conservan el límite global de 100 KB. Ninguno de los dos tamaños es un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47.

#### Scenario: Demasiados destinatarios
- **WHEN** un borrador supera el máximo configurado de destinatarios
- **THEN** el sistema lo rechaza indicando el límite como una defensa del sistema

#### Scenario: Límite global de detalles
- **WHEN** una guía tiene 10 destinatarios con 20 detalles cada uno, dentro del máximo por destinatario de 50, y el máximo de detalles por guía es 100
- **THEN** el sistema la rechaza por el límite de detalles por guía

#### Scenario: Límite configurado
- **WHEN** la instalación configura un máximo de detalles por guía distinto del valor por defecto
- **THEN** el borrador y la emisión aplican el máximo configurado

#### Scenario: Máximos absolutos alcanzables
- **WHEN** la instalación configura los máximos absolutos y un usuario guarda un borrador con 50 destinatarios y 300 detalles, con sus textos en la longitud máxima y en caracteres multibyte
- **THEN** el sistema lo recibe y lo evalúa con los límites de la guía, sin rechazarlo por el tamaño del cuerpo

#### Scenario: Cuerpo demasiado grande
- **WHEN** el cuerpo de una solicitud que guarda un borrador supera 2 MiB
- **THEN** el sistema la rechaza por tamaño antes de evaluarla, como defensa de recursos HTTP

#### Scenario: Límite estructural dentro del cuerpo admitido
- **WHEN** un borrador de menos de 2 MiB tiene 301 detalles
- **THEN** el sistema lo rechaza por el límite de detalles por guía, no por el tamaño del cuerpo

#### Scenario: Las demás rutas conservan su límite
- **WHEN** una solicitud a otra ruta JSON de la API sin límite propio, incluida la emisión de la guía, tiene un cuerpo de más de 100 KB
- **THEN** el sistema la rechaza por tamaño

### Requirement: Borrador y vista previa de la guía
Un usuario SHALL preparar la guía en un borrador: el punto de emisión, el transportista, la placa, la dirección de partida, las fechas y los destinatarios con su sustento y su detalle. La vista previa del servidor muestra los problemas que bloquean junto a su destinatario o su detalle, y los datos de cada factura sustento. El borrador no reserva número.

#### Scenario: Vista previa con problemas
- **WHEN** un usuario guarda un borrador con un destinatario sin motivo y un detalle con cantidad cero
- **THEN** la vista previa lista cada problema junto a su destinatario y su detalle, y la emisión queda bloqueada

#### Scenario: Borrador incompleto
- **WHEN** un usuario guarda un borrador sin transportista ni destinatarios
- **THEN** el borrador se guarda, no reserva número y la vista previa informa lo que falta

#### Scenario: Versión del borrador
- **WHEN** un usuario emite con una versión del borrador que otro cambio ya reemplazó
- **THEN** el sistema rechaza la emisión indicando que el borrador cambió, sin reservar número

### Requirement: Reserva de la guía sin efectos parciales
Antes de reservar, el sistema SHALL comprobar el transportista, la placa, las fechas, la dirección de partida, los destinatarios con su sustento y su detalle, la declaración de las excepciones, los límites y la preparación de la empresa y del esquema, sin consumir nada. La reserva crea en una sola operación el secuencial, la clave, el snapshot, el comprobante y su auditoría. Si un paso falla, no queda nada.

#### Scenario: Rechazo antes de reservar
- **WHEN** una emisión se rechaza por el transportista, una fecha, un destinatario, un sustento, un detalle o la preparación de la empresa
- **THEN** no se consume secuencial, no se crea clave ni comprobante, no se firma y no se llama al SRI

#### Scenario: Fallo dentro de la reserva
- **WHEN** la reserva de una guía falla después de reservar su secuencial y antes de confirmarse
- **THEN** no queda número consumido, clave, comprobante, snapshot, destinatarios ni auditoría

#### Scenario: Firma fuera de la reserva
- **WHEN** una guía se reserva y después su firma falla
- **THEN** sigue reservada, y un reintento la firma con su mismo número y su misma clave

### Requirement: Datos congelados en la guía
Desde su reserva, la guía SHALL contener en su snapshot el emisor, el punto, la fecha de emisión, la partida con su establecimiento de origen cuando lo hay, el transportista con su origen, tipo, identificación y razón social, la placa, las fechas y cada destinatario con su identificación, razón social, dirección, establecimiento de destino, motivo, ruta, código de destino, sustento y detalle. Su XML, su RIDE y su consulta nunca releen el tercero, la empresa, el establecimiento, el producto ni la factura.

#### Scenario: Transportista cambiado después de reservar
- **WHEN** el tercero transportista corrige su nombre o pierde el rol de transportista después de reservar una guía
- **THEN** el XML y el RIDE llevan el transportista del snapshot

#### Scenario: Establecimientos cambiados después de reservar
- **WHEN** se corrige la dirección del establecimiento de origen o del de destino de un traslado propio después de reservar
- **THEN** la guía conserva las direcciones con las que se reservó

### Requirement: Emisión idempotente de la guía
La emisión SHALL exigir una `Idempotency-Key` y registrar, por empresa, operación y clave, la huella canónica de la solicitud, que cubre el borrador, su versión, todos sus datos funcionales y la confirmación de la declaración. La misma clave con la misma huella devuelve la misma guía; con otra huella se rechaza. El registro no vence.

#### Scenario: Doble envío
- **WHEN** un usuario envía dos veces la misma emisión con la misma clave, una después de la otra o a la vez
- **THEN** existe una sola guía con un solo número, y ambas respuestas la devuelven

#### Scenario: Repetición después de reservar
- **WHEN** la primera emisión quedó reservada sin firmar y el usuario la repite con la misma clave
- **THEN** el sistema devuelve la misma guía y reanuda su firma, sin reservar otro número

#### Scenario: Clave reutilizada
- **WHEN** un usuario reutiliza la clave con otro borrador, otra versión u otros destinatarios
- **THEN** el sistema rechaza la solicitud con un conflicto, sin reservar número

#### Scenario: Sin clave
- **WHEN** una emisión llega sin `Idempotency-Key`
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Guía sin efectos en otros registros
Una guía de remisión MUST NOT reservar, descontar, devolver ni ajustar stock, crear movimientos de inventario, cambiar una factura ni su capacidad acreditable, ni asignar roles a un tercero, en ningún estado.

#### Scenario: Guía de un producto con inventario
- **WHEN** una guía de un producto con control de stock se autoriza, se devuelve o queda no autorizada
- **THEN** ningún saldo ni movimiento de inventario cambia

#### Scenario: Factura y terceros intactos
- **WHEN** se emite y se autoriza una guía con una factura sustento y destinatarios sin roles
- **THEN** la factura, su capacidad acreditable y los roles de los terceros no cambian

### Requirement: Consulta de guías
Un usuario autorizado SHALL listar, buscar y ver las guías de su empresa. La lista muestra el número, el transportista, los destinatarios (el nombre del único o "N destinatarios"), las fechas del transporte y el estado, sin importes. El detalle muestra todos los destinatarios con su sustento y su detalle, la transmisión y los documentos.

#### Scenario: Detalle de una guía
- **WHEN** un usuario abre una guía autorizada con tres destinatarios
- **THEN** ve su número, el transportista, la placa, las fechas, la dirección de partida y los tres destinatarios con su sustento y su detalle

#### Scenario: Búsqueda y filtros
- **WHEN** un usuario busca por número, por transportista o por la identificación de cualquiera de los destinatarios y filtra por estado
- **THEN** la lista contiene solo las guías que coinciden, paginadas

### Requirement: Reintento de firma de una guía
Un usuario con permiso SHALL poder reintentar la firma de una guía reservada. El reintento la firma con su mismo número, su misma clave, su misma fecha de emisión y su mismo snapshot.

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de una guía reservada cuya firma falló
- **THEN** queda firmada con su mismo número y su misma clave

### Requirement: Permisos de guías
Administradores y operadores SHALL poder consultar, preparar, emitir y reintentar la firma de guías. Solo el administrador SHALL poder pedir su reconciliación manual. Cada operación exige su permiso en el servidor antes de leer o escribir.

#### Scenario: Operador que emite
- **WHEN** un operador emite una guía
- **THEN** el sistema la emite

#### Scenario: Operador que reconcilia
- **WHEN** un operador pide la reconciliación de una guía
- **THEN** el sistema responde prohibido

#### Scenario: Sin permiso o sin sesión
- **WHEN** un usuario sin el permiso o sin sesión intenta preparar, emitir o consultar una guía
- **THEN** el sistema responde prohibido o no autenticado, sin leer ni escribir

### Requirement: Aislamiento de las guías por empresa
Las guías, sus borradores, sus transportistas, sus destinatarios y sus sustentos SHALL pertenecer a una empresa. La empresa sale siempre de la sesión, y un usuario de otra empresa no puede leer, cambiar ni detectar una guía, un borrador, un tercero, un establecimiento, un producto ni una factura ajenos.

#### Scenario: Guía de otra empresa
- **WHEN** un usuario consulta, reintenta o reconcilia una guía de otra empresa
- **THEN** el sistema responde que no existe, igual que para una guía inexistente

#### Scenario: Referencias de otra empresa
- **WHEN** un usuario prepara una guía con el identificador de un tercero, un establecimiento, un producto o una factura de otra empresa
- **THEN** el sistema responde que no existe, sin revelar que existe en otra empresa

#### Scenario: Empresa en el cuerpo
- **WHEN** una solicitud envía un `companyId` en el cuerpo
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: Casos especiales fuera del alcance de la guía
La guía MUST NOT ofrecer ni aceptar documento aduanero, identificación del exterior, varios vehículos, detalles adicionales, información adicional ni datos de máquina fiscal, ni datos parciales para ellos, y su XML no los escribe ni escribe `rise`. Los combustibles, la factura sustitutiva, el emisor itinerante, la interrupción del transporte y las guías emitidas por terceros quedan fuera del alcance.

#### Scenario: Documento aduanero
- **WHEN** una solicitud envía un número de declaración aduanera para un destinatario
- **THEN** el sistema la rechaza por contener campos no permitidos

#### Scenario: XML sin estructuras especiales
- **WHEN** se firma una guía
- **THEN** su XML no lleva documento aduanero, detalles adicionales, información adicional, máquina fiscal ni `rise`
