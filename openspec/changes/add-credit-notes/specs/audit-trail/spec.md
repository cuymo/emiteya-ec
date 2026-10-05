# Spec Delta

## MODIFIED Requirements

### Requirement: Auditoría de la reconciliación manual
El sistema SHALL registrar un evento cuando un administrador pide la reconciliación de una factura o de una nota de crédito con el SRI, y otro cuando esa reconciliación termina. Llevan el actor, la empresa, el comprobante y su tipo, el número, el motivo y el resultado, nunca la respuesta del SRI. Las transmisiones, consultas y reconciliaciones automáticas no generan eventos de auditoría: su evidencia son los intentos y las transiciones.

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

## ADDED Requirements

### Requirement: Auditoría de la emisión de notas de crédito
El sistema SHALL registrar un evento cuando una nota de crédito queda reservada, cuando queda firmada y cuando comienza un reintento de firma válido. El de reserva lleva la nota, su número, su clave, el ambiente, el valor de la modificación, la factura modificada, la causa, la versión de la declaración y las afirmaciones declaradas. Ninguno lleva el XML, secretos ni el detalle de las líneas.

#### Scenario: Nota reservada y firmada
- **WHEN** un usuario emite una nota de crédito que llega a firmada
- **THEN** existen un evento de reserva con la factura, la causa y las declaraciones, y un evento de firma con el SHA-256 del artefacto, ambos con el usuario como actor

#### Scenario: Solicitud rechazada antes de reservar
- **WHEN** una emisión de nota se rechaza antes de reservar: por permiso, capacidad, factura no admitida, consumidor final o declaración faltante
- **THEN** no se registra ningún evento

#### Scenario: Sin duplicar otras evidencias
- **WHEN** una nota se transmite, se autoriza, aplica su crédito, devuelve stock y se descarga su RIDE
- **THEN** esas acciones no generan eventos de auditoría: su evidencia son los intentos, las transiciones, la capacidad, el kárdex y el historial de entregas
