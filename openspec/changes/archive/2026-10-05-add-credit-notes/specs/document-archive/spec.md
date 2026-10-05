# Spec Delta

## MODIFIED Requirements

### Requirement: Contenido del RIDE
El RIDE SHALL presentar, en el formato oficial de su tipo, la factura 1.1.0 o la nota de crédito 1.1.0 que el sistema emite. La factura muestra emisor y sus leyendas, número, autorización, ambiente, emisión, clave, receptor, detalle, formas de pago y totales de IVA, solo con los subtotales llenados. La nota de crédito sigue su distribución oficial (ficha v2.34, anexo 2): muestra además el comprobante que modifica, su fecha de emisión y la razón de la modificación, y no lleva formas de pago. Importes y cantidades SHALL salir del texto exacto del comprobante, sin recalcular, redondear ni convertir. Si el comprobante trae contenido que el sistema no emite, el RIDE no se genera: nunca se omite en silencio.

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
- **WHEN** el comprobante de origen trae ICE, IRBPNR, propina, información adicional u otro elemento que el sistema no emite
- **THEN** no se genera el RIDE y la generación se detiene indicando los elementos

#### Scenario: Nota de crédito
- **WHEN** se genera el RIDE de una nota de crédito de devolución con dos líneas
- **THEN** muestra "NOTA DE CRÉDITO" con su número y su autorización, el comprobante que modifica como FACTURA con su número y su fecha de emisión, la razón de la modificación, cada línea con su cantidad, precio, descuento y total, y los subtotales llenados con el valor total, sin formas de pago

#### Scenario: Clave de la nota en el RIDE
- **WHEN** se genera el RIDE de una nota de crédito
- **THEN** el código de barras y la clave impresa son los de la nota, nunca los de la factura que modifica

#### Scenario: Distribución propia de la nota de crédito
- **WHEN** se comparan el RIDE de una factura y el de una nota de crédito
- **THEN** la nota de crédito tiene su propio bloque del comprobante modificado y no reutiliza el bloque de formas de pago de la factura

## ADDED Requirements

### Requirement: Notas de crédito en la bandeja
La bandeja SHALL incluir las notas de crédito desde que se reservan, con su tipo visible, el filtro por tipo de comprobante y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Factura y nota de crédito
- **WHEN** la empresa tiene facturas y notas de crédito emitidas
- **THEN** la bandeja muestra ambas con su tipo, y el filtro por nota de crédito deja solo las notas

#### Scenario: Documentos de una nota autorizada
- **WHEN** un usuario abre los documentos de una nota de crédito autorizada
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una nota sin autorizar
- **WHEN** un usuario abre los documentos de una nota firmada que todavía no está autorizada
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la nota
- **WHEN** una nota de crédito pasa a autorizada
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura
