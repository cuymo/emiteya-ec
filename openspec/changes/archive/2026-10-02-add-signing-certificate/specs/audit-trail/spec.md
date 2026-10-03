# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de la firma electrónica
El sistema SHALL registrar un evento de auditoría por cada carga o reemplazo exitoso de la firma electrónica y por cada cambio exitoso de la anticipación de su aviso de vencimiento. Cada evento indica actor, empresa, acción, el momento y, para la firma, la firma anterior y la nueva por sus metadatos: titular, emisor, número de serie, huella, vigencia, RUC detectado y si coincidía con el RUC de la empresa. Ningún evento contiene el archivo de la firma, su contraseña ni su clave privada.

#### Scenario: Primera carga
- **WHEN** un administrador carga la primera firma de la empresa
- **THEN** existe un evento con el administrador como actor, la empresa y los metadatos de la firma cargada, sin firma anterior

#### Scenario: Reemplazo
- **WHEN** un administrador reemplaza la firma vigente
- **THEN** existe un evento con los metadatos de la firma anterior y de la nueva
- **AND** el evento no contiene el archivo, la contraseña ni la clave privada de ninguna de las dos

#### Scenario: Cambio de la anticipación del aviso
- **WHEN** un administrador cambia la anticipación del aviso de 30 a 45 días
- **THEN** existe un evento con el valor anterior 30 y el nuevo 45

#### Scenario: Carga sin cambio o rechazada
- **WHEN** un administrador vuelve a cargar la firma vigente o fija la anticipación que ya tiene, o la operación se rechaza por validación, por permiso o por conflicto
- **THEN** no se registra ningún evento
