# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de terceros y productos
El sistema SHALL registrar un evento por cada alta, corrección relevante, desactivación y reactivación exitosa de un tercero, y por cada alta, cambio de precio o de impuestos, desactivación y reactivación exitosa de un producto. Cada evento indica actor, empresa, acción, registro afectado, momento y qué cambió. Los datos de contacto de un tercero se registran solo como campos cambiados, sin sus valores.

#### Scenario: Alta de un tercero
- **WHEN** un usuario registra un tercero
- **THEN** existe un evento con el usuario como actor, la empresa y la identificación y razón social del tercero

#### Scenario: Corrección de identificación
- **WHEN** un usuario corrige la identificación de un tercero
- **THEN** existe un evento con la identificación anterior y la nueva

#### Scenario: Corrección de datos de contacto
- **WHEN** un usuario corrige el correo y el teléfono de un tercero
- **THEN** existe un evento que indica que cambiaron esos campos, sin sus valores

#### Scenario: Cambio de precio o de impuestos
- **WHEN** un usuario cambia el precio y la tarifa de IVA de un producto
- **THEN** existe un evento con el precio y la tarifa anteriores y los nuevos

#### Scenario: Corrección sin efecto tributario
- **WHEN** un usuario cambia solo el nombre o la descripción de un producto
- **THEN** no se registra ningún evento

#### Scenario: Consultas, búsquedas y operaciones rechazadas
- **WHEN** un usuario consulta o busca terceros o productos, o un cambio se rechaza por validación, permiso o conflicto
- **THEN** no se registra ningún evento

### Requirement: Auditoría de la habilitación de catálogos fiscales
El sistema SHALL registrar un evento por cada cambio exitoso de la habilitación de una entrada del catálogo fiscal para una empresa, con el catálogo, el código, el estado anterior y el nuevo. Cargar o actualizar los catálogos oficiales con una versión del producto no genera eventos por empresa ni por entrada.

#### Scenario: Deshabilitar una tarifa
- **WHEN** un administrador deshabilita una tarifa de IVA
- **THEN** existe un evento con el administrador como actor, la empresa, la tarifa y el cambio de habilitada a deshabilitada

#### Scenario: Habilitación sin cambio
- **WHEN** un administrador habilita una entrada que ya estaba habilitada
- **THEN** no se registra ningún evento

#### Scenario: Actualización de los catálogos oficiales
- **WHEN** una versión nueva del producto incorpora entradas oficiales
- **THEN** no se registra ningún evento de auditoría por empresa ni por entrada
