# Benchmark de carga del frontend: base de diseño y shell premium (2026-10-14)

Mide lo que descarga el navegador al abrir tres pantallas representativas del build de producción,
antes y después de `adopt-premium-design-foundation-and-shell` (design D20). Next 16 con Turbopack
ya no imprime tamaños por ruta, así que la medición es propia y usa el mismo método en los dos lados:
`corepack pnpm test:visual:bundle` suma los bytes de JavaScript, CSS y fuentes que llegan hasta que
la red queda en calma, con el Chrome del sistema y la API simulada del harness visual. Datos en
`frontend-shell-2026-10-14.json`.

## Entorno

| Clave          | Valor                         |
| -------------- | ----------------------------- |
| next           | 16.3.8 (Turbopack)            |
| node           | v24.21.0                      |
| navegador      | Google Chrome 154.0.8037.57   |
| os             | Linux 7.1.6-1-cachyos         |
| commit antes   | 33037ca                       |
| commit después | pendiente                     |

## Resultados

«Transferido» es el cuerpo comprimido que llega por la red; «Decodificado», el tamaño una vez
descomprimido. Bytes.

| Pantalla | Tipo | Archivos antes | Transferido antes | Decodificado antes | Transferido después | Decodificado después |
| --- | --- | --- | --- | --- | --- | --- |
| login | js | 13 | 341169 | 1239599 | — | — |
| login | css | 1 | 7640 | 34224 | — | — |
| login | font | 0 | 0 | 0 | — | — |
| inicio | js | 15 | 357158 | 1287780 | — | — |
| inicio | css | 1 | 7640 | 34224 | — | — |
| inicio | font | 0 | 0 | 0 | — | — |
| facturas | js | 16 | 377414 | 1359450 | — | — |
| facturas | css | 1 | 7640 | 34224 | — | — |
| facturas | font | 0 | 0 | 0 | — | — |
