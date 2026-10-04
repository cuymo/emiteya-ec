# Benchmark del RIDE con la implementación real (2026-10-04)

Generado por `bench:ride` (`backend/scripts/bench-ride.ts`; design D15 de `add-document-archive`).
Datos en `ride-render-2026-10-04.json` (host) y `ride-render-2026-10-04-container.json`
(contenedor). Objetivo: P95 del render menor que 1 s por documento en este entorno, sin la espera
de cola. No es una promesa universal de hardware. Reproduce el spike S-4 con el código del producto,
sin nada de la rama `spike/s4-ride-pdf`.

## Método

- 60 facturas distintas, construidas con el builder real, validadas contra el XSD registrado y firmadas con la firma sintética, guardadas como comprobantes `AUTHORIZED` en un esquema aislado de la base de pruebas.
- Cada RIDE lo genera el código real:
  - el runner del RIDE con 2 lazos;
  - el handler `document.render_ride`, que elige y verifica la fuente;
  - el lector y el renderer en `RideWorkerPool` con 2 workers (`RIDE_WORKERS` por defecto);
  - la transacción que guarda el `RIDE_PDF` y completa el job.
- 10 de calentamiento, medidos aparte. 50 medidas, encoladas de una vez: 38 de una página (1 a 5 líneas) y 12 de varias (40, 80 y 120 líneas, hasta 4 páginas). Una de cada cuatro usa el emisor RIMPE y los textos largos con tildes y eñes.
- Medidas:
  - **render:** la duración en su worker, sin la espera;
  - **espera de cola:** del momento en que el job debía correr al inicio del render. Con 50 jobs encolados de una vez y 2 workers, crece con la posición en la cola: mide un pico, no una latencia normal;
  - **job:** el handler completo, con la lectura, el render y la persistencia;
  - **event loop:** el retraso máximo del hilo principal durante la medición.
- El contenedor es `node:24.21.0-slim`, la misma versión de Node que la API, sin fuentes del sistema (`/usr/share/fonts` vacío, sin `fc-list`) ni OpenSSL, con el repositorio montado. Los P12 sintéticos se generan en el host.

## Entorno

| Clave | Valor |
| --- | --- |
| node | v24.21.0 |
| os | Linux 7.1.6-1-cachyos |
| cpu | AMD Ryzen 5 3600 6-Core Processor (12 hilos) |
| memory | 16 GiB |
| postgres | PostgreSQL 17 (compose del proyecto) |
| pdfmake / pdfkit / bwip-js / fontkit | 0.3.11 / 0.19.1 / 4.11.4 / 2.0.4 |
| renderer / fuentes | `rendererVersion` 1 / Noto Sans 2.015 |

## Resultados

| Medida (ms) | Host P50 / P95 / máx. | Contenedor P50 / P95 / máx. |
| --- | --- | --- |
| Render | 93.2 / 173.2 / 183.2 | 93.2 / 178.2 / 187.2 |
| Render, una página | 89.8 / 101.1 / 106.2 | 90.9 / 109.2 / 109.3 |
| Render, varias páginas | 141.1 / 183.2 / 183.2 | 146.3 / 187.2 / 187.2 |
| Job completo | 102.2 / 186.8 / 192.7 | 102.8 / 188.6 / 199.4 |
| Espera de cola (50 de una vez) | 1353 / 2636 / 2726 | 1376 / 2709 / 2815 |

- **Rendimiento:** 16.6 RIDE por segundo en el host y 16.3 en el contenedor, con 2 workers.
- **Event loop:** retraso máximo de 9.5 ms (host) y 7.5 ms (contenedor) mientras se dibujaban los 50 RIDE. En el hilo, cada render lo bloqueaba entre 100 y 220 ms (S-4).
- **Memoria,** tras una recolección antes y después de la medición:
  - el heap del hilo principal queda estable: de 62.6 a 62.3 MiB en el host y de 52.1 a 45.2 MiB en el contenedor;
  - el RSS del proceso, que incluye los dos workers, sube de 775 a 953 MiB en el host y de 688 a 901 MiB en el contenedor, y se queda en ese máximo: es memoria de los workers que el asignador retiene, como ya observó S-4;
  - el proceso del benchmark guarda además las 60 facturas firmadas, el cliente de Prisma y el validador XSD. Esta ejecución mide una serie, no una prueba de fugas de larga duración.
- **Tamaño del PDF:** 24.4 KB de mediana, 49.2 KB de P95 y 52.5 KB como máximo.
- **Determinismo entre entornos:** los 50 PDF del host y del contenedor son idénticos byte a byte (mismo SHA-256 para cada factura).

## Comparación con S-4

| Criterio de S-4 | Prototipo (S-4) | Implementación real |
| --- | --- | --- |
| P95 por documento | 200.3 ms (host), 191.7 ms (contenedor) | 173.2 ms (host), 178.2 ms (contenedor), solo el render |
| Máximo | 224 ms y 211.8 ms | 183.2 ms y 187.2 ms |
| Fuera del hilo HTTP | Pool de prueba en el benchmark | `RideWorkerPool` en producción; retraso del event loop de 7–10 ms; prueba de arquitectura de los imports |
| Code128 legible | zxing a 300 ppp y zbar a 150, 200 y 300 ppp | Las mismas lecturas con el renderer real (`ride-barcode.test.ts`) y en la prueba end-to-end sobre `main.ts` |
| Sin fuentes del sistema | Contenedor sin fuentes | El mismo contenedor; el render no lee ningún archivo (prueba con espías de `fs` y de red) |
| Determinismo | Mismos bytes en otro proceso y en el contenedor | Mismos bytes en otro proceso (prueba) y en los 50 PDF del host y del contenedor |
| Memoria | Heap estable tras cada serie; RSS retenido por el asignador | Heap del hilo principal estable; RSS con los workers retenido en su máximo (una serie medida) |

## Lectura

- El objetivo se cumple con margen: P95 del render de unos 175–180 ms, frente a 1 s.
- El render del producto es algo más rápido que el del prototipo: cada worker carga pdfmake y las fuentes una sola vez, y el lector valida solo la factura que el sistema emite.
- La espera de cola de un lote es la única cifra que crece: con 2 workers, un pico de 50 autorizaciones tarda unos 3 s en quedar con su RIDE. Es el compromiso aceptado en design D6 (menos memoria que 4 workers); `RIDE_WORKERS` lo ajusta.
