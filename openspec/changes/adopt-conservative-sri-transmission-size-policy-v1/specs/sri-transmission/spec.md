## ADDED Requirements

### Requirement: Interruptor general de la transmisión
El sistema SHALL contactar al SRI solo con la transmisión habilitada por configuración, que nace deshabilitada. Deshabilitada, los trabajos pendientes no se toman, no consumen intentos ni hacen llamadas, y la instalación informa que está deshabilitada a propósito. Habilitada, exige las precondiciones técnicas para transmitir; si falta una, no se declara lista. La política de tamaño del envío siempre existe: no es una precondición ni depende de la configuración.

#### Scenario: Transmisión deshabilitada
- **WHEN** la instalación tiene la transmisión deshabilitada
- **THEN** no hay ninguna llamada al SRI, los trabajos pendientes no avanzan ni consumen intentos, y los comprobantes firmados conservan su transmisión programada

#### Scenario: Deshabilitada a propósito y observable
- **WHEN** la transmisión está deshabilitada
- **THEN** la instalación puede declararse lista, y su estado de salud, sus métricas y el registro de arranque informan que la transmisión está deshabilitada, sin secretos

#### Scenario: Habilitación posterior
- **WHEN** se habilita la transmisión con comprobantes firmados pendientes
- **THEN** se transmiten los trabajos ya existentes, sin que nadie los reprograme

#### Scenario: Habilitada sin precondiciones
- **WHEN** la transmisión está habilitada y falta una precondición, como endpoints válidos o al menos un worker
- **THEN** la instalación no se declara lista y no se envía ningún comprobante

#### Scenario: La política de tamaño no es una precondición
- **WHEN** la transmisión está habilitada, con endpoints válidos y al menos un worker
- **THEN** la instalación se declara lista sin cargar ni configurar ninguna política de tamaño

#### Scenario: Deshabilitada aunque el comprobante cumpla la política
- **WHEN** la transmisión está deshabilitada y un comprobante firmado mide menos que el límite de la política de tamaño
- **THEN** no hay ninguna llamada al SRI: cumplir la política no habilita la transmisión

### Requirement: Política conservadora de tamaño del envío
El sistema SHALL aplicar a todo envío individual al SRI, en Pruebas y en Producción, la política conservadora de transmisión de EmiteYa: antes de llamar a la recepción, construye una sola vez el cuerpo final y mide el XML firmado, su base64 y el cuerpo completo; solo SHALL enviar si las tres medidas son menores que 40 000 bytes, y SHALL enviar exactamente el cuerpo medido. Es una política del producto, no el límite oficial del SRI, y su valor no se configura.

#### Scenario: Debajo del límite
- **WHEN** la medida mayor del comprobante es 39 999 bytes
- **THEN** la política permite el envío

#### Scenario: Exactamente el límite
- **WHEN** alguna medida del comprobante es 40 000 bytes
- **THEN** no se envía, no hay ninguna llamada al SRI, el comprobante conserva su número y su estado, y la transmisión se detiene con el motivo de la política de tamaño

#### Scenario: Sobre el límite
- **WHEN** alguna medida del comprobante supera los 40 000 bytes
- **THEN** no se envía y no hay ninguna llamada al SRI

#### Scenario: El XML firmado llega al límite
- **WHEN** el XML firmado mide 40 000 bytes o más
- **THEN** no se envía

#### Scenario: Solo el base64 llega al límite
- **WHEN** el XML firmado mide menos que el límite y su base64 llega al límite
- **THEN** no se envía

#### Scenario: Solo el cuerpo completo llega al límite
- **WHEN** el XML firmado y su base64 miden menos que el límite y el cuerpo completo llega al límite
- **THEN** no se envía

#### Scenario: La misma política en Pruebas y en Producción
- **WHEN** un comprobante de Pruebas y uno de Producción tienen las mismas medidas
- **THEN** la política decide lo mismo para ambos, y cada uno usa los servicios de su ambiente

#### Scenario: Cuerpo medido y cuerpo enviado
- **WHEN** la política permite el envío
- **THEN** el cuerpo enviado al SRI es idéntico byte a byte al cuerpo medido, y su tamaño registrado en la evidencia es la medida del cuerpo completo

#### Scenario: El bloqueo no es una respuesta del SRI
- **WHEN** la política impide el envío
- **THEN** no queda un intento con el SRI ni una respuesta suya, el estado fiscal no cambia y el motivo es interno, distinto de un comprobante devuelto, de un comprobante no autorizado y del rechazo por tamaño del SRI

#### Scenario: Nunca se recorta el comprobante
- **WHEN** la política impide el envío
- **THEN** el XML firmado guardado no se trunca, comprime, modifica ni divide, y el sistema no inventa ninguna respuesta del SRI

#### Scenario: Comprobante válido que excede la política
- **WHEN** un comprobante respeta los límites de recursos de su borrador y es válido contra su esquema, pero alguna medida firmada llega a 40 000 bytes
- **THEN** no se transmite, y el usuario ve que el comprobante excede el límite de seguridad de transmisión de EmiteYa y que debe reducir su contenido, sin que se afirme que es un límite del SRI

#### Scenario: Límite no configurable
- **WHEN** un operador intenta configurar otro valor para el límite
- **THEN** no existe una configuración para hacerlo y el límite sigue siendo 40 000 bytes

### Requirement: Diagnóstico de la política de tamaño
El sistema SHALL informar en su estado de salud, sin secretos, la política de tamaño vigente con su identificador `PRODUCT_CONSERVATIVE_POLICY_V1` y su límite, y de la última comprobación solo sus tres medidas, si se permitió y el motivo del bloqueo. Cada comprobación SHALL registrarse con su ambiente fiscal, y los bloqueos se cuentan. Nunca informa ni registra el XML, el base64 ni el cuerpo SOAP.

#### Scenario: Estado de salud con la política
- **WHEN** se consulta el estado de salud de la instalación
- **THEN** informa como fuente de la política de tamaño `PRODUCT_CONSERVATIVE_POLICY_V1`, con su límite de 40 000 bytes, y nunca la presenta como política oficial del SRI

#### Scenario: Última comprobación en el estado de salud
- **WHEN** la política comprobó un comprobante
- **THEN** el estado de salud informa solo sus tres medidas, si se permitió y el motivo del bloqueo, sin su ambiente, su clave, su número, su RUC ni sus terceros

#### Scenario: Bloqueos contados
- **WHEN** la política bloquea comprobantes
- **THEN** las métricas cuentan los bloqueos, sin identificar comprobantes, contribuyentes ni terceros

#### Scenario: Registro de una comprobación
- **WHEN** la política permite o bloquea un envío
- **THEN** el registro contiene el ambiente fiscal, las tres medidas, el límite y la fuente de la política, y no contiene el XML, el base64 ni el cuerpo SOAP

## REMOVED Requirements

### Requirement: Transmisión habilitada por configuración
**Reason**: Dos de sus escenarios dependían de la sesión de certificación y de una política de tamaño como precondición, y ambas desaparecen. El requisito se reemplaza entero porque un MODIFIED no puede quitar escenarios.
**Migration**: Rige «Interruptor general de la transmisión»: el mismo interruptor `SRI_TRANSMISSION_ENABLED`, apagado por defecto, con las mismas precondiciones técnicas (endpoints válidos y al menos un worker), y sin precondición de tamaño.

### Requirement: Límite de tamaño del envío
**Reason**: Q-47 quedó resuelta por política de producto. El límite ya no sale de una política oficial versionada que nunca se publicó, sino de la política conservadora de EmiteYa, la misma en Pruebas y en Producción.
**Migration**: Rige «Política conservadora de tamaño del envío». El motivo interno `TRANSMISSION_SIZE_POLICY_EXCEEDED` reemplaza a `TOO_LARGE` y a `SIZE_POLICY_MISSING`.

### Requirement: Tope de seguridad de la certificación
**Reason**: Q-47 quedó resuelta por política de producto. El tope de 40 000 bytes, que solo valía en la sesión de certificación de Pruebas, pasa a ser la política general en los dos ambientes.
**Migration**: Rige el requisito «Límite de tamaño del envío». Hay que quitar `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` de la configuración: la variable ya no existe.

### Requirement: Medición exacta en la sesión de certificación
**Reason**: La medición del XML firmado, su base64 y el cuerpo completo deja de ser exclusiva de la sesión de certificación: es parte de la política general.
**Migration**: Rige el requisito «Límite de tamaño del envío», con la misma medición y el mismo borde estricto.

### Requirement: Sesión de certificación solo en Pruebas
**Reason**: Ya no hay sesión de certificación. Producción usa la misma política de tamaño, y Q-47 deja de bloquearla.
**Migration**: El aislamiento de Producción durante una certificación en Pruebas es operativo, como dice el runbook de la certificación:
- endpoints de Producción sustituidos por un destino no enrutable;
- una lista de permitidos solo hacia Pruebas;
- la empresa en el ambiente de Pruebas.

### Requirement: Diagnóstico de la sesión de certificación
**Reason**: La sesión de certificación desaparece junto con su diagnóstico.
**Migration**: Rige el requisito «Diagnóstico de la política de tamaño», con la fuente `PRODUCT_CONSERVATIVE_POLICY_V1`.
