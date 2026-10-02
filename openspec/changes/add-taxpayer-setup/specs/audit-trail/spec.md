# Spec Delta

## ADDED Requirements

### Requirement: Auditoría de los cambios de configuración tributaria
El sistema SHALL registrar un evento de auditoría por cada cambio exitoso de la configuración tributaria: datos y atributos de la empresa, ambiente, logo, alta, edición, desactivación y reactivación de establecimientos y de puntos de emisión. Cada evento indica actor, empresa, acción, qué se cambió, los valores anteriores y nuevos de cada dato cambiado y el momento.

#### Scenario: Corrección de datos de la empresa
- **WHEN** un administrador corrige la razón social y la dirección matriz
- **THEN** existe un evento con el administrador como actor, la empresa, la acción de cambio de datos, la versión nueva de la configuración, y los valores anteriores y nuevos de la razón social y de la dirección matriz
- **AND** el evento no incluye los datos que no cambiaron

#### Scenario: Primer registro de los datos
- **WHEN** un administrador registra por primera vez los datos de la empresa
- **THEN** existe un evento con los valores registrados y sin valores anteriores

#### Scenario: Cambio de ambiente
- **WHEN** un administrador cambia el ambiente de `Pruebas` a `Producción`
- **THEN** existe un evento con el ambiente anterior, el ambiente nuevo y la versión nueva de la configuración

#### Scenario: Reemplazo o eliminación del logo
- **WHEN** un administrador reemplaza o elimina el logo
- **THEN** existe un evento que identifica el logo anterior y el nuevo, o su ausencia, por su tipo, tamaño y huella de integridad
- **AND** el evento no contiene el contenido de ninguna imagen

#### Scenario: Cambios de establecimientos y puntos de emisión
- **WHEN** un administrador crea, corrige, desactiva o reactiva un establecimiento o un punto de emisión
- **THEN** existe un evento que identifica el establecimiento o el punto por su código, con los valores anteriores y nuevos de lo que cambió

#### Scenario: Operación sin cambio
- **WHEN** un administrador guarda la configuración sin cambios, pide el ambiente vigente o desactiva un establecimiento ya inactivo
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un cambio de la configuración se rechaza por validación, por falta de permiso, por conflicto o porque el RUC está bloqueado
- **THEN** no existe un evento de ese cambio
