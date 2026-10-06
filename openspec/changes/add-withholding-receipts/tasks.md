# Tasks

## 1. Fuentes y catálogos de retención

- [x] 1.1 Archivar en `docs/product/sri-catalogs/fuentes/` (design D11):
  - el extracto normalizado del Catálogo ATS oficial, con la URL, la fecha de actualización (06/08/2026), el SHA-256 del archivo (`bd3f7834…`) y el método de extracción;
  - en ese extracto, por cada tabla usada (la 3.10 con el bloque "DESDE 06/AGOSTO/2026" completo, y las tablas 4, 5, 11 y 13): la hoja y la sección de origen, las filas y los campos relevantes con los códigos RAW (incluidos `323 M` y los numéricos `1.0`), la transformación aplicada, la clasificación del MVP y las cantidades de filas de entrada y de salida;
  - el extracto de las tablas 19 y 20 de la ficha v2.34 (páginas 32 y 33, SHA-256 `7333aebf…`).

  El `.xls` no entra al repositorio ni es una dependencia de ejecución. Verificar que cada extracto cita su URL y su SHA-256 y permite auditar la derivación, y actualizar `sri-catalogs/README.md` con las fuentes nuevas
- [x] 1.2 Crear la migración de los catálogos (design D11 y D28):
  - los tipos nuevos en los `CHECK` de `catalog_type`;
  - el `CHECK` de `code` por catálogo, con el código literal de la renta;
  - las columnas `scope_classification`, `rate_text` y `allowed_support_codes`, con sus `CHECK` de atributos por catálogo.

  Verificar con `migrations.test.ts` sin deriva, con pruebas del esquema que rechazan una clasificación inválida, un código fuera de su formato y atributos de otro catálogo, y con los catálogos existentes sin cambios
- [x] 1.3 Agregar los tipos `withholding-tax`, `withholding-iva-code`, `withholding-income-concept`, `support-document-type` y `support-code` a `FISCAL_CATALOG_TYPES`, con sus esquemas de dataset estrictos, sus datasets versión 1 transcritos de los extractos y su carga (design D7 a D10). Verificar con:
  - pruebas de datos que contrastan cada entrada con su extracto, como `ice-dataset-review.test.ts`;
  - la derivación de la renta reproducida desde el extracto por las reglas de design D7 (127 filas → 43 no residentes, 14 variables, 7 de estructura especial, 4 de representación ambigua con su código RAW → 59 soportados) y comparada con el dataset, sin ninguna constante con ese número ni una lista manual de soportados;
  - el código 8 de IVA conservado y fuera de alcance, y el 7 soportado con 0 %;
  - la compatibilidad tabla 4–tabla 5 (la nota de venta sin el sustento 01), la vigencia cerrada del sustento 00 y los tipos `"01"`, `"02"` y `"03"` como códigos de dos caracteres;
  - el test de contrato de equivalencia de design D6: el conjunto vigente de la tabla 13 del extracto y el de `payment-method`, iguales en códigos y denominaciones normalizadas para fechas desde el 01/09/2016, con las diferencias históricas documentadas;
  - arranques repetidos sin cambios y un dataset alterado que impide arrancar
- [x] 1.4 Extender la resolución y la habilitación de `catalogs` (design D11 y D12): utilizable si está soportada, vigente y habilitada; habilitables y habilitados por defecto `withholding-iva-code` y `withholding-income-concept`; habilitar o deshabilitar una entrada fuera de alcance rechazado con `CATALOG_ENTRY_NOT_SELECTABLE`; consulta con la clasificación, el texto literal y los sustentos admitidos. Verificar con pruebas de integración de la resolución por fecha, de la habilitación por empresa y su aislamiento, del `403` del operador y de la consulta de la API, y documentar los catálogos nuevos en `fiscal-catalogs` de `docs/architecture/` y en `glossary.md`

## 2. Esquema de la retención

- [x] 2.1 Crear la migración aditiva de design D28:
  - `withholding_receipt_draft`, con `supports` en `JSONB`, sus `CHECK` de forma y tamaño, el período con su patrón y la guarda que impide cambiar o borrar un borrador emitido;
  - `withholding_receipt` y `withholding_receipt_line`, inmutables, con el trigger que exige un comprobante `07` de la empresa y los `CHECK` de dominio de las líneas;
  - el trigger de restricción diferido que impide confirmar un `07` sin su fila y al menos una línea;
  - FK compuestas por empresa y `withholding_receipt.emit` en el `CHECK` de `idempotency_record`.

  Verificar con pruebas de integración del esquema:
  - un `07` sin su registro o sin líneas, rechazado al confirmar;
  - las facturas y las notas no afectadas por el trigger;
  - líneas y registro que no cambian ni se borran;
  - borrador emitido inmutable;
  - registro de otra empresa o de otro tipo rechazado;
  - la operación nueva en el registro de idempotencia
- [x] 2.2 Añadir las tablas a `migrations.test.ts` y documentarlas, con el acoplamiento intencional del trigger diferido, en `database.md`. Verificar que `migrations.test.ts` pasa sin deriva

## 3. Contratos y permisos

- [x] 3.1 Crear `packages/contracts/src/withholding-receipts.ts` (design D21):
  - el borrador estricto con sus documentos, impuestos, pagos y retenciones, con importes como texto decimal;
  - la emisión `{ draftId, expectedVersion }`;
  - las opciones, la vista previa, las vistas de lista y detalle, la transmisión, los códigos de error y los máximos absolutos de los límites.

  Registrar las rutas en `apiRoutes` con su router en los grupos 6 y 8. Verificar con pruebas de contratos que se rechazan:
  - un porcentaje, una denominación o un valor retenido en el cuerpo;
  - un `companyId` o campos del exterior, de reembolso o de dividendos;
  - un período fuera de `MM/AAAA`, un número de documento que no tiene 15 dígitos y una autorización que no tiene 10, 37 o 49;
  - un tipo de documento como número (`1`) o fuera de `"01"`, `"02"` y `"03"`; un impuesto del documento fuera de 2, 3 y 5; una tarifa enviada para el IVA; una retención de impuesto 3, 5 o 6;
  - una base como número, con 3 decimales o en cero;
  - más elementos que los máximos absolutos
- [x] 3.2 Añadir `withholdings.read`, `withholdings.draft`, `withholdings.emit` y `withholdings.retrySigning` para ADMIN y OPERATOR, y `withholdings.reconcile` solo para ADMIN, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D22). Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz
- [x] 3.3 Añadir las variables de los límites de design D25 al esquema de entorno, con sus valores por defecto y sus rangos, y documentarlas en `deployment.md` como defensas de recursos. Verificar con pruebas del esquema de entorno (valor por defecto, valor configurado y valor fuera de rango rechazado)

## 4. Dominio de la retención

- [x] 4.1 Añadir el dominio decimal `porcentajeRetener` (3 dígitos totales, 2 decimales) e implementar `calculateWithholdingAmounts` versión 1 (design D13), sin `number`. Verificar con:
  - los golden de design D13;
  - property tests con generador determinista;
  - la forma canónica del porcentaje y de la tarifa de 3 dígitos;
  - la prueba de que el módulo no usa `number` ni la librería decimal directamente.

  Documentar el dominio en `decimal-policy.md` y el cálculo en `fiscal-emission.md`, citando la función y su versión
- [x] 4.2 Implementar la evaluación en el orden de design D15 y la vista previa pura (design D3 a D6, D8, D9 y D12):
  - sujeto, parte relacionada y período (con el aviso de período distinto del mes de emisión);
  - documentos con tipo, sustento compatible, número, fecha, autorización y totales; impuestos de IVA, ICE e IRBPNR con su código de porcentaje vigente en la fecha del documento y la tarifa del catálogo (IVA) o declarada (ICE e IRBPNR); y pagos utilizables;
  - retenciones con impuesto, entrada soportada, vigente y habilitada, y base;
  - límites y contribuyente especial compatible.

  Verificar con pruebas unitarias: cada rechazo con su código y la posición del documento y de la retención; consumidor final citando la ficha; identificación del exterior; tercero sin rol de proveedor; período futuro; concepto variable, de no residente, de dividendos y de código ambiguo; código 8 de IVA; ISD; fecha del sustento posterior a la emisión; código de porcentaje de ICE no vigente en la fecha del documento; IVA diferenciado; importes declarados sin comparaciones ni recálculos; ninguna retención de código 7 u 8 creada sin que el usuario la elija
- [x] 4.3 Implementar el snapshot autosuficiente de design D14 y su construcción. Verificar con pruebas unitarias que guarda el sujeto, `relatedParty` como `USER_DECLARED` (nunca `SYSTEM_VERIFIED`), el período, cada documento con sus impuestos, pagos y retenciones anidadas con sus referencias de catálogo, la versión del cálculo y el total retenido

## 5. XML del comprobante de retención

- [x] 5.1 Crear `withholding-receipt-xml-builder.ts` para `comprobanteRetencion` 2.0.0 desde el snapshot, sin el builder de alto nivel de la dependencia, reutilizando `xml-writer.ts` e `infoTributaria` con `codDoc` 07 (design D17). Verificar con golden fixtures de bytes exactos que validan contra `ComprobanteRetencion_V2.0.0.xsd`:
  - un documento con renta;
  - renta e IVA;
  - varios documentos con varias retenciones anidadas;
  - retención en cero con el código 7 explícito y el valor 0.00;
  - sustento solo con IVA, con IVA e ICE, con IRBPNR y con varias entradas tributarias;
  - `<codDocSustento>01</codDocSustento>`, `<codDocSustento>02</codDocSustento>` y `<codDocSustento>03</codDocSustento>` literales;
  - sujeto con caracteres especiales;
  - sustento con y sin autorización;
  - `pagoLocExt` 01 y sin los elementos que el sistema no escribe.

  Los golden de la factura y de las notas, sin cambios
- [x] 5.2 Crear `withholdingReceiptSigningProfile` y firmar con el firmador vigente y el tipo `07`, con el XSD antes y después de firmar. Verificar que el XML firmado valida, lleva la clave y el certificado de la empresa, y que el artefacto declara el tipo `07`. Documentar el builder, lo que no escribe y el formato de los códigos de documento sustento en `fiscal-emission.md`

## 6. Borradores, vista previa, proveedores y opciones

- [x] 6.1 Implementar el puerto `WithheldPartyReader` sobre la lectura de terceros, inyectado por `main.ts`, y la búsqueda `/withholding-receipts/suppliers` (design D3 y D21). Verificar con pruebas de integración que solo devuelve proveedores activos con identificación `04`, `05` o `06` de la empresa, sin el consumidor final, y que otra empresa no se filtra
- [x] 6.2 Implementar los borradores con su vista previa (`/withholding-receipts/drafts`) y las opciones (`/withholding-receipts/options`), con sus rutas en OpenAPI. Verificar con pruebas HTTP:
  - período propuesto con el mes de hoy;
  - vista previa con porcentajes y valores del servidor y el total retenido;
  - problemas por documento y por retención;
  - opciones con solo las entradas utilizables, los sustentos compatibles por tipo, las tarifas de IVA con porcentaje y las formas de pago de la empresa;
  - límites configurados aplicados;
  - versión del borrador;
  - `403`, `401` y otra empresa `404`

## 7. Emisión del comprobante de retención

- [ ] 7.1 Implementar la emisión (`POST /withholding-receipts`) con las comprobaciones previas y la transacción de `RESERVED` de design D15, sin I/O externo dentro: idempotencia `withholding_receipt.emit` con la huella de design D16, `reserveDocumentIn` con el tipo `07`, el snapshot, el registro y sus líneas, la auditoría `withholding_receipt.reserved`, la firma después del commit y las métricas de design D26. Verificar con pruebas HTTP:
  - retención de uno y de varios documentos firmada con su propio contador;
  - la vista previa, el snapshot, el XML y la consulta con los mismos valores;
  - cada rechazo de la evaluación sin reservar número, incluida la prueba negativa sin documentos ni retenciones, que no consume secuencial ni recibe clave;
  - un concepto cuyo porcentaje cambia en el catálogo después de reservar no cambia el XML firmado;
  - doble envío secuencial y simultáneo con una sola retención;
  - repetición que reanuda la firma, clave reutilizada `409` y sin clave `400`;
  - eventos de auditoría sin XML ni SOAP, y ninguno en los rechazos;
  - `emitted-document-types.test.ts` con la ruta nueva.

  Documentar la emisión, la idempotencia y los códigos en `fiscal-emission.md` y las métricas en `observability.md`
- [ ] 7.2 Probar la atomicidad forzando un fallo después de cada paso de la transacción. Verificar que no quedan secuencial, clave, comprobante, registro, líneas, snapshot, borrador emitido, idempotencia ni auditoría
- [ ] 7.3 Probar con PostgreSQL real la concurrencia: dos retenciones simultáneas al mismo proveedor, ambas válidas con secuenciales distintos, y dos emisiones simultáneas del mismo borrador con claves distintas, una sola retención y la otra `409`. Extender la prueba de secuenciales independientes con factura, nota de crédito, nota de débito, retención y factura en el mismo punto. Verificar que las pruebas pasan repetidas sin fallos intermitentes
- [ ] 7.4 Implementar el reintento de firma (`/withholding-receipts/{id}/signing-attempts`). Verificar que una retención reservada se firma con su mismo número y su misma clave, con `withholding_receipt.signing_retried`, y que otra empresa recibe `404`

## 8. Consulta, transmisión y reconciliación

- [ ] 8.1 Implementar la consulta (`/withholding-receipts`, `/withholding-receipts/{id}`, `/withholding-receipts/{id}/transmission`) con sus rutas en OpenAPI. Verificar con pruebas HTTP: detalle con el sujeto, `parteRel` como declarado, el período, los documentos con sus retenciones y el total retenido; búsqueda por número o proveedor, filtros de estado y período y paginación; `403`, `401` y otra empresa `404`
- [ ] 8.2 Implementar la reconciliación manual (`/withholding-receipts/{id}/reconciliations`, `withholding_receipt.reconciliation_requested`) y agregar `"07"` a `COMPLETED_AUDIT`. Verificar con pruebas HTTP: administrador que reconcilia una retención en revisión manual que pasa a autorizada; operador `403`; estado no reconciliable rechazado; eventos sin SOAP; las reconciliaciones de los demás tipos sin cambios
- [ ] 8.3 Repetir con un comprobante de retención los casos de la transmisión de design D18 con respuestas SINTÉTICAS, incluidos `NOT_SENT` comprobable y `SEND_UNKNOWN`, la respuesta guardada antes de clasificar y su reclasificación sin otra llamada al SRI. Verificar que pasan sin cambios en el transporte, la cola ni los clasificadores, con `SRI_TRANSMISSION_ENABLED` apagado, y documentar en `fiscal-emission.md` que la transmisión atiende el tipo `07`

## 9. Independencia y dirección de las dependencias

- [ ] 9.1 Probar con PostgreSQL real que una retención autorizada, devuelta y no autorizada no registra movimientos de inventario, no cambia capacidades acreditables ni devolvibles, y no modifica ninguna factura ni nota. Verificar que las reconciliaciones de capacidades y saldos no informan diferencias
- [ ] 9.2 Añadir la prueba de arquitectura de design D1 y documentar el módulo en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba pasa y detecta cada violación en archivos de ejemplo

## 10. RIDE del comprobante de retención

- [ ] 10.1 Implementar la lectura `comprobanteRetencion` 2.0.0 con su lista blanca y el modelo `RideWithholdingReceipt`, la distribución de la ficha v2.34 (anexo 2, página 63) con el renderer `retencion-1`, las denominaciones desde el snapshot y la selección por raíz y versión sin duplicar el pool (design D19). Verificar con golden propios:
  - texto de las páginas con una fila por retención y los datos de su documento;
  - el bloque adicional con los impuestos declarados de cada documento (IVA, ICE e IRBPNR);
  - varios documentos y varias retenciones;
  - paginación con el máximo de filas;
  - lectura del Code128 con la clave de la retención;
  - contenido no emitido que detiene la generación;
  - mismos bytes en dos procesos;
  - el RIDE de los demás tipos sin cambios
- [ ] 10.2 Comprobar el RIDE en el job, el pool y la bandeja. Verificar con una prueba de integración que una retención autorizada programa su RIDE en la misma operación, que se guarda una vez con su procedencia y que se descarga verificado. Documentar la lectura y la distribución en `fiscal-emission.md`

## 11. Bandeja con comprobantes de retención

- [ ] 11.1 Agregar el tipo `07` a `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` (design D20). Verificar con pruebas de componente: filtro con los cuatro tipos, tipo bajo el número, total retenido y sujeto, enlace al detalle de la retención, textos por tipo, documentos disponibles por estado, y los demás tipos sin cambios. Documentarlo en `fiscal-emission.md`

## 12. Pantallas de retenciones y catálogos

- [ ] 12.1 Implementar Retenciones en `/retenciones`, dentro de "Operación" (design D24), con lista, búsqueda, filtros de estado y período en la URL, borradores en curso y tarjetas por debajo de 768 px. Verificar con pruebas de componente: carga, vacío, error con reintento, sin permiso y filtros en la URL
- [ ] 12.2 Implementar el borrador con los pasos de design D24:
  - proveedor con selector y "Nuevo proveedor" con `PartyDialog`;
  - parte relacionada sin selección inicial;
  - período con aviso;
  - documentos con tipo, sustento filtrado, número, fecha, autorización, totales, impuestos y pagos;
  - retenciones por documento con impuesto, concepto con búsqueda o código de IVA, y base;
  - vista previa del servidor y confirmación.

  Verificar con pruebas de componente:
  - el porcentaje y el valor nunca editables, y los mismos del servidor;
  - solo conceptos y códigos utilizables;
  - problemas junto a su documento y su retención, y emisión bloqueada;
  - el aviso y la confirmación de un período distinto del mes de emisión;
  - éxito que lleva al detalle;
  - doble clic que envía una sola emisión con la misma clave en el reintento;
  - los `409` explicados y el foco tras cada acción
- [ ] 12.3 Implementar el detalle de la retención y los catálogos de retención en Catálogos fiscales (consulta con clasificación y fuente; habilitación de los soportados para el administrador). Verificar con pruebas de componente: documentos con sus retenciones, `parteRel` como declarada, reintento de firma, transmisión y documentos; catálogos con la clasificación y la razón de los fuera de alcance, sin control de habilitación en ellos. Documentar las pantallas en `fiscal-emission.md` con sus rutas y permisos
- [ ] 12.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado) y registrar la revisión en `openspec/changes/add-withholding-receipts/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 13. Rendimiento y prueba end-to-end

- [ ] 13.1 Añadir `bench:withholding-receipts` en `backend/scripts/` (design D27), con el barrido del RIDE apagado, y registrar su resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005 donde aplica, que el RIDE tarda menos de 1 s, que la transacción de la reserva no incluye XML, firma ni red, y que el CPU, la memoria y la latencia del peor caso confirman los valores por defecto de design D25 (o ajustarlos con `/opsx:update`). Registrar el tamaño del XML firmado del peor caso solo como medición, sin relacionarlo con Q-47
- [ ] 13.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado: una retención de renta e IVA sobre dos facturas de un proveedor, autorizada y con su RIDE en la bandeja; otra no autorizada; y el inventario y las facturas sin cambios. Verificar que la prueba pasa

## 14. Verificación

- [ ] 14.1 Ejecutar `corepack pnpm verify` y verificar que pasan formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact` y `check:ride-assets`
