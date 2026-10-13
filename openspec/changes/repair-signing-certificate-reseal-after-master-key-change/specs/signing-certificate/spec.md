## MODIFIED Requirements

### Requirement: Reemplazo de la firma
El sistema SHALL permitir que un administrador reemplace la firma vigente por otra que cumpla las condiciones de carga, indicando qué firma ve como vigente. La firma nueva pasa a ser la vigente; el archivo y la contraseña de la anterior se eliminan y sus metadatos se conservan. Cargar otra vez la firma vigente no cambia nada mientras su secreto pueda abrirse con la clave de custodia configurada; si no puede abrirse, esa carga es una recuperación de la custodia.

#### Scenario: Reemplazo
- **WHEN** un administrador carga una firma válida distinta de la vigente, indicando la firma vigente que ve
- **THEN** la firma nueva pasa a ser la vigente
- **AND** el archivo y la contraseña de la anterior ya no se conservan

#### Scenario: Misma firma otra vez
- **WHEN** un administrador carga de nuevo el mismo certificado que ya es la firma vigente, y el secreto de esa firma se abre con la clave de custodia configurada
- **THEN** la firma vigente no cambia y se le indica que ya era la vigente

#### Scenario: Firma vigente que cambió
- **WHEN** un administrador prepara un reemplazo viendo una firma vigente y, antes de confirmarlo, otra carga cambia la firma vigente
- **THEN** el sistema rechaza el reemplazo con un conflicto que pide recargar, y la firma vigente es la de la otra carga

#### Scenario: Reemplazos simultáneos
- **WHEN** dos administradores reemplazan a la vez la misma firma vigente por firmas distintas
- **THEN** solo uno de los reemplazos se aplica y el otro se rechaza con un conflicto

#### Scenario: Reemplazo rechazado
- **WHEN** la firma nueva no cumple las condiciones de carga
- **THEN** la firma vigente, su archivo y su contraseña no cambian

## ADDED Requirements

### Requirement: Recuperación de la custodia de la firma
El sistema SHALL permitir que un administrador restablezca la custodia de la firma vigente cuyo secreto no puede abrirse con la clave de custodia configurada, cargando un PKCS#12 del mismo certificado con su contraseña e indicando la firma vigente que ve. La carga cumple todas las condiciones de una carga normal. La firma sigue siendo la misma, con sus metadatos; su secreto queda cifrado solo con la clave configurada y la firma vuelve a ser utilizable.

#### Scenario: Recuperación después de cambiar la clave de custodia
- **WHEN** la instalación arranca con otra clave de custodia, la firma vigente figura como no disponible y un administrador carga el mismo PKCS#12 con su contraseña correcta, indicando la firma vigente que ve
- **THEN** la firma vigente sigue siendo la misma, con su titular, emisor, número de serie, vigencia y RUC detectado, y vuelve a ser utilizable
- **AND** la respuesta indica que hubo un cambio, y el administrador ve que la custodia de la firma se restableció

#### Scenario: Misma firma después de recuperarla
- **WHEN** un administrador vuelve a cargar el mismo PKCS#12 después de restablecer su custodia
- **THEN** la firma vigente no cambia y se le indica que ya era la vigente

#### Scenario: Contraseña incorrecta en la recuperación
- **WHEN** un administrador intenta restablecer la custodia de la firma no disponible con el mismo PKCS#12 y una contraseña incorrecta
- **THEN** el sistema rechaza la carga con el error de la contraseña
- **AND** la firma vigente y su secreto no cambian, y la firma sigue no disponible

#### Scenario: Recuperación rechazada por las condiciones de carga
- **WHEN** un administrador intenta restablecer la custodia de la firma no disponible con un archivo que no cumple las condiciones de carga, por ejemplo ilegible, mayor que el límite, sin la clave privada del certificado o con el certificado fuera de vigencia
- **THEN** el sistema rechaza la carga por esa causa
- **AND** la firma vigente y su secreto no cambian

#### Scenario: Firma distinta con la custodia no disponible
- **WHEN** la firma vigente figura como no disponible y un administrador carga una firma válida de otro certificado, indicando la firma vigente que ve
- **THEN** la carga es un reemplazo: la firma nueva pasa a ser la vigente y la anterior conserva solo sus metadatos

#### Scenario: Recuperación con una vista desactualizada
- **WHEN** un administrador intenta restablecer la custodia de la firma no disponible indicando como vigente otra firma, o ninguna
- **THEN** el sistema rechaza la carga con un conflicto que pide recargar
- **AND** la firma vigente y su secreto no cambian

#### Scenario: Recuperaciones simultáneas
- **WHEN** dos administradores cargan a la vez el mismo PKCS#12 de la firma no disponible, indicando la firma vigente que ven
- **THEN** la custodia se restablece una sola vez, con un solo evento de auditoría
- **AND** la otra carga responde que la firma ya era la vigente, sin cambiar nada

#### Scenario: Volver solo a la clave anterior
- **WHEN** la custodia se restableció con la clave configurada y la instalación vuelve a arrancar solo con la clave anterior, sin restaurar la base de datos
- **THEN** la firma figura como no disponible: la custodia restablecida depende solo de la clave con la que se restableció

#### Scenario: Recuperación desde otra empresa
- **WHEN** un administrador de la empresa B carga un PKCS#12 del mismo certificado que la firma no disponible de la empresa A
- **THEN** solo la firma de la empresa B cambia, según sus propias reglas de carga
- **AND** la firma de la empresa A, su secreto y su estado no cambian, y el administrador de B no ve ningún dato de la firma de A

#### Scenario: Operador intenta recuperar
- **WHEN** un operador intenta cargar la firma no disponible
- **THEN** el sistema rechaza la solicitud por falta de permiso y nada cambia

#### Scenario: Recuperación sin secretos
- **WHEN** un administrador restablece la custodia de la firma, o la recuperación se rechaza por cualquier motivo
- **THEN** ni la respuesta, ni los mensajes de error, ni los registros del sistema, ni la auditoría contienen el archivo, la contraseña, la clave privada, la clave de custodia ni el secreto cifrado
