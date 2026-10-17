# credit-notes Specification

## Purpose

Corregir una venta autorizada con una nota de crédito contra una factura propia: anulación total o
devolución por líneas, con importes exactos desde la factura, un crédito acumulado acotado, las
declaraciones del usuario y la devolución física declarada.

## Requirements

### Requirement: Factura que admite nota de crédito
Una nota de crédito SHALL modificar únicamente una factura emitida por el sistema, de la misma empresa, en estado autorizada, del mismo ambiente en que la empresa emite y con su snapshot y sus artefactos fiscales íntegros. Es una política del MVP: no existe forma de referir un comprobante externo, en papel, importado o ingresado a mano, ni una factura en otro estado o un borrador, ni una factura de Pruebas desde Producción o al revés.

#### Scenario: Factura autorizada
- **WHEN** un usuario prepara una nota de crédito para una factura propia autorizada
- **THEN** el sistema acepta la factura como documento modificado

#### Scenario: Factura en otro estado
- **WHEN** un usuario prepara una nota de crédito para una factura reservada, firmada, recibida, verificando con el SRI, en revisión manual, devuelta o no autorizada
- **THEN** el sistema rechaza la solicitud indicando que solo una factura autorizada admite nota de crédito

#### Scenario: Factura de otro ambiente
- **WHEN** un usuario prepara o emite una nota de crédito para una factura autorizada en un ambiente distinto del que la empresa usa para emitir
- **THEN** la vista previa muestra el problema, el sistema no permite emitir la nota y no reserva número ni capacidad

#### Scenario: Comprobante externo
- **WHEN** una solicitud intenta referir un comprobante por un número, una clave o una fecha que no son una factura del sistema
- **THEN** el sistema rechaza la solicitud por contener campos no permitidos

#### Scenario: Artefactos alterados
- **WHEN** el snapshot, el XML firmado o el XML autorizado de la factura no son íntegros
- **THEN** el borrador muestra el problema, el sistema no permite emitir la nota, no reserva número y no repara los datos con el producto o el tercero vigentes

### Requirement: Factura emitida a consumidor final
Una factura emitida a consumidor final MUST NOT recibir una nota de crédito (requisito oficial: Res. NAC-DGERCGC25-00000014, art. 3, último inciso, vigente desde el 01/01/2026). El sistema lo comprueba antes de reservar el secuencial, crear la clave de acceso, firmar o llamar al SRI, y ninguna declaración del usuario lo evita.

#### Scenario: Consumidor final
- **WHEN** un usuario intenta preparar o emitir una nota de crédito para una factura emitida a consumidor final
- **THEN** el sistema rechaza la solicitud indicando la restricción, y no se reserva ningún número de nota de crédito

### Requirement: Causas de la nota de crédito
Cada nota de crédito SHALL tener una de dos causas cerradas: anulación total o devolución. Los descuentos y bonificaciones posteriores, que la norma permite, no forman parte del MVP. El motivo que se escribe en el comprobante nunca selecciona el comportamiento.

#### Scenario: Causa desconocida
- **WHEN** una solicitud indica una causa distinta de anulación total o devolución, como un descuento o una bonificación
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Motivo que nombra otra causa
- **WHEN** un usuario prepara una devolución con el motivo "Descuento por pronto pago"
- **THEN** la nota se trata como devolución, con sus reglas de líneas y cantidades

### Requirement: Motivo de la nota de crédito
Cada nota de crédito SHALL llevar un motivo de una sola línea, de 1 a 300 caracteres, que se escribe en el comprobante.

#### Scenario: Sin motivo
- **WHEN** un usuario emite una nota de crédito sin motivo, o con un motivo de más de 300 caracteres o de varias líneas
- **THEN** el sistema rechaza la emisión antes de reservar número

### Requirement: Anulación total
Una nota de crédito de anulación total SHALL acreditar exactamente todas las líneas, cantidades, impuestos y el total de la factura, reproducidos desde su snapshot. Solo procede si la factura no tiene ningún crédito previo, reservado o aplicado. No implica retorno físico: la devolución de mercadería se declara aparte.

#### Scenario: Anulación de una factura sin créditos
- **WHEN** un usuario emite una anulación total de una factura de 28.75 sin notas previas
- **THEN** la nota acredita cada línea con su cantidad completa y su valor de la modificación es 28.75

#### Scenario: Factura con una nota reservada
- **WHEN** un usuario intenta una anulación total de una factura que tiene una devolución reservada todavía sin autorizar
- **THEN** el sistema rechaza la anulación total indicando que la factura ya tiene créditos

#### Scenario: Factura con una nota aplicada
- **WHEN** un usuario intenta una anulación total de una factura con una devolución autorizada
- **THEN** el sistema rechaza la anulación total, que no se convierte en la anulación del saldo restante

#### Scenario: Anulación sin retorno físico
- **WHEN** se autoriza una anulación total sin retorno físico declarado
- **THEN** el inventario no cambia

#### Scenario: Anulación después de una devolución mínima
- **WHEN** una factura de 100.00 tiene una devolución autorizada de 0.50 y un usuario intenta una anulación total
- **THEN** el sistema la rechaza, aunque quede casi todo el importe

#### Scenario: Retorno físico en una anulación total
- **WHEN** un usuario prepara una anulación total de una factura con un bien que afectaba al inventario y un servicio
- **THEN** puede declarar para el bien un retorno físico de 0 a su cantidad original, el servicio queda en 0, y no se asume ningún retorno

### Requirement: Devolución por líneas de la factura
Una nota de crédito de devolución SHALL acreditar líneas de la factura, cada una con una cantidad mayor que cero, parcial o completa. Cada línea de la nota se liga a una línea de la factura; no existen líneas libres ni repetidas. Acreditar todas las líneas con sus cantidades completas es una devolución total.

#### Scenario: Devolución parcial
- **WHEN** un usuario devuelve 2 de las 5 unidades de una línea
- **THEN** la nota acredita 2 unidades de esa línea y la línea conserva 3 acreditables

#### Scenario: Varias líneas
- **WHEN** un usuario devuelve una unidad de cada una de tres líneas
- **THEN** la nota tiene tres líneas, cada una ligada a su línea de la factura

#### Scenario: Devolución total
- **WHEN** un usuario devuelve todas las líneas con sus cantidades completas
- **THEN** la nota acredita el total de la factura

#### Scenario: Cantidad cero o inválida
- **WHEN** una línea de la devolución tiene cantidad cero, negativa, o con más de 6 decimales
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Línea ajena a la factura
- **WHEN** una solicitud acredita una línea que la factura no tiene, o la misma línea dos veces
- **THEN** el sistema rechaza la solicitud

### Requirement: Cantidad acreditable de cada línea
La cantidad acumulada acreditada de cada línea de la factura MUST NOT superar su cantidad original. Cuentan las notas autorizadas y las reservadas todavía sin conclusión; no cuentan las devueltas ni las no autorizadas. Es una política conservadora del producto, no un límite textual del SRI.

#### Scenario: Acumulación que excede la línea
- **WHEN** una línea de 5 unidades tiene 3 acreditadas y un usuario pide acreditar 3 más
- **THEN** el sistema rechaza la nota indicando que quedan 2 unidades acreditables, sin reservar número

#### Scenario: Nota reservada que cuenta
- **WHEN** una línea de 5 unidades tiene una nota de 4 reservada y en transmisión, y otra nota pide 2
- **THEN** el sistema rechaza la segunda nota

#### Scenario: Nota no autorizada que deja de contar
- **WHEN** una nota de 4 unidades termina no autorizada y después otra nota pide 4 unidades de la misma línea
- **THEN** la segunda nota se acepta

### Requirement: Importes desde la factura original
Las cantidades, precios, descuentos, bases e impuestos de cada línea acreditada SHALL derivarse del snapshot de la factura con decimal exacto: la cantidad acreditada fija la proporción de la línea, y las tarifas son las de la factura. Nunca se leen el producto, el tercero, el catálogo ni la configuración vigentes para un importe histórico.

#### Scenario: Línea completa
- **WHEN** se acredita completa una línea de 3 unidades a 10.00 con descuento de 3.00 e IVA del 15 %
- **THEN** la línea acreditada tiene la cantidad 3, el precio 10.00, el descuento 3.00, la base 27.00 y el IVA 4.05, iguales a los de la factura

#### Scenario: Línea parcial
- **WHEN** se acredita 1 de esas 3 unidades
- **THEN** la línea acreditada tiene la cantidad 1, el precio 10.00, el descuento 1.00, la base 9.00 y el IVA 1.35

#### Scenario: Precio y tarifa cambiados después de facturar
- **WHEN** el precio del producto y la tarifa vigente de IVA cambiaron después de autorizar la factura
- **THEN** la nota usa el precio y la tarifa de la factura

#### Scenario: Cantidades con seis decimales
- **WHEN** se acredita la cantidad `0.333333` de una línea de cantidad `1.000000`
- **THEN** los importes se calculan sin redondeo intermedio y se fijan a la escala del comprobante una sola vez

### Requirement: Remanente exacto de una línea
La nota que completa la cantidad de una línea SHALL acreditar exactamente lo que falta de su subtotal, descuento, base e impuestos, para que la suma de las notas vigentes de la línea sea igual a la línea original, sin diferencias de centavos. Si una línea parcial diera un importe negativo, la nota se rechaza.

#### Scenario: Tres notas de un tercio
- **WHEN** una línea con base 10.00 se devuelve en tres notas de una unidad cada una
- **THEN** sus bases suman exactamente 10.00, y la última toma el remanente

#### Scenario: Remanente después de una nota no autorizada
- **WHEN** una de esas notas termina no autorizada y otra nota completa la línea
- **THEN** la suma de las notas autorizadas y reservadas de la línea sigue siendo igual a la línea original

#### Scenario: Importe negativo
- **WHEN** una cantidad muy pequeña de una línea con descuento casi total diera una base negativa
- **THEN** el sistema rechaza la nota indicando la línea, sin reservar número

### Requirement: Crédito acumulado de la factura
El crédito acumulado de una factura MUST NOT superar su total. Cuentan las notas autorizadas y las reservadas sin conclusión. Es una política conservadora del producto, no un límite textual del SRI, y se comprueba con el estado fiscal inmutable de la factura y de sus notas.

#### Scenario: Crédito dentro del total
- **WHEN** una factura de 100.00 tiene notas por 60.00 y un usuario emite otra por 40.00
- **THEN** la nota se reserva y el crédito acumulado queda en 100.00

#### Scenario: Crédito que excede el total
- **WHEN** una nota haría que el crédito acumulado de la factura superara su total
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Capacidad reservada durante la transmisión
Al reservar una nota, su crédito y sus cantidades SHALL quedar reservados mientras la nota está reservada, firmada, recibida, verificando con el SRI o en revisión manual. Al autorizarse pasan a aplicados; si termina devuelta o no autorizada, se liberan en la misma operación que la transición. Nunca se liberan por tiempo ni por un resultado incierto, y una repetición no los aplica ni los libera dos veces.

#### Scenario: Nota autorizada
- **WHEN** una nota reservada se autoriza
- **THEN** su crédito y sus cantidades pasan de reservados a aplicados

#### Scenario: Nota devuelta o no autorizada
- **WHEN** una nota termina devuelta o no autorizada
- **THEN** su crédito y sus cantidades se liberan y la factura recupera esa capacidad

#### Scenario: Resultado incierto o revisión manual
- **WHEN** una nota queda verificando con el SRI o en revisión manual durante días
- **THEN** su crédito y sus cantidades siguen reservados

#### Scenario: Repetición de la decisión
- **WHEN** la misma autorización o la misma no autorización de una nota se procesa otra vez por un reintento o una reconciliación
- **THEN** su crédito no se aplica ni se libera dos veces

#### Scenario: Problema operacional
- **WHEN** la transmisión de una nota agota sus reintentos, se detiene, pierde la conexión, recibe una respuesta que no se interpreta o el proceso cae
- **THEN** su crédito y sus cantidades siguen reservados: un problema operacional no demuestra que el SRI rechazó la nota

#### Scenario: Sin limpieza por antigüedad
- **WHEN** una nota lleva semanas en revisión manual
- **THEN** ningún proceso libera su reserva hasta que una reconciliación concluye

### Requirement: Notas simultáneas sobre una factura
Dos notas emitidas a la vez sobre la misma factura SHALL validarse una después de la otra contra la misma capacidad, y en conjunto nunca exceden la cantidad de una línea, el total de la factura ni la condición de la anulación total.

#### Scenario: Dos devoluciones de la misma línea
- **WHEN** dos devoluciones de 3 unidades de una línea de 5 se emiten a la vez
- **THEN** una se reserva y la otra se rechaza por cantidad, sin reservar número

#### Scenario: Anulación total y devolución
- **WHEN** una anulación total y una devolución de la misma factura se emiten a la vez
- **THEN** exactamente una se reserva

#### Scenario: Dos anulaciones totales
- **WHEN** dos anulaciones totales de la misma factura se emiten a la vez
- **THEN** exactamente una se reserva

#### Scenario: Dos devoluciones que caben
- **WHEN** dos devoluciones de 6 y 4 unidades de una línea de 10 se emiten a la vez
- **THEN** ambas se reservan y la línea queda sin cantidad acreditable

#### Scenario: Nota incierta que retiene capacidad
- **WHEN** una devolución de 6 unidades de una línea de 10 queda verificando con el SRI y otra pide 5
- **THEN** la segunda se rechaza: la capacidad de la primera sigue reservada

### Requirement: Declaraciones de elegibilidad
Antes de reservar una nota, el usuario SHALL declarar por separado que la factura no es una factura comercial negociable negociada y que no sustentó una devolución de impuestos (exclusiones oficiales que el sistema no puede comprobar). Sin ambas no se emite. La nota guarda la versión de la declaración, cada afirmación, el actor y el momento, como elegibilidad declarada, no verificada.

#### Scenario: Declaraciones confirmadas
- **WHEN** un usuario emite una nota confirmando ambas declaraciones
- **THEN** el comprobante guarda la versión de la declaración, las dos afirmaciones, el usuario y el momento

#### Scenario: Declaración faltante
- **WHEN** un usuario emite una nota sin confirmar una de las dos declaraciones
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Exclusión conocida por el sistema
- **WHEN** un usuario confirma ambas declaraciones para una factura que el sistema sabe excluida, como una de consumidor final
- **THEN** el sistema rechaza la nota: la declaración no anula la exclusión

#### Scenario: Sin afirmación de verificación
- **WHEN** un usuario consulta una nota emitida
- **THEN** las declaraciones se presentan como declaradas por el usuario, nunca como verificadas por el sistema

### Requirement: Retorno físico declarado
En una devolución, cada línea SHALL indicar una cantidad de retorno físico entre cero y la cantidad acreditada; en una anulación total, el usuario puede declararla por línea con el mismo límite. Solo puede ser mayor que cero en una línea de un bien que, en el snapshot de la factura, afectaba al inventario; el control actual del producto no cuenta.

#### Scenario: Crédito sin retorno físico
- **WHEN** un usuario acredita 3 unidades y declara un retorno físico de 0
- **THEN** la nota se emite y no devuelve stock

#### Scenario: Retorno mayor que lo acreditado
- **WHEN** una línea acredita 2 unidades y declara un retorno físico de 3
- **THEN** el sistema rechaza la solicitud

#### Scenario: Servicio
- **WHEN** una línea de un servicio declara un retorno físico mayor que cero
- **THEN** el sistema rechaza la solicitud

#### Scenario: Bien que no afectaba al inventario
- **WHEN** una línea de un bien que en la factura no afectaba al inventario declara un retorno físico mayor que cero
- **THEN** el sistema rechaza el retorno físico, y la línea puede acreditarse con retorno 0

#### Scenario: Control desactivado después de facturar
- **WHEN** una línea que en la factura afectaba al inventario declara un retorno físico y hoy el producto tiene el control desactivado
- **THEN** el retorno físico se acepta

#### Scenario: Crédito y retorno físico independientes
- **WHEN** una factura de 10 unidades que salieron del inventario recibe una nota autorizada que acredita 5 con retorno físico 2
- **THEN** quedan 5 unidades acreditables y 8 devolvibles: ninguna capacidad se deriva de la otra

### Requirement: Retorno físico limitado por la salida original
El retorno físico acumulado de cada producto de una factura MUST NOT superar lo que la salida de esa factura sacó del inventario. Cuentan las devoluciones aplicadas y las reservadas en notas sin conclusión. Si la factura no registró salida de ese producto, no admite retorno físico.

#### Scenario: Retorno dentro de la salida
- **WHEN** una factura sacó 5 unidades de un producto y ya se devolvieron físicamente 3
- **THEN** una nota puede declarar un retorno físico de hasta 2 unidades de ese producto

#### Scenario: Retorno que excede la salida
- **WHEN** una nota declara un retorno físico mayor que lo que queda por devolver de la salida
- **THEN** el sistema rechaza la nota sin reservar número

#### Scenario: Dos retornos simultáneos del mismo producto
- **WHEN** dos notas de la misma factura declaran a la vez retornos físicos que juntos exceden la salida de un producto
- **THEN** una se reserva y la otra se rechaza

#### Scenario: Factura sin salida del producto
- **WHEN** una factura no registró salida de un producto
- **THEN** ninguna nota puede declarar retorno físico de ese producto

### Requirement: Borrador y vista previa de la nota de crédito
Un usuario SHALL preparar la nota en un borrador: factura, causa, punto de emisión, líneas y cantidades en una devolución, retorno físico y motivo. La vista previa, recalculada por el servidor, muestra los importes y el valor de la modificación, lo acreditable que queda por línea, el retorno físico y los problemas que bloquean. El borrador no reserva capacidad ni número.

#### Scenario: Vista previa de una devolución
- **WHEN** un usuario guarda un borrador de devolución de 2 unidades de una línea
- **THEN** la vista previa muestra la línea con sus importes, el valor de la modificación y las unidades que quedan acreditables

#### Scenario: Problema que bloquea
- **WHEN** el borrador pide más cantidad de la acreditable o un retorno físico no permitido
- **THEN** la vista previa lista el problema junto a la línea y la emisión queda bloqueada

#### Scenario: Borrador de anulación total
- **WHEN** un usuario prepara una anulación total
- **THEN** el borrador no permite elegir líneas ni cantidades y la vista previa muestra el total de la factura

#### Scenario: Borrador desactualizado
- **WHEN** otra nota de la misma factura se reserva después de guardar el borrador
- **THEN** la vista previa se recalcula con la capacidad vigente y la emisión vuelve a comprobarla al reservar

### Requirement: Comprobante de la nota de crédito
La nota de crédito SHALL ser un comprobante propio (tipo 04, versión 1.1.0) con su secuencial, independiente del de las facturas, su clave de acceso y su snapshot. Lleva los datos del emisor vigentes al reservar, el comprador de la factura, el tipo, número y fecha de la factura modificada, el valor de la modificación, el motivo y sus líneas.

#### Scenario: Numeración propia
- **WHEN** un usuario emite la primera nota de crédito de un punto que ya emitió 40 facturas
- **THEN** la nota recibe el número 000000001 de ese punto, y la siguiente factura sigue en 41

#### Scenario: Documento modificado en el comprobante
- **WHEN** se firma una nota de crédito
- **THEN** su XML indica el tipo 01, el número y la fecha de emisión de la factura, el valor de la modificación y el motivo, y valida contra el XSD oficial de la nota de crédito

#### Scenario: Comprador de la factura
- **WHEN** el tercero de la factura cambió su razón social después de facturar
- **THEN** la nota lleva el comprador tal como figura en la factura

### Requirement: Reserva de la nota sin efectos parciales
La reserva de una nota SHALL bloquear la factura, volver a comprobar su capacidad con lo reservado y aplicado vigente, y reservar en una sola operación la capacidad acreditable, la capacidad devolvible, el secuencial, la clave, el snapshot y el comprobante. Si cualquier paso falla, no queda nada de eso. No hay comunicación externa mientras la factura está bloqueada.

#### Scenario: Fallo dentro de la reserva
- **WHEN** la reserva de una nota falla después de reservar su capacidad y antes de confirmarse
- **THEN** no queda capacidad reservada, número consumido, clave, comprobante ni declaraciones guardadas

#### Scenario: Firma fuera de la reserva
- **WHEN** una nota se reserva y después su firma falla
- **THEN** la nota sigue reservada con su capacidad, como cualquier comprobante reservado, y un reintento la firma

### Requirement: Importes congelados en la nota
Desde su reserva, la nota SHALL contener en su snapshot todo lo que necesita: la factura modificada, las líneas originales elegidas, las cantidades acreditadas, el retorno físico, los importes e impuestos resultantes, las declaraciones, el emisor, el comprador, el punto, el secuencial, la clave y las versiones aplicadas. Su XML, su RIDE y su consulta nunca reconstruyen importes desde la factura original.

#### Scenario: XML y RIDE desde la nota
- **WHEN** se firma una nota y después se genera su RIDE
- **THEN** ambos salen solo del snapshot de la nota, con los importes calculados al reservarla

#### Scenario: Un cálculo único
- **WHEN** se comparan la vista previa del borrador, el snapshot de la nota emitida y su XML
- **THEN** muestran los mismos importes, salidos del mismo cálculo

### Requirement: Emisión idempotente de la nota de crédito
Cada emisión de una nota SHALL exigir una `Idempotency-Key` con alcance empresa, operación de nota de crédito y clave, y la huella del borrador, su versión y las declaraciones. La misma clave con la misma solicitud devuelve la misma nota sin reservar otro número ni otra capacidad; con otra solicitud responde `409 IDEMPOTENCY_KEY_REUSED`.

#### Scenario: Doble envío
- **WHEN** la misma emisión de una nota llega dos veces con la misma clave, también a la vez
- **THEN** existe una sola nota con un solo número y una sola reserva de capacidad, y ambas respuestas la identifican

#### Scenario: Misma clave con otra solicitud
- **WHEN** un usuario reutiliza la clave de una nota emitida para emitir otro borrador
- **THEN** el sistema responde `409 IDEMPOTENCY_KEY_REUSED` y el otro borrador sigue sin emitir

#### Scenario: Misma clave en una factura y en una nota
- **WHEN** un usuario usa para una nota la misma clave que usó para emitir una factura
- **THEN** la nota se emite, porque la operación forma parte del alcance de la clave

#### Scenario: Repetición después de reservar
- **WHEN** el cliente repite con la misma clave una emisión cuya nota quedó reservada sin firmar
- **THEN** el sistema devuelve esa nota y reanuda su firma, sin reservar otro número ni otra capacidad

### Requirement: Consulta de notas de crédito
Un usuario con permiso SHALL consultar las notas de crédito de su empresa, paginadas y con búsqueda, y el detalle de cada una: factura modificada, causa, motivo, líneas, retorno físico, declaraciones, estado, diagnóstico del último intento de firma e historial de la transmisión. También SHALL consultar el crédito de una factura: aplicado, reservado y disponible.

#### Scenario: Detalle de una nota
- **WHEN** un usuario abre una nota de crédito autorizada
- **THEN** ve la factura que modifica, su causa, sus líneas con el retorno físico, sus declaraciones y su autorización

#### Scenario: Crédito de una factura
- **WHEN** un usuario consulta una factura de 100.00 con una nota aplicada de 30.00 y otra reservada de 20.00
- **THEN** ve un crédito aplicado de 30.00, uno reservado de 20.00 y 50.00 disponibles

### Requirement: Reintento de firma de una nota de crédito
Un usuario con permiso SHALL poder reintentar la firma de una nota reservada, con su mismo número, su misma clave y su mismo snapshot, como en la factura.

#### Scenario: Reintento de una nota reservada
- **WHEN** un usuario reintenta la firma de una nota que quedó reservada por un servicio ocupado
- **THEN** la nota queda firmada con su mismo número y su misma clave, y su capacidad sigue reservada

### Requirement: Permisos de notas de crédito
Administradores y operadores SHALL consultar, preparar, emitir y reintentar la firma de notas de crédito, y confirmar sus declaraciones. Solo un administrador SHALL pedir la reconciliación manual de una nota, como la de una factura. El servidor aplica estos permisos en cada operación.

#### Scenario: Operador emite una nota
- **WHEN** un operador emite una nota de crédito válida con sus declaraciones
- **THEN** la nota se emite

#### Scenario: Operador pide una reconciliación
- **WHEN** un operador pide la reconciliación manual de una nota de crédito
- **THEN** el sistema responde prohibido

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión consulta, prepara o emite una nota de crédito
- **THEN** el sistema responde no autenticado

### Requirement: Aislamiento de las notas de crédito por empresa
El sistema SHALL limitar las notas de crédito, sus borradores, el crédito de las facturas y las facturas elegibles a la empresa del usuario autenticado. Una factura o una nota de otra empresa responde igual que una inexistente, y una solicitud que indica una empresa se rechaza.

#### Scenario: Factura de otra empresa
- **WHEN** un usuario de la empresa A prepara una nota para una factura de la empresa B, o consulta su crédito
- **THEN** el sistema responde igual que ante una factura inexistente, y nada de la empresa B cambia

#### Scenario: Nota de otra empresa
- **WHEN** un usuario de la empresa A consulta o reintenta una nota de la empresa B
- **THEN** el sistema responde igual que ante una nota inexistente

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un borrador o una emisión incluyen un identificador de empresa
- **THEN** el sistema rechaza la solicitud

### Requirement: Borradores en la lista de notas de crédito
La lista de notas de crédito SHALL mostrar, con el filtro de estado en «Todos», primero los borradores de
nota de crédito de la empresa, el último editado arriba, y después los comprobantes emitidos en su orden de
siempre, en la misma tabla, la misma paginación y el mismo total que entrega el servidor. Cada
borrador SHALL mostrar el estado «Borrador», el comprador o el número de la factura modificada, su total previo o «Incompleto» y la fecha de su última edición, y SHALL
abrir su editor desde la fila y poder eliminarse con confirmación. El filtro de estado SHALL ofrecer
«Borradores», que muestra solo los borradores; un estado de nota emitida SHALL excluirlos.
El filtro de causa SHALL aplicarse también a los borradores, por la causa que declaran. La búsqueda SHALL
encontrar también los borradores por lo que muestran. Solo quien puede preparar borradores de
nota de crédito SHALL verlos. Ninguna otra pantalla de la lista SHALL repetir los borradores en un panel aparte.

#### Scenario: Borradores arriba
- **WHEN** la empresa tiene dos borradores de nota de crédito y treinta comprobantes emitidos, y un operador abre Notas de crédito con 25 filas por página
- **THEN** la primera página muestra los dos borradores con el estado «Borrador» y después 23 comprobantes emitidos, y la lista indica 32 en total

#### Scenario: Solo borradores
- **WHEN** un operador elige el estado «Borradores»
- **THEN** ve solo los borradores de nota de crédito de su empresa, paginados, y ningún comprobante emitido

#### Scenario: Un estado emitido los excluye
- **WHEN** un operador elige un estado de comprobante emitido
- **THEN** la lista no muestra borradores

#### Scenario: Búsqueda sobre borradores
- **WHEN** un operador busca el nombre de un comprador que solo tiene un borrador
- **THEN** ve ese borrador con el estado «Borrador»

#### Scenario: Abrir y eliminar desde la fila
- **WHEN** un operador elige un borrador de la lista
- **THEN** se abre su editor, y desde las acciones de la fila puede eliminarlo después de confirmar

#### Scenario: Borradores de otra empresa
- **WHEN** otra empresa de la instalación tiene borradores de nota de crédito
- **THEN** ninguno aparece en la lista ni cuenta en su total
