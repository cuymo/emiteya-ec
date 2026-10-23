## Purpose

Entregar por correo cada comprobante autorizado a su receptor, con su XML autorizado y su RIDE, a
través del servidor de correo de la empresa, como pide el art. 6 de la Resolución
NAC-DGERCGC18-00000233, con un estado verificable, reintentos, reenvío y avisos cuando falla.

## ADDED Requirements

### Requirement: Servidor de correo de la empresa
El administrador SHALL poder registrar el servidor de correo de su empresa: servidor, puerto,
seguridad (TLS directo o STARTTLS), usuario, contraseña, nombre y correo del remitente, una copia
oculta opcional y si el envío automático está activo. La contraseña SHALL guardarse cifrada y nunca
devolverse: la consulta solo dice si hay una guardada. Cambiar los demás datos SHALL conservar la
contraseña guardada.

#### Scenario: Registro del servidor
- **WHEN** un administrador guarda el servidor `smtp.empresa.ec`, puerto 465, TLS directo, su usuario, su contraseña y el remitente «Ferretería Andina <facturas@empresa.ec>»
- **THEN** la configuración queda guardada y su consulta devuelve esos datos, con «contraseña guardada» en lugar de la contraseña

#### Scenario: Cambio sin repetir la contraseña
- **WHEN** un administrador cambia solo el remitente sin escribir otra contraseña
- **THEN** la contraseña guardada sigue siendo la misma

#### Scenario: Datos inválidos
- **WHEN** un administrador guarda un puerto fuera de 1 a 65535, un servidor vacío, un remitente o una copia oculta con formato de correo inválido, o un dato con saltos de línea
- **THEN** el sistema lo rechaza indicando el campo, y la configuración no cambia

#### Scenario: Operador sin acceso
- **WHEN** un operador consulta o intenta cambiar el servidor de correo
- **THEN** el sistema responde que no tiene permiso, sin revelar ningún dato de la configuración

#### Scenario: Otra empresa
- **WHEN** el administrador de la empresa B consulta o cambia el servidor de correo
- **THEN** solo ve y cambia el de la empresa B, y nada en la respuesta revela la configuración de la empresa A

#### Scenario: Guardado repetido
- **WHEN** la misma configuración se guarda dos veces, por un doble clic o un reintento
- **THEN** queda una sola configuración con esos datos

### Requirement: Correo de prueba
El administrador SHALL poder enviar un correo de prueba a una dirección que elija, con la
configuración guardada, y ver si el servidor lo aceptó o el motivo del rechazo en lenguaje claro,
sin secretos.

#### Scenario: Prueba aceptada
- **WHEN** un administrador envía un correo de prueba y el servidor lo acepta
- **THEN** ve que el servidor aceptó el correo, con el momento y la dirección

#### Scenario: Credenciales rechazadas
- **WHEN** el servidor rechaza el usuario o la contraseña
- **THEN** el administrador ve «El servidor rechazó el usuario o la contraseña», sin la contraseña ni la respuesta técnica completa

#### Scenario: Sin configuración
- **WHEN** un administrador intenta una prueba sin servidor de correo guardado
- **THEN** el sistema pide registrar primero el servidor y no intenta conectar

### Requirement: Envío automático al autorizar
Con el envío automático activo y un servidor guardado, el sistema SHALL enviar cada comprobante
autorizado a su receptor en un solo correo con su XML autorizado y su RIDE, después de generar el
RIDE. El correo SHALL salir una sola vez por comprobante aunque su autorización o su RIDE se
procesen más de una vez. Un fallo del correo nunca SHALL cambiar el estado fiscal del comprobante.

#### Scenario: Factura autorizada
- **WHEN** el SRI autoriza una factura cuyo comprador tiene el correo `compras@cliente.ec` y se genera su RIDE
- **THEN** sale un correo a `compras@cliente.ec` con el XML autorizado y el RIDE de esa factura adjuntos

#### Scenario: Un solo correo
- **WHEN** la autorización de un comprobante se procesa dos veces por una reconciliación o un reintento
- **THEN** su receptor recibe un solo correo automático

#### Scenario: RIDE todavía no generado
- **WHEN** un comprobante está autorizado y su RIDE todavía no existe o su generación falló
- **THEN** el correo queda pendiente y no sale hasta que el RIDE exista, porque el correo lleva siempre los dos archivos

#### Scenario: Envío automático apagado
- **WHEN** el administrador tiene el envío automático apagado y se autoriza un comprobante
- **THEN** no sale ningún correo, el comprobante muestra que el envío automático está desactivado y se puede enviar a mano

#### Scenario: Fallo sin efecto fiscal
- **WHEN** el envío del correo de un comprobante autorizado falla
- **THEN** el comprobante sigue autorizado, con su número, su fecha de autorización y sus documentos intactos

### Requirement: Receptores de cada comprobante
El sistema SHALL tomar los destinatarios de los correos del tercero receptor de cada comprobante:
el comprador de la factura; el comprador de la factura modificada para las notas de crédito y de
débito; el proveedor retenido; el proveedor de la liquidación; y los destinatarios y el
transportista de la guía. Las direcciones usadas SHALL quedar guardadas con el envío.

#### Scenario: Nota de crédito
- **WHEN** se autoriza una nota de crédito de una factura a «Comercial Andina S.A.»
- **THEN** el correo va a los correos de «Comercial Andina S.A.»

#### Scenario: Retención y liquidación
- **WHEN** se autorizan un comprobante de retención y una liquidación de compra del proveedor «Juan Pérez»
- **THEN** los dos correos van a los correos de «Juan Pérez»

#### Scenario: Guía de remisión
- **WHEN** se autoriza una guía con dos destinatarios terceros con correo, un traslado a un establecimiento propio y un transportista con correo
- **THEN** el correo va a los correos de los dos destinatarios y del transportista, y no a la empresa por su establecimiento propio

#### Scenario: Varios correos del tercero
- **WHEN** el comprador tiene tres correos
- **THEN** el correo va a los tres

#### Scenario: Sin correo del receptor
- **WHEN** se autoriza una factura a un comprador sin correo, o al consumidor final
- **THEN** no sale ningún correo, el comprobante queda «sin destinatario» y el motivo dice que se entrega el RIDE impreso si el receptor lo pide

#### Scenario: Correo cambiado después del envío
- **WHEN** después del envío se cambia el correo del comprador
- **THEN** el historial del envío conserva la dirección a la que se envió

### Requirement: Destino de prueba en el ambiente de Pruebas
Un comprobante autorizado en el ambiente de Pruebas del SRI SHALL enviarse solo al correo de prueba
configurado, nunca a sus receptores, con el asunto marcado como prueba sin validez tributaria. Sin
correo de prueba, no SHALL enviarse. En Producción, el correo de prueba no se usa.

#### Scenario: Comprobante de Pruebas
- **WHEN** se autoriza en Pruebas una factura a un comprador con correo, con el correo de prueba `revision@empresa.ec`
- **THEN** el correo va solo a `revision@empresa.ec`, con el asunto marcado «PRUEBAS – sin validez tributaria», y no al comprador

#### Scenario: Pruebas sin correo de prueba
- **WHEN** se autoriza en Pruebas un comprobante y no hay correo de prueba configurado
- **THEN** no sale ningún correo y el motivo pide configurar el correo de prueba

#### Scenario: Producción
- **WHEN** se autoriza en Producción una factura a un comprador con correo
- **THEN** el correo va al comprador, sin la marca de prueba

### Requirement: Contenido del correo
El correo SHALL identificar el comprobante en su asunto (tipo, número y razón social del emisor) y
resumirlo en el cuerpo (tipo, número, fecha de emisión, receptor, importe total cuando el tipo lo
tiene y número de autorización). SHALL adjuntar siempre el XML autorizado y el RIDE, nombrados con
la clave de acceso, y nunca salir con uno solo de los dos.

#### Scenario: Asunto y adjuntos
- **WHEN** sale el correo de la factura 001-001-000000123 de «Ferretería Andina»
- **THEN** su asunto dice «Factura 001-001-000000123 de Ferretería Andina» y adjunta el XML y el PDF nombrados con su clave de acceso

#### Scenario: Un archivo faltante
- **WHEN** al preparar el correo falta el XML autorizado o el RIDE, o no pasa su verificación de integridad
- **THEN** el correo no sale y el envío falla con ese motivo

### Requirement: Estados del envío
Cada envío SHALL tener un estado basado en lo que el sistema observa: pendiente, enviado (el
servidor de correo lo aceptó), reintentando, fallido con su motivo, sin destinatario o desactivado.
Ningún estado SHALL afirmar que el receptor recibió o leyó el correo.

#### Scenario: Aceptado por el servidor
- **WHEN** el servidor de correo acepta el envío
- **THEN** el envío queda «enviado» con el momento y las direcciones, y no como entregado ni leído

#### Scenario: Una dirección rechazada
- **WHEN** el servidor acepta dos de los tres destinatarios y rechaza el tercero
- **THEN** el envío queda «enviado» para los dos aceptados y muestra la dirección rechazada con su motivo

### Requirement: Reintentos de los fallos temporales
Un fallo temporal (servidor no disponible, tiempo agotado o rechazo temporal) SHALL reintentarse
solo, con esperas crecientes, durante al menos 24 horas. Un fallo definitivo (credenciales,
remitente o destinatarios rechazados, configuración ausente) SHALL detenerse sin reintentar y
quedar fallido con su motivo.

#### Scenario: Servidor caído un rato
- **WHEN** el servidor de correo no responde en el primer intento y responde en el segundo
- **THEN** el envío queda «reintentando» entre los dos intentos y después «enviado»

#### Scenario: Credenciales rechazadas
- **WHEN** el servidor rechaza las credenciales
- **THEN** el envío queda fallido con ese motivo, sin más intentos

#### Scenario: Reintentos agotados
- **WHEN** el servidor sigue sin responder después del último intento
- **THEN** el envío queda fallido con el motivo del último intento

### Requirement: Reenvío manual
Un usuario con permiso SHALL poder enviar o reenviar el correo de un comprobante autorizado, con los
destinatarios propuestos del receptor y editables, hasta 10 direcciones. Cada reenvío SHALL ser un
envío nuevo en el historial, con su actor. En el ambiente de Pruebas, el reenvío también va solo
al correo de prueba.

#### Scenario: Reenvío tras un fallo
- **WHEN** un operador reenvía el correo fallido de una factura a `pagos@cliente.ec`
- **THEN** sale un correo nuevo a `pagos@cliente.ec`, y el historial muestra el fallo anterior y el reenvío con el operador

#### Scenario: Doble clic
- **WHEN** la misma solicitud de reenvío llega dos veces
- **THEN** sale un solo correo y el historial tiene un solo reenvío

#### Scenario: Comprobante no autorizado
- **WHEN** un usuario intenta reenviar el correo de un comprobante que no está autorizado
- **THEN** el sistema lo rechaza y no sale ningún correo

#### Scenario: Direcciones inválidas
- **WHEN** un usuario reenvía sin direcciones, con más de 10 o con una dirección inválida
- **THEN** el sistema lo rechaza indicando el problema y no sale ningún correo

### Requirement: Historial de envíos de un comprobante
El sistema SHALL mostrar los envíos por correo de un comprobante, del más reciente al más antiguo,
con su estado, sus direcciones, su momento, su origen (automático o reenvío con su actor), su
motivo cuando falló y los intentos realizados, sin el contenido del correo ni datos de la
configuración.

#### Scenario: Consulta del historial
- **WHEN** un usuario con permiso consulta los envíos de una factura con un envío fallido y un reenvío aceptado
- **THEN** ve el reenvío aceptado primero y el envío fallido después, con su motivo

#### Scenario: Comprobante de otra empresa
- **WHEN** un usuario de la empresa B consulta los envíos de un comprobante de la empresa A
- **THEN** el sistema responde como si el comprobante no existiera

### Requirement: Correos no enviados a la vista
El sistema SHALL informar cuántos comprobantes autorizados tienen su último envío fallido, para
avisar al usuario, y ese número SHALL bajar cuando un reenvío se acepta.

#### Scenario: Aviso tras un fallo
- **WHEN** el envío de dos comprobantes queda fallido
- **THEN** el resumen de la empresa informa dos comprobantes con el correo no enviado

#### Scenario: Aviso resuelto
- **WHEN** se reenvía con éxito el correo de uno de ellos
- **THEN** el resumen informa uno

### Requirement: Envío apagado por configuración
El envío de correos SHALL estar apagado por defecto en la configuración del despliegue. Apagado, el
sistema no SHALL conectar con ningún servidor de correo: los envíos quedan desactivados y la prueba
lo informa. Encenderlo no SHALL enviar los envíos que quedaron desactivados; se reenvían a mano.

#### Scenario: Despliegue por defecto
- **WHEN** se autoriza un comprobante en un despliegue sin el envío encendido
- **THEN** no hay ninguna conexión a un servidor de correo y el envío queda desactivado

#### Scenario: Encendido después
- **WHEN** se enciende el envío en un despliegue con envíos desactivados
- **THEN** esos envíos siguen desactivados hasta que alguien los reenvíe

### Requirement: Conexión segura con el servidor de correo
El sistema SHALL conectar con el servidor de correo con TLS (directo o STARTTLS) y certificado
verificado. La conexión sin cifrado SHALL admitirse solo cuando el despliegue la habilita de forma
explícita para su buzón de pruebas; por defecto, y en producción, se rechaza.

#### Scenario: Certificado inválido
- **WHEN** el servidor de correo presenta un certificado vencido o de otro nombre
- **THEN** el envío falla con ese motivo y no se envían las credenciales

#### Scenario: Sin cifrado sin habilitar
- **WHEN** un administrador intenta guardar un servidor sin cifrado en un despliegue que no lo habilita
- **THEN** el sistema lo rechaza indicando que se requiere TLS

### Requirement: Permisos del correo
Solo el administrador SHALL consultar y cambiar el servidor de correo y enviar correos de prueba.
El administrador y el operador SHALL poder ver los envíos de un comprobante y reenviarlo. Sin sesión
o sin membresía activa, ninguna operación del correo SHALL responder con datos.

#### Scenario: Operador que reenvía
- **WHEN** un operador reenvía el correo de una factura autorizada
- **THEN** el reenvío se acepta

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión consulta los envíos de un comprobante o la configuración del correo
- **THEN** el sistema responde que no hay sesión, sin datos
