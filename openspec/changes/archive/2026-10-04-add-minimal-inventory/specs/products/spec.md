# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Control de stock solo como dato de los bienes`
- TO: `### Requirement: Control de stock de los bienes`

## MODIFIED Requirements

### Requirement: Control de stock de los bienes
El sistema SHALL permitir marcar un bien como controlado en stock, nunca un servicio. La marca configura que el producto participe en el inventario, pero por sí sola no crea existencias, no registra movimientos ni bloquea ventas: el inventario empieza con su inicialización. Mientras el inventario del producto no está inicializado, la marca se cambia como cualquier corrección del producto; con el inventario inicializado, solo un administrador la cambia desde el inventario.

#### Scenario: Bien con control de stock
- **WHEN** un usuario marca un bien como controlado en stock
- **THEN** el bien queda marcado y sin inicializar, sin existencias ni movimientos

#### Scenario: Servicio con control de stock
- **WHEN** un usuario marca un servicio como controlado en stock
- **THEN** el sistema rechaza la solicitud indicando que solo los bienes llevan control de stock

#### Scenario: Marca de un producto con inventario inicializado
- **WHEN** un usuario corrige un producto con inventario inicializado y cambia su marca de control de stock
- **THEN** el sistema rechaza la corrección indicando que el control se gestiona desde el inventario, y el producto no cambia

#### Scenario: Otra corrección de un producto con inventario
- **WHEN** un usuario corrige el nombre o el precio de un producto con inventario inicializado sin cambiar su marca
- **THEN** la corrección se acepta y el inventario del producto no cambia

#### Scenario: Producto con inventario que pasa a servicio
- **WHEN** un usuario corrige a servicio un bien con inventario inicializado y control activo
- **THEN** el sistema rechaza la corrección: primero un administrador debe desactivar el control desde el inventario

### Requirement: Permisos de productos
El sistema SHALL permitir que administradores y operadores consulten, registren y corrijan productos. Solo un administrador SHALL desactivar o reactivar un producto, y solo un administrador cambia la marca de control de stock de un producto con inventario inicializado, desde el inventario.

#### Scenario: Operador registra un producto
- **WHEN** un operador registra un producto válido
- **THEN** el producto se crea

#### Scenario: Operador intenta desactivar
- **WHEN** un operador intenta desactivar o reactivar un producto
- **THEN** el sistema rechaza la solicitud por falta de permiso, y nada cambia

#### Scenario: Operador cambia la marca de un producto sin inventario
- **WHEN** un operador marca como controlado un bien cuyo inventario no está inicializado
- **THEN** la corrección se acepta

#### Scenario: Operador intenta cambiar el control de un producto con inventario
- **WHEN** un operador intenta desactivar desde el inventario el control de un producto con inventario inicializado
- **THEN** el sistema rechaza la solicitud por falta de permiso, y el control no cambia
