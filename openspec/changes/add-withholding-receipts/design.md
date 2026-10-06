# Design

## Context

- **Motivación y alcance:** ver proposal.md. Q-50 está resuelta (`open-questions.md`); las reglas de negocio son BR-32, BR-36 y BR-70 a BR-75 (`domain-model.md`), y su procedencia está en `capabilities.md` (Trazabilidad de `withholding-receipts`).
- **Ya es genérico por tipo de comprobante** (lo dejaron `add-credit-notes` y `add-debit-notes`):
  - numeración por empresa, ambiente, establecimiento, punto y tipo, con los `CHECK` que ya admiten `07`, y la clave con `documentType` como dato;
  - `electronic_document` con su máquina de estados, sus transiciones, sus artefactos y sus guardas;
  - la reserva `reserveDocumentIn` y la firma por perfil (`SigningProfile`); la librería de firma ya mapea `07` a `COMPROBANTE_RETENCION`;
  - el registro de esquemas, con `ComprobanteRetencion_V2.0.0.xsd` en `supported: true` y el hash `1e006d6d…`, verificado contra el portal (`sri-catalogs/fuentes/comprobante-retencion-xsd-verificacion.txt`);
  - la transmisión (handlers, clasificadores, evidencia, reconciliación automática y manual con `requestReconciliationIn`);
  - el RIDE (job, pool, lectura por raíz y versión) y la bandeja y las descargas, con `filenames.ts` que ya nombra `comprobante-de-retencion`.
- **Atado a cada tipo hoy:** `COMPLETED_AUDIT` de `reconcile-handler.ts` (`01`, `04`, `05`); el `CHECK` de `idempotency_record.operation`; la lectura y la distribución del RIDE; `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` en el frontend; `emitted-document-types.test.ts`.
- **Los seguidores de las transiciones ya ignoran el tipo 07:** la salida de inventario lee solo `01`, y las capacidades acreditable y devolvible solo concluyen reservas de una nota de crédito `04`.
- **Catálogos fiscales:** seis catálogos de entradas (`FISCAL_CATALOG_TYPES`) con datasets JSON versionados, validados en memoria y cargados al arrancar. La base fija `code ~ '^[0-9]{1,4}$'`, `entry_key ~ '^[0-9A-Z][0-9A-Z-]{0,63}$'`, la lista de `catalog_type` y un `CHECK` de atributos por catálogo. El porcentaje es `DECIMAL` sin escala fija, con a lo sumo 2 decimales.
- **Terceros:** catálogo único con roles `CUSTOMER`, `SUPPLIER` y `CARRIER`, el consumidor final del sistema (`systemRecord`) y el diálogo `PartyDialog` para registrarlos.
- **Configuración tributaria:** el número de contribuyente especial admite de 3 a 13 caracteres, pero `infoCompRetencion/contribuyenteEspecial` de la retención 2.0.0 solo de 3 a 5 (XSD).
- **XSD 2.0.0** (ver el archivo de verificación): `docsSustento/docSustento` sin máximo, cada uno con `impuestosDocSustento`, `retenciones` y `pagos` obligatorios; `porcentajeRetener` y `tarifa` con 3 dígitos totales y 2 decimales, la excepción que anunció `decimal-policy.md`.
- **Fuentes archivadas para este cambio:** la verificación del XSD y el Catálogo ATS identificado, y los artículos 3, 8 y 40 del Reglamento (`sri-catalogs/fuentes/reglamento-comprobantes-arts-3-8-40.txt`). La ficha v2.34 (`7333aebf…`) aporta la página 13, las tablas 19 y 20, el anexo 10 y el anexo 2.

## Goals / Non-Goals

**Goals:**

- Un comprobante de retención que reutiliza la reserva, la firma, la transmisión, la reconciliación, la bandeja y el RIDE, con lo propio del tipo aislado en su módulo.
- Retenciones anidadas en su documento sustento de punta a punta: borrador, cálculo, snapshot, XML, RIDE y consulta.
- Porcentajes solo del catálogo oficial versionado y valores retenidos desde un solo cálculo versionado, con golden y property tests.
- La factura y las notas no cambian: mismos snapshot, XML, artefacto y RIDE para los mismos datos.

**Non-Goals:**

- Un pipeline genérico para los seis tipos, o un modelo de compras, facturas recibidas o cuentas por pagar.
- Sincronizar catálogos con el SRI en tiempo de ejecución.
- Reetiquetar métricas existentes o cambiar la clasificación de las respuestas del SRI.

## Decisions

### D1. Módulo `withholding-receipts` y dirección de las dependencias

- Módulo nuevo `withholding-receipts` con `domain/`, `application/` e `infrastructure/`, como `debit-notes`.
- Depende de operaciones exportadas: de `fiscal` (reserva, documentos, artefactos, firma, transmisión y reconciliación), de `taxpayer`, de `catalogs` (resolución de entradas con vigencia y habilitación), de `signing` y de una lectura de terceros de `parties` inyectada por `main.ts` como el puerto `WithheldPartyReader`.
- `fiscal`, `invoices`, `inventory`, `credit-notes` y `debit-notes` no importan `withholding-receipts`, y `withholding-receipts` no importa ninguno de ellos. Una prueba de arquitectura comprueba ambas direcciones.
- **Alternativa descartada:** un módulo común de "documentos complementarios". La retención no modifica un comprobante propio ni comparte el borrador, el cálculo ni el XML de las notas.

### D2. Qué se reutiliza y qué queda por tipo

| Pieza | Decisión |
| --- | --- |
| Reserva del comprobante | `reserveDocumentIn` con `documentType: "07"`, sin cambios |
| Firma | `documentSigning.pipeline(withholdingReceiptSigningProfile())`: el perfil aporta el builder del XML desde el snapshot y la auditoría `withholding_receipt.signed`. El firmador, el XSD antes y después de firmar, el artefacto, la transición y el encolado son los de `fiscal` |
| Transmisión | Sin cambios |
| Reconciliación manual | `requestReconciliationIn`, y `"07": withholding_receipt.reconciliation_completed / withholdingReceiptId` en `COMPLETED_AUDIT` |
| Idempotencia | `withholding_receipt.emit` en `IDEMPOTENT_OPERATIONS` y en el `CHECK` |
| RIDE | Lectura y distribución nuevas para `comprobanteRetencion` 2.0.0, elegidas por raíz y versión, sobre el mismo pool, job y artefacto (D19) |
| Bandeja | `"07"` en `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` (D20) |
| Catálogos | Tipos nuevos en `catalogs` con sus datasets y su resolución vigente (D7 a D11) |
| Por tipo | Borrador, evaluación, cálculo, snapshot, builder XML, distribución del RIDE, rutas y pantallas |

- **Regresión protegida:** el contrato de la factura y los golden del XML y del RIDE de la factura y de las notas pasan sin cambios. Las únicas ediciones compartidas son las tablas por tipo y los catálogos.
- **Alternativa descartada:** un `switch` por `codDoc` en la firma o en la transmisión; las interfaces por tipo ya cubren la diferencia.

### D3. Sujeto retenido

- El borrador guarda el identificador del tercero. La vista previa y la reserva lo leen por `(company_id, id)` y comprueban, en este orden:
  1. que exista en la empresa (`404` igual que inexistente);
  2. que esté activo;
  3. que no sea el consumidor final del sistema (`WITHHOLDING_SUBJECT_CONSUMER_FINAL`, que cita la ficha v2.34, página 13);
  4. que su tipo de identificación sea `04`, `05` o `06`; el `08` responde `WITHHOLDING_SUBJECT_FOREIGN_OUT_OF_SCOPE`;
  5. que tenga el rol `SUPPLIER` (`WITHHOLDING_SUBJECT_NOT_SUPPLIER`).
- Al reservar se congelan el tipo de identificación, la identificación y la razón social. Nunca se relee el tercero después.
- **Crear desde la retención (ERS RF-230):** el editor abre el `PartyDialog` existente con el rol `SUPPLIER` marcado. Usa la ruta de terceros vigente con su permiso (`parties.manage`); no hay otra ruta de alta. Sin ese permiso, el editor solo ofrece elegir.
- **Alternativa descartada:** admitir cualquier tercero e inferir el rol. El rol de proveedor hace explícito a quién se le paga, y el usuario lo agrega en Terceros si falta.

### D4. Parte relacionada

- El borrador lleva `relatedParty: "SI" | "NO" | null`, sin valor por defecto. Emitir exige un valor (`WITHHOLDING_RELATED_PARTY_REQUIRED`).
- El snapshot guarda `relatedParty: { value, basis: "USER_DECLARED", declaredBy, declaredByName, declaredAt }`, nunca `SYSTEM_VERIFIED`. El XML escribe solo `parteRel` con el valor; la consulta lo presenta como declarado por el usuario.

### D5. Período fiscal

- El borrador lleva `fiscalPeriod` (`MM/AAAA`). Al crear un borrador, el servidor propone el mes y el año de la fecha de Ecuador de ese momento, y el usuario lo cambia mientras el borrador está abierto.
- **Validación:**
  - formato y mes real según el XSD (`(0[1-9]|1[012])/20[0-9][0-9]`);
  - no posterior al mes y año de la fecha de emisión (validación del proyecto, `WITHHOLDING_FISCAL_PERIOD_IN_FUTURE`).

  En la reserva se compara con la fecha de emisión de la reserva, no con la del borrador. No hay otra cota inferior que la del XSD: ninguna fuente la establece.
- Si el período difiere del mes de emisión, la vista previa lo informa como aviso que no bloquea, y la confirmación lo muestra. Nunca se corrige.
- Se congela en el snapshot y nunca se recalcula.

### D6. Documentos sustento

- **Forma en el borrador:** una lista ordenada `supports`, cada uno con:
  - `documentType` (`01`, `02` o `03`) y `supportCode` (código de sustento);
  - `number` canónico de 15 dígitos (la interfaz muestra `001-001-000000001`), `issueDate` y `authorizationNumber` opcional;
  - `totalWithoutTaxes` e `importTotal` como texto decimal;
  - `taxes`, `payments` y `withholdings`.
- **Validación, todas antes de reservar:**
  - tipo admitido por el MVP y código de sustento compatible con él, vigente en la fecha de emisión según el catálogo (D10);
  - número `^[0-9]{15}$`; autorización con exactamente 10, 37 o 49 dígitos (ficha v2.34, anexo 10);
  - fecha real y no posterior a la fecha de emisión de la retención: el artículo 8 ordena emitir la retención al pagar o acreditar un comprobante de venta ya presentado (validación del proyecto);
  - totales en el dominio `importe` (14 dígitos, 2 decimales, mayores o iguales a cero).
- **Impuestos del documento:** solo IVA (`codImpuestoDocSustento` 2) en el MVP; ICE e IRBPNR quedan fuera.
  - Cada impuesto elige una entrada de `iva-rate` vigente en la fecha del documento sustento: es la tarifa del comprobante del proveedor, como en BR-33. No pasa por la habilitación de la empresa, porque describe el documento de otro.
  - La tarifa escrita es el porcentaje de la entrada, o 0 para no objeto y exento, como en la factura. El IVA diferenciado, sin porcentaje, se rechaza.
  - La base y el valor del impuesto se transcriben, en el dominio `importe`.
- **Pagos del documento:** cada uno elige una forma de pago utilizable para la empresa en la fecha de emisión (el pago lo hace la empresa), con el resolver de `catalogs`, y declara su total. El anexo 10 remite a la tabla 13 del Catálogo ATS; sus formas vigentes (01 y 15 a 21) son las mismas del catálogo `payment-method`, y una prueba de datos lo comprueba.
- **Sin comparaciones entre importes:** el sistema no suma impuestos ni pagos contra los totales, ni compara la base de una retención con su documento. Son datos declarados y ninguna fuente archivada fija esas relaciones; la certificación en Pruebas (S-3) confirmará si el SRI valida alguna.
- **No es un registro de compras:** los documentos viven solo dentro del borrador y del comprobante. No hay facturas recibidas, cuentas por pagar ni verificación contra el SRI. `add-purchase-settlements` podrá asociar una liquidación propia a un sustento `03` con un identificador interno opcional, sin cambiar los datos fiscales guardados.

### D7. Conceptos de retención de la renta y su clasificación

- **Fuente:** el Catálogo ATS oficial actualizado el 06/08/2026 (SHA-256 `bd3f7834…`), hoja "TABLAS RETENCIONES", tabla 3.10, bloque "DESDE 06/AGOSTO/2026": 127 filas.
- **Dataset `withholding-income-concept` versión 1:** las 127 filas completas, cada una con:
  - el código literal de la fuente;
  - una `entryKey` estable derivada del código (un espacio pasa a `-`: `323 M` → `323-M`);
  - la denominación oficial y el módulo (residente o no residente);
  - el porcentaje cuando la celda es un número, o el texto literal cuando no lo es;
  - la vigencia desde el 06/08/2026 (`SOURCE_STATED`) y la clasificación.
- **Clasificación**, una regla por categoría, guardada en el dataset y revisada contra el extracto de la fuente:

  | Clasificación | Regla | Filas |
  | --- | --- | --- |
  | `OUT_OF_SCOPE_NON_RESIDENT` | Módulo "CÓDIGOS PARA PAGOS A NO RESIDENTE" | 43 |
  | `OUT_OF_SCOPE_VARIABLE` | El porcentaje de la fuente no es un número: texto, rango, "varios porcentajes", por mil o según convenio | 14 |
  | `OUT_OF_SCOPE_SPECIAL_STRUCTURE` | Residente con porcentaje fijo que exige una estructura excluida por Q-50: banano (340, entre los códigos que el anexo 10 asocia a `compraCajBanano`), dividendos (325, 3250, 328, 329 y 331, de sustento 10 y bloque `dividendos`) y pago al exterior (332H) | 7 |
  | `OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION` | El código lleva un espacio interno en la fuente (`323 M`, `323 N`, `323 O`, `323 P`); la fuente no establece si el `codigoRetencion` del XML lo conserva | 4 |
  | `SUPPORTED_FIXED_RESIDENT` | El resto: residente, porcentaje numérico fijo, sin estructura excluida | 59 |

- **Cantidad soportada:** 59 de 127. No hay ninguna constante con ese número: sale de contar la clasificación del dataset, y una prueba lo fija para esta versión del dataset.
- **Bloques anteriores:** la fecha de emisión es siempre la de la reserva (D12), así que ningún comprobante del sistema puede resolverse con un bloque anterior al 06/08/2026. No se transcriben, y siguen en el extracto archivado. Un bloque nuevo del SRI es una versión nueva del dataset, que cierra las vigencias que cambian.
- **Alternativa descartada:** transcribir solo los soportados. Perdería la trazabilidad de por qué un código no se ofrece y obligaría a rehacer el dataset para ampliar el alcance.

### D8. Códigos de retención del IVA y "no procede"

- **Dataset `withholding-iva-code` versión 1:** la tabla 20 de la ficha v2.34 (página 33), con vigencia desde el 27/07/2026 (`PROJECT_BASELINE`, la tabla no declara fecha):
  - 9 (10 %), 10 (20 %), 1 (30 %), 11 (50 %), 2 (70 %) y 3 (100 %): `SUPPORTED_FIXED`;
  - 7, "Retención en cero" (0 %), con la nota de la fuente que la remite a la Disposición Transitoria Única de la Res. NAC-DGERCGC15-00000284: `SUPPORTED_FIXED`;
  - 8, "No procede retención" (0 %): `OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION`.
- **Decisión sobre el código 8.** Se distinguieron tres lecturas:
  - (A) una retención válida con 0 % y valor 0.00;
  - (B) una clasificación que indica que no existe retención del IVA, y entonces no debería aparecer en un comprobante;
  - (C) otra semántica de reporte.

  La ficha lo publica en la tabla 20 bajo "No procede retención", sin nota. El anexo 10 admite cualquier código de la tabla 20 en `codigoRetencion`, lo que hace válida la estructura pero no decide entre las lecturas. La tabla 11 del Catálogo ATS no lista los códigos 7 ni 8, pero el ATS reporta el IVA retenido por porcentaje, así que su ausencia no prueba nada. La fuente no permite decidir de forma inequívoca: el código 8 se conserva en el dataset con su razón, no es seleccionable y una solicitud que lo envíe se rechaza (`WITHHOLDING_IVA_CODE_NOT_SUPPORTED`). Nunca se convierte en una retención del 0 %.
- **Código 7:** su denominación es "Retención en cero", una retención con porcentaje fijo 0 % (lectura A). Es seleccionable. La interfaz muestra su nota oficial y su aplicabilidad es responsabilidad del agente, como la de cualquier concepto.
- **ISD:** la tabla 20 publica también el ISD (4580 y 4586); no se transcribe en este cambio porque el impuesto está fuera del MVP (`withholding-isd`).

### D9. Impuestos a retener

- **Dataset `withholding-tax` versión 1:** la tabla 19 de la ficha v2.34 (página 32): 1 renta y 2 IVA `SUPPORTED`, 6 ISD `OUT_OF_SCOPE_PENDING_EVIDENCE`.
- Una retención declara su impuesto (renta o IVA), que decide de qué catálogo sale su concepto: renta con `withholding-income-concept` e IVA con `withholding-iva-code`. El XML escribe `codigo` 1 o 2.

### D10. Tipos de documento sustento y códigos de sustento

- **Dataset `support-document-type` versión 1:** la tabla 4 del Catálogo ATS completa (39 filas), con los códigos de sustento que admite cada tipo según su columna "Sustento tributario". Son `SUPPORTED` el 01 factura, el 02 nota o boleta de venta y el 03 liquidación de compra; el resto queda fuera de alcance.
- **Dataset `support-code` versión 1:** la tabla 5 completa (17 códigos), con su vigencia literal (el 00 cerró el 28/02/2015):
  - `SUPPORTED`: 01 a 07, 14 y 15;
  - fuera de alcance: 08 y 09 (reembolsos, Q-50), 10 (dividendos), 11, 12 y 13 (tipos de documento fuera del MVP) y 00 (vencido).
- **Compatibilidad:** un sustento solo es utilizable con un tipo que lo admite según la tabla 4, si ambos están soportados y el sustento está vigente en la fecha de emisión. Por ejemplo, la nota de venta admite 02, 04, 05, 07, 14 y 15, sin el 01 de crédito tributario del IVA.
- **Formato de los códigos:** la hoja guarda los tipos como números (`1.0`). Se escriben con dos dígitos (`01`, `02`, `03`), como el `codDoc` de esos comprobantes en la tabla 3 de la ficha y el tipo de comprobante del ATS. El XSD admite de 1 a 3 dígitos. El sustento se escribe con los dos dígitos literales de la tabla 5 (patrón `[0-9]{2}` del XSD).

### D11. Infraestructura de los catálogos nuevos

- **Tipos nuevos** en `FISCAL_CATALOG_TYPES`, cada uno con su esquema de dataset estricto: `withholding-tax`, `withholding-iva-code`, `withholding-income-concept`, `support-document-type` y `support-code`.
- **Base de datos** (D28): los `CHECK` de `catalog_type` admiten los tipos nuevos, y el de `code` pasa a depender del catálogo. Los conceptos de la renta admiten su código literal, de 3 o 4 dígitos con un sufijo opcional, o con un espacio y una letra, y los demás siguen con dígitos. `fiscal_catalog_entry` gana:
  - `scope_classification`, con su `CHECK` por catálogo;
  - `rate_text`, el texto literal de un porcentaje variable;
  - `allowed_support_codes`, los sustentos de un tipo de documento.
- **Habilitación:** `withholding-iva-code` y `withholding-income-concept` son habilitables, habilitados por defecto (ERS RF-234, "catálogos configurados/vigentes"; BR-40). Los demás no son habilitables.
  - Una entrada es utilizable si está soportada, vigente y habilitada.
  - Habilitar o deshabilitar una entrada fuera de alcance se rechaza (`CATALOG_ENTRY_NOT_SELECTABLE`), para no mostrar un estado que no tiene efecto.
- **Sin sincronización:** los datasets se distribuyen con el producto y se aplican al arrancar, como los demás.
- **Evidencia durable:** el apply archiva en `docs/product/sri-catalogs/fuentes/` extractos literales de las tablas usadas del Catálogo ATS: la 3.10 (el bloque vigente completo, con las filas fuera de alcance), la 4, la 5, la 11 y la 13. Llevan la URL, la fecha de actualización publicada, el SHA-256 del archivo y el método de extracción. También archiva el extracto de las tablas 19 y 20 de la ficha. Una prueba de datos contrasta cada entrada de los datasets con su extracto, como `ice-dataset-review.test.ts` con la tabla 18.
- **Alternativa descartada:** versionar el `.xls` oficial en el repositorio y leerlo al arrancar. Haría del Excel una dependencia de ejecución. El repositorio ya cita la ficha por su hash y archiva extractos, y el SHA-256 permite verificar cualquier copia del archivo.

### D12. Fecha efectiva de la resolución

- La fecha de emisión es la fecha de Ecuador de la reserva (`deps.today()`), como en los demás comprobantes.
- Las entradas de renta e IVA, los sustentos y las formas de pago se resuelven con la fecha de emisión: la vista previa con la de hoy y la reserva otra vez con la suya. La tarifa de IVA de un documento sustento se resuelve con la fecha de ese documento (D6).
- Nunca se usan la fecha del servidor después de reservar, el período fiscal ni la fecha del documento sustento para las retenciones.
- Al reservar, el snapshot congela la entrada (`catalogType`, `entryKey`, `versionId`, `datasetVersion`), su código, su denominación y su porcentaje.

### D13. Cálculo exacto: `calculateWithholdingAmounts`

- Versión 1, pura y sin `number`, sobre `platform/decimal`:
  - por retención: `valorRetenido = roundHalfUp(percentageOfExact(base, porcentaje), 2)`;
  - total retenido del comprobante: la suma exacta de los valores, que muestran la vista previa, la consulta y la bandeja. El XML 2.0.0 no tiene un total retenido.
- **Dominios:**
  - base: `importe` y mayor que cero (política del proyecto; el XSD admite cero);
  - porcentaje: el nuevo dominio `porcentajeRetener` (3 dígitos totales, 2 decimales, mayor o igual a cero);
  - valor retenido: `importe`.

  `decimal-policy.md` registra el dominio y el `tarifa` de 3 dígitos del documento sustento.
- El XML escribe el porcentaje y la tarifa en su forma canónica sin ceros finales (`1.75`, `10`, `100`), que cumple los 3 dígitos totales.
- **Pruebas:**
  - golden, entre ellas 100.29 al 1.75 % = 1.76, 100.00 al 30 % = 30.00, 0.03 al 2 % = 0.00 y una retención en cero;
  - property tests: el valor es el redondeo de la base por el porcentaje, ninguno es negativo ni tiene más de 2 decimales, y el total es la suma;
  - la prueba de que el módulo no usa `number` ni la librería decimal directamente.

### D14. Snapshot autosuficiente

Después de `RESERVED`, la verdad fiscal del comprobante es su snapshot. Guarda:

- `snapshotVersion: 1`; el esquema (`07`, `2.0.0`, ruta, hash e imports); la versión del builder; `calculationVersion`; las versiones de los datasets y de la configuración;
- la fecha de emisión, el ambiente y su código; el emisor vigente al reservar con sus leyendas;
- `subject`: identificador del tercero, tipo de identificación, identificación y razón social;
- `relatedParty` (D4) y `fiscalPeriod`;
- `supports`, cada uno con:
  - posición, tipo de documento con su denominación, código de sustento con su denominación, número, fecha y autorización;
  - totales;
  - `taxes`: código, código de porcentaje, tarifa, base, valor y la referencia de la entrada `iva-rate`;
  - `payments`: código, denominación, total y la referencia de la entrada `payment-method`;
  - `withholdings`: posición, impuesto, referencia de la entrada, código, denominación, base, porcentaje y valor;
- `totals.withheld`;
- `key`: número, secuencial, código numérico, tipo de emisión y `accessKey`.

### D15. Transacción de la reserva y atomicidad

- **Antes de la transacción**, sin consumir nada y en este orden:
  1. permiso, `Idempotency-Key` y empresa de la sesión;
  2. borrador de la empresa con la versión esperada y repetición en el registro de idempotencia;
  3. esquema disponible con su hash;
  4. sujeto (D3) y `parteRel`;
  5. período;
  6. límites de recursos;
  7. por documento: tipo, sustento, número, fecha, autorización, totales, impuestos y pagos;
  8. por retención: impuesto, entrada soportada, vigente y habilitada, y base;
  9. cálculo dentro de los dominios;
  10. empresa configurada, contribuyente especial compatible con la retención (de 3 a 5 caracteres, `WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE`), punto disponible y firma utilizable.
- **Transacción de `RESERVED`**, sin I/O externo dentro:
  1. bloquear el borrador y comprobar su estado y su versión;
  2. bloquear la configuración tributaria;
  3. volver a leer el tercero y a resolver el catálogo con la fecha de la reserva, y volver a evaluar;
  4. armar el snapshot sin la clave;
  5. `reserveDocumentIn` con el tipo `07`;
  6. registrar el comprobante con su período, su sujeto, su parte relacionada y sus líneas (D28);
  7. borrador `EMITTED`;
  8. registro de idempotencia;
  9. auditoría `withholding_receipt.reserved`;
  10. commit.

  El XML, la firma y la red ocurren después del commit, en el pipeline compartido.
- **Concurrencia:** no hay recursos compartidos que bloquear, porque los documentos sustento son externos. Dos retenciones simultáneas al mismo proveedor son válidas; dos emisiones del mismo borrador se serializan por su bloqueo.
- **Todo o nada:** una prueba fuerza el fallo después de cada paso y comprueba que no quedan secuencial, clave, comprobante, líneas, snapshot, borrador emitido, idempotencia ni auditoría.

### D16. Numeración, clave e idempotencia

- **Numeración y clave:** tipo `07`, con un contador por empresa, ambiente, establecimiento, punto y tipo. La clave se compone en la reserva con `documentType: "07"`. Una prueba extiende la de secuenciales independientes con una retención entre facturas y notas.
- **Idempotencia:** operación `withholding_receipt.emit`, por empresa y clave, sin TTL, insertada en la transacción.
- **Huella canónica:** `draftId`, `expectedVersion` y los datos funcionales de esa versión del borrador:
  - el tercero, `relatedParty`, `fiscalPeriod` y el punto;
  - cada documento en orden con todos sus campos, impuestos, pagos y retenciones (impuesto, `entryKey` y base).

  Se serializa con claves ordenadas y posiciones explícitas.
- **Respuestas:**
  - la misma huella devuelve el mismo comprobante (`200`) y reanuda la firma si quedó reservado;
  - otra huella responde `409 IDEMPOTENCY_KEY_REUSED`;
  - un borrador ya emitido con otra clave responde `409 WITHHOLDING_DRAFT_ALREADY_EMITTED`;
  - sin clave, `400 IDEMPOTENCY_KEY_REQUIRED`.

### D17. Builder XML `comprobanteRetencion` 2.0.0 y firma

- `sri-engine/infrastructure/withholding-receipt-xml-builder.ts`, puro y determinista, con versión de builder `1`. Mapea solo desde el snapshot y no usa el builder de alto nivel de la dependencia.
- Reutiliza `xml-writer.ts` e `infoTributaria` con `codDoc` 07, `agenteRetencion` y `contribuyenteRimpe`.
- **Contenido, en el orden del XSD:**
  - `infoCompRetencion`: `fechaEmision`, `dirEstablecimiento`, `contribuyenteEspecial` y `obligadoContabilidad` cuando corresponden, `tipoIdentificacionSujetoRetenido`, `parteRel`, `razonSocialSujetoRetenido`, `identificacionSujetoRetenido` y `periodoFiscal`, sin `tipoSujetoRetenido`;
  - por documento, `docSustento` con:
    - `codSustento`, `codDocSustento`, `numDocSustento`, `fechaEmisionDocSustento` y `numAutDocSustento` si se declaró;
    - `pagoLocExt` 01, `totalSinImpuestos` e `importeTotal`;
    - `impuestosDocSustento`, `retenciones` (`codigo`, `codigoRetencion`, `baseImponible`, `porcentajeRetener`, `valorRetenido`) y `pagos`.
- **No escribe:** `fechaRegistroContable`, `tipoRegi`, `paisEfecPago`, `aplicConvDobTrib`, `pagExtSujRetNorLeg`, `pagoRegFis`, los totales de reembolso, `reembolsos`, `dividendos`, `compraCajBanano`, `maquinaFiscal` ni `infoAdicional`. El anexo 10 marca `infoAdicional` como "Opcional" para la retención.
- El pipeline compartido valida contra `ComprobanteRetencion_V2.0.0.xsd` antes y después de firmar, y el firmador recibe el tipo `07`.
- **Pruebas:** golden fixtures de bytes exactos, todos validados contra el XSD oficial:
  - un documento con renta;
  - un documento con renta e IVA;
  - varios documentos con varias retenciones;
  - retención en cero;
  - sujeto con caracteres especiales;
  - sustento con y sin autorización.

  Además, el XML firmado validado y el artefacto con el tipo `07`.

### D18. Transmisión y reconciliación

- Sin cambios en el transporte, la cola, la máquina de estados ni los clasificadores.
- Se repiten con un comprobante de retención y respuestas SINTÉTICAS los casos de la transmisión:
  - `RECIBIDA`, `DEVUELTA`, `AUTORIZADO`, `NO AUTORIZADO` y una respuesta sin estado;
  - los errores 70, 43 y 45;
  - el fallo que demuestra que la solicitud no salió (`NOT_SENT`) y el resultado incierto (`SEND_UNKNOWN`);
  - la reconciliación automática y la manual, y la revisión manual;
  - la respuesta guardada antes de clasificar, y su reclasificación sin otra llamada al SRI.
- La transmisión real queda apagada (`SRI_TRANSMISSION_ENABLED` falso) en todo el cambio.

### D19. RIDE del comprobante de retención

- **Lectura:** `comprobanteRetencion` 2.0.0 en `ride-source.ts`, con una lista blanca de los elementos que escribe el builder de D17 y un modelo `RideWithholdingReceipt`. Un elemento fuera de la lista blanca detiene la generación.
- **Denominaciones:** la del tipo de documento sustento y la del impuesto llegan desde el snapshot al handler del RIDE, como ya llegan las de las formas de pago, nunca desde el catálogo vigente.
- **Distribución propia** según la ficha v2.34, anexo 2, página 63, que rige la versión 2.0.0 (ficha, página 108), con versión de renderer `retencion-1`:
  - cabecera con RUC, "COMPROBANTE DE RETENCIÓN", número, autorización, fecha y hora, ambiente, emisión y clave con Code128;
  - emisor con sus leyendas;
  - sujeto retenido con su identificación y la fecha de emisión;
  - una tabla con las columnas Comprobante, Número, Fecha Emisión, Ejercicio Fiscal, Base Imponible para la Retención, Impuesto, Porcentaje Retención y Valor Retenido, con una fila por retención y los datos de su documento.

  Sin información adicional, que el sistema no emite. Las filas se paginan con el paginador vigente.
- **Reutiliza** pdfmake, bwip-js, Noto Sans, el pool, el job, el artefacto, las descargas y las entregas.
- **Pruebas:**
  - golden con el texto de las páginas y la lectura del Code128;
  - varios documentos y varias retenciones;
  - paginación con el máximo de filas;
  - los mismos bytes en dos procesos;
  - contenido no emitido que detiene la generación;
  - el RIDE de los demás tipos sin cambios.

### D20. Bandeja y frontend compartido

- `EMITTED_DOCUMENT_TYPES = ["01", "04", "05", "07"]` y `DOCUMENT_KINDS["07"]`:
  - nombre "comprobante de retención";
  - `/retenciones` y `/withholding-receipts`;
  - `withholdings.reconcile` y `WITHHOLDING_NOT_RECONCILABLE`;
  - sus esquemas de vista y de transmisión.
- La bandeja muestra como total el total retenido y como receptor al sujeto retenido.
- `DocumentsSection` y `TransmissionSection` no cambian.

### D21. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/withholding-receipts/suppliers` | Proveedores activos con identificación admitida, con búsqueda por identificación o razón social | `withholdings.draft` |
| `GET/POST /api/v1/withholding-receipts/drafts`, `GET/PUT/DELETE /api/v1/withholding-receipts/drafts/{draftId}` | Borradores con su vista previa | `withholdings.draft` |
| `GET /api/v1/withholding-receipts/options` | Conceptos de renta y códigos de IVA utilizables, tipos y sustentos compatibles, tarifas de IVA y formas de pago, con la fecha de resolución | `withholdings.draft` |
| `POST /api/v1/withholding-receipts` | Emisión con `Idempotency-Key` (`201`, o `200` en la repetición) | `withholdings.emit` |
| `GET /api/v1/withholding-receipts`, `GET /api/v1/withholding-receipts/{withholdingReceiptId}` | Consulta y detalle, con búsqueda por número o proveedor y filtros de estado y período | `withholdings.read` |
| `GET /api/v1/withholding-receipts/{withholdingReceiptId}/transmission` | Historial de la transmisión | `withholdings.read` |
| `POST /api/v1/withholding-receipts/{withholdingReceiptId}/signing-attempts` | Reintento de firma | `withholdings.retrySigning` |
| `POST /api/v1/withholding-receipts/{withholdingReceiptId}/reconciliations` | Reconciliación manual (`202`) | `withholdings.reconcile` |

- **Borrador:** `{ partyId, relatedParty, fiscalPeriod, emissionPointId, supports: [...] }`.
  - Cada documento: `{ documentType, supportCode, number, issueDate, authorizationNumber, totalWithoutTaxes, importTotal, taxes: [{ rateEntryKey, base, amount }], payments: [{ paymentMethod, total }], withholdings: [{ tax, entryKey, base }] }`.
  - Se puede guardar incompleto: cada campo puede faltar y la vista previa lo informa.
  - Un porcentaje, una denominación, un valor retenido, un `companyId` o un campo del exterior se rechazan: los cuerpos son estrictos.
- **Emisión:** `{ draftId, expectedVersion }`.
- **Vista previa:**
  - por documento, sus retenciones con código, denominación, porcentaje y valor;
  - `totals.withheld`, `periodDiffersFromIssueMonth` y `evaluatedOn`;
  - `issues` con la posición del documento y de la retención.
- **Códigos de error:**
  - sujeto: `WITHHOLDING_SUBJECT_CONSUMER_FINAL`, `WITHHOLDING_SUBJECT_FOREIGN_OUT_OF_SCOPE`, `WITHHOLDING_SUBJECT_NOT_SUPPLIER`, `WITHHOLDING_SUBJECT_INACTIVE` y `WITHHOLDING_RELATED_PARTY_REQUIRED`;
  - período: `WITHHOLDING_FISCAL_PERIOD_INVALID` y `WITHHOLDING_FISCAL_PERIOD_IN_FUTURE`;
  - documentos: `WITHHOLDING_SUPPORTS_REQUIRED`, `WITHHOLDING_SUPPORT_TYPE_NOT_SUPPORTED`, `WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE`, `WITHHOLDING_SUPPORT_INVALID`, `WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE`, `WITHHOLDING_SUPPORT_TAX_INVALID` y `WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE`;
  - retenciones: `WITHHOLDING_ITEMS_REQUIRED`, `WITHHOLDING_TAX_NOT_SUPPORTED`, `WITHHOLDING_CONCEPT_NOT_SUPPORTED`, `WITHHOLDING_IVA_CODE_NOT_SUPPORTED`, `WITHHOLDING_ENTRY_NOT_USABLE`, `WITHHOLDING_BASE_INVALID` y `WITHHOLDING_AMOUNT_OUT_OF_RANGE`;
  - límites y empresa: `WITHHOLDING_RESOURCE_LIMIT` (con el límite y su naturaleza de defensa) y `WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE`;
  - borrador y estado: `WITHHOLDING_DRAFT_INCOMPLETE`, `WITHHOLDING_DRAFT_CHANGED`, `WITHHOLDING_DRAFT_ALREADY_EMITTED` y `WITHHOLDING_NOT_RECONCILABLE`;
  - y los compartidos de la emisión.
- **Prueba de tipos emitidos:** `emitted-document-types.test.ts` exige `["/credit-notes", "/debit-notes", "/invoices", "/withholding-receipts"]`, sin guía ni liquidación.

### D22. Permisos

- `withholdings.read`, `withholdings.draft`, `withholdings.emit` y `withholdings.retrySigning`: administrador y operador.
- `withholdings.reconcile`: solo el administrador, como en los demás tipos.
- Cada caso de uso exige su permiso en el servidor antes de leer o escribir. La empresa sale siempre de la sesión, nunca de un `partyId` o un `companyId` del cliente.
- La bandeja y las descargas usan los `archive.*` vigentes, y crear un proveedor usa `parties.manage`.
- La matriz va en `access-policy.ts`, su espejo del frontend y `access-control.md`.

### D23. Auditoría

- **`withholding_receipt.reserved`**, con hechos funcionales seguros:
  - comprobante, número, clave, ambiente y total retenido;
  - sujeto (identificación y razón social), período fiscal y la declaración de parte relacionada con su base;
  - número de documentos y de retenciones, y los impuestos retenidos.

  Sin XML ni SOAP.
- **`withholding_receipt.signed`** (artefacto) y **`withholding_receipt.signing_retried`**.
- **`withholding_receipt.reconciliation_requested`** (motivo) y **`withholding_receipt.reconciliation_completed`** (resultado), sin la respuesta del SRI.
- **Sin eventos** para borradores, consultas, transmisión automática ni entregas.

### D24. Pantallas

- **Retenciones** (`/retenciones`, en "Operación", `withholdings.read`).
  - Brief: administrador u operador; el objetivo es encontrar una retención y su estado, y la decisión es qué retención abrir.
  - Información mínima: número, proveedor, período fiscal, total retenido y estado.
  - Acción principal: abrir la retención; secundaria: "Nueva retención" (`withholdings.draft`).
  - P0 número, estado y total retenido; P1 proveedor, período y fecha; P2 búsqueda y filtros (estado y período en la URL); P3 identificadores, que no se muestran.
  - `AppDataTable` con paginación del servidor y tarjetas por debajo de 768 px. Los borradores en curso, con su eliminación.
- **Borrador** (`/retenciones/borradores/nueva` y `/retenciones/borradores/{id}`, `withholdings.draft`).
  - Brief: administrador u operador con `withholdings.draft`; el objetivo es acreditar las retenciones de un pago sin equivocar el concepto ni el porcentaje. Las decisiones son el proveedor, el período, la parte relacionada, los documentos y el concepto y la base de cada retención.
  - Información mínima: el proveedor, el período, los documentos con sus retenciones, los porcentajes y valores del servidor, el total retenido y los problemas.
  - Acción principal: "Emitir retención".
  - P0 retenciones con su concepto, base, porcentaje y valor, y los problemas que bloquean; P1 proveedor, período y total retenido; P2 datos de cada documento (número, fecha, autorización, totales, impuestos y pagos) y el punto; P3 identificadores, versiones y `entryKey`, que no se muestran.
  - Pasos y controles:
    1. el proveedor, con `EntityPickerDialog` (conjunto grande) y "Nuevo proveedor", que abre `PartyDialog` con el rol de proveedor;
    2. la parte relacionada, con un `SegmentedControl` SI/NO sin selección inicial, porque se declara;
    3. el período, con un selector de mes y año que propone el mes de emisión, y un aviso visible cuando difiere;
    4. los documentos: una lista ordenada con agregar y quitar, tarjetas en pantallas angostas; por documento, el tipo con un `SegmentedControl` de tres opciones, el sustento con un `Select` filtrado por el tipo, el número con máscara `001-001-000000001`, la fecha con `DatePickerField` y la autorización opcional;
    5. los totales, los impuestos (tarifa con un `Select`, base y valor) y los pagos (forma de pago con un `Select` y total) de cada documento;
    6. las retenciones de cada documento: el impuesto con un `SegmentedControl` renta/IVA; el concepto de renta con un combobox con búsqueda (59 opciones con denominaciones largas) y el código de IVA con un `Select`; la base;
    7. la vista previa del servidor del borrador guardado, con el porcentaje y el valor de cada retención en solo lectura y los problemas junto a su documento y su retención;
    8. emitir.
  - El porcentaje y el valor retenido nunca son campos editables. La interfaz muestra los del servidor, y el código 7 con su nota oficial.
  - **Emisión:** un `ConfirmDialog` con el resumen: proveedor, período (resaltado si difiere del mes de emisión), parte relacionada, documentos y total retenido. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/retenciones/{id}`): estado, proveedor, período, parte relacionada "declarada por" el usuario, documentos con sus impuestos, pagos y retenciones, total retenido, diagnóstico y reintento de firma, transmisión y documentos.
  - Brief: el objetivo es confirmar que la retención quedó autorizada y entregar sus documentos. La decisión es si reintentar la firma o pedir la reconciliación (administrador). Acción principal: descargar el RIDE de una retención autorizada, o reintentar la firma de una reservada.
  - P0 estado, número y total retenido; P1 proveedor, período y retenciones por documento; P2 impuestos y pagos de cada documento, declaración, transmisión y documentos; P3 identificadores y hashes, que no se muestran.
- **Catálogos fiscales:** cinco catálogos nuevos de consulta con su fuente y su clasificación. Los conceptos de renta y los códigos de IVA soportados tienen su habilitación por empresa (administrador); los fuera de alcance muestran su clasificación y su razón, sin control de habilitación.
- **Estados cubiertos:** carga, vacío, error, sin permiso, éxito, responsive, teclado, los dos temas y el doble clic que envía una sola emisión.

### D25. Límites de recursos

- **Variables**, con el patrón de `INVOICE_MAX_LINES` (máximo absoluto en el contrato y límite efectivo configurable):

  | Variable | Por defecto | Rango |
  | --- | --- | --- |
  | `WITHHOLDING_MAX_SUPPORTS` | 10 | 1 a 30 |
  | `WITHHOLDING_MAX_ITEMS_PER_SUPPORT` | 5 | 1 a 10 |
  | `WITHHOLDING_MAX_TAXES_PER_SUPPORT` | 5 | 1 a 10 |
  | `WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT` | 5 | 1 a 10 |

  El tamaño del cuerpo sigue limitado por `JSON_BODY_LIMIT`.
- **Justificación de los valores por defecto:** el tamaño del XML firmado.
  - Con valores de longitud máxima, cada bloque mide en UTF-8 aproximadamente: impuesto 242 bytes, retención 215, pago 68, documento sin hijos 500, cabeceras 1 817 y firma con certificado unos 4 200.
  - Con los valores por defecto, el peor caso es de unos 37 KB. Entra incluso en la lectura más conservadora de "320 Kb" de la ficha, 320 kilobits o 40 000 bytes, mientras Q-47 no fije la cifra.
  - Los máximos absolutos (30 documentos con 10 elementos de cada clase) dan unos 179 KB, por debajo de 320 000 bytes.
  - El benchmark (D27) mide el tamaño firmado real y el CPU y la memoria del peor caso. Si contradice el modelo, los valores se ajustan con `/opsx:update` antes de archivar.
  - La política de tamaño del envío (Q-47) sigue siendo la compuerta final de la transmisión.
- Los errores y la interfaz presentan el límite como una defensa del sistema, nunca como una regla del SRI. `deployment.md` documenta las variables.

### D26. Observabilidad

- `withholding_receipt_reservations_total`: reservas confirmadas, sin etiquetas de empresa ni comprobante.
- `withholding_receipt_items_total{tax}`: retenciones reservadas por impuesto, con `income` e `iva` como únicos valores.
- La transmisión, la autorización y el RIDE usan sus métricas vigentes. `observability.md` lo documenta.

### D27. Rendimiento

- **Server-Timing** con `EMISSION_STAGE_TIMINGS`, como los demás tipos; nunca en producción.
- **`bench:withholding-receipts`**, fuera de `verify`, sobre un esquema aislado con 10 000 proveedores y 100 000 retenciones emitidas (volumen de Q-26), con el barrido del RIDE apagado. Mide:
  - la búsqueda de proveedores;
  - la creación y la vista previa de un borrador con el máximo de documentos y de retenciones;
  - la resolución de los catálogos;
  - el cálculo de muchas retenciones;
  - la reserva en serie, y simultánea para un mismo proveedor y para proveedores distintos, con su rendimiento;
  - la lista y la búsqueda de retenciones;
  - el XML con su validación XSD y el tamaño firmado del peor caso;
  - el RIDE de un documento y el del máximo de filas.
- **Objetivos:** ERS RNF-005 (P95 menor que 2 s) donde aplica, y el P95 del render del RIDE menor que 1 s. La transacción de la reserva se mide aparte del XML, el XSD y la firma.
- El resultado va a `docs/quality/benchmarks/` y a `performance.md`.

### D28. Migraciones

Una migración aditiva:

- **`withholding_receipt_draft`:**
  - empresa, versión, estado `DRAFT`/`EMITTED` y comprobante;
  - tercero, parte relacionada, período (`CHECK` del patrón) y punto, todos opcionales mientras se prepara;
  - `supports` como `JSONB`, validado por el contrato al escribir, con un `CHECK` de tipo arreglo y de tamaño máximo como defensa.

  Un borrador emitido no cambia ni se borra. Es un documento de trabajo, no fiscal: la verdad del comprobante es su snapshot.
- **`withholding_receipt`:** una fila inmutable por comprobante, con empresa, comprobante (único), tercero, período y parte relacionada. Un trigger exige que el comprobante sea un `07` de la empresa.
- **`withholding_receipt_line`:** una fila inmutable por retención, con:
  - comprobante, posición del documento y de la retención;
  - tipo, sustento, número y fecha del documento;
  - impuesto, código de retención, `entryKey`, base, porcentaje y valor, con sus `CHECK` de dominio.

  Sirve a la consulta, a los filtros y al reporte de retenciones del cambio 15 (ERS §11).
- **Trigger de restricción diferido:** un `electronic_document` de tipo `07` no se confirma sin su fila de `withholding_receipt` y al menos una línea. Es el mismo acoplamiento intencional de las notas, documentado en `database.md`.
- **Catálogos:** los `CHECK` de `catalog_type` en `fiscal_catalog_dataset`, `fiscal_catalog_key` y `company_fiscal_catalog_setting`; el `CHECK` de `code` por catálogo; las columnas `scope_classification`, `rate_text` y `allowed_support_codes` con sus `CHECK` de atributos por catálogo.
- **Idempotencia:** `withholding_receipt.emit` en el `CHECK` de `idempotency_record`.
- FK compuestas por empresa y sin índices parciales. Sin backfill ni cambios a comprobantes, capacidades, artefactos o movimientos existentes.

### D29. Operaciones sensibles

| Pregunta | Borrador y vista previa | Emisión (reserva) | Reintento de firma | Reconciliación manual |
| --- | --- | --- | --- | --- |
| Quién | `withholdings.draft` | `withholdings.emit` | `withholdings.retrySigning` | `withholdings.reconcile` (administrador) |
| Empresa | La de la sesión | La de la sesión | La de la sesión | La de la sesión |
| Propiedad | Tercero y borrador por `(company_id, id)` | Igual, y las líneas por comprobante | Comprobante por `(company_id, id)` | Comprobante por `(company_id, id)` |
| ¿Otro ID llega a otra empresa? | No: `404` | No: `404` | No: `404` | No: `404` |
| Dos veces | Versión del borrador | `Idempotency-Key` y bloqueo del borrador | Arriendo de la firma | Una solicitud programada por comprobante |
| A la vez | Versión | Bloqueo del borrador y de la configuración | Arriendo | Bloqueo del comprobante |
| Restricciones | Contrato estricto, catálogos soportados y límites | Trigger del tipo, diferido del `07`, dominios de las líneas e idempotencia | Estado `RESERVED` | Estado reconciliable |
| Auditoría | No | `withholding_receipt.reserved` | `withholding_receipt.signing_retried` | `withholding_receipt.reconciliation_*` |
| Fugas | Solo proveedores y catálogos de la empresa | Sin XML ni SOAP en la auditoría | Sin secretos | Sin SOAP |
| Pruebas de autorización | `403` sin permiso, `401` sin sesión, `404` con otra empresa | Igual, y un operador emite | Igual | `403` para el operador, `404` con otra empresa |

### D30. Trazabilidad de las fuentes

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `comprobanteRetencion` 2.0.0 | Oficial | XSD verificado (`sri-catalogs/fuentes/comprobante-retencion-xsd-verificacion.txt`); ficha v2.34, anexo 10 |
| Sujeto retenido identificado, nunca consumidor final | Oficial | Ficha v2.34, página 13, notas de la tabla 6 |
| Contenido y totalización individual | Oficial | Reglamento, art. 40 |
| Emisión al pagar o acreditar; fecha efectiva del catálogo | Oficial (art. 8) y política del MVP (Q-50) | `sri-catalogs/fuentes/reglamento-comprobantes-arts-3-8-40.txt` |
| Impuestos a retener y retención del IVA | Oficial | Ficha v2.34, tablas 19 y 20 |
| Conceptos de la renta; tipos y códigos de sustento; formas de pago del sustento | Oficial | Catálogo ATS (06/08/2026), referido por la ficha v2.34, página 34 y anexo 10 |
| Clasificación y cantidad soportada de la renta | Política del MVP sobre la fuente oficial | D7, Q-50 |
| Código 8 de IVA no seleccionable | Política del MVP por fuente ambigua | D8 |
| ISD fuera | Política del MVP por evidencia insuficiente | Q-50 |
| Período explícito, editable y no futuro | Política del MVP (la fuente exige el ejercicio fiscal) | Q-50 |
| Documentos sustento 01, 02 y 03, uno o más | Política del MVP sobre el XSD | Q-50 |
| Base del usuario, porcentaje del catálogo, valor del servidor con HALF_UP | Política del MVP y política decimal | Q-50, D13 |
| Límites de recursos | Defensa del producto | D25 |
| Sin inventario, capacidades ni compras | Política del producto | BR-75 |

## Risks / Trade-offs

- **Formato de los códigos de documento sustento** (`01` frente a `1`): el XSD admite ambos. → Se usa el de dos dígitos, consistente con la tabla 3 y el ATS; la certificación en Pruebas lo confirma, y un cambio se hace con `/opsx:update` sin migrar datos.
- **Validaciones del SRI no documentadas** sobre los importes del sustento (error 52, "Error en diferencias"): el sistema no compara importes sin fuente. → La certificación incluye retenciones con importes coherentes; una regla que aparezca se propone con su fuente.
- **Conceptos excluidos que un usuario necesita** (porcentaje variable, código ambiguo, dividendos): no los puede emitir. → Quedan visibles con su razón en Catálogos fiscales y como capacidades futuras. Los 4 códigos ambiguos se pueden habilitar con una versión del dataset si la certificación confirma su representación.
- **Catálogo ATS que cambia con frecuencia** (cuatro bloques en 2026): un bloque nuevo exige una versión del producto. → Proceso de catálogos existente; la fecha efectiva protege los comprobantes ya emitidos.
- **Documentos sustento declarados sin verificar:** un error de transcripción llega al SRI. → Validación estructural estricta y la interfaz los presenta como declarados. El SRI responde en la autorización y la evidencia queda guardada.
- **Generalización:** tocar la bandeja, el RIDE, la reconciliación y los catálogos podría romper otros tipos. → Solo se agregan entradas por tipo; los golden y el contrato de regresión no cambian.

## Migration Plan

- Desplegar la migración aditiva, los datasets nuevos y el código. Los comprobantes existentes no cambian.
- Rollback: el código anterior ignora las tablas y los catálogos nuevos; los `CHECK` ampliados no afectan a los datos previos. Las retenciones emitidas son comprobantes fiscales reales: no se revierten, y una versión anterior las seguiría mostrando en la bandeja como tipo 07.
