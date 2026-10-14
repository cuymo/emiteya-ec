# signing-certificate Specification

## Purpose

Permite al administrador cargar, reemplazar y consultar la firma electrónica del contribuyente con
custodia cifrada, decide cuándo esa firma es utilizable para emitir y avisa de su vencimiento.

## Requirements

### Requirement: Carga de la firma electrónica
El sistema SHALL permitir que un administrador cargue la firma electrónica de su empresa como un archivo PKCS#12 con su contraseña. La firma se acepta solo si el archivo no supera el límite de tamaño configurado en la instalación, se abre con la contraseña, contiene una clave privada RSA de al menos 2048 bits que corresponde al certificado y puede firmar con el algoritmo de la ficha técnica vigente del SRI, el certificado está vigente y tiene un RUC detectable. Una firma aceptada pasa a ser la firma vigente de la empresa; una rechazada no cambia nada. Cada rechazo SHALL indicar su causa con un error específico y accionable, distinto según la causa, sin repetir la contraseña ni el contenido del archivo. El administrador SHALL ver, antes de elegir el archivo, el límite de tamaño configurado que aplica el sistema, y ningún otro.

#### Scenario: Primera carga
- **WHEN** un administrador de una empresa sin firma carga un PKCS#12 válido y vigente, con RUC, y su contraseña correcta
- **THEN** la firma queda como la firma vigente de la empresa
- **AND** el administrador ve su titular, emisor, número de serie, vigencia y RUC detectado

#### Scenario: Límite de tamaño visible
- **WHEN** un administrador abre la carga de la firma
- **THEN** ve el límite de tamaño configurado en la instalación, el mismo que aplica el sistema al recibir el archivo

#### Scenario: Archivo vacío o sin seleccionar
- **WHEN** un administrador envía la carga sin elegir un archivo, o con un archivo vacío
- **THEN** el sistema rechaza la carga e indica que debe seleccionar el archivo de la firma electrónica
- **AND** la firma vigente no cambia

#### Scenario: Archivo mayor que el límite configurado
- **WHEN** un administrador carga un archivo que supera el límite de tamaño configurado en la instalación
- **THEN** el sistema rechaza la carga e indica que el archivo supera el tamaño admitido y cuál es ese límite
- **AND** la firma vigente no cambia

#### Scenario: Archivo que no es un PKCS#12 legible
- **WHEN** un administrador carga un archivo que no es un PKCS#12 o que está dañado
- **THEN** el sistema rechaza la carga e indica que el archivo no es una firma electrónica válida (PKCS#12)
- **AND** la firma vigente no cambia

#### Scenario: Contraseña incorrecta
- **WHEN** un administrador carga un PKCS#12 con una contraseña que no lo abre
- **THEN** el sistema rechaza la carga e indica que la contraseña no corresponde al archivo
- **AND** la firma vigente no cambia

#### Scenario: Sin clave privada o con una clave que no sirve
- **WHEN** el PKCS#12 no contiene clave privada, su clave no corresponde al certificado, o la clave no es RSA de al menos 2048 bits
- **THEN** el sistema rechaza la carga e indica que la firma no sirve para firmar comprobantes

#### Scenario: Certificado incompatible
- **WHEN** el PKCS#12 se abre con su contraseña pero no puede usarse para firmar: su primer certificado no es el del titular, su contenido no puede descifrarse para firmar con esa contraseña, o su costo de cifrado supera el admitido
- **THEN** el sistema rechaza la carga como incompatible, con un mensaje propio de ese motivo que explica cómo obtener una firma compatible
- **AND** la firma vigente no cambia

#### Scenario: Certificado vencido o todavía no vigente
- **WHEN** el certificado del PKCS#12 ya venció o su vigencia aún no empieza
- **THEN** el sistema rechaza la carga e indica las fechas de vigencia del certificado

### Requirement: Identidad tributaria de la firma
El sistema SHALL exigir que el certificado de la firma tenga un RUC detectable, porque el SRI rechaza las firmas cuyo certificado no contiene RUC. Si el RUC detectado difiere del RUC de la empresa, el sistema SHALL aceptar la firma y mostrar una advertencia preventiva de la aplicación, sin presentarla como un rechazo del SRI ni bloquear su uso. La comparación usa el RUC vigente de la empresa en cada consulta.

#### Scenario: RUC que coincide con el de la empresa
- **WHEN** el RUC detectado en el certificado es el RUC de la empresa
- **THEN** la firma se muestra sin advertencias de identidad

#### Scenario: RUC distinto del de la empresa
- **WHEN** el RUC detectado en el certificado difiere del RUC de la empresa
- **THEN** la firma se acepta y es utilizable
- **AND** el administrador ve una advertencia que indica ambos RUC y que es una comprobación preventiva de la aplicación

#### Scenario: Certificado sin RUC detectable
- **WHEN** un administrador carga un PKCS#12 cuyo certificado no tiene un RUC detectable
- **THEN** el sistema rechaza la carga, explica que el SRI rechaza las firmas cuyo certificado no contiene RUC e indica el titular y el emisor del certificado
- **AND** la firma vigente no cambia

#### Scenario: Empresa sin datos registrados
- **WHEN** la empresa aún no registró su RUC y un administrador consulta su firma
- **THEN** la comparación de RUC figura como pendiente hasta registrar los datos de la empresa

### Requirement: Custodia de la firma
El sistema SHALL conservar el archivo de la firma y su contraseña solo cifrados, y SHALL no devolverlos nunca, a ningún rol y por ninguna vía, ni registrarlos en logs, mensajes de error, respuestas o auditoría. Solo la operación de firma de un comprobante podrá usarlos.

#### Scenario: Consulta de la firma
- **WHEN** un administrador consulta la firma vigente
- **THEN** la respuesta contiene solo sus metadatos, sin el archivo, la contraseña ni la clave privada

#### Scenario: Carga rechazada
- **WHEN** una carga se rechaza por cualquier motivo
- **THEN** ni el mensaje de error ni los registros del sistema contienen la contraseña, el contenido del archivo ni la clave privada

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

### Requirement: Firma utilizable
El sistema SHALL considerar utilizable la firma vigente solo si está dentro de su vigencia y su secreto puede abrirse con la clave de custodia configurada. Una firma por vencer sigue siendo utilizable. El sistema SHALL indicar por qué una firma vigente no es utilizable.

#### Scenario: Firma vigente
- **WHEN** la firma vigente está dentro de su vigencia y su secreto puede abrirse
- **THEN** la firma es utilizable

#### Scenario: Firma vencida
- **WHEN** pasa la fecha de fin de vigencia de la firma vigente
- **THEN** la firma deja de ser utilizable y figura como vencida, con su fecha de vencimiento

#### Scenario: Secreto que no puede abrirse
- **WHEN** la clave de custodia configurada no abre el secreto de la firma vigente, por ejemplo porque se perdió o cambió
- **THEN** la firma no es utilizable y el administrador ve que debe volver a cargarla

### Requirement: Aviso de vencimiento de la firma
El sistema SHALL avisar dentro de la aplicación, a administradores y operadores, cuando la firma vigente está por vencer o vencida. Está por vencer cuando faltan menos días para su vencimiento que la anticipación configurada por el administrador: un número entero de días entre 1 y 90, 30 por defecto.

#### Scenario: Firma por vencer
- **WHEN** faltan menos días para el vencimiento de la firma que la anticipación configurada
- **THEN** administradores y operadores ven un aviso con la fecha de vencimiento y los días que faltan
- **AND** la firma sigue siendo utilizable

#### Scenario: Firma lejos de vencer
- **WHEN** faltan más días para el vencimiento que la anticipación configurada
- **THEN** no se muestra ningún aviso de vencimiento

#### Scenario: Firma vencida
- **WHEN** la firma vigente está vencida
- **THEN** administradores y operadores ven un aviso de que la firma venció y no se puede emitir

#### Scenario: Cambiar la anticipación
- **WHEN** un administrador fija la anticipación en 45 días
- **THEN** el aviso aparece cuando faltan menos de 45 días para el vencimiento

#### Scenario: Anticipación fuera de rango
- **WHEN** un administrador intenta fijar la anticipación en 0, en 91 o en un número no entero
- **THEN** el sistema rechaza el cambio e indica el rango admitido

### Requirement: Clave de custodia obligatoria en producción
El sistema SHALL negarse a arrancar en producción si la clave de custodia de las firmas no está configurada o no es válida, indicando la configuración que falta sin revelar ningún valor. En desarrollo y pruebas puede arrancar en un modo sin firma solo si se configura expresamente; en ese modo rechaza cargar firmas e indica por qué.

#### Scenario: Producción sin clave de custodia
- **WHEN** el sistema arranca en producción sin clave de custodia, o con una clave inválida o la de ejemplo
- **THEN** no arranca e indica qué configuración falta o es inválida, sin mostrar su valor

#### Scenario: Modo sin firma en desarrollo
- **WHEN** el sistema arranca en desarrollo con el modo sin firma configurado expresamente y un administrador intenta cargar una firma
- **THEN** la carga se rechaza e indica que la instalación no tiene custodia de firmas configurada

#### Scenario: Modo sin firma en producción
- **WHEN** el sistema arranca en producción con el modo sin firma configurado
- **THEN** no arranca

### Requirement: Permisos de la firma
El sistema SHALL reservar al administrador la carga, el reemplazo, la consulta completa de la firma y la configuración de la anticipación del aviso. Un operador solo consulta la vigencia de la firma.

#### Scenario: Operador intenta cargar o consultar
- **WHEN** un operador intenta cargar o reemplazar la firma, consultar sus metadatos completos o cambiar la anticipación del aviso
- **THEN** el sistema rechaza la solicitud por falta de permiso y nada cambia

#### Scenario: Operador consulta la vigencia
- **WHEN** un operador consulta la vigencia de la firma
- **THEN** ve si la firma es utilizable, si está por vencer o vencida, y su fecha de vencimiento, sin titular, emisor, número de serie ni RUC

#### Scenario: Empresa sin firma
- **WHEN** un usuario consulta la firma de una empresa que aún no la cargó
- **THEN** ve que la empresa no tiene firma electrónica

### Requirement: Aislamiento de la firma por empresa
El sistema SHALL limitar la carga, el reemplazo, la consulta y el uso de la firma a la empresa del usuario autenticado. Un usuario de otra empresa no puede leer, reemplazar ni detectar la firma de una empresa ajena.

#### Scenario: Consulta desde otra empresa
- **WHEN** un administrador de la empresa B consulta la firma
- **THEN** ve solo la firma de la empresa B, o que no tiene firma, sin ningún dato de la firma de la empresa A

#### Scenario: Carga con otra empresa en la solicitud
- **WHEN** un administrador incluye un identificador de empresa en la solicitud de carga
- **THEN** el sistema rechaza la solicitud y la firma de ninguna empresa cambia

### Requirement: Coste acotado de abrir la firma
El sistema SHALL acotar el coste de abrir el PKCS#12 de la firma con dos defensas que se aplican siempre y juntas:
- un techo de 131 072 iteraciones por contador, comprobado sobre el archivo antes de descifrar nada y antes de comprobar la contraseña. Los contadores son el del código de integridad del archivo (MAC) y el de cada contenido cifrado: el mayor de ellos no debe superar el techo, y un contador igual al techo se admite. Los contadores no se suman.
- un plazo máximo configurado para cada apertura, fuera del hilo que atiende las peticiones. Una apertura que lo excede se cancela.

Un archivo que supera el techo SHALL rechazarse como incompatible, con el motivo propio del coste de cifrado y sin intentar abrirlo. Una apertura cancelada por el plazo SHALL informar que la operación tardó demasiado y se canceló. En ningún caso cambia la firma vigente, y ni el error ni los registros contienen la contraseña ni el contenido del archivo. Las firmas legítimas cuyo perfil de iteraciones está dentro del techo, como el observado en Security Data, SHALL cargarse con las demás condiciones de la carga.

#### Scenario: Firma con el perfil de Security Data
- **WHEN** un administrador carga un PKCS#12 válido y vigente, con RUC, cuyo código de integridad usa 102 400 iteraciones y cuyos contenidos cifrados usan 51 200, con su contraseña correcta
- **THEN** la firma queda como la firma vigente de la empresa

#### Scenario: Contador igual al techo
- **WHEN** un administrador carga un PKCS#12 válido cuyo mayor contador de iteraciones es exactamente 131 072, con su contraseña correcta
- **THEN** el techo no lo rechaza y la carga sigue con las demás comprobaciones

#### Scenario: Contador por encima del techo
- **WHEN** un administrador carga un PKCS#12 en el que el código de integridad o cualquiera de sus contenidos cifrados usa 131 073 iteraciones o más, incluso un valor absurdo
- **THEN** el sistema lo rechaza como incompatible por su coste de cifrado, sin intentar descifrarlo ni comprobar la contraseña
- **AND** el rechazo llega sin el coste de abrirlo
- **AND** la firma vigente no cambia

#### Scenario: Contraseña incorrecta con un perfil admitido
- **WHEN** un administrador carga un PKCS#12 con el perfil de Security Data y una contraseña que no lo abre
- **THEN** el sistema rechaza la carga e indica que la contraseña no corresponde al archivo, no que el archivo es incompatible
- **AND** ni el mensaje de error ni los registros contienen la contraseña

#### Scenario: Apertura que excede el plazo
- **WHEN** abrir un PKCS#12 cuyos contadores están dentro del techo tarda más que el plazo configurado, por ejemplo porque repite muchos contenidos cifrados
- **THEN** la apertura se cancela y el sistema informa que la operación tardó demasiado y se canceló
- **AND** la firma vigente no cambia
- **AND** el sistema sigue atendiendo otras peticiones y otras aperturas mientras tanto
