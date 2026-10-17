# purchase-settlements Specification

## Purpose

Documentar con una liquidación de compra 1.1.0 la adquisición de bienes muebles o servicios que la empresa hace, como adquirente, a una persona natural que por su nivel cultural o rusticidad no puede emitir comprobantes de venta (caso c) del art. 13 del Reglamento de Comprobantes de Venta), con su proveedor, sus líneas con IVA, sus pagos y las declaraciones de procedencia del usuario.

## Requirements

### Requirement: Liquidación de compra
El sistema SHALL emitir la liquidación de compra de bienes y prestación de servicios 1.1.0 (`codDoc` 03) de la empresa como adquirente, con su secuencial independiente, su clave de acceso, su snapshot inmutable y un XML construido solo desde el snapshot y validado contra el esquema registrado. Su fecha de emisión es la fecha fiscal de Ecuador fijada al reservar, sin una ventana propia del tipo 03.

#### Scenario: Liquidación emitida
- **WHEN** un usuario emite una liquidación válida a un proveedor con cédula, con dos líneas y un pago
- **THEN** la liquidación queda firmada con su número, su clave de acceso y su XML de tipo 03, validado contra el esquema antes y después de firmar

#### Scenario: Fecha de emisión de la reserva
- **WHEN** un borrador preparado un día se emite al día siguiente
- **THEN** la liquidación lleva la fecha de emisión del día de la reserva, la misma de su clave de acceso

#### Scenario: Solo desde el snapshot
- **WHEN** se construye el XML de una liquidación reservada
- **THEN** el XML sale solo de su snapshot, sin leer el tercero, el producto, el catálogo ni la configuración vigentes

### Requirement: Procedencia de la liquidación de compra
El sistema SHALL emitir una liquidación de compra solo en el caso c) del art. 13 del Reglamento de Comprobantes de Venta, con la política `PURCHASE_SETTLEMENT_ELIGIBILITY_V1` (`ART_13_C_RUSTICITY_NO_ACTIVE_RUC`): compras de bienes muebles o servicios a una persona natural no obligada a llevar contabilidad, sin RUC o con RUC suspendido, que por su nivel cultural o rusticidad no puede emitir comprobantes. MUST NOT ser una alternativa genérica a la factura ni soportar otro caso, ni en parte.

#### Scenario: Caso c) declarado
- **WHEN** un usuario emite una liquidación confirmando las cuatro declaraciones del caso c)
- **THEN** la liquidación guarda el caso de procedencia `ART_13_C` y la versión 1 de la política

#### Scenario: Otro caso oficial
- **WHEN** una solicitud intenta emitir una liquidación por servicios de un no residente, con reembolsos o para un organismo del sector público
- **THEN** el sistema la rechaza por estar fuera del alcance, sin campos parciales para ese caso

#### Scenario: Proveedor con RUC
- **WHEN** un usuario elige como proveedor a un tercero identificado con RUC
- **THEN** el sistema lo rechaza: la liquidación del MVP no reemplaza el comprobante de un proveedor inscrito

### Requirement: Declaraciones de procedencia
Antes de reservar, quien emite SHALL confirmar por separado las cuatro declaraciones de la versión vigente de la política, cada una con su identificador y su texto: `NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING`, `NO_RUC_OR_SUSPENDED_RUC`, `UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY` y `MOVABLE_GOODS_OR_SERVICES_TRANSACTION`. Sin las cuatro, el sistema no reserva número. No existe una confirmación genérica que las reemplace.

#### Scenario: Cuatro declaraciones separadas
- **WHEN** un usuario va a emitir una liquidación
- **THEN** confirma por separado "El proveedor es una persona natural no obligada a llevar contabilidad.", "El proveedor no está inscrito en el RUC o tiene su RUC suspendido a la fecha de la transacción.", "Por su nivel cultural o rusticidad, el proveedor no puede emitir comprobantes de venta." y "La operación corresponde a la adquisición de bienes muebles o servicios."

#### Scenario: Declaración faltante
- **WHEN** un usuario emite una liquidación confirmando solo tres de las cuatro declaraciones
- **THEN** el sistema la rechaza indicando la declaración que falta, sin reservar número

#### Scenario: Versión de la política distinta
- **WHEN** un usuario emite citando una versión de la política que no es la vigente
- **THEN** el sistema la rechaza sin reservar número

#### Scenario: Declaración desconocida
- **WHEN** una solicitud envía una declaración que no pertenece a la política
- **THEN** el sistema la rechaza por contener datos no permitidos

### Requirement: Declaraciones congeladas y nunca verificadas
Cada declaración SHALL congelarse al reservar con su identificador, la versión de la política, la base declarada por el usuario (`USER_DECLARED`), el actor y el momento, en la liquidación y en la huella de idempotencia. El sistema MUST NOT presentarlas como verificadas ni consultar el estado del RUC, y las declaraciones no van al XML.

#### Scenario: Cuatro declaraciones confirmadas
- **WHEN** un usuario emite una liquidación confirmando las cuatro declaraciones de la versión vigente
- **THEN** la liquidación guarda cada declaración con su identificador, la versión, la base declarada por el usuario, el usuario y el momento de la reserva

#### Scenario: Declaradas, nunca verificadas
- **WHEN** un usuario consulta una liquidación emitida
- **THEN** las cuatro declaraciones figuran como declaradas por el usuario, con su autor y su momento, sin ninguna indicación de que el sistema las haya verificado

#### Scenario: Declaraciones fuera del XML
- **WHEN** se construye el XML de una liquidación
- **THEN** el XML no contiene las declaraciones, el actor ni el momento

### Requirement: Proveedor de la liquidación
El proveedor SHALL ser un tercero activo de la empresa con el rol de proveedor, identificado con cédula (05) o pasaporte (06), y se congela al reservar. La liquidación MUST NOT asignar el rol a un tercero existente; el alta en línea de uno nuevo permite marcarlo de forma explícita. El RUC (04), el consumidor final (07) y la identificación del exterior (08) se rechazan como restricción del MVP que materializa el caso c), no como prohibición de la norma para toda liquidación.

#### Scenario: Proveedor con cédula
- **WHEN** un usuario elige un tercero activo con el rol de proveedor e identificado con cédula
- **THEN** la liquidación lleva su tipo de identificación 05, su cédula y su nombre

#### Scenario: Proveedor con pasaporte
- **WHEN** el proveedor está identificado con pasaporte
- **THEN** la liquidación lleva el tipo 06 y su pasaporte

#### Scenario: Tercero sin el rol de proveedor
- **WHEN** un usuario elige un tercero activo sin el rol de proveedor
- **THEN** el sistema lo rechaza indicando que se configure el rol, y no se lo asigna

#### Scenario: Consumidor final
- **WHEN** un usuario elige el consumidor final como proveedor
- **THEN** el sistema lo rechaza: la liquidación de compra no admite consumidor final

#### Scenario: Identificación del exterior
- **WHEN** un usuario elige un tercero identificado con una identificación del exterior
- **THEN** el sistema lo rechaza por estar fuera del alcance del MVP

#### Scenario: Proveedor inactivo o de otra empresa
- **WHEN** el proveedor está desactivado o pertenece a otra empresa
- **THEN** el sistema rechaza la emisión sin reservar número, y uno de otra empresa responde como inexistente

#### Scenario: Alta en línea
- **WHEN** un usuario registra un proveedor nuevo desde la liquidación marcando el rol de proveedor
- **THEN** el tercero queda registrado con ese rol y elegido como proveedor

#### Scenario: Proveedor cambiado después de reservar
- **WHEN** el tercero se corrige después de reservar la liquidación
- **THEN** el XML y el RIDE de la liquidación conservan el proveedor congelado

### Requirement: Dirección del proveedor
Cada liquidación SHALL llevar la dirección del proveedor, obligatoria en el MVP: texto de 1 a 300 caracteres, sin saltos de línea, con los extremos recortados. El borrador la propone desde la dirección del tercero al elegirlo y el usuario puede corregirla; la dirección congelada al reservar es la que llevan el XML y el RIDE.

#### Scenario: Dirección propuesta
- **WHEN** un usuario elige un proveedor que tiene dirección
- **THEN** el borrador propone esa dirección como dirección del proveedor

#### Scenario: Sin dirección
- **WHEN** un usuario emite una liquidación sin dirección del proveedor
- **THEN** el sistema rechaza la emisión indicando el campo, sin reservar número

#### Scenario: Dirección demasiado larga
- **WHEN** la dirección tiene 301 caracteres después de recortar los extremos
- **THEN** el sistema la rechaza indicando el campo

### Requirement: Líneas de la liquidación
Cada liquidación SHALL tener una o más líneas. Una línea puede referir un producto activo de la empresa, solo como conveniencia para sugerir su código y su nombre, o ser una línea libre. El precio unitario es siempre el de la operación y MUST NOT tomarse del producto.

#### Scenario: Línea con producto
- **WHEN** un usuario agrega una línea con un producto que tiene código principal
- **THEN** la línea propone ese código y su nombre, y el usuario escribe el precio de la compra

#### Scenario: Línea libre
- **WHEN** un usuario agrega una línea sin producto con la descripción "Saco de cacao en grano, 45 kg"
- **THEN** la liquidación lleva esa descripción, con códigos solo si el usuario los escribió

#### Scenario: Precio del producto ignorado
- **WHEN** el producto de una línea tiene un precio de venta distinto del precio escrito
- **THEN** la liquidación lleva el precio escrito para esta operación

#### Scenario: Producto inactivo
- **WHEN** el producto de una línea está desactivado al emitir
- **THEN** el sistema rechaza la emisión indicando la línea, sin reservar número

### Requirement: Datos de cada línea
Cada línea SHALL llevar el código principal y el auxiliar cuando existan (hasta 25 caracteres), una descripción de 1 a 300 caracteres, la unidad de medida cuando corresponda (hasta 50), la cantidad (mayor que cero, hasta 18 dígitos y 6 decimales), el precio unitario (desde cero, hasta 18 dígitos y 6 decimales), el descuento (de 0.00 al subtotal de la línea, siempre presente) y su tarifa de IVA. Los textos no admiten saltos de línea. No lleva precio sin subsidio ni detalles adicionales.

#### Scenario: Descuento cero materializado
- **WHEN** una línea no tiene descuento
- **THEN** su XML lleva el descuento 0.00

#### Scenario: Descuento mayor que el subtotal
- **WHEN** el descuento de una línea supera su cantidad por su precio unitario
- **THEN** el sistema rechaza la emisión indicando la línea, sin reservar número

#### Scenario: Cantidad cero o con siete decimales
- **WHEN** la cantidad de una línea es 0 o tiene 7 decimales
- **THEN** el sistema la rechaza indicando la línea, sin redondearla

#### Scenario: Línea con datos no permitidos
- **WHEN** una solicitud envía un precio sin subsidio, detalles adicionales o un impuesto distinto del IVA en una línea
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: IVA de la liquidación
Cada línea SHALL llevar solo IVA: su código de tarifa y su porcentaje salen del catálogo de tarifas de IVA vigente en la fecha de emisión y se congelan con la referencia de su entrada de catálogo. La liquidación MUST NOT llevar ICE, IRBPNR ni reembolsos. Las tarifas del 0 %, no objeto y exento conservan su semántica propia, como en la factura.

#### Scenario: Tarifa del catálogo
- **WHEN** un usuario elige para una línea la tarifa de IVA vigente del 15 %
- **THEN** la liquidación lleva el código de la tarifa, el porcentaje 15 y la referencia de la entrada del catálogo vigente en la fecha de emisión

#### Scenario: Tarifa no vigente en la fecha de emisión
- **WHEN** la tarifa elegida no está vigente en la fecha de la reserva
- **THEN** el sistema rechaza la emisión indicando la línea, sin reservar número

#### Scenario: Tarifa cambiada después de reservar
- **WHEN** el catálogo cambia después de reservar la liquidación
- **THEN** el XML y el RIDE conservan la tarifa congelada

### Requirement: Cálculo de la liquidación
El sistema SHALL calcular los importes en el servidor, con decimales exactos y un cálculo versionado que es la única autoridad de la vista previa, el snapshot, el XML y el RIDE: el subtotal y la base de cada línea, su IVA, la base y el IVA por tarifa, el total sin impuestos, el total de descuentos y el importe total (total sin impuestos más IVA). Redondea a 2 decimales con HALF_UP en los mismos puntos que la factura. Los totales que envíe el cliente MUST NOT usarse.

#### Scenario: Totales de una liquidación
- **WHEN** una liquidación tiene una línea de 10 unidades a 4.50 con un descuento de 5.00 al 15 % y otra de 2 unidades a 30.00 al 0 %
- **THEN** su total sin impuestos es 100.00, el total de descuentos 5.00, el IVA 15 % de 6.00 sobre una base de 40.00, la base al 0 % de 60.00 y el importe total 106.00

#### Scenario: Seis decimales exactos
- **WHEN** una línea tiene una cantidad de 1.333333 y un precio unitario de 3.000003
- **THEN** su base se calcula sobre el producto exacto y se redondea una sola vez a 2 decimales

#### Scenario: Totales del cliente ignorados
- **WHEN** una solicitud envía un total distinto del que resulta de sus líneas
- **THEN** el sistema la rechaza por contener campos no permitidos, y la vista previa muestra el total calculado

#### Scenario: Misma autoridad en todas las salidas
- **WHEN** se compara la vista previa de un borrador con el snapshot, el XML y el RIDE de la liquidación emitida
- **THEN** sus importes son idénticos

### Requirement: Pagos de la liquidación
Cada liquidación SHALL tener uno o más pagos, cada uno con su forma de pago del catálogo oficial, su total (desde 0.00, hasta 14 dígitos y 2 decimales), su plazo (desde cero, hasta 14 dígitos y 2 decimales) y su unidad de tiempo (1 a 10 caracteres, sin saltos de línea), todos capturados por el usuario: el sistema no inventa un plazo ni una unidad por defecto. La suma de los pagos MUST ser exactamente el importe total, sin tolerancia. La moneda es `DOLAR`, política monetaria del proyecto.

#### Scenario: Dos pagos
- **WHEN** una liquidación de 106.00 tiene un pago en efectivo de 50.00 a 0 días y otro por transferencia de 56.00 a 30 días
- **THEN** su XML lleva los dos pagos con su forma de pago, su total, su plazo y su unidad de tiempo

#### Scenario: Suma distinta del importe total
- **WHEN** los pagos suman 105.99 y el importe total es 106.00
- **THEN** el sistema rechaza la emisión indicando la diferencia, sin reservar número

#### Scenario: Pago sin plazo o sin unidad de tiempo
- **WHEN** un pago no tiene plazo o no tiene unidad de tiempo
- **THEN** el sistema rechaza la emisión indicando el pago, sin reservar número

#### Scenario: Sin pagos
- **WHEN** una liquidación no tiene pagos
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Forma de pago fuera del catálogo
- **WHEN** un pago usa una forma de pago que no está en el catálogo
- **THEN** el sistema lo rechaza indicando el pago

#### Scenario: Moneda
- **WHEN** se construye el XML de una liquidación
- **THEN** el XML lleva la moneda `DOLAR`

### Requirement: Aviso de la retención
Después de la vista previa y en el detalle de una liquidación, el sistema SHALL mostrar el aviso "Esta operación requiere la retención correspondiente conforme a la normativa aplicable." La liquidación MUST NOT emitir, precargar ni esperar un comprobante de retención, ni presentar el aviso como evidencia de que la retención ya se emitió, ni fusionar su XML con el de la retención.

#### Scenario: Aviso en la vista previa y en el detalle
- **WHEN** un usuario revisa la vista previa de un borrador o el detalle de una liquidación
- **THEN** ve el aviso de la retención, sin ninguna indicación de que la retención exista

#### Scenario: Emisión sin retención previa
- **WHEN** un usuario emite una liquidación sin haber emitido ningún comprobante de retención
- **THEN** la liquidación se emite normalmente y no se crea ningún comprobante de retención

### Requirement: Límites de recursos de la liquidación
El sistema SHALL limitar las líneas por liquidación (100 por defecto, configurable hasta 500) y los pagos por liquidación (10 por defecto, configurable hasta 20). Son defensas de recursos del producto, no límites del SRI ni del XSD, y no se presentan como reglas fiscales.

#### Scenario: Demasiadas líneas
- **WHEN** un borrador supera el máximo configurado de líneas
- **THEN** el sistema lo rechaza indicando el límite como una defensa del sistema

#### Scenario: Demasiados pagos
- **WHEN** un borrador supera el máximo configurado de pagos
- **THEN** el sistema lo rechaza indicando el límite como una defensa del sistema

### Requirement: Cuerpo del borrador de la liquidación
Las solicitudes que guardan el borrador completo (crearlo y actualizarlo) SHALL admitir un cuerpo JSON de hasta 4 MiB, para que un borrador dentro de los máximos llegue siempre a los límites de recursos, que se aplican después de leer el cuerpo. Las demás rutas JSON sin límite propio, también la emisión, conservan el límite global de 100 KB. Es una defensa de recursos HTTP del proyecto, no un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47.

#### Scenario: Máximos alcanzables
- **WHEN** la instalación configura los máximos y un usuario guarda un borrador con 500 líneas y 20 pagos, con sus textos en la longitud máxima y en caracteres multibyte
- **THEN** el sistema lo recibe y lo evalúa con los límites de recursos, sin rechazarlo por el tamaño del cuerpo

#### Scenario: Cuerpo demasiado grande
- **WHEN** el cuerpo de una solicitud que guarda un borrador supera 4 MiB
- **THEN** el sistema la rechaza por tamaño antes de evaluarla

#### Scenario: Las demás rutas conservan su límite
- **WHEN** una solicitud a otra ruta JSON de la API sin límite propio, incluida la emisión de la liquidación, tiene un cuerpo de más de 100 KB
- **THEN** el sistema la rechaza por tamaño

### Requirement: Borrador y vista previa de la liquidación
Un usuario SHALL preparar la liquidación en un borrador: el punto de emisión, el proveedor y su dirección, las líneas y los pagos. La vista previa del servidor muestra los importes calculados, los problemas que bloquean junto a su línea o su pago, las cuatro declaraciones que se confirmarán al emitir y el aviso de la retención. El borrador no reserva número.

#### Scenario: Vista previa con problemas
- **WHEN** un usuario guarda un borrador con una línea sin descripción y pagos que no suman el importe total
- **THEN** la vista previa lista cada problema junto a su línea o su pago, y la emisión queda bloqueada

#### Scenario: Borrador incompleto
- **WHEN** un usuario guarda un borrador sin proveedor ni líneas
- **THEN** el borrador se guarda, no reserva número y la vista previa informa lo que falta

#### Scenario: Versión del borrador
- **WHEN** un usuario emite con una versión del borrador que otro cambio ya reemplazó
- **THEN** el sistema rechaza la emisión indicando que el borrador cambió, sin reservar número

### Requirement: Reserva de la liquidación sin efectos parciales
La reserva de una liquidación SHALL ocurrir en una sola transacción, sin I/O externo: el secuencial, la clave, el comprobante, el registro de la liquidación con su proveedor y sus cuatro declaraciones, el borrador emitido, el registro de idempotencia y la auditoría. Si cualquier paso falla, no queda nada de lo anterior. Las comprobaciones que no consumen número ocurren antes.

#### Scenario: Fallo dentro de la reserva
- **WHEN** la reserva falla después de reservar el secuencial y antes de confirmar
- **THEN** no quedan secuencial consumido, clave, comprobante, registro, declaraciones, borrador emitido, idempotencia ni auditoría

#### Scenario: Rechazo antes de reservar
- **WHEN** la emisión falla por una declaración faltante, un proveedor inválido o pagos que no suman
- **THEN** no se consume secuencial, clave, firma ni llamada al SRI

#### Scenario: Una liquidación sin sus declaraciones
- **WHEN** algo intenta guardar una liquidación sin su registro o sin sus cuatro declaraciones
- **THEN** la base de datos rechaza la confirmación

### Requirement: Datos congelados en la liquidación
Al reservar, el snapshot SHALL congelar el emisor, el establecimiento y el punto; el proveedor con su dirección; la procedencia con sus cuatro declaraciones; las líneas con su producto opcional, sus códigos, su texto, sus cantidades, su precio y su descuento; el IVA con su referencia de catálogo; el cálculo y su versión; los pagos con su plazo y su unidad; la moneda; la numeración y la clave; y las versiones del esquema, del builder y de los catálogos. Después, el XML y el RIDE salen solo de él.

#### Scenario: Producto cambiado después de reservar
- **WHEN** el producto de una línea cambia de código o nombre después de reservar
- **THEN** el XML y el RIDE conservan los datos congelados de la línea

#### Scenario: Reintento de firma con los mismos datos
- **WHEN** se reintenta la firma de una liquidación reservada
- **THEN** se firma el mismo snapshot con el mismo número, la misma clave y la misma fecha de emisión

### Requirement: Emisión idempotente de la liquidación
La emisión SHALL exigir `Idempotency-Key` y una huella canónica de todos los datos funcionales del borrador y de la versión de la política con las cuatro declaraciones, por empresa y clave, sin caducidad. La misma clave con la misma huella devuelve la misma liquidación; con otra huella, un conflicto; dos emisiones simultáneas del mismo borrador dejan una sola liquidación.

#### Scenario: Repetición con la misma clave
- **WHEN** un usuario repite una emisión con la misma clave y los mismos datos
- **THEN** recibe la misma liquidación, sin un segundo número

#### Scenario: Misma clave con otras declaraciones
- **WHEN** la misma clave se usa con otra versión de la política o con otro conjunto de declaraciones
- **THEN** el sistema responde un conflicto de clave reutilizada

#### Scenario: Emisiones simultáneas del mismo borrador
- **WHEN** dos emisiones del mismo borrador con claves distintas llegan a la vez
- **THEN** queda una sola liquidación y la otra emisión responde que el borrador ya se emitió

#### Scenario: Sin clave
- **WHEN** una emisión no envía `Idempotency-Key`
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Liquidación sin efectos en otros registros
Una liquidación SHALL NOT crear, reservar, aumentar ni ajustar stock ni movimientos de inventario, aunque una línea tenga un producto bien; tampoco crear órdenes de compra, cuentas por pagar, facturas recibidas ni comprobantes de retención, ni modificar terceros, productos o facturas.

#### Scenario: Línea con un producto bien con control de stock
- **WHEN** se autoriza una liquidación con una línea de un producto bien con control de stock
- **THEN** el saldo y los movimientos de inventario no cambian

#### Scenario: Sin compras ni retención
- **WHEN** se autoriza una liquidación
- **THEN** no existen una compra, una cuenta por pagar, una factura recibida ni un comprobante de retención creados por ella

### Requirement: Consulta de liquidaciones
Un usuario SHALL consultar las liquidaciones de su empresa con su número, su proveedor, su fecha, su importe total y su estado, buscarlas por número o por la identificación o el nombre del proveedor, filtrarlas por estado y abrir su detalle con las líneas, el IVA, los pagos, las declaraciones, el aviso de la retención, la transmisión y los documentos.

#### Scenario: Búsqueda por proveedor
- **WHEN** un usuario busca por la cédula de un proveedor
- **THEN** encuentra las liquidaciones de ese proveedor

#### Scenario: Detalle desde el snapshot
- **WHEN** un usuario abre una liquidación emitida
- **THEN** ve los datos congelados, no los vigentes del tercero, del producto o del catálogo

### Requirement: Reintento de firma de una liquidación
Un usuario con permiso SHALL reintentar la firma de una liquidación que quedó reservada, con su mismo número, su misma clave y su misma fecha de emisión.

#### Scenario: Liquidación reservada sin firmar
- **WHEN** un usuario reintenta la firma de una liquidación que quedó reservada
- **THEN** la liquidación queda firmada con el mismo número y la misma clave

### Requirement: Permisos de liquidaciones
`purchaseSettlements.read`, `purchaseSettlements.draft`, `purchaseSettlements.emit` y `purchaseSettlements.retrySigning` SHALL corresponder al administrador y al operador, y `purchaseSettlements.reconcile` solo al administrador. Las comprobaciones ocurren en el servidor, con la empresa de la sesión.

#### Scenario: Operador emite
- **WHEN** un operador prepara y emite una liquidación válida
- **THEN** la liquidación queda emitida

#### Scenario: Sin permiso
- **WHEN** un usuario sin el permiso correspondiente intenta preparar, emitir, consultar o reintentar
- **THEN** el sistema responde 403 sin cambiar nada

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión llama a una ruta de liquidaciones
- **THEN** el sistema responde 401

#### Scenario: Reconciliación reservada al administrador
- **WHEN** un operador solicita la reconciliación manual de una liquidación
- **THEN** el sistema responde 403

### Requirement: Aislamiento de las liquidaciones por empresa
Toda lectura y escritura de liquidaciones, borradores, proveedores y productos SHALL limitarse a la empresa de la sesión. Un identificador de otra empresa responde como inexistente; el cuerpo de una solicitud no puede elegir la empresa.

#### Scenario: Liquidación de otra empresa
- **WHEN** un usuario consulta, reintenta o reconcilia una liquidación de otra empresa
- **THEN** el sistema responde 404, sin revelar que existe

#### Scenario: Proveedor o producto de otra empresa
- **WHEN** un borrador usa un proveedor o un producto de otra empresa
- **THEN** el sistema responde como inexistente

#### Scenario: Empresa en el cuerpo
- **WHEN** una solicitud envía un `companyId`
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: Casos especiales fuera del alcance de la liquidación
La liquidación MUST NOT ofrecer ni aceptar reembolsos, máquina fiscal, negociable, precio sin subsidio, detalles adicionales, información adicional, ICE, IRBPNR, identificación del exterior ni datos parciales para ellos, y su XML no los escribe.

#### Scenario: Reembolso
- **WHEN** una solicitud envía datos de reembolso en una liquidación
- **THEN** el sistema la rechaza por contener campos no permitidos

#### Scenario: XML sin bloques especiales
- **WHEN** se construye el XML de cualquier liquidación
- **THEN** no contiene `reembolsos`, `maquinaFiscal`, `tipoNegociable`, `precioSinSubsidio`, `detallesAdicionales` ni `infoAdicional`

### Requirement: Borradores en la lista de liquidaciones de compra
La lista de liquidaciones de compra SHALL mostrar, con el filtro de estado en «Todos», primero los borradores de
liquidación de compra de la empresa, el último editado arriba, y después los comprobantes emitidos en su orden de
siempre, en la misma tabla, la misma paginación y el mismo total que entrega el servidor. Cada
borrador SHALL mostrar el estado «Borrador», el proveedor, su total previo o «Incompleto» y la fecha de su última edición, y SHALL
abrir su editor desde la fila y poder eliminarse con confirmación. El filtro de estado SHALL ofrecer
«Borradores», que muestra solo los borradores; un estado de liquidación emitida SHALL excluirlos. La búsqueda SHALL
encontrar también los borradores por lo que muestran. Solo quien puede preparar borradores de
liquidación de compra SHALL verlos. Ninguna otra pantalla de la lista SHALL repetir los borradores en un panel aparte.

#### Scenario: Borradores arriba
- **WHEN** la empresa tiene dos borradores de liquidación de compra y treinta comprobantes emitidos, y un operador abre Liquidaciones de compra con 25 filas por página
- **THEN** la primera página muestra los dos borradores con el estado «Borrador» y después 23 comprobantes emitidos, y la lista indica 32 en total

#### Scenario: Solo borradores
- **WHEN** un operador elige el estado «Borradores»
- **THEN** ve solo los borradores de liquidación de compra de su empresa, paginados, y ningún comprobante emitido

#### Scenario: Un estado emitido los excluye
- **WHEN** un operador elige un estado de comprobante emitido
- **THEN** la lista no muestra borradores

#### Scenario: Búsqueda sobre borradores
- **WHEN** un operador busca el nombre de un proveedor que solo tiene un borrador
- **THEN** ve ese borrador con el estado «Borrador»

#### Scenario: Abrir y eliminar desde la fila
- **WHEN** un operador elige un borrador de la lista
- **THEN** se abre su editor, y desde las acciones de la fila puede eliminarlo después de confirmar

#### Scenario: Borradores de otra empresa
- **WHEN** otra empresa de la instalación tiene borradores de liquidación de compra
- **THEN** ninguno aparece en la lista ni cuenta en su total
