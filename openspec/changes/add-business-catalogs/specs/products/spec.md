# Spec Delta

## Purpose

Mantiene el catálogo de productos y servicios de cada empresa: su identificación comercial, su
precio exacto, los impuestos que les corresponden según el catálogo fiscal y si controlan stock.

## ADDED Requirements

### Requirement: Alta de productos y servicios
El sistema SHALL permitir registrar un producto o servicio con su nombre, su tipo (bien o servicio), su precio unitario y sus impuestos, y opcionalmente un código principal, un código auxiliar y una descripción.

#### Scenario: Bien con IVA
- **WHEN** un usuario registra un bien con nombre, precio y la tarifa de IVA del 15 %
- **THEN** el producto queda activo en el catálogo de su empresa con esos datos

#### Scenario: Servicio sin códigos
- **WHEN** un usuario registra un servicio sin código principal ni auxiliar
- **THEN** el servicio se registra

#### Scenario: Datos obligatorios ausentes
- **WHEN** un usuario intenta registrar un producto sin nombre, sin precio o sin tarifa de IVA
- **THEN** el sistema rechaza el alta e indica los campos que faltan

### Requirement: Precio unitario decimal exacto
El sistema SHALL tratar el precio unitario como un decimal exacto mayor o igual que cero, con hasta 12 dígitos enteros y 6 decimales, recibido y devuelto como texto decimal. El sistema MUST NOT redondearlo al recibirlo: un precio con más decimales de los admitidos se rechaza.

#### Scenario: Precio con seis decimales
- **WHEN** un usuario registra el precio 12.345678
- **THEN** el producto guarda y devuelve exactamente 12.345678

#### Scenario: Precio con más decimales de los admitidos
- **WHEN** un usuario registra el precio 1.0000001
- **THEN** el sistema rechaza el alta e indica que admite hasta 6 decimales, sin redondear

#### Scenario: Precio en otro formato
- **WHEN** un usuario envía el precio como número binario, con exponente, con coma decimal o negativo
- **THEN** el sistema rechaza el alta e indica el formato esperado

### Requirement: Impuestos del producto
El sistema SHALL exigir una tarifa de IVA y admitir opcionalmente un código de ICE y, solo para bienes, un código de IRBPNR. Cada impuesto referencia una entrada del catálogo fiscal habilitada para la empresa y vigente al registrarse; el producto nunca guarda una tarifa fija propia.

#### Scenario: Producto con ICE
- **WHEN** un usuario registra un bien con la tarifa de IVA del 15 % y un código de ICE habilitado
- **THEN** el producto queda con ambos impuestos referidos a sus entradas del catálogo

#### Scenario: IRBPNR en un servicio
- **WHEN** un usuario intenta registrar un servicio con un código de IRBPNR
- **THEN** el sistema rechaza el alta e indica que el IRBPNR solo aplica a bienes

#### Scenario: Entrada deshabilitada o no vigente
- **WHEN** un usuario intenta registrar un producto con una tarifa deshabilitada para su empresa o no vigente hoy
- **THEN** el sistema rechaza el alta e indica qué impuesto no está disponible

#### Scenario: Dos tarifas del mismo impuesto
- **WHEN** un usuario intenta asignar dos tarifas de IVA al mismo producto
- **THEN** el sistema rechaza el alta e indica que cada impuesto admite una sola entrada

### Requirement: Impuestos que dejan de estar disponibles
El sistema SHALL señalar los productos con algún impuesto cuya entrada dejó de estar vigente o fue deshabilitada para la empresa, sin cambiar ni eliminar el producto, para que un usuario lo revise.

#### Scenario: Tarifa deshabilitada después
- **WHEN** un administrador deshabilita una tarifa que usan productos existentes
- **THEN** esos productos conservan sus datos y figuran como pendientes de revisar sus impuestos

#### Scenario: Revisión de los impuestos
- **WHEN** un usuario cambia la tarifa de un producto señalado por una disponible
- **THEN** el producto deja de figurar como pendiente de revisión

### Requirement: Código principal único por empresa
El sistema SHALL impedir dos productos con el mismo código principal en una empresa. Los productos sin código principal no se comparan entre sí, y el mismo código puede existir en otra empresa.

#### Scenario: Código principal repetido
- **WHEN** un usuario registra un producto con un código principal que ya existe en su empresa
- **THEN** el sistema rechaza el alta e indica qué producto tiene ese código

#### Scenario: Altas simultáneas con el mismo código
- **WHEN** dos usuarios registran a la vez productos con el mismo código principal
- **THEN** solo uno se registra y el otro se rechaza por código repetido

#### Scenario: Mismo código en dos empresas
- **WHEN** usuarios de dos empresas registran el mismo código principal
- **THEN** cada empresa tiene su propio producto

### Requirement: Control de stock
El sistema SHALL permitir activar el control de stock solo en bienes. Este cambio guarda la elección; no registra existencias ni movimientos.

#### Scenario: Bien con control de stock
- **WHEN** un usuario registra un bien con control de stock
- **THEN** el producto queda marcado con control de stock

#### Scenario: Servicio con control de stock
- **WHEN** un usuario intenta activar el control de stock en un servicio
- **THEN** el sistema rechaza la solicitud e indica que solo los bienes controlan stock

### Requirement: Edición de productos
El sistema SHALL permitir corregir un producto, incluidos su precio y sus impuestos, indicando la versión que el usuario ve. Si otro cambio la modificó antes, el sistema rechaza la corrección con un conflicto. Las reglas de alta se aplican también a la corrección.

#### Scenario: Cambio de precio
- **WHEN** un usuario cambia el precio de un producto indicando su versión vigente
- **THEN** el producto queda con el precio nuevo

#### Scenario: Corrección con una versión desactualizada
- **WHEN** un usuario corrige un producto que otro usuario cambió después de que lo abriera
- **THEN** el sistema rechaza la corrección con un conflicto que pide recargar, y nada cambia

### Requirement: Búsqueda de productos
El sistema SHALL permitir buscar productos por el inicio de su código principal o auxiliar, o por una parte de su nombre, sin distinguir mayúsculas ni tildes, con resultados paginados y filtro por estado. Por defecto muestra solo los activos.

#### Scenario: Búsqueda por código auxiliar
- **WHEN** un usuario busca el inicio de un código auxiliar
- **THEN** encuentra los productos con ese código auxiliar

#### Scenario: Búsqueda por nombre
- **WHEN** un usuario busca "cafe"
- **THEN** encuentra "Café molido 500 g"

### Requirement: Desactivación de productos
El sistema SHALL permitir desactivar y reactivar un producto en lugar de eliminarlo. Un producto desactivado conserva sus datos, deja de ofrecerse para documentos nuevos y sigue siendo consultable.

#### Scenario: Desactivación
- **WHEN** un administrador desactiva un producto
- **THEN** el producto deja de aparecer entre los activos y sigue consultable con el filtro de inactivos

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un producto ya desactivado
- **THEN** nada cambia

### Requirement: Permisos de los productos
El sistema SHALL permitir que administradores y operadores consulten, registren y corrijan productos. Solo un administrador SHALL desactivar o reactivar un producto.

#### Scenario: Operador registra un producto
- **WHEN** un operador registra un producto válido
- **THEN** el producto se registra

#### Scenario: Operador intenta desactivar
- **WHEN** un operador intenta desactivar un producto
- **THEN** el sistema rechaza la solicitud por falta de permiso y nada cambia

### Requirement: Aislamiento de los productos por empresa
El sistema SHALL limitar toda consulta y todo cambio de productos a la empresa del usuario autenticado. Un usuario no puede leer, cambiar ni detectar un producto de otra empresa.

#### Scenario: Producto de otra empresa
- **WHEN** un usuario de la empresa B consulta, corrige o desactiva un producto de la empresa A por su identificador
- **THEN** el sistema responde como si el producto no existiera

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un usuario incluye un identificador de empresa al registrar o corregir un producto
- **THEN** el sistema rechaza la solicitud y ninguna empresa cambia
