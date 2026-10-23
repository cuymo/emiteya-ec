## ADDED Requirements

### Requirement: Auditoría del nombre propio
El sistema SHALL registrar un evento de auditoría por cada cambio exitoso del nombre propio, con el
usuario como actor y como usuario afectado, la empresa activa de su sesión, el nombre anterior, el
nombre nuevo y el momento. El avatar, de uso solo personal, no SHALL auditarse.

#### Scenario: Cambio del nombre propio
- **WHEN** un operador cambia su nombre de «Ana Ruiz» a «Ana María Ruiz»
- **THEN** existe un evento con el operador como actor y como usuario afectado, su empresa, «Ana Ruiz» como nombre anterior, «Ana María Ruiz» como nombre nuevo y el momento

#### Scenario: Sin cambio
- **WHEN** un usuario guarda el nombre que ya tiene, o el mismo cambio llega dos veces
- **THEN** existe a lo sumo un evento por el cambio que se aplicó

#### Scenario: El avatar no se audita
- **WHEN** un usuario carga, reemplaza o quita su avatar
- **THEN** no se registra ningún evento de auditoría
