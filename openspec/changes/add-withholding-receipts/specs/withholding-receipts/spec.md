# Spec Delta

## Purpose

Acreditar con un comprobante de retención 2.0.0 las retenciones del impuesto a la renta y del IVA que la empresa practica a un proveedor residente, sobre uno o más documentos sustento externos, con porcentajes del catálogo oficial y un cálculo exacto.

## ADDED Requirements

### Requirement: Sujeto retenido
El sujeto retenido SHALL ser un tercero de la empresa, activo, con el rol de proveedor e identificado con RUC, cédula o pasaporte. El consumidor final MUST NOT ser sujeto retenido: la ficha técnica v2.34 exige identificar al sujeto retenido. La identificación del exterior queda fuera del MVP. El sistema lo comprueba antes de reservar el secuencial.

#### Scenario: Proveedor identificado
- **WHEN** un usuario prepara una retención para un proveedor activo identificado con RUC
- **THEN** el borrador acepta al proveedor como sujeto retenido

#### Scenario: Consumidor final
- **WHEN** un usuario intenta preparar o emitir una retención para el consumidor final
- **THEN** el sistema la rechaza citando que el sujeto retenido debe identificarse, sin reservar número

#### Scenario: Identificación del exterior
- **WHEN** un usuario intenta preparar una retención para un tercero con identificación del exterior
- **THEN** el sistema la rechaza indicando que los pagos al exterior están fuera del alcance actual

#### Scenario: Tercero sin el rol de proveedor
- **WHEN** un usuario intenta preparar una retención para un tercero que solo es cliente
- **THEN** el sistema la rechaza indicando que el sujeto retenido debe ser un proveedor

#### Scenario: Proveedor creado desde la retención
- **WHEN** un usuario con permiso para registrar terceros crea un proveedor desde la pantalla de la retención
- **THEN** el proveedor se registra en Terceros con el rol de proveedor y queda elegido como sujeto retenido

### Requirement: Parte relacionada declarada
Cada comprobante SHALL llevar la declaración del usuario de si el sujeto retenido es parte relacionada (SI o NO). Es obligatoria, no tiene valor por defecto y nunca se infiere del tercero. Se presenta y se guarda como declarada por el usuario, nunca como verificada por el sistema.

#### Scenario: Declaración presente
- **WHEN** un usuario emite una retención declarando que el proveedor no es parte relacionada
- **THEN** el comprobante lleva `parteRel` NO y el snapshot guarda la declaración con su actor

#### Scenario: Declaración faltante
- **WHEN** un usuario intenta emitir una retención sin declarar la parte relacionada
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Período fiscal de la retención
Cada comprobante SHALL llevar un período fiscal explícito `MM/AAAA`, obligatorio y con un mes y un año reales. La interfaz preselecciona el mes y el año de la fecha de emisión y el usuario puede cambiarlo antes de reservar. Como validación del proyecto, no puede ser posterior al mes de la fecha de emisión. Si difiere del mes de emisión no se corrige, y la interfaz lo muestra antes de emitir.

#### Scenario: Período por defecto
- **WHEN** un usuario crea un borrador de retención el 6 de octubre de 2026
- **THEN** el período fiscal propuesto es 10/2026

#### Scenario: Período anterior al mes de emisión
- **WHEN** un usuario emite en octubre de 2026 una retención con el período 09/2026
- **THEN** el comprobante se emite con el período 09/2026 y la confirmación lo mostraba distinto del mes de emisión

#### Scenario: Período posterior al mes de emisión
- **WHEN** un usuario intenta emitir en octubre de 2026 una retención con el período 11/2026
- **THEN** el sistema la rechaza sin reservar número

#### Scenario: Período inválido
- **WHEN** un borrador lleva el período 13/2026 o un texto que no es `MM/AAAA`
- **THEN** el sistema lo rechaza indicando el formato

### Requirement: Documentos sustento de la retención
Un comprobante SHALL tener uno o más documentos sustento, cada uno una referencia estructurada a un comprobante emitido por el proveedor, de los tipos factura (01), nota de venta (02) o liquidación de compra (03) como política del MVP. Son declaraciones del usuario: el sistema no verifica su existencia en el SRI ni crea facturas recibidas, compras ni cuentas por pagar.

#### Scenario: Varios documentos sustento
- **WHEN** un usuario prepara una retención con dos facturas del mismo proveedor
- **THEN** el comprobante lleva los dos documentos sustento, cada uno con sus propias retenciones

#### Scenario: Sin documentos sustento
- **WHEN** un usuario intenta emitir una retención sin documentos sustento
- **THEN** el sistema la rechaza sin reservar número

#### Scenario: Tipo de documento fuera del alcance
- **WHEN** un borrador declara como documento sustento un comprobante de venta emitido en el exterior
- **THEN** el sistema lo rechaza indicando los tipos admitidos

#### Scenario: Documento presentado como declarado
- **WHEN** un usuario consulta una retención emitida
- **THEN** cada documento sustento figura como declarado por el usuario, sin ninguna indicación de que el sistema lo haya verificado

### Requirement: Datos de cada documento sustento
Cada documento sustento SHALL llevar su código de sustento, compatible con su tipo según el Catálogo ATS; su número de 15 dígitos (establecimiento, punto y secuencial); su fecha de emisión; su número de autorización cuando el usuario lo declara, de 10, 37 o 49 dígitos; su total sin impuestos y su importe total. La fecha no puede ser posterior a la fecha de emisión de la retención (validación del proyecto).

#### Scenario: Sustento incompatible con el tipo
- **WHEN** un borrador declara una nota de venta con el código de sustento de crédito tributario del IVA
- **THEN** el sistema lo rechaza indicando los códigos de sustento admitidos para la nota de venta

#### Scenario: Número de documento inválido
- **WHEN** un borrador declara un número de documento con 14 dígitos o con letras
- **THEN** el sistema lo rechaza indicando el formato

#### Scenario: Tipo de documento como código de dos caracteres
- **WHEN** se firma una retención con una factura, una nota de venta y una liquidación de compra como documentos sustento
- **THEN** su XML lleva literalmente `<codDocSustento>01</codDocSustento>`, `<codDocSustento>02</codDocSustento>` y `<codDocSustento>03</codDocSustento>`

#### Scenario: Autorización de longitud inválida
- **WHEN** un borrador declara una autorización de 20 dígitos
- **THEN** el sistema la rechaza indicando que debe tener 10, 37 o 49 dígitos

#### Scenario: Fecha posterior a la emisión
- **WHEN** un borrador declara un documento sustento con fecha posterior a la fecha de emisión de la retención
- **THEN** el sistema lo rechaza sin reservar número

### Requirement: Impuestos declarados del documento sustento
Cada documento sustento SHALL llevar uno o más impuestos transcritos por el usuario: IVA (2), ICE (3) o IRBPNR (5), con su código de porcentaje vigente en la fecha del documento, su base, su tarifa y su valor. La tarifa del IVA sale del catálogo; la de ICE e IRBPNR la declara el usuario, porque el catálogo no la publica. Son información tributaria declarada: no se retienen ni se recalculan.

#### Scenario: Documento solo con IVA
- **WHEN** un usuario declara en una factura del proveedor una base de 100.00 al 15 % con un IVA de 15.00
- **THEN** el comprobante lleva ese impuesto con el código 2, la tarifa 15, la base 100.00 y el valor 15.00 declarados

#### Scenario: Documento con IVA e ICE
- **WHEN** un usuario declara en un documento sustento un impuesto de IVA y otro de ICE con su código de porcentaje vigente en la fecha del documento y su tarifa
- **THEN** el comprobante conserva los dos impuestos con su código, su código de porcentaje, su base, su tarifa y su valor

#### Scenario: Documento con IRBPNR
- **WHEN** un usuario declara en un documento sustento un impuesto IRBPNR con el código 5001
- **THEN** el comprobante conserva el impuesto con el código 5, el código de porcentaje 5001, su base, la tarifa declarada y su valor

#### Scenario: Varias entradas tributarias
- **WHEN** un documento sustento declara IVA al 15 %, IVA al 0 % e ICE
- **THEN** el snapshot, el XML y el RIDE conservan las tres entradas en su orden

#### Scenario: Código de porcentaje no vigente en la fecha del documento
- **WHEN** un usuario declara un código de porcentaje que no está vigente en la fecha del documento sustento
- **THEN** el sistema lo rechaza sin reservar número

#### Scenario: Tarifa de IVA sin porcentaje
- **WHEN** un usuario elige para un documento sustento la tarifa de IVA diferenciado, que no tiene porcentaje
- **THEN** el sistema la rechaza indicando que la tarifa no tiene un porcentaje publicado

#### Scenario: Importes transcritos sin recálculo
- **WHEN** un usuario declara un documento con un total sin impuestos de 100.00 y un importe total de 115.01
- **THEN** el sistema conserva los valores declarados, sin corregirlos ni advertir una diferencia que ninguna fuente establece

#### Scenario: ICE no retenido
- **WHEN** un documento sustento declara ICE
- **THEN** el ICE no aparece entre las retenciones y ninguna solicitud puede retenerlo

### Requirement: Formas de pago del documento sustento
Cada documento sustento SHALL llevar una o más formas de pago con su total, transcritas por el usuario. Cada pago elige una forma de pago utilizable para la empresa en la fecha de emisión, del catálogo de formas de pago, que coincide en códigos y semántica con la tabla del Catálogo ATS a la que remite el XML para toda fecha que el sistema resuelve.

#### Scenario: Forma de pago del sustento
- **WHEN** un usuario declara que pagó una factura con transferencia por 115.00
- **THEN** el comprobante lleva el pago con el código 20 y el total 115.00 en ese documento sustento

#### Scenario: Sin pagos
- **WHEN** un documento sustento no lleva ninguna forma de pago
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Forma de pago deshabilitada
- **WHEN** un documento sustento declara una forma de pago que la empresa deshabilitó
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Retenciones de cada documento sustento
Cada documento sustento SHALL tener una o más retenciones propias, de renta o de IVA, y cada retención pertenece a un solo documento sustento. La vista previa, el snapshot, el XML y el RIDE conservan esa pertenencia.

#### Scenario: Retenciones por documento
- **WHEN** un usuario prepara una retención con una factura con renta e IVA y otra solo con renta
- **THEN** el XML lleva la primera con dos retenciones y la segunda con una, cada una dentro de su documento sustento

#### Scenario: Documento sin retenciones
- **WHEN** un documento sustento no tiene retenciones
- **THEN** el sistema rechaza la emisión indicando el documento, sin reservar número

### Requirement: Conceptos de retención del impuesto a la renta
Una retención de renta SHALL usar un concepto del catálogo oficial clasificado como soportado: pago a residentes con porcentaje numérico fijo, fuera de las estructuras excluidas del MVP. El usuario elige el concepto y el servidor resuelve su código, su denominación, su porcentaje y su vigencia. Los demás conceptos se conservan en el catálogo, no se ofrecen y se rechazan si se envían. No se afirma que sean inválidos.

#### Scenario: Concepto soportado
- **WHEN** un usuario elige el concepto 312 de transferencia de bienes muebles
- **THEN** la retención lleva el código 312, su denominación oficial y el 2 % del catálogo

#### Scenario: Concepto con porcentaje variable
- **WHEN** un borrador envía un concepto cuyo porcentaje el catálogo publica como varios porcentajes
- **THEN** el sistema lo rechaza indicando que el concepto está fuera del alcance actual

#### Scenario: Concepto para no residentes
- **WHEN** un borrador envía un concepto de pago a no residentes
- **THEN** el sistema lo rechaza indicando que los pagos al exterior están fuera del alcance actual

#### Scenario: Concepto de dividendos
- **WHEN** un borrador envía un concepto de distribución de dividendos
- **THEN** el sistema lo rechaza indicando que los dividendos están fuera del alcance actual

### Requirement: Códigos de retención del IVA
Una retención de IVA SHALL usar un código de la tabla 20 de la ficha técnica clasificado como soportado, con su porcentaje fijo, incluida la retención en cero. El código "no procede retención" se conserva en el catálogo pero no es seleccionable: la fuente no define si se representa como una retención dentro del comprobante. El usuario elige el código y el servidor resuelve su porcentaje.

#### Scenario: Retención del 30 %
- **WHEN** un usuario elige el código 1 de retención del IVA
- **THEN** la retención lleva el código 1 y el 30 % del catálogo

#### Scenario: Retención en cero
- **WHEN** un usuario elige el código 7 de retención en cero
- **THEN** la retención lleva el código 7, el 0 % y un valor retenido de 0.00

#### Scenario: No procede retención
- **WHEN** un borrador envía el código 8 de no procede retención
- **THEN** el sistema lo rechaza indicando que ese código no se emite como retención en el alcance actual

#### Scenario: Sin retención automática
- **WHEN** un usuario emite una retención de renta sin retención de IVA en un documento sustento
- **THEN** el comprobante no lleva ninguna retención con el código 8 ni con el código 7 que el usuario no haya elegido

### Requirement: Impuestos a retener del MVP
El comprobante SHALL retener solo impuesto a la renta (código 1) e IVA (código 2). El impuesto a la salida de divisas queda fuera del MVP porque la fuente oficial publica dos códigos vigentes sin una regla que determine cuándo aplica cada uno.

#### Scenario: Retención de ISD
- **WHEN** un borrador envía una retención del impuesto a la salida de divisas
- **THEN** el sistema la rechaza indicando que el ISD está fuera del alcance actual

### Requirement: Fecha efectiva del catálogo de retenciones
El concepto o código de cada retención y su porcentaje SHALL resolverse con la fecha de emisión del comprobante, nunca con la fecha del servidor después de reservar, con el período fiscal ni con la fecha del documento sustento. Al reservar, la entrada y su porcentaje quedan congelados.

#### Scenario: Concepto que deja de estar vigente
- **WHEN** un concepto de renta deja de estar vigente antes de la fecha de emisión
- **THEN** la vista previa lo informa como problema y la emisión se rechaza sin reservar número

#### Scenario: Catálogo cambiado después de reservar
- **WHEN** después de reservar una retención el catálogo cambia el porcentaje de su concepto y se completa la firma
- **THEN** el XML firmado lleva el porcentaje y el valor del snapshot

### Requirement: Base de la retención
La base de cada retención SHALL ingresarla el usuario como decimal exacto, mayor que cero y dentro de los límites del XSD. El sistema no la deriva del documento sustento ni la compara con su total sin impuestos, su importe total, su IVA ni sus pagos.

#### Scenario: Base con más de dos decimales
- **WHEN** un borrador envía una base de 100.005
- **THEN** el sistema la rechaza indicando el formato

#### Scenario: Base en cero
- **WHEN** un borrador envía una base de 0.00
- **THEN** el sistema la rechaza indicando que debe ser mayor que cero

#### Scenario: Base mayor que el documento
- **WHEN** un usuario declara una base de retención mayor que el total sin impuestos de su documento sustento
- **THEN** el sistema la acepta, porque ninguna fuente establece esa comparación

### Requirement: Valor retenido calculado por el servidor
El valor retenido SHALL ser la base por el porcentaje del catálogo dividido para 100, con decimal exacto y redondeo HALF_UP a 2 decimales (política decimal del proyecto), calculado una sola vez por el servidor. La vista previa, el snapshot, el XML, el RIDE y la consulta muestran ese mismo resultado. El servidor no acepta como dato el porcentaje ni el valor retenido.

#### Scenario: Redondeo
- **WHEN** un usuario retiene el concepto 312C del 1.75 % sobre una base de 100.29
- **THEN** el valor retenido es 1.76, el mismo en la vista previa, el XML y el RIDE

#### Scenario: Porcentaje o valor enviados por el cliente
- **WHEN** una solicitud envía un porcentaje, una denominación o un valor retenido
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: Límites de recursos de la retención
El sistema SHALL limitar los documentos sustento por comprobante y las retenciones, los impuestos y los pagos por documento con valores configurables. Son defensas de recursos del producto, no límites del SRI ni del XSD, no se presentan como reglas fiscales y no reemplazan el límite de tamaño del envío al SRI, que sigue siendo una política aparte.

#### Scenario: Demasiados documentos sustento
- **WHEN** un borrador supera el máximo configurado de documentos sustento
- **THEN** el sistema lo rechaza indicando el límite como una defensa del sistema

#### Scenario: Límite configurado
- **WHEN** la instalación configura un máximo de retenciones por documento distinto del valor por defecto
- **THEN** el borrador y la emisión aplican el máximo configurado

### Requirement: Borrador y vista previa de la retención
Un usuario SHALL preparar la retención en un borrador: el proveedor, `parteRel`, el período fiscal, el punto de emisión y los documentos sustento con sus impuestos, pagos y retenciones. La vista previa, recalculada por el servidor, muestra cada retención con su concepto, su porcentaje y su valor, el total retenido y los problemas que bloquean. El borrador no reserva número.

#### Scenario: Vista previa
- **WHEN** un usuario guarda un borrador con dos documentos sustento y tres retenciones
- **THEN** la vista previa muestra cada retención dentro de su documento con su porcentaje y su valor, y el total retenido

#### Scenario: Problema que bloquea
- **WHEN** el borrador tiene una retención sin base o con un concepto fuera del alcance
- **THEN** la vista previa lista el problema junto a la retención y la emisión queda bloqueada

#### Scenario: Versión del borrador
- **WHEN** un usuario emite con una versión del borrador que otro cambio ya reemplazó
- **THEN** el sistema rechaza la emisión indicando que el borrador cambió, sin reservar número

### Requirement: Comprobante de retención
La retención SHALL ser un comprobante propio (tipo 07, versión 2.0.0) con su secuencial, independiente de los demás tipos, su clave de acceso y su snapshot. Lleva los datos del emisor vigentes al reservar, el sujeto retenido, `parteRel`, el período fiscal y los documentos sustento con sus impuestos, retenciones y pagos, con el pago local (`pagoLocExt` 01).

#### Scenario: Numeración propia
- **WHEN** un usuario emite la primera retención de un punto que ya emitió 40 facturas y 3 notas de débito
- **THEN** la retención recibe el número 000000001 de ese punto, y la siguiente factura sigue en 41

#### Scenario: XML del comprobante
- **WHEN** se firma una retención
- **THEN** su XML valida contra el XSD oficial `ComprobanteRetencion_V2.0.0` antes y después de firmar

#### Scenario: Número de contribuyente especial incompatible
- **WHEN** la empresa declara un número de contribuyente especial de más de 5 caracteres, que el XSD de la retención no admite
- **THEN** el sistema rechaza la emisión indicando el dato de la empresa, sin reservar número

### Requirement: Reserva de la retención sin efectos parciales
Antes de reservar, el sistema SHALL comprobar el sujeto, `parteRel`, el período, los documentos sustento, sus impuestos y pagos, las retenciones con sus entradas de catálogo, el cálculo, los límites y la preparación de la empresa y del esquema, sin consumir nada. La reserva crea en una sola operación el secuencial, la clave, el snapshot, el comprobante y su auditoría. Si un paso falla, no queda nada. No hay comunicación externa dentro de esa operación.

#### Scenario: Rechazo antes de reservar
- **WHEN** una emisión se rechaza por el sujeto, el período, un documento, una retención o la preparación de la empresa
- **THEN** no se consume secuencial, no se crea clave ni comprobante, no se firma y no se llama al SRI

#### Scenario: Fallo dentro de la reserva
- **WHEN** la reserva de una retención falla después de reservar su secuencial y antes de confirmarse
- **THEN** no queda número consumido, clave, comprobante, snapshot ni auditoría

#### Scenario: Firma fuera de la reserva
- **WHEN** una retención se reserva y después su firma falla
- **THEN** sigue reservada, y un reintento la firma con su mismo número y su misma clave

### Requirement: Datos congelados en la retención
Desde su reserva, la retención SHALL contener en su snapshot el emisor, el sujeto retenido, `parteRel` con su actor, la fecha de emisión, el período, los documentos sustento con sus impuestos y pagos, las retenciones con su entrada de catálogo, su versión, su base, su porcentaje y su valor, la versión del cálculo, el punto, el secuencial, la clave y las versiones. Su XML, su RIDE y su consulta nunca releen el tercero ni el catálogo.

#### Scenario: Proveedor cambiado después de reservar
- **WHEN** el proveedor corrige su razón social después de reservar una retención
- **THEN** el XML y el RIDE llevan la razón social del snapshot

#### Scenario: Forma de pago cambiada después de reservar
- **WHEN** una forma de pago de un documento sustento se deshabilita después de reservar
- **THEN** el XML firmado conserva la forma de pago del snapshot

### Requirement: Emisión idempotente de la retención
La emisión SHALL exigir una `Idempotency-Key` y registrar, por empresa, operación y clave, la huella canónica de la solicitud, que cubre el borrador, su versión y todos sus datos funcionales. La misma clave con la misma huella devuelve la misma retención; con otra huella se rechaza. El registro no vence.

#### Scenario: Doble envío
- **WHEN** un usuario envía dos veces la misma emisión con la misma clave, una después de la otra o a la vez
- **THEN** existe una sola retención con un solo número, y ambas respuestas la devuelven

#### Scenario: Repetición después de reservar
- **WHEN** la primera emisión quedó reservada sin firmar y el usuario la repite con la misma clave
- **THEN** el sistema devuelve la misma retención y reanuda su firma, sin reservar otro número

#### Scenario: Clave reutilizada
- **WHEN** un usuario reutiliza la clave con otro borrador, otra versión, otro período u otras retenciones
- **THEN** el sistema rechaza la solicitud con un conflicto, sin reservar número

#### Scenario: Sin clave
- **WHEN** una emisión llega sin `Idempotency-Key`
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Retención sin efectos en otros registros
Un comprobante de retención MUST NOT registrar movimientos de inventario, cambiar la capacidad acreditable de una factura, modificar un comprobante emitido ni crear una compra o una cuenta por pagar, en ningún estado.

#### Scenario: Retención autorizada
- **WHEN** una retención se autoriza, se devuelve o queda no autorizada
- **THEN** ningún saldo de inventario, capacidad acreditable ni comprobante emitido cambia

### Requirement: Consulta de retenciones
Un usuario autorizado SHALL listar, buscar y ver las retenciones de su empresa. El detalle muestra el estado, el sujeto retenido, `parteRel` como declarado, el período, cada documento sustento con sus impuestos, pagos y retenciones con su concepto, porcentaje y valor, el total retenido, la transmisión y los documentos.

#### Scenario: Detalle de una retención
- **WHEN** un usuario abre una retención autorizada
- **THEN** ve su número, el proveedor, el período, los documentos sustento con sus retenciones y el total retenido

#### Scenario: Búsqueda y filtros
- **WHEN** un usuario busca por número o proveedor y filtra por período fiscal
- **THEN** la lista contiene solo las retenciones que coinciden, paginadas

### Requirement: Reintento de firma de una retención
Un usuario con permiso SHALL poder reintentar la firma de una retención reservada. El reintento la firma con su mismo número, su misma clave y su mismo snapshot.

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de una retención reservada cuya firma falló
- **THEN** queda firmada con su mismo número y su misma clave

### Requirement: Permisos de retenciones
Administradores y operadores SHALL poder consultar, preparar, emitir y reintentar la firma de retenciones. Solo el administrador SHALL poder pedir su reconciliación manual. Cada operación exige su permiso en el servidor antes de leer o escribir.

#### Scenario: Operador que emite
- **WHEN** un operador emite una retención
- **THEN** el sistema la emite

#### Scenario: Operador que reconcilia
- **WHEN** un operador pide la reconciliación de una retención
- **THEN** el sistema responde prohibido

#### Scenario: Sin permiso o sin sesión
- **WHEN** un usuario sin el permiso o sin sesión intenta preparar, emitir o consultar una retención
- **THEN** el sistema responde prohibido o no autenticado, sin leer ni escribir

### Requirement: Aislamiento de las retenciones por empresa
Las retenciones, sus borradores y sus sujetos retenidos SHALL pertenecer a una empresa. La empresa sale siempre de la sesión, y un usuario de otra empresa no puede leer, cambiar ni detectar una retención, un borrador ni un proveedor ajeno.

#### Scenario: Retención de otra empresa
- **WHEN** un usuario consulta, reintenta o reconcilia una retención de otra empresa
- **THEN** el sistema responde que no existe, igual que para una retención inexistente

#### Scenario: Proveedor de otra empresa
- **WHEN** un usuario prepara una retención con el identificador de un tercero de otra empresa
- **THEN** el sistema responde que el tercero no existe, sin revelar que existe en otra empresa

#### Scenario: Empresa en el cuerpo
- **WHEN** una solicitud envía un `companyId` en el cuerpo
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: Casos especiales fuera del alcance de la retención
El comprobante MUST NOT ofrecer ni aceptar pagos al exterior, convenios de doble tributación, `tipoSujetoRetenido`, reembolsos, dividendos, compra de cajas de banano ni autorretenciones, ni datos parciales para ellos. Su XML escribe siempre el pago local y no escribe esos elementos.

#### Scenario: Datos de pago al exterior
- **WHEN** una solicitud envía el tipo de pago al exterior, un país de pago o un convenio de doble tributación
- **THEN** el sistema la rechaza por contener campos no permitidos

#### Scenario: XML sin estructuras especiales
- **WHEN** se firma una retención
- **THEN** su XML lleva `pagoLocExt` 01 y no lleva reembolsos, dividendos, compra de cajas de banano ni campos del exterior
