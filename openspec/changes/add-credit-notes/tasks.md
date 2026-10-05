# Tasks

## 1. Emisión compartida por tipo, sin cambiar la factura

- [x] 1.1 Fijar el contrato de regresión de la factura antes del refactor (design D2): con las pruebas existentes y fixtures deterministas, la reserva, la clave, el snapshot, el XML byte a byte, la validación XSD, la firma, el hash del artefacto para entradas deterministas, las transiciones, los errores y la idempotencia. Verificar que el contrato pasa sobre el código actual
- [x] 1.2 Extraer la reserva del comprobante a `fiscal/application/document-reservation.ts` (`reserveDocumentIn`: secuencial, bloqueo de la identidad tributaria, clave, `insertReserved` y transición a `RESERVED`, con el tipo como dato) y hacer que la emisión de la factura la use (design D2). Verificar que el contrato de regresión, las pruebas de emisión, reserva e idempotencia y AC-04 pasan sin cambios
- [x] 1.3 Mover el pipeline de firma a `fiscal/application/signing-pipeline.ts`, con orquestación compartida e interfaces pequeñas por tipo (builder del XML, metadata de la firma y acciones de auditoría), sin un conmutador por `codDoc`; el esquema sale del snapshot y el tipo del comprobante, para el firmador y los metadatos del artefacto; registrar el perfil de la factura en `main.ts` y en los arneses (design D2). Verificar que el contrato de regresión y las pruebas de firma, reintento, recuperación y transmisión pasan sin cambios
- [x] 1.4 Elegir por tipo la acción de auditoría de la reconciliación manual en `reconcile-handler.ts` (`invoice.*` o `credit_note.*`) y dejar la solicitud genérica para que cada módulo exponga su ruta y su permiso (design D2, D13). Verificar que las pruebas de reconciliación de la factura pasan sin cambios
- [x] 1.5 Documentar en `fiscal-emission.md` y `backend.md` la reserva y la firma compartidas por tipo y lo que queda por tipo. Verificar que los documentos citan los módulos y funciones implementados

## 2. Esquema

- [x] 2.1 Crear la migración aditiva de design D7, D10, D22 y D25:
  - borradores de nota y sus líneas, con versión, estado `DRAFT`/`EMITTED` y comprobante;
  - `credit_capacity`, `credit_capacity_line`, `credit_reservation` y `credit_reservation_line`, con `CHECK` de capacidad, original inmutable, reservas de solo agregado que solo pasan de `RESERVED` a `APPLIED` o `RELEASED`;
  - `stock_return_capacity` y `stock_return_reservation`, con las mismas guardas;
  - los triggers de restricción diferidos de design D25 (reserva `APPLIED` con nota autorizada, `RELEASED` con nota devuelta o no autorizada, nota terminal sin reservas `RESERVED`);
  - FK compuestas por empresa y `credit_note.emit` en el `CHECK` de `idempotency_record`.

  Verificar con pruebas de integración del esquema: exceso de capacidad rechazado por el `CHECK`, una reserva no vuelve de `APPLIED` o `RELEASED` ni se borra, el original no cambia, cada trigger diferido rechaza su estado incoherente al confirmar, reservas y capacidad de otra empresa rechazadas, y la operación nueva admitida en el registro de idempotencia
- [x] 2.2 Añadir las tablas a `migrations.test.ts` y documentarlas, con el acoplamiento intencional de los triggers diferidos, en `database.md`. Verificar que `migrations.test.ts` pasa sin deriva entre migraciones y esquema

## 3. Contratos y permisos

- [x] 3.1 Crear `packages/contracts/src/credit-notes.ts` (design D5, D9, D16): causas cerradas, borrador y sus líneas (cantidad acreditada y retorno físico), vista previa con importes, remanentes y problemas por línea, cuerpo de la emisión con `declarations { version, statements }`, la política `CREDIT_NOTE_ELIGIBILITY_DECLARATION` versión 1 con sus dos afirmaciones de identificador estable, su texto con contexto y su fuente, vistas de lista, detalle y crédito de una factura, y los códigos de error; las rutas se registran en `apiRoutes` junto con su router en los grupos 8 y 10. Verificar con pruebas de contratos: causa desconocida, cantidad como número o con 7 decimales, retorno mayor que lo acreditado, motivo vacío o de varias líneas, declaración faltante o de otra versión y `companyId` en el cuerpo rechazados
- [x] 3.2 Añadir `creditNotes.read`, `creditNotes.draft`, `creditNotes.emit` y `creditNotes.retrySigning` para ADMIN y OPERATOR, y `creditNotes.reconcile` solo para ADMIN, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D17). Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz

## 4. XML de la nota de crédito

- [x] 4.1 Extraer `infoTributaria` del builder de la factura con `codDoc` como dato y crear `credit-note-xml-builder.ts` para `notaCredito` 1.1.0, que mapea solo desde el snapshot de la nota, sin el builder de alto nivel de la dependencia (design D12). Verificar con golden fixtures de bytes exactos (devolución parcial, varias líneas y tarifas, anulación total, comprador con caracteres especiales) que validan contra `NotaCredito_V1.1.0.xsd`, con el golden de la factura sin cambios
- [x] 4.2 Firmar una nota de crédito con el firmador vigente y el tipo `04`, con la validación XSD antes y después de firmar. Verificar que el XML firmado valida contra el XSD, lleva la clave y el certificado de la empresa, y que el artefacto declara el tipo `04`

## 5. Dominio de la nota

- [x] 5.1 Implementar `calculateCreditNoteAmounts`, la primitiva única y versionada de design D6 (objetivos acumulados, importes de la nota, remanente, totales, valor de la modificación y capacidad resultante, sin `number`). Verificar con:
  - los golden tests de design D6: línea completa, parcial, varias líneas, notas sucesivas, último remanente, remanente después de liberar una nota, IVA, descuentos originales, cantidades de 6 decimales, acumulación que excede la línea e importe negativo rechazado;
  - property tests con generador determinista sobre particiones de la cantidad y secuencias de notas con liberaciones: al acreditar la totalidad, cada componente materializado suma exactamente el original, y ningún importe es negativo
- [x] 5.2 Implementar las reglas de elegibilidad y de líneas en el orden de design D4 (estado, integridad, consumidor final, causa, motivo, líneas, retorno físico por línea con su independencia de la capacidad acreditable, declaraciones) y la vista previa pura que consume `calculateCreditNoteAmounts`. Verificar con pruebas unitarias de cada rechazo, de que la anulación total copia la factura, no admite líneas ni cantidades y acepta un retorno físico de 0 a la cantidad original solo en bienes elegibles, y de que procede solo sin crédito reservado ni aplicado

## 6. Factura de origen y capacidad acreditable

- [x] 6.1 Exportar desde `invoices` la lectura `invoiceCreditSource` con los datos inmutables de design D3 y la comprobación de integridad del snapshot y de sus artefactos con el almacén de `fiscal`, usada al preparar el borrador y antes de emitir. Verificar con pruebas de integración: factura autorizada leída sin consultar producto, tercero ni catálogo; snapshot o artefacto alterados detectados y nunca reparados; factura de otra empresa no encontrada
- [x] 6.2 Implementar el repositorio de la capacidad acreditable (design D7, D8): inicialización perezosa idempotente desde el snapshot, bloqueo de la factura, reserva con incrementos atómicos, lectura de lo acreditado vigente por línea y la reconciliación diagnóstica. Verificar con pruebas de integración: inicialización repetida sin duplicados, exceso de cantidad o de importe rechazado por la base, anulación total con crédito previo rechazada, y la reconciliación sin diferencias tras una secuencia mixta

## 7. Capacidad devolvible

- [x] 7.1 Implementar en `inventory` el puerto `ReturnCapacity` y su repositorio (design D10): bloqueo por producto en orden estable, inicialización desde la `SALIDA_FACTURA` de la factura, capacidad cero sin salida, y reserva con `CHECK`, independiente de la capacidad acreditable; componerlo en `main.ts` para `credit-notes`. Verificar con pruebas de integración: retorno dentro de la salida, exceso rechazado, factura sin salida del producto rechazada, inicialización repetida sin duplicados y el ejemplo de design D7 (5 acreditadas, 2 devueltas: 5 acreditables y 8 devolvibles); y que `inventory` no importa `credit-notes`

## 8. Borradores, vista previa y emisión

- [x] 8.1 Implementar los borradores con su vista previa (`/credit-notes/drafts`) y las facturas elegibles (`/credit-notes/eligible-invoices`), con sus rutas en OpenAPI. Verificar con pruebas HTTP: factura en cada estado no autorizado rechazada, consumidor final rechazado, integridad informada como problema, anulación total sin líneas, vista previa con remanentes y problemas por línea, recálculo tras otra nota reservada, `403`, `401` y otra empresa `404`
- [x] 8.2 Implementar la emisión (`POST /credit-notes`) con las comprobaciones previas y la transacción de `RESERVED` en el orden de design D4, sin I/O externo dentro del bloqueo: idempotencia `credit_note.emit` con la huella de design D11, capacidades acreditable y devolvible, `reserveDocumentIn` con el tipo `04`, snapshot autosuficiente de design D24, auditoría `credit_note.reserved`, y después del commit la firma con el perfil de la nota (`credit_note.signed`); métricas de design D20. Verificar con pruebas HTTP:
  - devolución parcial y total, y anulación total firmadas con su propio contador;
  - declaración faltante, cantidad o importe excedidos, retorno físico no permitido o excedido, todos rechazados sin reservar número;
  - doble envío secuencial y simultáneo con una sola nota y una sola reserva, repetición después de quedar reservada que reanuda la firma, y clave reutilizada `409`;
  - la misma clave en una factura y en una nota, independientes;
  - eventos de auditoría con la causa, la factura y las declaraciones, y ninguno en los rechazos
- [x] 8.3 Probar la atomicidad de la reserva forzando un fallo después de cada paso de la transacción. Verificar que no queda capacidad reservada, secuencial consumido, clave, comprobante parcial ni snapshot de declaraciones
- [x] 8.4 Implementar el reintento de firma (`/credit-notes/{id}/signing-attempts`). Verificar que una nota reservada se firma con su mismo número y su misma clave, con `credit_note.signing_retried`, y que su capacidad sigue reservada
- [x] 8.5 Probar con PostgreSQL real la concurrencia de la reserva (design D8): escenarios A, B, C, D y G, dos anulaciones totales y devolución con remanente exacto. Verificar que nunca se excede ninguna capacidad, que la reconciliación de las capacidades no informa diferencias y que las pruebas pasan repetidas sin fallos intermitentes

## 9. Ciclo de vida de la capacidad y devolución de stock

- [x] 9.1 Implementar el seguidor de la capacidad acreditable (aplicar en `AUTHORIZED`, liberar en `RETURNED` y `NOT_AUTHORIZED`, nada en otro estado ni por problemas operacionales) y el del inventario (`DEVOLUCION_NC` agregada por producto con bloqueos en orden y reserva aplicada en `AUTHORIZED`, liberación en `RETURNED` y `NOT_AUTHORIZED`), compuestos en ese orden en `main.ts`, con la coherencia atómica de design D25 (design D7, D10). Verificar con pruebas de integración:
  - nota autorizada: en la misma transacción, crédito aplicado, retorno físico aplicado y una devolución por producto con la suma exacta, que referencia la nota y cruza un saldo negativo;
  - nota devuelta y nota no autorizada: capacidades liberadas en la transición, sin devolución, y filas de reserva conservadas;
  - verificando con el SRI, revisión manual, job detenido, error de transporte o del parser y reintentos agotados: capacidades reservadas;
  - repetición de cada decisión sin aplicar ni liberar dos veces;
  - control del producto desactivado después de facturar: la devolución se registra
- [x] 9.2 Probar la recuperación y la concurrencia del ciclo con PostgreSQL real: escenarios E y F de design D8; fallo después de la autorización externa y antes del commit local sin devolución ni crédito aplicado, y reintento que reclasifica la respuesta guardada sin otra llamada al SRI con una sola devolución; nota autorizada contra una entrada manual del mismo producto. Verificar que cada saldo es la suma de su kárdex y las capacidades coinciden con sus reservas
- [x] 9.3 Añadir la prueba de arquitectura de design D1 (`fiscal`, `invoices` e `inventory` no importan `credit-notes`) y documentar los seguidores, los puertos, las capacidades y su ciclo de vida fallando cerrado en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba pasa y detecta cada violación en archivos de ejemplo

## 10. Consulta, transmisión y reconciliación de la nota

- [ ] 10.1 Implementar la consulta (`/credit-notes`, `/credit-notes/{id}`, `/credit-notes/{id}/transmission`) y el crédito de una factura (`/credit-notes/invoices/{invoiceId}/credit`), con sus rutas en OpenAPI. Verificar con pruebas HTTP: detalle con factura, causa, líneas, retorno físico y declaraciones presentadas como declaradas; crédito aplicado, reservado y disponible; búsqueda y paginación; `403`, `401` y otra empresa `404`
- [ ] 10.2 Implementar la reconciliación manual de la nota (`/credit-notes/{id}/reconciliations`, `creditNotes.reconcile`) con sus eventos de auditoría. Verificar con pruebas HTTP: administrador que reconcilia una nota en revisión manual que pasa a autorizada con su crédito aplicado, operador `403`, estado no reconciliable rechazado y eventos sin SOAP
- [ ] 10.3 Repetir con una nota de crédito los casos de la transmisión (design D13), con respuestas SINTÉTICAS: recibida, devuelta, error 70, errores 43 y 45, tiempo agotado o resultado incierto, autorizada, no autorizada, revisión manual, reclasificación de la respuesta guardada y reconciliación manual. Verificar que pasan sin cambios en el transporte, la cola ni los clasificadores, y que una nota incierta conserva su capacidad

## 11. RIDE de la nota de crédito

- [ ] 11.1 Implementar la lectura `notaCredito` 1.1.0 con su lista blanca y el modelo `RideCreditNote`, la distribución de la ficha v2.34 (anexo 2, página 61) con su versión de renderer, la selección por raíz y versión en el renderer sin duplicar el pool, y las formas de pago opcionales en el handler (design D14). Verificar con golden propios: texto de las páginas (título, comprobante modificado, fecha, razón, detalle y subtotales, sin formas de pago), lectura del Code128 con la clave de la nota, contenido no emitido que detiene la generación, mismos bytes en dos procesos, y el RIDE de la factura sin cambios
- [ ] 11.2 Comprobar el RIDE de la nota en el job, el pool y la bandeja. Verificar con una prueba de integración que una nota autorizada programa su RIDE en la misma operación, que se guarda una vez con su procedencia y que se descarga verificado

## 12. Bandeja con notas de crédito

- [ ] 12.1 Mostrar las notas en Comprobantes (design D15): tipos disponibles `01` y `04`, filtro de tipo visible y conectado a la API, tipo bajo el número y enlace al detalle según el tipo; `DocumentsSection` y `TransmissionSection` reciben el comprobante y su tipo. Verificar con pruebas de componente: filtro de tipo en la URL, enlace por tipo, textos por tipo, RIDE solo de un comprobante autorizado, XML autorizado solo si existe, XML firmado distinto, y la factura sin cambios

## 13. Pantallas de notas de crédito

- [ ] 13.1 Implementar Notas de crédito en `/notas-credito`, dentro de "Operación" (design D19), con lista, búsqueda, filtros en la URL y tarjetas por debajo de 768 px. Verificar con pruebas de componente: carga, vacío, error con reintento, sin permiso y filtros en la URL
- [ ] 13.2 Implementar el borrador (`/notas-credito/borradores/{id}`): selector de factura elegible, causa, líneas y cantidades en una devolución, retorno físico permitido o deshabilitado con su explicación (también en la anulación total), motivo, punto, vista previa del servidor y la confirmación con las dos declaraciones separadas, cada una con su texto completo y su contexto y la advertencia de que es una declaración del usuario, no una comprobación del sistema. Verificar con pruebas de componente:
  - anulación total sin selección de líneas, con retorno físico solo en bienes elegibles;
  - problemas junto a su línea y emisión bloqueada;
  - emisión sin ambas declaraciones imposible;
  - doble clic que envía una sola emisión con la misma clave en el reintento;
  - los `409` explicados y el foco tras cada acción
- [ ] 13.3 Implementar el detalle de la nota y, en el detalle de la factura, el crédito aplicado, reservado y disponible con la acción "Emitir nota de crédito" cuando corresponde. Verificar con pruebas de componente: declaraciones mostradas como declaradas por el usuario, reintento de firma, transmisión y documentos, y la acción oculta para una factura no elegible o sin permiso
- [ ] 13.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado) y registrar la revisión en `openspec/changes/add-credit-notes/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 14. Rendimiento, prueba end-to-end y documentación de producto

- [ ] 14.1 Añadir `bench:credit-notes` en `backend/scripts/` (design D21), con la contención (reservas por segundo y espera por bloqueos cuando es material), y registrar su resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005 donde aplica, el RIDE de la nota menos de 1 s, y que termina con la reconciliación de las capacidades sin diferencias
- [ ] 14.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado: factura con dos productos autorizada; devolución parcial con retorno físico autorizada (crédito aplicado, `DEVOLUCION_NC`, RIDE en la bandeja); otra nota no autorizada que libera su capacidad; y anulación total rechazada por el crédito previo. Verificar que la prueba pasa
- [ ] 14.3 Documentar las métricas y la alerta en `observability.md`, y actualizar `domain-model.md`, `glossary.md` y `capabilities.md` con lo implementado. Verificar que los documentos citan las rutas, los permisos, los códigos de error y las métricas implementados

## 15. Verificación

- [ ] 15.1 Ejecutar `corepack pnpm verify` y verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact` y `check:ride-assets` pasan
