## MODIFIED Requirements

### Requirement: Filtros de la bandeja
La bandeja SHALL filtrar por rango de fechas de emisión, tipo de comprobante, estado, identificación del receptor, número, establecimiento, punto de emisión y estado del último envío por correo, combinables entre sí. La identificación del receptor encuentra una guía de remisión por cualquiera de sus destinatarios. Un filtro con un valor inválido SHALL rechazarse sin consultar.

#### Scenario: Rango de fechas
- **WHEN** un usuario filtra del 1 al 15 de octubre de 2026
- **THEN** la bandeja contiene solo los comprobantes emitidos en ese rango, ambos días incluidos

#### Scenario: Establecimiento, punto y estado
- **WHEN** un usuario combina un establecimiento, un punto y el estado autorizado
- **THEN** la bandeja contiene solo los comprobantes autorizados de ese punto

#### Scenario: Identificación y número
- **WHEN** un usuario filtra por la identificación de un receptor o por un número de comprobante
- **THEN** la bandeja contiene solo los comprobantes que coinciden

#### Scenario: Filtro inválido
- **WHEN** un usuario envía una fecha mal formada, un rango invertido o un estado desconocido
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Identificación de un destinatario de una guía
- **WHEN** un usuario filtra por la identificación del segundo destinatario de una guía de remisión
- **THEN** la bandeja contiene esa guía

#### Scenario: Correo no enviado
- **WHEN** un usuario filtra por el correo fallido
- **THEN** la bandeja contiene solo los comprobantes autorizados cuyo último envío por correo falló

### Requirement: Historial de entregas
El sistema SHALL registrar en un historial de solo agregado cada descarga servida y cada solicitud de impresión, con el comprobante, el tipo y el hash del documento, el actor y el momento, nunca sus bytes. Una descarga significa que la aplicación inició una respuesta autorizada con el documento, no que el cliente lo guardó; una solicitud de impresión, que un usuario la pidió. Ninguna significa que el receptor lo recibió. El historial no se duplica en la auditoría. Los envíos por correo tienen su propio historial (`email-delivery`).

#### Scenario: Descarga registrada
- **WHEN** se sirve una descarga del RIDE o de un XML
- **THEN** queda una entrega de descarga con el comprobante, el tipo y el hash del documento, el usuario y el momento

#### Scenario: Solicitud de impresión registrada
- **WHEN** se solicita la impresión del RIDE
- **THEN** queda una entrega de solicitud de impresión con los mismos datos

#### Scenario: Bytes para imprimir
- **WHEN** después de la solicitud la interfaz obtiene el RIDE para imprimirlo
- **THEN** queda además una descarga, porque la aplicación sirvió los bytes

#### Scenario: Descarga no servida
- **WHEN** una descarga se rechaza por permiso, disponibilidad o integridad
- **THEN** no queda ninguna entrega

#### Scenario: Consulta del historial
- **WHEN** un usuario con permiso consulta las entregas de un comprobante
- **THEN** las ve de la más reciente a la más antigua, sin bytes ni datos técnicos

#### Scenario: Historial inmutable
- **WHEN** cualquier operación intenta cambiar o borrar una entrega registrada
- **THEN** el sistema lo impide

#### Scenario: Sin entrega confirmada ni correo
- **WHEN** se consulta el historial
- **THEN** no hay entregas marcadas como recibidas o impresas ni entregas por correo: los envíos por correo están en su propio historial, y el envío por el sistema no genera una descarga

#### Scenario: Sin duplicar la auditoría
- **WHEN** se registra una entrega
- **THEN** no se registra un evento de auditoría por ella
