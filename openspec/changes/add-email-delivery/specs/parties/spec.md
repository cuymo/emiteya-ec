## MODIFIED Requirements

### Requirement: Catálogo único de terceros
El sistema SHALL permitir registrar en la empresa terceros reutilizables en cualquier rol, con tipo y número de identificación, razón social o nombres y, opcionalmente, dirección, hasta tres correos distintos, teléfono y roles. Los roles cliente, proveedor y transportista son opcionales y combinables, y solo clasifican: un tercero sin roles existe y puede recibir un uso más adelante.

#### Scenario: Alta de un tercero
- **WHEN** un usuario registra un tercero con RUC `1790012345001` y razón social "Comercial Andina S.A."
- **THEN** el tercero existe en su empresa, activo, con esos datos

#### Scenario: Tercero con varios roles
- **WHEN** un usuario registra un tercero como cliente y proveedor
- **THEN** el tercero aparece al filtrar por cliente y al filtrar por proveedor, y es un solo registro

#### Scenario: Tercero sin roles
- **WHEN** un usuario registra un tercero sin ningún rol
- **THEN** el tercero existe y aparece en las búsquedas sin filtro de rol, pero no al filtrar por un rol

#### Scenario: Varios correos
- **WHEN** un usuario registra un tercero con los correos `compras@cliente.ec` y `contabilidad@cliente.ec`
- **THEN** el tercero queda con los dos correos, en ese orden

#### Scenario: Datos fuera de sus límites
- **WHEN** un usuario registra un tercero sin razón social, con una razón social de más de 300 caracteres, con un correo con formato inválido, con más de tres correos o con un correo repetido
- **THEN** el sistema rechaza la solicitud indicando el campo, y no se crea ningún tercero

#### Scenario: Tercero registrado antes con un correo
- **WHEN** se consulta un tercero que tenía un solo correo antes de este cambio
- **THEN** el tercero tiene ese correo como el primero de su lista
