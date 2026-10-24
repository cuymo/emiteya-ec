## ADDED Requirements

### Requirement: Primeros pasos fuera de Inicio
Mientras la empresa no pueda emitir, la barra superior SHALL mostrar «Falta configurar» con el número de requisitos pendientes, que lleva a la página «Primeros pasos». Esa página SHALL listar los requisitos para emitir, cumplidos y pendientes, con el enlace a resolver cada uno cuando el rol puede hacerlo, o pedir a un administrador que lo complete. Con la empresa lista para emitir, el botón no SHALL mostrarse, y la página SHALL decir que la empresa ya puede emitir.

#### Scenario: Empresa sin firma
- **WHEN** un administrador entra con la empresa sin firma electrónica
- **THEN** la barra superior muestra «Falta configurar» con 1 pendiente, y la página «Primeros pasos» señala la firma con «Cargar la firma electrónica»

#### Scenario: Empresa lista
- **WHEN** la empresa ya cumple todos los requisitos
- **THEN** la barra superior no muestra el botón, y «Primeros pasos» dice que la empresa ya puede emitir

#### Scenario: Operador
- **WHEN** un operador entra con requisitos pendientes
- **THEN** ve el botón y la página con lo que falta, sin los enlaces de configuración, y que debe pedírselo a un administrador
