## ADDED Requirements

### Requirement: Límite de tamaño del envío al SRI
El sistema SHALL mantener como política versionada el límite de tamaño de un comprobante firmado para su envío individual al SRI, con el texto de la fuente oficial, su sección, la unidad literal, su interpretación exacta en bytes y su vigencia. Sin una fuente oficial verificada, no publica la política: la cifra no se infiere ni se toma de una librería.

#### Scenario: Consulta de la política
- **WHEN** un administrador consulta las políticas fiscales
- **THEN** ve el límite en bytes, el texto y la sección de la fuente, la unidad literal y su vigencia

#### Scenario: Nueva versión de la fuente
- **WHEN** una versión nueva de la ficha cambia el límite
- **THEN** se publica una versión nueva de la política con su vigencia, y la anterior se conserva

#### Scenario: Fuente sin verificar
- **WHEN** la cifra exacta en bytes no puede verificarse en la fuente oficial
- **THEN** la política no se publica, no se usa ningún valor provisional y ningún comprobante se envía al SRI
