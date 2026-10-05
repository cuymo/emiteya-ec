# Spec Delta

## MODIFIED Requirements

### Requirement: Contenido del RIDE
El RIDE SHALL presentar, en el formato oficial de su tipo, la factura 1.1.0, la nota de crédito 1.1.0 o la nota de débito 1.0.0 que el sistema emite. La factura muestra emisor y sus leyendas, número, autorización, ambiente, emisión, clave, receptor, detalle, formas de pago y totales de IVA, solo con los subtotales llenados. La nota de crédito sigue su distribución oficial (ficha v2.34, anexo 2): muestra además el comprobante que modifica, su fecha de emisión y la razón de la modificación, y no lleva formas de pago. La nota de débito sigue su distribución oficial (ficha v2.34, anexo 2, página 62): muestra el comprobante que modifica y su fecha de emisión, cada razón de la modificación con su valor, la forma de pago, los subtotales llenados por tratamiento de IVA, el IVA por tarifa y el valor total. Importes y cantidades SHALL salir del texto exacto del comprobante, sin recalcular, redondear ni convertir. Si el comprobante trae contenido que el sistema no emite, el RIDE no se genera: nunca se omite en silencio.

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

## ADDED Requirements

### Requirement: Notas de débito en la bandeja
La bandeja SHALL incluir las notas de débito desde que se reservan, con su tipo visible, el filtro por tipo de comprobante (factura, nota de crédito y nota de débito) y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Tres tipos en la bandeja
- **WHEN** la empresa tiene facturas, notas de crédito y notas de débito emitidas
- **THEN** la bandeja muestra las tres con su tipo, y el filtro por nota de débito deja solo las notas de débito

#### Scenario: Documentos de una nota de débito autorizada
- **WHEN** un usuario abre los documentos de una nota de débito autorizada
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una nota de débito sin autorizar
- **WHEN** un usuario abre los documentos de una nota de débito firmada que todavía no está autorizada
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la nota de débito
- **WHEN** una nota de débito pasa a autorizada
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura

#### Scenario: Enlace al detalle por tipo
- **WHEN** un usuario abre una nota de débito desde la bandeja
- **THEN** llega al detalle de la nota de débito, no al de una factura ni al de una nota de crédito
