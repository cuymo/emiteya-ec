# Spec Delta

## MODIFIED Requirements

### Requirement: Tipos de comprobante que el sistema emite
El sistema SHALL emitir la factura 1.1.0, la nota de crédito 1.1.0, la nota de débito 1.0.0 y el comprobante de retención 2.0.0, cada uno con su esquema registrado, su construcción del XML desde el snapshot y su secuencial independiente por ambiente, establecimiento, punto y tipo. Los cuatro siguen la misma reserva, firma, idempotencia, recuperación y registro de transiciones. Un tipo sin construcción propia no se emite.

#### Scenario: Secuenciales independientes
- **WHEN** un punto emite una factura, después una nota de crédito, después una nota de débito, después un comprobante de retención y después otra factura
- **THEN** las facturas tienen los secuenciales 1 y 2, y cada nota y la retención el 1 de su propio contador

#### Scenario: Firma de una nota de crédito
- **WHEN** se firma una nota de crédito reservada
- **THEN** queda firmada con su artefacto, validado contra el XSD de la nota de crédito, como una factura

#### Scenario: Firma de una nota de débito
- **WHEN** se firma una nota de débito reservada
- **THEN** queda firmada con su artefacto de tipo 05, validado contra el XSD de la nota de débito antes y después de firmar, como una factura

#### Scenario: Factura sin cambios
- **WHEN** se emite una factura después de este cambio
- **THEN** su XML, su snapshot, su firma y su artefacto son los mismos que antes, para los mismos datos

#### Scenario: Nota de crédito sin cambios
- **WHEN** se emite una nota de crédito después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Firma de un comprobante de retención
- **WHEN** se firma un comprobante de retención reservado
- **THEN** queda firmado con su artefacto de tipo 07, validado contra el XSD del comprobante de retención antes y después de firmar, como una factura

#### Scenario: Nota de débito sin cambios
- **WHEN** se emite una nota de débito después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Tipo no emitido
- **WHEN** una solicitud intenta emitir una guía de remisión o una liquidación de compra
- **THEN** no existe una operación para hacerlo

## ADDED Requirements

### Requirement: Snapshot del comprobante de retención
El snapshot de un comprobante de retención SHALL contener, además del emisor, el punto, el ambiente, la fecha de emisión, la clave y las versiones, el sujeto retenido, la declaración de parte relacionada, el período fiscal, cada documento sustento con sus impuestos y pagos, y cada retención con su entrada de catálogo, su versión, su base, su porcentaje y su valor, con la versión del cálculo. Desde la reserva MUST ser inmutable, y el XML se reproduce solo desde él.

#### Scenario: Retención y sus documentos
- **WHEN** se reserva un comprobante de retención con dos documentos sustento
- **THEN** su snapshot guarda cada documento con sus impuestos, sus pagos y sus retenciones, y el XML se reproduce solo desde ese snapshot

#### Scenario: Declaraciones fuera del XML
- **WHEN** se firma un comprobante de retención
- **THEN** su XML lleva `parteRel` como dato del comprobante, pero no el actor ni el momento de la declaración, que solo guarda el snapshot
