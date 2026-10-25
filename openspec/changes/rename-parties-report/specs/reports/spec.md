## RENAMED Requirements

- FROM: `### Requirement: Reporte de terceros`
- TO: `### Requirement: Reporte de clientes y proveedores`

## MODIFIED Requirements

### Requirement: Reportes de la empresa
El sistema SHALL ofrecer exactamente cinco reportes: Documentos emitidos, Facturas, Retenciones, Inventario (con sus vistas Existencias y Movimientos) y Clientes y proveedores. Cada reporte es un listado paginado de filas, con sus filtros y su exportación a XLSX. Los reportes no suman totales, no compensan comprobantes entre sí y no reemplazan obligaciones contables ni anexos tributarios.

#### Scenario: Los cinco reportes
- **WHEN** un usuario con permiso abre Reportes
- **THEN** puede elegir Documentos emitidos, Facturas, Retenciones, Inventario o Clientes y proveedores, y ningún otro

#### Scenario: Sin totales ni compensación
- **WHEN** la empresa tiene una factura de 100.00, una nota de crédito de 20.00 y una nota de débito de 10.00 sobre ella, todas autorizadas
- **THEN** Documentos emitidos muestra tres filas, cada una con su propio importe, sin una fila de totales ni un valor neto de 90.00 o 110.00

#### Scenario: Aviso de los reportes
- **WHEN** un usuario consulta o exporta un reporte
- **THEN** el reporte indica que no reemplaza obligaciones contables ni anexos tributarios

### Requirement: Reporte de clientes y proveedores
Clientes y proveedores SHALL listar una fila por tercero de la empresa con su identificación, su razón social, su correo, su teléfono, sus roles y su estado, tal como están registrados hoy. Se filtra por rol, identificación y estado.

#### Scenario: Filtro por rol
- **WHEN** un usuario filtra Clientes y proveedores por el rol de proveedor
- **THEN** el reporte lista solo los terceros con ese rol, con todos sus roles en la fila

#### Scenario: Datos vigentes
- **WHEN** un tercero corrige su correo
- **THEN** el reporte de clientes y proveedores muestra el correo vigente
