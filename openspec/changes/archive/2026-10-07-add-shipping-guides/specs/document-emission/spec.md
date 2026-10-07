# Spec Delta

## MODIFIED Requirements

### Requirement: Tipos de comprobante que el sistema emite
El sistema SHALL emitir la factura 1.1.0, la nota de crédito 1.1.0, la nota de débito 1.0.0, la guía de remisión 1.1.0 y el comprobante de retención 2.0.0, cada uno con su esquema registrado, su construcción del XML desde el snapshot y su secuencial independiente por ambiente, establecimiento, punto y tipo. Los cinco siguen la misma reserva, firma, idempotencia, recuperación y registro de transiciones. Un tipo sin construcción propia no se emite.

#### Scenario: Secuenciales independientes
- **WHEN** un punto emite una factura, después una nota de crédito, después una nota de débito, después un comprobante de retención, después una guía de remisión y después otra factura
- **THEN** las facturas tienen los secuenciales 1 y 2, y cada nota, la retención y la guía el 1 de su propio contador

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

#### Scenario: Firma de una guía de remisión
- **WHEN** se firma una guía de remisión reservada
- **THEN** queda firmada con su artefacto de tipo 06, validado contra el XSD de la guía de remisión antes y después de firmar, como una factura

#### Scenario: Comprobante de retención sin cambios
- **WHEN** se emite un comprobante de retención después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Tipo no emitido
- **WHEN** una solicitud intenta emitir una liquidación de compra
- **THEN** no existe una operación para hacerlo

## ADDED Requirements

### Requirement: Snapshot de la guía de remisión
El snapshot de una guía de remisión SHALL contener, además del emisor, el punto, el ambiente, la fecha de emisión, la clave y las versiones, la partida con su establecimiento de origen si lo hay, el transportista con su origen, la placa, las fechas del transporte y cada destinatario con su identificación, su dirección, su establecimiento de destino si lo hay, su motivo, su ruta, su código de destino, su sustento (la factura con sus datos o la excepción declarada con su caso, su versión, su actor y su momento) y su detalle. Desde la reserva MUST ser inmutable.

#### Scenario: Guía y sus destinatarios
- **WHEN** se reserva una guía con dos destinatarios, uno con factura y otro con una excepción declarada
- **THEN** su snapshot guarda cada destinatario con su sustento y su detalle, y el XML se reproduce solo desde ese snapshot

#### Scenario: Declaraciones fuera del XML
- **WHEN** se firma una guía con una excepción declarada
- **THEN** su XML no lleva la excepción, el actor ni el momento de la declaración, que solo guarda el snapshot

### Requirement: Comprobante sin total monetario ni receptor único
Una guía de remisión SHALL guardarse sin total monetario y sin un receptor que la represente: no tiene importe y puede tener varios destinatarios. Su ausencia de total MUST NOT representarse como 0.00, ni su receptor como el primero de sus destinatarios. La factura, las notas y el comprobante de retención MUST seguir guardándose con su total y su receptor.

#### Scenario: Guía sin total
- **WHEN** se reserva una guía de remisión
- **THEN** el comprobante no tiene total, ni siquiera 0.00, y no tiene un receptor único

#### Scenario: Guía con un solo destinatario
- **WHEN** se reserva una guía con un solo destinatario
- **THEN** el comprobante tampoco guarda a ese destinatario como su receptor: lo guarda como su único destinatario

#### Scenario: Los demás tipos siguen exigiendo su total
- **WHEN** cualquier operación intenta guardar una factura, una nota o un comprobante de retención sin total o sin receptor
- **THEN** el sistema lo impide

#### Scenario: Una guía no admite total
- **WHEN** cualquier operación intenta guardar una guía de remisión con un total o un receptor único
- **THEN** el sistema lo impide
