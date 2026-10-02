# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de los ajustes del siguiente secuencial
El sistema SHALL registrar un evento de auditoría por cada ajuste exitoso del siguiente secuencial de un contador. Cada evento indica actor, empresa, ambiente, establecimiento y punto de emisión por su código, tipo de comprobante, valor anterior y nuevo, último número reservado, si el ajuste retrocede, el motivo cuando lo hay, y el momento.

#### Scenario: Avance del siguiente secuencial
- **WHEN** un administrador fija el siguiente secuencial de factura del punto `001-001` en `Producción` de 10 a 100
- **THEN** existe un evento con el administrador como actor, la empresa, el ambiente `Producción`, el establecimiento `001`, el punto `001`, el tipo factura, el valor anterior 10, el nuevo 100 y el último número reservado

#### Scenario: Retroceso con motivo
- **WHEN** un administrador retrocede el siguiente secuencial indicando un motivo
- **THEN** el evento indica que el ajuste retrocede y contiene el motivo

#### Scenario: Ajuste sin cambio o rechazado
- **WHEN** un administrador fija el valor que ya tiene el contador, o el ajuste se rechaza por validación, por permiso o por conflicto
- **THEN** no se registra ningún evento
