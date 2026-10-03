# Design

## Context

Ver `proposal.md` (Why). El estado actual que condiciona el diseño:

- **Decisiones ya tomadas** (`docs/architecture/fiscal-emission.md`):
  - Q-08, Q-14, Q-29, Q-30, Q-35, Q-39, Q-43 y Q-44;
  - ADR 0010 (artefactos en PostgreSQL detrás de un puerto), ADR 0018 (lo propio, lo reutilizado y lo que no se usa de `facturacion-electronica-ec`) y ADR 0021 (`xmllint-wasm` detrás de `XsdValidator`).
- **Piezas existentes:**
  - `reserveSequentialIn(scope, input)` en `fiscal`;
  - `lockTaxIdentityIn(scope, companyId)` en `taxpayer`;
  - `fiscalCatalogQueries(db)` con `availability`, `resolveCatalogEntry` y `consumerFinalPolicy`, todas con fecha explícita;
  - `XsdValidator` con concurrencia acotada (en `main`, sin conectar);
  - `XmlSigner` sobre `EcSriSigner`, que corre solo dentro del worker criptográfico;
  - `CryptoWorkerPool` con una sola tarea registrada (`inspect-and-test-sign`).
- **Piezas validadas en S-3 offline, que este cambio implementa en su código de producto:** el builder propio de la factura y su escritor XML, la aritmética fiscal y el adaptador `AccessKeys`. La rama del spike no se fusiona.
- **Huecos encontrados:**
  - No hay una lectura interna de la preparación para emitir.
  - Los scopes de `taxpayer` y `fiscal` se construyen dentro de sus unidades de trabajo y no se exportan.
  - `parties`, `products` y `catalogs` solo exponen servicios con sesión.
  - El registro de esquemas y la matriz no tienen lectura interna.
  - Nadie abre todavía la custodia (`CertificateVault.open`) ni lee el secreto sellado completo.
  - No existe código de idempotencia ni un Dockerfile.
  - `tsc` no copia los `.xsd` al build.
  - No hay un selector con búsqueda en el frontend.
- **Pruebas de arquitectura:**
  - Ningún archivo fuera de `parties` y `products` puede mencionar sus tablas o delegados de Prisma, ni siquiera en comentarios.
  - Ningún archivo fuera de `catalogs` puede mencionar las tablas de catálogos.
  - `application/` y `domain/` no importan `infrastructure/`.

## Goals / Non-Goals

**Goals:**
- La frontera `REQUEST/DRAFT → validaciones → RESERVED → XML → XSD → firma → artefacto → SIGNED`, sin partirla.
- Una sola transacción de reserva sin I/O externo, con el orden de `fiscal-emission.md`.
- Un núcleo de documento genérico (comprobante, transiciones, artefacto, idempotencia) que reutilicen los otros cinco comprobantes, y la factura como su primer tipo.
- Reproducir S-3 offline con el código real, con XML de referencia y pruebas de regresión decimal.

**Non-Goals:**
- **Transmisión:** cualquier llamada al SRI, jobs, polling o reintentos automáticos (cambio 7).
- **Archivo:** descarga del XML, RIDE o bandeja documental (cambio 8).
- **Comprobación del tamaño del envío:** el límite normativo de 320 KB (CTX §29) llega con la transmisión y su catálogo técnico; aquí el tamaño queda acotado por el límite configurable de líneas.
- **Otros tipos:** un framework de builders para los seis comprobantes; solo existe el de la factura.
- **Configuración:** cambiar el modelo de la configuración tributaria, los terceros o los productos.

## Decisions

### D1. Módulos y fronteras

| Pieza | Módulo | Contenido |
| --- | --- | --- |
| Factura | `invoices` (nuevo) | Borradores, validación de la factura, snapshot, cálculo (`domain/amounts.ts`), orquestación de la emisión y del reintento, API `/api/v1/invoices` |
| Núcleo de documento | `fiscal` | `electronic_document`, máquina local `RESERVED` → `SIGNED`, transiciones, puerto de artefactos y su adaptador PostgreSQL |
| Idempotencia | `platform/idempotency` | Registro durable, huella canónica, lectura de la cabecera |
| Protocolo SRI | `sri-engine` | `AccessKeys` sobre `generateClaveAcceso`, builder propio, escritor XML, `XsdValidator` con verificación previa |
| Firma | `signing` | Servicio de firma de documentos: lee el secreto sellado, abre la custodia y ejecuta la tarea `sign-xml` en el pool |
| Aritmética | `platform/decimal` | Primitivas exactas: suma, diferencia, producto, porcentaje y `roundHalfUp` |

Lecturas internas nuevas. Son fábricas sobre un `DbClient`, para usarlas dentro de la transacción de reserva; se exportan desde la infraestructura de cada módulo:

- **`taxpayer`:**
  - `createTaxpayerScope(tx)`, que la unidad de trabajo actual pasa a usar;
  - `taxpayerEmissionReads(tx)`: configuración vigente y punto con su establecimiento.
- **`fiscal`:** `createFiscalScope(tx)`.
- **`parties`:** `partyReader(db).find(companyId, id)`.
- **`products`:** `productReader(db).find(companyId, id)`.
- **`catalogs`:** `fiscalCatalogQueries` gana `schemaRegistry()` y `specialCases()`, con la última versión aplicada.
- **`signing`:** `signingReads(db).activeCertificate(companyId)`, que da utilizable, huella e id.

`invoices/infrastructure/emission-unit-of-work.ts` compone esas fábricas sobre una misma `tx`. `application/` define sus puertos estructurales y nunca importa infraestructura de otros módulos.

- Alternativa descartada: un módulo `documents` separado de `fiscal`. `database.md` ya asigna `electronic_document` y sus tablas a `fiscal`, y la numeración y el documento comparten frontera.
- Alternativa descartada: leer tablas ajenas desde `invoices`. Las pruebas de arquitectura lo prohíben, y con razón.

### D2. Borrador separado de la factura fiscal

- **El borrador** es un recurso propio, editable y eliminable, en `invoice_draft`, con líneas (`invoice_draft_line`) y formas de pago (`invoice_draft_payment`).
  - Guarda referencias: punto de emisión, comprador y productos. Guarda también importes de entrada (cantidad, descuento, importe del pago), `version`, autor y fecha de creación y del último cambio (ERS RF-008), y `status` `DRAFT` o `EMITTED`.
  - **Precio unitario.** Ninguna fuente autoriza de forma explícita sobrescribir el precio del producto en la línea: ERS RF-202 y RF-301, ERS §8 (la factura lleva "precios") y CTX §12.4 (`unitPrice` de la línea). "Ingreso manual permitido" (RF-202) se refiere a líneas fuera del catálogo, no a cambiar el precio de un producto del catálogo. Por eso:
    - la línea toma el `unitPrice` del producto al emitir y queda congelado en el snapshot;
    - el borrador no guarda precio, y un precio en la línea es un campo no permitido;
    - la vista previa usa el precio vigente del producto;
    - modificar el precio por línea queda como decisión futura (Q-45);
    - la línea manual fuera del catálogo (RF-202) queda diferida como requisito fuente pendiente (Q-46): este cambio no la implementa.
  - Un trigger impide cambiar o borrar un borrador `EMITTED`, sus líneas y sus pagos.
- **La factura fiscal** solo existe desde `RESERVED`, en `electronic_document`, con `draft_id` único.
  - El borrador emitido se conserva como `EMITTED` para la trazabilidad, pero no es la fuente de verdad: lo es el snapshot.
  - `DRAFT` no es un estado de `electronic_document` ni de su máquina.
- **Vista previa.** El borrador devuelve una vista previa calculada por el servidor con la fecha de hoy en Ecuador: totales e `issues` con los mismos códigos de la validación de emisión. Es informativa y no fiscal, y evita que el frontend calcule dinero.
- **Límites de entrada:**
  - Escalas de las especificaciones decimales, con la regla del XSD de `decimal-policy.md`: cantidad `cantidad` (18/6), descuento e importe de pago `importe` (14/2).
  - **Líneas:** `INVOICE_MAX_LINES`, 100 por defecto (de 1 a 1 000), configurable.
    - Es una defensa de recursos de la aplicación, no una regla del SRI ni del XSD, que admite líneas sin límite.
    - Acota la transacción de reserva, el XML y la firma en el pool.
    - El único límite normativo es el de 320 KB por comprobante firmado (ficha v2.34, CTX §29), que comprueba la transmisión con su catálogo técnico (cambio 7).
  - **Formas de pago:** sin límite propio; las acota el límite de 100 KB del cuerpo JSON.
- Alternativa descartada: una sola tabla con `DRAFT`, `RESERVED` y `SIGNED`. Es más simple de listar, pero mezcla datos editables y fiscales en la misma fila, y obliga a que las restricciones fiscales sean condicionales al estado.
- Alternativa descartada: no guardar borradores. ERS RF-010 los exige en el MVP.

### D3. Documento fiscal y máquina local

`electronic_document`, genérico (ADR 0002). Columnas:
- `id`, `company_id` y `document_type` (`01` en este cambio; CHECK con los seis);
- `environment`, `establishment_id`, `emission_point_id`, `document_number` (`EEE-PPP-SSSSSSSSS`) y `sequential`;
- `reservation_id`, único, con FK a `fiscal_sequence_reservation`;
- `access_key` (`CHAR(49)`, único, CHECK `^[0-9]{49}$`), `numeric_code` (`CHAR(8)`) e `issue_date`;
- `state` (`RESERVED` o `SIGNED`), `snapshot JSONB` y `schema_version`;
- copias del snapshot para listar y buscar: `buyer_identification`, `buyer_name` y `total` (`NUMERIC` con el CHECK de `importe`);
- `created_by`, `created_at` y `signed_at`;
- el diagnóstico del último intento: `last_attempt_stage`, `last_attempt_code`, `last_attempt_class`, `last_attempt_at`, `attempt_count` y `attempt_lease_until`.

Garantías en la base de datos:
- **Unicidad:** `UNIQUE (company_id, environment, establishment_id, emission_point_id, document_type, sequential)`, como segunda defensa de la reserva.
- **Inmutabilidad:** un trigger impide cambiar cualquier columna salvo `state` (solo de `RESERVED` a `SIGNED`), `signed_at` y las columnas del intento. Otro trigger impide `DELETE` y `TRUNCATE`.
- **Firmado con artefacto:** un trigger de restricción diferido exige que un documento `SIGNED` tenga su artefacto `SIGNED_XML`. Así no se puede observar `SIGNED` sin el artefacto exacto.

`document_state_transition`, de solo agregado: documento, `from_state` (nulo al crear), `to_state`, `cause`, actor (`USER` o `SYSTEM`, con el usuario), `metadata JSONB` sin datos sensibles y `occurred_at` (ERS RF-525).

La transición es una actualización guardada (`WHERE state = 'RESERVED'`) que comprueba las filas afectadas.

### D4. Snapshot

`snapshot` es un JSON versionado (`snapshotVersion: 1`) con todo lo que el XML necesita y las versiones aplicadas (CTX §39):

- **Metadatos:** esquema (`01`, `1.1.0`, ruta lógica, SHA-256 del XSD y de sus imports), `builderVersion`, versiones de dataset de cada catálogo usado y versión de configuración tributaria (id y número).
- **Fecha y ambiente:** `issueDate` (`YYYY-MM-DD`) y `environment` (`TEST` o `PRODUCTION`, con el código `1` o `2`).
- **Emisor:** RUC, razón social, nombre comercial, dirección matriz, establecimiento (código y dirección), punto (código), obligado a llevar contabilidad, número de contribuyente especial, resolución de agente de retención, categoría RIMPE y gran contribuyente.
- **Comprador:** `partyId` informativo, tipo e identificación, razón social, dirección y si es el consumidor final, con el resultado de su política: id de la versión, monto máximo y `allowed`.
- **Líneas:** `productId` informativo, códigos principal y auxiliar, descripción (nombre del producto), cantidad, precio, descuento, subtotal exacto, base materializada y, por impuesto, `taxCode`, `rateCode`, id de la versión de la entrada, etiqueta oficial, tarifa, base y valor.
- **Totales y pagos:** totales por impuesto y tarifa, sin impuestos, descuento e importe total, y formas de pago (código, id de la versión, etiqueta e importe).
- **Casos especiales:** atributos de la operación (ninguno en la factura MVP) y reglas del emisor evaluadas (anexos 21, 22, 24 y 26), con la versión de la matriz.
- **Clave:** secuencial, código numérico, tipo de emisión `1` y clave de acceso.

Otras reglas:
- El anexo 24 no tiene elemento en el XSD de factura 1.1.0. El snapshot conserva la condición para el RIDE (cambio 8).
- `InvoiceSnapshot` del puerto del builder es una proyección directa del snapshot, sin lecturas.
- Después de reservar, nada reconstruye la factura desde terceros, productos ni la configuración.

### D5. Cálculo fiscal

- **`platform/decimal`** tiene las primitivas exactas (`sumExact`, `subtractExact`, `multiplyExact`, `percentageOfExact`) y `roundHalfUp` como único redondeo, sobre `decimal.js` con precisión de 40 dígitos.
- **`invoices/domain/amounts.ts`** tiene las reglas como funciones con nombre: `lineSubtotal`, `lineDiscount`, `taxableBase`, `taxAmount`, `materializeMoney` e `invoiceTotals`.
  - Validan escalas con las especificaciones decimales y nunca usan `number` ni `decimal.js` directamente.
  - Los puntos de materialización HALF_UP son tres: base de línea, impuesto de línea y totales, que solo fijan la escala de sumas ya exactas.
- **El builder solo serializa.**
- **Pruebas:**
  - una tabla dorada de cálculo (los casos de S-3 y los de la spec) protege contra cambios accidentales;
  - una prueba de fuente impide `Number(`, `parseFloat`, `toFixed` y `decimal.js` en el dominio y en el builder.
- **Límites del esquema.** Cada importe materializado se comprueba con su especificación (`importe` 14/2 para bases, valores y totales); un valor fuera es `AMOUNT_OUT_OF_RANGE` antes de reservar.

### D6. Validación antes de reservar

La fecha se captura una vez (`ecuadorDate(clock())`), al comenzar, y viaja como argumento.

Fuera de la transacción:
- comprobar el permiso;
- buscar una repetición en el registro de idempotencia (D8);
- verificar que existen los archivos del esquema (`XsdValidator.ensureAvailable`), una lectura de disco con caché.

Dentro de la transacción de reserva y antes de llamar a `reserveSequentialIn`, con lecturas coherentes, se valida en este orden:

1. **Borrador:** de la empresa, `DRAFT` y con la versión esperada (`INVOICE_DRAFT_CHANGED`, `INVOICE_DRAFT_ALREADY_EMITTED`); completo, con punto, comprador, líneas y pagos (`INVOICE_DRAFT_INCOMPLETE`).
2. **Preparación:**
   - configuración vigente (`TAXPAYER_NOT_CONFIGURED`);
   - punto y establecimiento activos (`EMISSION_POINT_UNAVAILABLE` o `EMISSION_POINT_NOT_FOUND`);
   - firma utilizable (`SIGNING_CERTIFICATE_NOT_USABLE`).
3. **Comprador:** activo, con rol de cliente o el consumidor final (`BUYER_NOT_CUSTOMER`, `BUYER_INACTIVE`), y su tipo de identificación vigente.
4. **Líneas:** cada producto activo (`PRODUCT_INACTIVE`) y descuento entre 0 y el subtotal (`DISCOUNT_EXCEEDS_SUBTOTAL`).
5. **Impuestos:** por cada referencia del producto, `availability(companyId, catálogo, fecha)`. Debe ser `usable` (`TAX_REFERENCE_NOT_USABLE`) y con `calculationData` `COMPLETE` (`TAX_CALCULATION_DATA_MISSING`); hoy esto excluye ICE, IRBPNR y el IVA `8`.
6. **Cálculo** (D5) y límites del esquema (`AMOUNT_OUT_OF_RANGE`).
7. **Pagos:** cada forma utilizable en la fecha (`PAYMENT_METHOD_NOT_USABLE`) y suma igual al total (`PAYMENTS_DO_NOT_MATCH_TOTAL`).
8. **Consumidor final:** política vigente (`CONSUMER_FINAL_POLICY_MISSING`) y total menor o igual que el máximo (`CONSUMER_FINAL_LIMIT_EXCEEDED`).
9. **Casos especiales:**
   - Las condiciones del emisor activan sus anexos: resolución de agente de retención (21), categoría RIMPE (22) y gran contribuyente (24).
   - **Anexo 26.** Aplica cuando la configuración declara un RUC proveedor distinto del RUC de la empresa: el contribuyente usa un sistema de un tercero (CTX §37).
     - Un RUC proveedor vacío o igual al propio no lo activa.
     - El cómputo del plazo (C-09, Q-37) no se infiere.
   - Cada anexo activado debe estar en la matriz como `CORE` o `CONDITIONAL_ISSUER_RULE`, con su generación soportada. El 26 es `CONDITIONAL_GO_LIVE` y su `campoAdicional` no se genera en este cambio. Una factura a la que aplica se rechaza antes de reservar (`SPECIAL_CASE_UNSUPPORTED`, anexo 26), sin implementarlo en silencio.
10. **Esquema:** el registro tiene `01` `1.1.0` soportado, con todos sus imports (`SCHEMA_NOT_AVAILABLE`).

Respuestas:
- Cada fallo es un `409` con su código y un mensaje que identifica la línea o el dato. La emisión informa el primer fallo; la vista previa del borrador muestra todos.
- `SEQUENCE_EXHAUSTED` de la reserva se traduce igual y se registra como advertencia en el log.

### D7. Transacción de `RESERVED`

Una transacción de la unidad de trabajo de emisión, con el `timeout` por defecto de Prisma y sin I/O externo ni XML:

1. Bloqueo de la fila del borrador con una actualización guardada, que la retiene hasta el final de la transacción como un `SELECT … FOR UPDATE`; el adaptador de Prisma no cualifica el esquema en SQL crudo. Serializa las emisiones del mismo borrador.
2. `lockConfiguration(companyId)` (lock advisory de la configuración) y lectura de la configuración vigente.
3. La validación de D6.
4. La construcción del snapshot sin el secuencial.
5. `reserveSequentialIn(fiscalScope, …)` con el ambiente del snapshot: secuencial e id de reserva.
6. `lockTaxIdentityIn(taxpayerScope, companyId)`; el lock advisory ya está tomado y la operación es idempotente.
7. El código numérico (`crypto.randomInt`) y la clave (`AccessKeys.compose`), que completan el snapshot.
8. La inserción del `electronic_document` `RESERVED`, su transición inicial y el borrador marcado `EMITTED` con `document_id`.
9. La inserción en `idempotency_record`. Su `UNIQUE (company_id, operation, idempotency_key)` es la última defensa.
10. El evento de auditoría `invoice.reserved`.
11. Commit.

El número solo existe para la respuesta después del commit. Un fallo en cualquier paso revierte todo: no hay número, clave, bloqueo ni documento.

### D8. Idempotencia

- **Cabecera.** `Idempotency-Key` obligatoria en `POST /api/v1/invoices`, de 1 a 100 caracteres ASCII visibles. Sin ella, `400 IDEMPOTENCY_KEY_REQUIRED`, y la emisión no se ejecuta.
- **Registro.** `idempotency_record` es de solo agregado y no se purga en este cambio. Columnas: `company_id`, `operation` (`invoice.emit`), `idempotency_key`, `request_fingerprint` (`CHAR(64)`), `document_id`, `created_by` y `created_at`.
- **Huella.** SHA-256 del JSON canónico `{ operation, draftId, expectedVersion }`. La versión del borrador identifica su contenido.
- **Repetición** (consulta previa, o tras una colisión):
  - Misma clave y misma huella devuelve el documento (`200`). Si sigue `RESERVED`, lanza un intento hacia `SIGNED` (D9).
  - Misma clave y otra huella es `409 IDEMPOTENCY_KEY_REUSED`.
- **Concurrencia, misma clave y mismo borrador.** El bloqueo de fila del borrador serializa: la segunda transacción encuentra el borrador `EMITTED`, se revierte, lee el registro ya confirmado y responde como repetición.
- **Concurrencia, misma clave y borradores distintos.** La segunda transacción espera en el índice único, falla al confirmar la primera, se revierte (su número se libera porque nunca se confirmó) y responde `409 IDEMPOTENCY_KEY_REUSED`.
- **Otra clave sobre un borrador ya emitido.** `409 INVOICE_DRAFT_ALREADY_EMITTED`, con el id de la factura.
- **Documentación.** `idempotency.md` y `backend.md` se alinean con Q-30: alcance sin usuario, `409` y duración fiscal. El borrador no exige clave: no tiene efecto fiscal y su edición usa versión.

### D9. Del snapshot al artefacto firmado

Después del commit, en la misma solicitud. Una retoma con la misma clave o un reintento ejecuta el mismo procedimiento:

1. **Arriendo del intento.** Actualización guardada `WHERE state = 'RESERVED' AND (attempt_lease_until IS NULL OR attempt_lease_until < now())`, que fija `attempt_lease_until = now() + 2 min`. Si otro intento está en curso, se devuelve el estado actual sin intentar.
2. **XML.** `InvoiceXmlBuilder.build(snapshot)`: XML UTF-8 determinista.
3. **XSD.** `XsdValidator.validate` con el esquema del snapshot.
4. **Firma.** `signing.signDocument(companyId, xml, "01")`:
   - lee el certificado activo utilizable y su secreto sellado, y lo abre con la custodia en el hilo principal (ADR 0011);
   - transfiere los bytes al worker (`sign-xml`), que firma y comprueba que el certificado embebido tiene la huella del certificado activo;
   - pone a cero los bytes.
5. **XSD del XML firmado.**
6. **Persistencia y `SIGNED`.** Una transacción que:
   - inserta el artefacto `SIGNED_XML` por el puerto (ADR 0010);
   - hace la transición guardada a `SIGNED` y registra su transición;
   - limpia el arriendo;
   - registra la auditoría `invoice.signed`.

   El trigger diferido de D3 y `UNIQUE (document_id, kind)` impiden dos artefactos o `SIGNED` sin artefacto.

Artefacto (`document_artifact`, de solo agregado):
- `document_id`, `kind` y `media_type` (`application/xml`);
- `content BYTEA`, `size_bytes` (CHECK `= octet_length(content)`) y `sha256` (CHECK hex);
- `metadata JSONB` con la versión del esquema, los hashes del XSD y de sus imports, `builderVersion`, la versión de `facturacion-electronica-ec` del firmador y la huella del certificado;
- `created_at`.

Respuesta:
- El `POST` responde `201` con la factura: `SIGNED`, o `RESERVED` con el diagnóstico.
- No espera al SRI porque no lo llama.

### D10. Diagnóstico y recuperación

Cada fallo después del commit actualiza, en una transacción corta, las columnas del intento y libera el arriendo. El estado sigue `RESERVED`.

| Clase | Códigos | Acción |
| --- | --- | --- |
| `RETRYABLE_OPERATIONAL` | `VALIDATOR_BUSY`, `VALIDATOR_TIMEOUT`, `CRYPTO_BUSY`, `CRYPTO_TIMEOUT`, `CRYPTO_UNAVAILABLE`, `PERSIST_FAILED` | Reintentar sin cambiar nada |
| `DETERMINISTIC_CONFIGURATION` | `SIGNING_CERTIFICATE_NOT_USABLE`, `CUSTODY_UNAVAILABLE`, `CERTIFICATE_MISMATCH`, `SIGNER_FAILED`, `SCHEMA_UNAVAILABLE`, `SCHEMA_HASH_MISMATCH` | Corregir la configuración o la instalación y reintentar |
| `DETERMINISTIC_VALIDATION` | `XSD_INVALID`, `SIGNED_XML_INVALID`, `INVALID_SNAPSHOT_TEXT`, `INVALID_SNAPSHOT_AMOUNT` | Error del producto: visible, requiere soporte; reintentar da el mismo resultado |

- **Reintento.** `POST /api/v1/invoices/{id}/signing-attempts`, con permiso `invoices.retrySigning`.
  - Ejecuta D9 sobre la misma factura, con su snapshot, número y clave.
  - Sobre una factura `SIGNED` devuelve la factura sin efecto y sin auditoría.
  - Mientras otro intento tiene el arriendo, devuelve el estado actual sin intentar y sin auditoría.
  - Su idempotencia es natural: la transición guardada, el arriendo y el artefacto único.
- **Sin bucles.** No hay reintentos automáticos ni jobs.
- **Caída del proceso.** Deja `RESERVED` con un arriendo que vence. La repetición con la misma clave o un reintento lo retoman.
- **Mensajes.** El diagnóstico nunca guarda secretos, el XML inválido ni la salida de libxml2 con datos del comprador; solo la etapa, el código y, para `XSD_INVALID`, la línea y el elemento.

### D11. XSD: registro completo, empaquetado y concurrencia

- **Registro.** Dataset `schema-registry/2.json`, con los seis esquemas de documento y el import `xmldsig-core-schema.xsd`.
  - Cada entrada lleva `kind` (`DOCUMENT` o `IMPORT`), `path` lógico (`sri-xsd/factura_V1.1.0.xsd`, `w3c-xsd/xmldsig-core-schema.xsd`), fuente, `revision` (la del W3C para el import), SHA-256 y fecha.
  - Las entradas de documento declaran sus `imports` por ruta lógica.
- **Migración del registro.** Añade `kind`, `path`, `revision` e `imports` a `schema_registry_entry`, hace opcionales los campos de documento para los imports, con CHECK por `kind`, y cambia la clave primaria a `(path, dataset_version)`. Rellena las filas de la versión 1 con el trigger de inmutabilidad desactivado solo dentro de la migración.
- **Fuente del adaptador.** El hash del import deja de vivir en el adaptador: viene del registro.
- **Empaquetado.**
  - El build del backend (`tsc` y después `scripts/copy-xsd.ts`) copia los archivos del registro a `backend/dist/xsd/<path>`.
  - `check:xsd-artifact`, después del build y dentro de `verify`, comprueba que cada archivo del registro está en `dist/xsd` con su SHA-256.
  - `XSD_DIRECTORY` es opcional. Por defecto, en desarrollo y pruebas es `docs/product/` (las rutas lógicas coinciden) y en el build compilado es `dist/xsd/`.
  - Nunca hay descarga ni caída a los XSD de la librería.
- **Arranque.** Valida el paquete canónico completo: cada archivo del registro vigente, documentos e imports, presente y con su SHA-256.
  - Válido: la comprobación queda cumplida y el validador guarda los archivos verificados.
  - Inválido (falta un XSD o un import requerido, o un hash no coincide): el arranque registra qué archivo falla, `xsd_registry_available` vale 0 y `/health/ready` responde `503`. El backend no se declara listo para atender.
  - `/health/ready` no valida XML: solo la integridad y la disponibilidad del paquete.
  - Como defensa, la emisión sigue comprobando el esquema antes de reservar (`SCHEMA_NOT_AVAILABLE`). Una entrada fiscal particular no soportada sigue siendo un rechazo funcional de la emisión.
- **Concurrencia.** `XSD_VALIDATION_CONCURRENCY` 2 (de 1 a 8), `XSD_VALIDATION_QUEUE` 16 (de 0 a 256) y `XSD_VALIDATION_TIMEOUT_MS` 10 000 (de 1 000 a 60 000).
  - Con la cola llena, `VALIDATOR_BUSY`; al vencer el plazo, `VALIDATOR_TIMEOUT`. Ambos son diagnósticos reintentables.
  - El lugar del worker sigue ocupado hasta que termina (ADR 0021).
  - Q-26 dirá si los valores por defecto cambian.

### D12. Uso de `facturacion-electronica-ec` (ADR 0018)

| Uso | Detalle |
| --- | --- |
| Propio | Snapshot, aritmética, materialización, builder de la factura (`sri-engine/infrastructure/invoice-xml-builder.ts` y `xml-writer.ts`) y validación XSD |
| Se reutiliza tras su prueba de contrato | `generateClaveAcceso` detrás de `AccessKeys` (`access-keys.ts`), comparada con la implementación de referencia de CTX §8.3; `EcSriSigner` detrás de `XmlSigner`, en la tarea `sign-xml` |
| No se usa | `emitir*`, `buildFacturaXml` 1.0.1, `generateCodigoNumerico`, `validateXmlAgainstXsd`, `registerXsdSearchPath`, `ISequenceProvider` ni ningún `rollback` |

Ningún dominio importa la librería; la regla de ESLint del motor SRI lo impide.

### D13. API

Todo bajo `/api/v1/invoices`:

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `POST /invoices/drafts` | Crear borrador; las líneas llevan producto, cantidad y descuento, sin precio | `invoices.draft` |
| `GET /invoices/drafts` | Listar borradores `DRAFT`, paginado | `invoices.draft` |
| `GET /invoices/drafts/{draftId}` | Borrador con vista previa e `issues` | `invoices.draft` |
| `PUT /invoices/drafts/{draftId}` | Corregir con `expectedVersion` | `invoices.draft` |
| `DELETE /invoices/drafts/{draftId}` | Eliminar un borrador `DRAFT` | `invoices.draft` |
| `POST /invoices` | Emitir `{ draftId, expectedVersion }` con `Idempotency-Key` | `invoices.emit` |
| `GET /invoices` | Listar facturas: estado, búsqueda por número o comprador, orden por creación descendente | `invoices.read` |
| `GET /invoices/{invoiceId}` | Detalle desde el snapshot, con el diagnóstico | `invoices.read` |
| `POST /invoices/{invoiceId}/signing-attempts` | Reintentar la firma | `invoices.retrySigning` |

- Los cuerpos son estrictos (`companyId` y campos desconocidos dan `400`), y la empresa, el rol y el autor salen de `res.locals.context`.
- Un recurso de otra empresa es `404`, sin revelar datos.
- No hay endpoints de pasos técnicos.
- Los contratos viven en `packages/contracts/src/invoices.ts` y en `apiRoutes`; `openapi-routes.test.ts` cubre las rutas nuevas.

### D14. Permisos, auditoría y transiciones

- **Permisos nuevos:** `invoices.read`, `invoices.draft`, `invoices.emit` e `invoices.retrySigning`, en `access-policy.ts`, en el espejo del frontend y en la tabla de `access-control.md`.
  - Cada caso de uso exige su permiso antes de leer o escribir datos. Como la matriz vigente da los cuatro a ambos roles, el rechazo por permiso se prueba en la guardia de cada caso de uso, no con un rol inexistente.
  - La matriz propuesta da a ambos roles "Crear borradores y emitir" y "Corregir un comprobante con XML inválido". El reintento continúa la misma emisión, sin decisiones nuevas, así que también es de ambos roles.
  - Resolver la revisión manual u ordenar una reconciliación es solo del administrador, pero llega en el cambio 7.
- **Auditoría:** `invoice.reserved` (número, clave, ambiente y total), `invoice.signed` (número y SHA-256 del artefacto) e `invoice.signing_retried` (número, y el resultado `SIGNED` o el código del diagnóstico).
  - `invoice.signing_retried` solo se registra cuando comienza un intento sobre una factura `RESERVED`. No se registra para una factura ya firmada, un reintento mientras otro intento tiene el arriendo ni una solicitud rechazada por sesión, permiso o validación.
  - Todas con el usuario como actor.
  - Ni los borradores, ni las consultas, ni las emisiones rechazadas generan eventos.
  - Nunca hay XML ni bytes en el payload.
- **Transiciones:** se registran siempre en `document_state_transition`, en la misma transacción.

### D15. Pantallas

| Pantalla | Ruta | Contenido |
| --- | --- | --- |
| `Borradores` | `/borradores` | Lista con comprador, total previo, punto y última actualización. Acción principal: "Nueva factura". Acciones de fila: corregir y eliminar |
| Editor | `/borradores/nuevo`, `/borradores/{id}` | Página completa (flujo complejo y de riesgo, `frontend-checklist.md`). Acción principal: "Emitir factura". Secundaria: "Guardar borrador" |
| `Facturas` | `/facturas` | Número, comprador, total, fecha y estado: "Procesando" (`RESERVED`), "Pendiente de envío" (`SIGNED`) |
| Detalle | `/facturas/{id}` | Datos del snapshot, número, clave y diagnóstico. Acción "Reintentar firma" cuando corresponde |

Componentes:
- Componente compartido nuevo `EntityPickerDialog`, que ya figura en `component-system.md`: búsqueda, resultados paginados y selección por teclado. Sirve para el comprador, con la opción rápida "Consumidor final", y para los productos.
- Navegación: `Facturas` y `Borradores` en el grupo `Operación`.
- El frontend genera la `Idempotency-Key` al abrir la confirmación y la reutiliza en los reintentos de esa misma solicitud.

Briefs:

| Pantalla | Usuario | Objetivo | Decisión | Información mínima | Acción principal |
| --- | --- | --- | --- | --- | --- |
| Editor | Administrador u operador, a diario | Preparar una factura correcta | Si la factura está lista para emitirse | Comprador, líneas con el precio del producto y el descuento, totales del servidor, formas de pago, `issues` y ambiente | "Emitir factura" |
| `Borradores` | El mismo | Retomar o descartar trabajo pendiente | Qué borrador continuar | Comprador, total previo, fecha | "Nueva factura" |
| `Facturas` | El mismo | Encontrar una factura y saber si quedó firmada | Si una factura necesita un reintento | Número, comprador, total, estado | Abrir la factura |
| Detalle | El mismo | Entender una factura y destrabar una firma fallida | Si reintentar ahora o corregir la configuración antes | Estado, diagnóstico, número, clave, totales | "Reintentar firma", solo con `RESERVED` |

- P0: estado y acción. P1: totales y comprador. P2: líneas y pagos. P3: versiones y metadatos técnicos; estos no se muestran.
- **La confirmación de la emisión** muestra el ambiente (Pruebas o Producción), el comprador, el total y el número de líneas. Para el consumidor final advierte de las restricciones posteriores de anulación y nota de crédito (CTX §35). Es una confirmación de un paso, porque la emisión es irreversible.
- **Tras emitir,** la app navega al detalle con un aviso semántico.
- **Si la emisión falla,** el error vuelve al editor con el campo o la línea señalados.

### D16. Benchmark de la emisión (Q-26)

- **Script.** `bench:emission` (`backend/scripts/bench-emission.ts`), fuera de `verify`, como `bench:search`.
- **Arranque.** Lanza `main.ts` sobre un esquema migrado de PostgreSQL 17, con la custodia habilitada y un P12 sintético cargado por la API.
- **Datos.**
  - 100 productos, 100 terceros y una empresa preparada.
  - 100 000 facturas previas por empresa: documentos `SIGNED`, transiciones, registros de idempotencia y artefactos sintéticos de 64 bytes.
    - Así los índices tienen el volumen de referencia sin fabricar 100 000 firmas.
    - Los artefactos sintéticos no simulan el volumen físico real de `BYTEA` y TOAST de 100 000 XML firmados; el informe lo declara.
    - Cada factura medida usa su artefacto real producido.
  - Al final, `ANALYZE`.
- **Carga.** 10 usuarios concurrentes. Cada uno crea un borrador de 1 a 5 líneas y lo emite: 30 de calentamiento y 300 medidas en total.
- **Etapas.** Con `EMISSION_STAGE_TIMINGS=1`, que el esquema de entorno rechaza en producción, la respuesta lleva `Server-Timing` con estas etapas:
  - `validation_snapshot`, `arithmetic` y `reservation_tx`;
  - `xml`, `xsd`, `sign` y `persist`;
  - `total`.
- **Informe.** P50, P95 y máximo por etapa y total, en `docs/quality/benchmarks/emission-<fecha>.md` y `.json`, con el entorno registrado: PostgreSQL y su configuración, Node, sistema, CPU, memoria y commit.
- **Objetivo.** P95 total de 2 s o menos en ese entorno, no como promesa universal. Si se supera, el script termina con código 1 y la corrección se propone con `/opsx:update`; nunca se sube el umbral.
- **Pruebas del SRI.** Nunca se usan para medir rendimiento.
- **Métricas de producción.** Las mismas etapas alimentan `invoice_emission_stage_duration_seconds{stage,outcome}` en el registro de métricas existente.
- **Resultado del 2026-10-03.** Dos ejecuciones sobre el mismo código del backend dieron un P95 total de 884 ms y de 1630 ms, dentro del objetivo. La variación está sobre todo en la espera de la base de datos y de la confirmación (`reservation_tx` y `persist`). Es un dato de seguimiento, no un bloqueo; los artefactos precargados de 64 bytes no simulan el volumen físico de `BYTEA` y TOAST.

### D17. Pruebas y compuertas de evidencia

- **Unitarias:**
  - aritmética, con la tabla dorada;
  - builder: escape, caracteres XML 1.0, opcionales, orden, versión, pureza y prueba de fuente;
  - escritor XML, máquina local, huella de idempotencia, clasificación de diagnósticos y snapshot;
  - guardia de permisos de cada caso de uso de facturas.
- **Contrato:**
  - `AccessKeys` contra la implementación de referencia de CTX §8.3: secuenciales 1, 9, 10 y 999999999, longitudes y caracteres inválidos;
  - `XsdValidator`, ya en `main`, con el registro 2;
  - `XmlSigner` con `sign-xml` y la comprobación de huella.
- **Integración, con PostgreSQL y dos empresas en los fixtures:**
  - migraciones y triggers;
  - borradores;
  - validación antes de reservar, sin consumir el número;
  - transacción de reserva y rollback;
  - idempotencia: repetición, otra solicitud, dos simultáneas, falta de clave y otra empresa;
  - recuperación con fallos inyectados en cada etapa;
  - `SIGNED` con artefacto, aislamiento, permisos y auditoría.
- **S-3 offline reproducido con la implementación real.** Del borrador a `SIGNED` por el caso de uso, con reloj y código numérico inyectados. El XML firmado vuelve a validar y el XML sin firmar se compara con los fixtures de referencia: consumidor final 49.99 y 50.00, varias líneas, valores grandes, regresiones `123456789012.123456` y `99999999999.999999`, y emisor con agente de retención y RIMPE.
- **End-to-end.** `main.ts` real: configuración, punto, firma sintética, tercero, producto, borrador, emisión hasta `SIGNED`, repetición con la misma clave, rearranque y consulta.
- **Compuertas antes del archive:**
  - S-2 integrado, con el validador conectado a la emisión;
  - S-3 offline reproducido con la implementación real;
  - el vector oficial de la clave de acceso de la ficha, si puede obtenerse de la fuente oficial. Si sigue inaccesible, no se inventa: queda como evidencia pendiente y `/opsx:verify` decide, con las fuentes disponibles, si bloquea el archive o pasa a ser compuerta previa a la transmisión. Decidido en `/opsx:verify` (2026-10-03): el portal del SRI no fue accesible, y el vector pasa a compuerta previa a la transmisión.
- **Compuertas del cambio 7, previas a la transmisión:** el vector oficial de la clave de acceso, la parte online de S-3, un P12 ecuatoriano real y un RUC habilitado en el ambiente de Pruebas del SRI. No bloquean el archive de este cambio, que no transmite al SRI.

### D18. Briefs de las operaciones sensibles

| Pregunta | Borradores (crear, corregir, eliminar) | Emitir | Reintentar firma |
| --- | --- | --- | --- |
| 1. Quién ejecuta | `invoices.draft`, ambos roles | `invoices.emit`, ambos roles | `invoices.retrySigning`, ambos roles |
| 2. Empresa del llamador | `res.locals.context.companyId` | Igual | Igual |
| 3. Empresa del recurso | `invoice_draft.company_id` | Borrador y referencias leídos con `companyId` | `electronic_document.company_id` |
| 4. Propiedad | Consultas con `companyId`; las referencias (punto, tercero, producto, forma de pago) se resuelven en la empresa | Ídem, y el bloqueo de fila del borrador en la empresa | Consulta con `companyId` |
| 5. Cambiar un id | Da `404` o referencia inexistente | `404` | `404` |
| 6. Dos veces | Crear: dos borradores, sin efecto fiscal. Corregir: versión. Eliminar: `404` la segunda vez | Registro de idempotencia: la misma factura | Natural: transición guardada y artefacto único |
| 7. A la vez | Versión y actualización guardada | Bloqueo de fila del borrador e índice único de la clave | Arriendo del intento, transición guardada y `UNIQUE (document_id, kind)` |
| 8. Idempotencia | Versión (natural) | `Idempotency-Key` durable (D8) | Natural |
| 9. Restricciones | CHECK de escalas, FK de referencias y trigger de borrador emitido | Unicidades de reserva, clave, número, borrador e idempotencia; triggers de inmutabilidad; `SIGNED` con artefacto | Las mismas |
| 10. Auditoría | No; autor y fecha en el borrador | `invoice.reserved` e `invoice.signed` | `invoice.signing_retried` e `invoice.signed` |
| 11. Pruebas de autorización | Dos empresas, sin sesión, referencias ajenas, `companyId` en el cuerpo | Ídem, más la clave en otra empresa | Ídem |
| 12. Fugas | Respuestas sin datos ajenos; la vista previa solo usa catálogos y datos propios | Errores sin datos ajenos; diagnóstico sin XML; logs sin XML ni secretos | Ídem |

### D19. Checklist de PR fiscal (CTX §65) y cobertura de CTX §58

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Fuente oficial | XSD de factura 1.1.0 del SRI (manifiesto de `docs/product/sri-xsd/`); ficha técnica v2.34 para catálogos, consumidor final (numeral 9.10) y clave (CTX §8); W3C para `xmldsig-core-schema.xsd` |
| 2 | Versión y fecha | Ficha v2.34 del 2026-07-27; XSD descargados el 2026-10-02; W3C revisión 1.2 (2013-04-16) |
| 3 | ¿Afecta XSD? | Sí: registro con imports y empaquetado (D11) |
| 4 | ¿Afecta clave de acceso? | Sí: se genera por primera vez (D7, D12). El vector oficial de la ficha queda como evidencia pendiente: el portal del SRI no fue accesible el 2026-10-03 (tarea 12.2) |
| 5 | ¿Afecta firma? | Sí: primera firma de documentos con la tarea `sign-xml` (D9) |
| 6 | ¿Afecta catálogo tributario? | Usa tarifas, formas de pago, política de consumidor final, matriz y registro; solo el registro cambia (versión 2) |
| 7 | ¿Afecta cálculos? | Sí: aritmética fiscal de Q-14 (D5) |
| 8 | ¿Afecta RIDE? | No (cambio 8) |
| 9 | ¿Afecta secuenciales? | Usa `reserveSequentialIn` sin cambiarlo |
| 10 | ¿Afecta estados o reintentos? | Sí: máquina local `RESERVED` → `SIGNED` y reintento manual (D3, D10) |
| 11 | ¿Incluye fixtures? | Sí: XML de referencia de S-3 y tabla dorada de cálculo |
| 12 | ¿Incluye pruebas? | Sí (D17): unitarias, de contrato, de integración contra PostgreSQL, S-3 offline con la implementación real, end-to-end sobre `main.ts` sin llamadas de salida y `bench:emission` |
| 13 | ¿Probado en certificación del SRI? | No: la parte online de S-3 es la compuerta de go-live |
| 14 | ¿Cambia un caso especial? | Aplica las reglas del emisor de los anexos 21, 22 y 24 y rechaza el 26 |
| 15 | ¿Migración de datos o configuración? | Sí: tablas nuevas y el registro de esquemas con imports, con relleno de la versión 1 |

De CTX §58, este cambio cubre:
- mapper de dominio y builder de versión;
- validación XSD oficial y clave correcta;
- firma XAdES-BES y XML firmado persistido antes de cualquier red;
- secuencial sin duplicados;
- pruebas unitarias, golden files y documentación de los casos no soportados.

El envío, la interpretación de las respuestas, la autorización, la respuesta original, el timeout, el error 70, la reconciliación, el RIDE, la descarga y la certificación llegan con los cambios 7 y 8. La factura no se declara "implementada" según CTX §58 hasta entonces.

## Risks / Trade-offs

- **[Riesgo] Tamaño del cambio, sobre todo borradores y pantallas** → La frontera `RESERVED` → `SIGNED` no se parte. Las tareas se agrupan en unidades verificables, y el informe de tamaño identifica el crecimiento.
- **[Riesgo] Contención del contador mientras se valida dentro de la transacción** → El lock de fila del contador solo se toma en `reserveSequentialIn`, después de validar. La validación solo lee, sin I/O externo, y el lock advisory es de la configuración, no del contador.
- **[Riesgo] La firma tarda más que la solicitud HTTP** → Plazo del pool criptográfico y arriendo de 2 minutos. La factura queda `RESERVED` con un diagnóstico reintentable, y nunca se reserva otro número.
- **[Riesgo] Pruebas de arquitectura frágiles ante palabras** → El código de `invoices` usa las lecturas exportadas y evita nombrar tablas ajenas, también en comentarios.
- **[Riesgo] Crecimiento de PostgreSQL por los artefactos** → Están acotados por el límite configurable de líneas. El ADR 0010 deja el puerto listo para migrar a object storage.
- **[Riesgo] Vector oficial de la clave inaccesible** → El algoritmo coincide con CTX §8.3 y tiene pruebas independientes. El vector queda como evidencia pendiente, decidida en `/opsx:verify`.
- **[Compromiso] Errores de emisión de uno en uno** → El sobre de error no cambia. La vista previa del borrador lista todos los `issues` antes de emitir.
- **[Compromiso] Sin reintentos automáticos** → Un fallo reintentable necesita una acción del usuario o la repetición del cliente. La cola persistida llega con el cambio 7.

## Migration Plan

- **Migraciones nuevas:**
  - borradores, documento, transiciones, artefacto e idempotencia, con sus CHECK, FK y triggers;
  - el registro de esquemas con imports, con el relleno de la versión 1.
- **Datasets:** `schema-registry/2.json`, aplicado por el cargador al arrancar.
- **Despliegue.** Migrar, desplegar el build con `dist/xsd`, comprobar que `/health/ready` responde `200` (paquete de XSD íntegro) y probar una emisión en Pruebas.
- **Reversión.** Hacia adelante (`deployment.md`): las tablas nuevas no cambian datos existentes. Una versión anterior del binario ignora las tablas nuevas, pero no debe ejecutarse después de emitir, porque la identidad tributaria ya quedó bloqueada; eso es esperado y permanente.
