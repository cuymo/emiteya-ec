# Design

## Context

El ERS pide cinco reportes filtrables exportables a XLSX (§11, RF-501 a RF-505) y su criterio AC-09.
La revisión de readiness del 2026-10-08 fijó el alcance y sus decisiones (Trazabilidad de `reports`
en `docs/product/capabilities.md`; BR-57 a BR-62 en `docs/product/domain-model.md`). Ver proposal.md
para la motivación.

Lo que ya existe y este cambio reutiliza, sin cambiar su comportamiento:

- **Comprobantes:** `electronic_document`, con las columnas congeladas al reservar (tipo, ambiente, establecimiento, punto, número, fecha de emisión, estado, identificación y nombre de la contraparte, importe total), su snapshot inmutable por tipo y `electronic_document_recipient` para los destinatarios de la guía. La bandeja (`fiscal/infrastructure/archive/prisma-archive-reads.ts`) los ordena por fecha de emisión, creación e identificador, y no filtra ni muestra el ambiente.
- **Retenciones:** `withholding_receipt` (período fiscal) y `withholding_receipt_line` (impuesto, código, base, porcentaje y valor por línea), ambas inmutables.
- **Inventario:** `stock_balance` (el saldo de cada producto inicializado) y el libro `stock_movement` (tipo, cantidad, saldo resultante, número del comprobante y momento), solo de agregado. El kárdex se consulta hoy por producto.
- **Terceros:** `party`, con roles, estado, correo y teléfono.
- **Dirección de dependencias:** un módulo no lee las tablas de otro; `parties`, `products` y `catalogs` lo prueban con pruebas de arquitectura, y `main.ts` compone puertos (ARCHITECTURE.md, "Dependency Direction").
- **Auditoría:** `audit_event` solo de agregado, con las acciones de `audit/domain/audit-event.ts`; la acción no tiene un `CHECK` en la base. Hoy solo se auditan cambios; las descargas de documentos tienen su propio historial de entregas.
- **Volumen (Q-26):** 100 000 comprobantes, 10 000 terceros, 10 000 productos y 10 usuarios concurrentes; los benchmarks existentes siembran también cientos de miles de movimientos de inventario.
- No hay ninguna biblioteca de XLSX ni de ZIP instalada.

## Goals / Non-Goals

**Goals:**

- Cinco reportes con una sola definición por reporte de sus filtros, su orden y sus columnas, compartida por la lista paginada y la exportación, de modo que AC-09 sea una propiedad del diseño y no de la disciplina.
- Exportación XLSX exacta: tipos de celda correctos, ningún decimal aproximado y ningún texto convertido en fórmula.
- Memoria acotada, sin artefactos durables, con defensas de recursos medidas.
- Respetar la dirección de dependencias: `reports` no lee tablas ajenas.

**Non-Goals:**

- Un motor genérico de hojas de cálculo, de consultas ad hoc o de reportes configurables.
- Exportaciones asíncronas, programadas, por correo o guardadas como artefacto.
- Agregados, totales, gráficos o indicadores.
- Cambiar la bandeja, el kárdex por producto o la lista de terceros existentes.

## Decisions

### D1. Módulo `reports` y dirección de las dependencias

- Módulo nuevo `reports` con `domain/` (definición de los reportes, filtros, columnas, política de celdas), `application/` (consulta, conteo, exportación, límites, auditoría) e `infrastructure/` (HTTP, escritor XLSX y composición).
- `reports` no lee tablas de otros módulos. Cada dueño exporta una **fuente de reporte** de solo lectura, con el filtro, el orden, la página o el lote por cursor y el conteo, que `main.ts` compone como puerto:
  - `fiscal`: Documentos emitidos y Facturas, sobre `electronic_document`, sus destinatarios y la proyección de importes de D5;
  - `withholding-receipts`: Retenciones, sobre sus tablas inmutables y el comprobante;
  - `inventory`: Existencias y Movimientos, sobre `stock_balance` y `stock_movement`, con el identificador del producto;
  - `parties`: Terceros, sobre `party`;
  - `products`: el código y el nombre de los productos por identificadores, en lote, para las filas del inventario (el inventario no lee la tabla de productos);
  - `taxpayer`: el ambiente vigente de la empresa.
- Nadie importa `reports`; una prueba de arquitectura lo fija, como en los cambios anteriores.
- **Alternativa descartada:** consultas SQL de `reports` sobre todas las tablas. Rompe la frontera de los módulos y sus pruebas de arquitectura.

### D2. Un reporte, una definición

- Cada reporte es una definición en el dominio: su esquema de filtros (Zod, en `packages/contracts`), sus valores por defecto, sus columnas (encabezado, tipo de celda y formato) y su fuente. La lista y la exportación toman la misma definición, aplican los mismos filtros con la misma consulta y el mismo orden total (con el identificador como desempate), y solo difieren en cómo recorren los resultados: por página o por lotes.
- **Orden de cada reporte**, total y estable:
  - Documentos emitidos y Facturas: fecha de emisión descendente, creación descendente e identificador, como la bandeja;
  - Retenciones: el del comprobante, luego la posición del documento sustento y la de la línea;
  - Existencias: nombre del producto e identificador;
  - Movimientos: momento descendente e identificador;
  - Terceros: razón social normalizada e identificador.
- **AC-09:** una prueba recorre todas las páginas de la API, concatena las claves en orden, exporta con los mismos filtros, lee las filas del XLSX y comprueba la igualdad de conjunto y de orden, en cada reporte.

### D3. Filtros, valores por defecto y validación

| Reporte | Filtros | Por defecto |
| --- | --- | --- |
| Documentos emitidos | `from`, `to`, `documentType`, `state`, `establishmentId`, `emissionPointId`, `environment` | Todos los estados; el ambiente vigente |
| Facturas | `from`, `to`, `customerIdentification`, `state`, `environment` | `state=AUTHORIZED`; el ambiente vigente |
| Retenciones | `from`, `to`, `supplierIdentification`, `fiscalPeriod`, `state`, `environment` | `state=AUTHORIZED`; el ambiente vigente |
| Inventario, Existencias | `productId` | — |
| Inventario, Movimientos | `productId`, `from`, `to`, `movementType` | — |
| Terceros | `role`, `identification`, `status` | Activos, como la lista de terceros |

- `state` acepta un estado o `ALL`; el valor por defecto de cada reporte se aplica en el servidor cuando falta. `from` y `to` son fechas de calendario con `from <= to`; el atajo mensual de la pantalla solo los fija. `fiscalPeriod` es `AAAA-MM`.
- Esquemas estrictos por reporte: un filtro de otro reporte, un `companyId` o un parámetro desconocido son `400 VALIDATION_ERROR`.
- Las fechas de Documentos emitidos, Facturas y Retenciones son la fecha de emisión del comprobante; las de Movimientos, la fecha del movimiento en Ecuador (`America/Guayaquil`), con el día completo.

### D4. Ambiente

- `environment` acepta `TEST`, `PRODUCTION` o `ALL`. Si falta, el servidor usa el ambiente vigente de la empresa, que lee de `taxpayer` en cada solicitud; nunca lo toma de la sesión del cliente ni de otro parámetro.
- `ALL` nunca es el valor por defecto. La vista de la lista devuelve el ambiente efectivo, y la pantalla lo muestra y lo conserva en la URL al exportar, de modo que la lista y el XLSX usan el mismo valor aunque la empresa cambie de ambiente entre ambas.
- Columna "Ambiente" ("Pruebas" o "Producción") en Documentos emitidos, Facturas y Retenciones.
- El inventario y los terceros no tienen ambiente.

### D5. Fuente histórica e importes por tipo

- Documentos emitidos y Facturas salen de las columnas congeladas del comprobante y de su snapshot; nunca del tercero, el producto o el catálogo vigentes.
- **Proyección de importes por tipo**, declarada por el módulo dueño de cada snapshot y compuesta por `main.ts` en la fuente de `fiscal`. Se lee en SQL solo lo necesario del snapshot, sin cargarlo entero:

| Tipo | Subtotal | Impuestos (IVA y otros) | Total |
| --- | --- | --- | --- |
| 01 Factura | `totals.withoutTaxes` | `totals.taxes[]`: IVA es `taxCode` 2; los demás, otros | `totals.total` |
| 03 Liquidación | `totals.withoutTaxes` | `totals.taxes[]` (solo IVA) | `totals.total` |
| 04 Nota de crédito | `totals.withoutTaxes` | `totals.taxes[]` | `totals.total` |
| 05 Nota de débito | `totals.withoutTaxes` | `taxes[]` del nivel superior del snapshot | `totals.total` |
| 07 Retención | — | — | `totals.withheld` |
| 06 Guía | — | — | — |

- La suma de los impuestos de una fila se hace en SQL con `NUMERIC`, nunca en JavaScript; un importe pasa a la aplicación como texto decimal.
- **Tercero por tipo:** las columnas de la contraparte del comprobante (comprador, proveedor o sujeto retenido); para la guía, su único destinatario con su identificación, o "N destinatarios" sin identificación.
- Retenciones salen de `withholding_receipt_line` y del comprobante; Existencias, de `stock_balance`; Movimientos, de `stock_movement` con el código y el nombre vigentes del producto (el inventario es operativo); Terceros, de `party` vigente.
- **Alternativa descartada:** columnas nuevas de subtotal e impuestos en `electronic_document`, llenadas al reservar con un relleno de los existentes. Toca la reserva de los seis tipos; queda como recurso si el benchmark muestra que la proyección desde el snapshot no cumple.

### D6. Formato del XLSX

- Una hoja con los encabezados en español y una fila por registro; una segunda hoja, "Filtros", con el reporte, el momento de generación en Ecuador, los filtros efectivos (con el ambiente) y el aviso de RF-505. La hoja de datos tiene la fila de encabezados fija y anchos de columna razonables.
- Sin filas de totales, sin fórmulas, sin tablas dinámicas ni hojas ocultas.
- Nombre del archivo ASCII, sin datos personales: `<reporte>-<desde>-<hasta>.xlsx` o `<reporte>-<fecha de generación>.xlsx`.

### D7. Tipos de celda y precisión

- **Texto:** identificaciones, números de comprobante, claves de acceso, autorizaciones, códigos y períodos, siempre (RF-502).
- **Números exactos:** un importe, una cantidad, una base o un porcentaje se escriben como celda numérica, con el texto decimal canónico en el XML de la hoja, solo si tienen como máximo 15 dígitos significativos; si tienen más, como texto canónico. Nunca pasan por `number` de JavaScript.
- **Formatos:** importes con `#,##0.00`; cantidades y porcentajes con los decimales de su valor canónico, de `#,##0` a `#,##0.000000` (ADR 0023: `#,##0.######` y `0.##` muestran un punto final en los enteros). La presentación del separador depende de la configuración regional de quien abre el archivo; el valor no.
- **Fechas:** las fechas de emisión como fecha (número de serie desde el 1899-12-30, calculado desde la fecha ISO sin zona horaria) con `dd/mm/yyyy`; los momentos de los movimientos convertidos explícitamente a `America/Guayaquil`, con sus milisegundos y el formato `dd/mm/yyyy hh:mm:ss`. Nunca se usa la zona ni la configuración regional del servidor.
- **Pruebas:** un lector de XLSX en las pruebas comprueba el tipo de cada celda y el viaje de ida y vuelta exacto del texto decimal.

### D8. Texto sin fórmulas

- Todo texto se escribe como celda de cadena, nunca como fórmula, con su valor intacto. El texto escrito por un usuario lleva además el estilo `quotePrefix`, para que editar la celda no lo convierta en fórmula.
- Pruebas con valores que comienzan con `=`, `+`, `-`, `@`, tabulador y retorno de carro, incluido `=HYPERLINK(...)`: cada celda es de cadena, con su valor exacto, y el libro no tiene ninguna fórmula.
- No se "sanea" el dato guardado ni se altera el valor visible.

### D9. Escritor XLSX: spike y ADR 0023

- **Primera tarea técnica**, antes de construir sobre él: un spike corto que compare:
  - **A:** un escritor OOXML mínimo propio, solo con el subconjunto que necesitan estos cinco reportes, sobre una biblioteca de ZIP con streaming;
  - **B:** una biblioteca XLSX con escritura por streaming.
- **Criterios:** streaming real y memoria acotada con el máximo de filas; tipos de celda exactos de cadena y numérico; `quotePrefix` y ausencia de fórmulas; fechas; estilos mínimos; bytes deterministas para pruebas con un momento fijo; licencia, mantenimiento y tamaño del paquete; lectura de los libros en las pruebas.
- Se elige la opción más pequeña y mantenible que cumpla todo, y se registra en `docs/architecture/adr/0023-...md` con la evidencia del spike. El cambio 16 puede reutilizar el escritor.
- Si la opción elegida es propia, su alcance es solo ese subconjunto: no es un motor de hojas de cálculo.
- **Resultado (2026-10-08, ADR 0023):** la opción A, con la capa ZIP evaluada de dos formas.
  - Se elige el escritor OOXML propio sobre `node:zlib`: el deflate nativo por streaming, fuera del hilo principal, con un contenedor ZIP mínimo propio sin ZIP64.
  - El ZIP de fflate también cumplía, pero comprime en el hilo de la API con el doble de CPU.
  - exceljs (B) se descarta: su memoria crece con las filas y altera textos con caracteres de control.
  - Las pruebas descomprimen el libro con fflate, solo de desarrollo.

### D10. Ejecución de la exportación

- **Síncrona y en dos fases**, sin job, artefacto durable, TTL ni URL firmada:
  1. **Generación:** el servidor cuenta las filas y genera el libro en un archivo temporal privado (`0600`, en el directorio temporal del sistema), leyendo por lotes con cursor y escribiendo en streaming, con memoria acotada.
  2. **Entrega:** después de generar y de registrar la auditoría (D13), envía el archivo por la misma respuesta HTTP y lo borra al terminar, al fallar o cuando el cliente se desconecta.
- Separar las dos fases evita que un cliente lento mantenga abierta la lectura de la base. El archivo temporal nunca se expone por una ruta propia, nunca aparece en los registros ni en la auditoría, y se borra siempre.
- **Lectura consistente:** el conteo y los lotes de la generación corren en una transacción de solo lectura `REPEATABLE READ`, de modo que el libro corresponde a un único momento. El benchmark mide su duración con el máximo de filas. Si resulta excesiva, el design se corrige con `/opsx:update` con una estrategia equivalente, como un corte por momento de creación más el identificador, sin sacrificar "los mismos registros".
- **Respuesta:** `200` con `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment`, `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.

### D11. Defensa de recursos

| Variable | Valor inicial del benchmark | Significado |
| --- | --- | --- |
| `REPORT_EXPORT_MAX_ROWS` | 100 000 (el volumen de Q-26), con un rango a fijar con el benchmark | Filas por exportación |
| `REPORT_EXPORT_MAX_CONCURRENT` | 2, con un rango a fijar con el benchmark | Exportaciones simultáneas por instancia |

- Son defensas de recursos del proyecto, nunca límites del ERS. Los valores de la tabla son hipótesis de partida: `bench:reports` fija los valores por defecto y los rangos antes del archive, o los corrige con `/opsx:update` y su evidencia.
- **Más filas que el máximo:** el conteo previo lo detecta antes de generar y responde `409 REPORT_EXPORT_ROW_LIMIT`, con el máximo y el conteo, pidiendo acotar los filtros. Nunca se genera ni se entrega un archivo truncado.
- **Concurrencia llena:** un semáforo por instancia; una exportación de más responde `503 REPORT_EXPORT_BUSY` con `Retry-After`, sin esperar ni afectar a las que están en curso. La lista paginada no tiene estos límites.

### D12. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/reports/{report}` | Lista paginada con sus filtros, su ambiente efectivo y `meta.total` | `reports.read` |
| `GET /api/v1/reports/{report}/export` | XLSX con los mismos filtros | `reports.export` |

- `{report}` es `issued-documents`, `invoices`, `withholdings`, `inventory-balances`, `inventory-movements` o `parties`. Las filas de cada vista, sus filtros y sus errores van en `packages/contracts`, con su OpenAPI; la exportación se documenta como respuesta binaria.
- Los importes de la vista JSON son texto decimal, como en el resto de la API.

### D13. Auditoría `report.exported`

- Se registra cuando la generación terminó bien y antes de entregar, en su propia escritura, porque la exportación no cambia datos. Lleva el actor, la empresa, el reporte, el número de filas, los filtros no sensibles efectivos (`from`, `to`, `documentType`, `state`, `environment`, `establishmentId`, `emissionPointId`, `fiscalPeriod`, `productId`, `movementType`, `role`, `status`) y, para cada filtro con un dato personal (`customerIdentification`, `supplierIdentification`, `identification`), solo que estuvo presente.
- Nunca lleva filas, celdas, el archivo, rutas temporales, XML, RIDE, nombres, correos ni teléfonos.
- Si la auditoría no se puede escribir, la exportación falla y no se entrega el archivo: toda exportación entregada queda auditada. Una exportación rechazada o fallida no registra `report.exported`; los errores siguen el registro técnico general.
- El evento afirma que el servidor generó el archivo, no que el usuario lo recibió, lo abrió o lo guardó.

### D14. Permisos

- `reports.read` (ver los reportes) y `reports.export` (exportarlos), para el administrador y el operador, según la fila "Ver reportes y exportar XLSX" de `docs/security/access-control.md`, que este cambio confirma. La matriz va en `access-policy.ts`, en su espejo del frontend y en `access-control.md`.
- Ambos roles ya leen los comprobantes, el inventario y los terceros; el reporte no amplía lo que cada rol puede ver.

### D15. Operaciones sensibles (`docs/architecture/backend.md`)

| Pregunta | Respuesta |
| --- | --- |
| ¿Quién? | Administrador y operador (D14) |
| Empresa del llamador y del recurso | Sale de la sesión; cada fuente filtra por ella en cada consulta, y el ambiente vigente se lee de su configuración |
| Validación de la propiedad | No hay identificadores de recursos ajenos: los filtros por establecimiento, punto o producto se aplican con la empresa de la sesión, y un identificador de otra empresa simplemente no coincide |
| ¿Cambiar un identificador alcanza datos ajenos? | No: ninguna consulta omite la empresa; los esquemas estrictos rechazan `companyId` |
| ¿Dos veces? | Dos archivos y dos eventos de auditoría: exportar no cambia datos y no necesita idempotencia |
| ¿A la vez? | Las acota el semáforo (D11); las lecturas son de solo lectura |
| Restricciones de la base | Ninguna nueva; las tablas leídas ya son inmutables o de solo agregado donde corresponde |
| Auditoría | `report.exported` (D13) |
| Pruebas de autorización | Sin permiso `403`, sin sesión `401`, otra empresa sin filas, `companyId` rechazado y ambiente de la sesión |
| Fugas | Ninguna URL predecible ni archivo durable; el temporal se borra; nombres de archivo sin datos personales; `no-store` |

### D16. Pantalla Reportes

- **Brief** (`docs/architecture/cognitive-architecture.md`):
  - usuario: administrador u operador;
  - objetivo: revisar y entregar un listado de un período;
  - decisión: qué registros entregar y con qué filtros;
  - información mínima: el reporte, los filtros efectivos con el ambiente, el número de registros y las filas;
  - acción principal: "Exportar XLSX".
  - P0: el reporte, los filtros, el número de registros y "Exportar XLSX"; P1: la tabla; P2: los filtros secundarios y el aviso de RF-505; P3 (identificadores internos): no se muestran.
- **Ruta y navegación:** `/reportes`, en el grupo Operación, con `reports.read`.
- **Componentes:** un `Select` o `SegmentedControl` para el reporte, y otro para la vista del inventario; `DatePickerField` con el atajo mensual; `ChipGroup` para los estados; `AppDataTable` paginada con tarjetas por debajo de 768 px; `NoticeStrip` para el aviso de RF-505.
- **Exportación:** "Exportar XLSX" descarga con `apiFetchFile` y los mismos filtros de la URL. Muestra el progreso mientras se genera y explica el `409` del máximo de filas (acotar los filtros) y el `503` de la concurrencia (intentar después).
- **Estados:** carga, vacío, sin coincidencias, error con reintento y sin permiso; escritorio, 375 y 320 px, temas claro y oscuro y teclado. Sin dashboard, gráficos ni indicadores.

### D17. Observabilidad

- `report_exports_total` por reporte y resultado (`generated`, `row_limit`, `busy`, `failed`), `report_export_duration_seconds` por reporte y `report_export_rows` como histograma, sin etiquetas con datos personales ni de empresa.
- Los registros de la exportación llevan el reporte, el número de filas y la duración, nunca los filtros con datos personales ni la ruta temporal.

### D18. Rendimiento

- **`bench:reports`**, fuera de `verify`, sobre un esquema aislado con el volumen de Q-26:
  - **Siembra:** 100 000 comprobantes de los seis tipos en los dos ambientes, con sus snapshots reales por tipo y las líneas de retención; 10 000 terceros; 10 000 productos; un libro de inventario de cientos de miles de movimientos. Después, `VACUUM (ANALYZE)` y un `CHECKPOINT`.
  - **Medición:**
    - el P95 de cada lista (primera página, mes, año completo, filtro por identificación) y de su conteo;
    - la exportación mensual y la del máximo de filas, con tiempo, memoria residente máxima, CPU, tamaño del archivo y duración de la transacción `REPEATABLE READ`;
    - 10 exportaciones simultáneas: tiempo de reloj, memoria máxima, CPU e impacto en la base (conexiones y duración de las transacciones);
    - el rechazo por el máximo de filas.
- **Objetivos:** ERS RNF-005 (P95 menor que 2 s) en las listas. La exportación se mide y fija `REPORT_EXPORT_MAX_ROWS` y `REPORT_EXPORT_MAX_CONCURRENT`; si la exportación síncrona no es sana con esos valores, el design se corrige con `/opsx:update`.
- **Índices:** solo los que el benchmark justifique, por ejemplo por empresa, ambiente y fecha de emisión, o por empresa y momento del movimiento, en una migración de solo índices.

### D19. Migraciones

- Sin tablas nuevas ni `report_export`. Si el benchmark lo pide, una migración solo de índices, documentada en `database.md`.
- La acción `report.exported` se añade al dominio de la auditoría; no hay `CHECK` de acciones en la base.

### D20. Frontera con el cambio 16

- Este cambio exporta los cinco listados filtrados en XLSX. No exporta XML, RIDE, artefactos, ZIP ni todos los datos de la empresa, y no ofrece una exportación sin filtros como copia del tenant: eso es `add-data-portability` (SEC-010, AC-10, Q-28), solo para el administrador.
- El escritor XLSX de D9 vive en `reports/infrastructure`, con una interfaz que el cambio 16 puede reutilizar sin depender de los reportes.

## Risks / Trade-offs

- [Proyección de importes desde el snapshot lenta con 100 000 filas] → `bench:reports` lo mide; el recurso es la alternativa de D5 (columnas congeladas), con su propia decisión.
- [Transacción `REPEATABLE READ` larga en el máximo de filas] → el máximo de filas acota su duración, el benchmark la mide y D10 prevé la estrategia alternativa.
- [Disco temporal lleno por exportaciones simultáneas] → el máximo de filas por la concurrencia acota el tamaño; el archivo se borra siempre, y un error de escritura falla la exportación sin entregar nada.
- [Excel muestra con otra configuración regional] → el valor es exacto y el formato es solo presentación; las pruebas leen el valor, no la presentación.
- [Valores con más de 15 dígitos significativos quedan como texto] → es deliberado: exactitud antes que conveniencia; la hoja "Filtros" lo explica.
- [Q-16: un comprobante anulado en el SRI figura como autorizado] → limitación conocida, fuera de este cambio.
- [El ambiente cambia entre la lista y la exportación] → la pantalla conserva el ambiente efectivo en la URL y la exportación lo usa explícitamente.

## Migration Plan

Sin migración de datos. Si el benchmark pide índices, una migración solo de índices, reversible con
su eliminación. La acción de auditoría y los permisos son aditivos. Reversión: retirar las rutas, la
pantalla y los permisos; los eventos `report.exported` ya registrados permanecen, como toda la
auditoría.
