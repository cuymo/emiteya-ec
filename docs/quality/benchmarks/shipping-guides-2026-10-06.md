# Benchmark de las guías de remisión (2026-10-06)

Volumen: 10000 terceros (2000 con el rol CARRIER), 10000 productos, 20000 facturas AUTHORIZED de 5 líneas y 100000 guías AUTHORIZED de uno a tres destinatarios, en una empresa (volumen de Q-26). Siembra por SQL en 167.9 s, seguida de `VACUUM (ANALYZE)` y un `CHECKPOINT` para que las escrituras diferidas de la carga masiva no caigan sobre las mediciones. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con 20 muestras; la contención son 10 rondas de 10 emisiones simultáneas. El RIDE se mide en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D28 de `add-shipping-guides`). Las respuestas del SRI no participan. Generado por `bench:shipping-guides`; datos en `shipping-guides-2026-10-06.json`.

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
| commit | 1d2940a |

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
| Transportistas: primera página, sin filtro | `/shipping-guides/carriers` | 2001 | 8.8 | 12.4 | 14.8 | 2000 | Sí |
| Transportistas: búsqueda por identificación | `/shipping-guides/carriers?search=1700005` | 200 | 8.3 | 11.7 | 15.4 | 2000 | Sí |
| Transportistas: búsqueda por razón social (todos coinciden) | `/shipping-guides/carriers?search=transportes` | 2001 | 8.3 | 11.3 | 12.5 | 2000 | Sí |
| Destinatarios: primera página, sin filtro | `/shipping-guides/recipients` | 10051 | 7.5 | 9.5 | 11 | 2000 | Sí |
| Destinatarios: búsqueda por identificación | `/shipping-guides/recipients?search=1700005` | 1000 | 8 | 11.6 | 16.2 | 2000 | Sí |
| Destinatarios: búsqueda por razón social (casi todos coinciden) | `/shipping-guides/recipients?search=benchmark` | 10000 | 8.5 | 11.2 | 13.2 | 2000 | Sí |
| Facturas elegibles: primera página, sin filtro | `/shipping-guides/eligible-invoices` | 20001 | 14.3 | 17.4 | 18.5 | 2000 | Sí |
| Facturas elegibles: búsqueda por número | `/shipping-guides/eligible-invoices?search=000012345` | 1 | 27.8 | 34.4 | 40.5 | 2000 | Sí |
| Facturas elegibles: búsqueda por comprador | `/shipping-guides/eligible-invoices?search=BENCHMARK%2001234` | 2 | 27.5 | 29.6 | 37.2 | 2000 | Sí |
| Mercancías sugeridas de una factura de 5 líneas | `/shipping-guides/eligible-invoices/bench-inv-12345/goods` | 5 | 7.9 | 10.6 | 14.1 | 2000 | Sí |
| Mercancías sugeridas de una factura de 100 líneas | `/shipping-guides/eligible-invoices/bench-inv-big/goods` | 100 | 76.7 | 95.1 | 100.3 | 2000 | Sí |
| Opciones del borrador (puntos y establecimientos) | `/shipping-guides/options` | — | 2.9 | 4.1 | 8.5 | 2000 | Sí |
| Creación del borrador del peor caso (límites por defecto: 10 destinatarios × 10 detalles, textos de 300) | `POST /shipping-guides/drafts` | 20 | 82.9 | 92.3 | 92.7 | 2000 | Sí |
| Vista previa del borrador del peor caso (límites por defecto) | `/shipping-guides/drafts/{id}` | — | 15.2 | 22 | 22.4 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): total del servidor | `POST /shipping-guides` | 10 | 310.3 | 422.5 | 422.5 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): transacción de la reserva | `reservation_tx` | 10 | 59.2 | 96.4 | 96.4 | 2000 | Sí |
| Creación del borrador del peor caso (máximos absolutos: 50 destinatarios × 6 detalles, textos de 100) | `POST /shipping-guides/drafts` | 20 | 141.2 | 156.3 | 163.5 | 2000 | Sí |
| Vista previa del borrador del peor caso (máximos absolutos) | `/shipping-guides/drafts/{id}` | — | 44.3 | 49.8 | 51.2 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): total del servidor | `POST /shipping-guides` | 10 | 420 | 464.6 | 464.6 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): transacción de la reserva | `reservation_tx` | 10 | 120.4 | 154.1 | 154.1 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /shipping-guides` | 100 | 218.8 | 256.2 | 273.6 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 23.4 | 33.4 | 47.7 | 2000 | Sí |
| La misma factura, 10 simultáneas: total del servidor | `POST /shipping-guides` | 100 | 562.7 | 686.9 | 706.4 | 2000 | Sí |
| La misma factura, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 137.5 | 257.9 | 307.6 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: total del servidor | `POST /shipping-guides` | 100 | 563.7 | 689.4 | 732.1 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 134.4 | 258 | 295.8 | 2000 | Sí |
| Guías: primera página, sin filtro | `/shipping-guides` | 100333 | 23.5 | 29 | 31.4 | 2000 | Sí |
| Guías: búsqueda por número | `/shipping-guides?search=000054321` | 1 | 534.9 | 552.4 | 583.6 | 2000 | Sí |
| Guías: búsqueda por identificación de un destinatario | `/shipping-guides?search=1700001234001` | 20 | 552.3 | 569.6 | 589.6 | 2000 | Sí |
| Guías: búsqueda por transportista | `/shipping-guides?search=TRANSPORTES%20DEL%20BENCHMARK%2000500` | 20 | 565 | 587.6 | 602.4 | 2000 | Sí |
| Guías: filtro por estado | `/shipping-guides?state=AUTHORIZED` | 100000 | 37.7 | 38.9 | 40.1 | 2000 | Sí |
| Bandeja: filtro por identificación de un destinatario | `/documents?identification=1700001234001` | 22 | 338.3 | 370.1 | 437.7 | 2000 | Sí |
| Bandeja: guías filtradas por identificación de un destinatario | `/documents?documentType=06&identification=1700001234001` | 20 | 346.6 | 375.3 | 390.7 | 2000 | Sí |
| Render del RIDE de una guía (worker) | `RideWorkerPool` | 30 | 84.8 | 97.4 | 97.7 | 1000 | Sí |
| Render del RIDE del máximo de filas (50 destinatarios, 300 detalles, 26 páginas) | `RideWorkerPool` | 30 | 503.6 | 560.7 | 566.4 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 33.4 | 0.1 | 146.9 | 58.4 | 11.3 | 256.2 | 260.1 |

## Peor caso y límites de recursos (design D23)

| Caso | Forma | Detalles | Cuerpo del borrador (KiB) | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| límites por defecto | 10 destinatarios × 10 detalles, textos de 300 | 100 | 54.7 | 96.4 | 1.2 | 172.8 | 89.2 | 422.5 | 22.2 | 530 | 674 → 753.4 | 765.7 | 77 |
| máximos absolutos | 50 destinatarios × 6 detalles, textos de 100 | 300 | 97.4 | 154.1 | 1.9 | 195.6 | 93.3 | 464.6 | 62.3 | 712.7 | 753.4 → 800.5 | 816.1 | 164.1 |

- El peor caso usa la razón social del transportista y de los destinatarios de 300 caracteres, la placa de 20, códigos de 25 y la cantidad más larga, y la dirección, el motivo, la ruta y la descripción con el texto más largo que cabe en el límite del cuerpo JSON de la plataforma (300, el máximo del contrato, si cabe); los destinatarios alternan la factura y la consignación declarada, y el último es un traslado al otro establecimiento propio.
- **Límite del cuerpo (máximos absolutos):** con todos los textos en 300 caracteres el cuerpo del borrador mediría 185.1 KiB, más que el límite global de 100 KiB del cuerpo JSON (`JSON_BODY_LIMIT`), y la API respondería `413 PAYLOAD_TOO_LARGE` antes de evaluar los límites de la guía. Se midió con textos de 100 caracteres (97.4 KiB). Ese límite de la plataforma no cambia en este change.
- El tamaño del XML firmado del peor caso (168062 bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.
- Los límites son una defensa de recursos del sistema. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de 674 MiB, y la máxima es la de toda la ejecución hasta ese punto.

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| La misma factura | 10 | 14.4 | 137.5 | 257.9 | 234.5 | 686.9 |
| Facturas distintas | 10 | 14.3 | 134.4 | 258 | 234.6 | 689.4 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (23.4 ms), que no espera a nadie. Una guía no reserva capacidad de la factura que la sustenta: varias guías pueden citar la misma factura (design D8). Las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.

Independencia al terminar: 100333 guías; movimientos de inventario 0 → 0; saldos de inventario sin cambios; facturas sin cambios y sus XML sin cambios; roles de los terceros sin cambios.

Todas las operaciones cumplen su objetivo en este entorno y las guías no tocan el inventario, las facturas ni los roles de los terceros.
