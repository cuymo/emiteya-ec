## MODIFIED Requirements

### Requirement: Navegación según permisos
La navegación SHALL ordenar los destinos en Inicio, Comprobantes, Administración, Reportes y
Configuración, con dos niveles como máximo. Inicio, Reportes y Configuración SHALL ser destinos
sueltos, sin etiqueta de grupo, y una línea SHALL separar los bloques. SHALL mostrar solo los
destinos que el rol del usuario puede usar, con la misma regla de permisos que aplica la
aplicación. La API sigue autorizando cada operación. Un grupo sin destinos visibles no SHALL
mostrarse. Los borradores no SHALL tener un destino propio: cada lista de comprobantes los muestra
y los filtra.

#### Scenario: Administrador
- **WHEN** un administrador abre la navegación
- **THEN** ve:
  - Inicio;
  - Comprobantes: Todos los comprobantes, Facturas, Notas de crédito, Notas de débito, Retenciones, Liquidaciones de compra, Guías de remisión;
  - Administración: Clientes y proveedores, Productos, Inventario;
  - Reportes;
  - Configuración, que lleva a sus pestañas: Usuarios, Empresa, Establecimientos, Firma electrónica, Correos, Catálogos fiscales, Ambiente, Portabilidad de datos. Los secuenciales se consultan y ajustan en Establecimientos, en cada punto de emisión.

#### Scenario: Operador
- **WHEN** un operador abre la navegación
- **THEN** ve los mismos destinos que el administrador hasta Reportes, y Configuración lleva solo a Catálogos fiscales

#### Scenario: Borradores de facturas y archivo de comprobantes
- **WHEN** un usuario busca dónde continuar una factura sin emitir y dónde consultar comprobantes de cualquier tipo
- **THEN** encuentra la factura sin emitir en Facturas, con el estado «Borrador», y Todos los comprobantes en Comprobantes, que reúne los comprobantes de todos los tipos
- **AND** la antigua dirección de los borradores de factura lleva a Facturas con el filtro «Borradores»

#### Scenario: Nombres nuevos
- **WHEN** un usuario abre la lista de terceros o la bandeja de todos los comprobantes
- **THEN** la barra, las migas, la paleta y el título de la pantalla las llaman «Clientes y proveedores» y «Todos los comprobantes», en las mismas direcciones de siempre

#### Scenario: Navegación no es autorización
- **WHEN** un operador solicita a la API una operación de un destino que su navegación no muestra
- **THEN** la API la sigue rechazando como antes
