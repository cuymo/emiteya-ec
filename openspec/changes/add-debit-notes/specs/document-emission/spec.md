# Spec Delta

## MODIFIED Requirements

### Requirement: Snapshot inmutable como fuente de verdad
El snapshot SHALL contener todo lo necesario para reproducir el XML: datos fiscales del emisor, establecimiento, punto, ambiente, comprador, líneas, descripciones, importes materializados, referencias y tarifas fiscales resueltas, formas de pago, resultado del consumidor final, casos especiales, fecha de emisión, componentes de la clave y versiones aplicadas. Contiene también, por línea, la decisión de si afecta al inventario, tomada al reservar. En una nota de crédito contiene además la factura modificada (identificador, tipo, número, fecha, clave y autorización), la causa, el motivo, la línea de la factura a la que se liga cada línea, el retorno físico declarado y las declaraciones del usuario. En una nota de débito contiene además la factura modificada (identificador, tipo, número, fecha, clave, y número, fecha y ambiente de la autorización), los tratamientos de IVA de la factura con sus referencias fiscales, cada concepto con su causa, su descripción, su importe y su tratamiento, el resultado del cálculo con su versión, la forma de pago y la declaración del usuario. Desde la reserva MUST ser inmutable y el comprobante no vuelve a leer datos de la empresa, terceros, productos, inventario ni catálogos.

#### Scenario: Producto cambiado después de reservar
- **WHEN** un administrador cambia el precio de un producto de un comprobante ya reservado y después se completa la firma
- **THEN** el XML firmado lleva el precio del snapshot, no el nuevo

#### Scenario: Empresa cambiada después de reservar
- **WHEN** un administrador corrige la dirección matriz después de reservar un comprobante
- **THEN** el comprobante y su XML conservan la dirección con la que se reservó

#### Scenario: Intento de modificar el snapshot
- **WHEN** cualquier operación intenta cambiar el snapshot, el número, la clave o la fecha de un comprobante reservado
- **THEN** el sistema lo impide y el comprobante no cambia

#### Scenario: Decisión de inventario de cada línea
- **WHEN** se reserva una factura con una línea de un producto con inventario activo y otra de un servicio
- **THEN** el snapshot indica que la primera línea afecta al inventario y la segunda no, y esa decisión no cambia aunque después cambien el producto o su inventario

#### Scenario: XML sin la decisión de inventario
- **WHEN** se firma una factura cuyo snapshot lleva la decisión de inventario
- **THEN** el XML firmado es el mismo que sin esa decisión: el inventario no forma parte del comprobante

#### Scenario: Nota de crédito y su factura
- **WHEN** se reserva una nota de crédito
- **THEN** su snapshot guarda la factura modificada, la causa, las líneas ligadas a las de la factura, el retorno físico y las declaraciones, y el XML se reproduce solo desde ese snapshot

#### Scenario: Retorno físico y declaraciones fuera del XML
- **WHEN** se firma una nota de crédito con retorno físico declarado
- **THEN** su XML no lleva el retorno físico ni las declaraciones: no forman parte del comprobante

#### Scenario: Nota de débito y su factura
- **WHEN** se reserva una nota de débito
- **THEN** su snapshot guarda la factura modificada, sus tratamientos de IVA, los conceptos, el resultado del cálculo, la forma de pago y la declaración, y el XML se reproduce solo desde ese snapshot

### Requirement: Tipos de comprobante que el sistema emite
El sistema SHALL emitir la factura 1.1.0, la nota de crédito 1.1.0 y la nota de débito 1.0.0, cada una con su esquema registrado, su construcción del XML desde el snapshot y su secuencial independiente por ambiente, establecimiento, punto y tipo. Las tres siguen la misma reserva, firma, idempotencia, recuperación y registro de transiciones. Un tipo sin construcción propia no se emite.

#### Scenario: Secuenciales independientes
- **WHEN** un punto emite una factura, después una nota de crédito, después una nota de débito y después otra factura
- **THEN** las facturas tienen los secuenciales 1 y 2, y cada nota el 1 de su propio contador

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

#### Scenario: Tipo no emitido
- **WHEN** una solicitud intenta emitir una retención, una guía de remisión o una liquidación de compra
- **THEN** no existe una operación para hacerlo
