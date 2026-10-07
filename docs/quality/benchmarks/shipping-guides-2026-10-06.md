# Benchmark de las guías de remisión (2026-10-06)

Volumen: 10000 terceros (2000 con el rol CARRIER), 10000 productos, 20000 facturas AUTHORIZED de 5 líneas y 100000 guías AUTHORIZED de uno a tres destinatarios, en una empresa (volumen de Q-26). Siembra por SQL en 212.6 s, seguida de `VACUUM (ANALYZE)` y un `CHECKPOINT` para que las escrituras diferidas de la carga masiva no caigan sobre las mediciones. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con 20 muestras; la contención son 10 rondas de 10 emisiones simultáneas. El RIDE se mide en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D28 de `add-shipping-guides`). Las respuestas del SRI no participan. Generado por `bench:shipping-guides`; datos en `shipping-guides-2026-10-06.json`.

## Entorno

| Clave | Valor |
| --- | --- |
| postgres | PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit |
| shared_buffers | 128MB |
| work_mem | 4MB |
| effective_cache_size | 4GB |
| jit | on |
| node | v24.15.0 |
| os | Linux 7.1.6-1-cachyos |
| cpu | AMD Ryzen 5 3600 6-Core Processor (12 núcleos) |
| memory | 16 GiB |
| commit | 051e501 |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `party` | 10052 | 8928 kB |
| `product` | 10000 | 9104 kB |
| `electronic_document` | 120002 | 373 MB |
| `electronic_document_recipient` | 200002 | 54 MB |
| `shipping_guide` | 100001 | 33 MB |
| `shipping_guide_recipient` | 200002 | 61 MB |
| `shipping_guide_draft` | 1 | 96 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Transportistas: primera página, sin filtro | `/shipping-guides/carriers` | 2001 | 7.8 | 9.6 | 15.8 | 2000 | Sí |
| Transportistas: búsqueda por identificación | `/shipping-guides/carriers?search=1700005` | 200 | 8 | 10 | 12 | 2000 | Sí |
| Transportistas: búsqueda por razón social (todos coinciden) | `/shipping-guides/carriers?search=transportes` | 2001 | 7.2 | 10.3 | 14.6 | 2000 | Sí |
| Destinatarios: primera página, sin filtro | `/shipping-guides/recipients` | 10051 | 6.4 | 8.6 | 10.7 | 2000 | Sí |
| Destinatarios: búsqueda por identificación | `/shipping-guides/recipients?search=1700005` | 1000 | 7.8 | 9.6 | 13.8 | 2000 | Sí |
| Destinatarios: búsqueda por razón social (casi todos coinciden) | `/shipping-guides/recipients?search=benchmark` | 10000 | 7.5 | 10.2 | 10.9 | 2000 | Sí |
| Facturas elegibles: primera página, sin filtro | `/shipping-guides/eligible-invoices` | 20001 | 11.8 | 14.2 | 17.4 | 2000 | Sí |
| Facturas elegibles: búsqueda por número | `/shipping-guides/eligible-invoices?search=000012345` | 1 | 28.1 | 33.8 | 38.5 | 2000 | Sí |
| Facturas elegibles: búsqueda por comprador | `/shipping-guides/eligible-invoices?search=BENCHMARK%2001234` | 2 | 27.7 | 33.5 | 40.5 | 2000 | Sí |
| Mercancías sugeridas de una factura de 5 líneas | `/shipping-guides/eligible-invoices/bench-inv-12345/goods` | 5 | 7.8 | 9.2 | 13.3 | 2000 | Sí |
| Mercancías sugeridas de una factura de 100 líneas | `/shipping-guides/eligible-invoices/bench-inv-big/goods` | 100 | 72.9 | 83.6 | 88.6 | 2000 | Sí |
| Opciones del borrador (puntos y establecimientos) | `/shipping-guides/options` | — | 3 | 3.9 | 8.5 | 2000 | Sí |
| Creación del borrador del peor caso (límites por defecto: 10 destinatarios × 10 detalles, textos de 300) | `POST /shipping-guides/drafts` | 20 | 40.9 | 47.1 | 53.3 | 2000 | Sí |
| Vista previa del borrador del peor caso (límites por defecto) | `/shipping-guides/drafts/{id}` | — | 15.3 | 18 | 20.3 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): total del servidor | `POST /shipping-guides` | 10 | 299.4 | 338.5 | 338.5 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): transacción de la reserva | `reservation_tx` | 10 | 55.5 | 67.6 | 67.6 | 2000 | Sí |
| Creación del borrador del peor caso (máximos absolutos: 50 destinatarios × 6 detalles, textos de 100) | `POST /shipping-guides/drafts` | 20 | 139.4 | 144.9 | 145.6 | 2000 | Sí |
| Vista previa del borrador del peor caso (máximos absolutos) | `/shipping-guides/drafts/{id}` | — | 46.3 | 51.1 | 51.3 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): total del servidor | `POST /shipping-guides` | 10 | 405.2 | 441.2 | 441.2 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): transacción de la reserva | `reservation_tx` | 10 | 121.4 | 145.2 | 145.2 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /shipping-guides` | 100 | 203.5 | 220.1 | 270.5 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 20.1 | 26 | 69.5 | 2000 | Sí |
| La misma factura, 10 simultáneas: total del servidor | `POST /shipping-guides` | 100 | 594.4 | 859.6 | 996.9 | 2000 | Sí |
| La misma factura, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 189.2 | 555 | 721.8 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: total del servidor | `POST /shipping-guides` | 100 | 574.2 | 697.1 | 757.9 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 148.6 | 267.9 | 310.6 | 2000 | Sí |
| Guías: primera página, sin filtro | `/shipping-guides` | 100333 | 17.3 | 21 | 28.5 | 2000 | Sí |
| Guías: búsqueda por número | `/shipping-guides?search=000054321` | 1 | 548.3 | 573.3 | 602.2 | 2000 | Sí |
| Guías: búsqueda por identificación de un destinatario | `/shipping-guides?search=1700001234001` | 20 | 562.2 | 582.5 | 608.8 | 2000 | Sí |
| Guías: búsqueda por transportista | `/shipping-guides?search=TRANSPORTES%20DEL%20BENCHMARK%2000500` | 20 | 572.5 | 601.7 | 617.7 | 2000 | Sí |
| Guías: filtro por estado | `/shipping-guides?state=AUTHORIZED` | 100000 | 38.7 | 41.7 | 51.2 | 2000 | Sí |
| Bandeja: filtro por identificación de un destinatario | `/documents?identification=1700001234001` | 22 | 345.4 | 375.1 | 387 | 2000 | Sí |
| Bandeja: guías filtradas por identificación de un destinatario | `/documents?documentType=06&identification=1700001234001` | 20 | 347.1 | 375.2 | 403.1 | 2000 | Sí |
| Render del RIDE de una guía (worker) | `RideWorkerPool` | 30 | 88.1 | 96.5 | 98.7 | 1000 | Sí |
| Render del RIDE del máximo de filas (50 destinatarios, 300 detalles, 26 páginas) | `RideWorkerPool` | 30 | 524 | 559.7 | 567.9 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 26 | 0.1 | 126.2 | 56.7 | 10.7 | 220.1 | 223.3 |

## Peor caso y límites de recursos (design D23)

| Caso | Forma | Detalles | Cuerpo del borrador (KiB) | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| límites por defecto | 10 destinatarios × 10 detalles, textos de 300 | 100 | 54.7 | 67.6 | 1 | 161.3 | 91.7 | 338.5 | 19 | 502.7 | 666.1 → 729 | 741.3 | 77 |
| máximos absolutos | 50 destinatarios × 6 detalles, textos de 100 | 300 | 97.4 | 145.2 | 1.8 | 149.3 | 101.5 | 441.2 | 62 | 669.1 | 728.9 → 833.9 | 843.6 | 164.1 |

- El peor caso usa la razón social del transportista y de los destinatarios de 300 caracteres, la placa de 20, códigos de 25 y la cantidad más larga, y la dirección, el motivo, la ruta y la descripción con el texto más largo que cabe en el límite del cuerpo JSON de la plataforma (300, el máximo del contrato, si cabe); los destinatarios alternan la factura y la consignación declarada, y el último es un traslado al otro establecimiento propio.
- **Límite del cuerpo (máximos absolutos):** con todos los textos en 300 caracteres el cuerpo del borrador mediría 185.1 KiB, más que el límite global de 100 KiB del cuerpo JSON (`JSON_BODY_LIMIT`), y la API respondería `413 PAYLOAD_TOO_LARGE` antes de evaluar los límites de la guía. Se midió con textos de 100 caracteres (97.4 KiB). Ese límite de la plataforma no cambia en este change.
- El tamaño del XML firmado del peor caso (168062 bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.
- Los límites son una defensa de recursos del sistema. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de 666.1 MiB, y la máxima es la de toda la ejecución hasta ese punto.

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| La misma factura | 10 | 12.7 | 189.2 | 555 | 534.9 | 859.6 |
| Facturas distintas | 10 | 14.2 | 148.6 | 267.9 | 247.8 | 697.1 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (20.1 ms), que no espera a nadie. Una guía no reserva capacidad de la factura que la sustenta: varias guías pueden citar la misma factura (design D8). Las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.

Independencia al terminar: 100333 guías; movimientos de inventario 0 → 0; saldos de inventario sin cambios; facturas sin cambios y sus XML sin cambios; roles de los terceros sin cambios.

Todas las operaciones cumplen su objetivo en este entorno y las guías no tocan el inventario, las facturas ni los roles de los terceros.
