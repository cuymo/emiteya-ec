## ADDED Requirements

### Requirement: Auditoría de la emisión de facturas
El sistema SHALL registrar un evento cuando una emisión deja una factura reservada, cuando la factura queda firmada y cuando un usuario pide un reintento de firma. Cada evento lleva actor, empresa, factura, número, clave de acceso y, al firmar, el SHA-256 del artefacto, nunca el XML ni secretos. Los borradores, las consultas y las emisiones rechazadas no generan eventos; el borrador conserva su autor y su fecha.

#### Scenario: Emisión firmada
- **WHEN** un usuario emite una factura que llega a firmada
- **THEN** existen un evento de reserva con su número y su clave de acceso y un evento de firma con el SHA-256 del artefacto, ambos con el usuario como actor

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de una factura reservada
- **THEN** existe un evento del reintento con el usuario como actor, y un evento de firma si el reintento la completa

#### Scenario: Emisión rechazada
- **WHEN** una emisión se rechaza por validación, permiso, idempotencia o conflicto antes de reservar
- **THEN** no se registra ningún evento

#### Scenario: Borradores y consultas
- **WHEN** un usuario guarda, corrige o elimina un borrador, o consulta facturas
- **THEN** no se registra ningún evento de auditoría

#### Scenario: Sin XML en la auditoría
- **WHEN** se registra cualquier evento de la emisión
- **THEN** el evento no contiene el XML, los bytes firmados ni datos de la firma electrónica
