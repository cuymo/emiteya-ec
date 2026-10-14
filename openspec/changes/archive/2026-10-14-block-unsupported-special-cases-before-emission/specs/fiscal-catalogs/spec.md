## MODIFIED Requirements

### Requirement: Matriz de casos especiales
El sistema SHALL publicar la categoría de soporte de cada anexo de la ficha técnica: soportado en el alcance del MVP, condición del emisor, condición del go-live, no aplicable o fuera del MVP. Nadie la cambia desde la aplicación; cambiarla exige una versión nueva del producto.

#### Scenario: Consulta de la matriz
- **WHEN** un usuario consulta la matriz de casos especiales
- **THEN** ve los 26 anexos de la ficha con su tema y su categoría

#### Scenario: Anexo del RUC del proveedor
- **WHEN** un usuario consulta el anexo 26
- **THEN** figura como condición del go-live, no como funcionalidad ordinaria

#### Scenario: Anexo de los grandes contribuyentes
- **WHEN** un usuario consulta el anexo 24
- **THEN** figura fuera del MVP, con su tema, y no como una condición del emisor que el sistema aplica

#### Scenario: Intento de cambiar una categoría
- **WHEN** un administrador intenta cambiar la categoría de un anexo
- **THEN** el sistema rechaza la solicitud y la matriz no cambia
