# audit-trail Specification

## Purpose

Conserva el rastro inmutable de los cambios críticos que un actor conocido realiza dentro de
una empresa: quién actuó, en qué empresa, sobre qué y qué cambió, para investigar
incidentes sin exponer secretos.

## Requirements

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

### Requirement: Auditoría de los cambios de configuración tributaria
El sistema SHALL registrar un evento de auditoría por cada cambio exitoso de la configuración tributaria: datos y atributos de la empresa, ambiente, logo, alta, corrección de la dirección, desactivación y reactivación de establecimientos, y alta, desactivación y reactivación de puntos de emisión. Cada evento indica actor, empresa, acción, qué se cambió, los valores anteriores y nuevos de cada dato cambiado y el momento.

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
- **WHEN** un administrador crea, desactiva o reactiva un establecimiento o un punto de emisión, o corrige la dirección de un establecimiento
- **THEN** existe un evento que identifica el establecimiento o el punto por su código, con los valores anteriores y nuevos de lo que cambió

#### Scenario: Operación sin cambio
- **WHEN** un administrador guarda la configuración sin cambios, pide el ambiente vigente o desactiva un establecimiento ya inactivo
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un cambio de la configuración se rechaza por validación, por falta de permiso, por conflicto o porque el RUC está bloqueado
- **THEN** no existe un evento de ese cambio

### Requirement: Auditoría de los ajustes del siguiente secuencial
El sistema SHALL registrar un evento de auditoría por cada ajuste exitoso del siguiente secuencial de un contador. Cada evento indica actor, empresa, ambiente, establecimiento y punto de emisión por su código, tipo de comprobante, valor anterior y nuevo, último número reservado, si el ajuste retrocede, el motivo cuando lo hay, y el momento.

#### Scenario: Avance del siguiente secuencial
- **WHEN** un administrador fija el siguiente secuencial de factura del punto `001-001` en `Producción` de 10 a 100
- **THEN** existe un evento con el administrador como actor, la empresa, el ambiente `Producción`, el establecimiento `001`, el punto `001`, el tipo factura, el valor anterior 10, el nuevo 100 y el último número reservado

#### Scenario: Retroceso con motivo
- **WHEN** un administrador retrocede el siguiente secuencial indicando un motivo
- **THEN** el evento indica que el ajuste retrocede y contiene el motivo

#### Scenario: Ajuste sin cambio o rechazado
- **WHEN** un administrador fija el valor que ya tiene el contador, o el ajuste se rechaza por validación, por permiso o por conflicto
- **THEN** no se registra ningún evento

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

### Requirement: Auditoría de la habilitación de catálogos fiscales
El sistema SHALL registrar un evento por cada cambio exitoso de la habilitación de una entrada del catálogo fiscal para una empresa, con actor, empresa, catálogo, entrada, código, estado anterior y nuevo, y momento. Ni las consultas de catálogos ni la carga o actualización de los catálogos oficiales con una versión del producto generan eventos por empresa ni por entrada.

#### Scenario: Deshabilitar una tarifa
- **WHEN** un administrador deshabilita una tarifa de IVA
- **THEN** existe un evento con el administrador como actor, la empresa, la tarifa y el cambio de habilitada a deshabilitada

#### Scenario: Habilitación sin cambio
- **WHEN** un administrador habilita una entrada que ya estaba habilitada
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un cambio de habilitación se rechaza por permiso, por validación o porque el catálogo no admite habilitación
- **THEN** no se registra ningún evento

#### Scenario: Consultas y actualización de los catálogos oficiales
- **WHEN** un usuario consulta los catálogos, o una versión nueva del producto incorpora entradas oficiales
- **THEN** no se registra ningún evento de auditoría por empresa ni por entrada

### Requirement: Auditoría de terceros
El sistema SHALL registrar un evento por cada alta, corrección que cambia algo, desactivación y reactivación exitosas de un tercero, con actor, empresa, tercero y momento. Un cambio de identificación, razón social o roles guarda su valor anterior y el nuevo; un cambio de dirección, correo o teléfono guarda solo los nombres de los campos cambiados, nunca sus valores anteriores ni nuevos. Ni las consultas, ni las búsquedas, ni la creación del consumidor final por el sistema generan eventos.

#### Scenario: Alta de un tercero
- **WHEN** un usuario registra un tercero
- **THEN** existe un evento con el usuario como actor, la empresa, la identificación, la razón social y los roles

#### Scenario: Cambio de identificación
- **WHEN** un usuario corrige la identificación de un tercero
- **THEN** existe un evento con la identificación anterior y la nueva

#### Scenario: Cambio de datos de contacto
- **WHEN** un usuario corrige el correo y el teléfono de un tercero
- **THEN** existe un evento que indica que cambiaron el correo y el teléfono, sin ninguno de sus valores anteriores ni nuevos

#### Scenario: Corrección sin cambios o rechazada
- **WHEN** una corrección no cambia ningún dato, o se rechaza por validación, permiso, identificación repetida o versión desactualizada
- **THEN** no se registra ningún evento

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un tercero que ya estaba desactivado
- **THEN** no se registra ningún evento

### Requirement: Auditoría de productos
El sistema SHALL registrar un evento por cada alta, desactivación y reactivación exitosas de un producto, y por cada corrección que cambia su precio o sus impuestos, con actor, empresa, producto, valor anterior y nuevo, y momento. Una corrección que solo cambia el nombre, la descripción, los códigos o el control de stock no genera evento. Ni las consultas ni las búsquedas generan eventos.

#### Scenario: Cambio de precio
- **WHEN** un usuario corrige el precio de un producto de `8.75` a `9.10`
- **THEN** existe un evento con el precio anterior y el nuevo

#### Scenario: Cambio de impuestos
- **WHEN** un usuario cambia la tarifa de IVA de un producto
- **THEN** existe un evento con la referencia anterior y la nueva, identificadas por su catálogo y su entrada

#### Scenario: Corrección solo descriptiva
- **WHEN** un usuario corrige solo el nombre de un producto
- **THEN** no se registra ningún evento

#### Scenario: Cambio rechazado
- **WHEN** un alta o una corrección de un producto se rechaza por validación, permiso, código en uso, impuesto no disponible o versión desactualizada
- **THEN** no se registra ningún evento
