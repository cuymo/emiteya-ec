# Benchmark de carga del frontend: Facturas sobre la base de tabla compartida (2026-10-14)

Mide lo que descarga el navegador al abrir `/facturas` del build de producción, y las peticiones a
`/api/v1` que hace la pantalla, antes y después de `productize-invoice-list-and-shared-table-foundation`
(design D18). El método es el de `frontend-shell-2026-10-14.md`: `corepack pnpm test:visual:bundle`
suma los bytes de JavaScript, CSS y fuentes que llegan hasta que la red queda en calma, con el
Chrome del sistema y la API simulada del harness, y ahora registra además las peticiones a la API.
Datos en `frontend-facturas-2026-10-14.json`.

## Entorno

| Clave          | Valor                         |
| -------------- | ----------------------------- |
| next           | 16.3.8 (Turbopack)            |
| node           | v24.15.0                      |
| navegador      | Google Chrome 154.0.8037.57   |
| os             | Linux 7.1.6-1-cachyos         |
| commit antes   | 7672984                       |
| commit después | cb81aa0                       |

## Resultados

«Transferido» es el cuerpo comprimido que llega por la red; «Decodificado», el tamaño una vez
descomprimido. Bytes.

| Tipo | Archivos antes | Transferido antes | Decodificado antes | Archivos después | Transferido después | Decodificado después |
| --- | --- | --- | --- | --- | --- | --- |
| js | 19 | 391085 | 1407781 | 20 | 395583 | 1420820 |
| css | 1 | 12404 | 67939 | 1 | 13217 | 72133 |
| font | 1 | 69652 | 69652 | 1 | 69652 | 69652 |

## Peticiones a la API al abrir `/facturas`

| Antes | Después |
| --- | --- |
| `GET /api/v1/me`, `GET /api/v1/company/status`, `GET /api/v1/signing-certificate/validity` (shell) y `GET /api/v1/invoices?page=1&pageSize=25` | Las mismas, más `GET /api/v1/invoices?attention=true&pageSize=1` (el conteo de «Requiere atención», D7) |

## Diferencias

- **JavaScript: un archivo más, +4498 bytes transferidos (+1,2 %) y +13039 decodificados.** Es la
  base de listas que Facturas carga ahora: `DataTable` y sus piezas, `ToggleGroup`, el menú de
  opción única, `PageHeader`, `DocumentStatusBadge` y `useListUrlState`. TanStack Table ya se
  cargaba (8.21.3, sin cambio de versión) y no entra ninguna dependencia nueva: `package.json` y el
  lockfile no cambian.
- **CSS: +813 bytes transferidos (+6,6 %) y +4194 decodificados.** La hoja es una sola para toda
  la aplicación, y crece con las utilidades nuevas, sobre todo las variantes de container queries
  (`@xl:`) de las dos distribuciones de la tabla.
- **Fuente:** sin cambios.
- **Peticiones:** una más, el conteo de atención, que lee `meta.total` de una página de una fila.
  `visual/shell/facturas.spec.ts` comprueba en el navegador que no se repite al cambiar el estado,
  la vista, la búsqueda ni las filas por página, y que la lista no pide nada por fila (ni detalle,
  ni RIDE, ni estado).

