# Design

## Context

- **Motivación y alcance:** ver proposal.md.
  - Q-49 está resuelta (`open-questions.md`).
  - Las reglas de negocio están en `domain-model.md`: BR-32, BR-33 y BR-64 a BR-69.
  - Su procedencia, oficial o de política, está en `capabilities.md` (Trazabilidad de `debit-notes`).
- **Ya es genérico por tipo de comprobante** (lo dejó `add-credit-notes`):
  - **Numeración y clave.** Numeración por empresa, ambiente, establecimiento, punto y tipo, con el `CHECK` que ya admite `05`, y la clave de acceso con `documentType` como dato.
  - **`electronic_document`**, con su máquina de estados, sus transiciones, sus artefactos y sus guardas. La transmisión exige `snapshot.key.accessKey` y que el artefacto firmado declare el tipo y la versión del comprobante.
  - **Reserva** compartida: `reserveDocumentIn` (`fiscal/application/document-reservation.ts`).
  - **Firma** compartida, con un perfil por tipo (`SigningProfile` en `fiscal/application/signing-pipeline.ts`). La librería de firma ya mapea `05` a `NOTA_DEBITO`.
  - **Registro de esquemas.** Ya tiene `NotaDebito_V1.0.0.xsd` con `supported: true` y el hash `f40323ad…`, verificado contra el portal del SRI (`sri-catalogs/fuentes/nota-de-debito-xsd-verificacion.txt`).
  - **Transmisión:** handlers, clasificadores, evidencia, reconciliación automática, barrido y la solicitud de reconciliación manual (`requestReconciliationIn`).
  - **RIDE:** su job, su pool, la lectura por raíz (`readRideDocument`) y la elección de la distribución por raíz y versión.
  - **Bandeja y descargas:** la lista y el detalle aceptan cualquier tipo, y `filenames.ts` ya nombra `nota-de-debito`.
- **Atado a cada tipo hoy:**
  - la acción de auditoría de la reconciliación terminada (`COMPLETED_AUDIT` en `reconcile-handler.ts`, con `01` y `04`);
  - el `CHECK` de `idempotency_record.operation` (`invoice.emit`, `credit_note.emit`);
  - la lectura y la distribución del RIDE (`factura` y `notaCredito`);
  - en el frontend, `EMITTED_DOCUMENT_TYPES = ["01", "04"]` y `DOCUMENT_KINDS`;
  - la prueba `emitted-document-types.test.ts`, que fija las rutas de emisión en `/credit-notes` y `/invoices`.
- **Los seguidores de las transiciones ya ignoran la nota de débito**, sin cambios:
  - `inventoryOutflowFollower` lee solo comprobantes `01`;
  - `creditCapacityFollower` y `creditNoteReturnFollower` concluyen solo las reservas de una nota de crédito, que la base exige del tipo `04`;
  - `credit_capacity_origin` exige que la capacidad nazca de una factura `01`, así que una nota de crédito no puede tener una nota de débito como sustento.
- **Tratamientos de IVA de una factura:**
  - El snapshot de cada línea guarda por impuesto `taxCode`, `rateCode`, `percentage` y las referencias del catálogo (`catalogType`, `entryKey`, `versionId`, `officialLabel`), resueltos para la fecha de la factura.
  - La factura emite solo IVA. Sus tarifas posibles salen del catálogo `iva-rate`: 0, 12, 13, 14, 15 y 5 %, no objeto (`6`) y exento (`7`), estos dos con porcentaje de cálculo `0`. El IVA diferenciado (`8`) no tiene datos de cálculo y la factura lo rechaza.
  - La factura agrupa sus totales por `taxCode:rateCode` con un único porcentaje por grupo (`invoiceTotals`).
- **XSD `NotaDebito_V1.0.0`.** Los elementos son:
  - `infoNotaDebito`, con emisión, comprador, `codDocModificado`, `numDocModificado`, `fechaEmisionDocSustento`, `totalSinImpuestos`, `impuestos/impuesto` a nivel de documento (código, código de porcentaje, tarifa, base y valor), `valorTotal` y `pagos` opcional en el XSD;
  - `motivos/motivo`, con `razon` (1 a 300, `[^\n]*`) y `valor` (14,2).

  No hay impuestos por motivo.
- **Ficha técnica v2.34** (el PDF que el repositorio ya cita, SHA-256 `7333aebf…`):
  - el formato XML de la nota de débito (páginas 58 y 59) dice "Nota: la tarifa de IVA corresponderá a la fecha de emisión del documento de sustento";
  - marca `pagos`, `pago`, `formaPago` y `total` como obligatorios;
  - el RIDE oficial (anexo 2, página 62) muestra razones y valores, la forma de pago y los subtotales por tarifa.

## Goals / Non-Goals

**Goals:**

- Una nota de débito que reutiliza la reserva, la firma, la transmisión, la reconciliación, la bandeja y el RIDE, con lo propio del tipo aislado en su módulo.
- La factura y la nota de crédito no cambian: mismos snapshot, XML, artefacto y respuestas para los mismos datos.
- Importes exactos desde un solo cálculo versionado, con golden y property tests.
- Ninguna interacción con la capacidad acreditable ni con el inventario.

**Non-Goals:**

- Un pipeline genérico para los seis tipos: solo se agrega lo que la nota de débito necesita.
- Referencias externas, otras causas, otros comprobantes de venta, anulación o corrección de la nota.
- Reetiquetar métricas existentes o cambiar la clasificación del SRI.

## Decisions

### D1. Módulo `debit-notes` y dirección de las dependencias

- Módulo nuevo `debit-notes` con `domain/`, `application/` e `infrastructure/`, como `credit-notes`.
- Depende de lecturas y operaciones exportadas:
  - de `fiscal`: reserva compartida, documentos, artefactos, firma genérica, reconciliación y transmisión;
  - de `taxpayer`, `catalogs` y `signing`;
  - de la lectura inmutable de la factura que exporta `invoices` (D3), inyectada por `main.ts`.
- `fiscal`, `invoices`, `inventory` y `credit-notes` no importan `debit-notes`, y `debit-notes` no importa `inventory` ni `credit-notes`. Una prueba de arquitectura comprueba ambas direcciones.
- **Alternativa descartada:** extender `credit-notes`. Comparten la forma de la emisión, pero no la capacidad, el cálculo, el borrador ni el XML; mezclarlos acopla dos tipos que cambian por razones distintas.

### D2. Qué se reutiliza y qué queda por tipo

| Pieza | Decisión |
| --- | --- |
| Reserva del comprobante | `reserveDocumentIn` con `documentType: "05"`, sin cambios |
| Firma | `documentSigning.pipeline(debitNoteSigningProfile())` en `main.ts`: el perfil aporta el builder del XML desde el snapshot y la auditoría `debit_note.signed`. El firmador, el XSD antes y después de firmar, el artefacto, la transición y el encolado son los de `fiscal`. No hay un segundo firmador |
| Transmisión | Sin cambios: transporte SOAP, cola, máquina de estados, clasificadores, evidencia y reconciliación |
| Reconciliación manual | La solicitud con `requestReconciliationIn`. La finalización agrega `"05": debit_note.reconciliation_completed / debitNoteId` a `COMPLETED_AUDIT` |
| Idempotencia | `debit_note.emit` en `IDEMPOTENT_OPERATIONS` y en el `CHECK` de `idempotency_record` |
| RIDE | Lectura y distribución nuevas para `notaDebito` 1.0.0, elegidas por raíz y versión, sobre el mismo pool, job y artefacto (D18) |
| Bandeja | `"05"` en `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` (D19) |
| Por tipo | Borrador, evaluación, cálculo, snapshot, builder XML, distribución del RIDE, rutas y pantallas |

- **Regresión protegida:**
  - el contrato de la factura (`invoice-regression-contract.test.ts`) y los golden del XML y del RIDE de la factura y de la nota de crédito deben pasar sin cambios;
  - ningún archivo de la factura o de la nota de crédito cambia para "ser más genérico";
  - las únicas ediciones compartidas son las tablas por tipo de la tabla anterior.
- **Alternativa descartada:** un `switch` por `codDoc` en la firma o en la transmisión. Las interfaces por tipo de `add-credit-notes` ya cubren la diferencia.

### D3. Lectura inmutable de la factura

- La nota usa la lectura que `invoices` ya exporta para la nota de crédito (`invoiceCreditSource`, design D3 de `add-credit-notes`), sin cambiarla. `main.ts` la inyecta en `debit-notes` como el puerto `InvoiceSourceReader`, con el tipo propio del módulo.
- De ella toma:
  - el identificador, el número, la fecha de emisión y la clave;
  - el número, la fecha y el ambiente de la autorización;
  - el estado, el ambiente y `consumerFinal`;
  - el comprador y los impuestos de cada línea con sus referencias fiscales;
  - la integridad del snapshot y de los artefactos `SIGNED_XML` y `AUTHORIZED_XML` (SHA-256, tamaño, clave y forma).
- La integridad se comprueba al preparar el borrador (la vista previa la informa como problema que bloquea) y otra vez antes y dentro de la reserva. Una diferencia falla cerrada: no se emite, y nunca se repara con el producto, el tercero, el catálogo o la tarifa vigentes, que la nota no lee.
- **Datos del emisor:** son los vigentes al reservar, como en la nota de crédito. Es un comprobante nuevo, emitido hoy, con la identidad tributaria bloqueada.

### D4. Elegibilidad y orden de las comprobaciones antes de reservar

Fuera de la transacción, sin consumir secuencial, clave, firma ni llamada al SRI, en este orden:

1. permiso `debitNotes.emit`, `Idempotency-Key` y empresa de la sesión;
2. borrador de la empresa en `DRAFT` con la versión esperada, y repetición en el registro de idempotencia (D15);
3. archivos del esquema disponibles con su hash;
4. factura existente en la empresa (`404` igual que inexistente; una nota de crédito o de débito tampoco es una factura);
5. estado `AUTHORIZED`;
6. snapshot y artefactos íntegros;
7. mismo ambiente que la configuración vigente (`DEBIT_NOTE_INVOICE_NOT_ELIGIBLE`);
8. no consumidor final (D10);
9. de uno al máximo de conceptos;
10. por concepto: causa válida, descripción válida, importe mayor que cero dentro del rango y tratamiento de la factura (D5, D6);
11. exactamente una forma de pago, vigente y habilitada para la empresa en la fecha de la reserva según el resolver de `catalogs` (D8), con su total igual al valor total;
12. declaración de la versión vigente (D9);
13. empresa configurada, punto disponible, firma utilizable y esquema registrado;
14. cálculo válido, dentro de los límites del XSD (D7).

La vista previa del borrador evalúa lo mismo, salvo la declaración, que se da al emitir. La transacción de la reserva vuelve a evaluar todo con lecturas de la base (D14).

### D5. Causas, conceptos y descripción

- **Causas:** enum cerrado `LATE_PAYMENT_INTEREST` | `POST_INVOICE_COST_EXPENSE` en `@facturador/contracts`, con su etiqueta ("Intereses de mora", "Costos o gastos posteriores a la factura") y su fuente (Reglamento, art. 16).
- **Concepto:** `{ cause, description, amount, taxTreatment }`.
  - `description`: texto fiscal de una línea, de 1 a 300 caracteres (`razon` del XSD: `[^\n]*` y caracteres prohibidos de `xml-writer.ts`). Es la `razon` del motivo, tal como la escribió el usuario. Nunca se compone con la causa ni selecciona comportamiento.
  - `amount`: `DecimalString` de importe (14,2 del XSD) mayor que cero. Un número JSON, una cadena con más de dos decimales o un valor negativo se rechazan en el contrato.
  - `taxTreatment`: la clave `taxCode:rateCode` de un tratamiento de la factura.
- **Máximo de conceptos:** 100 por nota (`DEBIT_NOTE_CONCEPTS_MAX`). Es un límite del producto, no del SRI, para mantener acotados el borrador, la vista previa y el XML.
- La causa se guarda en el snapshot, en la auditoría y en el detalle. El XML y el RIDE muestran la `razon` y el `valor`, porque el XSD no tiene un campo para la causa.

### D6. Tratamientos de IVA de la factura

- **Regla oficial:** el IVA de la nota es el del comprobante de sustento, no el vigente en la fecha de la nota.

  **SOURCE STATUS: fuente oficial durable archivada** (tarea 13.1, `docs/product/sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`).
  - **Evidencia primaria:** la ficha técnica v2.34, el mismo PDF que el repositorio ya cita (SHA-256 `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9`). En "FORMATO XML NOTA DE DÉBITO", página 58, dice: "Nota: la tarifa de IVA corresponderá a la fecha de emisión del documento de sustento." La tarea 13.1 archiva su extracto literal y su hash en `docs/product/sri-catalogs/fuentes/`, y con eso el estado pasa a fuente oficial durable archivada.
  - **Evidencia complementaria:** la indicación del SRI durante el cambio de tarifa del 14 % al 12 % (Q-49). Se archiva si se logra, pero no hace falta para cerrar APPLY. Nunca se sustituye con blogs ni resúmenes de terceros. Resultado de la tarea 13.1: ese aviso no se encontró en el portal del SRI y no se archiva; se archiva en su lugar la pregunta 11 de las preguntas frecuentes oficiales del SRI del cambio de tarifa de 2016 (del 12 % al 14 %), que aplica el mismo criterio (`docs/product/sri-catalogs/fuentes/sri-preguntas-frecuentes-tarifa-iva-2016.txt`, con su URL y su SHA-256).
- **Política del proyecto, más estricta que la regla oficial:**
  - cada concepto elige uno de los tratamientos congelados en el snapshot de la factura: las combinaciones distintas `taxCode:rateCode` de los impuestos de sus líneas, con su porcentaje y sus referencias fiscales;
  - esos tratamientos son, por construcción, los vigentes en la fecha de emisión de la factura;
  - la nota nunca introduce un tratamiento que la factura no tenía, ni lee el catálogo, el producto o el tercero.

  Consecuencia aceptada: si un costo posterior requiere un tratamiento que la factura no tenía, la nota no se emite en el MVP.
- **Varias tarifas:**
  - no hay una tarifa global ni se colapsan tratamientos;
  - 0 %, no objeto y exento son tres tratamientos distintos aunque los tres calculen 0, cada uno con su `codigoPorcentaje`;
  - la vista previa y la pantalla ofrecen solo la lista de tratamientos de la factura que devuelve el servidor.
- **Snapshot:** guarda todos los tratamientos de la factura con sus referencias (`taxCode`, `rateCode`, `percentage`, `catalogType`, `entryKey`, `versionId`, `officialLabel`), y cada concepto referencia uno por su clave.

### D7. Cálculo exacto: `calculateDebitNoteAmounts`

- **Una sola primitiva fiscal, versionada.**
  - `calculateDebitNoteAmounts` vive en `debit-notes/domain/amounts.ts`, con versión de cálculo `1`, que se guarda en el snapshot.
  - Recibe los conceptos (importe y clave del tratamiento) y los tratamientos de la factura.
  - Devuelve las bases por concepto, las bases agrupadas por tratamiento, el impuesto de cada tratamiento, el subtotal y el valor total.
  - La vista previa, la emisión (que congela su resultado en el snapshot), el XML y el RIDE consumen ese resultado. El builder solo transcribe el snapshot, el RIDE solo transcribe el XML y el frontend solo muestra lo que devuelve el servidor: ninguno calcula.
- **Fórmulas**, con decimal exacto (`platform/decimal`, sin `number`) y `round` igual a HALF_UP a 2 decimales (Q-14, `decimal-policy.md`):
  - base del concepto `c`: su importe `a_c`, exacto y con hasta 2 decimales; es el `valor` de su `motivo`;
  - base del tratamiento `t`: `B_t = Σ a_c` de los conceptos con ese tratamiento (suma exacta);
  - impuesto del tratamiento `t`: `T_t = round(B_t × pct_t / 100)`, materializado una sola vez sobre la base total del tratamiento, nunca por concepto;
  - subtotal: `totalSinImpuestos = Σ a_c = Σ B_t`;
  - valor total: `valorTotal = totalSinImpuestos + Σ T_t`, que es también el `total` de la forma de pago;
  - cada valor se comprueba contra la especificación de importe del XSD (`DECIMAL_SPECS.importe`: 14 dígitos y 2 decimales), con `platform/decimal/fiscal-decimal.ts` como la nota de crédito; un exceso es `DEBIT_NOTE_AMOUNT_OUT_OF_RANGE`.
- **XML:** un `impuesto` por tratamiento usado, ordenado por código y código de porcentaje como en la factura, con `baseImponible = B_t` y `valor = T_t`.
- **Por qué por tratamiento y no por concepto:**
  - el XSD solo tiene impuestos a nivel de documento, y cada `impuesto` cumple `valor = round(baseImponible × tarifa / 100)`, la relación que un validador puede comprobar;
  - el resultado no depende de cómo el usuario parte una misma base en conceptos;
  - redondear por concepto acumularía centavos (tres conceptos de 0.10 al 15 % darían 0.06 en lugar de 0.05).

  Si una fuente oficial exigiera el cálculo por concepto, se revisa con `/opsx:update` antes de implementarlo.
- **Golden tests** (`backend/test/debit-notes/amounts.test.ts`):
  - un concepto: 100.00 al 15 % → base 100.00, IVA 15.00, total 115.00;
  - varios conceptos de una tarifa: 0.10 + 0.10 + 0.10 al 15 % → base 0.30, IVA 0.05 (de 0.045), total 0.35;
  - varias tarifas: 50.00 al 15 %, 20.00 al 0 % y 10.00 al 5 % → IVA 7.50, 0.00 y 0.50, subtotal 80.00, total 88.00;
  - decimales internos: 33.33 al 15 % → 5.00 (de 4.9995); 0.03 al 15 % → 0.00 (de 0.0045), con base 0.03;
  - otra partición con el mismo total por tratamiento: {0.10, 0.10, 0.10}, {0.30} y {0.15, 0.15} al 15 % → el mismo IVA 0.05;
  - 0 %, no objeto y exento en la misma nota → tres impuestos con valor 0.00, sin agrupar;
  - tarifa histórica: una factura con 12 % → la nota calcula al 12 %;
  - importe que excede los 14 dígitos → rechazo.
- **Property tests:**
  - generador determinista con semilla, como el de los benchmarks, sin dependencias nuevas;
  - entradas: conceptos aleatorios de 1 a 100, importes de 0.01 a valores grandes y tratamientos aleatorios entre los de una factura generada;
  - propiedades:
    - cada `B_t` es la suma de sus conceptos;
    - `T_t = round(B_t × pct_t / 100)`;
    - `valorTotal = totalSinImpuestos + Σ T_t`;
    - la suma de los `valor` de los motivos es `totalSinImpuestos`;
    - ningún importe es negativo ni tiene más de 2 decimales;
    - cualquier repartición de los mismos totales por tratamiento produce los mismos impuestos;
    - el resultado no depende del orden de los conceptos, salvo el orden de los motivos.
- **Sin `number`:** una prueba comprueba que `debit-notes/domain/amounts.ts` no usa `number` ni la librería decimal directamente (`Number(`, `parseFloat`, `toFixed`, `Decimal`), como la de `invoices/domain/amounts.ts`.

### D8. Forma de pago

- **Decisión (confirmada por el dueño del producto):** la forma de pago es obligatoria.
  - La ficha técnica v2.34 (páginas 58 y 59) marca `pagos`, `pago`, `formaPago` y `total` como obligatorios en la nota de débito, y su RIDE oficial (página 62) muestra "Forma de pago" y "Valor".
  - El XSD 1.0.0 permite omitir `pagos`, pero que el XSD sea más permisivo no hace opcional la forma de pago en el producto: la ficha define el comportamiento.
- **Exactamente un `pago` por nota.**
  - Es una política del MVP del proyecto. La documentación nunca dice que el SRI solo admita una forma de pago.
  - El contrato lo expresa con un solo campo `paymentMethod`, no con una lista. Admitir varios pagos más adelante es una ampliación compatible: el snapshot ya guarda `payments` como lista de un elemento.
- **Selección.**
  - El borrador guarda solo la `entryKey` del catálogo `payment-method`. No se aceptan un código libre, una etiqueta ni un importe enviados por el cliente: el cuerpo estricto los rechaza.
  - La vigencia y la habilitación se resuelven con el resolver centralizado de `catalogs` (`availability(companyId, "payment-method", fecha)`, el mismo que usa la factura): la entrada debe existir, tener una versión vigente y estar habilitada para la empresa (`usable`).
  - La fecha es la de la reserva (la fecha de emisión capturada una vez). La vista previa la evalúa con la fecha del día, y la reserva la vuelve a evaluar dentro de la transacción, antes de consumir el secuencial.
  - Una entrada inexistente, no vigente o deshabilitada es `DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE`; sin forma de pago, `DEBIT_NOTE_DRAFT_INCOMPLETE`. Ambos rechazos ocurren antes de reservar.
- **Total.**
  - `payment.total` es el `valorTotal` de `calculateDebitNoteAmounts`. El usuario no lo escribe.
  - Antes de reservar, la evaluación comprueba con decimal exacto que `payment.total == valorTotal`, sin tolerancia ni redondeo adicional. Una diferencia, que no debería ocurrir, se rechaza (`DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH`) antes de reservar.
  - La vista previa, el snapshot, el XML y el RIDE muestran ese mismo valor.
- **Snapshot.** `payments` es una lista de un elemento con la forma de los pagos de la factura: `position: 1`, `entryKey`, `code` (el `formaPago`), `catalogType: "payment-method"`, `versionId`, `datasetVersion`, `officialLabel` y `amount`.
- **Sin `plazo` ni `unidadTiempo`.** La ficha los marca como obligatorios "cuando corresponda". El modelo del MVP no registra un plazo de crédito, así que nunca corresponden y no se escriben, como en la factura.
- **Después de `RESERVED`** el catálogo no se vuelve a leer: el XML sale del snapshot (D16), y el RIDE toma la denominación de `snapshot.payments`, como el handler del RIDE de la factura (D18).
- **Sin valor por defecto:** el borrador no copia la forma de pago de la factura, porque la nota es otra transacción.
- **Pruebas:**
  - golden y XSD con `pagos` presente, aunque el XSD permita omitirlo;
  - una prueba negativa: sin forma de pago, la nota no queda reservada, no consume secuencial y no recibe clave;
  - entrada no vigente, deshabilitada, inexistente, código libre, etiqueta, importe y varias formas de pago, todos rechazados.

### D9. Declaración de la factura comercial negociable

- **Política:** `DEBIT_NOTE_ELIGIBILITY_DECLARATION` en `@facturador/contracts`, versión `1`, con una afirmación de identificador estable, `NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE`. Lleva su texto, su contexto (qué es una factura comercial negociable y cuándo está efectivamente negociada) y su fuente (Reglamento de Comprobantes de Venta, art. 16).
- **Emisión:** el cuerpo lleva `declarations: { version, statements }`, que debe ser la versión vigente con la afirmación. El snapshot guarda `declarations: { version, statements, declaredBy, declaredAt, basis: "USER_DECLARED" }`. Nunca hay `SYSTEM_VERIFIED`.
- La semántica son el identificador y la versión, no el texto visible. Un cambio del texto legal es una versión nueva.
- **Comprobación automática futura:** si el sistema llega a poder comprobar la negociación de la factura, la comprobación se evalúa antes y prevalece, y la declaración no la anula. Hoy no existe.
- Se exige antes de `RESERVED`. La interfaz la pide en la confirmación de la emisión (D23), nunca como una casilla genérica.

### D10. Consumidor final

- **Política del proyecto** (BR-32: receptor identificado), no la NAC-DGERCGC25-00000014, que formula esa prohibición para la anulación y la nota de crédito.
- **Comprobación:** con `consumerFinal` del snapshot de la factura (D3), en el paso 8 de D4, antes de secuencial, clave, firma o llamada al SRI. Código `DEBIT_NOTE_CONSUMER_FINAL`.
- **Mensaje:** "Por política del sistema, una nota de débito exige un comprador identificado: una factura emitida a consumidor final no la admite."
- Ninguna declaración lo evita.

### D11. Sin plazo de emisión

- Regla: las fuentes oficiales revisadas no establecen un plazo de emisión que este sistema deba imponer.
- No hay comprobación de antigüedad de la factura, ni configuración para fijarla. No es una garantía de que el plazo no exista: si aparece una fuente oficial, se propone con OpenSpec (BR-68).

### D12. Sin interacción con la capacidad acreditable ni con el inventario

- La nota de débito no lee ni escribe `credit_capacity`, `credit_reservation`, `stock_return_*`, saldos ni movimientos. No importa `inventory` ni `credit-notes`.
- Los seguidores existentes la ignoran sin cambios (ver Context). Las pruebas lo fijan:
  - una factura de 100.00 con una nota de débito autorizada de 20.00 sigue con 100.00 acreditables, y una anulación total acredita 100.00;
  - una nota de débito no aparece entre las facturas elegibles de una nota de crédito, y un borrador de nota de crédito con su identificador responde `404`;
  - una nota de débito autorizada, devuelta o no autorizada no registra movimientos ni cambia saldos.

### D13. Snapshot autosuficiente

Después de `RESERVED`, la verdad fiscal de la nota es su snapshot; la factura solo se vuelve a leer para relaciones. Guarda:

- `snapshotVersion: 1`; el esquema (`documentType: "05"`, versión `1.0.0`, ruta, hash e imports); la versión del builder; `calculationVersion`; las versiones de los datasets y de la configuración;
- la fecha de emisión, el ambiente y su código; el emisor vigente al reservar; el comprador tal como figura en la factura;
- `invoice`: identificador, tipo `01`, número, fecha de emisión, clave, número, fecha y ambiente de la autorización, versión de su snapshot y sus tratamientos de IVA con sus referencias fiscales;
- `concepts`: posición, causa, descripción, importe y clave del tratamiento;
- `taxes`: por tratamiento usado, código, código de porcentaje, porcentaje, base e importe;
- `totals`: `withoutTaxes` y `total`;
- `payments`: un elemento con `position`, `entryKey`, `code`, `catalogType`, `versionId`, `datasetVersion`, `officialLabel` y `amount` (D8);
- `declarations`;
- `key`: número, secuencial, código numérico, tipo de emisión y `accessKey`.

### D14. Transacción de la reserva y atomicidad

- **Transacción de `RESERVED`**, sin I/O externo dentro:
  1. bloquear el borrador y comprobar su estado y su versión;
  2. bloquear la configuración tributaria;
  3. volver a leer la factura con su integridad y a evaluar con lecturas de la base;
  4. armar el snapshot sin la clave;
  5. `reserveDocumentIn` con el tipo `05`: secuencial, identidad tributaria bloqueada, código numérico, clave, `insertReserved` y transición a `RESERVED`;
  6. registrar la relación de la nota con su factura (D26);
  7. borrador `EMITTED`;
  8. registro de idempotencia;
  9. auditoría `debit_note.reserved`;
  10. commit.

  La construcción del XML, la firma y la red ocurren después del commit, en el pipeline compartido.
- **Sin bloqueo de la factura:**
  - la nota no consume ninguna capacidad de la factura;
  - `AUTHORIZED` no tiene transiciones de salida;
  - el trigger de la relación (D26) comprueba de nuevo, dentro de la transacción, que la factura sea un `01` autorizado de la misma empresa y del mismo ambiente.

  Dos notas de débito simultáneas de una misma factura son válidas y no se esperan entre sí; dos emisiones del mismo borrador se serializan por el bloqueo del borrador.
- **Todo o nada:** si cualquier paso falla, no queda secuencial consumido, clave, comprobante, relación, snapshot, borrador emitido, registro de idempotencia ni auditoría. Una prueba lo comprueba forzando el fallo después de cada paso, como en la nota de crédito.

### D15. Numeración, clave e idempotencia

- **Numeración y clave:**
  - tipo `05`, con un contador por empresa, ambiente, establecimiento, punto y tipo, sin compartirlo con la factura ni con la nota de crédito;
  - la clave se compone en la reserva con la misma función y `documentType: "05"`, y se guarda en `snapshot.key.accessKey`.
- **Idempotencia:**
  - operación `debit_note.emit`, con alcance empresa, operación y `Idempotency-Key`, sin TTL;
  - el registro se inserta en la transacción de `RESERVED`.
- **Huella canónica** (`requestFingerprint`), calculada después de leer el borrador de la empresa, sobre:
  - `draftId` y `expectedVersion`;
  - la declaración (`version` y afirmaciones ordenadas);
  - los datos funcionales de esa versión del borrador: factura, punto, forma de pago y conceptos en orden, con causa, descripción, importe y tratamiento.

  Una versión del borrador es inmutable y un borrador emitido no cambia, así que los datos funcionales coinciden siempre con la versión. Incluirlos hace explícito que otra solicitud nunca repite una nota.
- **Respuestas:**
  - misma huella: la misma nota (`200`), también si quedó reservada, y entonces se reanuda la firma;
  - otra huella: `409 IDEMPOTENCY_KEY_REUSED`;
  - borrador ya emitido con otra clave: `409 DEBIT_NOTE_DRAFT_ALREADY_EMITTED`;
  - sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.

### D16. Builder XML `notaDebito` 1.0.0 y firma

- `sri-engine/infrastructure/debit-note-xml-builder.ts`, puro y determinista, con versión de builder `1`. Mapea únicamente desde el snapshot y no usa el builder de alto nivel de la dependencia.
- Reutiliza `xml-writer.ts` (escape y caracteres prohibidos), `infoTributaria` con `codDoc` 05 y el texto decimal exacto del snapshot, sin formatear importes.
- **Contenido, en el orden del XSD:**
  - `infoNotaDebito`: fecha, dirección del establecimiento, comprador, contribuyente especial y contabilidad si corresponden, `codDocModificado` 01, `numDocModificado`, `fechaEmisionDocSustento`, `totalSinImpuestos`, `impuestos` (D7), `valorTotal` y `pagos` con un solo `pago` (`formaPago` y `total` desde `snapshot.payments`, nunca desde la solicitud ni desde el catálogo vigente; D8);
  - `motivos`: un `motivo` por concepto, en su orden, con `razon` y `valor`.
- **No escribe** `rise`, `compensaciones`, `valorDevolucionIva`, `plazo`, `unidadTiempo`, `maquinaFiscal` ni `infoAdicional`.
- El pipeline compartido valida contra `NotaDebito_V1.0.0.xsd` antes y después de firmar, y el firmador recibe el tipo `05`.
- **Pruebas:** golden fixtures de bytes exactos (un concepto, varios de una tarifa, varias tarifas con 0 %, no objeto y exento, comprador con caracteres especiales), todos con `pagos`, validados contra el XSD oficial; XML firmado validado con la clave y el certificado de la empresa y el artefacto con el tipo `05`. No se toca `docs/product/sri-xsd/README.md` ni ningún artefacto cuyo hash está en el registro.

### D17. Transmisión y reconciliación

- Sin cambios en el transporte, la cola, los clasificadores ni la máquina de reconciliación.
- **Casos de contrato y extremo a extremo con `codDoc` 05**, con respuestas SINTÉTICAS (nunca el SRI real):
  - `RECIBIDA`, `DEVUELTA`, errores 70, 43 y 45;
  - `SEND_UNKNOWN`, `MANUAL_REVIEW`, `AUTORIZADO` y `NO AUTORIZADO`;
  - la respuesta guardada antes de clasificar, la reclasificación de la respuesta guardada sin otra llamada al SRI y la reconciliación manual;
  - una respuesta sin estado que no es un rechazo.
- **Rutas de la nota:** historial de la transmisión (`TransmissionReader`) y reconciliación manual (`debitNotes.reconcile`, auditoría `debit_note.reconciliation_requested`), sobre las operaciones de `fiscal`. La finalización se audita como `debit_note.reconciliation_completed` (D2).

### D18. RIDE de la nota de débito

- **Lectura:** `notaDebito` 1.0.0 en `sri-engine/infrastructure/ride/ride-source.ts`, con su lista blanca (los elementos que escribe el builder de D16) y un modelo `RideDebitNote`:
  - el emisor y sus leyendas, la autorización y el comprador;
  - el comprobante modificado y su fecha;
  - los motivos con su razón y su valor;
  - la forma de pago, los impuestos por tratamiento, el subtotal y el valor total.

  `readRideDocument` la elige por la raíz y la versión, y un elemento fuera de la lista blanca detiene la generación.
- **Distribución propia** según la ficha v2.34, anexo 2, página 62, con versión de renderer `nota-debito-1`:
  - cabecera con RUC, "NOTA DE DÉBITO", número, autorización, fecha y hora, ambiente, emisión y clave con Code128;
  - emisor;
  - comprador con la fecha de emisión;
  - "Comprobante que se modifica: FACTURA {número}" y su fecha de emisión;
  - tabla "RAZÓN DE LA MODIFICACIÓN" y "VALOR DE LA MODIFICACIÓN", con una fila por motivo;
  - "Forma de pago" y "Valor": el `formaPago` y el `total` del XML, con la denominación de `snapshot.payments` (el handler del RIDE ya la lee así para la factura), nunca del catálogo vigente;
  - subtotales llenados por tratamiento, subtotal sin impuestos, IVA por tarifa y valor total.

  No es el RIDE de la factura ni el de la nota de crédito con otro título.
- **Reutiliza** pdfmake, bwip-js, Noto Sans, la paginación, el pool de workers (sin duplicarlo), el job, el artefacto, las descargas y las entregas. El Code128 codifica la clave de la nota, nunca la de la factura.
- **Pruebas:**
  - golden propios con el texto de las páginas y la lectura del Code128;
  - los mismos bytes en dos procesos;
  - contenido no emitido que detiene la generación;
  - el RIDE de la factura y el de la nota de crédito sin cambios.

### D19. Bandeja y frontend compartido

- `EMITTED_DOCUMENT_TYPES = ["01", "04", "05"]` y `DOCUMENT_KINDS["05"]`:
  - nombre "nota de débito";
  - `/notas-debito` y `/debit-notes`;
  - `debitNotes.reconcile`;
  - `DEBIT_NOTE_NOT_RECONCILABLE`;
  - sus esquemas de vista y de transmisión.
- El filtro de tipo de la bandeja ofrece los tres tipos, y cada fila enlaza al detalle de su tipo.
- `DocumentsSection` y `TransmissionSection` no cambian; reciben la nota como cualquier comprobante.
- Las reglas de disponibilidad no cambian: RIDE solo de un comprobante autorizado, XML autorizado solo si su artefacto existe y el XML firmado como un documento distinto.

### D20. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/debit-notes/eligible-invoices` | Facturas autorizadas, no a consumidor final, del ambiente vigente de la empresa, con búsqueda por número o comprador | `debitNotes.draft` |
| `GET/POST /api/v1/debit-notes/drafts`, `GET/PUT/DELETE /api/v1/debit-notes/drafts/{draftId}` | Borradores con su vista previa y los tratamientos de la factura | `debitNotes.draft` |
| `POST /api/v1/debit-notes` | Emisión con `Idempotency-Key` (`201`, o `200` en la repetición) | `debitNotes.emit` |
| `GET /api/v1/debit-notes`, `GET /api/v1/debit-notes/{debitNoteId}` | Consulta y detalle | `debitNotes.read` |
| `GET /api/v1/debit-notes/{debitNoteId}/transmission` | Historial de la transmisión | `debitNotes.read` |
| `POST /api/v1/debit-notes/{debitNoteId}/signing-attempts` | Reintento de firma | `debitNotes.retrySigning` |
| `POST /api/v1/debit-notes/{debitNoteId}/reconciliations` | Reconciliación manual (`202`) | `debitNotes.reconcile` |

- **Borrador:** `{ invoiceId, emissionPointId, paymentMethod, concepts: [{ cause, description, amount, taxTreatment }] }`, que puede guardarse incompleto. `paymentMethod` es una sola `entryKey` del catálogo `payment-method`, sin etiqueta ni importe. La emisión exige punto, forma de pago y al menos un concepto completo.
- **Emisión:** `{ draftId, expectedVersion, declarations: { version, statements } }`.
- **Vista previa:**
  - `taxTreatments` de la factura, con clave, etiqueta y porcentaje;
  - por concepto, su base y su tratamiento;
  - `taxes` por tratamiento, `withoutTaxes`, `total` y `payment`;
  - `issues` con la posición del concepto.
- **Códigos:**
  - `DEBIT_NOTE_INVOICE_NOT_ELIGIBLE`, `DEBIT_NOTE_INVOICE_INTEGRITY`, `DEBIT_NOTE_CONSUMER_FINAL`;
  - `DEBIT_NOTE_CONCEPTS_REQUIRED`, `DEBIT_NOTE_CONCEPTS_TOO_MANY`, `DEBIT_NOTE_CONCEPT_INVALID`, `DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE`;
  - `DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE`, `DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH`, `DEBIT_NOTE_AMOUNT_OUT_OF_RANGE`, `DEBIT_NOTE_DECLARATION_REQUIRED`;
  - `DEBIT_NOTE_DRAFT_INCOMPLETE`, `DEBIT_NOTE_DRAFT_CHANGED`, `DEBIT_NOTE_DRAFT_ALREADY_EMITTED`, `DEBIT_NOTE_NOT_RECONCILABLE`;
  - y los compartidos de la emisión (`IDEMPOTENCY_KEY_*`, configuración, punto, firma y esquema).
- **Validación:** consultas no estrictas y cuerpos estrictos, de modo que un `companyId`, un número o una clave de un comprobante externo se rechazan. Importes como texto decimal.
- **Prueba de tipos emitidos:** `emitted-document-types.test.ts` pasa a exigir `["/credit-notes", "/debit-notes", "/invoices"]` y sigue sin rutas de retención, guía ni liquidación.

### D21. Permisos

- `debitNotes.read`, `debitNotes.draft`, `debitNotes.emit` y `debitNotes.retrySigning`: administrador y operador. Quien emite confirma la declaración.
- `debitNotes.reconcile`: administrador, como `invoices.reconcile` y `creditNotes.reconcile`.
- Cada caso de uso exige su permiso en el servidor antes de leer o escribir. La empresa sale siempre de la sesión, nunca de un `invoiceId` o un `companyId` del cliente.
- La bandeja y las descargas usan los `archive.*` vigentes.
- La matriz va en `access-policy.ts`, su espejo del frontend y `access-control.md`.

### D22. Auditoría

- **`debit_note.reserved`**, con los hechos funcionales seguros:
  - nota, número, clave, ambiente y valor total;
  - factura y su número;
  - causas distintas de los conceptos y número de conceptos;
  - versión de la declaración y afirmación.

  Sin descripciones de los conceptos, XML, SOAP ni datos innecesarios del comprador.
- **`debit_note.signed`** (artefacto) y **`debit_note.signing_retried`**.
- **`debit_note.reconciliation_requested`** (motivo) y **`debit_note.reconciliation_completed`** (resultado), sin la respuesta del SRI.
- **Sin eventos** para borradores, consultas, transmisión automática ni entregas: su evidencia son los intentos, las transiciones y el historial de entregas.

### D23. Pantallas

- **Notas de débito** (`/notas-debito`, en "Operación", `debitNotes.read`).
  - Brief: administrador u operador; el objetivo es encontrar una nota y su estado, y la decisión es qué nota abrir.
  - Información mínima: número, factura modificada, causas, comprador, valor total y estado.
  - Acción principal, abrir la nota; secundaria, "Nueva nota de débito" (`debitNotes.draft`).
  - P0 número, estado y valor; P1 factura, comprador, causas y fecha; P2 búsqueda y filtros (estado y causa en la URL); P3 identificadores, que no se muestran.
  - `AppDataTable` con paginación del servidor y tarjetas por debajo de 768 px. Los borradores en curso, con su eliminación.
- **Borrador** (`/notas-debito/borradores/nueva`, con `?factura={id}` desde la factura, y `/notas-debito/borradores/{id}`, `debitNotes.draft`).
  - Brief: administrador u operador con `debitNotes.draft`; el objetivo es cobrar después de la venta sin equivocar la causa ni el IVA. Las decisiones son la factura, los conceptos, la forma de pago y la declaración.
  - Información mínima: factura y sus tratamientos, los conceptos, las bases e impuestos por tratamiento, el valor total y los problemas.
  - Acción principal: "Emitir nota de débito".
  - P0 conceptos con su causa, importe y tratamiento, y los problemas que bloquean; P1 factura modificada, impuestos por tratamiento, valor total y forma de pago; P2 descripción de cada concepto y punto de emisión; P3 identificadores y versiones, que no se muestran.
  - Pasos:
    1. elegir la factura, con un selector con búsqueda (combobox, un conjunto grande);
    2. por concepto, la causa, con un control segmentado de dos opciones;
    3. la descripción;
    4. el importe;
    5. el tratamiento, entre los de la factura: control segmentado hasta 5 opciones y `Select` desde 6, nunca una tarifa vigente que la factura no tenía;
    6. la forma de pago (`Select` del catálogo vigente) y el punto;
    7. la vista previa del servidor del borrador guardado, con los problemas junto a su concepto;
    8. emitir.

    Los conceptos son una lista ordenada con agregar y quitar, y tarjetas en pantallas angostas.
  - **Emisión:** un `ConfirmDialog` muestra el resumen (factura, valor total, forma de pago) y la declaración como una casilla con su texto completo, su contexto y su fuente. Advierte que es una declaración del usuario, no una comprobación del sistema; sin ella no se confirma. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/notas-debito/{id}`): estado, factura modificada con enlace, conceptos con causa, descripción, importe y tratamiento, impuestos por tratamiento, valor total, forma de pago, declaración "declarada por" el usuario, diagnóstico y reintento de firma, transmisión y documentos.
  - Brief: administrador u operador con `debitNotes.read`; el objetivo es confirmar que la nota quedó autorizada y obtener sus documentos. La decisión es si reintentar la firma o pedir la reconciliación (administrador). Información mínima: estado, número, valor y factura. Acción principal: descargar el RIDE de una nota autorizada, o reintentar la firma de una reservada.
  - P0 estado, número y valor total; P1 factura modificada, conceptos e impuestos por tratamiento; P2 forma de pago, declaración, transmisión y documentos; P3 identificadores y hashes, que no se muestran.
- **Factura:** su detalle ofrece "Emitir nota de débito" cuando la factura está autorizada, no es a consumidor final, es del ambiente vigente y el usuario tiene `debitNotes.draft`.
- **Estados cubiertos:** carga, vacío, error, sin permiso, éxito, responsive, teclado y los dos temas, y el doble clic que envía una sola emisión.

### D24. Observabilidad

- `debit_note_reservations_total`: reservas confirmadas, sin etiquetas de empresa ni comprobante.
- `debit_note_concepts_total{cause}`: conceptos reservados por causa, con las dos causas como únicos valores.
- La transmisión, la autorización y el RIDE usan sus métricas vigentes, que ya observan cualquier tipo. `observability.md` lo documenta. No se reetiqueta nada.

### D25. Rendimiento

- **Server-Timing:** con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas (`total`, `reservation_tx` y las de la firma compartida), como la factura y la nota de crédito; nunca en producción.
- **`bench:debit-notes`**, fuera de `verify`, sobre un esquema aislado con 100 000 facturas autorizadas. Mide por separado:
  - la búsqueda de facturas elegibles;
  - la vista previa de un borrador de 100 conceptos;
  - el cálculo de 100 conceptos de un tratamiento y de 100 de varios;
  - la reserva;
  - reservas simultáneas de una misma factura y de facturas distintas, con su rendimiento;
  - el RIDE de la nota.
- **Objetivos:** ERS RNF-005 (P95 menor que 2 s) donde aplica, y el P95 del render del RIDE menor que 1 s, como el de la factura.
- La transacción de la reserva se mide aparte del XML, el XSD y la firma: ningún bloqueo se mantiene durante el XML, la firma ni la red.
- El resultado va a `docs/quality/benchmarks/` y a `performance.md`.

### D26. Migraciones

Una migración aditiva:

- **`debit_note_draft`:** empresa, factura, punto, forma de pago, versión, estado `DRAFT`/`EMITTED` y comprobante.
- **`debit_note_draft_concept`:** posición, causa, descripción, importe y clave del tratamiento.
- **Guarda del borrador:** un borrador emitido no cambia ni se borra, y sus conceptos tampoco.
- **`debit_note_support`:** la relación de una nota con su factura (empresa, nota única y factura), inmutable.
  - Un trigger exige al insertar que la nota sea un `05` y la factura un `01` en `AUTHORIZED`, de la misma empresa y del mismo ambiente.
  - Un trigger de restricción diferido exige que un `electronic_document` de tipo `05` no se confirme sin su relación.

  Es el mismo patrón de acoplamiento intencional que la nota de crédito con su reserva acreditable, y lo documenta `database.md`.
- **Idempotencia:** `debit_note.emit` en el `CHECK` de `idempotency_record`.
- FK compuestas por empresa y sin índices parciales (la prueba de deriva de Prisma).
- Sin backfill ni cambios a facturas, notas de crédito, capacidades, artefactos o movimientos existentes.

### D27. Operaciones sensibles

| Pregunta | Borrador y vista previa | Emisión (reserva) | Reintento de firma | Reconciliación manual |
| --- | --- | --- | --- | --- |
| Quién | `debitNotes.draft` | `debitNotes.emit` | `debitNotes.retrySigning` | `debitNotes.reconcile` (administrador) |
| Empresa | La de la sesión | La de la sesión | La de la sesión | La de la sesión |
| Propiedad | Factura y borrador por `(company_id, id)` | Igual, y la relación por nota | Nota por `(company_id, id)` | Nota por `(company_id, id)` |
| ¿Otro ID llega a otra empresa? | No: `404` | No: `404` | No: `404` | No: `404` |
| Dos veces | Versión del borrador | `Idempotency-Key` y bloqueo del borrador | Arriendo de la firma | Una solicitud programada por nota |
| A la vez | Versión | Bloqueo del borrador y de la configuración | Arriendo | Bloqueo del comprobante |
| Restricciones | Forma, causas, importes y tratamientos | Trigger de la relación, diferido del tipo `05` e idempotencia | Estado `RESERVED` | Estado reconciliable |
| Auditoría | No | `debit_note.reserved` | `debit_note.signing_retried` | `debit_note.reconciliation_*` |
| Fugas | Solo los tratamientos de la factura propia | Sin descripciones ni SOAP en la auditoría | Sin secretos | Sin SOAP |
| Pruebas de autorización | `403` sin permiso, `401` sin sesión, `404` con otra empresa | Igual, y un operador emite | Igual | `403` para el operador, `404` con otra empresa |

### D28. Trazabilidad de las fuentes

| Regla | Origen | Fuente |
| --- | --- | --- |
| Causas: intereses de mora y costos o gastos posteriores | Oficial | Reglamento, art. 16 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-15-16.txt`) |
| Consigna denominación, serie y número del comprobante modificado | Oficial | Reglamento, art. 16 |
| Factura comercial negociable negociada excluida | Oficial, declarada por el usuario | Reglamento, art. 16 |
| IVA del comprobante de sustento | Oficial. SOURCE STATUS: fuente oficial durable archivada | Primaria: ficha v2.34, página 58 (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`). Complementaria: preguntas frecuentes del SRI del cambio de tarifa de 2016, pregunta 11 (`sri-catalogs/fuentes/sri-preguntas-frecuentes-tarifa-iva-2016.txt`); el aviso del 14 % al 12 % (Q-49) no se encontró |
| Solo tratamientos de la factura y sin tarifa global | Política del proyecto | Q-49, BR-66 |
| `pagos` obligatorio y RIDE de la nota | Oficial | Ficha v2.34, páginas 58, 59 y 62 (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`) |
| Exactamente un `pago` por nota | Política del MVP del proyecto | D8 |
| Consumidor final excluido | Política del proyecto | BR-32, Q-49 |
| Sin plazo de emisión | Ninguna fuente oficial revisada lo establece | BR-68, Q-49 |
| Solo facturas propias, mismo ambiente, autorizadas e íntegras | Política del MVP | BR-65, Q-11 |
| Sin capacidad acreditable ni inventario | Política del proyecto | BR-69 |
| XSD `NotaDebito_V1.0.0` | Oficial | `sri-catalogs/fuentes/nota-de-debito-xsd-verificacion.txt` |

## Risks / Trade-offs

- **Impuesto calculado por tratamiento:** el SRI podría validar otro modelo de cálculo. → El modelo cumple el XSD y la relación `valor = round(base × tarifa)` de cada impuesto. La matriz de certificación en Pruebas del SRI incluye notas de varios conceptos y tarifas, y una fuente que exija otro modelo se lleva a `/opsx:update`.
- **Forma de pago:** la ficha exige `pagos` y el XSD no. → La ficha define el comportamiento (D8, confirmado); la certificación en Pruebas lo confirma. Varios pagos son una ampliación compatible del modelo.
- **Costo posterior con un tratamiento que la factura no tenía:** no se puede cobrar con una nota de débito en el MVP. → Es la política acordada (fallar cerrado); queda en `capabilities.md`.
- **Texto oficial del IVA no archivado:** → La tarea 13.1 archiva el extracto de la ficha v2.34, la evidencia primaria. El aviso del 14 % al 12 % es complementario y no bloquea el cierre.
- **Generalización:** tocar la bandeja, el RIDE y la reconciliación podría romper la factura o la nota de crédito. → Solo se agregan entradas por tipo; los golden y el contrato de regresión no cambian.
- **Relación diferida con `electronic_document`:** acopla un tipo con su tabla. → El mismo patrón probado en la nota de crédito, documentado en `database.md`.

## Migration Plan

- Desplegar la migración aditiva y el código. Las facturas y las notas de crédito existentes no cambian.
- Rollback: el código anterior ignora las tablas nuevas. Las notas de débito emitidas son comprobantes fiscales reales: no se revierten, y una versión anterior las seguiría mostrando en la bandeja como tipo 05.
