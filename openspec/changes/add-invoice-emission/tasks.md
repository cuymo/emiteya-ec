# Tasks

## 1. Esquema de documentos, borradores e idempotencia

- [x] 1.1 Crear la migración y los modelos Prisma de `invoice_draft`, `invoice_draft_line` e `invoice_draft_payment` (design D2).
  - Columnas: `status` (`DRAFT`, `EMITTED`), `version`, autor y fecha de creación y del último cambio, `document_id` único.
  - CHECK de dominio de cantidad (18/6), descuento e importe de pago (14/2) con la regla del XSD. La línea no guarda precio: lo toma del producto al emitir.
  - FK a punto de emisión, tercero, producto y entrada del catálogo de formas de pago.
  - Trigger que impide cambiar o borrar un borrador `EMITTED`, sus líneas y sus pagos.

  Verificar con pruebas de integración del esquema: escalas fuera del dominio rechazadas por su CHECK y borrador emitido inmutable
- [x] 1.2 Crear `electronic_document` y `document_state_transition` (design D3):
  - unicidades de reserva, clave de acceso, número por ambiente, establecimiento, punto y tipo, y borrador;
  - CHECK de estado, clave, tipo y `total`;
  - trigger que solo permite `RESERVED` → `SIGNED`, `signed_at` y las columnas del intento;
  - sin `DELETE` ni `TRUNCATE`;
  - transiciones de solo agregado.

  Verificar con pruebas de integración: snapshot, número y clave inmutables, transición inversa rechazada y borrado rechazado
- [x] 1.3 Crear `document_artifact` (bytes, `size_bytes = octet_length`, SHA-256 hex, `UNIQUE (document_id, kind)`, de solo agregado) y el trigger de restricción diferido que exige el artefacto `SIGNED_XML` a un documento `SIGNED` (design D3 y D9).
  - Crear `idempotency_record`, de solo agregado, con `UNIQUE (company_id, operation, idempotency_key)` (design D8).

  Verificar con pruebas de integración: `SIGNED` sin artefacto rechazado al confirmar, artefacto inmutable, segundo artefacto rechazado y clave duplicada rechazada
- [x] 1.4 Añadir el bloque de las tablas nuevas a `migrations.test.ts`, con la lista exacta de columnas `numeric`, y documentar tablas, CHECK y triggers en `database.md`. Verificar que `migrations.test.ts` pasa, incluida la ausencia de deriva entre migraciones y esquema

## 2. Registro de esquemas completo y XSD empaquetados

- [x] 2.1 Ampliar `schema_registry_entry` y su dataset con `kind`, `path` lógico, `revision` e `imports`, con CHECK por `kind` y clave primaria `(path, dataset_version)` (design D11).
  - La migración rellena la versión 1 con el trigger de inmutabilidad desactivado solo dentro de ella.
  - Crear `schema-registry/2.json` con los seis documentos y el import `xmldsig-core-schema.xsd`, y su fila en `docs/product/sri-catalogs/README.md`.

  Verificar con pruebas de datasets y del cargador: versión 2 aplicada, versión 1 intacta y archivos con su hash
- [x] 2.2 Exponer `schemaRegistry()` y `specialCases()` en `fiscalCatalogQueries`, y mostrar los imports en la vista del registro (`GET /fiscal-catalogs/schemas`, contrato y pantalla `Catálogos fiscales`).
  - Que el adaptador `XsdValidator` tome los imports y sus hashes del registro, y añadir `ensureAvailable(schema)`.

  Verificar con la prueba de contrato del validador y con pruebas de la API de catálogos (escenarios de la spec modificada de `fiscal-catalogs`)
- [x] 2.3 Copiar los XSD del registro a `backend/dist/xsd/<path>` en el build del backend y añadir `check:xsd-artifact` a `verify` después del build.
  - Añadir `XSD_DIRECTORY` y los límites de concurrencia, cola y plazo de la validación al esquema de entorno.
  - Validar al arrancar el paquete canónico completo. Si es inválido: error en el log, métrica `xsd_registry_available` a 0 y `/health/ready` con `503`.
  - Añadir `INVOICE_MAX_LINES` (100 por defecto, de 1 a 1 000) como límite configurable de la aplicación.

  Verificar que el build deja los siete archivos con su hash, que `check:xsd-artifact` falla con un archivo alterado y que una prueba de arranque con un XSD ausente o alterado deja `/health/ready` en `503`

## 3. Aritmética fiscal

- [x] 3.1 Añadir a `platform/decimal` las primitivas exactas `sumExact`, `subtractExact`, `multiplyExact` y `percentageOfExact`, con `roundHalfUp` como único redondeo (design D5). Verificar con pruebas de 18 por 18 dígitos exactos, sumas largas y la prueba de que el módulo no usa `number`
- [x] 3.2 Crear `invoices/domain/amounts.ts` con `lineSubtotal`, `lineDiscount`, `taxableBase`, `taxAmount`, `materializeMoney` e `invoiceTotals` (design D5).
  - Añadir una tabla dorada con los casos de S-3 y de la spec: empates HALF_UP, totales desde valores materializados, varias líneas con descuento y regresiones de 17 y 18 dígitos.
  - Actualizar `decimal-policy.md`.

  Verificar con la tabla dorada, los límites del descuento y la prueba de fuente sin `number` ni `decimal.js`

## 4. Contratos, permisos y acciones de auditoría

- [x] 4.1 Crear `packages/contracts/src/invoices.ts`:
  - cuerpos estrictos de borrador y de emisión (`draftId`, `expectedVersion`);
  - vistas de borrador con vista previa e `issues`, de factura con el diagnóstico y sus listas paginadas;
  - códigos de error de D6, D8 y D10.

  Registrar las rutas de D13 en `apiRoutes`. Verificar con pruebas de contrato: `companyId`, campos desconocidos y precio en la línea rechazados, escalas decimales como texto exacto, y OpenAPI regenerado y al día
- [x] 4.2 Añadir `invoices.read`, `invoices.draft`, `invoices.emit` e `invoices.retrySigning` para ambos roles al mapa central, a su espejo del frontend y a la tabla de `access-control.md` (design D14).
  - Añadir `invoice.reserved`, `invoice.signed` e `invoice.signing_retried` a las acciones de auditoría.

  Verificar con las pruebas del mapa de acceso y de la tabla documentada

## 5. Lecturas internas de los otros módulos

- [x] 5.1 Exportar las fábricas sobre un `DbClient` de design D1:
  - `createTaxpayerScope(tx)`, que la unidad de trabajo existente pasa a usar, y `taxpayerEmissionReads(tx)`;
  - `createFiscalScope(tx)`;
  - `partyReader(db)` y `productReader(db)`;
  - `signingReads(db).activeCertificate`.

  Verificar con pruebas de cada lectura dentro de una transacción, con dos empresas, y con las pruebas de arquitectura y de capas sin cambios

## 6. Motor SRI: clave, builder y firma de XML

- [x] 6.1 Implementar el adaptador `AccessKeys` sobre `generateClaveAcceso`, con el código numérico de `crypto.randomInt` (design D12). Verificar con su prueba de contrato contra la implementación de referencia de CTX §8.3: secuenciales 1, 9, 10 y 999999999, 500 códigos aleatorios, longitudes y caracteres inválidos, y sin `Math.random`
- [x] 6.2 Implementar el escritor XML y el `InvoiceXmlBuilder` de la factura 1.1.0 validados en S-3, con el puerto `InvoiceSnapshot` (design D4 y D12).
  - El builder es puro, determinista y en el orden del XSD.
  - Escapa el texto, rechaza caracteres no admitidos en XML 1.0 y escribe solo los opcionales que corresponden, incluidos `agenteRetencion` y `contribuyenteRimpe`.

  Verificar con sus pruebas: escape, caracteres inválidos, opcionales, versión no soportada, snapshot congelado y prueba de fuente sin `number`, reloj, entorno, archivos, base de datos ni la librería, con el XML validado contra el XSD
- [x] 6.3 Añadir al pool criptográfico la tarea `sign-xml` y el servicio de firma de documentos de `signing` (design D9).
  - Lee el certificado activo utilizable y su secreto sellado, abre la custodia y transfiere los bytes.
  - En el worker, firma y comprueba la huella del certificado embebido; después pone los bytes a cero.
  - Traduce los errores a los códigos de D10.

  Verificar con pruebas de integración: firma verificable con un P12 sintético, firma vencida, custodia no disponible, certificado embebido distinto, y ningún secreto en errores ni logs

## 7. Borradores de factura

- [x] 7.1 Implementar los casos de uso y el repositorio de borradores (design D2 y D13).
  - Crear, corregir con versión, eliminar, listar borradores `DRAFT` y obtener con vista previa e `issues`, calculados con la fecha de hoy y las mismas funciones de la validación de emisión.
  - Las referencias se resuelven en la empresa.

  Verificar con pruebas de integración de los escenarios de "Borradores de factura" y de los límites de "Contenido de la factura"
- [x] 7.2 Exponer las rutas de borradores en el router de `invoices`, con permisos y aislamiento. Verificar con pruebas HTTP:
  - dos empresas;
  - sin sesión;
  - referencias ajenas;
  - `companyId` en el cuerpo;
  - versión desactualizada;
  - borrador emitido inmutable;
  - prueba de rutas de OpenAPI

## 8. Emisión hasta `RESERVED` e idempotencia

- [x] 8.1 Implementar el registro de idempotencia en `platform/idempotency`: cabecera, huella canónica, consulta y alta en la transacción (design D8). Verificar con pruebas unitarias de la huella y de la cabecera, y de integración de la colisión del índice único
- [x] 8.2 Implementar la validación previa a la reserva y la construcción del snapshot (design D4 y D6): fecha capturada una vez, los diez grupos de comprobaciones con sus códigos, casos especiales con la matriz y límites del esquema. Verificar con pruebas de cada código de rechazo, cada una comprobando que no se reserva número, no se crea clave, no se bloquea la identidad y no se crea documento
- [x] 8.3 Implementar la unidad de trabajo de emisión y la transacción de `RESERVED` en el orden de design D7, con `POST /api/v1/invoices`. Verificar con pruebas de integración:
  - reserva correcta con número, clave de 49 dígitos e identidad bloqueada;
  - fallo dentro de la transacción sin rastro;
  - el snapshot no cambia aunque cambien el producto o la configuración;
  - fecha de Ecuador frente a UTC;
  - transición registrada;
  - evento `invoice.reserved`
- [x] 8.4 Probar la idempotencia de la emisión (ERS AC-05, design D8):
  - repetición firmada y reservada;
  - misma clave con otro borrador (`409 IDEMPOTENCY_KEY_REUSED`);
  - dos solicitudes simultáneas con la misma clave, con un solo documento y un solo número;
  - falta de clave;
  - otra clave sobre un borrador emitido;
  - misma clave en otra empresa.

  Verificar que todas pasan contra PostgreSQL

## 9. Firma, artefacto, recuperación y consulta

- [x] 9.1 Implementar el puerto de artefactos y su adaptador PostgreSQL, el arriendo del intento y el procedimiento XML, XSD, firma, XSD del firmado y persistencia con `SIGNED` en una transacción, con su transición y el evento `invoice.signed` (design D9). Verificar con pruebas de integración:
  - artefacto con SHA-256, tamaño, tipo y metadatos;
  - XML firmado que vuelve a validar;
  - `SIGNED` solo con artefacto
- [x] 9.2 Implementar el diagnóstico del último intento con sus tres clases y `POST /api/v1/invoices/{id}/signing-attempts`, con el evento `invoice.signing_retried` (design D10). Verificar con fallos inyectados en cada etapa:
  - validación saturada;
  - pool criptográfico ocupado;
  - firma vencida y después reemplazada;
  - esquema alterado;
  - caída simulada tras la reserva;
  - reintentos simultáneos, con un solo artefacto;
  - reintento de una factura firmada sin efecto;
  - diagnóstico sin secretos ni XML
- [x] 9.3 Implementar `GET /api/v1/invoices` (paginación, estado, búsqueda por número o comprador) y `GET /api/v1/invoices/{id}` desde el snapshot, con el diagnóstico. Verificar con pruebas HTTP de los escenarios de "Consulta de facturas", el aislamiento por empresa y los permisos
- [x] 9.4 Reproducir S-3 offline con la implementación real (design D17): del borrador a `SIGNED` por el caso de uso, con reloj y código numérico inyectados.
  - El XML sin firmar se compara con XML de referencia revisados a mano: consumidor final `49.99` y `50.00`, `50.01` rechazado, varias líneas, valores grandes, regresiones `123456789012.123456` y `99999999999.999999` como precio y como cantidad, y emisor con agente de retención y RIMPE.
  - El XML firmado vuelve a validar.

  Verificar que la prueba pasa

## 10. Pantallas de borradores y facturas

- [x] 10.1 Crear el componente compartido `EntityPickerDialog` (design D15): búsqueda, resultados paginados del backend, selección por teclado y opción rápida configurable. Documentarlo en `component-system.md`. Verificar con pruebas de componente por rol y nombre accesible
- [x] 10.2 Crear `Borradores` y el editor a página completa (design D15):
  - comprador con el selector y "Consumidor final", punto de emisión, líneas con el selector de productos, cantidad, precio del producto (solo lectura) y descuento, y formas de pago;
  - totales e `issues` de la vista previa del servidor, guardado con versión y eliminación con confirmación;
  - emisión con la confirmación de un paso, el ambiente y el aviso de consumidor final, con la `Idempotency-Key` estable para la misma solicitud.

  Verificar con pruebas de componente de carga, vacío, error, sin permiso, éxito, conflicto de versión y error de emisión en su campo o línea
- [x] 10.3 Crear `Facturas` y su detalle (design D15):
  - lista con estado, búsqueda y paginación;
  - detalle desde el snapshot con el diagnóstico;
  - "Reintentar firma" solo con `RESERVED` y permiso.

  Añadir ambos destinos al grupo `Operación`. Verificar con pruebas de componente de los mismos estados y de la navegación
- [x] 10.4 Revisar las pantallas con `frontend-checklist.md`, contra el backend real:
  - escritorio, 375 y 320 px;
  - tema claro y oscuro, teclado y contraste;
  - consola y red.

  Registrar el resultado en `openspec/changes/add-invoice-emission/ui-review.md`. Verificar que el recorrido no deja hallazgos abiertos sin excepción declarada

## 11. Benchmark de la emisión (Q-26)

- [x] 11.1 Instrumentar las etapas de la emisión: `Server-Timing` solo con `EMISSION_STAGE_TIMINGS=1`, que el entorno rechaza en producción, y el histograma `invoice_emission_stage_duration_seconds` (design D16). Verificar con una prueba de que la cabecera falta sin la variable y de que el entorno de producción la rechaza
- [x] 11.2 Crear `bench:emission`: PostgreSQL 17, 100 000 facturas previas por empresa, 10 usuarios concurrentes, 30 de calentamiento y 300 medidas, con P50, P95 y máximo por etapa y total, y el entorno registrado.
  - Ejecutarlo y guardar el informe en `docs/quality/benchmarks/emission-<fecha>.md` y `.json`. Declarar que los artefactos sintéticos de la precarga no simulan el volumen físico de `BYTEA` y TOAST, y que cada factura medida usa su artefacto real.
  - Actualizar `performance.md` y Q-26.

  Verificar que el P95 total queda en 2 s o menos en el entorno registrado, o proponer la corrección con `/opsx:update` sin subir el umbral

## 12. Prueba end-to-end, evidencia y documentación

- [ ] 12.1 Añadir la prueba end-to-end sobre `main.ts`:
  - configuración, punto, firma sintética con custodia, tercero y producto;
  - borrador, emisión hasta `SIGNED`, repetición con la misma clave y rearranque;
  - consulta, eventos de auditoría exactos y ninguna llamada al SRI.

  Verificar que la prueba pasa
- [ ] 12.2 Buscar el vector oficial de la clave de acceso en la ficha v2.34 por su fuente oficial y, si se obtiene, añadirlo a la prueba de contrato de `AccessKeys` con su cita. Si sigue inaccesible, registrarlo como evidencia pendiente en `open-questions.md`, sin inventarlo. Verificar el resultado en `/opsx:verify`, que decide si bloquea el archive o pasa a compuerta previa a la transmisión
- [ ] 12.3 Actualizar la documentación:
  - `fiscal-emission.md`: implementación, códigos y obligaciones cumplidas;
  - `idempotency.md` y `backend.md`, alineados con Q-30;
  - `ARCHITECTURE.md`, con el módulo `invoices` y las lecturas internas;
  - `capabilities.md` y `domain-model.md`;
  - `open-questions.md`: Q-45, la modificación del precio unitario por línea, como decisión futura;
  - el checklist de PR fiscal de CTX §65 respondido en el design.

  Verificar que los documentos citan las rutas, permisos y códigos implementados

## 13. Verificación

- [ ] 13.1 Ejecutar `corepack pnpm verify`; verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build y `check:xsd-artifact` pasan
