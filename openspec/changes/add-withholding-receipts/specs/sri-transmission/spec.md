# Spec Delta

## MODIFIED Requirements

### Requirement: Reconciliación manual
Un administrador SHALL poder pedir, con un motivo, la reconciliación de una factura, de una nota de crédito, de una nota de débito o de un comprobante de retención en revisión manual, en resultado incierto, o firmada o recibida con su transmisión detenida. La reconciliación manual sigue las reglas de la automática, y el historial guarda quién la pidió, el motivo y el resultado.

#### Scenario: Reconciliación de una revisión manual
- **WHEN** un administrador reconcilia una factura en revisión manual y el SRI la informa autorizada
- **THEN** pasa a autorizada y el historial registra al administrador, el motivo y el resultado

#### Scenario: Revisión manual sin conclusión
- **WHEN** la reconciliación manual no obtiene una respuesta concluyente
- **THEN** la factura sigue en revisión manual y el historial registra el resultado

#### Scenario: Transmisión en curso
- **WHEN** un administrador pide una reconciliación mientras otra interacción de esa factura con el SRI está en curso
- **THEN** se rechaza sin programar otra

#### Scenario: Solicitudes simultáneas
- **WHEN** dos solicitudes piden a la vez la reconciliación de la misma factura
- **THEN** solo una se programa

#### Scenario: Estado que no se reconcilia
- **WHEN** la factura está autorizada, no autorizada o devuelta
- **THEN** se rechaza la reconciliación

#### Scenario: Operador
- **WHEN** un operador pide una reconciliación
- **THEN** el sistema responde prohibido

#### Scenario: Nota de crédito en revisión manual
- **WHEN** un administrador reconcilia una nota de crédito en revisión manual y el SRI la informa autorizada
- **THEN** la nota pasa a autorizada con las mismas reglas que una factura, y su crédito pasa a aplicado

#### Scenario: Nota de débito en revisión manual
- **WHEN** un administrador reconcilia una nota de débito en revisión manual y el SRI la informa autorizada
- **THEN** la nota pasa a autorizada con las mismas reglas que una factura, sin cambiar la capacidad acreditable de su factura ni el inventario

#### Scenario: Nota de débito en un estado que no se reconcilia
- **WHEN** un administrador pide la reconciliación de una nota de débito autorizada, no autorizada o devuelta
- **THEN** se rechaza la reconciliación sin programarla

#### Scenario: Comprobante de retención en revisión manual
- **WHEN** un administrador reconcilia un comprobante de retención en revisión manual y el SRI lo informa autorizado
- **THEN** el comprobante pasa a autorizado con las mismas reglas que una factura, sin cambiar inventario ni facturas

#### Scenario: Comprobante de retención en un estado que no se reconcilia
- **WHEN** un administrador pide la reconciliación de un comprobante de retención autorizado, no autorizado o devuelto
- **THEN** se rechaza la reconciliación sin programarla

### Requirement: Transmisión de cada tipo emitido
La transmisión SHALL tratar igual la factura, la nota de crédito, la nota de débito y el comprobante de retención: el mismo envío, la misma consulta de autorización, la evidencia guardada antes de clasificar, los errores 70, 43 y 45, el resultado incierto, la revisión manual y la reconciliación por clave. No existe otra transmisión por tipo.

#### Scenario: Nota de crédito autorizada
- **WHEN** una nota de crédito firmada se envía y el SRI la autoriza
- **THEN** queda autorizada con su número de autorización y su XML autorizado, como una factura

#### Scenario: Nota de crédito con resultado incierto
- **WHEN** el envío de una nota de crédito termina sin respuesta concluyente
- **THEN** la nota queda verificando con el SRI y se reconcilia por su clave, sin reenviarse antes de saber si el SRI la recibió

#### Scenario: Nota de crédito devuelta o no autorizada
- **WHEN** el SRI devuelve una nota de crédito en la recepción o la informa no autorizada
- **THEN** la nota queda devuelta o no autorizada con sus mensajes, como una factura

#### Scenario: Respuesta guardada de una nota
- **WHEN** la decisión local de una nota falla después de guardar la respuesta del SRI
- **THEN** el reintento clasifica la respuesta guardada sin volver a llamar al SRI

#### Scenario: Error 70 en una nota de crédito
- **WHEN** el SRI responde el error 70 para una nota de crédito
- **THEN** la nota se trata como clave en procesamiento, igual que una factura

#### Scenario: Nota de débito recibida y autorizada
- **WHEN** una nota de débito firmada se envía, la recepción responde `RECIBIDA` y la consulta la informa autorizada
- **THEN** la nota pasa por recibida y queda autorizada con su número de autorización y su XML autorizado, como una factura

#### Scenario: Nota de débito devuelta
- **WHEN** la recepción responde `DEVUELTA` para una nota de débito
- **THEN** la nota queda devuelta con todos los mensajes del SRI

#### Scenario: Nota de débito no autorizada
- **WHEN** la consulta informa no autorizada una nota de débito
- **THEN** la nota queda no autorizada con sus mensajes

#### Scenario: Errores 70, 43 y 45 en una nota de débito
- **WHEN** el SRI responde el error 70, el 43 o el 45 para una nota de débito
- **THEN** la nota sigue las mismas reglas que una factura: clave en procesamiento, clave registrada o secuencial registrado, reconciliados por su clave sin reenviar a ciegas

#### Scenario: Nota de débito con resultado incierto
- **WHEN** el envío de una nota de débito termina sin respuesta concluyente
- **THEN** la nota queda verificando con el SRI y se reconcilia por su clave, sin reenviarse antes de saber si el SRI la recibió

#### Scenario: Nota de débito en revisión manual
- **WHEN** la reconciliación automática de una nota de débito agota sus intentos sin conclusión
- **THEN** la nota queda en revisión manual, como una factura

#### Scenario: Respuesta sin estado de una nota de débito
- **WHEN** la recepción o la autorización de una nota de débito responde sin un estado concluyente
- **THEN** no se trata como un rechazo: la nota no queda devuelta ni no autorizada

#### Scenario: Evidencia antes de clasificar una nota de débito
- **WHEN** el SRI responde a un envío o a una consulta de una nota de débito
- **THEN** la respuesta queda guardada antes de clasificarla, y si la decisión local falla, el reintento clasifica la respuesta guardada sin volver a llamar al SRI

#### Scenario: Retención recibida y autorizada
- **WHEN** un comprobante de retención firmado se envía, la recepción responde `RECIBIDA` y la consulta lo informa autorizado
- **THEN** pasa por recibido y queda autorizado con su número de autorización y su XML autorizado, como una factura

#### Scenario: Retención devuelta o no autorizada
- **WHEN** la recepción responde `DEVUELTA` o la consulta informa no autorizado un comprobante de retención
- **THEN** queda devuelto o no autorizado con todos los mensajes del SRI

#### Scenario: Errores 70, 43 y 45 en una retención
- **WHEN** el SRI responde el error 70, el 43 o el 45 para un comprobante de retención
- **THEN** sigue las mismas reglas que una factura y se reconcilia por su clave sin reenviar a ciegas

#### Scenario: Retención no enviada de forma comprobable
- **WHEN** el envío de un comprobante de retención falla de una forma que demuestra que la solicitud no salió
- **THEN** se reintenta el envío como el de una factura, sin pasar a verificando

#### Scenario: Retención con resultado incierto
- **WHEN** el envío de un comprobante de retención termina sin respuesta concluyente
- **THEN** queda verificando con el SRI y se reconcilia por su clave, sin reenviarse antes de saber si el SRI lo recibió

#### Scenario: Retención en revisión manual
- **WHEN** la reconciliación automática de un comprobante de retención agota sus intentos sin conclusión
- **THEN** queda en revisión manual, como una factura

#### Scenario: Evidencia antes de clasificar una retención
- **WHEN** el SRI responde a un envío o a una consulta de un comprobante de retención
- **THEN** la respuesta queda guardada antes de clasificarla, y si la decisión local falla, el reintento clasifica la respuesta guardada sin volver a llamar al SRI
