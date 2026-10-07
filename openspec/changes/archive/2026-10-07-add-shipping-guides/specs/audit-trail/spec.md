# Spec Delta

## MODIFIED Requirements

### Requirement: Auditoría de la reconciliación manual
El sistema SHALL registrar un evento cuando un administrador pide la reconciliación de una factura, de una nota de crédito, de una nota de débito, de una guía de remisión o de un comprobante de retención con el SRI, y otro cuando esa reconciliación termina. Llevan el actor, la empresa, el comprobante y su tipo, el número, el motivo y el resultado, nunca la respuesta del SRI. Las transmisiones, consultas y reconciliaciones automáticas no generan eventos de auditoría: su evidencia son los intentos y las transiciones.

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

#### Scenario: Reconciliación de una guía de remisión
- **WHEN** un administrador pide la reconciliación de una guía de remisión y la reconciliación termina
- **THEN** existen los eventos de solicitud y de finalización de guía de remisión con la guía, su número y su tipo, sin la respuesta del SRI

## ADDED Requirements

### Requirement: Auditoría de la emisión de guías de remisión
El sistema SHALL registrar un evento cuando una guía de remisión queda reservada, cuando queda firmada y cuando comienza un reintento de firma válido. El de reserva lleva la guía, su número, su clave, el ambiente, el origen del transportista con su identificación y su nombre, el número de destinatarios y de detalles, las clases de sustento y cada excepción declarada con su caso y su versión de la política. Ninguno lleva direcciones, descripciones, el XML, la respuesta del SRI ni secretos.

#### Scenario: Guía reservada y firmada
- **WHEN** un usuario emite una guía de remisión que llega a firmada
- **THEN** existen un evento de reserva con el transportista, los destinatarios y las excepciones declaradas, y un evento de firma con el SHA-256 del artefacto, ambos con el usuario como actor

#### Scenario: Excepción declarada en la auditoría
- **WHEN** un usuario emite una guía con un destinatario en consignación
- **THEN** el evento de reserva registra la excepción de consignación con su versión de la política y al usuario como quien la declaró

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de una guía de remisión reservada
- **THEN** existe un evento de reintento con la guía y su número; un reintento que no inicia un intento no genera evento

#### Scenario: Solicitud rechazada antes de reservar
- **WHEN** una emisión de guía de remisión se rechaza antes de reservar
- **THEN** no se registra ningún evento

#### Scenario: Sin duplicar otras evidencias
- **WHEN** una guía de remisión se prepara en borrador, se transmite, se autoriza y se descarga su RIDE
- **THEN** esas acciones no generan eventos de auditoría: su evidencia son los intentos, las transiciones y el historial de entregas
