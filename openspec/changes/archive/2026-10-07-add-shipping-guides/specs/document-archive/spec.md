# Spec Delta

## MODIFIED Requirements

### Requirement: Bandeja de comprobantes
El sistema SHALL listar en una bandeja los comprobantes fiscales de la empresa desde que se reservan, de cualquier tipo, con paginación y del más reciente al más antiguo. Los borradores nunca aparecen. Cada comprobante muestra su tipo, número, fecha de emisión, receptor, total y estado visible. Una guía de remisión no tiene total monetario: se muestra sin importe, nunca como 0.00, y en lugar de un receptor muestra el nombre de su único destinatario o el número de sus destinatarios.

#### Scenario: Comprobantes en todos los estados
- **WHEN** la empresa tiene comprobantes reservados, firmados, en transmisión, autorizados, no autorizados, devueltos y en revisión manual
- **THEN** la bandeja los muestra todos con su estado visible

#### Scenario: Borradores fuera de la bandeja
- **WHEN** la empresa tiene borradores sin emitir
- **THEN** ninguno aparece en la bandeja

#### Scenario: Bandeja vacía
- **WHEN** la empresa todavía no tiene comprobantes
- **THEN** la bandeja responde una lista vacía

#### Scenario: Guía con un destinatario
- **WHEN** la empresa tiene una guía de remisión con un solo destinatario
- **THEN** la bandeja la muestra con el nombre de ese destinatario y sin importe

#### Scenario: Guía con varios destinatarios
- **WHEN** la empresa tiene una guía de remisión con tres destinatarios
- **THEN** la bandeja la muestra con "3 destinatarios" y sin importe, y su detalle muestra los tres

### Requirement: Filtros de la bandeja
La bandeja SHALL filtrar por rango de fechas de emisión, tipo de comprobante, estado, identificación del receptor, número, establecimiento y punto de emisión, combinables entre sí. La identificación del receptor encuentra una guía de remisión por cualquiera de sus destinatarios. Un filtro con un valor inválido SHALL rechazarse sin consultar.

#### Scenario: Rango de fechas
- **WHEN** un usuario filtra del 1 al 15 de octubre de 2026
- **THEN** la bandeja contiene solo los comprobantes emitidos en ese rango, ambos días incluidos

#### Scenario: Establecimiento, punto y estado
- **WHEN** un usuario combina un establecimiento, un punto y el estado autorizado
- **THEN** la bandeja contiene solo los comprobantes autorizados de ese punto

#### Scenario: Identificación y número
- **WHEN** un usuario filtra por la identificación de un receptor o por un número de comprobante
- **THEN** la bandeja contiene solo los comprobantes que coinciden

#### Scenario: Filtro inválido
- **WHEN** un usuario envía una fecha mal formada, un rango invertido o un estado desconocido
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Identificación de un destinatario de una guía
- **WHEN** un usuario filtra por la identificación del segundo destinatario de una guía de remisión
- **THEN** la bandeja contiene esa guía

### Requirement: Contenido del RIDE
El RIDE SHALL presentar, en el formato oficial de su tipo, la factura 1.1.0, la nota de crédito 1.1.0, la nota de débito 1.0.0, la guía de remisión 1.1.0 o el comprobante de retención 2.0.0 que el sistema emite. La factura muestra emisor y sus leyendas, número, autorización, ambiente, emisión, clave, receptor, detalle, formas de pago y totales de IVA, solo con los subtotales llenados. La nota de crédito sigue su distribución oficial (ficha v2.34, anexo 2): muestra además el comprobante que modifica, su fecha de emisión y la razón de la modificación, y no lleva formas de pago. La nota de débito sigue su distribución oficial (ficha v2.34, anexo 2, página 62): muestra el comprobante que modifica y su fecha de emisión, cada razón de la modificación con su valor, la forma de pago, los subtotales llenados por tratamiento de IVA, el IVA por tarifa y el valor total. El comprobante de retención sigue la distribución oficial publicada para su versión 1.0.0 (ficha v2.34, anexo 2, página 63): una fila por retención con el tipo, el número y la fecha de su documento sustento, el ejercicio fiscal, la base, el impuesto, el porcentaje y el valor retenido; y, como datos adicionales que el anexo 2 permite (página 60), los impuestos declarados de cada documento sustento. La guía de remisión sigue su distribución oficial (ficha v2.34, anexo 2, página 64): el transporte con el transportista, la placa, el punto de partida y las fechas, y un bloque por destinatario con su comprobante de venta, su motivo, su destino, su identificación, su ruta y su detalle de cantidad, descripción y códigos, sin importes. Importes y cantidades SHALL salir del texto exacto del comprobante, sin recalcular, redondear ni convertir. Si el comprobante trae contenido que el sistema no emite, el RIDE no se genera: nunca se omite en silencio.

#### Scenario: Factura completa
- **WHEN** se genera el RIDE de una factura con varias líneas, descuentos, varias tarifas de IVA y varias formas de pago
- **THEN** muestra cada línea con su cantidad, precio, descuento y total, cada subtotal llenado, el IVA por tarifa, el total y las formas de pago con su denominación

#### Scenario: Consumidor final
- **WHEN** el receptor es el consumidor final
- **THEN** el RIDE muestra CONSUMIDOR FINAL y su identificación

#### Scenario: Leyendas del emisor
- **WHEN** el emisor es contribuyente RIMPE, agente de retención, contribuyente especial y obligado a llevar contabilidad
- **THEN** el RIDE muestra cada leyenda con su valor tal como está en el comprobante

#### Scenario: Importes exactos
- **WHEN** una línea tiene la cantidad `999999.999999` y el precio `1.000001`
- **THEN** el RIDE muestra esos valores completos, sin redondearlos

#### Scenario: Ambiente de pruebas
- **WHEN** el comprobante es del ambiente de pruebas
- **THEN** el RIDE indica el ambiente de pruebas

#### Scenario: Contenido que el sistema no emite
- **WHEN** el comprobante de origen trae ICE, IRBPNR, propina, información adicional, compensaciones u otro elemento que el sistema no emite
- **THEN** no se genera el RIDE y la generación se detiene indicando los elementos

#### Scenario: Nota de crédito
- **WHEN** se genera el RIDE de una nota de crédito de devolución con dos líneas
- **THEN** muestra "NOTA DE CRÉDITO" con su número y su autorización, el comprobante que modifica como FACTURA con su número y su fecha de emisión, la razón de la modificación, cada línea con su cantidad, precio, descuento y total, y los subtotales llenados con el valor total, sin formas de pago

#### Scenario: Clave de la nota en el RIDE
- **WHEN** se genera el RIDE de una nota de crédito o de una nota de débito
- **THEN** el código de barras y la clave impresa son los de la nota, nunca los de la factura que modifica

#### Scenario: Distribución propia de la nota de crédito
- **WHEN** se comparan el RIDE de una factura y el de una nota de crédito
- **THEN** la nota de crédito tiene su propio bloque del comprobante modificado y no reutiliza el bloque de formas de pago de la factura

#### Scenario: Nota de débito con varias tarifas
- **WHEN** se genera el RIDE de una nota de débito con conceptos de intereses de mora al 15 % y de costos posteriores al 0 %
- **THEN** muestra "NOTA DE DÉBITO" con su número y su autorización, el comprobante que modifica como FACTURA con su número y su fecha de emisión, cada razón con su valor, la forma de pago con su denominación, el subtotal del 15 %, el del 0 %, el subtotal sin impuestos, el IVA del 15 % y el valor total

#### Scenario: Distribución propia de la nota de débito
- **WHEN** se comparan el RIDE de una nota de débito con el de una factura y el de una nota de crédito
- **THEN** la nota de débito tiene su propio bloque de razones y valores de la modificación y no reutiliza el detalle de líneas de la factura ni el de la nota de crédito

#### Scenario: Retención con varios documentos sustento
- **WHEN** se genera el RIDE de un comprobante de retención con dos documentos sustento y tres retenciones
- **THEN** muestra "COMPROBANTE DE RETENCIÓN" con su número y su autorización, el sujeto retenido y la fecha de emisión, y una fila por retención con el tipo, el número y la fecha de su documento sustento, el ejercicio fiscal, la base, el impuesto, el porcentaje y el valor retenido

#### Scenario: Impuestos declarados del documento sustento en el RIDE
- **WHEN** se genera el RIDE de una retención cuyo documento sustento declara IVA e ICE
- **THEN** el RIDE muestra, como datos adicionales del documento, cada impuesto declarado con su código, su código de porcentaje, su base, su tarifa y su valor

#### Scenario: Distribución propia de la retención
- **WHEN** se comparan el RIDE de un comprobante de retención con el de una factura y el de las notas
- **THEN** la retención tiene su propia tabla de retenciones y no reutiliza el detalle de líneas, las formas de pago ni los subtotales de los otros tipos

#### Scenario: Guía con dos destinatarios
- **WHEN** se genera el RIDE de una guía de remisión con dos destinatarios, uno con factura y otro con una excepción declarada
- **THEN** muestra "GUÍA DE REMISIÓN" con su número y su autorización, el transportista con su identificación, la placa, el punto de partida y las fechas de inicio y fin, y un bloque por destinatario con su motivo, su destino, su identificación, su ruta y su detalle; el de la factura muestra FACTURA con su número, su fecha de emisión y su autorización, y el otro deja vacíos los datos del comprobante de venta

#### Scenario: Guía sin importes
- **WHEN** se genera el RIDE de una guía de remisión
- **THEN** no muestra precios, subtotales, impuestos, total ni formas de pago, ni una fila con la fecha de emisión de la guía

#### Scenario: Distribución propia de la guía
- **WHEN** se comparan el RIDE de una guía de remisión con el de los demás tipos
- **THEN** la guía tiene sus propios bloques de transporte y de destinatarios y no reutiliza el detalle de líneas, las formas de pago ni los subtotales de los otros tipos

## ADDED Requirements

### Requirement: Guías de remisión en la bandeja
La bandeja SHALL incluir las guías de remisión desde que se reservan, con su tipo visible, el filtro por tipo de comprobante (factura, nota de crédito, nota de débito, guía de remisión y comprobante de retención) y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Cinco tipos en la bandeja
- **WHEN** la empresa tiene facturas, notas de crédito, notas de débito, guías de remisión y comprobantes de retención emitidos
- **THEN** la bandeja muestra los cinco con su tipo, y el filtro por guía de remisión deja solo las guías

#### Scenario: Documentos de una guía autorizada
- **WHEN** un usuario abre los documentos de una guía de remisión autorizada
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una guía sin autorizar
- **WHEN** un usuario abre los documentos de una guía de remisión firmada que todavía no está autorizada
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la guía
- **WHEN** una guía de remisión pasa a autorizada
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura

#### Scenario: Enlace al detalle por tipo
- **WHEN** un usuario abre una guía de remisión desde la bandeja
- **THEN** llega al detalle de la guía, no al de otro tipo
