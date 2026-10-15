# Spec Delta

## ADDED Requirements

### Requirement: Acción siguiente en el editor de facturas
El editor de facturas SHALL distinguir guardar el borrador de emitir la factura. Guardar SHALL estar
disponible siempre que no haya un guardado en curso, también con el borrador incompleto o con
problemas que impiden emitir. Un guardado que el servidor rechaza SHALL explicar el motivo junto al
dato que lo causa, o con la forma de recuperarse, sin perder lo escrito. Emitir SHALL estar
disponible solo con la versión vigente guardada, sin cambios sin guardar, sin problemas del servidor
y con permiso para emitir. El servidor vuelve a comprobarlo al emitir. El editor SHALL destacar como
acción principal la siguiente acción válida: guardar mientras no haya una versión guardada sin
cambios, y emitir cuando la emisión esté disponible. Una acción que no puede ejecutarse SHALL
percibirse como no disponible y decir por qué. Sin permiso para emitir, la acción de emitir no SHALL
aparecer.

#### Scenario: Factura nueva
- **WHEN** un operador abre la pantalla de nueva factura
- **THEN** «Guardar borrador» es la acción principal
- **AND** «Emitir factura» se percibe como no disponible y dice que primero hay que guardar el borrador

#### Scenario: Borrador incompleto
- **WHEN** un operador guarda una factura nueva sin comprador ni líneas
- **THEN** el borrador queda guardado, «Guardar borrador» sigue disponible, y «Emitir factura» se percibe como no disponible con el motivo de lo que falta

#### Scenario: Cambios sin guardar
- **WHEN** un operador cambia la cantidad de una línea de un borrador guardado
- **THEN** guardar el borrador pasa a ser la acción principal y «Emitir factura» se percibe como no disponible, con el motivo de que hay cambios por guardar

#### Scenario: Borrador con problemas
- **WHEN** un operador guarda un borrador cuyo comprador no es un cliente
- **THEN** «Guardar borrador» sigue disponible, «Emitir factura» se percibe como no disponible con un motivo que remite a los problemas, y cada problema se muestra junto al dato que lo causa

#### Scenario: Guardado en curso
- **WHEN** un operador elige guardar el borrador
- **THEN** mientras se guarda, guardar se muestra en curso, el formulario no se puede editar y «Emitir factura» no está disponible

#### Scenario: Guardado rechazado
- **WHEN** el servidor rechaza un guardado porque el borrador cambió en otra sesión
- **THEN** el editor explica el conflicto, ofrece recargar el borrador y conserva lo escrito hasta que el operador decida

#### Scenario: Listo para emitir
- **WHEN** un operador guarda un borrador completo y sin problemas
- **THEN** «Emitir factura» es la acción principal y guardar queda como acción secundaria

#### Scenario: Rechazo al emitir
- **WHEN** entre la vista previa y la emisión cambia una condición, como la firma electrónica, y el servidor rechaza la emisión
- **THEN** no se emite ninguna factura, el editor muestra el motivo y vuelve a mostrar los problemas actuales del borrador

#### Scenario: Sin permiso para emitir
- **WHEN** un usuario con permiso para preparar borradores pero no para emitir abre un borrador listo
- **THEN** no ve la acción de emitir y guardar sigue siendo la acción principal

### Requirement: Totales veraces en el editor de facturas
El editor SHALL mostrar solo los totales, los impuestos y los problemas que calcula el servidor para
la versión guardada del borrador, sin calcular importes en el navegador. Sin borrador guardado, no
SHALL mostrar importes ni ceros, y SHALL explicar que los totales se obtienen al guardar. Con el
borrador guardado y sin cambios, SHALL mostrar los últimos totales del servidor. Con cambios sin
guardar, no SHALL presentar los totales anteriores como vigentes: SHALL rotularlos como los del
último guardado y explicar que hay que guardar para recalcularlos. Tras un guardado correcto, la
respuesta del servidor SHALL ser la única fuente de los totales. Mientras alguna línea no pueda
calcularse, SHALL decirlo en lugar de mostrar importes parciales o ceros.

#### Scenario: Borrador guardado
- **WHEN** un operador guarda un borrador con dos líneas calculables
- **THEN** el resumen muestra el subtotal sin impuestos, el descuento, cada impuesto y el total que devolvió el servidor, con la fecha a la que se evaluaron

#### Scenario: Totales tras editar
- **WHEN** un operador cambia el descuento de una línea después de guardar
- **THEN** el resumen rotula el total anterior como el del último guardado, no lo presenta como vigente, y explica que hay que guardar para recalcularlo

#### Scenario: Después de guardar
- **WHEN** un operador con cambios sin guardar guarda el borrador y el servidor lo acepta
- **THEN** el resumen muestra los totales de esa respuesta del servidor como vigentes y deja de rotularlos como del último guardado

#### Scenario: Sin borrador guardado
- **WHEN** un operador agrega productos a una factura nueva sin guardarla
- **THEN** el resumen no muestra importes ni ceros y explica que guardar el borrador da los totales calculados por el servidor

#### Scenario: Línea que no se puede calcular
- **WHEN** un borrador guardado tiene una línea cuyo impuesto no puede calcularse
- **THEN** el resumen no muestra totales ni ceros, y dice que los totales aparecen cuando todas las líneas se pueden calcular

### Requirement: Ambiente junto a la emisión
El editor SHALL mostrar el ambiente fiscal vigente junto a la acción de emitir. En Pruebas, SHALL
decir allí que la factura no tendrá validez tributaria. Producción SHALL mostrarse como contexto,
sin la presentación de éxito. Si el ambiente no puede confirmarse, SHALL decirlo y no presentarlo
como Producción.

#### Scenario: Empresa en Pruebas
- **WHEN** un operador prepara una factura en una empresa en Pruebas
- **THEN** junto a la acción de emitir lee que el ambiente es Pruebas y que la factura no tendrá validez tributaria

#### Scenario: Empresa en Producción
- **WHEN** un operador prepara una factura en una empresa en Producción
- **THEN** junto a la acción de emitir ve «Producción» como contexto, sin la presentación de éxito

#### Scenario: Ambiente desconocido
- **WHEN** el ambiente de la empresa no puede confirmarse
- **THEN** el editor dice que no pudo confirmar el ambiente y no muestra «Producción»

### Requirement: Confirmación de la emisión desde el editor
Emitir desde el editor SHALL pedir una confirmación explícita que diga que la emisión reserva el
número, firma la factura y no puede deshacerse, y que muestre el ambiente, el comprador, el total
del servidor y el número de líneas. En Pruebas, SHALL recordar que la factura no tendrá validez
tributaria. Con consumidor final, SHALL advertir sus restricciones de anulación y corrección.
Confirmar dos veces la misma emisión SHALL producir una sola factura.

#### Scenario: Confirmar
- **WHEN** un operador elige emitir un borrador listo
- **THEN** ve la confirmación con el ambiente, el comprador, el total y el número de líneas, y la factura solo se emite si confirma

#### Scenario: Cancelar
- **WHEN** un operador abre la confirmación y la cancela
- **THEN** no se reserva ningún número y el borrador no cambia

#### Scenario: Pruebas
- **WHEN** un operador confirma la emisión en una empresa en Pruebas
- **THEN** la confirmación dice que la factura no tendrá validez tributaria

#### Scenario: Consumidor final
- **WHEN** un operador va a emitir una factura a consumidor final
- **THEN** la confirmación advierte que tiene restricciones para anularse o corregirse con una nota de crédito

#### Scenario: Confirmación repetida
- **WHEN** un operador confirma la emisión y la solicitud se repite por un doble clic o un reintento
- **THEN** se emite una sola factura con un solo número

### Requirement: Formas de pago en el editor de facturas
El editor SHALL explicar en lenguaje natural cuándo puede dejarse vacío el importe de una forma de
pago: con una sola forma de pago, el importe vacío usa el total de la factura. Con varias formas de
pago, SHALL indicar que cada una lleva su importe y que deben sumar el total. La acción para quitar
una forma de pago SHALL identificarla y quedar asociada a su fila a cualquier anchura. Las reglas de
las formas de pago no cambian.

#### Scenario: Una forma de pago
- **WHEN** un operador prepara una factura con una sola forma de pago
- **THEN** el importe dice «Déjalo vacío para usar el total de la factura»

#### Scenario: Varias formas de pago
- **WHEN** un operador agrega una segunda forma de pago
- **THEN** el editor indica que cada forma de pago lleva su importe y que deben sumar el total

#### Scenario: Quitar en un teléfono
- **WHEN** un operador ve dos formas de pago en un teléfono
- **THEN** cada acción de quitar está junto a su forma de pago y su nombre accesible dice cuál quita

### Requirement: Cambios sin guardar en el editor de facturas
El editor SHALL indicar de forma visible «Cambios sin guardar» mientras haya cambios que no se han
guardado. Al cerrar o recargar la pestaña con cambios sin guardar, el navegador SHALL pedir
confirmación antes de descartarlos. El indicador y el aviso SHALL desaparecer solo tras un guardado
que el servidor confirma, u otra operación confirmada que persista la versión que se ve. Un guardado
fallido SHALL conservar los cambios y el indicador. Sin cambios, salir del editor no SHALL pedir nada.

#### Scenario: Indicador de cambios
- **WHEN** un operador cambia el punto de emisión de un borrador guardado
- **THEN** el editor muestra «Cambios sin guardar» hasta que el servidor confirma el guardado

#### Scenario: Guardado fallido
- **WHEN** un operador con cambios sin guardar guarda y el servidor rechaza el guardado
- **THEN** sus cambios siguen en el formulario, el editor sigue mostrando «Cambios sin guardar» y cerrar la pestaña sigue pidiendo confirmación

#### Scenario: Cerrar la pestaña con cambios
- **WHEN** un operador intenta cerrar o recargar la pestaña con cambios sin guardar
- **THEN** el navegador le pide confirmar antes de descartarlos

#### Scenario: Salir sin cambios
- **WHEN** un operador recarga la pestaña de un borrador sin cambios sin guardar
- **THEN** el navegador no pide ninguna confirmación

### Requirement: Borrador de otra empresa en el editor
El editor SHALL abrir solo borradores de la empresa de la sesión. Un borrador de otra empresa SHALL
tratarse como inexistente, sin revelar sus datos ni su existencia.

#### Scenario: Dirección de un borrador ajeno
- **WHEN** un operador abre la dirección de un borrador de factura de otra empresa
- **THEN** ve que el borrador no existe y no ve ningún dato de ese borrador

### Requirement: Lectura del editor de facturas a cualquier anchura
A cualquier anchura soportada, el editor SHALL mantener legibles el comprador, el punto de emisión,
las líneas, las formas de pago, el resumen y las acciones, sin desplazamiento horizontal de la página
y sin que un panel lateral reduzca el formulario hasta cortar sus valores. Cuando no haya espacio
para el resumen al lado, el resumen y las acciones SHALL quedar debajo del formulario, y las
acciones SHALL seguir alcanzables sin volver al principio de la pantalla.

#### Scenario: Portátil con la barra expandida
- **WHEN** un operador abre el editor a 1024 px con la barra lateral expandida
- **THEN** la forma de pago y el importe se leen completos, y el resumen queda debajo del formulario en lugar de estrecharlo

#### Scenario: Escritorio amplio
- **WHEN** un operador abre el editor a 1440 px
- **THEN** el resumen y las acciones quedan al lado del formulario y siguen a la vista al desplazarse

#### Scenario: Teléfono
- **WHEN** un operador prepara una factura en un teléfono
- **THEN** lee cada línea y cada forma de pago sin desplazar la página a lo ancho, y alcanza guardar y emitir sin volver al principio
