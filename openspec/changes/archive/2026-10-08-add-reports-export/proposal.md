# Proposal

## Why

El administrador y el operador necesitan consultar y entregar fuera del sistema listados de lo que la
empresa emitió, de sus retenciones, de su inventario y de sus terceros: para revisar un mes, cuadrar
con su contador o responder a una consulta. Hoy solo tienen la bandeja, paginada y sin exportación,
y el kárdex de un producto a la vez. El ERS pide cinco reportes filtrables exportables a XLSX (§11,
RF-501 a RF-505) y su criterio de aceptación AC-09: "Filtro mensual exporta XLSX con los mismos
registros visibles". Es el cambio 15 de `capabilities.md`; la revisión de readiness del 2026-10-08
cerró su alcance y sus decisiones (Trazabilidad de `reports` en `capabilities.md`; BR-57 a BR-62).

## What Changes

- **Cinco reportes, todos listados** (ERS §11), cada uno con su pantalla y su exportación a XLSX:
  - **Documentos emitidos:** los seis tipos de comprobante, con fecha, tipo, número, identificación, tercero, subtotal, impuestos, total, estado y ambiente. Por defecto, todos los estados desde que el comprobante reserva su número; nunca borradores. Las notas de crédito y de débito, las guías y las liquidaciones de compra aparecen aquí como filas, con sus propios importes.
  - **Facturas:** solo facturas, con fecha, número, cliente, subtotal, IVA, otros impuestos, total, estado y ambiente. Por defecto, solo las autorizadas.
  - **Retenciones:** una fila por línea de retención, con fecha, número, proveedor, período fiscal, impuesto, código, base, porcentaje, valor, estado y ambiente. Por defecto, solo las autorizadas.
  - **Inventario**, en dos vistas: **Existencias** (código, producto y saldo de los productos con inventario inicializado) y **Movimientos** (el kárdex de toda la empresa, por producto, fechas y tipo de movimiento).
  - **Terceros:** identificación, razón social, correo, teléfono, roles y estado.
- **Filtros mínimos del ERS**, en la URL: el rango de fechas, con un atajo mensual que solo fija ese rango; el tipo y el estado del comprobante; el establecimiento y el punto; el cliente o el proveedor por su identificación; el período fiscal de la retención; el producto y el tipo de movimiento; el rol, la identificación y el estado del tercero. Nada más.
- **Ambiente:** los reportes de comprobantes tienen columna y filtro de ambiente. Por defecto muestran el ambiente vigente de la empresa, derivado en el servidor; Pruebas, Producción o los dos solo por elección explícita. Pruebas y Producción nunca se mezclan en silencio.
- **Exportación XLSX que respeta los filtros:** el mismo reporte con los mismos filtros exporta exactamente los registros de su lista completa, en el mismo orden, y no solo la página visible. Las identificaciones, las claves y los números van como texto; los importes, como números con formato monetario, salvo que excedan la precisión segura de la hoja, en cuyo caso van como texto exacto; el texto escrito por un usuario nunca se convierte en fórmula.
- **Defensa de recursos:** un tope configurable de filas por exportación y de exportaciones simultáneas, con valores que fija el benchmark. Superar el tope de filas pide acotar los filtros; nunca entrega un archivo truncado.
- **Auditoría:** cada exportación que el servidor termina de generar queda auditada con quién, qué reporte, cuándo, cuántas filas y los filtros no sensibles; de un filtro con un dato personal solo consta que estuvo presente.
- **Pantalla Reportes:** el selector de los cinco reportes, los filtros, la tabla paginada y "Exportar XLSX", con el aviso de que los reportes no reemplazan obligaciones contables ni anexos tributarios (RF-505).
- **Permisos:** ver los reportes y exportarlos, para el administrador y el operador. La empresa sale siempre de la sesión.

**Fuera de alcance:**

- Dashboards, gráficos, indicadores, ventas netas, impuestos agregados, totales o subtotales, y cualquier compensación entre una factura y sus notas.
- Contabilidad, ATS, declaraciones, anexos, compras y cartera (ERS §2.3, §21).
- Reportes propios para notas, guías, liquidaciones o estados del SRI: aparecen en Documentos emitidos.
- CSV, PDF, JSON exportado o ZIP como formatos de exportación.
- La portabilidad completa del contribuyente: XML, RIDE, artefactos, ZIP y todos los datos son del cambio 16 (`add-data-portability`, Q-28).
- Exportaciones programadas, enviadas por correo, guardadas como artefacto o descargadas con un enlace firmado.
- La observación de anulaciones (Q-16): un comprobante anulado en el SRI sigue figurando como autorizado.

## Capabilities

### New Capabilities

- `reports`: los cinco reportes del ERS como listados filtrables, su exportación a XLSX con los mismos registros de la lista, el ambiente, los estados por defecto, la fuente histórica de cada dato, los límites de recursos de la exportación, los permisos y el aislamiento por empresa.

### Modified Capabilities

- `audit-trail`: se audita cada exportación de un reporte que el servidor termina de generar, sin datos personales ni contenido del archivo.

## Impact

- **Backend:** un módulo nuevo `reports` que lee los comprobantes, las retenciones, el inventario y los terceros a través de lecturas propias o de puertos de los módulos dueños, sin escribir en ellos; rutas `GET /api/v1/reports/...` con su lista paginada y su exportación; dos variables de entorno de defensa de recursos.
- **Contratos:** los filtros, las vistas y los errores de los reportes en `packages/contracts`, con su OpenAPI.
- **Dependencias:** la escritura de XLSX necesita una biblioteca o un escritor propio sobre una biblioteca de ZIP; la elige un spike con su ADR, primera tarea del cambio.
- **Frontend:** la pantalla Reportes y su entrada en la navegación.
- **Auditoría:** la acción `report.exported`.
- **Base de datos:** sin tablas nuevas; si el benchmark lo pide, solo índices de lectura.
- **Rendimiento:** `bench:reports` con el volumen de Q-26.
