# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de terceros
El sistema SHALL registrar un evento por cada alta, corrección que cambia algo, desactivación y reactivación exitosas de un tercero, con actor, empresa, tercero y momento. Un cambio de identificación, razón social o roles guarda su valor anterior y el nuevo; un cambio de dirección, correo o teléfono guarda solo los nombres de los campos cambiados, nunca sus valores anteriores ni nuevos. Ni las consultas, ni las búsquedas, ni la creación del consumidor final por el sistema generan eventos.

#### Scenario: Alta de un tercero
- **WHEN** un usuario registra un tercero
- **THEN** existe un evento con el usuario como actor, la empresa, la identificación, la razón social y los roles

#### Scenario: Cambio de identificación
- **WHEN** un usuario corrige la identificación de un tercero
- **THEN** existe un evento con la identificación anterior y la nueva

#### Scenario: Cambio de datos de contacto
- **WHEN** un usuario corrige el correo y el teléfono de un tercero
- **THEN** existe un evento que indica que cambiaron el correo y el teléfono, sin ninguno de sus valores anteriores ni nuevos

#### Scenario: Corrección sin cambios o rechazada
- **WHEN** una corrección no cambia ningún dato, o se rechaza por validación, permiso, identificación repetida o versión desactualizada
- **THEN** no se registra ningún evento

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un tercero que ya estaba desactivado
- **THEN** no se registra ningún evento

### Requirement: Auditoría de productos
El sistema SHALL registrar un evento por cada alta, desactivación y reactivación exitosas de un producto, y por cada corrección que cambia su precio o sus impuestos, con actor, empresa, producto, valor anterior y nuevo, y momento. Una corrección que solo cambia el nombre, la descripción, los códigos o el control de stock no genera evento. Ni las consultas ni las búsquedas generan eventos.

#### Scenario: Cambio de precio
- **WHEN** un usuario corrige el precio de un producto de `8.75` a `9.10`
- **THEN** existe un evento con el precio anterior y el nuevo

#### Scenario: Cambio de impuestos
- **WHEN** un usuario cambia la tarifa de IVA de un producto
- **THEN** existe un evento con la referencia anterior y la nueva, identificadas por su catálogo y su entrada

#### Scenario: Corrección solo descriptiva
- **WHEN** un usuario corrige solo el nombre de un producto
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un alta o una corrección de un producto se rechaza por validación, permiso, código en uso, impuesto no disponible o versión desactualizada
- **THEN** no se registra ningún evento
