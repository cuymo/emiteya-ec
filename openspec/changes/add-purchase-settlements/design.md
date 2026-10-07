# Design

## Context

La liquidación de compra de bienes y prestación de servicios (`codDoc` 03) es el sexto comprobante del MVP (ERS RF-250..253, CTX §17). La emite la empresa como adquirente, y solo procede en los casos del art. 13 del Reglamento de Comprobantes de Venta. Q-12 está resuelta (2026-10-07): el MVP soporta únicamente el caso c), compras de bienes muebles o servicios a una persona natural no obligada a llevar contabilidad, sin RUC o con RUC suspendido, que por su nivel cultural o rusticidad no puede emitir comprobantes de venta. Las decisiones de alto nivel están en `docs/architecture/fiscal-emission.md` ("Decisiones para el diseño de `add-purchase-settlements`"), las reglas de negocio en `docs/product/domain-model.md` (BR-38, BR-88 a BR-95) y la trazabilidad en `docs/product/capabilities.md`.

Fuentes preservadas en `docs/product/sri-catalogs/fuentes/`:

- XSD `LiquidacionCompra_V1.1.0.xsd`, idéntico byte a byte al oficial y al del registro de esquemas (`liquidacion-compra-xsd-verificacion.txt`).
- Ficha técnica v2.34: tablas 3, 6, 16, 17 y 24, anexo 17 (páginas 115 a 122) y anexo 2, página 65 (`ficha-v2.34-liquidacion-de-compra.txt`).
- Reglamento de Comprobantes de Venta vigente (edición del 2023-12-29), arts. 1, 8, 13, 17, 22 y 40 (`reglamento-comprobantes-liquidacion-de-compra.txt`).
- LRTI, RALRTI, NAC-DGERCGC20-00000061, NAC-DGERCGC26-00000009 y las resoluciones de emisión electrónica (`normativa-liquidacion-retenciones.txt`).

Lo que ya existe y este cambio reutiliza: el contador `03` (`add-fiscal-numbering`), la entrada `03` del registro de esquemas (`supported: true`), el XSD en el paquete del build, la reserva, la firma, la transmisión, la reconciliación, la bandeja, el RIDE y las entregas. El cambio no implementa los demás casos del art. 13, la retención, el inventario ni compras.

## Goals / Non-Goals

**Goals:**

- Emitir la liquidación de compra 1.1.0 en el caso c), con cuatro declaraciones de procedencia del usuario y los hechos que el sistema conoce verificados.
- Un cálculo versionado único (vista previa, snapshot, XML y RIDE) sobre primitivas compartidas con la factura, sin cambiar los importes de la factura.
- Reutilizar el pipeline fiscal sin un camino paralelo, y un RIDE propio con la distribución oficial.
- Verificar el firmador privado del tipo 03 antes de construir sobre él.

**Non-Goals:**

- Los casos a), b), d), e), f), g) a k) y l) del art. 13 y de la LRTI; proveedores con RUC activo; casos derogados.
- Emitir, precargar o asociar el comprobante de retención; movimientos de inventario; compras, cuentas por pagar o facturas recibidas.
- Reembolsos, máquina fiscal, negociable, subsidios, detalles adicionales, información adicional, ICE e IRBPNR.
- Una representación neutral de la contraparte en el comprobante genérico (deuda técnica registrada).

## Decisions

### D1. Módulo `purchase-settlements` y dirección de las dependencias

- Módulo nuevo `purchase-settlements` con `domain/`, `application/` e `infrastructure/`, como `shipping-guides`.
- Depende de operaciones exportadas de `fiscal` (reserva, documentos, artefactos, firma, transmisión, reconciliación y las primitivas de importes de D8), de `taxpayer`, de `catalogs` y de `signing`. Lee terceros y productos por puertos que compone `main.ts`: `PurchaseSupplierReader` (sobre `parties`) y `PurchaseProductReader` (sobre `products`).
- `fiscal`, `invoices`, `inventory`, `credit-notes`, `debit-notes`, `withholding-receipts` y `shipping-guides` no importan `purchase-settlements`, y `purchase-settlements` no importa `invoices`, `inventory`, `parties`, `products` ni otro comprobante. Una prueba de arquitectura comprueba ambas direcciones.
- **Alternativa descartada:** extender `invoices`. La liquidación la emite el adquirente, tiene su procedencia propia y sus pagos con plazo; ERS RF-253 exige un flujo separado (ADR 0002).

### D2. Qué se reutiliza y qué queda por tipo

| Pieza | Decisión |
| --- | --- |
| Reserva | `reserveDocumentIn` con `documentType: "03"` y las columnas `BUYER`: identificación y nombre del proveedor como contraparte, e importe total |
| Firma | `documentSigning.pipeline(purchaseSettlementSigningProfile())`: builder desde el snapshot y auditoría `purchase_settlement.signed`; firmador, XSD antes y después, artefacto, transición y encolado de `fiscal` |
| Transmisión | Sin cambios |
| Reconciliación manual | `requestReconciliationIn`, y `"03": purchase_settlement.reconciliation_completed / purchaseSettlementId` en `COMPLETED_AUDIT` |
| Idempotencia | `purchase_settlement.emit` en `IDEMPOTENT_OPERATIONS` y en el `CHECK` |
| Cálculo | Primitivas de importes movidas de `invoices/domain/amounts.ts` a `fiscal` (D8) |
| RIDE | Lectura y distribución nuevas para `liquidacionCompra` 1.1.0, por raíz y versión, sobre el mismo pool, job y artefacto (D19) |
| Bandeja | `"03"` en `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS`, con la contraparte rotulada "Proveedor" (D20) |
| Por tipo | Borrador, evaluación, declaraciones, snapshot, builder XML, distribución del RIDE, rutas y pantallas |

- **Regresión protegida:** el contrato y los golden del XML y del RIDE de la factura, las notas, la retención y la guía pasan sin cambios.

### D3. Procedencia y declaraciones (Q-12)

- **Política** en `packages/contracts`: `PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY = { id: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1", case: "ART_13_C_RUSTICITY_NO_ACTIVE_RUC", version: 1, source: "Reglamento de Comprobantes de Venta, art. 13, letra c)" }` y sus cuatro declaraciones con identificador y texto visible:
  - `NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING`: "El proveedor es una persona natural no obligada a llevar contabilidad.";
  - `NO_RUC_OR_SUSPENDED_RUC`: "El proveedor no está inscrito en el RUC o tiene su RUC suspendido a la fecha de la transacción.";
  - `UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY`: "Por su nivel cultural o rusticidad, el proveedor no puede emitir comprobantes de venta.";
  - `MOVABLE_GOODS_OR_SERVICES_TRANSACTION`: "La operación corresponde a la adquisición de bienes muebles o servicios."
- **Emisión:** `{ draftId, expectedVersion, declarations: { policyVersion, statements } }`. Exige la versión vigente (`PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH`) y el conjunto exacto de las cuatro, sin repetidos (`PURCHASE_SETTLEMENT_DECLARATION_REQUIRED`, con la primera que falta); un identificador desconocido es un error de contrato. Es el patrón de la nota de crédito (design D9 de `add-credit-notes`), sin una casilla genérica.
- **Congelado:** el actor es quien emite y el momento el de la reserva. El snapshot guarda `eligibility: { case: "ART_13_C", policy, policyVersion, declarations: [{ statementId, policyVersion, basis: "USER_DECLARED", declaredBy, declaredByName, declaredAt }] }` y el registro de la base una fila por declaración. Forman parte de la huella de idempotencia y de la auditoría (por identificador). Nunca `SYSTEM_VERIFIED`, nunca en el XML, y el sistema no consulta el estado del RUC.
- **Hechos verificados por el sistema:** la preparación de la empresa y su configuración; el tercero activo con el rol `SUPPLIER` e identificado con 05 o 06; los productos activos de la empresa; el cálculo y los catálogos; el secuencial y la clave. Una exclusión conocida (consumidor final, RUC, exterior) se evalúa antes y no depende de las declaraciones.

### D4. Proveedor

- `supplierPartyId` en el borrador: tercero de la empresa por `(company_id, id)`, en este orden: existe (`404` igual que inexistente); activo (`PURCHASE_SETTLEMENT_SUPPLIER_INACTIVE`); no es el consumidor final (`PURCHASE_SETTLEMENT_SUPPLIER_CONSUMER_FINAL`); tipo 05 o 06 (`PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED` para 04 y 08, con el texto de que es una restricción del MVP para el caso c); rol `SUPPLIER` (`PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED`, que dice que se configure en Terceros).
- Nunca se asigna el rol. El editor ofrece "Nuevo proveedor" con `PartyDialog` y el rol `SUPPLIER` marcado a la vista: el usuario lo guarda de forma explícita con `parties.manage`.
- El snapshot congela `{ partyId, identificationType, identification, legalName, address }`. Después de `RESERVED` no se relee el tercero.

### D5. Dirección del proveedor

- `supplierAddress` en el borrador: al elegir el proveedor, si el campo está vacío, el borrador propone la dirección del tercero; el usuario puede corregirla. Obligatoria al emitir (`PURCHASE_SETTLEMENT_ADDRESS_REQUIRED`), de 1 a 300 caracteres medidos ya sin los espacios de los extremos y sin saltos de línea (art. 22, num. 1; XSD `direccionProveedor`).

### D6. Líneas

- Cada línea: `{ productId | null, mainCode, auxiliaryCode, description, unit, quantity, unitPrice, discount, ivaRateCode }`.
- **Producto opcional:** activo y de la empresa (bien o servicio; la procedencia cubre ambos). Solo sugiere en la interfaz su código y su nombre como descripción, y su tarifa de IVA; los datos de la línea son los que el usuario confirma. El servidor congela el `productId` como referencia y no lee su precio (`PURCHASE_SETTLEMENT_PRODUCT_INACTIVE`, `404` si no existe).
- **Textos:** `mainCode` y `auxiliaryCode` opcionales (1 a 25), `description` obligatoria (1 a 300), `unit` opcional (1 a 50), sin saltos de línea y recortados (XSD; art. 22, num. 2, con la serie o el motor dentro de la descripción).
- **Números** (`decimalString`): `quantity` mayor que cero (`cantidad`, 18/6; política del proyecto), `unitPrice` desde cero (`precioUnitario`, 18/6), `discount` desde 0.00 hasta el subtotal (`importe`, 14/2), siempre materializado.
- Sin `precioSinSubsidio` ni `detallesAdicionales`: el contrato es estricto.

### D7. IVA

- `ivaRateCode` es la clave de entrada del catálogo `iva-rate`; el servidor resuelve la entrada vigente en la fecha de emisión (la vista previa con la de hoy y la reserva con la suya) y congela `{ taxCode: "2", rateCode, percentage, catalogType: "iva-rate", entryKey, versionId, officialLabel }`.
- Una tarifa no vigente en esa fecha rechaza la emisión (`PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE`). El 0 %, no objeto y exento conservan su código propio y su subtotal separado, como en la factura.
- Sin ICE ni IRBPNR: el XSD admite solo `codigo` 2 en líneas y totales.

### D8. Cálculo

- **Equivalencia demostrada:** las fórmulas del anexo 17 (precio total sin impuesto = cantidad × precio unitario − descuento; total sin impuestos = suma de bases; IVA por tarifa; importe total = total sin impuestos + IVA) son las de la factura sin propina, ICE ni IRBPNR, y las primitivas de `invoices/domain/amounts.ts` no dependen de nada propio de la factura.
- **Extracción:** `materializeMoney`, `lineSubtotal`, `lineDiscount`, `taxableBase`, `taxAmount`, `lineAmounts` y los totales pasan a `fiscal/domain/document-amounts.ts`; `invoices` los importa de ahí con los mismos nombres (y `InvoiceAmountError` como alias del error compartido). Las pruebas de importes, el contrato de regresión y los golden de la factura deben pasar sin cambios: si la extracción amenaza una regresión, se descarta y la liquidación usa un cálculo propio versionado.
- **Cálculo de la liquidación:** `calculatePurchaseSettlementAmounts`, versión `purchase-settlement-amounts-1`, sobre esas primitivas: tres puntos de materialización HALF_UP (base de la línea, IVA de la línea y totales), decimales exactos y nunca `number`. Es la única autoridad: la vista previa lo llama, el snapshot guarda su resultado y su versión, y el XML y el RIDE escriben lo que el snapshot guarda (error 52 de la ficha).

### D9. Pagos, plazo, unidad de tiempo y moneda

- Cada pago: `{ paymentMethod, total, term, timeUnit }`, todos obligatorios en el MVP aunque el XSD deje `plazo` y `unidadTiempo` opcionales, porque la ficha exige `pagos` y `plazo` (anexo 17).
  - `paymentMethod`: entrada habilitada del catálogo `payment-method` (tabla 24: 01 y 15 a 21), congelada con su denominación;
  - `total`: `importe` (14/2), desde 0.00, el dominio del XSD y de la factura;
  - `term` (`plazo`): decimal desde cero, hasta 14 dígitos y 2 decimales (XSD `plazo`);
  - `timeUnit` (`unidadTiempo`): texto de 1 a 10 caracteres, sin saltos de línea, recortado (XSD; la ficha no publica un catálogo). La interfaz puede ofrecer atajos como "días" o "meses", pero nunca un valor por defecto: el usuario lo escribe o elige.
- La suma exacta de los `total` es igual al importe total (`PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH`, con la diferencia).
- Moneda `DOLAR`, la constante que ya escriben la factura y la nota de crédito: política monetaria del proyecto, sin multimoneda.

### D10. Aviso de la retención

- Texto fijo en la vista previa y en el detalle: "Esta operación requiere la retención correspondiente conforme a la normativa aplicable." Sin datos, sin estado y sin enlace que sugiera que la retención existe.
- Sin emisión, precarga ni asociación del comprobante de retención; la emisión no espera ninguno. `internal-purchase-settlement-withholding-link` queda como capacidad futura que nunca reescribirá snapshots históricos.

### D11. Snapshot autosuficiente

Guarda: `snapshotVersion: 1`; el esquema (`03`, `1.1.0`, ruta, hash e imports); la versión del builder; las versiones de los datasets y de la configuración; la fecha de emisión, el ambiente y su código; el emisor vigente al reservar con sus leyendas, el establecimiento con su dirección y el punto; el proveedor (D4, D5); `eligibility` (D3); las líneas con su posición, su producto opcional, sus códigos, su descripción, su unidad, su cantidad, su precio, su descuento y su IVA congelado; los importes y la versión del cálculo (D8); los pagos con su denominación (D9); la moneda; y `key` (número, secuencial, código numérico, tipo de emisión y `accessKey`).

### D12. Evaluación, borrador y vista previa

- El borrador se guarda incompleto; la vista previa recalcula en este orden: punto y esquema; proveedor (D4); dirección (D5); límites (D22); líneas (D6, D7); cálculo (D8); pagos (D9).
- Devuelve los importes calculados, el proveedor resuelto, las cuatro declaraciones con su texto y la versión de la política, el aviso de la retención, `evaluatedOn` e `issues` con la posición de la línea o del pago.

### D13. Transacción de la reserva y atomicidad

- **Antes de la transacción**, sin consumir nada: permiso, `Idempotency-Key` y empresa de la sesión; borrador con la versión esperada y repetición en el registro; esquema con su hash; la evaluación completa de D12; las declaraciones (D3); empresa configurada, punto disponible y firma utilizable.
- **Transacción de `RESERVED`**, sin I/O externo: bloquear el borrador; bloquear la configuración tributaria; volver a leer el proveedor, los productos y el catálogo y evaluar con la fecha de la reserva; armar el snapshot sin la clave; `reserveDocumentIn` con `03` y las columnas `BUYER`; registrar la liquidación y sus cuatro declaraciones (D25); borrador `EMITTED`; idempotencia; auditoría `purchase_settlement.reserved`; commit.
- **Todo o nada:** una prueba fuerza el fallo después de cada paso y comprueba que no quedan secuencial, clave, comprobante, registro, declaraciones, borrador emitido, idempotencia ni auditoría.

### D14. Numeración, clave e idempotencia

- **Numeración:** tipo `03`, contador propio. La prueba de secuenciales independientes cubre 01, 03, 04, 05, 06 y 07 en el mismo punto.
- **Idempotencia:** operación `purchase_settlement.emit`, por empresa y clave, sin TTL, en la transacción. La huella canónica cubre `draftId`, `expectedVersion`, los datos funcionales de esa versión (punto, proveedor, dirección, líneas y pagos en orden, con posiciones explícitas) y `declarations` con su versión. Misma huella: `200` con la misma liquidación; otra: `409 IDEMPOTENCY_KEY_REUSED`; borrador ya emitido con otra clave: `409 PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED`; sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.

### D15. Builder XML `liquidacionCompra` 1.1.0

- `sri-engine/infrastructure/purchase-settlement-xml-builder.ts`, puro y determinista, versión de builder `1`, solo desde el snapshot. Reutiliza `xml-writer.ts` e `infoTributaria` con `codDoc` 03, `agenteRetencion` y `contribuyenteRimpe`. Raíz con `id="comprobante"` y `version="1.1.0"`.
- **En el orden del XSD:** `infoLiquidacionCompra` (`fechaEmision`, `dirEstablecimiento`, `contribuyenteEspecial` y `obligadoContabilidad` cuando corresponden, `tipoIdentificacionProveedor`, `razonSocialProveedor`, `identificacionProveedor`, `direccionProveedor`, `totalSinImpuestos`, `totalDescuento`, `totalConImpuestos/totalImpuesto` con `codigo`, `codigoPorcentaje`, `baseImponible`, `tarifa` y `valor`, `importeTotal`, `moneda` y `pagos/pago` con `formaPago`, `total`, `plazo` y `unidadTiempo`); `detalles/detalle` (`codigoPrincipal` y `codigoAuxiliar` si existen, `descripcion`, `unidadMedida` si existe, `cantidad`, `precioUnitario`, `descuento`, `precioTotalSinImpuesto` e `impuestos/impuesto` con `codigo`, `codigoPorcentaje`, `tarifa`, `baseImponible` y `valor`).
- **No escribe:** `reembolsos` ni sus totales, `codDocReembolso`, `descuentoAdicional`, `precioSinSubsidio`, `detallesAdicionales`, `tipoNegociable`, `maquinaFiscal` ni `infoAdicional`; ningún nodo vacío.
- **Pruebas:** golden de bytes exactos, todos validados contra el XSD oficial: cédula y pasaporte; producto y línea libre; varias tarifas de IVA, incluido el 0 %; descuentos; cantidades y precios de 6 decimales; varios pagos con plazo; textos con caracteres especiales; longitudes máximas.

### D16. Firma (ADR 0018)

- La librería firma el 03 con un import privado de `ec-sri-invoice-signer@1.8.2` (`LIQUIDACION_COMPRA`). Su prueba de contrato es la **primera tarea técnica del apply**: firma un XML sintético 03 con un P12 de fixtures, comprueba la firma XAdES con el pipeline y la valida contra el XSD. Si el mapeo no funciona con el pipeline, es un bloqueo real: se detiene el apply y se reporta. No se migra a la API de alto nivel.
- El firmador recibe el tipo `03` por `COD_DOC_TO_DOCUMENT_TYPE`.

### D17. Versiones

- El snapshot, el builder, el cálculo y la lectura del RIDE están versionados (`snapshotVersion`, versión de builder, `purchase-settlement-amounts-1` y `RIDE_PURCHASE_SETTLEMENT_VERSION = "1.1.0"`) para que un cambio futuro no reescriba liquidaciones emitidas.

### D18. Transmisión y reconciliación

- Sin cambios en el transporte, la cola, la máquina de estados ni los clasificadores; los servicios del SRI son los mismos para el 03 y no hay códigos de error propios del tipo (ficha, páginas 36 a 38).
- Se repiten con una liquidación y respuestas SINTÉTICAS los casos de la transmisión: `RECIBIDA`, `DEVUELTA`, `AUTORIZADO`, `NO AUTORIZADO`, los errores 70, 43 y 45, `NOT_SENT`, `SEND_UNKNOWN`, la revisión manual, la respuesta guardada antes de clasificar, la reconciliación automática y la manual.
- La transmisión real queda apagada (`SRI_TRANSMISSION_ENABLED` falso) en todo el cambio; la prueba end-to-end usa el SRI simulado aislado.

### D19. RIDE de la liquidación

- **Lectura:** `ride-source.ts` lee `liquidacionCompra` 1.1.0 por raíz y versión con una lista blanca de lo que escribe el builder; un elemento fuera de ella (reembolsos, máquina fiscal, negociable, subsidios, detalles adicionales, información adicional, un impuesto distinto del IVA) detiene la generación indicándolo.
- **Distribución propia** según la ficha v2.34, anexo 2, página 65, versión `liquidacion-compra-1`: cabecera con "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS", número, autorización, ambiente, emisión y clave con su Code128; el emisor con sus leyendas; el bloque del proveedor (razón social o nombres y apellidos, identificación, fecha de emisión y dirección); el detalle (código principal, código auxiliar, cantidad, descripción, precio unitario, descuento y precio total); la forma de pago con su valor; y los subtotales llenados por tratamiento de IVA, el subtotal sin impuestos, el IVA por tarifa y el valor total.
- **No imprime** lo que la liquidación 1.1.0 no tiene aunque el dibujo de la página 65 lo herede de la factura: "Placa / Matrícula", "Guía Remisión", "Detalle Adicional", "Subsidio" y "Precio sin Subsidio". No reutiliza la factura cambiando el título.
- **Pruebas:** golden del texto de las páginas, el Code128 legible, la paginación del máximo de líneas y el rechazo de contenido no admitido.

### D20. Bandeja y frontend compartido

- `"03"` en `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` (sustantivo "liquidación", femenino; ruta `/liquidaciones-compra`). El contrato de la bandeja no cambia: la liquidación tiene comprador (su proveedor como contraparte) y total.
- El nombre de las descargas (`fiscal/application/archive/filenames.ts`, `liquidacion-de-compra`) y la etiqueta del tipo (`DOCUMENT_TYPE_LABELS`, "Liquidación de compra") ya incluyen el 03; una prueba de la bandeja los fija para la liquidación.
- La contraparte se rotula "Proveedor" para el 03, nunca "Comprador". Las columnas genéricas del comprador se reutilizan provisionalmente (deuda técnica registrada en `technical-debt.md`); no hay refactor de la contraparte en este cambio.

### D21. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/purchase-settlements/suppliers` | Terceros activos con el rol `SUPPLIER` y tipo 05 o 06, cada uno con `selectable` y su motivo | `purchaseSettlements.draft` |
| `GET /api/v1/purchase-settlements/products` | Productos activos de la empresa con sus códigos, su nombre y su tarifa de IVA como sugerencia | `purchaseSettlements.draft` |
| `GET /api/v1/purchase-settlements/options` | Política de procedencia con sus declaraciones y su versión, tarifas de IVA y formas de pago vigentes, límites efectivos, puntos utilizables y `evaluatedOn` | `purchaseSettlements.draft` |
| `GET/POST /api/v1/purchase-settlements/drafts`, `GET/PUT/DELETE /api/v1/purchase-settlements/drafts/{draftId}` | Borradores con su vista previa; `POST` y `PUT` admiten un cuerpo de hasta 4 MiB (D22) | `purchaseSettlements.draft` |
| `POST /api/v1/purchase-settlements` | Emisión con `Idempotency-Key` (`201`, o `200` en la repetición) | `purchaseSettlements.emit` |
| `GET /api/v1/purchase-settlements`, `GET /api/v1/purchase-settlements/{purchaseSettlementId}` | Consulta y detalle, con búsqueda por número o por la identificación o el nombre del proveedor, y filtro de estado | `purchaseSettlements.read` |
| `GET /api/v1/purchase-settlements/{purchaseSettlementId}/transmission` | Historial de la transmisión | `purchaseSettlements.read` |
| `POST /api/v1/purchase-settlements/{purchaseSettlementId}/signing-attempts` | Reintento de firma | `purchaseSettlements.retrySigning` |
| `POST /api/v1/purchase-settlements/{purchaseSettlementId}/reconciliations` | Reconciliación manual (`202`) | `purchaseSettlements.reconcile` |

- **Cuerpos estrictos:** un `companyId`, un total, un impuesto distinto del IVA, un reembolso, un subsidio, detalles adicionales, información adicional o una declaración desconocida se rechazan como campos no permitidos.
- **Borrador:** `{ emissionPointId, supplierPartyId, supplierAddress, lines, payments }`. **Emisión:** `{ draftId, expectedVersion, declarations: { policyVersion, statements } }`.
- **Códigos de error** (además de los compartidos de la emisión): `PURCHASE_SETTLEMENT_NOT_FOUND`, `PURCHASE_SETTLEMENT_DRAFT_NOT_FOUND`, `PURCHASE_SETTLEMENT_SUPPLIER_REQUIRED`, `PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND`, `PURCHASE_SETTLEMENT_SUPPLIER_INACTIVE`, `PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED`, `PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED`, `PURCHASE_SETTLEMENT_SUPPLIER_CONSUMER_FINAL`, `PURCHASE_SETTLEMENT_ADDRESS_REQUIRED`, `PURCHASE_SETTLEMENT_LINES_REQUIRED`, `PURCHASE_SETTLEMENT_DESCRIPTION_INVALID`, `PURCHASE_SETTLEMENT_CODE_INVALID`, `PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND`, `PURCHASE_SETTLEMENT_PRODUCT_INACTIVE`, `PURCHASE_SETTLEMENT_QUANTITY_INVALID`, `PURCHASE_SETTLEMENT_PRICE_INVALID`, `PURCHASE_SETTLEMENT_DISCOUNT_EXCEEDS_SUBTOTAL`, `PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE`, `PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE`, `PURCHASE_SETTLEMENT_PAYMENTS_REQUIRED`, `PURCHASE_SETTLEMENT_PAYMENT_METHOD_INVALID`, `PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED`, `PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH`, `PURCHASE_SETTLEMENT_DECLARATION_REQUIRED`, `PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH`, `PURCHASE_SETTLEMENT_RESOURCE_LIMIT`, `PURCHASE_SETTLEMENT_DRAFT_INCOMPLETE`, `PURCHASE_SETTLEMENT_DRAFT_CHANGED`, `PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED` y `PURCHASE_SETTLEMENT_NOT_RECONCILABLE`. El rechazo nombra la línea o el pago cuando el problema está en ellos.
- **Prueba de tipos emitidos:** `emitted-document-types.test.ts` exige los seis prefijos, con `/purchase-settlements`.

### D22. Límites de recursos y cuerpo del borrador

| Variable | Por defecto | Rango |
| --- | --- | --- |
| `PURCHASE_SETTLEMENT_MAX_LINES` | 100 | 1 a 1000 |
| `PURCHASE_SETTLEMENT_MAX_PAYMENTS` | 10 | 1 a 20 |

- Los máximos absolutos están en el contrato y los efectivos en el entorno, con el patrón de `INVOICE_MAX_LINES`. Son defensas de recursos del producto; nunca límites del SRI, del XSD ni de Q-47. `bench:purchase-settlements` los confirma antes del archive, o se corrigen con `/opsx:update` y su evidencia.
- **Cuerpo del borrador:** un borrador con los valores por defecto y textos multibyte de longitud máxima mide unos 128 KB (más que el límite global de 100 KB), y uno con los máximos absolutos unos 1,21 MiB, o 2,51 MiB con cada carácter escapado como `\u`. Por eso `POST` y `PUT` de los borradores leen su cuerpo con un límite propio de 4 MiB (`jsonBodyExceptions`, como la guía de remisión); las demás rutas JSON sin límite propio, también la emisión, conservan el límite global de 100 KB. Es una defensa de recursos HTTP del proyecto, no un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47. Un cuerpo de más de 4 MiB recibe `413` antes del dominio; dentro, rigen el contrato y estos límites.
- **Tamaño del XML como medición:** el benchmark registra el tamaño del XML firmado del peor caso; es solo una medición.

### D23. Permisos y auditoría

- `purchaseSettlements.read`, `purchaseSettlements.draft`, `purchaseSettlements.emit` y `purchaseSettlements.retrySigning`: administrador y operador; `purchaseSettlements.reconcile`: solo el administrador (Q-22). La matriz va en `access-policy.ts`, su espejo del frontend y `access-control.md`. Crear un proveedor usa `parties.manage`; la bandeja y las descargas, `archive.*`. Quien emite confirma las declaraciones.
- **`purchase_settlement.reserved`:** liquidación, número, clave, ambiente, caso de procedencia, versión de la política e identificadores de las declaraciones, número de líneas, número de pagos e importe total. Sin descripciones, direcciones, XML, SOAP ni secretos.
- **`purchase_settlement.signed`**, **`purchase_settlement.signing_retried`**, **`purchase_settlement.reconciliation_requested`** y **`purchase_settlement.reconciliation_completed`**. Sin eventos para borradores, consultas, transmisión automática ni entregas.

### D24. Pantallas

- **Liquidaciones de compra** (`/liquidaciones-compra`, en "Operación", `purchaseSettlements.read`).
  - Brief: administrador u operador; el objetivo es encontrar una liquidación y su estado; la decisión es cuál abrir.
  - Información mínima: número, proveedor, fecha, importe total y estado.
  - Acción principal: abrir la liquidación; secundaria: "Nueva liquidación de compra" (`purchaseSettlements.draft`).
  - P0 número y estado; P1 proveedor, fecha e importe total; P2 búsqueda y filtro de estado en la URL; P3 identificadores, que no se muestran.
  - Borradores en curso con su eliminación confirmada.
- **Borrador** (`/liquidaciones-compra/borradores/{id}` y `/nueva`, `purchaseSettlements.draft`).
  - Brief: documentar una compra a un proveedor sin comprobante sin equivocar su procedencia ni sus importes; decisión, proveedor, líneas y pagos.
  - Pasos: punto de emisión; proveedor (`EntityPickerDialog` sobre `/suppliers`, con los no seleccionables deshabilitados y su motivo, y "Nuevo proveedor") y su dirección; líneas (producto opcional con `EntityPickerDialog` o línea libre, IVA con `Select`, cantidades y precios con entrada decimal); pagos (forma de pago, total, plazo y unidad de tiempo, con la diferencia frente al importe total visible); vista previa del servidor con los importes, los problemas por línea o pago y el aviso de la retención.
  - **Emisión:** un diálogo con las cuatro declaraciones, cada una con su texto completo y su propio `Checkbox`, que deben marcarse todas; el texto aclara que son declaraciones del usuario que el sistema no puede comprobar. Sin una casilla genérica.
  - P0 proveedor, importe total y problemas; P1 líneas, pagos y declaraciones; P2 códigos y unidades; P3 identificadores.
- **Detalle** (`/liquidaciones-compra/{id}`, `purchaseSettlements.read`): estado, proveedor congelado, líneas, IVA por tarifa, pagos con plazo, las declaraciones "declaradas por" el usuario con su momento, el aviso de la retención, el diagnóstico y el reintento de firma, la transmisión y los documentos.
- **Comprobantes:** el tipo 03 con su enlace al detalle y la contraparte rotulada "Proveedor".
- Estados de carga, vacío, error, sin permiso y éxito; escritorio, 375 y 320 px; teclado; temas claro y oscuro; `docs/quality/frontend-checklist.md`.

### D25. Migraciones

- **`purchase_settlement_draft`:** empresa, versión, estado `DRAFT`/`EMITTED`, comprobante, punto, proveedor y dirección opcionales mientras se prepara, `lines` y `payments` como `JSONB` validados por el contrato, con un `CHECK` de arreglo y de tamaño máximo como defensa. Un borrador emitido no cambia ni se borra.
- **`purchase_settlement`:** una fila inmutable por liquidación con el proveedor (FK compuesta por empresa), el caso de procedencia, la versión de la política, el número de líneas y de pagos; `CHECK` del caso y de los conteos. Un trigger exige que el comprobante sea un `03` de la empresa.
- **`purchase_settlement_declaration`:** una fila inmutable por declaración, con el identificador (de los cuatro de la política), la versión, la base `USER_DECLARED`, quién declaró y cuándo.
- **Trigger de restricción diferido:** un comprobante `03` no se confirma sin su fila de `purchase_settlement` ni sin exactamente las cuatro declaraciones distintas de su versión de la política: el mismo acoplamiento intencional de la nota de crédito, la retención y la guía (`database.md`).
- **Idempotencia:** `purchase_settlement.emit` en el `CHECK` de `idempotency_record`.
- Sin cambios en `electronic_document`: la liquidación tiene total y comprador, como los demás tipos con importe. FK compuestas por empresa y sin índices parciales. `migrations.test.ts` y `database.md` las documentan.

### D26. Observabilidad

- `purchase_settlement_reservations_total`: reservas confirmadas, sin etiquetas de empresa ni comprobante.
- Los logs registran identificadores, estados y códigos, nunca direcciones, descripciones, identificaciones ni declaraciones con datos del proveedor (SEC-003). `observability.md` lo documenta.

### D27. Rendimiento

- **Server-Timing** con `EMISSION_STAGE_TIMINGS`, como los demás tipos; nunca en producción.
- **`bench:purchase-settlements`**, fuera de `verify`, sobre un esquema aislado con 10 000 terceros (una parte con el rol `SUPPLIER` y cédula o pasaporte), 10 000 productos y 100 000 liquidaciones autorizadas (volumen de Q-26), con el barrido del RIDE apagado y la base asentada (`VACUUM (ANALYZE)` y `CHECKPOINT`). Mide la búsqueda de proveedores y productos, las opciones, la creación y la vista previa del peor caso con los valores por defecto y con los máximos absolutos, el cálculo de 100 y de 1000 líneas, la reserva en serie y la del peor caso con `reservation_tx` aparte del XML, el XSD y la firma, 10 rondas de 10 emisiones simultáneas, la lista y la búsqueda por proveedor, el XML con XSD y su tamaño firmado como medición, el RIDE de una liquidación y del máximo de líneas en `RideWorkerPool`, y el CPU y la memoria del backend; al terminar, que ninguna liquidación tocó el inventario.
- **Objetivos:** ERS RNF-005 (P95 menor que 2 s por operación) y el P95 del render del RIDE menor que 1 s, en el entorno registrado. El resultado va a `docs/quality/benchmarks/` y a `performance.md`.

### D28. Operaciones sensibles

| Pregunta | Borrador y vista previa | Emisión (reserva) | Reintento de firma | Reconciliación manual |
| --- | --- | --- | --- | --- |
| Quién | `purchaseSettlements.draft` | `purchaseSettlements.emit` | `purchaseSettlements.retrySigning` | `purchaseSettlements.reconcile` (administrador) |
| Empresa | La de la sesión | La de la sesión | La de la sesión | La de la sesión |
| Propiedad | Borrador, proveedor y productos por `(company_id, id)` | Igual | Liquidación por `(company_id, id)` | Liquidación por `(company_id, id)` |
| ¿Otro ID llega a otra empresa? | No: `404` | No: `404` | No: `404` | No: `404` |
| Dos veces | Versión del borrador | `Idempotency-Key` y bloqueo del borrador | Arriendo de la firma | Una solicitud programada por liquidación |
| A la vez | Versión | Bloqueo del borrador y de la configuración | Arriendo | Bloqueo del comprobante |
| Restricciones | Contrato estricto, límites y cuerpo de 4 MiB | Triggers de la liquidación, diferido del `03` e idempotencia | Estado `RESERVED` | Estado reconciliable |
| Auditoría | No | `purchase_settlement.reserved` con las declaraciones | `purchase_settlement.signing_retried` | `purchase_settlement.reconciliation_*` |
| Fugas | Solo proveedores y productos de la empresa | Sin direcciones, descripciones, XML ni SOAP en la auditoría | Sin secretos | Sin SOAP |
| Pruebas de autorización | `403` sin permiso, `401` sin sesión, `404` con otra empresa | Igual, y un operador emite | Igual | `403` para el operador, `404` con otra empresa |

### D29. Corrección documental del documento sustento 03

- Donde el spec de la retención ("comprobante emitido por el proveedor"), el glosario (fila "Documento sustento") o el editor de la retención (`withholding-draft-editor.tsx`, "liquidación de compra del proveedor") atribuyen al proveedor una liquidación de compra usada como documento sustento, pasa a decir que la emite el adquirente en los casos que la normativa permite. Es una corrección del texto: el comportamiento, los datos y el XML de la retención no cambian.

### D30. Trazabilidad de las fuentes

| Regla | Fuente |
| --- | --- |
| Tipo 03, XSD 1.1.0 | Ficha v2.34, tabla 3 y anexo 17; XSD verificado contra el portal |
| Casos de procedencia y caso c) | Reglamento vigente, art. 13 |
| Datos del proveedor y de la operación | Reglamento, art. 22 |
| Sin consumidor final | Ficha v2.34, tabla 6 |
| Solo IVA; descuento obligatorio | XSD 1.1.0 |
| `pagos` y `plazo` obligatorios; `moneda` | Ficha v2.34, anexo 17 |
| Retención del 100 % del IVA y del 3 % de renta | Reglamento, art. 13; NAC-DGERCGC20-00000061; NAC-DGERCGC26-00000009 |
| Emisión al realizarse la transacción | Reglamento, art. 17; NAC-DGERCGC18-00000233 |
| RIDE | Ficha v2.34, anexo 2, página 65 |

## Risks / Trade-offs

- [El firmador privado del tipo 03 podría no funcionar con el pipeline] → su prueba de contrato es la primera tarea técnica; si falla, se detiene el apply y se reporta.
- [Extraer las primitivas de la factura podría cambiar sus importes] → las pruebas de importes, el contrato de regresión y los golden de la factura deben pasar sin cambios; si no, cálculo propio.
- [El usuario podría declarar hechos falsos] → las declaraciones se presentan siempre como del usuario, con autor y momento; el sistema no puede verificarlas y no lo afirma.
- [Una liquidación sin su retención no sustenta crédito ni costos] → el aviso lo recuerda; automatizar la retención es otra capacidad.
- [El dibujo del RIDE de la página 65 hereda campos de la factura] → se imprimen solo los datos que la liquidación 1.1.0 tiene.
- [Las columnas del comprador guardan al proveedor] → rótulo "Proveedor" en la interfaz y deuda técnica registrada.
- [La CI está en su límite: el job de `main` en `6a34bc4` tardó 29 min 31 s de los 30 permitidos, con 1557 s de pruebas, y el cambio agrega pruebas de integración con PostgreSQL real] → decidir antes del apply, como mantenimiento separado de este cambio, partir o paralelizar la suite o ajustar el límite (deuda técnica "Duración de la CI cerca de su límite").

## Migration Plan

Migración aditiva con las tres tablas nuevas, sus `CHECK`, sus triggers y la operación de idempotencia; sin backfill. Rollback: revertir la migración mientras no existan liquidaciones; con liquidaciones, el registro es inmutable y fiscal, como el de los demás tipos.

## Open Questions

- Q-53 (deferred): la entrega del RIDE en dos ejemplares firmados por el proveedor se confirma en la revisión operativa previa al go-live; el cambio no implementa firma manuscrita ni aceptación del proveedor.
