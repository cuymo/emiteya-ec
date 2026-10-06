# Spec Delta

## MODIFIED Requirements

### Requirement: Auditoría de la reconciliación manual
El sistema SHALL registrar un evento cuando un administrador pide la reconciliación de una factura, de una nota de crédito, de una nota de débito o de un comprobante de retención con el SRI, y otro cuando esa reconciliación termina. Llevan el actor, la empresa, el comprobante y su tipo, el número, el motivo y el resultado, nunca la respuesta del SRI. Las transmisiones, consultas y reconciliaciones automáticas no generan eventos de auditoría: su evidencia son los intentos y las transiciones.

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

#### Scenario: Reconciliación de una nota de crédito
- **WHEN** un administrador pide la reconciliación de una nota de crédito y la reconciliación termina
- **THEN** existen los eventos de solicitud y de finalización con la nota, su número y su tipo

#### Scenario: Reconciliación de una nota de débito
- **WHEN** un administrador pide la reconciliación de una nota de débito y la reconciliación termina
- **THEN** existen los eventos de solicitud y de finalización de nota de débito con la nota, su número y su tipo, sin la respuesta del SRI

#### Scenario: Reconciliación de un comprobante de retención
- **WHEN** un administrador pide la reconciliación de un comprobante de retención y la reconciliación termina
- **THEN** existen los eventos de solicitud y de finalización de comprobante de retención con el comprobante, su número y su tipo, sin la respuesta del SRI

## ADDED Requirements

### Requirement: Auditoría de la emisión de comprobantes de retención
El sistema SHALL registrar un evento cuando un comprobante de retención queda reservado, cuando queda firmado y cuando comienza un reintento de firma válido. El de reserva lleva el comprobante, su número, su clave, el ambiente, el total retenido, el sujeto retenido, el período fiscal, la declaración de parte relacionada y el número de documentos sustento y de retenciones con sus impuestos. Ninguno lleva el XML, la respuesta del SRI ni secretos.

#### Scenario: Retención reservada y firmada
- **WHEN** un usuario emite un comprobante de retención que llega a firmado
- **THEN** existen un evento de reserva con el sujeto, el período y la declaración, y un evento de firma con el SHA-256 del artefacto, ambos con el usuario como actor

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de un comprobante de retención reservado
- **THEN** existe un evento de reintento con el comprobante y su número

#### Scenario: Solicitud rechazada antes de reservar
- **WHEN** una emisión de comprobante de retención se rechaza antes de reservar
- **THEN** no se registra ningún evento

#### Scenario: Sin duplicar otras evidencias
- **WHEN** un comprobante de retención se prepara en borrador, se transmite, se autoriza y se descarga su RIDE
- **THEN** esas acciones no generan eventos de auditoría: su evidencia son los intentos, las transiciones y el historial de entregas
