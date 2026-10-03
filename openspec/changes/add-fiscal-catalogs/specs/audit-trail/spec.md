# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de la habilitación de catálogos fiscales
El sistema SHALL registrar un evento por cada cambio exitoso de la habilitación de una entrada del catálogo fiscal para una empresa, con actor, empresa, catálogo, entrada, código, estado anterior y nuevo, y momento. Ni las consultas de catálogos ni la carga o actualización de los catálogos oficiales con una versión del producto generan eventos por empresa ni por entrada.

#### Scenario: Deshabilitar una tarifa
- **WHEN** un administrador deshabilita una tarifa de IVA
- **THEN** existe un evento con el administrador como actor, la empresa, la tarifa y el cambio de habilitada a deshabilitada

#### Scenario: Habilitación sin cambio
- **WHEN** un administrador habilita una entrada que ya estaba habilitada
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un cambio de habilitación se rechaza por permiso, por validación o porque el catálogo no admite habilitación
- **THEN** no se registra ningún evento

#### Scenario: Consultas y actualización de los catálogos oficiales
- **WHEN** un usuario consulta los catálogos, o una versión nueva del producto incorpora entradas oficiales
- **THEN** no se registra ningún evento de auditoría por empresa ni por entrada
