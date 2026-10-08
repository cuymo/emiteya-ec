# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de las exportaciones de reportes
El sistema SHALL registrar un evento cuando el servidor termina de generar correctamente el XLSX de un reporte, con el actor, la empresa, el tipo de reporte, el momento, el número de filas y los filtros que no contienen datos personales. De un filtro con un dato personal, como la identificación de un tercero, solo registra que estuvo presente. El evento no afirma que el usuario abrió, guardó ni recibió el archivo completo.

#### Scenario: Exportación generada
- **WHEN** un usuario exporta Documentos emitidos de septiembre de 2026 con el estado autorizado y el ambiente de Producción
- **THEN** existe un evento de exportación con el usuario como actor, el reporte, el rango de fechas, el estado, el ambiente y el número de filas

#### Scenario: Filtro con un dato personal
- **WHEN** un usuario exporta Facturas filtradas por la identificación de un cliente
- **THEN** el evento registra que se filtró por cliente, sin la identificación, el nombre, el correo ni el teléfono

#### Scenario: Sin contenido del archivo
- **WHEN** se registra un evento de exportación
- **THEN** no contiene filas, celdas, el archivo, rutas temporales, XML ni RIDE

#### Scenario: Exportación rechazada o fallida
- **WHEN** una exportación se rechaza por permisos, por filtros inválidos, por superar el máximo de filas o de exportaciones simultáneas, o falla antes de terminar de generarse
- **THEN** no se registra ningún evento de exportación

#### Scenario: Cada exportación generada es un evento
- **WHEN** un usuario exporta dos veces el mismo reporte con los mismos filtros
- **THEN** existen dos eventos de exportación, uno por cada archivo generado

#### Scenario: Consultar un reporte no se audita
- **WHEN** un usuario consulta un reporte o cambia sus filtros sin exportar
- **THEN** no se registra ningún evento
