# Spec Delta

## MODIFIED Requirements

### Requirement: Snapshot inmutable como fuente de verdad
El snapshot SHALL contener todo lo necesario para reproducir el XML: datos fiscales del emisor, establecimiento, punto, ambiente, comprador, líneas, descripciones, importes materializados, referencias y tarifas fiscales resueltas, formas de pago, resultado del consumidor final, casos especiales, fecha de emisión, componentes de la clave y versiones aplicadas. Contiene también, por línea, la decisión de si afecta al inventario, tomada al reservar. Desde la reserva MUST ser inmutable y el comprobante no vuelve a leer datos de la empresa, terceros, productos, inventario ni catálogos.

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
