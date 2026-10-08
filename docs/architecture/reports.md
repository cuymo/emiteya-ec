# Reportes

Los cinco reportes del ERS (§11, RF-501 a RF-505) como listados filtrables y su exportación a XLSX
con los mismos registros (AC-09). Cambio `add-reports-export`; decisiones en su design, en el ADR 0023
y en "Trazabilidad de `reports`" de `../product/capabilities.md` (BR-57 a BR-62 de
`../product/domain-model.md`).

## Módulo `reports`

- **`domain/`:**
  - `definitions.ts`: la definición de cada reporte, con su etiqueta, si tiene ambiente, sus columnas con el tipo de celda y el inicio del nombre del archivo;
  - `export.ts`: el nombre del archivo, las filas de la hoja "Filtros" y los datos del evento de auditoría.
- **`application/`:**
  - `reports.ts`: la lista y la exportación, con el ambiente efectivo, el semáforo, el conteo, el máximo de filas y la auditoría;
  - `ports.ts`: las fuentes, la base, el escritor, los temporales y las métricas.
- **`infrastructure/`:**
  - el router;
  - la transacción de solo lectura;
  - los temporales;
  - las métricas;
  - el escritor XLSX (`xlsx/`, ADR 0023).
- **Dirección.** `reports` no lee tablas. Cada módulo dueño exporta la fuente de su reporte y `main.ts` la compone como puerto (`backend.md`, "Reportes"). Nadie importa `reports`, y `reports` solo importa `identity` y `audit`. Lo comprueba `backend/test/architecture/reports-dependency-direction.test.ts`.
- **Una definición por reporte.** La lista y la exportación usan:
  - los mismos filtros de `packages/contracts/src/reports.ts`;
  - la misma fuente, una sola consulta ordenada con su orden total;
  - la misma definición.

  Solo difieren en cómo recorren la consulta: la lista por páginas (`LIMIT` y `OFFSET`) y la exportación por lotes de 1000 con un cursor de PostgreSQL.

## Rutas

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/reports/issued-documents` | Documentos emitidos | `reports.read` |
| `GET /api/v1/reports/invoices` | Facturas | `reports.read` |
| `GET /api/v1/reports/withholdings` | Retenciones, una fila por línea | `reports.read` |
| `GET /api/v1/reports/inventory-balances` | Existencias | `reports.read` |
| `GET /api/v1/reports/inventory-movements` | Movimientos | `reports.read` |
| `GET /api/v1/reports/parties` | Terceros | `reports.read` |
| `GET /api/v1/reports/{reporte}/export` | El XLSX del mismo reporte con los mismos filtros, sin página | `reports.export` |

- **Respuesta de la lista:** `{ data, meta: { page, pageSize, total, environment } }`. `environment` es el ambiente efectivo, o `null` en el inventario y los terceros.
- **Filtros.** Los esquemas son estrictos: un filtro de otro reporte, un `companyId`, una página en la exportación o un rango invertido responden `400 VALIDATION_ERROR`. La empresa sale siempre de la sesión.
- **Valores por defecto:**
  - **Estado:** todos en Documentos emitidos (desde la reserva, nunca borradores), y autorizados en Facturas y Retenciones.
  - **Tercero:** solo activos.
  - **Ambiente:** el vigente de la empresa, leído en cada solicitud. `ALL` (los dos) solo por elección explícita.
- **Fechas:** las de los comprobantes son la fecha de emisión; las de Movimientos, el día en Ecuador (`America/Guayaquil`); el período fiscal de Retenciones, `AAAA-MM`.
- **Existencias** lista todo producto con inventario inicializado (con `stock_balance`), aunque después se haya desactivado su control, con el saldo registrado tal cual, también negativo. Un producto sin inventario no aparece.

## Exportación

En este orden, sin job, artefacto durable, TTL ni URL firmada:

1. **Semáforo de la instancia** (`REPORT_EXPORT_MAX_CONCURRENT`), sin cola. Sin lugar, responde `503 REPORT_EXPORT_BUSY` con `Retry-After: 15`, sin afectar a las exportaciones en curso. El lugar se libera al terminar la generación y la auditoría; la entrega no lo ocupa.
2. **Transacción `REPEATABLE READ` de solo lectura:**
   - el ambiente efectivo y el conteo;
   - si el conteo supera `REPORT_EXPORT_MAX_ROWS`, `409 REPORT_EXPORT_ROW_LIMIT` con el conteo y el máximo, antes de crear ningún archivo;
   - el XLSX, escrito por lotes desde el cursor a un temporal. Si las filas escritas no son las contadas, la exportación falla.

   Todo corresponde a un único momento de la base. El plazo de la transacción es de 5 minutos, y el máximo de filas acota su duración real (`bench:reports`).
3. **Auditoría** `report.exported`, en su propia escritura y después de confirmar la lectura. Si no se puede escribir, la exportación responde `500` y no entrega nada.
4. **Entrega** por la misma respuesta, con estas cabeceras:
   - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
   - `Content-Disposition: attachment; filename="<reporte>-<desde>-<hasta>.xlsx"`, en ASCII y sin datos personales, o con la fecha de generación en Ecuador si falta el rango;
   - `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.

   `HEAD` responde `405`: nunca genera ni audita un archivo que no se entrega.

**Temporal:**

- Es un directorio propio con modo `0700` en el directorio temporal del sistema, con un archivo de nombre aleatorio que el escritor crea con modo `0600` (`wx`).
- Nunca se expone por una ruta ni aparece en los logs ni en la auditoría.
- Se borra al terminar la entrega, al fallar la generación o la auditoría, y cuando el cliente se desconecta.
- **Si el cliente se va mientras se genera,** la generación se detiene en el siguiente lote: no audita ni entrega nada.
- **Si se va durante la entrega,** el evento ya registró que el archivo se generó y se autorizó para entregarse, no que llegó.

**Defensas de recursos** (`deployment.md`): `REPORT_EXPORT_MAX_ROWS` (100 000 por defecto, de 1 a 250 000) y `REPORT_EXPORT_MAX_CONCURRENT` (2 por defecto, de 1 a 4), fijados por `bench:reports` del 2026-10-08; nunca límites del ERS. La lista no tiene esos límites.

## Formato del XLSX

- **Hojas:** una hoja de datos con el nombre del reporte, con la fila de encabezados fija y un ancho por columna, y la hoja "Filtros":
  - el reporte;
  - el momento de generación en Ecuador;
  - los filtros efectivos con el ambiente (los códigos del establecimiento y del punto, y el nombre del producto);
  - las filas;
  - el aviso de RF-505;
  - la nota de precisión.
- **Sin** totales, fórmulas, tablas dinámicas ni hojas ocultas.

| Reporte | Columnas |
| --- | --- |
| Documentos emitidos | Fecha, Tipo, Número, Identificación, Tercero, Subtotal, Impuestos, Total, Estado, Ambiente |
| Facturas | Fecha, Número, Identificación, Cliente, Subtotal, IVA, Otros impuestos, Total, Estado, Ambiente |
| Retenciones | Fecha, Número, Identificación, Sujeto retenido, Período fiscal, Impuesto, Código, Base, Porcentaje, Valor retenido, Estado, Ambiente |
| Existencias | Código, Producto, Saldo |
| Movimientos | Fecha y hora, Código, Producto, Tipo, Cantidad, Saldo resultante, Comprobante |
| Terceros | Identificación, Razón social, Correo, Teléfono, Roles, Estado |

**Importes por tipo:**

- La retención solo tiene su total retenido, y la guía de remisión ninguno: sus celdas quedan vacías, nunca un 0.00.
- La guía con un solo destinatario muestra su identificación y su nombre; con varios, "N destinatarios" sin identificación.
- Las notas de crédito y de débito tienen sus propios importes, sin compensarse con la factura.

## Política de precisión

- Un importe, una cantidad o un porcentaje llega como texto decimal canónico y nunca pasa por `number`.
- **Hasta 15 dígitos significativos:** va como celda numérica, con su texto en el XML, y cualquier lector que lo pase a double vuelve al mismo decimal.
- **Con más, o con más de 6 decimales:** va como texto exacto alineado a la derecha. En el dominio solo pasan de 15 la cantidad (18 dígitos) y la existencia (30).
- **Formatos:** importes con `#,##0.00`; cantidades y porcentajes con los decimales de su valor (`#,##0` a `#,##0.000000`).
- **Fechas:** de emisión con `dd/mm/yyyy`, como serial calculado sin zona horaria. Los momentos de Movimientos van en la hora de Ecuador con sus milisegundos y `dd/mm/yyyy hh:mm:ss`. Nada depende de la zona ni de la configuración regional del proceso.

## Defensa contra fórmulas

- Todo texto se escribe como celda de cadena (`inlineStr`) con el estilo `quotePrefix` y el formato `@`; ningún camino del escritor produce `<f>`.
- Un texto que empieza con `=`, `+`, `-`, `@`, tabulador o retorno de carro queda intacto.
- Los caracteres que XML no admite y el retorno de carro se codifican como ST_Xstring (`_xHHHH_`), y un `_xHHHH_` literal se protege con `_x005F_`. Nada se sanea ni se descarta.

## Auditoría y observabilidad

- **Evento `report.exported`:**
  - lleva el actor, el reporte, las filas y los filtros sin datos personales (`from`, `to`, `documentType`, `state`, `environment`, `establishmentId`, `emissionPointId`, `fiscalPeriod`, `productId`, `movementType`, `role`, `status`);
  - de `customerIdentification`, `supplierIdentification` e `identification` solo registra que estuvieron presentes (`…Present: true`);
  - nunca lleva filas, celdas, el archivo, la ruta temporal, XML ni RIDE.
- **Sin evento:** consultar un reporte, ni una exportación rechazada (`400`, `401`, `403`, `409`, `503`) o fallida. Dos exportaciones son dos eventos.
- **Métricas:** `report_exports_total{report,result}`, `report_export_duration_seconds{report}` y `report_export_rows` (`../quality/observability.md`).
- **Log:** el de la exportación lleva el reporte, las filas y la duración, nunca los filtros ni la ruta temporal.

## Pantalla Reportes

- **Ruta y permisos:** `/reportes`, en el grupo "Operación" de la navegación, con `reports.read`. "Exportar XLSX" solo aparece con `reports.export`. Sin el permiso, o ante un `403`, la pantalla lo explica sin listar nada.
- **Elegir el reporte:**
  - el selector "Reporte" con los cinco reportes;
  - en Inventario, la vista Existencias o Movimientos.

  Cambiar de reporte o de vista limpia los filtros.
- **Filtros en la URL:** `reporte`, `vista`, `desde`, `hasta`, `tipo`, `estado`, `establecimiento`, `punto`, `ambiente` (`pruebas`, `produccion` o `todos`), `cliente`, `sujeto`, `periodo` (`AAAA-MM`), `producto`, `movimiento`, `rol`, `identificacion`, `pagina` y `filas`.
  - El atajo "Mes" solo fija `desde` y `hasta`, con el mes en curso y los once anteriores.
  - El producto se elige con un buscador, nunca escribiendo un identificador.
  - Las identificaciones se aplican 300 ms después de dejar de escribir.
  - Un rango invertido se explica en el campo y no se consulta.
- **Valores por defecto:** el estado "Todos" en Documentos emitidos, "Autorizado" en Facturas y Retenciones, y "Activos" en Terceros. Sin elegirlo, el estado no viaja y lo aplica el servidor.
- **Encabezado de la tabla:** el número de registros y, en los reportes de comprobantes, el ambiente efectivo que devuelve la lista. El aviso de RF-505 va bajo los controles.
- **Tabla:** paginada (`AppDataTable`), con tarjetas por debajo de 768 px.
  - Los importes van con `USD` y dos decimales, sin pasar por `number`.
  - La guía muestra "—" (con "Sin importe" para lectores de pantalla) y, con varios destinatarios, "N destinatarios".
  - El saldo negativo de Existencias lleva icono y texto.
  - Un texto que parece una fórmula se muestra tal cual.
- **Exportación:**
  - "Exportar XLSX" descarga con los filtros de la URL y el ambiente efectivo de la lista, de modo que el archivo y la lista coinciden aunque la empresa cambie de ambiente entre ambas.
  - Mientras se genera, el botón muestra "Generando XLSX…".
  - Un `409` (acotar los filtros) o un `503` (intentar en unos segundos) se explica junto al botón hasta que cambian el reporte o los filtros.
- **Estados:** carga, vacío, sin coincidencias con "Limpiar filtros", error con "Intentar de nuevo" y sin permiso (`frontend/test/reports-screen.test.tsx`).

## Pruebas

- **Escritor XLSX:** `backend/test/reports/xlsx-writer.test.ts`.
- **Dominio:** `backend/test/reports/definitions.test.ts`.
- **Fuentes de cada módulo dueño:** `backend/test/integration/report-sources-*.test.ts`.
- **Lista por HTTP:** `backend/test/integration/report-list-api.test.ts`.
- **Exportación por HTTP, con AC-09 en cada reporte:** `backend/test/integration/report-exports-api.test.ts`.
- **End-to-end sobre `main.ts`:** `backend/test/integration/e2e-reports.test.ts`.
- **Rendimiento:** `bench:reports` (`../quality/benchmarks/reports-2026-10-08.md`).
- **Pantalla:** `frontend/test/reports-screen.test.tsx`, y la entrada de la navegación en `frontend/test/app-shell.test.tsx`.
