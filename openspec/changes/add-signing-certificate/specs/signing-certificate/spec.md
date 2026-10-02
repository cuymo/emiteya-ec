# Spec Delta

## Purpose

Permite al administrador cargar, reemplazar y consultar la firma electrónica del contribuyente con
custodia cifrada, decide cuándo esa firma es utilizable para emitir y avisa de su vencimiento.

## ADDED Requirements

### Requirement: Carga de la firma electrónica
El sistema SHALL permitir que un administrador cargue la firma electrónica de su empresa como un archivo PKCS#12 con su contraseña. La firma se acepta solo si el archivo se abre con la contraseña, contiene una clave privada RSA de al menos 2048 bits que corresponde al certificado y puede firmar con el algoritmo de la ficha técnica vigente del SRI, el certificado está vigente y tiene un RUC detectable. Una firma aceptada pasa a ser la firma vigente de la empresa; una rechazada no cambia nada.

#### Scenario: Primera carga
- **WHEN** un administrador de una empresa sin firma carga un PKCS#12 válido y vigente, con RUC, y su contraseña correcta
- **THEN** la firma queda como la firma vigente de la empresa
- **AND** el administrador ve su titular, emisor, número de serie, vigencia y RUC detectado

#### Scenario: Contraseña incorrecta
- **WHEN** un administrador carga un PKCS#12 con una contraseña que no lo abre
- **THEN** el sistema rechaza la carga e indica que la contraseña no corresponde al archivo
- **AND** la firma vigente no cambia

#### Scenario: Archivo que no es una firma
- **WHEN** un administrador carga un archivo que no es un PKCS#12, o uno vacío o mayor que el tamaño admitido
- **THEN** el sistema rechaza la carga e indica que el archivo no es una firma electrónica válida

#### Scenario: Sin clave privada o con una clave que no sirve
- **WHEN** el PKCS#12 no contiene clave privada, su clave no corresponde al certificado, o la clave no es RSA de al menos 2048 bits
- **THEN** el sistema rechaza la carga e indica que la firma no sirve para firmar comprobantes

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
El sistema SHALL permitir que un administrador reemplace la firma vigente por otra que cumpla las condiciones de carga, indicando qué firma ve como vigente. La firma nueva pasa a ser la vigente; el archivo y la contraseña de la anterior se eliminan y sus metadatos se conservan. Cargar otra vez la firma vigente no cambia nada.

#### Scenario: Reemplazo
- **WHEN** un administrador carga una firma válida distinta de la vigente, indicando la firma vigente que ve
- **THEN** la firma nueva pasa a ser la vigente
- **AND** el archivo y la contraseña de la anterior ya no se conservan

#### Scenario: Misma firma otra vez
- **WHEN** un administrador carga de nuevo el mismo certificado que ya es la firma vigente
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
