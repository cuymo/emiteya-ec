# Tasks

## 1. Escritor XLSX

- [x] 1.1 Primera tarea técnica (design D9): hacer un spike corto, fuera del código de producción, que compare un escritor OOXML mínimo propio sobre una biblioteca de ZIP con streaming (A) y una biblioteca XLSX con escritura por streaming (B). Criterios: memoria acotada al escribir 100 000 filas, celdas de cadena y numéricas exactas, `quotePrefix` y ausencia de fórmulas, fechas, estilos mínimos, bytes deterministas con un momento fijo, licencia, mantenimiento, tamaño y lectura en pruebas. Registrar la elección y su evidencia en `docs/architecture/adr/0023-*.md` y en `docs/architecture/stack.md`. Verificar que el ADR recoge las mediciones de las dos opciones
- [x] 1.2 Implementar el escritor elegido en `reports/infrastructure` con solo el subconjunto que necesitan los cinco reportes (design D6, D7 y D8): una hoja de datos con encabezados y fila fija, la hoja "Filtros", celdas de cadena con `quotePrefix` para el texto de los usuarios, celdas numéricas desde el texto decimal canónico hasta 15 dígitos significativos y texto canónico por encima, fechas y momentos en `America/Guayaquil`, y escritura por streaming a un archivo. Verificar con pruebas unitarias que leen el libro: el tipo y el valor exacto de cada celda, el viaje de ida y vuelta de los decimales, los prefijos `=`, `+`, `-`, `@`, tabulador y retorno de carro como cadenas sin fórmulas, las fechas sin desplazamiento, los bytes deterministas y la memoria acotada con 100 000 filas

## 2. Contratos, permisos, entorno y auditoría

- [x] 2.1 Crear `packages/contracts/src/reports.ts` (design D3, D4 y D12): los seis identificadores de reporte (cinco reportes, con el inventario en dos vistas), los filtros estrictos de cada uno con sus valores por defecto (`state` con `ALL`, `environment` con `TEST`, `PRODUCTION` y `ALL`, `fiscalPeriod` `AAAA-MM`, rango con `from <= to`), las filas de cada vista con los importes como texto decimal, la vista paginada con el ambiente efectivo y los códigos `REPORT_EXPORT_ROW_LIMIT` y `REPORT_EXPORT_BUSY`, y sus rutas en `api/routes.ts` con la exportación como respuesta binaria. Verificar con pruebas de contrato los valores por defecto, el rango inválido, el filtro de otro reporte, el `companyId` rechazado y el OpenAPI regenerado
- [x] 2.2 Añadir `reports.read` y `reports.export` para administrador y operador en `access-policy.ts`, su espejo del frontend y `access-control.md`, confirmando la fila "Ver reportes y exportar XLSX" (design D14). Verificar con pruebas de la política
- [x] 2.3 Añadir `REPORT_EXPORT_MAX_ROWS` y `REPORT_EXPORT_MAX_CONCURRENT` al esquema de entorno con los valores iniciales de design D11, marcados como hipótesis que fija el benchmark, y documentarlas en `deployment.md` como defensas de recursos del proyecto. Verificar con pruebas del entorno
- [x] 2.4 Añadir la acción `report.exported` al dominio de la auditoría (design D13) y documentarla en `audit` y en `observability.md` con las métricas de design D17. Verificar con la prueba de las acciones de auditoría

## 3. Fuentes de reporte de los módulos dueños

- [x] 3.1 Declarar en cada módulo de comprobante la proyección de importes de su snapshot (design D5): factura, liquidación y nota de crédito desde `totals`; nota de débito con los impuestos del nivel superior; retención con el total retenido; guía sin importes. Exportar desde `fiscal` la fuente de Documentos emitidos y de Facturas, que `main.ts` compone con esas proyecciones: filtros de design D3, ambiente, orden de design D2, página, lotes por cursor y conteo, con el tercero por tipo (la guía con su único destinatario o "N destinatarios") y los impuestos sumados en SQL. Verificar con pruebas de integración cada filtro, el orden total, el conteo, los importes de los seis tipos (IVA y otros impuestos separados en Facturas), que nunca aparece un borrador, que un tercero corregido después de emitir no cambia la fila y que otra empresa no aparece
- [x] 3.2 Exportar desde `withholding-receipts` la fuente de Retenciones: una fila por línea con el período fiscal, el impuesto, el código, la base, el porcentaje, el valor y el sujeto retenido congelado, con los filtros, el orden, la página, los lotes y el conteo. Verificar con pruebas de integración la fila por línea, el filtro por período distinto de la fecha de emisión, que un cambio posterior del catálogo no cambia la fila y el aislamiento por empresa
- [x] 3.3 Exportar desde `inventory` las fuentes de Existencias (productos con inventario inicializado, saldo registrado, incluido el negativo) y de Movimientos (toda la empresa, por producto, fechas en Ecuador y tipo, con el número del comprobante), y desde `products` la lectura del código y el nombre por identificadores en lote. Verificar con pruebas de integración que los productos sin inventario no aparecen, que el saldo es el del inventario sin recalcular, el filtro por tipo de movimiento, el orden y el aislamiento por empresa
- [x] 3.4 Exportar desde `parties` la fuente de Terceros con rol, identificación y estado, y desde `taxpayer` la lectura del ambiente vigente. Verificar con pruebas de integración los filtros, los datos vigentes y el aislamiento por empresa
- [x] 3.5 Añadir la prueba de arquitectura de `reports`: nadie lo importa, y no lee tablas de otros módulos ni importa sus dominios, solo las fuentes que compone `main.ts`. Documentar las fuentes y la dirección de dependencias en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba detecta cada violación en archivos de ejemplo

## 4. Consulta y exportación

- [x] 4.1 Implementar el dominio de `reports` (design D2, D3 y D4): la definición de cada reporte con sus filtros, sus valores por defecto, su ambiente efectivo, su orden y sus columnas con el tipo de celda de cada una. Verificar con pruebas unitarias los valores por defecto de cada reporte y que la lista y la exportación usan la misma definición
- [x] 4.2 Implementar la consulta paginada `GET /api/v1/reports/{report}` con `reports.read`. Verificar con pruebas de integración por HTTP las filas, `meta.total`, el ambiente efectivo (vigente por defecto, `ALL` solo explícito), los estados por defecto (todos en Documentos emitidos, autorizados en Facturas y Retenciones), `403`, `401`, `companyId` rechazado y el aislamiento por empresa
- [x] 4.3 Implementar la exportación `GET /api/v1/reports/{report}/export` con `reports.export` (design D10, D11 y D13). Debe hacer, en orden: el semáforo por instancia; el conteo y el rechazo `409 REPORT_EXPORT_ROW_LIMIT` antes de generar; la generación por lotes en una transacción `REPEATABLE READ` de solo lectura hacia un archivo temporal privado; la auditoría `report.exported` antes de entregar, sin entregar si falla; y la entrega con sus cabeceras, borrando el temporal siempre. Verificar con pruebas de integración:
  - AC-09 en cada reporte: todas las páginas de la API concatenadas en orden son exactamente las filas del XLSX;
  - el XLSX vacío con encabezados;
  - el `409` sin archivo ni evento;
  - el `503` con `Retry-After` sin afectar a la exportación en curso;
  - el evento con los filtros no sensibles y solo la presencia del filtro con un dato personal;
  - ningún evento ante un rechazo, un fallo de generación o un fallo de la auditoría;
  - dos exportaciones, dos eventos;
  - el temporal borrado al terminar, al fallar y con el cliente desconectado;
  - `403`, `401` y el aislamiento por empresa
- [x] 4.4 Documentar el módulo `reports`, sus rutas, el formato del XLSX, la política de precisión, la defensa contra fórmulas, la ejecución en dos fases y la auditoría en `docs/architecture/reports.md`, enlazado desde `ARCHITECTURE.md`. Verificar que la documentación cita las rutas y las variables reales

## 5. Pantalla Reportes

- [x] 5.1 Implementar Reportes en `/reportes`, dentro de "Operación", con `reports.read` (design D16): el selector de los cinco reportes y de las vistas del inventario, los filtros de cada reporte en la URL con el atajo mensual, el ambiente efectivo visible, la tabla paginada con tarjetas por debajo de 768 px, el aviso de RF-505 y "Exportar XLSX" con `reports.export`, que descarga con los mismos filtros, muestra el progreso y explica el `409` y el `503`. Verificar con pruebas de componente:
  - la carga, el vacío, sin coincidencias, el error y sin permiso;
  - los filtros en la URL y el atajo mensual;
  - los estados por defecto y el ambiente;
  - la exportación con los filtros de la URL;
  - los mensajes del `409` y del `503`;
  - la entrada de la navegación
- [x] 5.2 Documentar la pantalla, su ruta y sus permisos en `docs/architecture/reports.md`. Verificar que coincide con la navegación implementada
- [x] 5.3 Revisar la pantalla con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, temas claro y oscuro, teclado y contraste) con datos sintéticos en un esquema aislado, abrir un XLSX exportado y comprobar sus tipos de celda, y registrar la revisión en `openspec/changes/add-reports-export/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 6. Rendimiento y prueba end-to-end

- [ ] 6.1 Añadir `bench:reports` en `backend/scripts/` (design D18), con el barrido del RIDE apagado y la base asentada. Debe medir:
  - el P95 de cada lista y de su conteo;
  - la exportación mensual y la del máximo de filas, con tiempo, memoria máxima, CPU, tamaño y duración de la transacción;
  - 10 exportaciones simultáneas, con tiempo de reloj, memoria máxima, CPU, conexiones y duración de las transacciones en la base;
  - el rechazo por el máximo de filas.

  Registrar el resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada lista cumple ERS RNF-005, y fijar con la evidencia los valores por defecto y los rangos de `REPORT_EXPORT_MAX_ROWS` y `REPORT_EXPORT_MAX_CONCURRENT`, actualizando el entorno y `deployment.md`. Si la exportación síncrona o la transacción `REPEATABLE READ` no son sanas, corregir el design con `/opsx:update`
- [ ] 6.2 Si el benchmark lo justifica, crear una migración solo de índices de lectura, con su prueba en `migrations.test.ts` y su documentación en `database.md`. Verificar que el benchmark mejora con ella
- [ ] 6.3 Añadir la prueba end-to-end sobre `main.ts`: comprobantes sintéticos de los seis tipos en los dos ambientes, retenciones, inventario y terceros. Debe exportar cada reporte por HTTP, leer el XLSX y compararlo con todas las páginas de la API, y comprobar el evento `report.exported` y que el inventario, los comprobantes y los terceros no cambian. Verificar que la prueba pasa

## 7. Verificación

- [ ] 7.1 Ejecutar `corepack pnpm verify` y `openspec validate --all --strict`, y verificar que pasan formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact`, `check:ride-assets` y la validación de los specs
