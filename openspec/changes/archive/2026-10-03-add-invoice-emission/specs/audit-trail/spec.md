## ADDED Requirements

### Requirement: Auditoría de la emisión de facturas
El sistema SHALL registrar un evento cuando una emisión deja una factura reservada, cuando la factura queda firmada y cuando comienza un intento de firma válido que un usuario pide sobre una factura reservada. Todos llevan actor, empresa y factura. El de reserva lleva además el número, la clave de acceso, el ambiente y el total; el de firma, el número y el SHA-256 del artefacto; el del reintento, el número y su resultado. Ninguno lleva el XML ni secretos. No generan eventos los borradores, las consultas, las solicitudes rechazadas antes de iniciar una operación fiscal ni los reintentos que no inician un intento, porque la factura ya está firmada u otro intento está en curso. El borrador conserva su autor y su fecha.

#### Scenario: Emisión firmada
- **WHEN** un usuario emite una factura que llega a firmada
- **THEN** existen un evento de reserva con su número y su clave de acceso y un evento de firma con el SHA-256 del artefacto, ambos con el usuario como actor

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de una factura reservada y el intento comienza
- **THEN** existe un evento del reintento con el usuario como actor y su resultado, y un evento de firma si el intento la completa

#### Scenario: Reintento que no inicia un intento
- **WHEN** un usuario reintenta la firma de una factura ya firmada, o mientras otro intento de esa factura está en curso
- **THEN** no se registra ningún evento del reintento

#### Scenario: Solicitud rechazada antes de iniciar una operación fiscal
- **WHEN** una emisión o un reintento se rechaza antes de iniciar una operación fiscal: sin sesión, con un borrador o una factura inexistente o de otra empresa, con un campo no permitido, sin clave de idempotencia o con una clave reutilizada, por validación o por conflicto
- **THEN** no se registra ningún evento

#### Scenario: Borradores y consultas
- **WHEN** un usuario guarda, corrige o elimina un borrador, o consulta facturas
- **THEN** no se registra ningún evento de auditoría

#### Scenario: Sin XML en la auditoría
- **WHEN** se registra cualquier evento de la emisión
- **THEN** el evento no contiene el XML, los bytes firmados ni datos de la firma electrónica
