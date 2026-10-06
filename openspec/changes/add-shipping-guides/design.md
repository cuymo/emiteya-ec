# Design

## Context

- **Motivación y alcance:** ver proposal.md. Q-51 está resuelta con P1 a P10 (`open-questions.md`); las reglas de negocio son BR-37 y BR-76 a BR-87 (`domain-model.md`); su procedencia está en `capabilities.md` (Trazabilidad de `shipping-guides`), y las decisiones de arquitectura previas en `fiscal-emission.md` ("Decisiones para el diseño de `add-shipping-guides`").
- **Ya es genérico por tipo** (lo dejaron los cambios 10 a 12):
  - numeración por empresa, ambiente, establecimiento, punto y tipo, con los `CHECK` que ya admiten `06`; la clave con `documentType` como dato;
  - `electronic_document` con su máquina de estados, sus transiciones, sus artefactos y sus guardas;
  - `reserveDocumentIn` y la firma por perfil (`SigningProfile`, `documentSigning.pipeline`); la librería de firma ya mapea `06` a `GUIA_REMISION` (`signDeliveryGuideXml`);
  - el registro de esquemas, con `GuiaRemision_V1.1.0.xsd` en `supported: true`, el hash `4777fd94…` y el import de la firma del W3C, ya en el paquete del build (`check:xsd-artifact`), verificado contra el portal (`sri-catalogs/fuentes/guia-remision-xsd-verificacion.txt`); una guía sintética valida offline;
  - la transmisión (handlers, clasificadores, evidencia, reconciliación automática y manual con `requestReconciliationIn`);
  - el RIDE (job, pool, lectura por raíz y versión), la bandeja y las descargas, con `filenames.ts` que ya nombra `guia-de-remision`;
  - `DECIMAL_SPECS.cantidad` (18/6, mínimo 0) ya declara el tipo `06`.
- **Atado a cada tipo hoy:** `COMPLETED_AUDIT` de `reconcile-handler.ts`; el `CHECK` de `idempotency_record.operation`; la lectura y la distribución del RIDE; `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` en el frontend; `emitted-document-types.test.ts`, que hoy exige que no exista ninguna ruta de guía.
- **Los seguidores de las transiciones ya ignoran el tipo 06:** la salida de inventario lee solo `01`, y las capacidades acreditable y devolvible solo concluyen reservas de una nota `04`.
- **La cabecera común asume un comprador y un total:** `electronic_document.total` es `NOT NULL` con el `CHECK` del dominio `importe`, y `buyer_identification` y `buyer_name` son `NOT NULL`; el trigger de inmutabilidad los compara; la bandeja (`documentListItemSchema`) los exige, y su filtro por identificación usa el índice `(company_id, buyer_identification)`. Ningún comprobante `06` existe todavía.
- **Lecturas que la guía necesita y ya existen:** la factura con su integridad (`invoiceCreditSource` de `invoices`, que comprueban las notas: snapshot con forma, clave, totales y XML firmado inalterado), cuyo snapshot guarda el `partyId` del comprador y, por línea, el producto, sus códigos, su descripción y su cantidad, pero no el tipo bien/servicio; los terceros con sus roles (`CARRIER` existe en `PARTY_ROLES` y en el filtro de Terceros); los productos con `kind` (`GOOD`/`SERVICE`), `mainCode`, `auxiliaryCode` y `name` (sin unidad); los establecimientos de la empresa con su código y su dirección.
- **Inventario:** stock por empresa y producto (`stock_balance`), sin ubicación.
- **Fuentes archivadas:** la verificación del XSD, el extracto de la ficha v2.34 (tablas 3, 6, 13 y 15, error 82, anexo 2 página 64, anexo 3 páginas 70 y 71, anexos 12 y 13) y los artículos 27 a 38 del Reglamento.

## Goals / Non-Goals

**Goals:**

- Una guía que reutiliza la reserva, la firma, la transmisión, la reconciliación, la bandeja y el RIDE, con lo propio del tipo aislado en su módulo.
- Un sustento tipado por destinatario de punta a punta: borrador, evaluación, snapshot, XML, RIDE, base de datos y consulta.
- Una cabecera común que admite un comprobante sin total ni comprador sin debilitar la invariante de los demás tipos.
- La factura, las notas y la retención no cambian: mismos snapshot, XML, artefacto y RIDE para los mismos datos.

**Non-Goals:**

- Un pipeline genérico para los seis tipos, un modelo de logística, despacho o stock por ubicación.
- Verificar con el SRI los datos de terceros (código de establecimiento de destino, RUC del transportista).
- Reetiquetar métricas existentes o cambiar la clasificación de las respuestas del SRI.

## Decisions

### D1. Módulo `shipping-guides` y dirección de las dependencias

- Módulo nuevo `shipping-guides` con `domain/`, `application/` e `infrastructure/`, como `withholding-receipts`.
- Depende de operaciones exportadas de `fiscal` (reserva, documentos, artefactos, firma, transmisión y reconciliación), de `taxpayer` (configuración del emisor y establecimientos) y de `signing`. Lee terceros, productos y facturas por puertos que compone `main.ts`: `ShippingPartyReader` (sobre `parties`), `ShippingProductReader` (sobre `products`) y `ShippingInvoiceReader` (sobre `invoiceCreditSource`, sin cambiarla).
- `fiscal`, `invoices`, `inventory`, `credit-notes`, `debit-notes` y `withholding-receipts` no importan `shipping-guides`, y `shipping-guides` no importa `invoices`, `inventory`, `credit-notes`, `debit-notes`, `withholding-receipts`, `parties` ni `products`. Una prueba de arquitectura comprueba ambas direcciones (P8: la guía no depende de `inventory`).
- **Alternativa descartada:** extender `invoices` con la guía. La guía no es una venta: tiene su propio borrador, su propio XML y destinatarios sin factura.

### D2. Qué se reutiliza y qué queda por tipo

| Pieza | Decisión |
| --- | --- |
| Reserva | `reserveDocumentIn` con `documentType: "06"` y las columnas de D10 |
| Firma | `documentSigning.pipeline(shippingGuideSigningProfile())`: el perfil aporta el builder desde el snapshot y la auditoría `shipping_guide.signed`; firmador, XSD antes y después, artefacto, transición y encolado son los de `fiscal` |
| Transmisión | Sin cambios |
| Reconciliación manual | `requestReconciliationIn`, y `"06": shipping_guide.reconciliation_completed / shippingGuideId` en `COMPLETED_AUDIT` |
| Idempotencia | `shipping_guide.emit` en `IDEMPOTENT_OPERATIONS` y en el `CHECK` |
| RIDE | Lectura y distribución nuevas para `guiaRemision` 1.1.0, por raíz y versión, sobre el mismo pool, job y artefacto (D20) |
| Bandeja | `"06"` en `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS`, y el resumen de destinatarios (D10, D21) |
| Por tipo | Borrador, evaluación, snapshot, builder XML, distribución del RIDE, rutas y pantallas |

- **Regresión protegida:** el contrato y los golden del XML y del RIDE de la factura, las notas y la retención pasan sin cambios. Las ediciones compartidas son las tablas por tipo, la nulabilidad de D10 con su invariante y el resumen de destinatarios de la bandeja.
- **Alternativa descartada:** un `switch` por `codDoc` en la firma o la transmisión; las interfaces por tipo ya cubren la diferencia.

### D3. Transportista: `SELF` o `PARTY` (P4)

- El borrador lleva `transporter: { source: "SELF" } | { source: "PARTY", partyId } | null`.
- **`SELF`:** identidad tributaria de la configuración vigente al evaluar y otra vez al reservar: RUC, tipo `04` y razón social. No existe un tercero artificial ni se lee `parties`.
- **`PARTY`:** el tercero se lee por `(company_id, id)` y se comprueba, en este orden: existe en la empresa (`404` igual que inexistente); está activo; no es el consumidor final del sistema; su tipo es `04`, `05` o `06` (el `08` responde `SHIPPING_GUIDE_CARRIER_FOREIGN_OUT_OF_SCOPE`); tiene el rol `CARRIER` (`SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED`, que dice que se configure en Terceros); su identificación tiene como máximo 13 caracteres (`SHIPPING_GUIDE_CARRIER_IDENTIFICATION_TOO_LONG`, que cita el anexo 3).
- Nunca se asigna el rol. El editor ofrece "Nuevo transportista" con `PartyDialog` y el rol `CARRIER` marcado a la vista: el usuario lo guarda de forma explícita con `parties.manage`. Un tercero existente sin el rol se corrige en Terceros.
- El snapshot congela `{ source, partyId | null, identificationType, identification, legalName }`. Después de `RESERVED` no se relee el tercero ni la configuración.
- **Alternativa descartada:** registrar la empresa como tercero para el transporte propio, porque duplica su identidad y desalinea su razón social cuando la configuración cambia.

### D4. Placa (P5)

- Texto con los extremos recortados, de 1 a 20 caracteres, sin `\n` ni `\r` (XSD `placa`). Sin otra validación: la tabla 29 del anexo 12 es de facturas de combustibles.
- Una sola placa por guía: el contrato es estricto y no admite listas.

### D5. Fechas del transporte y fecha de emisión

- El borrador lleva `transportStart` y `transportEnd` (`YYYY-MM-DD`). Validación: fecha real, año de 2000 a 2099 (patrón del XSD); `transportStart >= issueDate` (requisito oficial, error 82, `SHIPPING_GUIDE_START_BEFORE_ISSUE`); `transportEnd >= transportStart` (validación del proyecto, `SHIPPING_GUIDE_END_BEFORE_START`). Sin duración máxima.
- La fecha de emisión es la fecha de Ecuador de la reserva (`deps.today()`), capturada una vez; la vista previa compara con la de hoy y la reserva otra vez con la suya. Se congela con la clave; el reintento de firma y la transmisión no la cambian.
- El XML escribe `dd/mm/aaaa`. El error 82 del SRI, si llegara, se trata como cualquier devolución (D19).

### D6. Dirección de partida y establecimiento emisor

- `departureAddress` es texto libre de 1 a 300 caracteres sin saltos de línea. Al crear el borrador, y al cambiar de punto mientras el usuario no la haya editado, el servidor propone la dirección del establecimiento del punto.
- `dirEstablecimiento` sale del establecimiento del punto, como en los demás builders.

### D7. Destinatarios (P2, P3)

- **Forma en el borrador:** una lista ordenada `recipients`, cada uno con:
  - `recipient: { kind: "PARTY", partyId } | { kind: "OWN_COMPANY", establishmentId } | null`;
  - `address`, `motive`, `route` y `destinationEstablishmentCode` (texto);
  - `support` (D8) y `details` (D9).
- **`PARTY`:** tercero por `(company_id, id)`: existe, activo, no es el consumidor final (`SHIPPING_GUIDE_RECIPIENT_CONSUMER_FINAL`), tipo `04`, `05` o `06` (`08`: `SHIPPING_GUIDE_RECIPIENT_FOREIGN_OUT_OF_SCOPE`). Sin rol obligatorio y sin asignarle `CUSTOMER`. `address` se propone desde el tercero al elegirlo y es obligatoria. `destinationEstablishmentCode` es opcional (`^[0-9]{3}$`), declarado por el usuario y no verificado.
- **`OWN_COMPANY`:** establecimiento por `(company_id, id)`, activo. La identificación y la razón social salen de la configuración tributaria; la dirección y el código de destino, del establecimiento elegido; el cliente no envía `address` ni `destinationEstablishmentCode` (contrato estricto). Su sustento es siempre la excepción `OWN_ESTABLISHMENT_TRANSFER`. No se crea un tercero. El código de destino nunca toma por defecto el establecimiento emisor; elegirlo como destino es válido, porque la partida puede ser una bodega.
- `motive` es obligatorio (1 a 300, sin catálogo) y `route` opcional (1 a 300). Los textos se recortan; vacío equivale a ausente.
- El mismo tercero puede repetirse en varios destinatarios.

### D8. Sustento tipado (P1)

- `support: { kind: "INTERNAL_INVOICE", invoiceId } | { kind: "DECLARED_EXCEPTION", case } | null`, con `case` en `QUANTITY_OR_PRICE_AFTER_TRANSFER` (literal b), `CONSIGNMENT` (c), `OWN_ESTABLISHMENT_TRANSFER` (d) y `EXHIBITION_OR_DEMONSTRATION` (e). La venta itinerante no tiene código; un valor desconocido es un error de contrato.
- **`INTERNAL_INVOICE`:** `ShippingInvoiceReader.find(companyId, invoiceId)`; se exige tipo `01` (otro tipo responde como inexistente para el sustento), `AUTHORIZED`, el mismo ambiente que la guía al reservar (`SHIPPING_GUIDE_INVOICE_ENVIRONMENT_MISMATCH`) e integridad sin problemas (`SHIPPING_GUIDE_INVOICE_NOT_INTACT`). Los cuatro datos salen del documento inmutable: `codDocSustento` 01, `numDocSustento` = su número, `numAutDocSustento` = su número de autorización (49 dígitos, igual a la clave) y `fechaEmisionDocSustento` = su fecha de emisión. El destinatario puede no ser el comprador.
- **`DECLARED_EXCEPTION`:** `OWN_ESTABLISHMENT_TRANSFER` exige un destinatario `OWN_COMPANY`, y los otros tres un `PARTY` (`SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH`). La declaración se confirma al emitir (D14): el snapshot y el registro guardan `{ case, policyVersion, basis: "USER_DECLARED", declaredBy, declaredByName, declaredAt }`. La política es la versión 1, con el texto de cada caso tomado del art. 30, numeral 8, en `packages/contracts`.
- **Sin capacidad de despacho:** la factura no se bloquea ni se modifica; varias guías la referencian; las cantidades no se comparan con lo facturado. La factura es terminal en `AUTHORIZED`, así que no hay carrera con su estado.

### D9. Detalle, producto y cantidad (P6, P7)

- Cada detalle: `{ productId | null, mainCode, auxiliaryCode, description, quantity }`.
- **Con producto:** activo y `GOOD` (`SHIPPING_GUIDE_PRODUCT_NOT_GOOD`, `SHIPPING_GUIDE_PRODUCT_INACTIVE`); `mainCode` y `auxiliaryCode` salen del producto (el cliente no los envía) y se congelan; `description` se propone con el nombre del producto y el usuario la completa.
- **Línea libre:** `mainCode` y `auxiliaryCode` opcionales (1 a 25, sin saltos de línea).
- **Descripción:** obligatoria, 1 a 300 caracteres sin saltos de línea. La unidad y las características van dentro de ella (art. 30, numeral 6), porque el XML no tiene campo de unidad y no hay catálogo de unidades. La interfaz lo hace explícito con el rótulo "Descripción (incluye unidad y características)", un ejemplo en la ayuda ("10 cajas de 12 botellas de 1 litro"), el contador de 300 y la vista previa del texto tal como irá al XML y al RIDE.
- **Cantidad:** `decimalString(DECIMAL_SPECS.cantidad)` con la política del proyecto de mayor que cero (`SHIPPING_GUIDE_QUANTITY_INVALID`); se guarda canónica, sin `number` ni redondeo. Sin precio, impuesto, total ni `detallesAdicionales`.
- **Precarga desde la factura:** `GET .../eligible-invoices/{invoiceId}/goods` devuelve las líneas del snapshot cuyo producto es hoy un bien activo, con `productId`, sus códigos, su descripción y su cantidad, y el número de líneas omitidas. El snapshot de la factura no guarda el tipo bien/servicio, así que la precarga lo lee del producto vigente; es solo una propuesta editable, y lo que vale es lo que la guía congela.

### D10. Cabecera común sin total ni comprador (P10)

- **Base de datos:** `electronic_document.total`, `buyer_identification` y `buyer_name` pasan a admitir `NULL`. El `CHECK electronic_document_values_check` añade `("document_type" = '06') = ("total" IS NULL)`, la misma igualdad para `buyer_identification` y `buyer_name`, y mantiene el dominio `importe` cuando el total existe. Una factura, nota o retención sin total o sin comprador es imposible; una guía con total o comprador también. El trigger de inmutabilidad ya usa `IS DISTINCT FROM` y protege los nulos.
- **Destinatarios en la cabecera:** tabla genérica de `fiscal`, `electronic_document_recipient` (empresa, comprobante, posición, identificación y nombre), inmutable, escrita en la misma reserva. Es la representación de un comprobante con varios receptores, que hoy solo tiene la guía; `fiscal` no conoce la guía ni su sustento.
- **Reserva:** `DocumentColumns` pasa a una unión: `{ receiver: "BUYER", buyerIdentification, buyerName, total }` o `{ receiver: "RECIPIENTS", recipients: [{ identification, name }] }`. Los cuatro tipos existentes usan la primera sin cambios de comportamiento.
- **Lectura:** `StoredDocument` expone `buyerIdentification`, `buyerName` y `total` como nulos posibles; `fiscal` exporta `documentBuyer(document)`, que los devuelve no nulos para los tipos con comprador y falla como invariante rota si faltan, y la usan las notas, la retención y la factura donde hoy los leen.
- **Bandeja:** `documentListItemSchema` cambia a `buyer: {…} | null`, `total: … | null` y `recipients: { count, name | null } | null`, con una refinación: el tipo `06` tiene comprador y total nulos y `recipients`, y los demás al revés. `name` es el del único destinatario y `null` si hay varios. El filtro por identificación es `buyer_identification = X OR EXISTS (destinatario con identificación X)`, y la búsqueda por nombre añade la misma rama; índice `(company_id, identification)` en la tabla de destinatarios.
- **Pruebas:** de base de datos (cada combinación prohibida del `CHECK`, el trigger de inmutabilidad con nulos, la tabla de destinatarios inmutable), de API (el contrato de la bandeja con una guía de uno y de varios destinatarios, y con los demás tipos sin cambios) y del frontend de la bandeja.
- **Alternativas descartadas:** guardar `0.00` y el primer destinatario (P10 lo prohíbe); leer los destinatarios del JSON del snapshot en la bandeja (sin índice para el filtro, y la bandeja leería un snapshot de 300 detalles por fila); una columna de conteo sin tabla (no permite filtrar por un destinatario).

### D11. Snapshot autosuficiente

Después de `RESERVED`, la verdad fiscal de la guía es su snapshot. Guarda:

- `snapshotVersion: 1`; el esquema (`06`, `1.1.0`, ruta, hash e imports); la versión del builder; las versiones de los datasets y de la configuración;
- la fecha de emisión, el ambiente y su código; el emisor vigente al reservar con sus leyendas y el establecimiento con su dirección;
- `departureAddress`, `transporter` (D3), `plate`, `transportStart` y `transportEnd`;
- `recipients`, cada uno con:
  - posición, `kind`, `partyId` o `establishmentId`, identificación, tipo de identificación (informativo, no va al XML), razón social, dirección, motivo, ruta y código de destino;
  - `support`: `INTERNAL_INVOICE` con `invoiceId`, tipo, número, fecha, número, fecha y ambiente de la autorización; o `DECLARED_EXCEPTION` con la declaración de D8;
  - `details`: posición, `productId` y el nombre del producto al reservar (informativo, no va al XML), códigos, descripción y cantidad canónica;
- `counts` (destinatarios y detalles);
- `key`: número, secuencial, código numérico, tipo de emisión y `accessKey`.

### D12. Evaluación, borrador y vista previa

- El borrador se guarda incompleto; la vista previa del servidor recalcula en este orden: punto y esquema; transportista (D3); placa (D4); fechas (D5); partida (D6); límites (D23); por destinatario: destinatario (D7), sustento (D8), detalles (D9); declaración requerida si hay excepciones.
- La vista previa devuelve por destinatario la identidad, la dirección final y el sustento resuelto (número, fecha y autorización de la factura, o el texto de la excepción); por detalle los códigos y la cantidad canónica; los conteos; `exceptionDeclarationRequired`; `evaluatedOn`; y `issues` con la posición del destinatario y del detalle.
- **Crear desde una factura:** `POST /drafts` acepta `{ fromInvoiceId }` y arma un borrador con un destinatario: el comprador de la factura si es un tercero activo `04`, `05` o `06`, si no vacío; el sustento con esa factura; y la precarga de D9. El usuario completa lo demás.

### D13. Transacción de la reserva y atomicidad

- **Antes de la transacción**, sin consumir nada: permiso, `Idempotency-Key` y empresa de la sesión; borrador con la versión esperada y repetición en el registro; esquema con su hash; la evaluación completa de D12; la declaración (D14); empresa configurada, punto disponible y firma utilizable.
- **Transacción de `RESERVED`**, sin I/O externo: bloquear el borrador y comprobar su estado y su versión; bloquear la configuración tributaria; volver a leer terceros, establecimientos, productos y facturas y volver a evaluar con la fecha de la reserva; armar el snapshot sin la clave; `reserveDocumentIn` con `06` y las columnas `RECIPIENTS`; registrar `shipping_guide` y sus destinatarios (D26); borrador `EMITTED`; registro de idempotencia; auditoría `shipping_guide.reserved`; commit.
- **Concurrencia:** las facturas no tienen capacidad que consumir. Dos guías sobre la misma factura son válidas a la vez; dos emisiones del mismo borrador se serializan por su bloqueo.
- **Todo o nada:** una prueba fuerza el fallo después de cada paso y comprueba que no quedan secuencial, clave, comprobante, destinatarios, registro, borrador emitido, idempotencia ni auditoría.

### D14. Declaración de las excepciones

- La emisión lleva `exceptionDeclaration: { policyVersion: 1 } | null`. Es obligatoria si algún destinatario tiene `DECLARED_EXCEPTION` (`SHIPPING_GUIDE_DECLARATION_REQUIRED`) y debe citar la versión vigente (`SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH`); sin excepciones debe ser nula.
- El actor es el usuario que emite y el momento el de la reserva. Se guardan en el snapshot, en `shipping_guide_recipient` y en la auditoría; nunca en el XML. La consulta la presenta como "declarada por" el usuario, nunca como verificada.

### D15. Numeración, clave e idempotencia

- **Numeración y clave:** tipo `06`, contador propio. La prueba de secuenciales independientes se extiende: factura, nota de crédito, nota de débito, retención y guía en el mismo punto, cada una el 1 de su contador, y la segunda factura el 2.
- **Idempotencia:** operación `shipping_guide.emit`, por empresa y clave, sin TTL, en la transacción.
- **Huella canónica:** `draftId`, `expectedVersion`, los datos funcionales de esa versión (punto, transportista, placa, partida, fechas, y cada destinatario en orden con su destinatario, textos, sustento y detalles) y la declaración. Claves ordenadas y posiciones explícitas.
- **Respuestas:** la misma huella devuelve la misma guía (`200`) y reanuda la firma si quedó reservada; otra huella, `409 IDEMPOTENCY_KEY_REUSED`; un borrador ya emitido con otra clave, `409 SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED`; sin clave, `400 IDEMPOTENCY_KEY_REQUIRED`.

### D16. Builder XML `guiaRemision` 1.1.0 y firma

- `sri-engine/infrastructure/shipping-guide-xml-builder.ts`, puro y determinista, versión de builder `1`, solo desde el snapshot, sin el builder de alto nivel de la dependencia. Reutiliza `xml-writer.ts` e `infoTributaria` con `codDoc` 06, `agenteRetencion` y `contribuyenteRimpe`.
- **Contenido, en el orden del XSD:**
  - `infoGuiaRemision`: `dirEstablecimiento`, `dirPartida`, `razonSocialTransportista`, `tipoIdentificacionTransportista`, `rucTransportista`, `obligadoContabilidad` y `contribuyenteEspecial` cuando corresponden, `fechaIniTransporte`, `fechaFinTransporte` y `placa`;
  - por destinatario: `identificacionDestinatario`, `razonSocialDestinatario`, `dirDestinatario`, `motivoTraslado`, `codEstabDestino` y `ruta` si existen, los cuatro datos del sustento solo para `INTERNAL_INVOICE`, y `detalles/detalle` con `codigoInterno` y `codigoAdicional` si existen, `descripcion` y `cantidad` canónica.
- **No escribe:** `rise`, `docAduaneroUnico`, `detallesAdicionales`, `maquinaFiscal` ni `infoAdicional`; ningún nodo vacío.
- El pipeline compartido valida contra `GuiaRemision_V1.1.0.xsd` antes y después de firmar; el firmador recibe el tipo `06`.
- **Pruebas:** golden fixtures de bytes exactos, todos validados contra el XSD oficial: transporte propio y tercero; un destinatario con factura; varios destinatarios con factura y excepciones; la propia empresa con su código de destino; ruta y código de un tercero; producto y línea libre; cantidades de 6 decimales y canónicas; textos con caracteres especiales; los máximos de longitud. Además, el XML firmado validado y el artefacto con el tipo `06`.

### D17. Snapshot, builder y lectura por versión

- El builder, el snapshot y la lectura del RIDE están versionados (`snapshotVersion`, versión de builder y `RIDE_SHIPPING_GUIDE_VERSION = "1.1.0"`) para que un cambio futuro no reescriba guías ya emitidas.

### D18. Transmisión y reconciliación

- Sin cambios en el transporte, la cola, la máquina de estados ni los clasificadores.
- Se repiten con una guía y respuestas SINTÉTICAS los casos de la transmisión: `RECIBIDA`, `DEVUELTA` (con el error 82 como mensaje), `AUTORIZADO`, `NO AUTORIZADO`, una respuesta sin estado, los errores 70, 43 y 45, `NOT_SENT` y `SEND_UNKNOWN`, la reconciliación automática y la manual, la revisión manual, la respuesta guardada antes de clasificar y su reclasificación sin otra llamada.
- La transmisión real queda apagada (`SRI_TRANSMISSION_ENABLED` falso) en todo el cambio. La prueba end-to-end usa el SRI simulado aislado.

### D19. Error 82

- La validación local de D5 lo previene. Si el SRI lo devolviera igual, la guía queda `RETURNED` con sus mensajes por la clasificación genérica; no hay corrección de devueltos en el MVP (`correct-returned-document`).

### D20. RIDE de la guía

- **Lectura:** `guiaRemision` 1.1.0 en `ride-source.ts`, con una lista blanca de los elementos de D16 y un modelo `RideShippingGuide` (`kind: "SHIPPING_GUIDE"`). `rise`, `docAduaneroUnico`, `detallesAdicionales`, `maquinaFiscal`, `infoAdicional` o un `codDocSustento` distinto de `01` detienen la generación (`RIDE_SOURCE_UNSUPPORTED`).
- **Distribución propia** según la ficha v2.34, anexo 2, página 64, versión de renderer `guia-remision-1`:
  - cabecera con RUC, "GUÍA DE REMISIÓN", número, número de autorización, fecha y hora de autorización, ambiente, emisión y clave con Code128;
  - emisor con sus leyendas;
  - bloque del transporte: identificación y razón social del transportista, placa, punto de partida, fecha de inicio y fecha de fin;
  - un bloque por destinatario: comprobante de venta (FACTURA y su número), su fecha de emisión y su autorización, motivo, destino (punto de llegada), identificación, razón social, documento aduanero, código del establecimiento de destino y ruta; los rótulos sin dato quedan vacíos, como en el modelo oficial;
  - la tabla del destinatario: Cantidad, Descripción, Código Principal y Código Auxiliar.

  Sin importes ni una fila para la fecha de emisión de la guía, que no está en el modelo. Cantidades como el texto del XML. Los bloques se paginan con el paginador vigente.
- **Reutiliza** pdfmake, bwip-js, Noto Sans, el pool, el job, el artefacto, las descargas y las entregas. No necesita etiquetas del snapshot: todo sale del XML.
- **Pruebas:** golden con el texto de las páginas y la lectura del Code128; varios destinatarios; destinatario sin factura; paginación con el máximo de filas; los mismos bytes en dos procesos; contenido no emitido que detiene la generación; el RIDE de los demás tipos sin cambios.

### D21. Bandeja y frontend compartido

- `EMITTED_DOCUMENT_TYPES = ["01", "04", "05", "06", "07"]` y `DOCUMENT_KINDS["06"]`: nombre "guía" en las frases compartidas, que concuerdan en femenino ("la guía", "firmada", "autorizada"); el filtro y la etiqueta dicen "Guía de remisión"; `/guias-remision` y `/shipping-guides`; `shippingGuides.reconcile` y `SHIPPING_GUIDE_NOT_RECONCILABLE`.
- La bandeja deriva el receptor: el comprador, o el nombre del único destinatario, o "N destinatarios". El total de una guía no se muestra: la celda lleva "—" con el texto accesible "Sin total monetario", y la tarjeta móvil omite la fila. `DocumentsSection` y `TransmissionSection` no cambian.

### D22. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/shipping-guides/carriers` | Terceros activos con el rol `CARRIER` y tipo 04, 05 o 06, cada uno con `selectable` y su motivo (identificación de más de 13 caracteres) | `shippingGuides.draft` |
| `GET /api/v1/shipping-guides/recipients` | Terceros activos con tipo 04, 05 o 06, sin el consumidor final, con cualquier rol | `shippingGuides.draft` |
| `GET /api/v1/shipping-guides/eligible-invoices` y `.../{invoiceId}/goods` | Facturas autorizadas de la empresa en su ambiente vigente, con búsqueda, y la precarga de D9 | `shippingGuides.draft` |
| `GET /api/v1/shipping-guides/options` | Casos de excepción con su texto y la versión de la política, establecimientos activos, identidad tributaria para `SELF`, límites efectivos y `evaluatedOn` | `shippingGuides.draft` |
| `GET/POST /api/v1/shipping-guides/drafts`, `GET/PUT/DELETE /api/v1/shipping-guides/drafts/{draftId}` | Borradores con su vista previa | `shippingGuides.draft` |
| `POST /api/v1/shipping-guides` | Emisión con `Idempotency-Key` (`201`, o `200` en la repetición) | `shippingGuides.emit` |
| `GET /api/v1/shipping-guides`, `GET /api/v1/shipping-guides/{shippingGuideId}` | Consulta y detalle, con búsqueda por número, transportista o identificación de un destinatario, y filtro de estado | `shippingGuides.read` |
| `GET /api/v1/shipping-guides/{shippingGuideId}/transmission` | Historial de la transmisión | `shippingGuides.read` |
| `POST /api/v1/shipping-guides/{shippingGuideId}/signing-attempts` | Reintento de firma | `shippingGuides.retrySigning` |
| `POST /api/v1/shipping-guides/{shippingGuideId}/reconciliations` | Reconciliación manual (`202`) | `shippingGuides.reconcile` |

- **Cuerpos estrictos:** un precio, un impuesto, `detallesAdicionales`, un documento aduanero, varias placas, un número o una autorización de sustento escritos a mano, un `companyId` o un código derivado (dirección y código de la propia empresa, códigos de un producto) se rechazan como campos no permitidos.
- **Emisión:** `{ draftId, expectedVersion, exceptionDeclaration }`.
- **Códigos de error** (además de los compartidos de la emisión):
  - transportista: `SHIPPING_GUIDE_CARRIER_REQUIRED`, `SHIPPING_GUIDE_CARRIER_INACTIVE`, `SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED`, `SHIPPING_GUIDE_CARRIER_IDENTIFICATION_TOO_LONG`, `SHIPPING_GUIDE_CARRIER_CONSUMER_FINAL` y `SHIPPING_GUIDE_CARRIER_FOREIGN_OUT_OF_SCOPE`;
  - placa, fechas y partida: `SHIPPING_GUIDE_PLATE_INVALID`, `SHIPPING_GUIDE_DATE_INVALID`, `SHIPPING_GUIDE_START_BEFORE_ISSUE`, `SHIPPING_GUIDE_END_BEFORE_START` y `SHIPPING_GUIDE_DEPARTURE_ADDRESS_INVALID`;
  - destinatarios: `SHIPPING_GUIDE_RECIPIENTS_REQUIRED`, `SHIPPING_GUIDE_RECIPIENT_INVALID`, `SHIPPING_GUIDE_RECIPIENT_INACTIVE`, `SHIPPING_GUIDE_RECIPIENT_CONSUMER_FINAL`, `SHIPPING_GUIDE_RECIPIENT_FOREIGN_OUT_OF_SCOPE`, `SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE`, `SHIPPING_GUIDE_MOTIVE_REQUIRED`, `SHIPPING_GUIDE_ADDRESS_REQUIRED` y `SHIPPING_GUIDE_DESTINATION_CODE_INVALID`;
  - sustento: `SHIPPING_GUIDE_SUPPORT_REQUIRED`, `SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED`, `SHIPPING_GUIDE_INVOICE_ENVIRONMENT_MISMATCH`, `SHIPPING_GUIDE_INVOICE_NOT_INTACT`, `SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH`, `SHIPPING_GUIDE_DECLARATION_REQUIRED` y `SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH`;
  - detalle: `SHIPPING_GUIDE_DETAILS_REQUIRED`, `SHIPPING_GUIDE_DESCRIPTION_INVALID`, `SHIPPING_GUIDE_CODE_INVALID`, `SHIPPING_GUIDE_PRODUCT_NOT_GOOD`, `SHIPPING_GUIDE_PRODUCT_INACTIVE` y `SHIPPING_GUIDE_QUANTITY_INVALID`;
  - límites y estado: `SHIPPING_GUIDE_RESOURCE_LIMIT` (con el límite y su naturaleza de defensa), `SHIPPING_GUIDE_DRAFT_INCOMPLETE`, `SHIPPING_GUIDE_DRAFT_CHANGED`, `SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED` y `SHIPPING_GUIDE_NOT_RECONCILABLE`.
- **Prueba de tipos emitidos:** `emitted-document-types.test.ts` exige `["/credit-notes", "/debit-notes", "/invoices", "/shipping-guides", "/withholding-receipts"]`, sin liquidación.

### D23. Límites de recursos (P9)

| Variable | Por defecto | Rango |
| --- | --- | --- |
| `SHIPPING_GUIDE_MAX_RECIPIENTS` | 10 | 1 a 50 |
| `SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT` | 50 | 1 a 100 |
| `SHIPPING_GUIDE_MAX_DETAILS` | 100 | 1 a 300 |

- Los máximos absolutos están en el contrato y los efectivos en el entorno, con el patrón de `INVOICE_MAX_LINES`. Los tres se aplican juntos: el global de detalles rige aunque destinatarios por detalles por destinatario permita más.
- **Naturaleza:** defensa de recursos del proyecto y nada más; nunca un límite del SRI, del XSD ni una interpretación de Q-47. Los errores y la interfaz lo dicen así. `deployment.md` documenta las variables.
- **Tamaño del XML como medición:** estimación previa con textos de longitud máxima, unos 65 KB con los valores por defecto y unos 230 KB con los máximos absolutos; el benchmark registra el valor real del XML firmado. Es solo una medición.
- Si el benchmark muestra que un valor por defecto no es sano, se corrige con `/opsx:update` y su evidencia antes de cerrar el apply.

### D24. Permisos y auditoría

- `shippingGuides.read`, `shippingGuides.draft`, `shippingGuides.emit` y `shippingGuides.retrySigning`: administrador y operador. `shippingGuides.reconcile`: solo el administrador (Q-22). La matriz va en `access-policy.ts`, su espejo del frontend y `access-control.md`. Crear un transportista o un destinatario usa `parties.manage`; la bandeja y las descargas, `archive.*`.
- **`shipping_guide.reserved`:** guía, número, clave, ambiente, origen del transportista con su identificación y su nombre, conteos de destinatarios y detalles, clases de sustento y cada excepción declarada con su caso y su versión. Sin direcciones, descripciones, placa, XML ni SOAP.
- **`shipping_guide.signed`**, **`shipping_guide.signing_retried`**, **`shipping_guide.reconciliation_requested`** y **`shipping_guide.reconciliation_completed`**. Sin eventos para borradores, consultas, transmisión automática ni entregas.

### D25. Pantallas

- **Guías de remisión** (`/guias-remision`, en "Operación", `shippingGuides.read`).
  - Brief: administrador u operador; el objetivo es encontrar una guía y su estado; la decisión es qué guía abrir.
  - Información mínima: número, destinatarios, transportista, fechas del transporte y estado.
  - Acción principal: abrir la guía; secundaria: "Nueva guía de remisión" (`shippingGuides.draft`).
  - P0 número y estado; P1 destinatarios ("N destinatarios" o el nombre), transportista y fecha de inicio; P2 búsqueda y filtro de estado en la URL, fecha de fin; P3 identificadores, que no se muestran.
  - `AppDataTable` con paginación del servidor y tarjetas por debajo de 768 px; los borradores en curso, con su eliminación.
- **Borrador** (`/guias-remision/borradores/nueva` y `/guias-remision/borradores/{id}`, `shippingGuides.draft`).
  - Brief: administrador u operador; el objetivo es documentar un traslado antes de que salga la mercadería, sin equivocar el destinatario, el sustento ni las fechas. Las decisiones son el transportista, la placa, las fechas, los destinatarios, el sustento de cada uno y lo que se traslada.
  - Información mínima: transportista, placa, fechas, partida, cada destinatario con su sustento y su detalle, y los problemas.
  - Acción principal: "Emitir guía de remisión".
  - P0 destinatarios con su sustento y su detalle, y los problemas que bloquean; P1 transportista, placa y fechas; P2 partida, punto, ruta y código de destino; P3 identificadores y versiones, que no se muestran.
  - Pasos y controles (`component-selection.md`):
    1. el transporte: origen con un `SegmentedControl` "Propio" / "Tercero"; el tercero con `EntityPickerDialog` (conjunto grande) filtrado a transportistas, con los no seleccionables deshabilitados y su motivo, y "Nuevo transportista" con `PartyDialog` y el rol marcado; la placa en un `Input`;
    2. las fechas de inicio y fin con `DatePickerField`, y la dirección de partida en un `Input` propuesto desde el establecimiento;
    3. los destinatarios: lista ordenada con agregar y quitar, en tarjetas; por destinatario, la clase con un `SegmentedControl` "Tercero" / "Establecimiento propio"; el tercero con `EntityPickerDialog` y "Nuevo destinatario" con `PartyDialog` sin roles; el establecimiento con un `Select` (conjunto pequeño, código y dirección); la dirección, el motivo, la ruta y el código de destino en `Input`, con la dirección y el código de solo lectura para el establecimiento propio;
    4. el sustento: `SegmentedControl` "Factura" / "Sin factura"; la factura con `EntityPickerDialog` de facturas elegibles y la acción "Cargar los bienes de la factura"; sin factura, un `RadioGroup` con los tres casos para un tercero y su texto oficial; el establecimiento propio fija la excepción de traslado entre establecimientos y la muestra de solo lectura;
    5. el detalle: filas en tabla desde 640 px y apiladas por debajo, con el producto en `EntityPickerDialog` (bienes activos) o línea libre, la descripción con el rótulo, la ayuda, el contador y la vista previa de D9, los códigos (de solo lectura con producto) y la cantidad decimal;
    6. la vista previa del servidor del borrador guardado, con los problemas junto a su destinatario y su detalle, y los límites presentados como defensa del sistema.
  - **Emisión:** un `ConfirmDialog` con el resumen (ambiente, transportista, placa, fechas, destinatarios con su sustento y conteo de detalles). Si hay excepciones declaradas, lista cada una con su texto y pide una casilla: "Declaro que los traslados sin factura corresponden a los casos indicados del art. 30 del Reglamento de Comprobantes". La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/guias-remision/{id}`, `shippingGuides.read`).
  - Brief: el objetivo es confirmar que la guía quedó autorizada y entregar sus documentos; la decisión es si reintentar la firma o pedir la reconciliación (administrador). Acción principal: descargar el RIDE de una guía autorizada, o reintentar la firma de una reservada.
  - P0 estado y número; P1 transportista, placa, fechas y destinatarios con su sustento (la factura con su enlace, o la excepción "declarada por" el usuario con su momento); P2 detalle de cada destinatario, partida, transmisión y documentos; P3 identificadores y hashes, que no se muestran.
- **Desde la factura:** en el detalle de una factura autorizada, la acción secundaria "Nueva guía de remisión" (`shippingGuides.draft`) crea el borrador de D12 y abre el editor.
- **Estados cubiertos:** carga, vacío, error, sin permiso, éxito, responsive, teclado, los dos temas y el doble clic que envía una sola emisión.

### D26. Migraciones

Dos migraciones aditivas, para que la cabecera común y la guía sean unidades separadas: `document_recipients_optional_totals` (los dos primeros puntos) y `add_shipping_guides` (el resto).

- **`electronic_document`:** `total`, `buyer_identification` y `buyer_name` admiten `NULL`; `electronic_document_values_check` con las igualdades de D10. Sin backfill: ninguna guía existe y las filas actuales cumplen el `CHECK`, que una prueba de migración verifica.
- **`electronic_document_recipient`:** empresa, comprobante, posición (desde 1), identificación (1 a 20) y nombre (1 a 300); clave `(document_id, position)`; FK compuesta al comprobante; índice `(company_id, identification)`; sin `UPDATE` ni `DELETE`.
- **`shipping_guide_draft`:** empresa, versión, estado `DRAFT`/`EMITTED`, comprobante, punto, transportista, placa, partida y fechas opcionales mientras se prepara, y `recipients` como `JSONB` validado por el contrato, con un `CHECK` de arreglo y de tamaño máximo como defensa. Un borrador emitido no cambia ni se borra.
- **`shipping_guide`:** una fila inmutable por guía con el origen, el tercero opcional, el tipo, la identificación (hasta 13) y el nombre del transportista, la placa, las fechas y los conteos, con sus `CHECK` (origen y tercero coherentes, fin no anterior al inicio, conteos positivos). Un trigger exige que el comprobante sea un `06` de la empresa y que el inicio no sea anterior a su fecha de emisión.
- **`shipping_guide_recipient`:** una fila inmutable por destinatario, con FK a `electronic_document_recipient`, la clase (`PARTY`/`OWN_COMPANY`), el tercero o el establecimiento, la clase de sustento, la factura opcional, el caso, la versión de la política, quién declaró y cuándo, con `CHECK` de coherencia (factura si y solo si `INTERNAL_INVOICE`; caso si y solo si `DECLARED_EXCEPTION`; `OWN_COMPANY` si y solo si `OWN_ESTABLISHMENT_TRANSFER`). Un trigger exige que la factura sea un `01` autorizado de la empresa y del ambiente de la guía.
- **Trigger de restricción diferido:** un comprobante `06` no se confirma sin su fila de `shipping_guide`, sin al menos un destinatario en las dos tablas, ni con conteos distintos. Es el mismo acoplamiento intencional de las notas y la retención, documentado en `database.md`.
- **Idempotencia:** `shipping_guide.emit` en el `CHECK` de `idempotency_record`.
- FK compuestas por empresa y sin índices parciales. `migrations.test.ts` y `database.md` las documentan.

### D27. Observabilidad

- `shipping_guide_reservations_total`: reservas confirmadas, sin etiquetas de empresa ni comprobante.
- `shipping_guide_recipients_total{support}`: destinatarios reservados por clase de sustento, con `internal_invoice` y `declared_exception` como únicos valores.
- Los logs registran identificadores, estados y códigos, nunca direcciones, placas, descripciones ni identificaciones (SEC-003). `observability.md` lo documenta.

### D28. Rendimiento

- **Server-Timing** con `EMISSION_STAGE_TIMINGS`, como los demás tipos; nunca en producción.
- **`bench:shipping-guides`**, fuera de `verify`, sobre un esquema aislado con 10 000 terceros (una parte con el rol `CARRIER`), 10 000 productos, 20 000 facturas autorizadas y 100 000 guías emitidas de uno a tres destinatarios (volumen de Q-26), con el barrido del RIDE apagado. Mide:
  - la búsqueda de transportistas, de destinatarios y de facturas elegibles, y la precarga de bienes;
  - la creación y la vista previa del peor caso con los valores por defecto (10 destinatarios, 100 detalles) y con los máximos absolutos (50 destinatarios, 300 detalles);
  - la reserva en serie y la del peor caso, con `reservation_tx` aparte del XML, el XSD y la firma;
  - 10 rondas de 10 emisiones simultáneas sobre la misma factura y sobre facturas distintas;
  - la lista y la búsqueda de guías, y la bandeja filtrada por la identificación de un destinatario;
  - el XML con su validación XSD y el tamaño firmado del peor caso, como medición;
  - el RIDE de una guía y el del máximo de filas, en `RideWorkerPool`;
  - CPU y memoria residente del backend;
  - al terminar, que ninguna guía creó movimientos de inventario ni cambió una factura.
- **Objetivos:** ERS RNF-005 (P95 menor que 2 s por operación) y el P95 del render del RIDE menor que 1 s, en el entorno registrado. El resultado va a `docs/quality/benchmarks/` y a `performance.md`, y valida P9 antes de cerrar el apply.

### D29. Operaciones sensibles

| Pregunta | Borrador y vista previa | Emisión (reserva) | Reintento de firma | Reconciliación manual |
| --- | --- | --- | --- | --- |
| Quién | `shippingGuides.draft` | `shippingGuides.emit` | `shippingGuides.retrySigning` | `shippingGuides.reconcile` (administrador) |
| Empresa | La de la sesión | La de la sesión | La de la sesión | La de la sesión |
| Propiedad | Borrador, terceros, establecimientos, productos y facturas por `(company_id, id)` | Igual, y los destinatarios por comprobante | Guía por `(company_id, id)` | Guía por `(company_id, id)` |
| ¿Otro ID llega a otra empresa? | No: `404` | No: `404` | No: `404` | No: `404` |
| Dos veces | Versión del borrador | `Idempotency-Key` y bloqueo del borrador | Arriendo de la firma | Una solicitud programada por guía |
| A la vez | Versión | Bloqueo del borrador y de la configuración | Arriendo | Bloqueo del comprobante |
| Restricciones | Contrato estricto y límites | `CHECK` de la cabecera, triggers de la guía, diferido del `06` e idempotencia | Estado `RESERVED` | Estado reconciliable |
| Auditoría | No | `shipping_guide.reserved` con las declaraciones | `shipping_guide.signing_retried` | `shipping_guide.reconciliation_*` |
| Fugas | Solo terceros, productos, establecimientos y facturas de la empresa | Sin direcciones, XML ni SOAP en la auditoría | Sin secretos | Sin SOAP |
| Pruebas de autorización | `403` sin permiso, `401` sin sesión, `404` con otra empresa | Igual, y un operador emite | Igual | `403` para el operador, `404` con otra empresa |

### D30. Trazabilidad de las fuentes

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `guiaRemision` 1.1.0, codDoc 06 | Oficial | XSD verificado (`guia-remision-xsd-verificacion.txt`); ficha v2.34, tabla 3 y anexo 3 |
| Un transportista (hasta 13 caracteres) y una placa (hasta 20) | Oficial | XSD y ficha v2.34, anexo 3, página 70 |
| Inicio no anterior a la emisión | Oficial | Ficha v2.34, página 38, error 82 |
| Fin no anterior al inicio; sin duración máxima | Validación del proyecto | Q-51 |
| Destinatario identificado, partida, destinos, conductor, placa, mercadería, motivo y fechas | Oficial | Reglamento, art. 30 |
| Comprobante de venta salvo las excepciones a) a e) | Oficial | Reglamento, art. 30, numeral 8 |
| Factura propia autorizada o excepción b, c, d o e declarada | Política del MVP (P1) | Q-51 |
| Traslado entre establecimientos propios con la empresa | Política del MVP (P2) | Q-51 |
| Destinatario 04, 05 o 06, sin rol obligatorio | Política del MVP (P3) | Q-51 |
| Transportista `SELF` o `PARTY` con `CARRIER` | Política del MVP (P4) | Q-51 |
| Placa sin formato vehicular | Política del MVP (P5) | Q-51; ficha, anexo 12 |
| Sin `detallesAdicionales`; unidad en la descripción | Política del MVP (P6) sobre el art. 30 | Q-51 |
| Cantidad mayor que cero | Política del MVP (P7) sobre el XSD | Q-51 |
| Sin inventario | Política del producto (P8) | Q-51 |
| Límites compuestos | Defensa de recursos (P9) | Q-51 |
| Sin total ni receptor único | Política del producto (P10) | Q-51 |
| RIDE | Oficial | Ficha v2.34, anexo 2, página 64 |
| Fuera: aduana, exterior, combustibles, máquina fiscal, factura sustitutiva, itinerante, interrupción, varios vehículos | Política del MVP | Reglamento, arts. 30 a 37; matriz de casos especiales |

## Risks / Trade-offs

- **Validaciones del SRI no documentadas** sobre la guía (formato de la placa, del RUC del transportista o del código de destino): el sistema no inventa reglas. → La certificación en Pruebas incluye guías con transporte propio y tercero, factura y excepciones; una regla que aparezca se propone con su fuente.
- **Excepciones declaradas mal usadas:** el sistema no puede comprobar una consignación o una exhibición. → Declaración explícita al emitir, con actor, momento y versión, presentada siempre como del usuario.
- **Cambiar la nulabilidad de la cabecera común** podría dejar pasar un comprobante sin total. → `CHECK` por tipo en la base, refinación del contrato de la bandeja, `documentBuyer` como guarda de invariante y los golden de los demás tipos sin cambios.
- **Bandeja con destinatarios:** la rama `EXISTS` del filtro podría degradar la consulta. → Índice por identificación y medición en el benchmark con 100 000 guías.
- **Precarga con el tipo vigente del producto:** un producto que cambió de bien a servicio no se precarga. → Es una propuesta editable; la guía congela su propio detalle.
- **Generalización:** tocar la bandeja, el RIDE, la reconciliación y la cabecera podría romper otros tipos. → Solo entradas por tipo y la unión de `DocumentColumns`; regresión de los cuatro tipos existentes.

## Migration Plan

- Desplegar las dos migraciones aditivas y el código. Las filas existentes cumplen el nuevo `CHECK`; ninguna guía existe.
- Retroceso: mientras no exista ninguna guía, las migraciones se revierten restituyendo `NOT NULL` y el `CHECK` anterior y eliminando las tablas nuevas. Con guías emitidas no se revierte: los comprobantes autorizados nunca se borran.
