# Spec Delta

## MODIFIED Requirements

### Requirement: Auditoría de productos
El sistema SHALL registrar un evento por cada alta, desactivación y reactivación exitosas de un producto, y por cada corrección que cambia su precio, sus impuestos o su marca de control de stock, con actor, empresa, producto, valor anterior y nuevo, y momento. Una corrección que solo cambia el nombre, la descripción o los códigos no genera evento. Ni las consultas ni las búsquedas generan eventos.

#### Scenario: Cambio de precio
- **WHEN** un usuario corrige el precio de un producto de `8.75` a `9.10`
- **THEN** existe un evento con el precio anterior y el nuevo

#### Scenario: Cambio de impuestos
- **WHEN** un usuario cambia la tarifa de IVA de un producto
- **THEN** existe un evento con la referencia anterior y la nueva, identificadas por su catálogo y su entrada

#### Scenario: Cambio de la marca de control de stock
- **WHEN** un usuario marca como controlado un bien que no lo estaba
- **THEN** existe un evento con el valor anterior y el nuevo de la marca

#### Scenario: Corrección solo descriptiva
- **WHEN** un usuario corrige solo el nombre de un producto
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un alta o una corrección de un producto se rechaza por validación, permiso, código en uso, impuesto no disponible o versión desactualizada
- **THEN** no se registra ningún evento

## ADDED Requirements

### Requirement: Auditoría de la configuración del inventario
El sistema SHALL registrar un evento por cada inicialización del inventario de un producto y por cada desactivación o reactivación de su control, con actor, empresa, producto, acción, estado anterior y nuevo del control y momento. Las entradas manuales, los ajustes y las salidas no generan eventos: el movimiento inmutable, con su actor, su motivo y su momento, es su evidencia.

#### Scenario: Inicialización
- **WHEN** un administrador inicializa el inventario de un producto
- **THEN** existe un evento de inicialización con el administrador como actor y el producto

#### Scenario: Desactivación del control
- **WHEN** un administrador desactiva el control de un producto con inventario
- **THEN** existe un evento con el estado anterior y el nuevo del control

#### Scenario: Movimientos sin auditoría duplicada
- **WHEN** se registran una entrada, un ajuste y la salida de una factura
- **THEN** no se registra ningún evento de auditoría por ellos

#### Scenario: Operación rechazada
- **WHEN** una inicialización o un cambio del control se rechaza por permiso, estado, saldo distinto de cero o producto de otra empresa
- **THEN** no se registra ningún evento
