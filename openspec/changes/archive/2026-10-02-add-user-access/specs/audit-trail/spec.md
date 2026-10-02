# Spec Delta

## Purpose

Conserva el rastro inmutable de los cambios críticos que un actor conocido realiza dentro de
una empresa: quién actuó, en qué empresa, sobre qué y qué cambió, para investigar
incidentes sin exponer secretos.

## ADDED Requirements

### Requirement: Auditoría de los cambios administrativos de acceso
El sistema SHALL registrar un evento de auditoría por cada cambio exitoso de acceso: aprovisionamiento inicial, alta de usuario, cambio de rol, desactivación, reactivación, contraseña establecida por un administrador y recuperación administrativa de emergencia. Cada evento indica actor, empresa, acción, usuario afectado, qué cambió y momento.

#### Scenario: Alta de un usuario
- **WHEN** un administrador crea un usuario
- **THEN** existe un evento con el administrador como actor, la empresa, la acción de alta, el usuario creado, el rol asignado y el momento

#### Scenario: Cambio de rol
- **WHEN** un administrador cambia el rol de un usuario de Operador a Administrador
- **THEN** existe un evento con el rol anterior y el rol nuevo

#### Scenario: Acción del sistema o del administrador técnico
- **WHEN** ocurre el aprovisionamiento inicial o una recuperación administrativa de emergencia
- **THEN** el evento identifica como actor al sistema o al administrador técnico, nunca a un usuario que no actuó

#### Scenario: Operación sin cambio
- **WHEN** un administrador asigna a un usuario el rol que ya tiene, o desactiva a un usuario ya desactivado
- **THEN** no se registra ningún evento

### Requirement: Registro atómico con el cambio
El sistema SHALL registrar el evento de un cambio exitoso de forma que no exista un cambio sin su evento ni un evento de un cambio que no ocurrió.

#### Scenario: El cambio falla
- **WHEN** el alta de un usuario falla, por ejemplo porque el correo ya existe
- **THEN** no existe un evento de alta para esa solicitud

#### Scenario: El registro del evento falla
- **WHEN** el evento de un cambio de rol no puede registrarse
- **THEN** el cambio de rol no se aplica

### Requirement: Auditoría sin secretos
El sistema SHALL excluir de los eventos de auditoría las contraseñas, sus hashes, las credenciales de sesión y cualquier otro secreto.

#### Scenario: Contraseña establecida por un administrador
- **WHEN** un administrador establece la contraseña de un usuario
- **THEN** el evento registra que la contraseña cambió y quién la cambió
- **AND** el evento no contiene la contraseña ni ningún derivado de ella

### Requirement: Auditoría inmutable y aislada por empresa
El sistema SHALL impedir que cualquier usuario, de cualquier empresa y con cualquier rol, modifique o elimine un evento de auditoría, y SHALL asociar cada evento a la empresa en la que ocurrió el cambio.

#### Scenario: Intento de modificar o eliminar un evento
- **WHEN** cualquier usuario, incluido un administrador, intenta modificar o eliminar un evento de auditoría
- **THEN** no existe ninguna operación que lo permita y el evento permanece intacto

#### Scenario: Eventos de otra empresa
- **WHEN** ocurre un cambio en la empresa A
- **THEN** su evento queda asociado a la empresa A y nunca a la empresa B
