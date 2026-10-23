## ADDED Requirements

### Requirement: Auditoría del correo
El sistema SHALL registrar un evento por cada cambio exitoso del servidor de correo, con los nombres
de los campos cambiados y el valor anterior y el nuevo de los que no son secretos, nunca la
contraseña; por cada correo de prueba, con la dirección y el resultado; y por cada reenvío manual,
con el comprobante y las direcciones. Los envíos automáticos no SHALL auditarse: su historial es su
fuente de verdad.

#### Scenario: Cambio del servidor
- **WHEN** un administrador cambia el servidor y la contraseña del correo
- **THEN** existe un evento con el actor, la empresa, el servidor anterior y el nuevo, y la indicación de que la contraseña cambió, sin ninguna contraseña

#### Scenario: Correo de prueba
- **WHEN** un administrador envía un correo de prueba que el servidor rechaza
- **THEN** existe un evento con el actor, la dirección de prueba y el rechazo

#### Scenario: Reenvío manual
- **WHEN** un operador reenvía el correo de una factura
- **THEN** existe un evento con el operador, la factura y las direcciones del reenvío

#### Scenario: Envío automático
- **WHEN** sale el correo automático de un comprobante autorizado
- **THEN** no se registra ningún evento de auditoría por él

#### Scenario: Guardado sin cambios
- **WHEN** un administrador guarda el servidor de correo sin cambiar nada
- **THEN** no se registra ningún evento
