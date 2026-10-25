# Proposal

## Why

Desde `reorganize-main-navigation`, la pantalla de terceros se llama «Clientes y proveedores» en
toda la aplicación, pero el reporte seguía llamándose «Terceros». El propietario pidió
(2026-10-25) el mismo nombre en Reportes.

## What Changes

- El reporte «Terceros» pasa a llamarse **«Clientes y proveedores»** en el selector de Reportes, el
  título de su tabla, el libro XLSX exportado y la documentación de la API. La dirección
  (`GET /api/v1/reports/parties`), el identificador (`parties`), sus columnas y sus filtros no
  cambian.
- La hoja «Terceros» del paquete de portabilidad no cambia: es parte del formato versionado
  `PORTABILITY_FORMAT_V1`.

## Capabilities

### Modified Capabilities

- `reports`: «Reportes de la empresa» y el reporte de terceros, que pasa a llamarse «Reporte de
  clientes y proveedores».

## Impact

- `packages/contracts/src/reports.ts` (`REPORT_LABELS.parties`) y el OpenAPI generado; las pruebas
  de contratos y de la pantalla de Reportes; la documentación de reportes y de seguridad.
