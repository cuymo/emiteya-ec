# debit-notes Specification

## Purpose

Cobrar después de la venta, con una nota de débito contra una factura propia autorizada, los intereses de mora y los costos o gastos posteriores que permite el artículo 16, con el IVA de la factura original, un cálculo exacto y la declaración del usuario.

## Requirements

### Requirement: Factura que admite nota de débito
Una nota de débito SHALL modificar exactamente una factura emitida por el sistema, de la misma empresa, del mismo ambiente en que la empresa emite, en estado autorizada y con su snapshot y sus artefactos fiscales íntegros. Es una política del MVP: no existe forma de referir un comprobante externo, en papel, importado o ingresado a mano, otro comprobante de venta, una factura en otro estado o un borrador.

#### Scenario: Factura autorizada
- **WHEN** un usuario prepara una nota de débito para una factura propia autorizada del ambiente en que la empresa emite
- **THEN** el sistema acepta la factura como documento modificado

#### Scenario: Factura en otro estado
- **WHEN** un usuario prepara una nota de débito para una factura reservada, firmada, recibida, verificando con el SRI, en revisión manual, devuelta o no autorizada
- **THEN** el sistema rechaza la solicitud indicando que solo una factura autorizada admite nota de débito

#### Scenario: Factura de otro ambiente
- **WHEN** un usuario prepara o emite una nota de débito para una factura autorizada en Pruebas mientras la empresa emite en Producción, o al revés
- **THEN** la vista previa muestra el problema, el sistema no permite emitir la nota y no reserva número

#### Scenario: Comprobante externo
- **WHEN** una solicitud intenta referir un comprobante por un número, una clave, un tipo o una fecha en lugar de una factura del sistema
- **THEN** el sistema rechaza la solicitud por contener campos no permitidos

#### Scenario: Otro comprobante del sistema
- **WHEN** una solicitud refiere como documento modificado una nota de crédito o una nota de débito del sistema
- **THEN** el sistema responde que la factura no existe

#### Scenario: Artefactos alterados
- **WHEN** el snapshot, el XML firmado o el XML autorizado de la factura no son íntegros
- **THEN** el borrador muestra el problema, el sistema no permite emitir la nota, no reserva número y no repara los datos con el producto, el tercero o el catálogo vigentes

### Requirement: Factura emitida a consumidor final
Una factura emitida a consumidor final MUST NOT recibir una nota de débito. Es una política del proyecto, que exige un receptor identificado (BR-32), no una prohibición de la Res. NAC-DGERCGC25-00000014. El sistema lo comprueba antes de reservar el secuencial, crear la clave de acceso, firmar o llamar al SRI, y ninguna declaración del usuario lo evita.

#### Scenario: Consumidor final
- **WHEN** un usuario intenta preparar o emitir una nota de débito para una factura emitida a consumidor final
- **THEN** el sistema rechaza la solicitud indicando que es una política del proyecto, y no se reserva ningún número de nota de débito

### Requirement: Causas de la nota de débito
Cada concepto de una nota de débito SHALL tener una de las dos causas cerradas del artículo 16 del Reglamento de Comprobantes de Venta: `LATE_PAYMENT_INTEREST` (intereses de mora) o `POST_INVOICE_COST_EXPENSE` (costos o gastos en que el vendedor incurrió después de emitir la factura). No existen otras causas ni atajos.

#### Scenario: Causa oficial
- **WHEN** un usuario prepara un concepto con la causa de intereses de mora
- **THEN** el sistema acepta el concepto con esa causa

#### Scenario: Causa desconocida
- **WHEN** una solicitud envía una causa distinta de las dos oficiales, como una corrección de precio o una penalidad
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Conceptos con causas distintas
- **WHEN** un usuario prepara una nota con un concepto de intereses de mora y otro de costos posteriores
- **THEN** la nota conserva la causa de cada concepto

### Requirement: Conceptos de la nota de débito
Una nota de débito SHALL tener uno o más conceptos, hasta el máximo del producto. Cada concepto MUST llevar su causa, una descripción de 1 a 300 caracteres en una sola línea, un importe mayor que cero con hasta dos decimales y un tratamiento de IVA de la factura. La descripción es texto del comprobante y nunca selecciona comportamiento.

#### Scenario: Nota sin conceptos
- **WHEN** un usuario intenta emitir una nota sin ningún concepto
- **THEN** la vista previa muestra el problema y el sistema no permite emitir la nota

#### Scenario: Importe en cero o negativo
- **WHEN** un concepto lleva el importe `0.00` o `-5.00`
- **THEN** el sistema rechaza el concepto indicando su posición, y no reserva número

#### Scenario: Importe con más de dos decimales
- **WHEN** una solicitud envía un concepto con el importe `10.005` o como número en lugar de texto decimal
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Descripción vacía o de varias líneas
- **WHEN** un concepto lleva una descripción vacía, de más de 300 caracteres o con un salto de línea
- **THEN** el sistema rechaza el concepto con un error de validación

#### Scenario: Descripción que no cambia el comportamiento
- **WHEN** la descripción de un concepto de costos posteriores dice "interés por mora"
- **THEN** el concepto conserva la causa elegida y sus importes no cambian

### Requirement: Tratamiento de IVA de la factura
Cada concepto SHALL usar uno de los tratamientos de IVA (código, código de porcentaje y tarifa) congelados en el snapshot de la factura modificada, con sus referencias fiscales. Es el IVA aplicado al comprobante original, nunca el vigente en la fecha de la nota, el del catálogo actual, el del producto ni el del tercero. Una factura con varias tarifas MUST NOT reducirse a una tarifa global: cada concepto elige la suya.

#### Scenario: Tarifa histórica conservada
- **WHEN** una factura se autorizó con IVA del 12 % y después se emite una nota de débito, aunque el catálogo vigente tenga otra tarifa
- **THEN** la nota aplica el 12 % de la factura

#### Scenario: Tratamiento que la factura no tenía
- **WHEN** una solicitud asigna a un concepto un tratamiento de IVA que no está en la factura
- **THEN** el sistema rechaza el concepto indicando su posición, y no reserva número

#### Scenario: Factura con varias tarifas
- **WHEN** la factura tiene IVA del 15 % y del 0 %, y un usuario prepara un concepto en cada uno
- **THEN** cada concepto conserva su tratamiento y la nota lleva un impuesto por cada tratamiento usado

#### Scenario: No objeto y exento
- **WHEN** la factura tiene IVA del 0 %, no objeto de IVA y exento de IVA, y la nota usa los tres
- **THEN** la nota los conserva como tres tratamientos distintos, cada uno con su código de porcentaje, sin agruparlos

#### Scenario: Opciones del borrador
- **WHEN** un usuario elige el tratamiento de un concepto
- **THEN** el borrador ofrece solo los tratamientos de la factura, nunca una tarifa vigente que la factura no tenía

### Requirement: Cálculo de los importes de la nota de débito
Los importes de una nota de débito SHALL salir de un solo cálculo versionado, con decimal exacto:

- cada concepto conserva su base exacta;
- las bases se suman por tratamiento;
- el impuesto de cada tratamiento se materializa una vez, con HALF_UP a dos decimales, sobre su base total;
- el subtotal es la suma de las bases;
- el valor total es el subtotal más los impuestos.

La vista previa, el snapshot, el XML y el RIDE MUST mostrar exactamente ese resultado, sin recalcularlo.

#### Scenario: Un concepto
- **WHEN** la nota tiene un concepto de 100.00 con IVA del 15 %
- **THEN** la base es 100.00, el IVA 15.00 y el valor total 115.00

#### Scenario: Varios conceptos de una tarifa
- **WHEN** la nota tiene tres conceptos de 0.10 con IVA del 15 %
- **THEN** la base del tratamiento es 0.30, su IVA 0.05 (HALF_UP de 0.045) y el valor total 0.35

#### Scenario: Misma base con otra partición
- **WHEN** dos notas tienen, en el mismo tratamiento, conceptos de 0.10, 0.10 y 0.10, y un concepto de 0.30
- **THEN** ambas tienen la misma base y el mismo impuesto en ese tratamiento

#### Scenario: Varias tarifas
- **WHEN** la nota tiene conceptos de 50.00 al 15 %, 20.00 al 0 % y 10.00 al 5 %
- **THEN** los impuestos son 7.50, 0.00 y 0.50, el subtotal 80.00 y el valor total 88.00

#### Scenario: Decimales internos
- **WHEN** un concepto de 33.33 lleva IVA del 15 %
- **THEN** el impuesto es 5.00 (HALF_UP de 4.9995)

#### Scenario: Importes coherentes en todas las vistas
- **WHEN** se compara la vista previa, el snapshot, el XML firmado y el RIDE de una nota
- **THEN** las bases por concepto, las bases y los impuestos por tratamiento, el subtotal y el valor total son idénticos

#### Scenario: Total fuera del límite del esquema
- **WHEN** la suma de los conceptos excede los dígitos que el XSD admite para un importe
- **THEN** el sistema rechaza la nota antes de reservar número

### Requirement: Forma de pago de la nota de débito
Una nota de débito SHALL llevar exactamente una forma de pago, obligatoria, elegida por el usuario entre las del catálogo fiscal vigentes y habilitadas para su empresa en la fecha de la reserva. Su total MUST ser exactamente el valor total de la nota. La ficha técnica exige los pagos en la nota de débito; que sea una sola es una política del MVP del proyecto. El XML y el RIDE muestran la forma de pago congelada al reservar.

#### Scenario: Forma de pago elegida
- **WHEN** un usuario elige una forma de pago vigente y habilitada para una nota de 115.00
- **THEN** la nota lleva esa forma de pago por 115.00, el mismo total en la vista previa, el snapshot, el XML y el RIDE

#### Scenario: Sin forma de pago
- **WHEN** un usuario intenta emitir una nota sin forma de pago
- **THEN** el sistema rechaza la emisión: la nota no queda reservada, no consume secuencial y no recibe clave de acceso

#### Scenario: Forma de pago no vigente o deshabilitada
- **WHEN** la forma de pago elegida no existe, no está vigente en la fecha de la reserva o está deshabilitada para la empresa
- **THEN** el sistema rechaza la nota antes de reservar número

#### Scenario: Código o etiqueta del cliente
- **WHEN** una solicitud envía un código libre, una etiqueta o un importe para la forma de pago
- **THEN** el sistema rechaza la solicitud con un error de validación

#### Scenario: Varias formas de pago
- **WHEN** una solicitud envía más de una forma de pago
- **THEN** el sistema la rechaza con un error de validación, porque el MVP admite una sola

#### Scenario: Catálogo cambiado después de reservar
- **WHEN** la denominación o la vigencia de la forma de pago cambian en el catálogo después de reservar una nota
- **THEN** el XML y el RIDE de la nota llevan el código, la denominación y el total congelados al reservar

### Requirement: Declaración sobre la factura comercial negociable
Antes de reservar una nota de débito, el usuario SHALL declarar que la factura no es una factura comercial negociable efectivamente negociada (`NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE`), requisito oficial del artículo 16; sin la declaración vigente no se emite. La nota la guarda con su versión, el actor y el momento, como declarada por el usuario y nunca como verificada por el sistema. Una comprobación automática futura prevalecería sobre ella.

#### Scenario: Declaración presente
- **WHEN** un usuario emite una nota de débito con la declaración vigente
- **THEN** la nota guarda la versión, la afirmación, el usuario y el momento como declarados por el usuario

#### Scenario: Declaración faltante o de otra versión
- **WHEN** un usuario intenta emitir una nota sin la declaración, o con una versión anterior
- **THEN** el sistema rechaza la emisión sin reservar número

#### Scenario: Declaración presentada como declarada
- **WHEN** un usuario consulta una nota de débito emitida
- **THEN** la declaración aparece como declarada por el usuario que emitió, nunca como comprobada por el sistema

### Requirement: Sin plazo de emisión
El sistema MUST NOT imponer un plazo para emitir una nota de débito: las fuentes oficiales revisadas no establecen un plazo de emisión que este sistema deba imponer. No es una garantía de que no exista; si aparece una fuente oficial, se propone con OpenSpec.

#### Scenario: Factura antigua
- **WHEN** un usuario prepara una nota de débito para una factura autorizada hace más de doce meses
- **THEN** el sistema no la rechaza por la antigüedad de la factura

### Requirement: Borrador y vista previa de la nota de débito
Un usuario SHALL preparar la nota en un borrador: la factura, los conceptos con su causa, descripción, importe y tratamiento, la forma de pago y el punto de emisión. La vista previa, recalculada por el servidor, muestra los conceptos, sus tratamientos, las bases y los impuestos por tratamiento, el valor total y los problemas que bloquean. El borrador no reserva número.

#### Scenario: Vista previa
- **WHEN** un usuario guarda un borrador con dos conceptos en tratamientos distintos
- **THEN** la vista previa muestra cada concepto con su tratamiento, la base y el impuesto de cada tratamiento y el valor total

#### Scenario: Problema que bloquea
- **WHEN** el borrador tiene un concepto sin importe o con un tratamiento que la factura no tenía
- **THEN** la vista previa lista el problema junto al concepto y la emisión queda bloqueada

#### Scenario: Versión del borrador
- **WHEN** un usuario emite con una versión del borrador que otro cambio ya reemplazó
- **THEN** el sistema rechaza la emisión indicando que el borrador cambió, sin reservar número

### Requirement: Editor de la nota de débito
El editor SHALL presentar, en este orden, la factura que se modifica, el establecimiento y el punto
de emisión, los conceptos y la forma de pago. El establecimiento y el punto SHALL elegirse en dos
selectores lado a lado, y el punto solo entre los del establecimiento elegido. Un concepto nuevo
SHALL empezar con la causa de intereses de mora elegida, en un control de dos opciones que ocupa todo
el ancho; su descripción SHALL escribirse en un área de texto que muestra cuántos de los 300
caracteres lleva y que no admite saltos de línea; su importe y su tratamiento de IVA SHALL ocupar la
fila en tres cuartos y un cuarto. «Agregar concepto» SHALL ocupar todo el ancho, y quitar un concepto
SHALL ir en rojo. Los importes SHALL mostrarse con «$», y el valor total en verde.

#### Scenario: Concepto nuevo
- **WHEN** un operador agrega un concepto
- **THEN** el concepto nuevo tiene elegida la causa de intereses de mora, y puede cambiarla a costos o gastos posteriores

#### Scenario: Punto de otro establecimiento
- **WHEN** un operador cambia el establecimiento por uno con dos puntos de emisión
- **THEN** el punto anterior deja de estar elegido y el selector de puntos ofrece solo los dos del establecimiento elegido

#### Scenario: Descripción en una línea
- **WHEN** un operador pulsa Enter o pega un texto con saltos de línea en la descripción
- **THEN** la descripción sigue en una sola línea

### Requirement: Comprobante de la nota de débito
La nota de débito SHALL ser un comprobante propio (tipo 05, versión 1.0.0) con su secuencial, independiente de los de las facturas y las notas de crédito, su clave de acceso y su snapshot. Lleva los datos del emisor vigentes al reservar, el comprador de la factura, el tipo, número y fecha de la factura modificada, un motivo por concepto con su descripción y su base, los impuestos por tratamiento, el valor total y la forma de pago.

#### Scenario: Numeración propia
- **WHEN** un usuario emite la primera nota de débito de un punto que ya emitió 40 facturas y 3 notas de crédito
- **THEN** la nota recibe el número 000000001 de ese punto, y la siguiente factura sigue en 41

#### Scenario: Documento modificado en el comprobante
- **WHEN** se firma una nota de débito
- **THEN** su XML indica el tipo 01, el número y la fecha de emisión de la factura, y valida contra el XSD oficial de la nota de débito antes y después de firmar

#### Scenario: Comprador de la factura
- **WHEN** el tercero de la factura cambió su razón social después de facturar
- **THEN** la nota lleva el comprador tal como figura en la factura

### Requirement: Reserva de la nota de débito sin efectos parciales
Antes de reservar, el sistema SHALL comprobar la factura, el consumidor final, las causas, las descripciones, los importes, los tratamientos, la forma de pago, la declaración, el cálculo y la preparación de la empresa y del esquema, sin consumir nada. La reserva crea después, en una sola operación, el secuencial, el código numérico, la clave, el snapshot, el comprobante reservado y su auditoría. Si cualquier paso falla, no queda nada de eso. No hay comunicación externa dentro de esa operación.

#### Scenario: Rechazo antes de reservar
- **WHEN** una emisión se rechaza por la factura, el consumidor final, un concepto, la forma de pago, la declaración o la preparación de la empresa
- **THEN** no se consume secuencial, no se crea clave ni comprobante, no se firma y no se llama al SRI

#### Scenario: Fallo dentro de la reserva
- **WHEN** la reserva de una nota falla después de reservar su secuencial y antes de confirmarse
- **THEN** no queda número consumido, clave, comprobante, snapshot ni auditoría

#### Scenario: Firma fuera de la reserva
- **WHEN** una nota se reserva y después su firma falla
- **THEN** la nota sigue reservada, como cualquier comprobante reservado, y un reintento la firma con su mismo número y su misma clave

### Requirement: Datos congelados en la nota de débito
Desde su reserva, la nota SHALL contener en su snapshot la factura modificada con su autorización, su comprador y sus tratamientos de IVA con sus referencias fiscales; los conceptos y el resultado del cálculo con su versión; la forma de pago con su referencia de catálogo; la declaración; el emisor, el punto, el secuencial, la clave y las versiones. Su XML, su RIDE y su consulta nunca reconstruyen datos desde la factura, el producto, el tercero, el catálogo o la tarifa vigentes.

#### Scenario: Catálogo cambiado después de reservar
- **WHEN** después de reservar una nota cambia la tarifa vigente del catálogo y se completa la firma
- **THEN** el XML firmado lleva los tratamientos y los importes del snapshot

#### Scenario: Declaración fuera del XML
- **WHEN** se firma una nota de débito
- **THEN** su XML no lleva la declaración del usuario, que no forma parte del comprobante

### Requirement: Emisión idempotente de la nota de débito
La emisión SHALL exigir una `Idempotency-Key` y registrar, por empresa, operación y clave, la huella canónica de la solicitud, que cubre el borrador, su versión, la declaración con su versión y los datos funcionales de la nota. La misma clave con la misma huella devuelve la misma nota, y la misma clave con otra huella se rechaza. El registro no vence.

#### Scenario: Doble envío
- **WHEN** un usuario envía dos veces la misma emisión con la misma clave, una después de la otra o a la vez
- **THEN** existe una sola nota con un solo número, y ambas respuestas la devuelven

#### Scenario: Repetición después de reservar
- **WHEN** la primera emisión quedó reservada sin firmar y el usuario la repite con la misma clave
- **THEN** el sistema devuelve la misma nota y reanuda su firma, sin reservar otro número

#### Scenario: Clave reutilizada
- **WHEN** un usuario reutiliza la clave con otro borrador, otra versión, otra declaración u otros conceptos
- **THEN** el sistema rechaza la solicitud con un conflicto, sin reservar número

#### Scenario: Sin clave
- **WHEN** una emisión llega sin `Idempotency-Key`
- **THEN** el sistema la rechaza sin reservar número

### Requirement: Capacidad acreditable e inventario sin cambios
Una nota de débito SHALL ser un documento complementario separado. No cambia la capacidad acreditable de su factura, que sigue siendo la del documento original, y una nota de crédito MUST NOT tener una nota de débito como documento sustento. La nota de débito no registra movimientos de inventario en ningún estado.

#### Scenario: Capacidad acreditable intacta
- **WHEN** una factura de 100.00 recibe una nota de débito de 20.00 que se autoriza
- **THEN** la factura sigue con 100.00 acreditables y una anulación total sigue acreditando 100.00

#### Scenario: Nota de crédito contra una nota de débito
- **WHEN** un usuario intenta preparar una nota de crédito para una nota de débito
- **THEN** la nota de débito no aparece entre las facturas elegibles y la solicitud responde que la factura no existe

#### Scenario: Sin movimientos de inventario
- **WHEN** una nota de débito se autoriza, se devuelve o queda no autorizada contra una factura con productos con inventario
- **THEN** no se registra ningún movimiento de inventario y ningún saldo cambia

### Requirement: Consulta de notas de débito
Un usuario autorizado SHALL listar, buscar y ver las notas de débito de su empresa. El detalle muestra:

- el estado y la factura modificada;
- cada concepto con su causa, descripción, importe y tratamiento;
- las bases y los impuestos por tratamiento, el valor total y la forma de pago;
- la declaración, como declarada por el usuario;
- la transmisión y los documentos.

#### Scenario: Detalle de una nota
- **WHEN** un usuario abre una nota de débito autorizada
- **THEN** ve su número, la factura modificada, los conceptos con sus causas y tratamientos, los totales, la forma de pago y la declaración

#### Scenario: Búsqueda
- **WHEN** un usuario busca por el número de la nota o por el comprador
- **THEN** la lista contiene solo las notas que coinciden, paginadas

### Requirement: Reintento de firma de una nota de débito
Un usuario con permiso SHALL poder reintentar la firma de una nota de débito reservada. El reintento firma la nota con su mismo número, su misma clave y su mismo snapshot.

#### Scenario: Reintento de firma
- **WHEN** un usuario reintenta la firma de una nota reservada cuya firma falló
- **THEN** la nota queda firmada con su mismo número y su misma clave

### Requirement: Permisos de notas de débito
Administradores y operadores SHALL poder consultar, preparar, emitir y reintentar la firma de notas de débito. Solo el administrador SHALL poder pedir su reconciliación manual. Cada operación exige su permiso en el servidor antes de leer o escribir.

#### Scenario: Operador que emite
- **WHEN** un operador emite una nota de débito
- **THEN** el sistema la emite

#### Scenario: Operador que reconcilia
- **WHEN** un operador pide la reconciliación de una nota de débito
- **THEN** el sistema responde prohibido

#### Scenario: Sin permiso o sin sesión
- **WHEN** un usuario sin el permiso o sin sesión intenta preparar, emitir o consultar una nota de débito
- **THEN** el sistema responde prohibido o no autenticado, sin leer ni escribir

### Requirement: Aislamiento de las notas de débito por empresa
Las notas de débito, sus borradores y sus facturas SHALL pertenecer a una empresa. La empresa sale siempre de la sesión, y un usuario de otra empresa no puede leer, cambiar ni detectar una nota, un borrador ni una factura ajena.

#### Scenario: Nota de otra empresa
- **WHEN** un usuario consulta, reintenta o reconcilia una nota de débito de otra empresa
- **THEN** el sistema responde que no existe, igual que para una nota inexistente

#### Scenario: Factura de otra empresa
- **WHEN** un usuario prepara una nota de débito con el identificador de una factura de otra empresa
- **THEN** el sistema responde que la factura no existe, sin revelar que existe en otra empresa

#### Scenario: Empresa en el cuerpo
- **WHEN** una solicitud envía un `companyId` en el cuerpo
- **THEN** el sistema la rechaza por contener campos no permitidos

### Requirement: Borradores en la lista de notas de débito
La lista de notas de débito SHALL mostrar, con el filtro de estado en «Todos», primero los borradores de
nota de débito de la empresa, el último editado arriba, y después los comprobantes emitidos en su orden de
siempre, en la misma tabla, la misma paginación y el mismo total que entrega el servidor. Cada
borrador SHALL mostrar el estado «Borrador», el comprador o el número de la factura modificada, su total previo o «Incompleto» y la fecha de su última edición, y SHALL
abrir su editor desde la fila y poder eliminarse con confirmación. El filtro de estado SHALL ofrecer
«Borradores», que muestra solo los borradores; un estado de nota emitida o una causa SHALL excluirlos. La búsqueda SHALL
encontrar también los borradores por lo que muestran. Solo quien puede preparar borradores de
nota de débito SHALL verlos. Ninguna otra pantalla de la lista SHALL repetir los borradores en un panel aparte.

#### Scenario: Borradores arriba
- **WHEN** la empresa tiene dos borradores de nota de débito y treinta comprobantes emitidos, y un operador abre Notas de débito con 25 filas por página
- **THEN** la primera página muestra los dos borradores con el estado «Borrador» y después 23 comprobantes emitidos, y la lista indica 32 en total

#### Scenario: Solo borradores
- **WHEN** un operador elige el estado «Borradores»
- **THEN** ve solo los borradores de nota de débito de su empresa, paginados, y ningún comprobante emitido

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
- **WHEN** otra empresa de la instalación tiene borradores de nota de débito
- **THEN** ninguno aparece en la lista ni cuenta en su total
