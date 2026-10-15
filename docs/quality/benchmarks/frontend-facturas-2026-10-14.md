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
| commit después | (al terminar el cambio)       |

## Resultados

«Transferido» es el cuerpo comprimido que llega por la red; «Decodificado», el tamaño una vez
descomprimido. Bytes.

| Tipo | Archivos antes | Transferido antes | Decodificado antes | Archivos después | Transferido después | Decodificado después |
| --- | --- | --- | --- | --- | --- | --- |
| js | 19 | 391085 | 1407781 | | | |
| css | 1 | 12404 | 67939 | | | |
| font | 1 | 69652 | 69652 | | | |

## Peticiones a la API al abrir `/facturas`

| Antes | Después |
| --- | --- |
| `GET /api/v1/me`, `GET /api/v1/company/status`, `GET /api/v1/signing-certificate/validity` (shell) y `GET /api/v1/invoices?page=1&pageSize=25` | |
