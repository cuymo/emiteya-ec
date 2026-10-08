# Tasks

## 1. Firmador y primitivas de importes compartidas

- [x] 1.1 Primera tarea técnica (design D16, ADR 0018): añadir la prueba de contrato del import privado de `ec-sri-invoice-signer@1.8.2` para el tipo 03 (`LIQUIDACION_COMPRA`): firmar con el P12 de fixtures un XML sintético `liquidacionCompra` 1.1.0, verificar la firma XAdES con el verificador del pipeline y validar el XML firmado contra el XSD. Verificar que pasa; si el mapeo no funciona con el pipeline, detener el apply y reportarlo como bloqueo
- [x] 1.2 Mover las primitivas de importes de `invoices/domain/amounts.ts` (`materializeMoney`, `lineSubtotal`, `lineDiscount`, `taxableBase`, `taxAmount`, `lineAmounts` y los totales) a `fiscal/domain/document-amounts.ts`, con `invoices` importándolas con los mismos nombres y `InvoiceAmountError` como alias del error compartido (design D8). Verificar que las pruebas de importes, el contrato de regresión y los golden de la factura pasan sin cambios; si no, revertir la extracción y anotar en el design que la liquidación usa un cálculo propio. Documentar el módulo neutral en `decimal-policy.md` y `backend.md`

## 2. Esquema de la liquidación

- [x] 2.1 Crear la migración aditiva `add_purchase_settlements` (design D25): `purchase_settlement_draft`, `purchase_settlement` y `purchase_settlement_declaration` con sus FK compuestas por empresa, `CHECK`, triggers de inmutabilidad y de origen, el trigger de restricción diferido que exige el registro y exactamente las cuatro declaraciones de la política para un comprobante `03`, y `purchase_settlement.emit` en el `CHECK` de `idempotency_record`. Verificar con pruebas de base de datos cada restricción, la inmutabilidad, el diferido (sin registro, con tres declaraciones, con una repetida) y que los comprobantes existentes no cambian
- [x] 2.2 Añadir las tablas a `migrations.test.ts` y documentarlas en `database.md`, con el acoplamiento intencional del trigger diferido

## 3. Contratos, permisos y límites

- [x] 3.1 Crear `packages/contracts/src/purchase-settlements.ts` (design D3, D6, D9, D21, D22): la política de procedencia con sus cuatro declaraciones, el borrador estricto (proveedor, dirección, líneas con producto opcional o libres, pagos con plazo y unidad de tiempo), la emisión con `declarations`, las vistas, los códigos de error y los máximos absolutos. Verificar con pruebas de contrato los campos no permitidos (total, impuesto distinto del IVA, reembolso, subsidio, detalles adicionales, `companyId`, declaración desconocida), las longitudes medidas ya recortadas, los decimales y los máximos
- [x] 3.2 Añadir `purchaseSettlements.read`, `.draft`, `.emit` y `.retrySigning` para administrador y operador, y `.reconcile` solo para el administrador, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D23). Verificar con pruebas de la política
- [x] 3.3 Añadir `PURCHASE_SETTLEMENT_MAX_LINES` y `PURCHASE_SETTLEMENT_MAX_PAYMENTS` al esquema de entorno con sus valores por defecto y rangos, y documentarlas en `deployment.md` como defensa de recursos (design D22). Verificar con pruebas del entorno

## 4. Dominio de la liquidación

- [ ] 4.1 Implementar la evaluación pura en el orden de design D12: proveedor (activo, `SUPPLIER`, 05 o 06, sin consumidor final), dirección, límites, líneas (producto activo opcional, textos, cantidades, precios y descuentos), IVA vigente en la fecha de emisión y pagos (forma de pago del catálogo, plazo, unidad de tiempo y suma exacta). Verificar con pruebas unitarias cada regla y la posición de la línea o del pago en cada problema; y que BR-88 a BR-95 de `domain-model.md` y la trazabilidad de `capabilities.md` describen lo implementado (corregirlos si no)
- [ ] 4.2 Implementar `calculatePurchaseSettlementAmounts` (versión `purchase-settlement-amounts-1`) sobre las primitivas compartidas (design D8). Verificar con pruebas los importes del spec, el redondeo HALF_UP en sus tres puntos, los 6 decimales exactos, el 0 %, no objeto y exento separados, y el importe fuera del rango del XSD. Documentar el cálculo versionado en `decimal-policy.md`
- [ ] 4.3 Implementar el snapshot autosuficiente de design D11 con `eligibility` y sus cuatro declaraciones. Verificar con pruebas que el snapshot es suficiente para el XML y el RIDE sin leer datos vigentes

## 5. XML de la liquidación

- [ ] 5.1 Crear `purchase-settlement-xml-builder.ts` para `liquidacionCompra` 1.1.0 desde el snapshot (design D15), con `infoTributaria` compartida, `moneda` `DOLAR` y `pagos` con `plazo` y `unidadTiempo`. Verificar con golden de bytes exactos validados contra el XSD oficial: cédula y pasaporte, producto y línea libre, varias tarifas incluido el 0 %, descuentos, 6 decimales, varios pagos, caracteres especiales y longitudes máximas; y que el XML no escribe reembolsos, subsidios, detalles adicionales, negociable, máquina fiscal, información adicional ni declaraciones. Documentar el snapshot y el builder en `fiscal-emission.md`
- [ ] 5.2 Crear `purchaseSettlementSigningProfile` y firmar con el tipo `03`, con el XSD antes y después de firmar. Verificar que una liquidación reservada queda firmada con su artefacto de tipo 03 y la auditoría `purchase_settlement.signed`

## 6. Lecturas, borradores, vista previa y opciones

- [ ] 6.1 Implementar los puertos `PurchaseSupplierReader` y `PurchaseProductReader` compuestos en `main.ts`, y las rutas `/purchase-settlements/suppliers`, `/products` y `/options` (design D21). Verificar con pruebas HTTP los proveedores seleccionables y su motivo, los productos activos con su sugerencia de IVA, la política con sus declaraciones y su versión, los catálogos vigentes y los límites; actualizar `emitted-document-types.test.ts` para exigir el prefijo `/purchase-settlements` junto a los otros cinco. Documentar las rutas en `fiscal-emission.md`
- [ ] 6.2 Implementar los borradores con su vista previa (`/purchase-settlements/drafts`, design D12), con la dirección propuesta desde el tercero, los importes calculados, los problemas por línea o pago, las declaraciones y el aviso de la retención. Verificar con pruebas HTTP el borrador incompleto que se guarda sin reservar, la vista previa con problemas, la versión del borrador, el borrador emitido inmutable y el aislamiento por empresa
- [ ] 6.3 Aplicar a `POST` y `PUT` de los borradores el límite propio de 4 MiB (design D22), sin cambiar el límite global de 100 KB. Verificar con pruebas HTTP sobre `main.ts`: un borrador dentro de los valores por defecto se acepta; uno en los máximos absolutos con textos multibyte de longitud máxima (también escapado) no recibe `413` y llega a la validación del dominio; un cuerpo de más de 4 MiB recibe `413`; uno de menos de 4 MiB por encima de los límites estructurales se rechaza por esos límites; la emisión y otras rutas conservan los 100 KB. Documentarlo en `fiscal-emission.md`, `backend.md` y `deployment.md`

## 7. Emisión de la liquidación

- [ ] 7.1 Implementar la emisión (`POST /purchase-settlements`) con las comprobaciones previas, las cuatro declaraciones de design D3 y la transacción de design D13, con `purchase_settlement.reserved` y `purchase_settlement_reservations_total`. Verificar con pruebas HTTP la emisión de un operador, cada rechazo antes de reservar sin consumir número (declaración faltante, versión distinta, proveedor inválido, dirección vacía, pagos que no suman, tarifa no vigente), la idempotencia (repetición, clave reutilizada con otras declaraciones, sin clave), las declaraciones congeladas con autor y momento y fuera del XML, la auditoría sin descripciones, direcciones, XML ni SOAP y ninguna en los rechazos, y `403`, `401` y `404`. Documentar la emisión, las declaraciones, la idempotencia y los códigos en `fiscal-emission.md`, y la métrica y la regla de los logs en `observability.md`
- [ ] 7.2 Probar la atomicidad forzando un fallo después de cada paso de la transacción. Verificar que no quedan secuencial, clave, comprobante, registro, declaraciones, borrador emitido, idempotencia ni auditoría
- [ ] 7.3 Probar con PostgreSQL real dos emisiones simultáneas del mismo borrador (una sola liquidación) y emisiones simultáneas de borradores distintos (secuenciales sin huecos ni repetidos)
- [ ] 7.4 Implementar el reintento de firma (`/purchase-settlements/{id}/signing-attempts`). Verificar que una liquidación reservada se firma con su mismo número, su misma clave y su misma fecha, con `purchase_settlement.signing_retried`

## 8. Consulta, transmisión y reconciliación

- [ ] 8.1 Implementar la consulta (`/purchase-settlements`, `/{id}`, `/{id}/transmission`) con búsqueda por número o por la identificación o el nombre del proveedor y filtro de estado, desde el snapshot. Verificar con pruebas HTTP la lista, la búsqueda, el detalle con las declaraciones "declaradas por" el usuario y el aislamiento
- [ ] 8.2 Implementar la reconciliación manual (`/{id}/reconciliations`, `purchase_settlement.reconciliation_requested`) y `"03"` en `COMPLETED_AUDIT`. Verificar con pruebas HTTP la reconciliación de una liquidación en revisión manual, los estados que no se reconcilian y el `403` para el operador
- [ ] 8.3 Repetir con una liquidación los casos de la transmisión de design D18 con respuestas SINTÉTICAS: `RECIBIDA`, `DEVUELTA`, `AUTORIZADO`, `NO AUTORIZADO`, errores 70, 43 y 45, `NOT_SENT`, `SEND_UNKNOWN`, revisión manual, respuesta guardada antes de clasificar y reconciliación automática

## 9. Independencia y dirección de las dependencias

- [ ] 9.1 Probar con PostgreSQL real que una liquidación autorizada con una línea de un producto bien con control de stock no cambia saldos ni movimientos de inventario, y que no crea compras, cuentas por pagar, facturas recibidas ni comprobantes de retención
- [ ] 9.2 Añadir la prueba de arquitectura de design D1 (nadie importa `purchase-settlements`, y `purchase-settlements` no importa `invoices`, `inventory`, `parties`, `products` ni otro comprobante) y extender la prueba de secuenciales independientes a 01, 03, 04, 05, 06 y 07 en el mismo punto; documentar el módulo en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba de arquitectura pasa y detecta cada violación en archivos de ejemplo

## 10. RIDE de la liquidación

- [ ] 10.1 Implementar la lectura `liquidacionCompra` 1.1.0 con su lista blanca y el modelo del RIDE, y la distribución de la ficha v2.34, anexo 2, página 65 (`liquidacion-compra-1`, design D19), sin "Placa / Matrícula", "Guía Remisión", "Detalle Adicional" ni subsidios. Verificar con golden del texto de las páginas, el Code128, la paginación del máximo de líneas y el rechazo de contenido no admitido. Documentarlo en `fiscal-emission.md`
- [ ] 10.2 Comprobar el RIDE en el job, el pool y la bandeja. Verificar con una prueba de integración que una liquidación autorizada programa su RIDE, se genera una vez y se descarga e imprime con su historial de entregas

## 11. Bandeja con liquidaciones de compra

- [ ] 11.1 Agregar el tipo `03` a `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` con la contraparte rotulada "Proveedor" (design D20). Verificar con pruebas de componente y de API: filtro con los seis tipos, tipo bajo el número, proveedor e importe total, enlace al detalle y documentos disponibles por estado; y una prueba de backend que lista juntos los seis tipos
- [ ] 11.2 Documentar la liquidación en la bandeja en `fiscal-emission.md`

## 12. Pantallas de liquidaciones de compra

- [ ] 12.1 Implementar Liquidaciones de compra en `/liquidaciones-compra`, dentro de "Operación" (design D24), con lista, búsqueda y filtro de estado en la URL, borradores en curso y su eliminación. Verificar con pruebas de componente la carga, el vacío, el error, el permiso y la búsqueda
- [ ] 12.2 Implementar el borrador con sus pasos (punto, proveedor con "Nuevo proveedor", dirección, líneas con producto o libres, pagos con plazo y unidad de tiempo, vista previa con el aviso de la retención) y el diálogo de emisión con las cuatro declaraciones separadas. Verificar con pruebas de componente cada paso, los problemas por línea o pago, que no hay casilla genérica, que ninguna forma de pago, plazo ni unidad de tiempo viene precargada, que no se envían totales ni datos derivados, que el rol de proveedor solo se marca en el alta explícita, que el éxito lleva al detalle, que un doble clic envía una sola emisión con la misma clave en el reintento y que los `409` se explican
- [ ] 12.3 Implementar el detalle con las declaraciones "declaradas por" el usuario, el aviso de la retención, el reintento de firma, la transmisión y los documentos. Verificar con pruebas de componente. Documentar las pantallas en `fiscal-emission.md` con sus rutas y permisos
- [ ] 12.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, temas claro y oscuro, teclado y contraste), con el SRI simulado aislado, y registrar la revisión en `openspec/changes/add-purchase-settlements/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 13. Corrección documental del documento sustento 03

- [ ] 13.1 Corregir la fila "Documento sustento" de `glossary.md` y el texto de "Documentos sustento" en `withholding-draft-editor.tsx`, que atribuyen la liquidación de compra al proveedor: la emite el adquirente en los casos que la normativa permite (design D29). Verificar que la retención no cambia de comportamiento (sus pruebas pasan sin cambios)

## 14. Rendimiento y prueba end-to-end

- [ ] 14.1 Añadir `bench:purchase-settlements` en `backend/scripts/` (design D27), con el barrido del RIDE apagado y la base asentada, y registrar su resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005, que el RIDE tarda menos de 1 s, que la transacción de la reserva no incluye XML, firma ni red, y que el CPU, la memoria y la latencia confirman los valores por defecto de design D22 (o ajustarlos con `/opsx:update` y la evidencia). Registrar el tamaño del XML firmado del peor caso solo como medición, sin relacionarlo con Q-47
- [ ] 14.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado aislado: una liquidación con cédula, una línea con producto y otra libre, dos pagos con plazo y las cuatro declaraciones, autorizada y con su RIDE en la bandeja con el proveedor; otra no autorizada; y el inventario, los terceros y la ausencia de comprobantes de retención sin cambios. Verificar que la prueba pasa

## 15. Verificación

- [ ] 15.1 Ejecutar `corepack pnpm verify` y `openspec validate --all --strict`, y verificar que pasan formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact`, `check:ride-assets` y la validación de los specs
