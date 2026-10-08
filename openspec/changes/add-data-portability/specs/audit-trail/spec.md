# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de la generación de las exportaciones de portabilidad
El sistema SHALL registrar `data_export.requested` cuando un administrador solicita una exportación de portabilidad, `data_export.completed` cuando su paquete queda listo, con sus conteos, su tamaño y su SHA-256, y `data_export.failed` cuando falla, con solo su código seguro. Ningún evento contiene rutas, nombres de archivos interiores, contenido del paquete, XML, respuestas del SRI ni datos personales.

#### Scenario: Solicitud
- **WHEN** un administrador solicita una exportación de portabilidad
- **THEN** existe un evento `data_export.requested` con el administrador como actor y la empresa

#### Scenario: Generación completada
- **WHEN** el paquete de una exportación queda listo
- **THEN** existe un evento `data_export.completed` con los conteos del paquete, su tamaño y su SHA-256

#### Scenario: Generación fallida
- **WHEN** una exportación falla por integridad, por falta de espacio o por cualquier otra causa
- **THEN** existe un evento `data_export.failed` con solo el código de la falla, sin rutas ni detalles internos

#### Scenario: Paquete listo perdido o alterado
- **WHEN** un paquete listo queda fallido porque su archivo falta o no coincide antes de caducar
- **THEN** existe un evento `data_export.failed` con solo el código, sin rutas

#### Scenario: Solicitud rechazada
- **WHEN** una solicitud se rechaza por permisos, por datos no permitidos o porque ya hay una generación en curso
- **THEN** no se registra ningún evento de portabilidad

#### Scenario: Sin un evento por comprobante
- **WHEN** se genera una exportación con miles de comprobantes
- **THEN** no se registra ningún evento ni ninguna entrega por cada comprobante del paquete

### Requirement: Auditoría del inicio de las descargas de portabilidad
El sistema SHALL registrar `data_export.download_started` cuando, tras autenticar, autorizar, confirmar que el paquete está listo y vigente y verificar su integridad, está por enviar el primer byte de una descarga, y lo registra antes de enviarlo. Si no puede registrarlo, no entrega nada. El evento no afirma que el usuario recibió el archivo completo.

#### Scenario: Inicio de una descarga
- **WHEN** un administrador descarga un paquete listo
- **THEN** existe un evento `data_export.download_started` con el administrador como actor, registrado antes del primer byte

#### Scenario: Auditoría que falla antes de entregar
- **WHEN** el evento `data_export.download_started` no se puede registrar
- **THEN** el sistema no envía ningún byte del paquete

#### Scenario: Descarga rechazada
- **WHEN** una descarga se rechaza por permisos, porque el paquete no está listo, caducó o no pasa la verificación de integridad
- **THEN** no se registra ningún evento `data_export.download_started`

#### Scenario: Dos descargas
- **WHEN** un administrador descarga dos veces el mismo paquete
- **THEN** existen dos eventos `data_export.download_started`
