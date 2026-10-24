## MODIFIED Requirements

### Requirement: Filtros de la bandeja
La bandeja SHALL filtrar por rango de fechas de emisión, tipo de comprobante, estado, identificación del receptor, número, establecimiento, punto de emisión y estado del último envío por correo, combinables entre sí. La identificación del receptor encuentra una guía de remisión por cualquiera de sus destinatarios. La búsqueda por texto SHALL encontrar un comprobante por su número, por el nombre de su receptor o por su identificación, incluidos el nombre y la identificación de cualquier destinatario de una guía de remisión. Un filtro con un valor inválido SHALL rechazarse sin consultar.

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

#### Scenario: Búsqueda por identificación
- **WHEN** un usuario escribe en la búsqueda la identificación de un comprador, o la del tercer destinatario de una guía
- **THEN** la bandeja contiene los comprobantes de ese receptor, o esa guía
