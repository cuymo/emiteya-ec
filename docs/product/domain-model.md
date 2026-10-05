# Modelo de dominio

Conceptos, invariantes y reglas de negocio del facturador. Fuentes:

- `ERS`: `project-requirements.md`. Alcance y requisitos del producto.
- `CTX`: `project-sri-integration.md`. Reglas técnicas del SRI y decisiones de integración.

Ante una duda técnica del SRI prevalecen las fuentes oficiales en el orden de CTX §1:
norma, resoluciones, XSD, ficha técnica, WSDL y guías. Las reglas (`BR-xx`) citan su origen.
El comportamiento observable se especifica en `openspec/specs/` mediante cambios OpenSpec;
la mecánica de emisión está en `../architecture/fiscal-emission.md`; las decisiones
pendientes (`Q-xx`) están en `open-questions.md`.

## Subdominios

| Subdominio               | Tipo     | Responsabilidad                                                                   | Fuentes                                   |
| ------------------------ | -------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| Emisión de comprobantes  | Núcleo   | Borradores, emisión, ciclo de vida fiscal y los seis flujos documentales.         | ERS RF-006..010, RF-201..253; CTX §12–17  |
| Motor fiscal             | Núcleo   | Mapper fiscal, XML por tipo y versión, clave de acceso, XSD, firma y RIDE.         | ERS SRI-REQ-02..05; CTX §8, §10, §19, §20 |
| Orquestación SRI         | Núcleo   | Recepción, autorización, reintentos y reconciliación por clave; la consulta de validez para anulaciones es futura (Q-16). | ERS SRI-REQ-06..10; CTX §22–27, §33, §34  |
| Numeración fiscal        | Núcleo   | Secuenciales atómicos y únicos.                                                   | ERS RF-120..125; CTX §5, §28              |
| Configuración tributaria | Soporte  | Empresa, ambiente, establecimientos, puntos y certificado.                        | ERS RF-101..135; CTX §5, §6, §20          |
| Catálogos                | Soporte  | Terceros, productos y catálogos fiscales versionados.                             | ERS RF-301..323; CTX §9, §18              |
| Inventario mínimo        | Soporte  | Stock opcional contabilizado por hechos fiscales autorizados (no reserva de disponibilidad), movimientos y kárdex. | ERS RF-205, RF-206, RF-212, RF-310..315   |
| Archivo y entrega        | Soporte  | Bandeja, artefactos inmutables con hash, entrega al receptor.                     | ERS RF-401..409; CTX §31, §45, §46        |
| Reportes                 | Soporte  | Listados filtrables y exportación XLSX.                                           | ERS RF-501..505                           |
| Identidad y auditoría    | Genérico | Usuarios, roles y rastro de auditoría.                                            | ERS RF-001..003, SEC-001, SEC-007         |

## Entidades

### `company` — Empresa

- Purpose: contribuyente emisor. Es el tenant de todos los datos privados (ADR 0009).
- Key attributes: RUC, razón social, nombre comercial, dirección matriz, teléfono, correo, logo (asset inmutable referenciado por la versión de configuración, ADR 0017), ambiente activo, identidad tributaria bloqueada (`taxIdentityLocked`), anticipación de la alerta de vencimiento de firma (guardada con la firma en `signing_certificate_settings`, 30 días por defecto), y atributos tributarios: obligado a llevar contabilidad, número de contribuyente especial, número de resolución de agente de retención (XSD `agenteRetencion`, no un sí o no; C-10), gran contribuyente, categoría RIMPE, RUC proveedor (CTX §5).
- Invariants:
  - Una empresa por instalación en el MVP, sin impedir multiempresa futuro (ERS §4.1).
  - Los atributos tributarios los declara el administrador; el sistema no los infiere (ERS RF-103).
  - El RUC proveedor queda vacío salvo que la instalación lo requiera; nunca se llena con un valor ficticio (CTX §37.1, Q-37).
  - Cada cambio de configuración genera una versión nueva, que los comprobantes referencian en su snapshot (CTX §39).
  - El RUC se corrige mientras la identidad tributaria no esté bloqueada; una vez bloqueada (`taxIdentityLocked`), es inmutable para esa empresa, y otro contribuyente exige otra empresa. El cambio de emisión fija la transición que bloquea, como máximo al crear el primer artefacto fiscal que deba conservarse (Q-31).
  - Todo cambio de datos tributarios o de ambiente deja auditoría con valores anteriores y nuevos (ERS RF-105, SEC-007).
- Relationships: tiene establecimientos, certificados, membresías de usuario, terceros, productos y comprobantes.

### `establishment` — Establecimiento

- Purpose: local registrado en el SRI.
- Key attributes: código, dirección, activo.
- Invariants: código de exactamente tres dígitos, único por empresa e inmutable tras el alta (ERS RF-110, RF-112). Editarlo es corregir su dirección. Se desactiva, no se elimina.
- Relationships: pertenece a una empresa; tiene puntos de emisión.

### `emission_point` — Punto de emisión

- Purpose: punto desde el que se emiten comprobantes.
- Key attributes: código, activo. Sin nombre ni descripción: ninguna fuente los pide.
- Invariants: código de exactamente tres dígitos, único por establecimiento e inmutable tras el alta, como su establecimiento (ERS RF-111, RF-112). Editarlo es activarlo o desactivarlo. Está disponible para emitir solo si él y su establecimiento están activos. Desactivar un punto impide emitir desde él, sin afectar sus comprobantes.
- Relationships: pertenece a un establecimiento; tiene una secuencia por tipo de comprobante.

### `fiscal_sequence` — Secuencia fiscal

- Purpose: contador que asigna el secuencial de cada comprobante.
- Key attributes: ambiente, establecimiento, punto de emisión, tipo de comprobante, siguiente valor y último número reservado.
- Invariants:
  - Un contador independiente por ambiente, establecimiento, punto y tipo (ERS RF-120, ADR 0003, Q-02). Cambiar de ambiente no comparte ni reinicia ninguna secuencia.
  - La unicidad del secuencial incluye el ambiente: `(empresa, ambiente, establecimiento, punto, tipo, secuencial)` (CTX §5).
  - Valor entre `1` y `999999999`, representado con nueve dígitos (ERS RF-124, CTX §8.2). Tras reservar el `999999999` el contador queda agotado y no se reinicia.
  - Mientras no existe, se comporta como un contador en `1` sin reservas; se crea con su primera reserva o su primer ajuste.
  - La reserva es atómica en todos los procesos e instancias (ERS RF-122, RNF-003, CTX §28). Un número está reservado cuando la operación que lo reserva se confirma; si se revierte antes, no lo está.
  - Un secuencial reservado nunca vuelve al contador ni se reutiliza; los huecos se toleran, y la integridad depende de la unicidad y la trazabilidad, no de la continuidad (CTX §27.3, §28.1).
  - El siguiente valor siempre supera al último reservado.
  - Solo un administrador ajusta el siguiente valor; retrocederlo exige una operación explícita con motivo, y todo ajuste se audita (ERS RF-121, RF-125).
- Relationships: pertenece a un punto de emisión; registra cada número reservado como reserva de secuencial, que referenciará el comprobante.

### `certificate` — Certificado de firma

- Purpose: referencia segura a la firma electrónica del contribuyente.
- Key attributes: titular, emisor, número de serie, huella, vigencia (`notBefore`, `notAfter`), RUC detectado, estado (`ACTIVE`, `REPLACED`) y una referencia al secreto, que se guarda aparte (ADR 0011). La vigencia (vigente, por vencer, vencido) se calcula al leer.
- Invariants:
  - Archivo PKCS#12 y contraseña cifrados en reposo; nunca vuelven al navegador ni aparecen en logs, respuestas o backups sin cifrar (ERS RF-131, RF-132, SEC-002; CTX §20.4; ADR 0011).
  - Como máximo un certificado activo por empresa.
  - Antes de aceptarlo y antes de cada firma: abre con la contraseña, contiene clave privada, `notBefore <= ahora <= notAfter` y su cadena puede procesarse (CTX §20.6).
  - Identidad (Q-17): sin un RUC detectable, el certificado es incompatible y no firma. Con un RUC distinto del de la empresa firma, con una advertencia preventiva de la aplicación.
  - Reemplazarlo elimina el secreto anterior y conserva el historial de metadatos.
- Relationships: pertenece a una empresa; firma comprobantes.

### `user` / `membership` — Usuario y rol

- Purpose: acceso a la aplicación.
- Key attributes: cuenta de Better Auth, rol (`ADMIN` u `OPERATOR`), punto de emisión predeterminado (del que se deriva el establecimiento predeterminado; lo elige cada usuario y solo preselecciona, Q-23), activo.
- Invariants:
  - El rol se lee de la membresía en el servidor, nunca de la petición (ERS SEC-005).
  - Los usuarios se desactivan, no se eliminan; sus comprobantes y auditoría persisten (ERS RF-409).
  - Nadie cambia su propio rol.
- Relationships: membresía en una empresa; crea comprobantes y eventos de auditoría.

### `party` — Tercero

- Purpose: persona u organización reutilizable en cualquier rol (ERS RF-320).
- Key attributes: tipo y número de identificación, razón social o nombres, dirección, correo, teléfono, roles opcionales y combinables (`CUSTOMER`, `SUPPLIER`, `CARRIER`), estado (`ACTIVE`/`INACTIVE`), `systemRecord` y versión.
- Invariants:
  - Identificación única por empresa, tipo y número, también con terceros desactivados.
  - Se valida con la regla de formato del catálogo de tipos de identificación vigente; ningún RUC se rechaza por un algoritmo local único (ERS RF-322, CTX §9.1). El tipo `07` está reservado al consumidor final.
  - Ningún rol es obligatorio: un tercero existe antes de recibir un uso. Los roles clasifican y filtran.
  - Se desactiva y se reactiva; nunca se borra. Se corrige solo a partir de la versión consultada.
  - El consumidor final (`systemRecord: CONSUMER_FINAL`, `07` / `9999999999999`, razón social de la política vigente al crearlo) existe exactamente uno por empresa: se crea con la empresa, nadie lo edita, desactiva ni borra, y se reconoce por su marca, nunca por su texto. No guarda el monto máximo, que es política fiscal.
  - Editar un tercero no altera los comprobantes emitidos (BR-21).
- Relationships: aparece como comprador, proveedor, transportista, destinatario o sujeto retenido.

### `product` — Producto o servicio

- Purpose: ítem facturable.
- Key attributes: código principal, código auxiliar, nombre, descripción interna, tipo (`GOOD`/`SERVICE`), precio unitario sin impuestos, referencias fiscales, `stockTracked`, estado y versión.
- Invariants:
  - Código principal único por empresa cuando existe (ERS RF-301), también con productos desactivados. El XSD decide si es obligatorio en cada caso (CTX §12.4).
  - El precio unitario es un decimal exacto sin impuestos, con la escala de `precioUnitario` (`decimal-policy.md`).
  - Refiere exactamente una tarifa de IVA, como mucho un ICE y como mucho un IRBPNR, por la identidad de la entrada (`catalogType`, `entryKey`); nunca copia una tarifa (CTX §12.5).
  - Un servicio no lleva control de stock ni IRBPNR; el estado final de cada corrección lo cumple. Antes de inicializar su inventario, administradores y operadores cambian `stockTracked` desde la corrección del producto; después, solo un administrador lo cambia desde el inventario (`add-minimal-inventory`, design D11).
  - Su estado tributario (`READY`, `REVIEW_REQUIRED`, `INCOMPLETE`) se deriva de sus referencias en una fecha y nunca se guarda.
  - Se desactiva y se reactiva; nunca se borra.
- Relationships: aparece en líneas de comprobante; tiene movimientos de inventario.

### `stock_balance` — Saldo de inventario

- Purpose: existencias contabilizadas de un producto con inventario inicializado (`add-minimal-inventory`, design D2).
- Key attributes: empresa y producto (su clave), saldo, posición del último movimiento, fecha y persona de la inicialización.
- Invariants:
  - Existe solo desde la inicialización, que es única; sin él, el producto no tiene saldo, nunca cero.
  - Es el saldo después de su último movimiento y, con la cadena de movimientos, la suma exacta de las variaciones de su kárdex; los triggers de la base lo comprueban al confirmar.
  - Cambia solo con un movimiento, por una actualización atómica; no hay ruta para fijarlo ni recalcularlo. Nunca se borra.
  - Puede ser negativo (Q-19).
- Relationships: pertenece a un producto; tiene sus movimientos.

### `stock_movement` — Movimiento de inventario

- Purpose: variación de existencias de un producto controlado.
- Key attributes: producto, posición, tipo, variación con signo, saldo resultante, momento, origen (usuario o sistema), actor, comprobante de origen y su número, motivo o nota, y la clave de idempotencia con la huella de su solicitud en las entradas y los ajustes.
- Invariants:
  - Inmutable: no se edita ni se borra; se corrige con un ajuste compensatorio (ERS RF-313).
  - Referencia el comprobante, el usuario y el origen cuando existen (ERS RF-312).
  - El signo depende del tipo: `INICIAL` cero o más, `ENTRADA_MANUAL` y `DEVOLUCION_NC` positivos, `SALIDA_FACTURA` negativo y `AJUSTE` distinto de cero con motivo.
  - Un solo `INICIAL` por producto, en la posición 1 (Q-21). Cada movimiento sigue al anterior: su saldo resultante es el anterior más su variación.
  - Una sola `SALIDA_FACTURA` por factura y producto, y una sola `DEVOLUCION_NC` por nota de crédito y producto (ERS RF-206, AC-08).
  - Una sola entrada o un solo ajuste por empresa, operación y clave de idempotencia.
- Relationships: pertenece a un saldo y a un producto; opcionalmente a un comprobante.

### `electronic_document` — Comprobante electrónico

- Purpose: cabecera común de los seis tipos (ADR 0002).
- Key attributes: tipo, ambiente, establecimiento, punto, secuencial, número, clave de acceso, código numérico, fecha de emisión, receptor o sujeto, totales, estado fiscal, usuario y fecha de creación (ERS RF-008), número y fecha de autorización, clave de idempotencia y metadatos del snapshot: versión XSD, versión del builder, versión de catálogos, versión de configuración de la empresa y versión del renderer del RIDE (CTX §39).
- Invariants:
  - Nace en `RESERVED`, ya con secuencial y clave de acceso: los campos que la componen (fecha, tipo, RUC, ambiente, serie, secuencial, código numérico) quedan fijos desde ese momento (CTX §8, §27.1). El borrador (`invoice_draft`) no es un estado fiscal: vive aparte y pasa a `EMITTED` en la misma transacción que crea el comprobante (ERS RF-010, design D2 de `add-invoice-emission`).
  - Su snapshot versionado (`snapshotVersion` 2 en la factura desde `add-minimal-inventory`; los guardados con la versión 1 se leen igual) guarda el emisor, el comprador, las líneas con sus impuestos, los pagos, los totales, la clave y las versiones de esquema, builder y catálogos. La factura de `add-invoice-emission` guarda ahí sus líneas, impuestos y pagos, y el documento solo copia en columnas lo que se consulta: número, clave, comprador y total.
  - Desde `SIGNED`, el contenido de un comprobante que llegó al SRI no se edita; las correcciones siguen el flujo documental (ERS RF-009). La única excepción es el reenvío corregido de un comprobante devuelto, con la misma clave y secuencial (BR-28).
  - Cambia de estado solo mediante la máquina de estados, y cada transición queda registrada (ERS RF-524, RF-525).
  - La clave de acceso es única y coincide con los datos del XML (CTX §61, I-01..I-08).
  - Un comprobante autorizado nunca se borra (CTX §36.1, I-18).
- Relationships: tiene líneas, pagos, detalles de impuestos, relaciones documentales, intentos SRI, artefactos, entregas e historial de estados.

Datos propios de cada tipo. El contrato definitivo es el XSD oficial de la versión; esta
tabla es un mapa funcional (ERS §8, CTX §63):

| Tipo                     | XSD inicial (Q-13) | Contraparte                                     | Datos propios                                                                                                   |
| ------------------------ | ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Factura                  | 1.1.0              | Comprador o consumidor final hasta el monto vigente | Líneas con impuestos, descuentos, propina, totales, formas de pago.                                          |
| Liquidación de compra    | 1.1.0              | Proveedor identificado; nunca consumidor final  | Líneas con impuestos, totales, formas de pago.                                                                   |
| Nota de crédito          | 1.1.0              | El comprador de la factura modificada, identificado | Documento modificado (tipo, número, fecha), causa (`TOTAL_ANNULMENT` o `RETURN`), motivo, valor de la modificación, líneas ligadas a las de la factura, retorno físico por línea y declaraciones de elegibilidad del usuario. |
| Nota de débito           | 1.0.0              | El comprador de la factura modificada, identificado | Documento modificado (tipo, número, fecha), conceptos con su causa legal, descripción, base y tratamiento de IVA de la factura, impuestos por tratamiento, pagos cuando corresponda y la declaración del usuario sobre la factura comercial negociable. |
| Guía de remisión         | 1.1.0              | Destinatarios                                   | Transportista, placa, dirección de partida, fechas de inicio y fin del traslado, destinatarios con motivo, destino, documento sustento y detalle. |
| Comprobante de retención | 2.0.0 (ATS)        | Sujeto retenido identificado                    | Periodo fiscal, documentos sustento con sus impuestos, retenciones y pagos.                                      |

### `document_line` — Línea de comprobante

- Purpose: bien o servicio de un comprobante.
- Key attributes: producto (opcional), código principal, código auxiliar, descripción, cantidad, precio unitario, descuento, precio total sin impuesto, impuestos.
- Invariants: copia los datos del producto al emitir. En la factura, el precio unitario es el del producto y se congela en el snapshot; modificarlo por línea es una decisión futura (Q-45). El ingreso manual de una línea sin producto (ERS RF-202) no está soportado: es un requisito fuente diferido (Q-46, `capabilities.md`). En la nota de crédito, cada línea conserva una relación interna estable con una línea de la factura original, aunque el XML no lleve ese vínculo, y sus importes e impuestos salen del snapshot de esa factura, nunca del producto, del tercero ni del catálogo vigentes.

### `document_relation` — Relación documental

- Purpose: vínculo con el documento modificado, los documentos sustento o los comprobantes relacionados.
- Key attributes: tipo de relación, tipo de comprobante, número completo, fecha de emisión y, si existe en el sistema, el comprobante interno.
- Invariants: es una referencia estructurada, nunca texto libre (CTX §13.2, §16.6). Puede apuntar a un comprobante emitido fuera del sistema, como la factura de un proveedor en una retención. En las notas de crédito y de débito del MVP, el documento modificado es siempre una factura emitida por el sistema, de la misma empresa y del mismo ambiente, y autorizada; un documento sustento externo es la capacidad futura `external-supporting-documents` (Q-10).

### `tax_detail` — Detalle de impuesto o retención

- Purpose: impuesto o retención aplicado a una línea, a un documento sustento o al comprobante.
- Key attributes: código de impuesto (IVA `2`, ICE `3`, IRBPNR `5`; en retenciones: renta `1`, IVA `2`, ISD `6`), código de porcentaje o de retención, base, tarifa, valor (CTX §12.5, §16.4).
- Invariants: códigos y porcentajes vigentes en el catálogo fiscal a la fecha que corresponda, que en notas de crédito y débito puede ser la del documento sustento (CTX §13.4, §14.3); se copian al comprobante.

### `payment` — Pago

- Purpose: formas de pago exigidas por el esquema (ERS RF-204). El ERS §13 no la lista; se añade.
- Key attributes: código de forma de pago del catálogo fiscal, total, plazo, unidad de tiempo.
- Invariants: el código se elige del catálogo vigente; nunca se deduce de texto libre (CTX §12.6).

### `invoice_draft` — Borrador de factura

- Purpose: preparar una factura antes de emitirla, sin efecto fiscal (ERS RF-010).
- Key attributes: empresa, versión, punto de emisión, comprador, líneas (producto, cantidad y descuento, sin precio), pagos (forma de pago e importe opcional), estado (`DRAFT` o `EMITTED`), comprobante emitido, autor y fechas.
- Invariants:
  - No consume secuencial ni clave, y puede estar incompleto: su vista previa del servidor lista todos los problemas que impedirían emitir.
  - Cada edición exige la versión esperada; un conflicto de versión no sobrescribe.
  - Solo se elimina en `DRAFT`. Al emitirse, un trigger lo vuelve inmutable, con sus líneas y pagos.
  - Admite hasta `INVOICE_MAX_LINES` líneas (100 por defecto), un límite de recursos de la aplicación, no del SRI.

### `sri_attempt` — Intento SRI

- Purpose: evidencia de cada llamada al SRI (ERS RF-408, CTX §32).
- Key attributes: identificador, comprobante, job, operación (`RECEPTION`, `AUTHORIZATION` o `VALIDITY`), número de intento por comprobante, origen (`AUTOMATIC` o `MANUAL`, con quién lo pidió), ambiente y endpoint, inicio, cabeceras y fin, clase del resultado del transporte, metadatos HTTP seguros, hash y tamaño del sobre y del XML enviado. La respuesta original es `sri_response`; la clasificación, con todos los mensajes del SRI (identificador, mensaje, información adicional, tipo) y la versión del clasificador, es `sri_attempt_result`.
- Invariants:
  - solo se agrega;
  - la respuesta original se persiste antes de clasificarla, en otra transacción, y la transición de estado va con la clasificación;
  - conserva todos los mensajes, incluidos los códigos desconocidos;
  - no contiene secretos;
  - el SOAP original nunca va a los logs ni a la auditoría;
  - no usa `document_artifact`, que admite un solo artefacto por tipo (decisión del 2026-10-03 para `add-sri-transmission`).

### `artifact` — Artefacto

- Purpose: archivo probatorio de un comprobante (ERS RF-404, RF-405, RF-407; CTX §31).
- Key attributes: comprobante, tipo (`SIGNED_XML`, `AUTHORIZED_XML` y `RIDE_PDF`), hash SHA-256, tamaño, referencia de almacenamiento interna. El `AUTHORIZED_XML` es el XML que devolvió el SRI y nunca reemplaza al `SIGNED_XML`. Las respuestas originales del SRI pertenecen a su intento (`sri_attempt`).
- Invariants: se escribe una vez y no cambia; el XML autorizado se extrae de la respuesta del SRI, nunca se reconstruye (CTX §45); nunca se borra en cascada (ERS §13.1, ADR 0010).
- El XML autorizado (lo recibido) nunca reemplaza al XML firmado (lo enviado). Los dos se verifican por hash, y la autorización guarda de forma inmutable su número, su fecha y el ambiente confirmado.
- El RIDE (`RIDE_PDF`, `add-document-archive`) se genera una sola vez después de la autorización, desde el `AUTHORIZED_XML` o, si el SRI autorizó sin devolverlo, desde el `SIGNED_XML` transmitido; su procedencia (`AUTHORIZED_XML` o `SIGNED_XML_FALLBACK`) y las versiones con que se generó quedan en sus metadatos. Nunca se regenera.
- En `add-invoice-emission`: `document_artifact` con el tipo `SIGNED_XML`, los bytes UTF-8 exactos en `BYTEA`, su SHA-256 y tamaño, y metadatos con la versión y los hashes del esquema, la versión del builder y del firmador y la huella del certificado. Un comprobante `SIGNED` no existe sin su artefacto (trigger diferido).

### `document_delivery_event` — Entrega

- Purpose: rastro de las acciones de entrega de los documentos de un comprobante que el sistema puede observar (CTX §46; Q-24, resuelta el 2026-10-04). Es su única fuente de verdad: no se duplica en la auditoría.
- Key attributes: comprobante, evento, actor, momento, correlación de la petición y el artefacto (tipo y SHA-256), nunca su contenido. El evento identifica también el canal: la aplicación.
- Eventos del MVP:
  - `DOWNLOAD`: la aplicación inició una respuesta autorizada de descarga con el artefacto, después de verificar su integridad. No significa que el cliente terminó de recibirlo o de guardarlo;
  - `PRINT_REQUESTED`: un usuario pidió imprimir el RIDE, con una acción explícita (`POST /documents/{id}/print-requests`); ninguna lectura del RIDE la registra. Para imprimir, la interfaz pide después el mismo RIDE, que deja además su `DOWNLOAD`.
- Invariants:
  - nunca se registra `PRINTED` ni `DELIVERED_TO_RECIPIENT`: el sistema no puede demostrar que una impresora terminó ni que un tercero recibió el documento. Esto reemplaza el estado `DELIVERED` del modelo de CTX §46;
  - un fallo de entrega no cambia el estado fiscal;
  - una solicitud rechazada por sesión, permiso, empresa, disponibilidad o integridad no deja entrega;
  - es de solo agregado, y el actor no se puede borrar mientras tenga entregas (ERS RF-409);
  - el correo es P1, fuera del MVP. Cuando llegue, sus eventos reflejarán la evidencia real del proveedor (por ejemplo `EMAIL_SUBMITTED`, `EMAIL_ACCEPTED` o `EMAIL_BOUNCED`), detrás de un puerto de notificación.

### `audit_event` — Evento de auditoría

- Purpose: rastro de las acciones críticas (ERS RF-003, RNF-006).
- Key attributes: actor (usuario o proceso del sistema), acción, recurso, valores antes/después redactados, momento, identificador de correlación, resultado.
- Invariants: solo se agrega; se escribe en la misma transacción que la acción.

### `fiscal_catalog_entry` — Entrada de catálogo fiscal

- Purpose: códigos oficiales del SRI con vigencia (ERS RF-234, SRI-REQ-12; CTX §18).
- Key attributes: identidad estable `(catálogo, entryKey)` y código fiscal visible; por versión, descripción oficial, vigente desde/hasta con el origen de la fecha de inicio (`SOURCE_STATED`, declarada por la fuente, o `PROJECT_BASELINE`, publicación de la fuente, que no es una fecha legal), documento fuente, versión de la fuente, estado normativo (`OFFICIAL`, `OFFICIAL_REFERENCE`, `WITHDRAWN`) y los atributos propios de cada catálogo (la semántica de una tarifa de IVA, ICE o IRBPNR, la regla de formato de un tipo de identificación). La habilitación por empresa es un dato aparte, de la empresa.
- Invariants: son datos del sistema distribuidos con cada release, no datos de la empresa (ADR 0020). Un cambio normativo crea entradas o versiones nuevas; nunca sobrescribe lo necesario para reproducir comprobantes ni exige cambiar el código fuente (CTX §16.4, §55). El administrador solo habilita o deshabilita entradas para su empresa; no crea ni modifica códigos, descripciones, tarifas ni vigencias. El código no es identidad: la ficha repite códigos con denominaciones distintas (tabla 18), y cada fila es una entrada propia. La versión aplicable en una fecha la resuelve una única operación, y tiene un identificador estable que un comprobante guarda para reproducirla. Catálogos mínimos en CTX §18; los tipos de comprobante, el ambiente y el tipo de emisión son constantes estructurales del protocolo (CTX §56), no catálogos.

### `consumer_final_policy` — Política de consumidor final

- Purpose: límite vigente para facturar sin identificar al comprador (CTX §35).
- Key attributes: monto máximo, identidad canónica del consumidor final (tipo `07`, identificación `9999999999999`, razón social `CONSUMIDOR FINAL`), vigente desde con su base, fuente normativa.
- Invariants: versionada como un catálogo; al corte vale USD 50 (ficha v2.34, numeral 9.10) y debe revisarse en cada actualización normativa. Es un dato de `fiscal-catalogs`; el tercero del sistema que la usa en cada empresa lo crea `add-parties-and-products`.

### `schema_registry_entry` — Esquema registrado

- Purpose: XSD oficial disponible para emitir (CTX §3.1, §19.3).
- Key attributes: tipo de comprobante, raíz XML, versión, archivo, hash SHA-256, origen, fecha de descarga, vigencia, soportado por la aplicación.
- Invariants: si el XSD no existe, su hash no coincide o la versión no está registrada, el comprobante no se envía (CTX §19.2). Los XSD antiguos se conservan (CTX §53).

### `special_case_support` — Soporte de caso especial

- Purpose: declarar qué anexos de la ficha soporta la versión instalada (CTX §38).
- Key attributes: anexo, tema, categoría (`CORE`, `CONDITIONAL_ISSUER_RULE`, `CONDITIONAL_GO_LIVE`, `NOT_APPLICABLE`, `OUT_OF_MVP`).
- Invariants: una operación que requiere un caso no soportado se rechaza de forma explícita antes de emitir, con un mensaje funcional, y nunca se degrada a un comprobante ordinario (CTX §38.1, §57). Las condiciones del emisor se declaran, no se infieren. Matriz inicial en el ADR 0014 (Q-38).

### Entidades técnicas añadidas

Las requiere la arquitectura, aunque no son conceptos de negocio:

- registro de idempotencia (`idempotency_record`, Q-30): empresa, operación, clave, huella de la solicitud y comprobante; de solo agregado y sin expiración durante la vida fiscal;
- historial de transiciones de estado (`document_state_transition`): estado anterior y nuevo, causa, actor y metadatos, en la misma transacción que la transición;
- job persistido (`job`, ADR 0012): tipo (`sri.transmit`, `sri.authorize` o `sri.reconcile`), clave de deduplicación, comprobante, estado (`PENDING`, `LEASED`, `DONE` o `STOPPED`), intentos, plazo, arriendo, origen con su solicitante y motivo, y último error. Un solo job `sri.*` activo por comprobante; sus estados no son estados fiscales;
- borrador de nota de crédito (`credit_note_draft` y sus líneas, `add-credit-notes`): factura, punto, causa, motivo y, por posición de la factura, la cantidad (solo en la devolución) y el retorno físico; pasa a `EMITTED` en la misma transacción que crea la nota;
- capacidad acreditable (`credit_capacity` y `credit_capacity_line`): por factura, su total original y lo reservado y aplicado; por línea, la cantidad original, el producto del snapshot y lo reservado y aplicado. Nace con la primera nota de la factura;
- reserva de crédito (`credit_reservation` y sus líneas): la nota, la causa, el valor y, por línea, la cantidad, los importes calculados y el retorno físico; `RESERVED`, `APPLIED` o `RELEASED`, de solo agregado salvo su conclusión;
- capacidad y reserva devolvibles (`stock_return_capacity` y `stock_return_reservation`, de `inventory`): por factura y producto, lo que sacó su salida y lo reservado y aplicado por los retornos físicos de las notas.

Los triggers diferidos comprueban al confirmar que cada capacidad es la suma de sus reservas por
estado, que una reserva corresponde al estado de su nota y que una nota terminal no conserva capacidad
reservada.

Ver `../architecture/fiscal-emission.md`, `../architecture/idempotency.md` y
`../architecture/database.md`.

## Value Objects

| Objeto                   | Validación                                                                                                       | Formato                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `Ruc`                    | 13 dígitos; sin algoritmos locales de rechazo (ERS RF-322, CTX §9.1).                                             | Texto, conserva ceros a la izquierda.       |
| `Identification`         | Tipo del catálogo (`04`..`08`) más número válido para ese tipo.                                                  | Texto.                                      |
| `EstablishmentCode`      | Exactamente tres dígitos.                                                                                        | `EEE`                                       |
| `EmissionPointCode`      | Exactamente tres dígitos.                                                                                        | `PPP`                                       |
| `Sequential`             | Entero `1`–`999999999`.                                                                                          | Nueve dígitos con ceros a la izquierda.     |
| `DocumentNumber`         | Compuesto por los tres anteriores.                                                                               | `EEE-PPP-SSSSSSSSS`                         |
| `NumericCode`            | Ocho dígitos de una fuente aleatoria criptográfica; se genera una vez por comprobante (CTX §8.4).                | Ocho dígitos.                               |
| `AccessKey`              | 48 dígitos de datos más dígito verificador módulo 11; composición y algoritmo en CTX §8.                         | 49 dígitos.                                 |
| `Money`                  | Decimal exacto, nunca coma flotante (ERS RF-007, CTX §10.6).                                                      | Decimales según el XSD del campo concreto.  |
| `Quantity` / `UnitPrice` | Decimal exacto; la versión 1.1.0 admite hasta seis decimales en ciertos campos (CTX §10.6).                      | Según el XSD del campo.                     |
| `Environment`            | Pruebas (`1`) o Producción (`2`).                                                                                | Código en el XML y la clave.                |
| `DocumentType`           | `01`, `03`, `04`, `05`, `06`, `07`.                                                                              | Código de dos dígitos.                      |
| `FiscalPeriod`           | Mes y año válidos.                                                                                               | `MM/AAAA`                                   |
| `IssueDate`              | Fecha actual en la zona horaria de Ecuador, capturada una vez al comenzar la creación fiscal (ERS RNF-010, Q-08).                                              | `dd/mm/aaaa` en el XML, `ddmmaaaa` en la clave. |
| `SriMessage`             | Identificador, mensaje, información adicional y tipo; se conserva aunque el código sea desconocido (CTX §22.2, §32). | Tal como lo entrega el SRI.             |

## Ciclo de vida del comprobante

La generación local y la transmisión al SRI tienen máquinas separadas (Q-35). Las transiciones,
sus disparadores y la reconciliación están en `../architecture/fiscal-emission.md`; las
etiquetas de interfaz, en `glossary.md`.

Estados locales, que define `add-invoice-emission`:

| Estado     | Significado | Terminal |
| ---------- | ----------- | -------- |
| `RESERVED` | Comprobante durable con snapshot, secuencial confirmado, clave de acceso definitiva e identidad tributaria bloqueada, todo de forma atómica. Sin rollback: el número nunca se reutiliza. | No |
| `SIGNED`   | XML construido, válido contra el XSD, firmado y persistido con sus bytes exactos y su hash; listo para envío. | No |

Si falla una etapa entre `RESERVED` y `SIGNED`, el comprobante sigue `RESERVED`: no hay estado
fiscal de error. El diagnóstico del último intento (etapa, código, clase, fecha, número de
intentos y, para un XSD inválido, la línea y el elemento) se guarda aparte del estado. Un
reintento manual retoma la misma factura, con su número y su clave.

Estados de transmisión de `add-sri-transmission`, decididos el 2026-10-03
(`../architecture/fiscal-emission.md`). Son una máquina fiscal separada de los jobs: el envío en
curso y el arriendo son estados del job.

| Estado           | Origen   | Significado                                                       | Terminal |
| ---------------- | -------- | ----------------------------------------------------------------- | -------- |
| `SEND_UNKNOWN`   | ERS, CTX | No se sabe si el SRI recibió el XML, o la respuesta exige reconciliar (43, 45, 70). | Nunca |
| `RECEIVED`       | ERS, CTX | `RECIBIDA`, o el SRI procesa la clave: pendiente de autorización. Agrupa el `PENDING_AUTHORIZATION` de ERS §12.1. | No |
| `AUTHORIZED`     | ERS, CTX | Autorizado, con número, fecha y ambiente guardados.               | Sí |
| `RETURNED`       | ERS, CTX | `DEVUELTA` concluyente. Conserva el comprobante y su número.       | Sin salida en el cambio 7; su corrección es la capacidad futura `correct-returned-document` |
| `NOT_AUTHORIZED` | ERS, CTX | `NO AUTORIZADO` concluyente, o `RECHAZADO`.                       | Sí (Q-07) |
| `MANUAL_REVIEW`  | ERS      | Respuesta inconsistente, error 45 con el secuencial registrado con otra clave, o ventana de conclusión agotada (design D4, Q-06). | No: sale solo con una reconciliación manual concluyente |

- Los errores técnicos recuperables no cambian el estado fiscal: el job reintenta y, si agota sus límites, queda detenido (`STOPPED`), visible para el administrador.
- `CANCEL_PENDING` y `CANCELLED` (CTX §26): pertenecen a la capacidad futura de anulaciones (Q-16).
- `SEND_PENDING` (CTX) no se adopta: el envío en curso es un estado del job.

## Domain Events

Nombres de CTX §62, más los eventos de configuración. No hay bus de eventos: en
`add-invoice-emission`, `FiscalDocumentCreated` y `FiscalSequenceReserved` se registran como la
transición inicial y la auditoría `invoice.reserved`, y `FiscalXmlSigned` como la transición a
`SIGNED` y la auditoría `invoice.signed`. El reintento de la firma audita
`invoice.signing_retried`. En `add-sri-transmission`, cada llamada al SRI queda en `sri_attempt`;
cada cambio de estado, en `document_state_transition` (con la causa `TRANSMISSION`,
`AUTHORIZATION` o `RECONCILIATION`), y la reconciliación pedida por el administrador, en las
auditorías `invoice.reconciliation_requested` e `invoice.reconciliation_completed`. La nota de
crédito (`add-credit-notes`) usa los mismos eventos con sus auditorías `credit_note.reserved` (con
las declaraciones y su versión), `credit_note.signed`, `credit_note.signing_retried`,
`credit_note.reconciliation_requested` y `credit_note.reconciliation_completed`; su conclusión aplica
o libera la reserva de crédito y, al autorizarse, registra la `DEVOLUCION_NC` en la misma
transacción que la transición.

| Evento                       | Disparador                                             | Consumidores                                    |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `FiscalDocumentCreated`      | Se crea el comprobante en `RESERVED`.                  | Auditoría.                                      |
| `FiscalSequenceReserved`     | Reserva atómica exitosa.                               | Auditoría.                                      |
| `FiscalXmlBuilt`             | XML y clave de acceso generados.                       | Validación XSD.                                 |
| `FiscalXmlValidated`         | XML válido contra el XSD.                              | Firma.                                          |
| `FiscalXmlSigned`            | XML firmado persistido con su hash.                    | `add-sri-transmission`.                         |
| `SriSendAttempted`           | Llamada a recepción iniciada.                          | Auditoría, métricas.                            |
| `SriSendUnknown`             | Resultado incierto del envío, o errores 70, 43 y 45.   | Job de reconciliación.                          |
| `SriReceived`                | Recepción `RECIBIDA`.                                  | Job de autorización.                            |
| `SriReturned`                | Recepción `DEVUELTA`.                                  | Bandeja, métricas, liberación de la capacidad de la nota de crédito. |
| `SriAuthorizationPending`    | Autorización en procesamiento.                         | Job de autorización con backoff.                |
| `SriAuthorized`              | Autorización `AUTORIZADO`.                             | RIDE, salida de inventario (Q-18), aplicación del crédito y devolución de la nota de crédito, entrega, auditoría. |
| `SriNotAuthorized`           | Autorización `NO AUTORIZADO`.                          | Bandeja, auditoría, liberación de la capacidad de la nota de crédito. |
| `SriMessageRecorded`         | Mensaje del SRI persistido.                            | Bandeja.                                        |
| `FiscalRideGenerated`        | RIDE generado desde el comprobante autorizado.         | Entrega.                                        |
| `FiscalDocumentDelivered`    | Entrega registrada.                                    | Bandeja.                                        |
| `FiscalReconciled`           | Reconciliación resolvió un estado dudoso.              | Auditoría.                                      |
| `FiscalCancellationPending` / `FiscalCancelled` | La consulta de validez devuelve `PENDIENTE DE ANULAR` o `ANULADO` (Q-16). | Bandeja, reportes. |
| `CertificateExpiring`        | Faltan los días configurados para el vencimiento.      | Alerta en la aplicación.                        |
| `CertificateReplaced`        | Carga de un certificado nuevo.                         | Auditoría.                                      |
| `EnvironmentChanged`         | El administrador cambia el ambiente.                   | Auditoría, aviso persistente de Pruebas.        |
| `SequenceAdjusted`           | El administrador ajusta un secuencial.                 | Auditoría.                                      |
| `TaxProfileChanged`          | Cambio de datos tributarios de la empresa.             | Auditoría, nueva versión de configuración.      |

## Business Rules

Las invariantes técnicas I-01..I-20 de CTX §61 se expresan como tests y restricciones; no
se repiten aquí.

### Configuración

- **BR-01** Una empresa por instalación en el MVP; todo dato privado pertenece a una empresa (ERS §4.1, ADR 0009).
- **BR-02** Los atributos tributarios se declaran, no se infieren; el sistema no determina obligaciones tributarias (ERS RF-103, §4.1).
- **BR-03** La emisión está bloqueada hasta que la empresa esté preparada para emitir: datos obligatorios completos, al menos un establecimiento y un punto activos, certificado vigente que firma y ambiente definido (ERS AC-01, RF-134).
- **BR-04** El ambiente se distingue sin ambigüedad; Pruebas muestra una advertencia persistente; solo un administrador lo cambia, con auditoría; un comprobante conserva el ambiente con que se reservó y se envía solo al endpoint de ese ambiente (ERS RF-004, RF-005, SEC-007; CTX §6, I-09).
- **BR-05** Los códigos de establecimiento y punto tienen exactamente tres dígitos y son únicos en su ámbito (ERS RF-110..112).

### Numeración

- **BR-06** Hay un contador por ambiente, establecimiento, punto y tipo de comprobante, y el secuencial es único también por ambiente (ERS RF-120, ADR 0003, CTX §5, Q-02).
- **BR-07** Los borradores no consumen secuencial; la reserva ocurre al emitir, después de la validación de negocio (ERS RF-010, CTX §4).
- **BR-08** Un secuencial reservado nunca se devuelve ni se reutiliza, y nadie retrocede el contador para reusarlo. Los huecos se toleran (ERS RF-123; CTX §27.3, §28.1).
- **BR-09** Solo un administrador ajusta el siguiente secuencial; retroceder exige una operación explícita, con motivo y auditoría (ERS RF-121, RF-125).

### Firma

- **BR-10** Archivo y contraseña de firma nunca salen del servidor después de cargarse (ERS RF-132, API-004; CTX §20.4).
- **BR-11** No se firma con un certificado vencido, sin clave privada o sin un RUC detectable (ERS RF-134, CTX §20.6, Q-17). Un RUC distinto del de la empresa no bloquea la firma: la aplicación advierte.
- **BR-12** Se alerta con la anticipación configurada antes del vencimiento (ERS RF-135).
- **BR-13** La firma sigue los parámetros vigentes del SRI (XAdES-BES, enveloped, RSA-SHA1 según la ficha v2.34) y no se sustituye por un algoritmo más moderno sin un cambio formal del SRI (CTX §20, ADR 0013).

### Emisión

- **BR-14** Los datos obligatorios se validan antes de firmar o enviar (ERS RF-006).
- **BR-15** Importes, bases, impuestos, descuentos y totales usan aritmética decimal exacta; los decimales los fija el XSD de cada campo, y las invariantes de totales se verifican antes de construir el XML. Un campo fiscal se redondea HALF_UP solo al materializarlo, y los totales usan los valores materializados (ERS RF-007, RF-203; CTX §10.6, §10.7; Q-14).
- **BR-16** Un comprobante que llegó al SRI no se edita; se corrige con el flujo documental permitido (ERS RF-009).
- **BR-17** Cada emisión lleva una clave de idempotencia; repetirla con la misma solicitud devuelve o reanuda el mismo comprobante y no reserva otro secuencial; con una solicitud distinta, se rechaza (ERS RF-520, RF-521, API-003; CTX §27.4; Q-30).
- **BR-18** Un timeout no es un rechazo: no genera un secuencial ni una clave nuevos, y se reconcilia por la misma clave antes de cualquier reenvío (ERS RF-522, RF-523, SRI-REQ-08, SRI-REQ-09; CTX §22.3).
- **BR-19** `RECIBIDA` no significa autorizado. La autorización se consulta de forma asíncrona, con intervalo parametrizable, hasta 24 horas (CTX §22.1, §23.1).
- **BR-20** Ante el error 70 (clave en procesamiento) no se cambia la clave ni el secuencial, ni se genera otro comprobante. Se reconcilia por clave, y solo si la reconciliación lo determina se reenvían exactamente los mismos bytes firmados (CTX §27.2).
- **BR-21** Al reservar, el comprobante copia los datos de empresa, establecimiento, receptor, productos, impuestos y catálogos; el XML y el RIDE se generan solo desde ese snapshot, y nada histórico se recalcula con la configuración actual (CTX §11, §39).
- **BR-22** El XML firmado se persiste antes de llamar a la red, y cada respuesta del SRI antes de actuar sobre ella (ERS SRI-REQ-05, SRI-REQ-06; CTX §21).
- **BR-23** La validación XSD precede a la firma, falla cerrada y no puede desactivarse en Producción (ERS SRI-REQ-03, CTX §19).
- **BR-24** Cada comprobante registra la versión XSD y técnica usada; actualizar catálogos o XSD no altera los históricos (ERS SRI-REQ-11, SRI-REQ-12; CTX §53).
- **BR-25** Ningún tag, orden de nodos ni flujo se inventa: el contrato es el XSD oficial de la versión, y la tabla conceptual del ERS §8 no lo reemplaza (CTX §1.1).
- **BR-26** Un XML firmado que supera el límite individual del SRI (320 KB en la ficha v2.34, parámetro versionado) no se envía. El MVP envía comprobantes de uno en uno, sin lotes (CTX §29).
- **BR-27** Una operación que requiere un caso especial no soportado se rechaza de forma explícita antes de emitir, con un mensaje funcional; nunca se aproxima ni se degrada en silencio a un comprobante ordinario (CTX §38.1, §57, ADR 0014).

### Corrección y anulación

- **BR-28** Un comprobante devuelto por inconsistencias se corrige y se reenvía con la misma clave de acceso y el mismo secuencial; por eso la corrección no puede cambiar los campos que componen la clave (CTX §27.1, §8). La corrección es la capacidad futura `correct-returned-document`. `add-sri-transmission` conserva `RETURNED` con su respuesta y sus mensajes, sin volver mutables el snapshot, la clave ni el artefacto firmado. Retransmitir los mismos bytes por un resultado incierto no es corregir.
- **BR-29** Ante los errores 43 (clave registrada) o 45 (secuencial registrado) no se genera un comprobante nuevo: se consulta por la clave, se reconcilia y se escala si hay inconsistencia (CTX §27.3).
- **BR-30** La anulación en línea no es una nota de crédito ni una eliminación: se tramita en el SRI, y el sistema solo la observa mediante la consulta de validez (CTX §36, Q-16). La norma admite también anular un comprobante de venta mediante una nota de crédito (Res. NAC-DGERCGC25-00000014, art. 2), que es un comprobante propio con su número, su clave y su autorización (causa `TOTAL_ANNULMENT`, BR-60); nunca cambia ni borra la factura.

### Por tipo de comprobante

- **BR-31** Se factura a consumidor final solo hasta el monto vigente de la política versionada (USD 50 al corte), y la interfaz advierte antes de emitir que esas facturas tienen restricciones de anulación y de nota de crédito (ERS RF-201; CTX §35).
- **BR-32** Liquidación de compra, nota de crédito, nota de débito y retención exigen una contraparte identificada; ninguna admite consumidor final (CTX §9.1, §17.4). Procedencia: para la nota de crédito, además, es un requisito oficial desde el 01/01/2026 (Res. NAC-DGERCGC25-00000014, art. 3); para la nota de débito es la política del producto, que exige un receptor identificado: esa resolución no formula una prohibición equivalente para emitir una nota de débito, y una factura a consumidor final no la admite por esta regla, no por la resolución (Q-49).
- **BR-33** Las notas de crédito y débito referencian el documento modificado con su tipo, número y fecha; sus impuestos son coherentes con ese documento (ERS RF-211, RF-220; CTX §13.4, §14.3). Usan la tarifa de IVA aplicada al comprobante original, tomada de su snapshot inmutable, nunca la vigente a la fecha de la nota, el catálogo vigente ni el producto actual. Fuente oficial: la ficha técnica v2.34, página 58, "la tarifa de IVA corresponderá a la fecha de emisión del documento de sustento" (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`); lo indicó también el SRI en los cambios de tarifa (Q-49; complementaria: `sri-catalogs/fuentes/sri-preguntas-frecuentes-tarifa-iva-2016.txt`).
- **BR-34** No se asume que toda factura admite nota de crédito (ERS RF-213; CTX §13.5; Q-10). Requisitos oficiales: una factura emitida a consumidor final no la admite desde el 01/01/2026, ni una factura comercial negociable negociada, ni un comprobante que sustenta una devolución de impuestos (Res. NAC-DGERCGC25-00000014, art. 3 y disposiciones generales segunda y tercera); no hay plazo vigente para emitirla (la NAC-DGERCGC25-00000017 eliminó el de doce meses). Política del MVP: solo contra una factura propia de la misma empresa en `AUTHORIZED`, del mismo ambiente en que la empresa emite (una nota de Producción no modifica una factura de Pruebas, ni al revés), con su snapshot y sus artefactos íntegros. Las condiciones que el sistema conoce se validan antes de consumir secuencial, clave, firma o llamada al SRI, y fallan cerradas.
- **BR-35** El crédito acumulado de una factura no supera su total, y en una devolución la cantidad acumulada acreditada de cada línea no supera su cantidad original. Es una regla conservadora del producto, no un límite textual del SRI (Q-10). Se valida con el estado fiscal inmutable de la factura y de sus notas, nunca con el producto vigente, y dos notas simultáneas no pueden excederlo juntas.
- **BR-36** La retención registra el periodo fiscal y sus documentos sustento como referencias estructuradas, con códigos y porcentajes vigentes del catálogo (ERS RF-231..234; CTX §16).
- **BR-37** En la guía de remisión, la fecha de inicio del traslado no es anterior a la fecha de emisión (CTX §15.4).
- **BR-38** La liquidación de compra es un flujo separado de la factura y solo se usa en los casos que la normativa permite (ERS RF-250, RF-253; Q-12).
- **BR-59** Las causas de la nota de crédito del MVP son cerradas: `TOTAL_ANNULMENT` y `RETURN`. El motivo es texto para el comprobante y nunca selecciona comportamiento. Los descuentos y bonificaciones, que la norma permite, son la capacidad futura `credit-note-discounts-bonuses`: un alcance del MVP, no una prohibición legal (Q-10).
- **BR-60** `TOTAL_ANNULMENT` acredita el total de la factura, reproducido desde su snapshot, y solo existe mientras la factura no tiene ningún crédito previo, reservado ni aplicado; no es la anulación de un saldo restante. No implica por sí misma un retorno físico: el usuario lo declara por línea, como en la devolución, y solo eso vuelve al inventario (BR-45).
- **BR-61** En `RETURN`, parcial o total, cada línea de la nota referencia una línea de la factura con la cantidad que acredita; no hay líneas libres. Precio, base, descuento e impuestos se derivan del estado fiscal de la línea original con decimal exacto, y la última nota que completa una línea toma exactamente el remanente, así que la suma de las notas nunca difiere en centavos del documento original.
- **BR-62** Antes de reservar una nota, el usuario declara por separado que la factura no es una factura comercial negociable negociada y que no sustentó una devolución de impuestos. Sin ambas declaraciones no se emite. La nota guarda en su snapshot inmutable la versión de la declaración, cada afirmación, el actor y el momento: es una elegibilidad declarada por el usuario, no verificada por el sistema, y nunca anula una exclusión que el sistema conoce (Q-10).
- **BR-63** La capacidad acreditable (el total y cada línea de la factura) y la devolvible (lo que la salida de la factura sacó, por producto) son independientes: una devolución sin retorno físico consume solo la primera. Una nota toma ambas al emitirse, en la misma transacción que su número y antes de cualquier XML, firma o llamada al SRI, y las conserva reservadas hasta su conclusión: las aplica en la transacción que la lleva a `AUTHORIZED` y las libera en la que la lleva a `RETURNED` o `NOT_AUTHORIZED`. Falla cerrada: un problema operativo, un resultado incierto o una revisión manual nunca liberan capacidad, y no hay un barrido que lo haga; solo concluye la transmisión o la reconciliación del administrador (design D7 y D25 de `add-credit-notes`). Las reservas son de solo agregado.
- **BR-64** Una nota de débito se emite solo por las causas oficiales del artículo 16 del Reglamento de Comprobantes de Venta: `LATE_PAYMENT_INTEREST` (cobro de intereses de mora) y `POST_INVOICE_COST_EXPENSE` (recuperación de costos y gastos incurridos por el vendedor después de emitir la factura). La descripción de cada concepto es obligatoria y nunca selecciona comportamiento; no hay corrección de precio, error de facturación, incrementos, penalidades ni otros cargos (Q-49).
- **BR-65** Política del MVP: una nota de débito modifica solo una factura emitida por el sistema, de la misma empresa y del mismo ambiente, en `AUTHORIZED` y con su snapshot y sus artefactos íntegros. No hay referencia a facturas externas, de papel o importadas ni a otros comprobantes de venta (Q-11). No es una afirmación de que la norma prohíba los demás comprobantes de venta (Q-49).
- **BR-66** Una nota de débito tiene uno o más conceptos (hasta 100, límite del producto), cada uno con su causa, su descripción, su base exacta y un tratamiento de IVA (código, código de porcentaje y tarifa) que ya existía en la factura modificada. Las bases se suman por tratamiento y el impuesto de cada tratamiento se materializa una sola vez, HALF_UP a dos decimales, sobre esa suma; nunca por concepto, así que el resultado no depende de cómo se parta una misma base. La nota no introduce un tratamiento que la factura no tenía, y una factura con varias tarifas no se reduce a una sola: cada concepto elige el suyo. La vista previa, el snapshot, el XML y el RIDE salen del mismo cálculo versionado (`calculateDebitNoteAmounts`), con decimal exacto (Q-14; design D7 de `add-debit-notes`).
- **BR-67** Una factura comercial negociable efectivamente negociada no puede modificarse con nota de débito (requisito oficial, artículo 16). Mientras el sistema no pueda comprobarlo, el usuario lo declara de forma explícita antes de reservar (`NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE`), y la nota guarda la versión de la declaración, la afirmación, el actor y el momento como declarada por el usuario, nunca como verificada por el sistema. Si un día el sistema puede comprobarlo, la comprobación prevalece y la declaración no la anula.
- **BR-68** El sistema no impone un plazo para emitir una nota de débito: las fuentes oficiales vigentes revisadas no lo establecen (el artículo 16 no lo fija, y el artículo 5 reformado por la NAC-DGERCGC25-00000017 rige las notas de crédito). No es una garantía de que no exista; si aparece una fuente oficial, se propone con OpenSpec (Q-49).
- **BR-69** Una nota de débito es un documento complementario separado: no aumenta la capacidad acreditable de su factura (BR-35, BR-63), que sigue siendo la del documento original, y una nota de crédito no modifica una nota de débito. No genera movimientos de inventario. Su anulación posterior, que las resoluciones de 2025 regulan para los documentos complementarios, no es parte de su emisión (Q-16).

### Catálogos

- **BR-39** Un único catálogo de terceros sirve para todos los roles (ERS RF-320).
- **BR-40** Impuestos, retenciones, formas de pago y límites son datos versionados con vigencia y fuente, nunca constantes del código; los distribuye el producto y una empresa solo habilita o deshabilita entradas (CTX §12.5, §16.4, §55; ADR 0020).
- **BR-41** El código principal del producto es único; el control de stock se activa por producto (ERS RF-301, RF-302).

### Inventario

- **BR-42** Solo los productos con control de stock generan movimientos (ERS RF-205, RF-310). Una factura descuenta las líneas cuya decisión `inventoryAffectsStock` quedó congelada en su snapshot al reservar: producto marcado y con inventario inicializado. Desactivar el control solo afecta a las emisiones nuevas.
- **BR-43** Una factura genera una sola salida por producto, y solo cuando entra de forma concluyente en `AUTHORIZED`, en la misma transacción que esa transición. La cantidad es la suma exacta de sus líneas de ese producto. Repeticiones, reintentos y reconciliaciones no la duplican (ERS RF-205, RF-206, AC-08; Q-18). `RESERVED`, `SIGNED`, `RECEIVED`, `SEND_UNKNOWN`, `MANUAL_REVIEW`, `RETURNED` y `NOT_AUTHORIZED` no modifican el stock, así que ninguno necesita compensación; con la transmisión apagada, las facturas pendientes no descuentan.
- **BR-44** Los movimientos no se borran; se corrigen con ajustes compensatorios (ERS RF-313). El inventario de un producto se inicializa una sola vez con su `INICIAL` (Q-21); el control solo se desactiva con saldo cero, y reactivarlo continúa el mismo kárdex.
- **BR-45** Una nota de crédito devuelve stock solo cuando entra en `AUTHORIZED` y solo por el retorno físico que el usuario declaró (ERS RF-212, Q-20). El retorno físico de cada línea va de cero a la cantidad acreditada, y en un servicio es cero. Solo devuelven las líneas que en el snapshot de la factura original tenían `inventoryAffectsStock = true`, aunque hoy el control esté desactivado; y en total nunca más de lo que la salida de esa factura sacó y todavía no se devolvió. Una `DEVOLUCION_NC` agregada por nota y producto, aunque deje un saldo negativo más cerca de cero o positivo.
- **BR-46** Sin costo promedio, valorización contable ni multibodega (ERS RF-315).
- **BR-57** El inventario nunca bloquea guardar un borrador, emitir, reservar el secuencial, firmar, transmitir ni autorizar. La salida se registra aunque el saldo quede negativo, y el saldo negativo se muestra tal cual: no se trunca a cero, no se rechaza el movimiento ni se compensa con un ajuste (Q-19, ADR 0006). Significa que las salidas fiscales registradas superan las existencias registradas, y no altera el comprobante.
- **BR-58** El stock es el contabilizado por hechos fiscales autorizados, no una reserva de disponibilidad: no existe stock reservado ni comprometido, ni disponible para prometer. El borrador puede advertir, sin bloquear, que el saldo vigente de un producto controlado es menor que la cantidad pedida (sumada por producto); la advertencia es orientativa y no garantiza existencias, porque otra operación puede cambiar el saldo antes de la autorización (Q-19). Impedir la sobreventa antes de autorizar sería una capacidad separada de reserva o disponibilidad.

### Archivo, entrega, reportes y auditoría

- **BR-47** Los artefactos son inmutables y conservan su hash; el XML autorizado proviene de la respuesta del SRI; eliminar catálogos o usuarios no borra comprobantes ni artefactos (ERS RF-407, RF-409, §13.1; CTX §45).
- **BR-48** Se conservan todas las respuestas y mensajes del SRI sin secretos; el SRI no es un sistema de respaldo (ERS RF-408; CTX §31).
- **BR-49** El RIDE se genera desde el comprobante autorizado, muestra la marca de Pruebas cuando aplica y nunca reemplaza al XML archivado (ERS RF-405; CTX §30).
- **BR-50** Una entrega fallida no cambia el estado fiscal del comprobante (CTX §46).
- **BR-51** El XLSX exporta las identificaciones como texto y los importes como números con formato monetario, y respeta los filtros aplicados (ERS RF-502..504).
- **BR-52** Los reportes no reemplazan obligaciones contables ni anexos tributarios (ERS RF-505).
- **BR-53** Se audita todo cambio de configuración tributaria, firma, secuenciales y ambiente, y toda transición de estado de un comprobante (ERS RF-003, RF-105, RF-525, SEC-007).

### Usuarios

- **BR-54** Existen los roles Administrador y Operador, y sus permisos se aplican en el servidor (ERS RF-002, SEC-005; Q-22).
- **BR-55** Los usuarios se desactivan, no se eliminan (ERS RF-409).
- **BR-56** Cada usuario puede tener, en su membresía, un establecimiento y un punto de emisión predeterminados. Solo se preseleccionan: no restringen desde dónde emite (ERS RF-113, Q-23).
