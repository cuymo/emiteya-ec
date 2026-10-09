## MODIFIED Requirements

### Requirement: Transmisión habilitada por configuración
El sistema SHALL contactar al SRI solo con la transmisión habilitada por configuración, que nace deshabilitada. Deshabilitada, los trabajos pendientes no se toman, no consumen intentos ni hacen llamadas, y la instalación informa que está deshabilitada a propósito. Habilitada, exige las precondiciones técnicas para transmitir; si falta una, no se declara lista.

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
- **WHEN** la transmisión está habilitada y falta una precondición, como endpoints válidos, una política de tamaño vigente o al menos un worker
- **THEN** la instalación no se declara lista y no se envía ningún comprobante

#### Scenario: Precondición de tamaño con la sesión de certificación
- **WHEN** la transmisión está habilitada, no hay una política de tamaño vigente y la sesión de certificación está activa
- **THEN** la precondición de tamaño se considera cumplida por el tope de seguridad de la certificación y la instalación informa que esa es la fuente efectiva del límite

#### Scenario: Sesión de certificación sin transmisión habilitada
- **WHEN** la sesión de certificación está activa y la transmisión está deshabilitada
- **THEN** no hay ninguna llamada al SRI: la sesión de certificación no habilita la transmisión

### Requirement: Límite de tamaño del envío
El sistema SHALL comprobar antes de llamar al SRI que el XML firmado no supera el límite individual de la política vigente, y no SHALL enviar un comprobante que lo supere. Sin una política de tamaño vigente, no envía ningún comprobante, salvo un comprobante de Pruebas dentro del tope de seguridad de una sesión de certificación activa. El tope solo añade restricciones: nunca relaja la política vigente.

#### Scenario: En el límite
- **WHEN** el XML firmado mide exactamente el límite en bytes
- **THEN** se puede enviar

#### Scenario: Sobre el límite
- **WHEN** el XML firmado supera el límite en un byte
- **THEN** no se envía, conserva su número y su estado, y su transmisión se detiene con el motivo

#### Scenario: Sin política de tamaño
- **WHEN** no hay una política de tamaño vigente y la sesión de certificación no está activa
- **THEN** no se envía ningún comprobante, no hay ninguna llamada al SRI y la transmisión se detiene con el motivo

#### Scenario: Sin política de tamaño en la sesión de certificación
- **WHEN** no hay una política de tamaño vigente, la sesión de certificación está activa y un comprobante de Pruebas mide menos que el tope en sus tres medidas
- **THEN** el comprobante puede enviarse a los servicios de Pruebas del SRI

#### Scenario: Política vigente más estricta que el tope
- **WHEN** la sesión de certificación está activa, hay una política vigente menor que el tope y el XML firmado supera la política
- **THEN** no se envía y la transmisión se detiene con el motivo de la política

#### Scenario: Política vigente más permisiva que el tope
- **WHEN** la sesión de certificación está activa, hay una política vigente mayor que el tope y alguna medida del comprobante llega al tope
- **THEN** no se envía y la transmisión se detiene con el motivo del tope de la certificación

#### Scenario: Fuera de la sesión de certificación
- **WHEN** la sesión de certificación no está activa
- **THEN** el tope no existe y rige solo la política vigente

## ADDED Requirements

### Requirement: Tope de seguridad de la certificación
El sistema SHALL ofrecer una sesión de certificación, activada por configuración explícita y apagada por defecto, con un tope fijo de 40 000 bytes que no se puede configurar. El tope es una salvaguarda de la certificación en Pruebas, derivada de la lectura más restrictiva del texto oficial ambiguo: no es el límite oficial del SRI ni rige fuera de la sesión.

#### Scenario: Sesión apagada por defecto
- **WHEN** la instalación arranca sin configurar la sesión de certificación
- **THEN** la sesión no está activa y la transmisión se comporta como sin el tope

#### Scenario: Tope no configurable
- **WHEN** un operador intenta configurar otro valor para el tope
- **THEN** no existe una configuración para hacerlo y el tope sigue siendo 40 000 bytes

#### Scenario: Nombre del tope
- **WHEN** el sistema informa o registra el tope
- **THEN** lo nombra como tope de seguridad de la certificación, nunca como límite oficial del SRI

### Requirement: Medición exacta en la sesión de certificación
Con la sesión de certificación activa, el sistema SHALL construir una sola vez el cuerpo final del envío a la recepción y medir, inmediatamente antes de la llamada, los bytes del XML firmado, los de su base64 y los del cuerpo completo. Solo SHALL enviar si las tres medidas son menores que el tope, y SHALL enviar exactamente el cuerpo medido. Nunca trunca, comprime ni altera el comprobante.

#### Scenario: Debajo del tope
- **WHEN** la medida mayor del comprobante es 39 999 bytes
- **THEN** el tope permite el envío

#### Scenario: Exactamente el tope
- **WHEN** alguna medida del comprobante es 40 000 bytes
- **THEN** no se envía, no hay ninguna llamada al SRI, el comprobante conserva su número y su estado, y la transmisión se detiene con el motivo del tope de la certificación

#### Scenario: Sobre el tope
- **WHEN** alguna medida del comprobante supera los 40 000 bytes
- **THEN** no se envía y no hay ninguna llamada al SRI

#### Scenario: Solo el base64 llega al tope
- **WHEN** el XML firmado mide menos que el tope y su base64 llega al tope
- **THEN** no se envía

#### Scenario: Solo el cuerpo completo llega al tope
- **WHEN** el XML firmado y su base64 miden menos que el tope y el cuerpo completo llega al tope
- **THEN** no se envía

#### Scenario: Cuerpo medido y cuerpo enviado
- **WHEN** el tope permite el envío
- **THEN** el cuerpo enviado al SRI es idéntico byte a byte al cuerpo medido, y su tamaño registrado en la evidencia es la medida del cuerpo completo

#### Scenario: El bloqueo no es una respuesta del SRI
- **WHEN** el tope impide el envío
- **THEN** no queda un intento con el SRI ni una respuesta suya, el estado fiscal no cambia y el motivo es interno, distinto de un comprobante devuelto o del rechazo por tamaño del SRI

### Requirement: Sesión de certificación solo en Pruebas
Con la sesión de certificación activa, el sistema SHALL interactuar con el SRI solo sobre comprobantes del ambiente de Pruebas. La interacción con un comprobante de Producción SHALL detenerse antes de cualquier llamada de red. El sistema no redirige el comprobante a Pruebas ni corrige su ambiente.

#### Scenario: Comprobante de Producción en la sesión de certificación
- **WHEN** la sesión de certificación está activa y toca enviar o consultar un comprobante de Producción
- **THEN** no hay ninguna llamada al SRI, la transmisión se detiene con el motivo de la sesión de certificación y el estado fiscal no cambia

#### Scenario: Producción con una política vigente
- **WHEN** la sesión de certificación está activa, hay una política de tamaño vigente y el comprobante es de Producción
- **THEN** no se envía aunque la política lo permita

#### Scenario: Ambiente y servicios intactos
- **WHEN** la sesión de certificación está activa y se envía un comprobante de Pruebas
- **THEN** se usan los servicios de Pruebas del ambiente del comprobante, sin cambiar sus endpoints, su ambiente ni su clave

### Requirement: Diagnóstico de la sesión de certificación
El sistema SHALL informar, sin secretos, si la sesión de certificación está activa, el valor del tope y la fuente efectiva del límite de tamaño. Cada envío o bloqueo en la sesión SHALL registrar el ambiente fiscal y las tres medidas. Nunca registra el XML, el base64 ni el cuerpo SOAP.

#### Scenario: Estado de salud con la sesión activa sin política vigente
- **WHEN** la sesión de certificación está activa y no hay una política vigente
- **THEN** el estado de salud informa la sesión activa, el tope de 40 000 bytes y como fuente efectiva el tope conservador de la certificación, nunca la política oficial del SRI

#### Scenario: Estado de salud con política vigente y sesión activa
- **WHEN** hay una política vigente y la sesión de certificación está activa
- **THEN** el estado de salud informa que rigen las dos

#### Scenario: Registro de un envío en la sesión
- **WHEN** la sesión de certificación está activa y se envía o se bloquea un comprobante
- **THEN** el registro contiene el ambiente fiscal, las medidas del XML firmado, del base64 y del cuerpo completo, el tope y la fuente efectiva, y no contiene el XML, el base64 ni el cuerpo SOAP
