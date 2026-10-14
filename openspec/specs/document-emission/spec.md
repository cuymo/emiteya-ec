# document-emission Specification

## Purpose

Emitir localmente un comprobante electrónico hasta su artefacto firmado: validación completa antes
de reservar, reserva atómica con snapshot inmutable, XML validado contra el XSD registrado, firma,
idempotencia durable y recuperación, sin depender del SRI.

## Requirements

### Requirement: Validación completa antes de reservar
El sistema SHALL comprobar todas las condiciones funcionales de un comprobante antes de reservar su secuencial: preparación para emitir de la empresa, punto de emisión disponible, firma utilizable, datos y referencias del comprobante, límites del esquema, casos especiales y esquema registrado. Si alguna falla, MUST rechazar la emisión sin reservar número, crear clave de acceso, bloquear la identidad tributaria ni crear el comprobante.

#### Scenario: Firma no utilizable
- **WHEN** un usuario emite un comprobante y la firma electrónica de la empresa está vencida
- **THEN** el sistema rechaza la emisión indicando que la firma no es utilizable
- **AND** el siguiente comprobante emitido en ese punto recibe el número que habría recibido este

#### Scenario: Punto de emisión desactivado
- **WHEN** un usuario emite un comprobante en un punto de emisión desactivado
- **THEN** el sistema rechaza la emisión y no se reserva ningún número

#### Scenario: Empresa sin datos tributarios
- **WHEN** un usuario de una empresa sin datos tributarios registrados intenta emitir
- **THEN** el sistema rechaza la emisión y la identidad tributaria sigue sin bloquear

#### Scenario: Esquema no disponible
- **WHEN** el XSD registrado del comprobante, o uno de sus imports, falta o no coincide con su hash
- **THEN** el sistema rechaza la emisión antes de reservar e indica que el esquema no está disponible

### Requirement: Fecha de emisión capturada una vez
La fecha de emisión SHALL ser la fecha actual en America/Guayaquil, capturada una sola vez al comenzar la creación fiscal. Esa misma fecha MUST usarse para resolver vigencias, la política de consumidor final, la clave de acceso y el XML. El usuario no elige una fecha anterior ni posterior; es una restricción de producto del MVP.

#### Scenario: Noche en Ecuador, día siguiente en UTC
- **WHEN** un usuario emite a las 22:30 del 3 de octubre de 2026 en Ecuador, que ya es 4 de octubre en UTC
- **THEN** la fecha de emisión es el 3 de octubre de 2026 en el comprobante, en la clave de acceso y en el XML

#### Scenario: Fecha no seleccionable
- **WHEN** una solicitud de emisión incluye una fecha de emisión
- **THEN** el sistema rechaza la solicitud por contener un campo no permitido

### Requirement: Comprobante reservado de forma atómica
Al superar la validación, el sistema SHALL crear en una sola transacción el comprobante en estado reservado, con su snapshot, su secuencial definitivo, su clave de acceso y la identidad tributaria de la empresa bloqueada. Ningún comprobante reservado existe sin esos elementos. La reserva no se revierte y su número nunca se reutiliza.

#### Scenario: Reserva correcta
- **WHEN** un usuario emite un comprobante válido
- **THEN** el comprobante queda reservado con un número `EEE-PPP-SSSSSSSSS` y una clave de acceso de 49 dígitos
- **AND** la identidad tributaria de la empresa queda bloqueada y su RUC ya no puede cambiar

#### Scenario: Fallo dentro de la transacción
- **WHEN** la transacción de reserva falla antes de confirmarse
- **THEN** no existe el comprobante, el número no queda reservado y la identidad tributaria no cambia

#### Scenario: Número de un comprobante reservado
- **WHEN** un comprobante reservado no llega a firmarse
- **THEN** su número no vuelve al contador y el siguiente comprobante recibe el número siguiente

### Requirement: Snapshot inmutable como fuente de verdad
El snapshot SHALL contener todo lo necesario para reproducir el XML: datos fiscales del emisor, establecimiento, punto, ambiente, comprador, líneas, descripciones, importes materializados, referencias y tarifas fiscales resueltas, formas de pago, resultado del consumidor final, casos especiales, fecha de emisión, componentes de la clave y versiones aplicadas. Contiene también, por línea, la decisión de si afecta al inventario, tomada al reservar. En una nota de crédito contiene además la factura modificada (identificador, tipo, número, fecha, clave y autorización), la causa, el motivo, la línea de la factura a la que se liga cada línea, el retorno físico declarado y las declaraciones del usuario. En una nota de débito contiene además la factura modificada (identificador, tipo, número, fecha, clave, y número, fecha y ambiente de la autorización), los tratamientos de IVA de la factura con sus referencias fiscales, cada concepto con su causa, su descripción, su importe y su tratamiento, el resultado del cálculo con su versión, la forma de pago y la declaración del usuario. Desde la reserva MUST ser inmutable y el comprobante no vuelve a leer datos de la empresa, terceros, productos, inventario ni catálogos.

#### Scenario: Producto cambiado después de reservar
- **WHEN** un administrador cambia el precio de un producto de un comprobante ya reservado y después se completa la firma
- **THEN** el XML firmado lleva el precio del snapshot, no el nuevo

#### Scenario: Empresa cambiada después de reservar
- **WHEN** un administrador corrige la dirección matriz después de reservar un comprobante
- **THEN** el comprobante y su XML conservan la dirección con la que se reservó

#### Scenario: Intento de modificar el snapshot
- **WHEN** cualquier operación intenta cambiar el snapshot, el número, la clave o la fecha de un comprobante reservado
- **THEN** el sistema lo impide y el comprobante no cambia

#### Scenario: Decisión de inventario de cada línea
- **WHEN** se reserva una factura con una línea de un producto con inventario activo y otra de un servicio
- **THEN** el snapshot indica que la primera línea afecta al inventario y la segunda no, y esa decisión no cambia aunque después cambien el producto o su inventario

#### Scenario: XML sin la decisión de inventario
- **WHEN** se firma una factura cuyo snapshot lleva la decisión de inventario
- **THEN** el XML firmado es el mismo que sin esa decisión: el inventario no forma parte del comprobante

#### Scenario: Nota de crédito y su factura
- **WHEN** se reserva una nota de crédito
- **THEN** su snapshot guarda la factura modificada, la causa, las líneas ligadas a las de la factura, el retorno físico y las declaraciones, y el XML se reproduce solo desde ese snapshot

#### Scenario: Retorno físico y declaraciones fuera del XML
- **WHEN** se firma una nota de crédito con retorno físico declarado
- **THEN** su XML no lleva el retorno físico ni las declaraciones: no forman parte del comprobante

#### Scenario: Nota de débito y su factura
- **WHEN** se reserva una nota de débito
- **THEN** su snapshot guarda la factura modificada, sus tratamientos de IVA, los conceptos, el resultado del cálculo, la forma de pago y la declaración, y el XML se reproduce solo desde ese snapshot

### Requirement: Clave de acceso
La clave de acceso SHALL tener 49 dígitos compuestos desde el snapshot: fecha `ddmmaaaa`, tipo, RUC, ambiente, establecimiento, punto, secuencial de nueve dígitos, código numérico de 8 dígitos de un generador criptográfico, tipo de emisión normal y dígito verificador módulo 11. MUST calcularse una sola vez, en la reserva, y nunca regenerarse.

#### Scenario: Composición de la clave
- **WHEN** se reserva un comprobante
- **THEN** su clave de acceso empieza por la fecha de emisión, el tipo y el RUC, termina en un dígito verificador módulo 11 correcto y coincide con la del XML

#### Scenario: Reintento con la misma clave
- **WHEN** se reintenta llegar a la firma de un comprobante reservado
- **THEN** el comprobante conserva su clave de acceso y su número

### Requirement: XML validado contra el esquema registrado
El sistema SHALL construir el XML del comprobante solo desde su snapshot, con la versión de esquema registrada y soportada, y MUST validarlo contra ese XSD y todos sus imports. El paquete de esquemas se empaqueta con la aplicación y se verifica completo al arrancar: si falta un archivo requerido o su hash no coincide, el sistema no se declara listo. Nunca descarga esquemas ni usa los de un tercero, y nunca firma un XML inválido.

#### Scenario: XML válido
- **WHEN** se construye el XML de un comprobante reservado
- **THEN** el XML valida contra el XSD registrado de su tipo y versión antes de firmarse

#### Scenario: Paquete de esquemas incompleto al arrancar
- **WHEN** al arrancar falta un XSD requerido o su import, o su hash no coincide con el registro
- **THEN** el sistema no se declara listo para atender y registra qué archivo falla, sin descargarlo ni sustituirlo

#### Scenario: Validación saturada
- **WHEN** las validaciones simultáneas y su cola están llenas
- **THEN** el intento termina con un diagnóstico de servicio ocupado reintentable y el comprobante sigue reservado

### Requirement: Comprobante firmado con su artefacto exacto
El sistema SHALL firmar el XML válido con la firma electrónica utilizable de la empresa, comprobar que el certificado embebido es el de esa firma y volver a validar el XML firmado. MUST persistir los bytes exactos firmados, su SHA-256, tamaño, tipo, versiones de esquema y de firmador, y hashes de los XSD, en la misma operación atómica que deja el comprobante firmado. Nunca existe un comprobante firmado sin su artefacto, y el artefacto no cambia ni se regenera.

#### Scenario: Firma correcta
- **WHEN** un comprobante reservado se firma con éxito
- **THEN** queda firmado con un artefacto cuyo SHA-256 coincide con sus bytes y cuyo XML valida contra el XSD

#### Scenario: Artefacto inmutable
- **WHEN** cualquier operación intenta cambiar o borrar el artefacto firmado de un comprobante
- **THEN** el sistema lo impide y los bytes siguen siendo los mismos

#### Scenario: Firmado sin artefacto
- **WHEN** una operación intenta dejar un comprobante como firmado sin persistir su artefacto
- **THEN** el sistema rechaza el cambio y el comprobante sigue reservado

### Requirement: Idempotencia durable de la emisión
Cada emisión SHALL exigir una `Idempotency-Key`, con alcance empresa, operación y clave, y guardar la huella canónica de la solicitud. La misma clave con la misma solicitud MUST devolver el mismo comprobante y, si está reservado, reanudarlo hasta la firma; con otra solicitud responde `409 IDEMPOTENCY_KEY_REUSED`. Ninguna repetición, simultánea o no, reserva otro número. El registro no expira durante la vida fiscal del comprobante.

#### Scenario: Repetición de la misma solicitud
- **WHEN** un cliente repite una emisión ya firmada con la misma clave y la misma solicitud
- **THEN** el sistema devuelve el mismo comprobante firmado y no reserva ningún número

#### Scenario: Repetición de un comprobante reservado
- **WHEN** un cliente repite con la misma clave una emisión que quedó reservada sin firmar
- **THEN** el sistema reanuda ese comprobante hacia la firma con su mismo número y su misma clave de acceso

#### Scenario: Misma clave con otra solicitud
- **WHEN** un cliente reutiliza una clave de idempotencia para emitir otro borrador
- **THEN** el sistema responde `409 IDEMPOTENCY_KEY_REUSED` y el otro borrador sigue sin emitir

#### Scenario: Dos solicitudes simultáneas con la misma clave
- **WHEN** llegan a la vez dos emisiones con la misma clave y la misma solicitud
- **THEN** existe un solo comprobante con un solo número reservado, y ambas respuestas lo identifican

#### Scenario: Emisión sin clave
- **WHEN** un cliente emite sin `Idempotency-Key`
- **THEN** el sistema rechaza la solicitud y no ejecuta la emisión

#### Scenario: Misma clave en otra empresa
- **WHEN** usuarios de dos empresas usan la misma clave de idempotencia
- **THEN** cada empresa obtiene su propio comprobante y ninguna ve el de la otra

### Requirement: Recuperación de un comprobante reservado
Si construir, validar, firmar o persistir falla después de reservar, el comprobante SHALL seguir reservado, sin estado de error, con el diagnóstico del último intento separado del estado fiscal: etapa, código tipado, fecha, número de intentos y si es reintentable o determinista, sin secretos. Un reintento autorizado MUST reutilizar comprobante, snapshot, número y clave. El sistema no reintenta por su cuenta.

#### Scenario: Servicio de firma ocupado
- **WHEN** la firma de un comprobante reservado no se completa porque el servicio criptográfico está saturado
- **THEN** el comprobante sigue reservado con un diagnóstico reintentable de la etapa de firma
- **AND** un reintento posterior lo deja firmado con el mismo número y la misma clave

#### Scenario: Firma que deja de ser utilizable
- **WHEN** la firma de la empresa vence entre la reserva y la firma de un comprobante
- **THEN** el comprobante sigue reservado con un diagnóstico determinista de firma no utilizable
- **AND** tras cargar una firma vigente, un reintento lo firma sin reservar otro número

#### Scenario: Caída del proceso
- **WHEN** el proceso termina después de confirmar la reserva y antes de firmar
- **THEN** el comprobante sigue reservado, y un reintento o la repetición con la misma clave lo lleva a la firma

#### Scenario: Reintentos simultáneos
- **WHEN** llegan a la vez dos reintentos del mismo comprobante reservado
- **THEN** el comprobante queda firmado una sola vez, con un solo artefacto

#### Scenario: Sin reintentos automáticos
- **WHEN** un intento falla con un diagnóstico determinista
- **THEN** el sistema no vuelve a intentarlo por su cuenta y el diagnóstico queda visible hasta un reintento autorizado

### Requirement: Registro de transiciones
Cada transición de estado de un comprobante SHALL registrarse en la misma transacción con el estado anterior y el nuevo, la fecha, la causa, el actor y metadatos técnicos no sensibles. El registro es de solo agregado.

#### Scenario: Transiciones de una emisión
- **WHEN** un comprobante se reserva y después se firma
- **THEN** su historial tiene la creación en reservado y el paso a firmado, cada uno con su fecha, causa y actor

#### Scenario: Historial inmutable
- **WHEN** cualquier operación intenta cambiar o borrar una transición registrada
- **THEN** el sistema lo impide

### Requirement: Emisión local sin el SRI
La emisión SHALL terminar en el comprobante firmado con su artefacto persistido, sin llamar al SRI. El envío, la recepción, la autorización y la reconciliación pertenecen a la transmisión.

#### Scenario: Emisión sin conexión con el SRI
- **WHEN** un comprobante se emite sin acceso a los servicios del SRI
- **THEN** llega a firmado con su artefacto y su estado no depende de ninguna respuesta del SRI

### Requirement: Casos especiales no soportados
El sistema SHALL rechazar antes de reservar una emisión que requiere un caso especial que la matriz vigente no soporta, ya sea por un atributo de la operación o por una condición declarada del emisor. Nunca la degrada a un comprobante ordinario. El rechazo usa un único código de caso especial no soportado que identifica el anexo, y no consume secuencial, clave de acceso, snapshot, movimiento de inventario ni trabajo de transmisión.

#### Scenario: Anexo 26 aplicable y no soportado
- **WHEN** la empresa declara un RUC proveedor distinto del suyo, porque usa un sistema de un tercero (anexo 26), y un usuario emite una factura, una liquidación de compra, una nota de crédito, una nota de débito, una guía de remisión o un comprobante de retención
- **THEN** el sistema rechaza la emisión antes de reservar e identifica el anexo 26 como caso especial no soportado

#### Scenario: Anexo 26 que no corresponde
- **WHEN** la empresa no declara un RUC proveedor, o declara su propio RUC
- **THEN** el anexo 26 no aplica y la emisión no se rechaza por él

#### Scenario: Anexo 24 aplicable y no soportado
- **WHEN** la empresa se declara gran contribuyente (anexo 24) y un usuario emite una factura, una liquidación de compra, una nota de crédito o una nota de débito
- **THEN** el sistema rechaza la emisión antes de reservar e identifica el anexo 24 como caso especial no soportado

#### Scenario: Anexo 24 en los comprobantes que no alcanza
- **WHEN** la empresa se declara gran contribuyente y un usuario emite una guía de remisión o un comprobante de retención
- **THEN** el anexo 24 no aplica a esos comprobantes y la emisión no se rechaza por él

#### Scenario: Anexo 24 que no corresponde
- **WHEN** la empresa no se declara gran contribuyente
- **THEN** el anexo 24 no aplica y la emisión no se rechaza por él

#### Scenario: Rechazo sin efectos fiscales
- **WHEN** una emisión se rechaza por un caso especial no soportado, y el usuario la repite
- **THEN** cada intento responde el mismo rechazo
- **AND** ningún secuencial se consume, no existe comprobante reservado, clave de acceso, snapshot, movimiento de inventario, trabajo de transmisión ni intento de envío al SRI, y el borrador sigue sin emitir

#### Scenario: Condición de otra empresa
- **WHEN** la empresa A se declara gran contribuyente o declara un RUC proveedor de un tercero, y un usuario de la empresa B, que no los declara, emite un comprobante
- **THEN** la emisión de la empresa B no se rechaza por los anexos 24 ni 26

### Requirement: Tipos de comprobante que el sistema emite
El sistema SHALL emitir la factura 1.1.0, la liquidación de compra 1.1.0, la nota de crédito 1.1.0, la nota de débito 1.0.0, la guía de remisión 1.1.0 y el comprobante de retención 2.0.0, cada uno con su esquema registrado, su construcción del XML desde el snapshot y su secuencial independiente por ambiente, establecimiento, punto y tipo. Los seis siguen la misma reserva, firma, idempotencia, recuperación y registro de transiciones. Un tipo sin construcción propia no se emite.

#### Scenario: Secuenciales independientes
- **WHEN** un punto emite una factura, después una liquidación de compra, después una nota de crédito, después una nota de débito, después un comprobante de retención, después una guía de remisión y después otra factura
- **THEN** las facturas tienen los secuenciales 1 y 2, y la liquidación, cada nota, la retención y la guía el 1 de su propio contador

#### Scenario: Firma de una nota de crédito
- **WHEN** se firma una nota de crédito reservada
- **THEN** queda firmada con su artefacto, validado contra el XSD de la nota de crédito, como una factura

#### Scenario: Firma de una nota de débito
- **WHEN** se firma una nota de débito reservada
- **THEN** queda firmada con su artefacto de tipo 05, validado contra el XSD de la nota de débito antes y después de firmar, como una factura

#### Scenario: Factura sin cambios
- **WHEN** se emite una factura después de este cambio
- **THEN** su XML, su snapshot, su firma y su artefacto son los mismos que antes, para los mismos datos

#### Scenario: Nota de crédito sin cambios
- **WHEN** se emite una nota de crédito después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Firma de un comprobante de retención
- **WHEN** se firma un comprobante de retención reservado
- **THEN** queda firmado con su artefacto de tipo 07, validado contra el XSD del comprobante de retención antes y después de firmar, como una factura

#### Scenario: Nota de débito sin cambios
- **WHEN** se emite una nota de débito después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Firma de una guía de remisión
- **WHEN** se firma una guía de remisión reservada
- **THEN** queda firmada con su artefacto de tipo 06, validado contra el XSD de la guía de remisión antes y después de firmar, como una factura

#### Scenario: Comprobante de retención sin cambios
- **WHEN** se emite un comprobante de retención después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Firma de una liquidación de compra
- **WHEN** se firma una liquidación de compra reservada
- **THEN** queda firmada con su artefacto de tipo 03, validado contra el XSD de la liquidación de compra antes y después de firmar, como una factura

#### Scenario: Guía de remisión sin cambios
- **WHEN** se emite una guía de remisión después de este cambio
- **THEN** su XML, su snapshot, su firma, su artefacto y su RIDE son los mismos que antes, para los mismos datos

#### Scenario: Tipo no emitido
- **WHEN** una solicitud intenta emitir un tipo de comprobante que el sistema no construye, como una nota de venta
- **THEN** no existe una operación para hacerlo

### Requirement: Snapshot del comprobante de retención
El snapshot de un comprobante de retención SHALL contener, además del emisor, el punto, el ambiente, la fecha de emisión, la clave y las versiones, el sujeto retenido, la declaración de parte relacionada, el período fiscal, cada documento sustento con sus impuestos y pagos, y cada retención con su entrada de catálogo, su versión, su base, su porcentaje y su valor, con la versión del cálculo. Desde la reserva MUST ser inmutable, y el XML se reproduce solo desde él.

#### Scenario: Retención y sus documentos
- **WHEN** se reserva un comprobante de retención con dos documentos sustento
- **THEN** su snapshot guarda cada documento con sus impuestos, sus pagos y sus retenciones, y el XML se reproduce solo desde ese snapshot

#### Scenario: Declaraciones fuera del XML
- **WHEN** se firma un comprobante de retención
- **THEN** su XML lleva `parteRel` como dato del comprobante, pero no el actor ni el momento de la declaración, que solo guarda el snapshot

### Requirement: Snapshot de la guía de remisión
El snapshot de una guía de remisión SHALL contener, además del emisor, el punto, el ambiente, la fecha de emisión, la clave y las versiones, la partida con su establecimiento de origen si lo hay, el transportista con su origen, la placa, las fechas del transporte y cada destinatario con su identificación, su dirección, su establecimiento de destino si lo hay, su motivo, su ruta, su código de destino, su sustento (la factura con sus datos o la excepción declarada con su caso, su versión, su actor y su momento) y su detalle. Desde la reserva MUST ser inmutable.

#### Scenario: Guía y sus destinatarios
- **WHEN** se reserva una guía con dos destinatarios, uno con factura y otro con una excepción declarada
- **THEN** su snapshot guarda cada destinatario con su sustento y su detalle, y el XML se reproduce solo desde ese snapshot

#### Scenario: Declaraciones fuera del XML
- **WHEN** se firma una guía con una excepción declarada
- **THEN** su XML no lleva la excepción, el actor ni el momento de la declaración, que solo guarda el snapshot

### Requirement: Comprobante sin total monetario ni receptor único
Una guía de remisión SHALL guardarse sin total monetario y sin un receptor que la represente: no tiene importe y puede tener varios destinatarios. Su ausencia de total MUST NOT representarse como 0.00, ni su receptor como el primero de sus destinatarios. La factura, la liquidación de compra, las notas y el comprobante de retención MUST seguir guardándose con su total y su receptor; el receptor de la liquidación de compra es su proveedor, como contraparte del comprobante.

#### Scenario: Guía sin total
- **WHEN** se reserva una guía de remisión
- **THEN** el comprobante no tiene total, ni siquiera 0.00, y no tiene un receptor único

#### Scenario: Guía con un solo destinatario
- **WHEN** se reserva una guía con un solo destinatario
- **THEN** el comprobante tampoco guarda a ese destinatario como su receptor: lo guarda como su único destinatario

#### Scenario: Los demás tipos siguen exigiendo su total
- **WHEN** cualquier operación intenta guardar una factura, una nota o un comprobante de retención sin total o sin receptor
- **THEN** el sistema lo impide

#### Scenario: Una guía no admite total
- **WHEN** cualquier operación intenta guardar una guía de remisión con un total o un receptor único
- **THEN** el sistema lo impide

### Requirement: Snapshot de la liquidación de compra
El snapshot de una liquidación de compra SHALL congelar al reservar el emisor, el establecimiento y el punto; el proveedor con su identificación, su nombre y su dirección; la procedencia con las cuatro declaraciones del usuario, su actor y su momento; las líneas con su producto opcional, sus datos y su IVA con la referencia de su catálogo; los importes y la versión del cálculo; los pagos con su plazo y su unidad de tiempo; la moneda; y la numeración y la clave. El XML y el RIDE salen solo de él.

#### Scenario: XML desde el snapshot
- **WHEN** se firma una liquidación de compra reservada después de corregir su proveedor y su producto
- **THEN** su XML lleva los datos congelados al reservar

#### Scenario: Declaraciones fuera del XML
- **WHEN** se construye el XML de una liquidación de compra
- **THEN** el snapshot conserva las cuatro declaraciones, y el XML no las contiene
