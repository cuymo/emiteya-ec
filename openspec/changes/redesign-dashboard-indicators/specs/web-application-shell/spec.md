## ADDED Requirements

### Requirement: Primeros pasos fuera de Inicio
Mientras la empresa no pueda emitir, la barra lateral SHALL mostrar «Primeros pasos» debajo de Inicio, con el número de requisitos pendientes, que lleva a su página. La barra superior no SHALL llevar un botón para esto. Esa página SHALL listar los requisitos para emitir, cumplidos y pendientes, con el enlace a resolver cada uno cuando el rol puede hacerlo, o pedir a un administrador que lo complete. Con la empresa lista para emitir, la opción no SHALL mostrarse, y la página SHALL decir que la empresa ya puede emitir.

#### Scenario: Empresa sin firma
- **WHEN** un administrador entra con la empresa sin firma electrónica
- **THEN** la barra lateral muestra «Primeros pasos» debajo de Inicio con 1 pendiente, y su página señala la firma con «Cargar la firma electrónica»

#### Scenario: Empresa lista
- **WHEN** la empresa ya cumple todos los requisitos
- **THEN** la barra lateral no muestra «Primeros pasos», y su página dice que la empresa ya puede emitir

#### Scenario: Operador
- **WHEN** un operador entra con requisitos pendientes
- **THEN** ve la opción y la página con lo que falta, sin los enlaces de configuración, y que debe pedírselo a un administrador
