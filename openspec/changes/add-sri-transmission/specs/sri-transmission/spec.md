# Spec Delta

## Purpose

Transmitir al SRI cada comprobante firmado con sus bytes exactos y llevarlo a un estado fiscal
definitivo o reconciliable: recepción, autorización, errores 70, 43 y 45, resultados inciertos,
reconciliación automática y manual, y revisión manual, con la evidencia de cada interacción.

## ADDED Requirements

### Requirement: Transmisión automática de cada comprobante firmado
El sistema SHALL transmitir al SRI cada comprobante firmado sin intervención de un usuario. Su transmisión queda programada en la misma operación que lo firma, y ningún comprobante firmado se queda sin transmisión programada, incluidos los que ya estaban firmados al desplegar. No existe una operación para enviar un comprobante a voluntad.

#### Scenario: Comprobante recién firmado
- **WHEN** un comprobante pasa a firmado
- **THEN** su transmisión queda programada en la misma operación que lo firma

#### Scenario: Caída justo después de firmar
- **WHEN** el proceso cae inmediatamente después de confirmar el paso a firmado
- **THEN** al reiniciar, la transmisión del comprobante sigue programada

#### Scenario: Comprobantes firmados antes del despliegue
- **WHEN** existen comprobantes firmados sin transmisión programada y el barrido se ejecuta varias veces
- **THEN** cada uno recibe exactamente una transmisión programada

#### Scenario: Sin envío a voluntad
- **WHEN** un usuario busca en la API una operación para enviar un comprobante
- **THEN** no existe: solo puede consultar el estado y, si es administrador, pedir una reconciliación

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

### Requirement: Una sola transmisión a la vez por comprobante
Un comprobante SHALL tener como máximo una interacción en curso con el SRI, aunque haya varios workers o procesos. Nunca hay dos transmisiones equivalentes simultáneas del mismo comprobante.

#### Scenario: Workers simultáneos
- **WHEN** dos workers buscan trabajo a la vez
- **THEN** cada comprobante lo toma uno solo, y se envía una sola vez

#### Scenario: Worker que cae con una transmisión en curso
- **WHEN** un worker cae mientras transmite un comprobante
- **THEN** otro worker solo lo retoma cuando vence su arriendo, sin dos envíos en paralelo

#### Scenario: Paso entre fases sin hueco
- **WHEN** un comprobante pasa de una fase a la siguiente, como del envío a la consulta de autorización o del resultado incierto a la reconciliación
- **THEN** en ningún momento queda sin trabajo programado ni con dos trabajos activos

### Requirement: Integridad del comprobante firmado antes de cada envío
Antes de cada envío, el sistema SHALL comprobar que el XML firmado persistido pertenece al comprobante, conserva su hash y su tamaño y contiene su clave de acceso, y SHALL enviar exactamente esos bytes. Nunca reconstruye el XML desde el snapshot. Si una comprobación falla, no envía nada.

#### Scenario: Envío verificado
- **WHEN** se transmite un comprobante firmado
- **THEN** el contenido enviado es idéntico byte a byte a su XML firmado persistido

#### Scenario: Artefacto alterado
- **WHEN** el hash o el tamaño del XML firmado no coinciden con los registrados
- **THEN** no se envía nada, la transmisión se detiene con un error de integridad visible y el estado fiscal no cambia

#### Scenario: Reenvío con los mismos bytes
- **WHEN** un comprobante se reenvía después de una reconciliación
- **THEN** los bytes enviados son los mismos del primer envío

### Requirement: Límite de tamaño del envío
El sistema SHALL comprobar antes de llamar al SRI que el XML firmado no supera el límite individual de la política vigente, y no SHALL enviar un comprobante que lo supere. Sin una política de tamaño vigente, no envía ningún comprobante.

#### Scenario: En el límite
- **WHEN** el XML firmado mide exactamente el límite en bytes
- **THEN** se puede enviar

#### Scenario: Sobre el límite
- **WHEN** el XML firmado supera el límite en un byte
- **THEN** no se envía, conserva su número y su estado, y su transmisión se detiene con el motivo

#### Scenario: Sin política de tamaño
- **WHEN** no hay una política de tamaño vigente
- **THEN** no se envía ningún comprobante y la transmisión se detiene con el motivo

### Requirement: Ambiente del comprobante en el SRI
Cada comprobante SHALL enviarse y consultarse solo en los servicios del SRI de su propio ambiente. Una respuesta que informa otro ambiente no concluye nada.

#### Scenario: Comprobante de pruebas
- **WHEN** se transmite un comprobante del ambiente de pruebas
- **THEN** solo se usan los servicios de pruebas del SRI

#### Scenario: Ambiente distinto en la respuesta
- **WHEN** una autorización informa un ambiente distinto del comprobante
- **THEN** no se concluye la autorización y el comprobante pasa a revisión manual

### Requirement: Evidencia de cada interacción con el SRI
Cada interacción con el SRI SHALL dejar un intento de solo agregado con su operación, sus tiempos, su resultado de transporte y la respuesta original exacta, confirmados antes de clasificar la respuesta. Ninguna clasificación concluyente existe sin su evidencia. Ni los logs ni la auditoría contienen el SOAP original.

#### Scenario: Evidencia antes de clasificar
- **WHEN** llega una respuesta del SRI
- **THEN** el intento y su respuesta original quedan guardados antes de que cambie el estado del comprobante

#### Scenario: Respuesta que no se puede interpretar
- **WHEN** la respuesta no puede interpretarse
- **THEN** el intento y la respuesta original permanecen, no se inventa un resultado y el comprobante queda pendiente de reconciliación

#### Scenario: Caída entre la evidencia y la decisión
- **WHEN** el proceso cae después de guardar la respuesta y antes de clasificarla
- **THEN** al reanudar se clasifica la respuesta guardada sin volver a llamar al SRI

#### Scenario: Evidencia inmutable
- **WHEN** cualquier operación intenta cambiar o borrar un intento o su respuesta original
- **THEN** el sistema lo impide

#### Scenario: Sin SOAP en registros
- **WHEN** se escribe un log o un evento de auditoría de la transmisión
- **THEN** no contiene el XML ni la respuesta SOAP

### Requirement: Resultado de la recepción
El sistema SHALL llevar a recibido un comprobante cuya recepción responde `RECIBIDA`, y a devuelto uno cuya recepción responde `DEVUELTA` de forma concluyente. Guarda todos los mensajes del SRI con su identificador, su mensaje, su información adicional, su tipo y la fase. Una respuesta sin estado nunca equivale a `DEVUELTA`.

#### Scenario: Recibida
- **WHEN** la recepción responde `RECIBIDA`
- **THEN** el comprobante pasa a recibido y su consulta de autorización se programa tras el intervalo configurado

#### Scenario: Devuelta
- **WHEN** la recepción responde `DEVUELTA` con un mensaje de inconsistencia del comprobante
- **THEN** pasa a devuelto con todos sus mensajes, conserva su número y su clave, y no se reenvía

#### Scenario: Respuesta sin estado
- **WHEN** la respuesta de recepción no trae estado
- **THEN** el comprobante pasa a resultado incierto, no a devuelto

#### Scenario: Varios mensajes
- **WHEN** la respuesta trae varios mensajes, incluido uno de código desconocido
- **THEN** se guardan todos, en orden

### Requirement: Error 70, clave en procesamiento
Ante el error 70, el sistema SHALL conservar el comprobante, su clave, su número y su XML firmado. No SHALL reenviarlo, y SHALL reconciliarlo por clave después de la espera configurada. Nunca genera otro comprobante, otra clave ni otro número.

#### Scenario: Error 70
- **WHEN** la recepción responde con el error 70
- **THEN** el comprobante pasa a resultado incierto, se guarda el mensaje y se programa la reconciliación tras la espera, sin reenvío

#### Scenario: Autorizado después del 70
- **WHEN** la reconciliación posterior encuentra el comprobante autorizado
- **THEN** pasa a autorizado sin ningún reenvío

#### Scenario: Clave todavía desconocida después del 70
- **WHEN** después del error 70 la consulta todavía no encuentra la clave
- **THEN** no se reenvía: se sigue consultando dentro de la ventana y, si se agota, el comprobante pasa a revisión manual

### Requirement: Errores 43 y 45
Los errores 43 (clave registrada) y 45 (secuencial registrado) SHALL llevar a reconciliar por clave antes de cualquier otra acción, y nunca a devuelto. Tras un 45, si la evidencia queda contradictoria o sin conclusión, el comprobante pasa a revisión manual. Un secuencial registrado con otra clave nunca se reutiliza ni lleva a reservar otro número.

#### Scenario: Clave registrada
- **WHEN** la recepción responde con el error 43
- **THEN** el comprobante pasa a resultado incierto y la reconciliación por su clave decide su estado

#### Scenario: Secuencial registrado por este comprobante
- **WHEN** la recepción responde con el error 45 y la reconciliación encuentra esta clave en el SRI
- **THEN** el comprobante toma el estado que informa el SRI

#### Scenario: Secuencial registrado con otra clave
- **WHEN** la recepción responde con el error 45 y la evidencia oficial no muestra esta clave, o es contradictoria
- **THEN** el comprobante pasa a revisión manual, sin reenvío ni otro número

### Requirement: Resultado incierto
Cuando no se puede demostrar que la solicitud no llegó al SRI, el sistema SHALL llevar el comprobante a resultado incierto y reconciliarlo por clave antes de cualquier reenvío. Un resultado incierto nunca es terminal ni equivale a devuelto o no autorizado. Solo un fallo que demuestra que la solicitud no pudo salir deja el comprobante firmado para reintentar el envío.

#### Scenario: Tiempo agotado después de enviar
- **WHEN** el envío vence sin respuesta
- **THEN** el comprobante pasa a resultado incierto y se programa su reconciliación

#### Scenario: Respuesta que no es SOAP del SRI
- **WHEN** el SRI responde HTTP 200 con HTML, un cuerpo vacío, XML ilegible o un SOAP Fault
- **THEN** el comprobante pasa a resultado incierto, nunca a devuelto

#### Scenario: Conexión cortada
- **WHEN** la conexión se corta después de enviar la solicitud
- **THEN** el comprobante pasa a resultado incierto

#### Scenario: Fallo demostrable antes de enviar
- **WHEN** la dirección no se resolvió, la conexión fue rechazada antes de establecerse, venció antes de conectar o el TLS falló antes de que empezara la solicitud HTTP
- **THEN** el comprobante sigue firmado y el envío se reintenta con espera creciente, sin reconciliar

#### Scenario: Ambigüedad después de empezar
- **WHEN** vence un plazo genérico o el de las cabeceras, se corta la conexión, se aborta la solicitud en curso o vence la lectura del cuerpo
- **THEN** el comprobante pasa a resultado incierto, aunque la causa pudiera haber ocurrido antes del envío

### Requirement: Consulta de autorización
Después de recibido, el sistema SHALL consultar la autorización por la misma clave, tras un intervalo configurable y con espera creciente, durante una ventana configurable, hasta obtener una respuesta concluyente. Una respuesta sin conclusión nunca se trata como no autorizada.

#### Scenario: En procesamiento
- **WHEN** la consulta todavía no concluye
- **THEN** el comprobante sigue recibido y se programa otra consulta

#### Scenario: No autorizado
- **WHEN** la consulta responde `NO AUTORIZADO` para la clave y el ambiente del comprobante
- **THEN** pasa a no autorizado con todos sus mensajes: es terminal, sin reintento ni reenvío, sin otra clave y sin otro número

#### Scenario: Estado desconocido
- **WHEN** la respuesta trae un estado de autorización que el sistema no reconoce
- **THEN** no se concluye la autorización

#### Scenario: Ventana agotada
- **WHEN** la ventana se agota sin una respuesta concluyente del SRI
- **THEN** el comprobante pasa a revisión manual

#### Scenario: SRI no disponible durante la consulta
- **WHEN** la consulta falla por un problema de transporte
- **THEN** el estado no cambia y la consulta se reintenta

### Requirement: Autorización registrada
Al recibir una autorización válida, el sistema SHALL llevar el comprobante a autorizado y guardar de forma inmutable el número y la fecha de autorización, el ambiente confirmado, la respuesta original y el XML autorizado exacto si viene, como artefacto distinto del XML firmado. Es válida solo si coinciden la clave, el ambiente y el número, y trae fecha.

#### Scenario: Autorización válida
- **WHEN** la autorización responde `AUTORIZADO` con la clave, el ambiente, el número y la fecha esperados
- **THEN** el comprobante pasa a autorizado con esos datos

#### Scenario: XML autorizado
- **WHEN** la autorización trae el comprobante autorizado
- **THEN** se guarda como artefacto propio con su hash, su tamaño y su tipo, el XML firmado no cambia, y los dos hashes se verifican por separado

#### Scenario: Autorización incompleta
- **WHEN** la autorización responde `AUTORIZADO` sin número o sin fecha, o con un número distinto de la clave
- **THEN** no se concluye y el comprobante pasa a revisión manual

#### Scenario: Autorización inmutable
- **WHEN** cualquier operación intenta cambiar los datos de una autorización registrada
- **THEN** el sistema lo impide

### Requirement: Varias autorizaciones en una respuesta
Si la respuesta trae varias autorizaciones, el sistema SHALL concluir autorizado solo cuando exactamente una es `AUTORIZADO` válida para la clave y el ambiente. Cualquier otra combinación SHALL llevar a revisión manual. Nunca toma la primera de forma implícita.

#### Scenario: Una válida entre varias
- **WHEN** la respuesta trae una autorización `AUTORIZADO` válida y otras no autorizadas
- **THEN** el comprobante pasa a autorizado y todas quedan en la evidencia

#### Scenario: Combinación contradictoria
- **WHEN** la respuesta trae dos autorizaciones `AUTORIZADO` distintas, o varias no autorizadas
- **THEN** el comprobante pasa a revisión manual

### Requirement: Reconciliación por clave
La reconciliación SHALL consultar al SRI por la clave con las consultas oficiales disponibles, primero la de autorización, y decidir el estado con sus reglas. Solo SHALL reenviar los mismos bytes cuando ninguna evidencia oficial disponible muestra que el SRI conoce la clave y no hay evidencia previa de que la recibió. Una consulta oficial que muestra la clave conocida impide el reenvío.

#### Scenario: Ya autorizado
- **WHEN** un comprobante en resultado incierto se reconcilia y el SRI lo informa autorizado
- **THEN** pasa a autorizado sin reenvío

#### Scenario: En procesamiento
- **WHEN** el SRI informa que procesa la clave
- **THEN** el comprobante pasa a recibido y sigue la consulta de autorización

#### Scenario: Clave desconocida después de un fallo de transporte
- **WHEN** el SRI no conoce la clave y el único antecedente es un resultado incierto de transporte
- **THEN** se reenvían los mismos bytes firmados

#### Scenario: Consulta de validez que conoce la clave
- **WHEN** la autorización no encuentra la clave, pero la consulta de validez del SRI informa un estado para ella
- **THEN** no se reenvía: si informa autorizado o no autorizado, el comprobante pasa a recibido para obtener la autorización; si informa un estado de anulación, pasa a revisión manual

#### Scenario: Clave desconocida con evidencia de recepción
- **WHEN** el SRI no conoce la clave, pero antes respondió `RECIBIDA`, el error 70 o el error 43
- **THEN** no se reenvía y se sigue consultando dentro de la ventana

#### Scenario: Reconciliación sin respuesta
- **WHEN** la consulta de reconciliación falla por transporte
- **THEN** el estado no cambia y se reintenta con espera creciente

### Requirement: Revisión manual
Un comprobante SHALL pasar a revisión manual solo cuando su resultado no puede resolverse automáticamente de forma segura: una respuesta inconsistente, un secuencial registrado con otra clave o la ventana agotada sin conclusión. Un error técnico recuperable nunca lleva a ella. Solo sale con una reconciliación manual que obtiene evidencia concluyente, y ninguna acción lo reenvía.

#### Scenario: Respuesta inconsistente
- **WHEN** el SRI responde por una clave distinta de la consultada
- **THEN** el comprobante pasa a revisión manual

#### Scenario: Error técnico prolongado
- **WHEN** el SRI no está disponible durante horas
- **THEN** el comprobante no pasa a revisión manual por esa causa: conserva su estado, y su transmisión se detiene de forma visible al agotar sus intentos

#### Scenario: Sin salida automática
- **WHEN** un comprobante está en revisión manual
- **THEN** ningún proceso automático cambia su estado

#### Scenario: Sin reenvío desde la revisión manual
- **WHEN** un comprobante en revisión manual se reconcilia y la evidencia sigue sin concluir o el SRI no conoce la clave
- **THEN** sigue en revisión manual, no se reenvía y no existe una acción para reenviarlo de todas formas

### Requirement: Reconciliación manual
Un administrador SHALL poder pedir, con un motivo, la reconciliación de una factura en revisión manual, en resultado incierto, o firmada o recibida con su transmisión detenida. La reconciliación manual sigue las reglas de la automática, y el historial guarda quién la pidió, el motivo y el resultado.

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

### Requirement: Número, clave y XML firmado invariables durante la transmisión
La transmisión SHALL usar siempre el número, la clave, el snapshot y el XML firmado del comprobante. Ningún reintento, reconciliación ni respuesta del SRI crea otro comprobante, otro número u otra clave, regenera el XML ni libera el secuencial. Un comprobante devuelto no tiene corrección en esta versión.

#### Scenario: Reintentos y reenvío
- **WHEN** un comprobante pasa por resultado incierto, reconciliación y reenvío
- **THEN** conserva su número, su clave y sus bytes firmados, y el contador del punto no cambia

#### Scenario: Comprobante devuelto
- **WHEN** un comprobante queda devuelto
- **THEN** no se reenvía ni se edita, y su número no vuelve al contador

### Requirement: Reintentos acotados
Cada transmisión, consulta y reconciliación automática SHALL reintentarse con espera creciente dentro de un máximo de intentos o una ventana, sin reintentos infinitos. Al agotarse, se detiene con su último error, visible y alertado. Tras varios fallos de transporte seguidos, las llamadas al SRI se suspenden durante una pausa.

#### Scenario: Intentos agotados
- **WHEN** se agotan los intentos de una consulta por problemas de transporte
- **THEN** se detiene con su último error, el comprobante conserva su estado y la factura muestra que su transmisión está detenida

#### Scenario: SRI caído
- **WHEN** varias llamadas seguidas fallan por transporte
- **THEN** las siguientes esperan una pausa sin llamar al SRI

#### Scenario: Emisión sin el SRI
- **WHEN** el SRI no está disponible
- **THEN** la emisión local hasta firmado y la consulta de facturas siguen funcionando

### Requirement: Transiciones de la transmisión
Cada transición de la transmisión SHALL registrarse con el estado anterior y el nuevo, la causa, el actor (el sistema o el administrador que reconcilia) y el intento que la originó. Los estados autorizado y no autorizado son terminales.

#### Scenario: Historial de una autorización
- **WHEN** un comprobante pasa de firmado a recibido y a autorizado
- **THEN** su historial tiene ambas transiciones, cada una con su causa, su actor y su intento

#### Scenario: Estado terminal
- **WHEN** un comprobante autorizado o no autorizado recibe otra respuesta del SRI
- **THEN** su estado no cambia

### Requirement: Aislamiento de la transmisión por empresa
Los intentos, las respuestas, las transmisiones y las reconciliaciones de una empresa SHALL ser invisibles e inaccesibles para cualquier otra.

#### Scenario: Historial de otra empresa
- **WHEN** un usuario de la empresa A consulta la transmisión de una factura de la empresa B
- **THEN** el sistema responde que no existe, sin revelar ningún dato

#### Scenario: Reconciliación de otra empresa
- **WHEN** un administrador de la empresa A pide reconciliar una factura de la empresa B
- **THEN** el sistema responde que no existe y no se programa nada
