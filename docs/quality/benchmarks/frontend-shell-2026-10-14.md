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
| commit después | 5c887d5                       |

## Resultados

«Transferido» es el cuerpo comprimido que llega por la red; «Decodificado», el tamaño una vez
descomprimido. Bytes.

| Pantalla | Tipo | Archivos antes | Transferido antes | Decodificado antes | Archivos después | Transferido después | Decodificado después |
| --- | --- | --- | --- | --- | --- | --- | --- |
| login | js | 13 | 341169 | 1239599 | 15 | 347087 | 1256800 |
| login | css | 1 | 7640 | 34224 | 1 | 12293 | 67301 |
| login | font | 0 | 0 | 0 | 1 | 69652 | 69652 |
| inicio | js | 15 | 357158 | 1287780 | 18 | 369772 | 1332674 |
| inicio | css | 1 | 7640 | 34224 | 1 | 12293 | 67301 |
| inicio | font | 0 | 0 | 0 | 1 | 69652 | 69652 |
| facturas | js | 16 | 377414 | 1359450 | 19 | 390154 | 1404632 |
| facturas | css | 1 | 7640 | 34224 | 1 | 12293 | 67301 |
| facturas | font | 0 | 0 | 0 | 1 | 69652 | 69652 |

## Lectura

- **login:** JavaScript transferido 341169 → 347087 bytes (+1.7 %); total transferido 348809 → 429032 bytes.
- **inicio:** JavaScript transferido 357158 → 369772 bytes (+3.5 %); total transferido 364798 → 451717 bytes.
- **facturas:** JavaScript transferido 377414 → 390154 bytes (+3.4 %); total transferido 385054 → 472099 bytes.
- **Fuente:** el aumento mayor es la fuente Geist, un solo woff2 variable de 69.652 bytes servido
  desde el propio origen, que antes no existía (fuente del sistema). Se descarga una vez y queda en
  caché inmutable.
- **CSS:** crece por los tokens, las variantes y las animaciones de los primitivos derivados.
- **Paleta:** `cmdk` va en un chunk diferido que no aparece en el HTML inicial; se carga la primera
  vez que se abre la paleta.
- **Ausencias comprobadas:** ningún chunk contiene Recharts, simple-icons, FullCalendar, Vercel
  Analytics, zustand, fuentes de Google, jsDelivr ni datos de demostración de la plantilla.
