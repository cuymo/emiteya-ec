# Spec Delta

## MODIFIED Requirements

### Requirement: Reconciliación manual
Un administrador SHALL poder pedir, con un motivo, la reconciliación de una factura o de una nota de crédito en revisión manual, en resultado incierto, o firmada o recibida con su transmisión detenida. La reconciliación manual sigue las reglas de la automática, y el historial guarda quién la pidió, el motivo y el resultado.

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

## ADDED Requirements

### Requirement: Transmisión de cada tipo emitido
La transmisión SHALL tratar igual la factura y la nota de crédito: el mismo envío, la misma consulta de autorización, la evidencia guardada antes de clasificar, los errores 70, 43 y 45, el resultado incierto, la revisión manual y la reconciliación por clave. No existe otra transmisión por tipo.

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
