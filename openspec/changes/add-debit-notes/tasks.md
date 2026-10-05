# Tasks

## 1. Esquema

- [ ] 1.1 Crear la migración aditiva de design D26:
  - `debit_note_draft` y `debit_note_draft_concept`, con versión, estado `DRAFT`/`EMITTED`, comprobante y la guarda que impide cambiar o borrar un borrador emitido y sus conceptos;
  - `debit_note_support`, inmutable, única por nota, con el trigger que exige una nota `05` y una factura `01` en `AUTHORIZED` de la misma empresa y del mismo ambiente;
  - el trigger de restricción diferido que impide confirmar un comprobante `05` sin su relación;
  - FK compuestas por empresa, y `debit_note.emit` en el `CHECK` de `idempotency_record`.

  Verificar con pruebas de integración del esquema:
  - relación con una factura no autorizada, de otra empresa, de otro ambiente o con un comprobante que no es una factura, rechazada;
  - relación que no cambia ni se borra;
  - comprobante `05` sin relación rechazado al confirmar, y la factura y la nota de crédito no afectadas por ese trigger;
  - borrador emitido inmutable;
  - la operación nueva admitida en el registro de idempotencia.
- [ ] 1.2 Añadir las tablas a `migrations.test.ts` y documentarlas, con el acoplamiento intencional del trigger diferido, en `database.md`. Verificar que `migrations.test.ts` pasa sin deriva entre migraciones y esquema

## 2. Contratos y permisos

- [ ] 2.1 Crear `packages/contracts/src/debit-notes.ts` (design D5, D8, D9 y D20):
  - las causas cerradas con su etiqueta y su fuente;
  - el borrador y sus conceptos (causa, descripción, importe como texto decimal, clave del tratamiento), una sola forma de pago como `entryKey` (sin etiqueta ni importe) y el punto;
  - la vista previa con los tratamientos de la factura, las bases e impuestos por tratamiento, el total, la forma de pago y los problemas por concepto;
  - el cuerpo de la emisión con `declarations { version, statements }`, y la política `DEBIT_NOTE_ELIGIBILITY_DECLARATION` versión 1 con `NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE`, su texto, su contexto y su fuente;
  - las vistas de lista y detalle, y los códigos de error.

  Las rutas se registran en `apiRoutes` junto con su router en los grupos 5 y 7. Verificar con pruebas de contratos que se rechazan:
  - una causa desconocida;
  - un importe como número, con 3 decimales, en cero o negativo;
  - una descripción vacía, de 301 caracteres o de varias líneas;
  - más conceptos que el máximo;
  - una forma de pago con etiqueta, importe o como lista de varias;
  - una declaración faltante o de otra versión;
  - un `companyId`, un número o una clave de comprobante en el cuerpo.
- [ ] 2.2 Añadir `debitNotes.read`, `debitNotes.draft`, `debitNotes.emit` y `debitNotes.retrySigning` para ADMIN y OPERATOR, y `debitNotes.reconcile` solo para ADMIN, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D21). Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz

## 3. Dominio de la nota de débito

- [ ] 3.1 Implementar `calculateDebitNoteAmounts` (design D7), versión 1, sin `number`: bases por concepto, bases por tratamiento, impuesto HALF_UP sobre la base total de cada tratamiento, subtotal, valor total y límites del XSD. Verificar con:
  - los golden tests de design D7: un concepto; varios de una tarifa; varias tarifas; decimales internos; otra partición con el mismo total; 0 %, no objeto y exento sin agrupar; tarifa histórica del 12 %; exceso de dígitos;
  - property tests con generador determinista: cada base es la suma de sus conceptos, cada impuesto es el redondeo de su base, el total es el subtotal más los impuestos, la suma de los motivos es el subtotal, ningún importe es negativo ni tiene más de 2 decimales, y cualquier repartición de los mismos totales da los mismos impuestos;
  - la prueba de que el módulo no usa `number` ni la librería decimal directamente.

  Documentar el cálculo por tratamiento en `fiscal-emission.md` y actualizar BR-66 en `domain-model.md` si su texto difiere de lo implementado. Verificar que los documentos citan `calculateDebitNoteAmounts` y su versión
- [ ] 3.2 Implementar la evaluación en el orden de design D4 (estado, integridad, ambiente, consumidor final como política del proyecto, conceptos, causas, descripciones, importes, tratamientos de la factura, forma de pago resuelta con el resolver de `catalogs` y su total igual al valor total con decimal exacto, declaración, preparación) y la vista previa pura que consume `calculateDebitNoteAmounts`. Verificar con pruebas unitarias:
  - cada rechazo con su código y la posición del concepto;
  - el mensaje de consumidor final, que cita la política del proyecto y no la NAC-DGERCGC25-00000014;
  - un tratamiento que la factura no tenía, rechazado;
  - una factura con varias tarifas que nunca se colapsa;
  - una factura de más de doce meses aceptada (design D11);
  - la descripción que no cambia la causa ni los importes;
  - forma de pago faltante, inexistente, no vigente o deshabilitada para la empresa, y un total distinto del valor total, rechazados
- [ ] 3.3 Implementar el snapshot autosuficiente de design D13 y su construcción. Verificar con pruebas unitarias que guarda la factura con su autorización, sus tratamientos con sus referencias fiscales, los conceptos, el resultado del cálculo con su versión, `payments` con un solo elemento (código, denominación oficial, `catalogType`, `versionId`, `datasetVersion`, `entryKey` y el total igual al valor total) y la declaración `USER_DECLARED` con su versión, actor y momento, y que nunca escribe `SYSTEM_VERIFIED`. Actualizar `glossary.md` con la forma de pago de la nota y el tratamiento de IVA de la factura tal como quedan en el snapshot

## 4. XML de la nota de débito

- [ ] 4.1 Crear `debit-note-xml-builder.ts` para `notaDebito` 1.0.0 desde el snapshot, sin el builder de alto nivel de la dependencia, reutilizando `xml-writer.ts` e `infoTributaria` con `codDoc` 05 (design D16). Verificar con golden fixtures de bytes exactos (un concepto, varios de una tarifa, varias tarifas con 0 %, no objeto y exento, comprador con caracteres especiales), todos con `pagos` y un solo `pago` tomado del snapshot, que validan contra `NotaDebito_V1.0.0.xsd`, con los golden de la factura y de la nota de crédito sin cambios
- [ ] 4.2 Crear `debitNoteSigningProfile` y firmar una nota con el firmador vigente y el tipo `05`, con la validación XSD antes y después de firmar. Verificar que el XML firmado valida, lleva la clave y el certificado de la empresa, y que el artefacto declara el tipo `05`. Documentar en `fiscal-emission.md` el builder, la forma de pago con su evidencia de la ficha (design D8) y lo que la nota no escribe, y verificar que cita el builder y su versión

## 5. Borradores, vista previa y facturas elegibles

- [ ] 5.1 Implementar el puerto `InvoiceSourceReader` sobre la lectura `invoiceCreditSource` que exporta `invoices`, sin cambiarla, inyectado por `main.ts` (design D3). Verificar con pruebas de integración:
  - factura autorizada leída sin consultar producto, tercero ni catálogo, con sus tratamientos y sus referencias fiscales;
  - snapshot o artefacto alterados detectados y nunca reparados;
  - factura de otra empresa, nota de crédito o nota de débito no encontradas
- [ ] 5.2 Implementar los borradores con su vista previa (`/debit-notes/drafts`) y las facturas elegibles (`/debit-notes/eligible-invoices`), con sus rutas en OpenAPI. Verificar con pruebas HTTP:
  - factura en cada estado no autorizado rechazada; consumidor final rechazado; otro ambiente informado como problema; integridad informada como problema;
  - vista previa con los tratamientos de la factura, las bases e impuestos por tratamiento, el total y los problemas por concepto;
  - la lista de elegibles sin consumidor final, sin otro ambiente y sin notas de crédito ni de débito;
  - versión del borrador; `403`, `401` y otra empresa `404`

## 6. Emisión de la nota de débito

- [ ] 6.1 Implementar la emisión (`POST /debit-notes`) con las comprobaciones previas de design D4 y la transacción de `RESERVED` de design D14, sin I/O externo dentro:
  - idempotencia `debit_note.emit` con la huella de design D15;
  - `reserveDocumentIn` con el tipo `05`;
  - el snapshot autosuficiente y la relación con la factura;
  - la auditoría `debit_note.reserved`;
  - después del commit, la firma con el perfil de la nota (`debit_note.signed`);
  - las métricas de design D24.

  Verificar con pruebas HTTP:
  - nota de un concepto y de varias tarifas firmadas con su propio contador;
  - consumidor final, causa inválida, concepto en cero, tratamiento ajeno, forma de pago no vigente o deshabilitada, declaración faltante y empresa no preparada, todos rechazados sin reservar número;
  - prueba negativa: una nota sin forma de pago no queda reservada, no consume secuencial y no recibe clave;
  - una forma de pago que cambia en el catálogo después de reservar no cambia el XML firmado;
  - doble envío secuencial y simultáneo con una sola nota, repetición después de quedar reservada que reanuda la firma, clave reutilizada con otros datos `409`, y sin clave `400`;
  - la misma clave en una factura, en una nota de crédito y en una nota de débito, independientes;
  - eventos de auditoría con la factura, las causas y la declaración, sin descripciones ni XML, y ninguno en los rechazos;
  - `emitted-document-types.test.ts` con las rutas `/credit-notes`, `/debit-notes` e `/invoices`.

  Documentar la emisión, la idempotencia y los códigos de error en `fiscal-emission.md`, y las métricas en `observability.md`. Verificar que los documentos citan las rutas, los códigos y las métricas implementados
- [ ] 6.2 Probar la atomicidad de la reserva forzando un fallo después de cada paso de la transacción. Verificar que no queda secuencial consumido, clave, comprobante, relación, snapshot, borrador emitido, registro de idempotencia ni auditoría
- [ ] 6.3 Probar con PostgreSQL real la concurrencia de design D14: dos notas simultáneas de una misma factura, ambas válidas y con secuenciales distintos; dos emisiones simultáneas del mismo borrador con claves distintas, una sola nota y la otra `409`. Verificar que las pruebas pasan repetidas sin fallos intermitentes
- [ ] 6.4 Implementar el reintento de firma (`/debit-notes/{id}/signing-attempts`). Verificar que una nota reservada se firma con su mismo número y su misma clave, con `debit_note.signing_retried`, y que otra empresa recibe `404`

## 7. Consulta, transmisión y reconciliación de la nota

- [ ] 7.1 Implementar la consulta (`/debit-notes`, `/debit-notes/{id}`, `/debit-notes/{id}/transmission`) con sus rutas en OpenAPI. Verificar con pruebas HTTP:
  - detalle con la factura, los conceptos con causa y tratamiento, los impuestos por tratamiento, la forma de pago y la declaración presentada como declarada;
  - búsqueda y paginación;
  - `403`, `401` y otra empresa `404`
- [ ] 7.2 Implementar la reconciliación manual de la nota (`/debit-notes/{id}/reconciliations`, `debitNotes.reconcile`, `debit_note.reconciliation_requested`) y agregar `"05"` a `COMPLETED_AUDIT` en `reconcile-handler.ts` (`debit_note.reconciliation_completed`). Verificar con pruebas HTTP:
  - administrador que reconcilia una nota en revisión manual que pasa a autorizada;
  - operador `403`;
  - estado no reconciliable rechazado;
  - eventos sin SOAP;
  - las pruebas de reconciliación de la factura y de la nota de crédito sin cambios
- [ ] 7.3 Repetir con una nota de débito los casos de la transmisión (design D17), con respuestas SINTÉTICAS: `RECIBIDA`, `DEVUELTA`, errores 70, 43 y 45, `SEND_UNKNOWN`, `MANUAL_REVIEW`, `AUTORIZADO` y `NO AUTORIZADO`, la respuesta guardada antes de clasificar, la reclasificación de la respuesta guardada sin otra llamada al SRI, la reconciliación manual y una respuesta sin estado que no es un rechazo. Verificar que pasan sin cambios en el transporte, la cola ni los clasificadores, y documentar en `fiscal-emission.md` que la transmisión y la reconciliación atienden el tipo `05` sin cambios

## 8. Independencia de la capacidad acreditable y del inventario

- [ ] 8.1 Probar la no interacción de design D12 con PostgreSQL real:
  - factura de 100.00 con una nota de débito autorizada de 20.00 que sigue con 100.00 acreditables y admite una anulación total de 100.00;
  - nota de débito ausente de las facturas elegibles de una nota de crédito, y un borrador de nota de crédito con su identificador `404`;
  - nota de débito autorizada, devuelta y no autorizada contra una factura con productos con inventario, sin movimientos ni cambios de saldo.

  Verificar que la reconciliación de las capacidades y de los saldos no informa diferencias
- [ ] 8.2 Añadir la prueba de arquitectura de design D1 (`fiscal`, `invoices`, `inventory` y `credit-notes` no importan `debit-notes`; `debit-notes` no importa `inventory` ni `credit-notes`) y documentar el módulo en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba pasa y detecta cada violación en archivos de ejemplo

## 9. RIDE de la nota de débito

- [ ] 9.1 Implementar la lectura `notaDebito` 1.0.0 con su lista blanca y el modelo `RideDebitNote`, la distribución de la ficha v2.34 (anexo 2, página 62) con la versión de renderer `nota-debito-1`, y la selección por raíz y versión sin duplicar el pool (design D18). Verificar con golden propios:
  - texto de las páginas: título, comprobante modificado, fecha, razones y valores, forma de pago con la denominación del snapshot (sin consultar el catálogo) y subtotales por tratamiento;
  - lectura del Code128 con la clave de la nota;
  - contenido no emitido que detiene la generación;
  - mismos bytes en dos procesos;
  - el RIDE de la factura y el de la nota de crédito sin cambios
- [ ] 9.2 Comprobar el RIDE de la nota en el job, el pool y la bandeja. Verificar con una prueba de integración que una nota autorizada programa su RIDE en la misma operación, que se guarda una vez con su procedencia y que se descarga verificado. Documentar la lectura y la distribución del RIDE de la nota en `fiscal-emission.md`, con su versión de renderer

## 10. Bandeja con notas de débito

- [ ] 10.1 Agregar el tipo `05` a `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` (design D19): filtro de tipo con los tres tipos, tipo bajo el número y enlace al detalle de la nota de débito. Verificar con pruebas de componente: filtro en la URL, enlace por tipo, textos por tipo, RIDE solo de un comprobante autorizado, XML autorizado solo si existe, XML firmado distinto, y la factura y la nota de crédito sin cambios. Documentar el tipo `05` de la bandeja en `fiscal-emission.md` (Bandeja y secciones compartidas)

## 11. Pantallas de notas de débito

- [ ] 11.1 Implementar Notas de débito en `/notas-debito`, dentro de "Operación" (design D23), con lista, búsqueda, filtros en la URL, borradores en curso y tarjetas por debajo de 768 px. Verificar con pruebas de componente: carga, vacío, error con reintento, sin permiso y filtros en la URL
- [ ] 11.2 Implementar el borrador (`/notas-debito/borradores/{id}`) con los pasos de design D23:
  - selector de factura elegible;
  - conceptos con causa, descripción, importe y tratamiento, que solo ofrece los de la factura;
  - forma de pago, punto y vista previa del servidor;
  - la confirmación con la declaración, su texto completo, su contexto, su fuente y la advertencia de que es una declaración del usuario.

  Verificar con pruebas de componente:
  - tratamientos ofrecidos iguales a los de la factura, nunca una tarifa vigente ajena;
  - problemas junto a su concepto y emisión bloqueada;
  - emisión sin declaración imposible;
  - éxito que lleva al detalle de la nota emitida;
  - doble clic que envía una sola emisión con la misma clave en el reintento;
  - los `409` explicados y el foco tras cada acción
- [ ] 11.3 Implementar el detalle de la nota y, en el detalle de la factura, la acción "Emitir nota de débito" cuando corresponde. Verificar con pruebas de componente: conceptos con causa y tratamiento, declaración mostrada como declarada por el usuario, reintento de firma, transmisión y documentos, y la acción oculta para una factura no elegible o sin permiso. Documentar las pantallas en `fiscal-emission.md` con sus rutas y permisos
- [ ] 11.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado) y registrar la revisión en `openspec/changes/add-debit-notes/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 12. Rendimiento y prueba end-to-end

- [ ] 12.1 Añadir `bench:debit-notes` en `backend/scripts/` (design D25) y registrar su resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005 donde aplica, que el RIDE de la nota tarda menos de 1 s y que la transacción de la reserva no incluye XML, firma ni red
- [ ] 12.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado: factura con dos tarifas autorizada; nota de débito de dos conceptos en tratamientos distintos autorizada, con su RIDE en la bandeja; otra nota no autorizada; y la capacidad acreditable y el inventario de la factura sin cambios. Verificar que la prueba pasa

## 13. Fuentes oficiales y trazabilidad

- [ ] 13.1 Archivar en `docs/product/sri-catalogs/fuentes/` el extracto literal de la ficha técnica v2.34 (PDF SHA-256 `7333aebf…`): la nota del IVA de la página 58, la obligatoriedad de `pagos` de las páginas 58 y 59, y la referencia a la distribución del RIDE de la página 62. Usar el método de los extractos existentes. El extracto de la página 58 es la evidencia primaria de la regla del IVA. Intentar archivar como complementario el texto oficial del aviso del SRI del cambio del 14 % al 12 %, sin blogs ni resúmenes de terceros; no hace falta para cerrar APPLY. Actualizar `capabilities.md` (estado del cambio y trazabilidad de `debit-notes`, con un solo pago como política del MVP), Q-49, BR-33 y el SOURCE STATUS de design D6 con lo que se haya archivado. Verificar que los extractos citan su URL y su SHA-256, y que el cierre de APPLY informa de forma explícita lo que no se pudo archivar

## 14. Verificación

- [ ] 14.1 Ejecutar `corepack pnpm verify` y verificar que pasan formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact` y `check:ride-assets`
