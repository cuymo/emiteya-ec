# Spec Delta

## Purpose

Emitir localmente un comprobante electrónico hasta su artefacto firmado: validación completa antes
de reservar, reserva atómica con snapshot inmutable, XML validado contra el XSD registrado, firma,
idempotencia durable y recuperación, sin depender del SRI.

## ADDED Requirements

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
El snapshot SHALL contener todo lo necesario para reproducir el XML: datos fiscales del emisor, establecimiento, punto, ambiente, comprador, líneas, descripciones, importes materializados, referencias y tarifas fiscales resueltas, formas de pago, resultado del consumidor final, casos especiales, fecha de emisión, componentes de la clave y versiones aplicadas. Desde la reserva MUST ser inmutable y el comprobante no vuelve a leer datos de la empresa, terceros, productos ni catálogos.

#### Scenario: Producto cambiado después de reservar
- **WHEN** un administrador cambia el precio de un producto de un comprobante ya reservado y después se completa la firma
- **THEN** el XML firmado lleva el precio del snapshot, no el nuevo

#### Scenario: Empresa cambiada después de reservar
- **WHEN** un administrador corrige la dirección matriz después de reservar un comprobante
- **THEN** el comprobante y su XML conservan la dirección con la que se reservó

#### Scenario: Intento de modificar el snapshot
- **WHEN** cualquier operación intenta cambiar el snapshot, el número, la clave o la fecha de un comprobante reservado
- **THEN** el sistema lo impide y el comprobante no cambia

### Requirement: Clave de acceso
La clave de acceso SHALL tener 49 dígitos compuestos desde el snapshot: fecha `ddmmaaaa`, tipo, RUC, ambiente, establecimiento, punto, secuencial de nueve dígitos, código numérico de 8 dígitos de un generador criptográfico, tipo de emisión normal y dígito verificador módulo 11. MUST calcularse una sola vez, en la reserva, y nunca regenerarse.

#### Scenario: Composición de la clave
- **WHEN** se reserva un comprobante
- **THEN** su clave de acceso empieza por la fecha de emisión, el tipo y el RUC, termina en un dígito verificador módulo 11 correcto y coincide con la del XML

#### Scenario: Reintento con la misma clave
- **WHEN** se reintenta llegar a la firma de un comprobante reservado
- **THEN** el comprobante conserva su clave de acceso y su número

### Requirement: XML validado contra el esquema registrado
El sistema SHALL construir el XML del comprobante solo desde su snapshot, con la versión de esquema registrada y soportada, y MUST validarlo contra ese XSD y todos sus imports, empaquetados con la aplicación y verificados por hash. Nunca descarga esquemas ni usa los de un tercero, y nunca firma un XML que no valida. Con la validación saturada responde ocupado.

#### Scenario: XML válido
- **WHEN** se construye el XML de un comprobante reservado
- **THEN** el XML valida contra el XSD registrado de su tipo y versión antes de firmarse

#### Scenario: Esquema alterado después de reservar
- **WHEN** el archivo de un XSD registrado deja de coincidir con su hash después de reservar un comprobante
- **THEN** el comprobante sigue reservado, sin firmar, con el diagnóstico de esquema no disponible

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
El sistema SHALL rechazar antes de reservar una emisión que requiere un caso especial que la matriz vigente no soporta, ya sea por un atributo de la operación o por una condición declarada del emisor. Nunca la degrada a un comprobante ordinario.

#### Scenario: Condición del emisor no implementada
- **WHEN** la empresa declara un RUC proveedor (anexo 26) y un usuario emite un comprobante
- **THEN** el sistema rechaza la emisión antes de reservar e identifica el caso especial no soportado
