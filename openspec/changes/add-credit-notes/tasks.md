# Tasks

## 1. Emisión compartida por tipo, sin cambiar la factura

- [ ] 1.1 Extraer la reserva del comprobante a `fiscal/application/document-reservation.ts` (`reserveDocumentIn`: secuencial, bloqueo de la identidad tributaria, clave, `insertReserved` y transición a `RESERVED`, con el tipo como dato) y hacer que la emisión de la factura la use (design D2). Verificar que las pruebas de emisión, reserva, idempotencia y AC-04 pasan sin cambios y que el snapshot y la clave de una factura son los mismos para los mismos datos
- [ ] 1.2 Mover el pipeline de firma a `fiscal/application/signing-pipeline.ts`, parametrizado por un perfil por tipo (tipo, builder, versión del builder, acciones de auditoría), con el esquema desde el snapshot, el tipo del comprobante en el firmador y en los metadatos del artefacto, y el encolado de la transmisión; registrar el perfil de la factura en `main.ts` y en los arneses (design D2). Verificar que las pruebas de firma, reintento, recuperación, artefacto y golden del XML de la factura pasan sin cambios, y que una factura firmada produce los mismos bytes
- [ ] 1.3 Elegir por tipo la acción de auditoría de la reconciliación manual en `reconcile-handler.ts` (`invoice.*` o `credit_note.*`) y generalizar la solicitud para que cada módulo exponga su ruta y su permiso (design D2, D13). Verificar que las pruebas de reconciliación de la factura pasan sin cambios
- [ ] 1.4 Documentar en `fiscal-emission.md` y `backend.md` la reserva y la firma compartidas por tipo y lo que queda por tipo. Verificar que los documentos citan los módulos y funciones implementados

## 2. Esquema

- [ ] 2.1 Crear la migración aditiva de design D7, D10 y D22:
  - borradores de nota y sus líneas, con versión, estado `DRAFT`/`EMITTED` y comprobante;
  - `credit_capacity`, `credit_capacity_line`, `credit_reservation` y `credit_reservation_line`, con `CHECK` de capacidad, original inmutable y reservas `RESERVED` → `APPLIED`/`RELEASED` por trigger;
  - `stock_return_capacity` y `stock_return_reservation`, con las mismas guardas;
  - FK compuestas por empresa y `credit_note.emit` en el `CHECK` de `idempotency_record`.

  Verificar con pruebas de integración del esquema: exceso de capacidad rechazado por el `CHECK`, una reserva no vuelve de `APPLIED` o `RELEASED`, el original no cambia, reservas y capacidad de otra empresa rechazadas, y la operación nueva admitida en el registro de idempotencia
- [ ] 2.2 Añadir las tablas a `migrations.test.ts` y documentarlas en `database.md`. Verificar que `migrations.test.ts` pasa sin deriva entre migraciones y esquema

## 3. Contratos y permisos

- [ ] 3.1 Crear `packages/contracts/src/credit-notes.ts` (design D5, D9, D16): causas cerradas, borrador y sus líneas (cantidad acreditada y retorno físico), vista previa con importes, remanentes y problemas por línea, cuerpo de la emisión con `declarations { version, statements }`, la política `CREDIT_NOTE_ELIGIBILITY_DECLARATION` versión 1 con sus dos afirmaciones y su fuente, vistas de lista, detalle y crédito de una factura, y los códigos de error; las rutas se registran en `apiRoutes` junto con su router en los grupos 8 y 10. Verificar con pruebas de contratos: causa desconocida, cantidad como número o con 7 decimales, retorno mayor que lo acreditado, motivo vacío o de varias líneas, declaración faltante o de otra versión y `companyId` en el cuerpo rechazados
- [ ] 3.2 Añadir `creditNotes.read`, `creditNotes.draft`, `creditNotes.emit` y `creditNotes.retrySigning` para ADMIN y OPERATOR, y `creditNotes.reconcile` solo para ADMIN, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D17). Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz

## 4. XML de la nota de crédito

- [ ] 4.1 Extraer `infoTributaria` del builder de la factura con `codDoc` como dato y crear `credit-note-xml-builder.ts` para `notaCredito` 1.1.0 (design D12). Verificar con golden fixtures de bytes exactos (devolución parcial, varias líneas y tarifas, anulación total, comprador con caracteres especiales) que validan contra `NotaCredito_V1.1.0.xsd`, con el golden de la factura sin cambios
- [ ] 4.2 Firmar una nota de crédito con el firmador vigente y el tipo `04`. Verificar que el XML firmado valida contra el XSD, lleva la clave y el certificado de la empresa, y que el artefacto declara el tipo `04`

## 5. Dominio de la nota

- [ ] 5.1 Implementar el cálculo exacto de design D6 en `credit-notes/domain/` (objetivos acumulados, importes de la nota, remanente, totales y valor de la modificación, sin `number`). Verificar con los golden tests de design D6: línea completa, parcial, varias líneas, notas sucesivas, último remanente, remanente después de liberar una nota, impuestos, descuentos originales, cantidades de 6 decimales, acumulación que excede la línea e importe negativo rechazado
- [ ] 5.2 Implementar las reglas de elegibilidad y de líneas en el orden de design D4 (estado, integridad, consumidor final, causa, motivo, líneas, retorno físico por línea, declaraciones) y la vista previa pura. Verificar con pruebas unitarias de cada rechazo y de que la anulación total copia la factura y no admite líneas ni cantidades

## 6. Factura de origen y capacidad acreditable

- [ ] 6.1 Exportar desde `invoices` la lectura `invoiceCreditSource` con los datos inmutables de design D3 y la comprobación de integridad de sus artefactos con el almacén de `fiscal`. Verificar con pruebas de integración: factura autorizada leída sin consultar producto, tercero ni catálogo; artefacto alterado detectado; factura de otra empresa no encontrada
- [ ] 6.2 Implementar el repositorio de la capacidad acreditable (design D7, D8): inicialización perezosa idempotente desde el snapshot, bloqueo de la factura, reserva con incrementos atómicos, lectura de lo acreditado vigente por línea y la reconciliación diagnóstica. Verificar con pruebas de integración: inicialización repetida sin duplicados, exceso de cantidad o de importe rechazado por la base, anulación total con crédito previo rechazada, y la reconciliación sin diferencias tras una secuencia mixta

## 7. Capacidad devolvible

- [ ] 7.1 Implementar en `inventory` el puerto `ReturnCapacity` y su repositorio (design D10): bloqueo por producto en orden estable, inicialización desde la `SALIDA_FACTURA` de la factura, capacidad cero sin salida, y reserva con `CHECK`; componerlo en `main.ts` para `credit-notes`. Verificar con pruebas de integración: retorno dentro de la salida, exceso rechazado, factura sin salida del producto rechazada e inicialización repetida sin duplicados; y que `inventory` no importa `credit-notes`

## 8. Borradores, vista previa y emisión

- [ ] 8.1 Implementar los borradores con su vista previa (`/credit-notes/drafts`) y las facturas elegibles (`/credit-notes/eligible-invoices`), con sus rutas en OpenAPI. Verificar con pruebas HTTP: factura en cada estado no autorizado rechazada, consumidor final rechazado, anulación total sin líneas, vista previa con remanentes y problemas por línea, recálculo tras otra nota reservada, `403`, `401` y otra empresa `404`
- [ ] 8.2 Implementar la emisión (`POST /credit-notes`): idempotencia `credit_note.emit`, comprobaciones de design D4, capacidades acreditable y devolvible bajo bloqueo, `reserveDocumentIn` con el tipo `04`, snapshot con la factura, la causa, las líneas ligadas, el retorno físico y las declaraciones, auditoría `credit_note.reserved`, y firma con el perfil de la nota (`credit_note.signed`); métricas de design D20. Verificar con pruebas HTTP:
  - devolución parcial y total, y anulación total firmadas con su propio contador;
  - declaración faltante, cantidad o importe excedidos, retorno físico no permitido o excedido, todos rechazados sin reservar número;
  - doble envío secuencial y simultáneo con una sola nota y una sola reserva, y clave reutilizada `409`;
  - la misma clave en una factura y en una nota, independientes;
  - eventos de auditoría con la causa y las declaraciones, y ninguno en los rechazos
- [ ] 8.3 Implementar el reintento de firma (`/credit-notes/{id}/signing-attempts`). Verificar que una nota reservada se firma con su mismo número y su misma clave, con `credit_note.signing_retried`, y que su capacidad sigue reservada
- [ ] 8.4 Probar con PostgreSQL real la concurrencia de la reserva (design D8): dos devoluciones de la misma línea, anulación total contra devolución, dos anulaciones totales, devolución con remanente exacto y dos retornos físicos del mismo producto. Verificar que nunca se excede ninguna capacidad, que la reconciliación de las capacidades no informa diferencias y que las pruebas pasan repetidas sin fallos intermitentes

## 9. Ciclo de vida de la capacidad y devolución de stock

- [ ] 9.1 Implementar el seguidor de la capacidad acreditable (aplicar en `AUTHORIZED`, liberar en `RETURNED` y `NOT_AUTHORIZED`, nada en otro estado) y el del inventario (`DEVOLUCION_NC` agregada por producto con bloqueos en orden y reserva aplicada en `AUTHORIZED`, liberación en `RETURNED` y `NOT_AUTHORIZED`), compuestos en ese orden en `main.ts` (design D7, D10). Verificar con pruebas de integración:
  - nota autorizada: crédito aplicado y una devolución por producto con la suma exacta, que referencia la nota y cruza un saldo negativo;
  - nota devuelta y nota no autorizada: capacidades liberadas y sin devolución;
  - verificando con el SRI y revisión manual: capacidades reservadas;
  - repetición de cada decisión sin aplicar ni liberar dos veces;
  - control del producto desactivado después de facturar: la devolución se registra
- [ ] 9.2 Probar la recuperación y la concurrencia del ciclo con PostgreSQL real: fallo después de la autorización externa y antes del commit local sin devolución ni crédito aplicado, y reintento que reclasifica la respuesta guardada sin otra llamada al SRI con una sola devolución; nota autorizada contra una entrada manual del mismo producto. Verificar que cada saldo es la suma de su kárdex y las capacidades coinciden con sus reservas
- [ ] 9.3 Añadir la prueba de arquitectura de design D1 (`fiscal`, `invoices` e `inventory` no importan `credit-notes`) y documentar los seguidores, los puertos y las capacidades en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba pasa y detecta cada violación en archivos de ejemplo

## 10. Consulta, transmisión y reconciliación de la nota

- [ ] 10.1 Implementar la consulta (`/credit-notes`, `/credit-notes/{id}`, `/credit-notes/{id}/transmission`) y el crédito de una factura (`/credit-notes/invoices/{invoiceId}/credit`), con sus rutas en OpenAPI. Verificar con pruebas HTTP: detalle con factura, causa, líneas, retorno físico y declaraciones presentadas como declaradas; crédito aplicado, reservado y disponible; búsqueda y paginación; `403`, `401` y otra empresa `404`
- [ ] 10.2 Implementar la reconciliación manual de la nota (`/credit-notes/{id}/reconciliations`, `creditNotes.reconcile`) con sus eventos de auditoría. Verificar con pruebas HTTP: administrador que reconcilia una nota en revisión manual que pasa a autorizada con su crédito aplicado, operador `403`, estado no reconciliable rechazado y eventos sin SOAP
- [ ] 10.3 Repetir con una nota de crédito las pruebas de la transmisión (design D13): recepción, autorización, errores 70, 43 y 45, resultado incierto, revisión manual y evidencia guardada antes de clasificar, con respuestas SINTÉTICAS. Verificar que pasan sin cambios en el transporte, la cola ni los clasificadores

## 11. RIDE de la nota de crédito

- [ ] 11.1 Implementar la lectura `notaCredito` 1.1.0 con su lista blanca y el modelo `RideCreditNote`, la distribución de la ficha v2.34 (anexo 2, página 61) con su versión de renderer, la selección por raíz y versión en el renderer, y las formas de pago opcionales en el handler (design D14). Verificar con pruebas: texto de las páginas (título, comprobante modificado, fecha, razón, detalle y subtotales, sin formas de pago), lectura del Code128, contenido no emitido que detiene la generación, mismos bytes en dos procesos, y el RIDE de la factura sin cambios
- [ ] 11.2 Comprobar el RIDE de la nota en el job, el pool y la bandeja. Verificar con una prueba de integración que una nota autorizada programa su RIDE en la misma operación, que se guarda una vez con su procedencia y que se descarga verificado

## 12. Bandeja con notas de crédito

- [ ] 12.1 Mostrar las notas en Comprobantes (design D15): tipos disponibles `01` y `04`, filtro de tipo conectado a la API, tipo bajo el número y enlace al detalle de la nota; `DocumentsSection` y `TransmissionSection` reciben el comprobante y su tipo. Verificar con pruebas de componente: filtro de tipo en la URL, enlace por tipo, textos por tipo, y la factura sin cambios

## 13. Pantallas de notas de crédito

- [ ] 13.1 Implementar Notas de crédito en `/notas-credito`, dentro de "Operación" (design D19), con lista, búsqueda, filtros en la URL y tarjetas por debajo de 768 px. Verificar con pruebas de componente: carga, vacío, error con reintento, sin permiso y filtros en la URL
- [ ] 13.2 Implementar el borrador (`/notas-credito/borradores/{id}`): selector de factura elegible, causa, líneas y cantidades en una devolución, retorno físico permitido o deshabilitado con su explicación, motivo, punto, vista previa del servidor y la confirmación con las dos declaraciones separadas. Verificar con pruebas de componente:
  - anulación total sin selección de líneas;
  - problemas junto a su línea y emisión bloqueada;
  - emisión sin ambas declaraciones imposible;
  - doble clic que envía una sola emisión con la misma clave en el reintento;
  - los `409` explicados y el foco tras cada acción
- [ ] 13.3 Implementar el detalle de la nota y, en el detalle de la factura, el crédito aplicado, reservado y disponible con la acción "Emitir nota de crédito" cuando corresponde. Verificar con pruebas de componente: declaraciones mostradas como declaradas por el usuario, reintento de firma, transmisión y documentos, y la acción oculta para una factura no elegible o sin permiso
- [ ] 13.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado) y registrar la revisión en `openspec/changes/add-credit-notes/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 14. Rendimiento, prueba end-to-end y documentación de producto

- [ ] 14.1 Añadir `bench:credit-notes` en `backend/scripts/` (design D21) y registrar su resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005 donde aplica, el RIDE de la nota menos de 1 s, y que termina con la reconciliación de las capacidades sin diferencias
- [ ] 14.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado: factura con dos productos autorizada; devolución parcial con retorno físico autorizada (crédito aplicado, `DEVOLUCION_NC`, RIDE en la bandeja); otra nota no autorizada que libera su capacidad; y anulación total rechazada por el crédito previo. Verificar que la prueba pasa
- [ ] 14.3 Documentar las métricas y la alerta en `observability.md`, y actualizar `domain-model.md`, `glossary.md` y `capabilities.md` con lo implementado. Verificar que los documentos citan las rutas, los permisos, los códigos de error y las métricas implementados

## 15. Verificación

- [ ] 15.1 Ejecutar `corepack pnpm verify` y verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact` y `check:ride-assets` pasan
