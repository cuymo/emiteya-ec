## ADDED Requirements

### Requirement: Auditoría de la reconciliación manual
El sistema SHALL registrar un evento cuando un administrador pide la reconciliación de una factura con el SRI, y otro cuando esa reconciliación termina. Llevan el actor, la empresa, la factura, el número, el motivo y el resultado, nunca la respuesta del SRI. Las transmisiones, consultas y reconciliaciones automáticas no generan eventos de auditoría: su evidencia son los intentos y las transiciones.

#### Scenario: Reconciliación pedida y completada
- **WHEN** un administrador pide la reconciliación de una factura y la reconciliación termina
- **THEN** existen un evento de solicitud con su motivo y un evento de finalización con su resultado, ambos con el administrador como actor

#### Scenario: Transmisión automática
- **WHEN** una factura se transmite, se consulta y se reconcilia sin intervención de un usuario
- **THEN** no se registra ningún evento de auditoría

#### Scenario: Solicitud rechazada
- **WHEN** una solicitud de reconciliación se rechaza por permiso, estado, transmisión en curso o factura de otra empresa
- **THEN** no se registra ningún evento

#### Scenario: Sin SOAP en la auditoría
- **WHEN** se registra un evento de la reconciliación
- **THEN** no contiene la respuesta del SRI, el XML firmado ni el XML autorizado
