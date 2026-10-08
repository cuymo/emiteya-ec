# Benchmark de las liquidaciones de compra (2026-10-07)

Volumen: 10000 terceros (5000 con el rol SUPPLIER, con cédula o pasaporte), 10000 productos y 100000 liquidaciones AUTHORIZED con su registro y sus cuatro declaraciones, en una empresa (volumen de Q-26). Siembra por SQL en 118.8 s, seguida de `VACUUM (ANALYZE)` y un `CHECKPOINT` para que las escrituras diferidas de la carga masiva no caigan sobre las mediciones. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con 20 muestras; la contención son 10 rondas de 10 emisiones simultáneas; el cálculo, 200 ejecuciones en el proceso. El RIDE se mide en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D27 de `add-purchase-settlements`). Las respuestas del SRI no participan. Generado por `bench:purchase-settlements`; datos en `purchase-settlements-2026-10-07.json`.

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
| commit | 8d045ed |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `party` | 10002 | 9552 kB |
| `product` | 10000 | 9104 kB |
| `electronic_document` | 100001 | 407 MB |
| `document_artifact` | 200001 | 124 MB |
| `purchase_settlement` | 100001 | 28 MB |
| `purchase_settlement_declaration` | 400004 | 149 MB |
| `purchase_settlement_draft` | 1 | 96 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Proveedores: primera página, sin filtro | `/purchase-settlements/suppliers` | 5001 | 8.3 | 10.6 | 13.7 | 2000 | Sí |
| Proveedores: búsqueda por identificación | `/purchase-settlements/suppliers?search=1700001234` | 1 | 8 | 11.2 | 15.8 | 2000 | Sí |
| Proveedores: búsqueda por nombre (todos coinciden) | `/purchase-settlements/suppliers?search=proveedor` | 5001 | 8.9 | 12.5 | 14.8 | 2000 | Sí |
| Productos activos: primera página | `/products?status=ACTIVE` | 10000 | 10.8 | 15.2 | 24 | 2000 | Sí |
| Productos activos: búsqueda por código | `/products?status=ACTIVE&search=P001234` | 1 | 13 | 15.8 | 19.8 | 2000 | Sí |
| Opciones del borrador | `/purchase-settlements/options` | — | 5.1 | 6.8 | 10.8 | 2000 | Sí |
| Cálculo versionado de 100 líneas (en el proceso) | `calculatePurchaseSettlementAmounts` | 100 | 1.71 | 2.83 | 5.86 | 2000 | Sí |
| Cálculo versionado de 500 líneas (en el proceso) | `calculatePurchaseSettlementAmounts` | 500 | 9.03 | 12.01 | 17.75 | 2000 | Sí |
| Creación del borrador del peor caso (valores por defecto: 100 líneas y 10 pagos, textos multibyte de longitud máxima) | `POST /purchase-settlements/drafts` | 20 | 26.3 | 31.4 | 32.4 | 2000 | Sí |
| Vista previa del borrador del peor caso (valores por defecto) | `/purchase-settlements/drafts/{id}` | 100 | 15.2 | 17 | 20.7 | 2000 | Sí |
| Emisión del peor caso (valores por defecto): total del servidor | `POST /purchase-settlements` | 10 | 308.4 | 339.6 | 339.6 | 2000 | Sí |
| Emisión del peor caso (valores por defecto): transacción de la reserva | `reservation_tx` | 10 | 40.2 | 63.7 | 63.7 | 2000 | Sí |
| Creación del borrador del peor caso (máximos absolutos: 500 líneas y 20 pagos, textos multibyte de longitud máxima) | `POST /purchase-settlements/drafts` | 20 | 68.7 | 88.9 | 97.3 | 2000 | Sí |
| Vista previa del borrador del peor caso (máximos absolutos) | `/purchase-settlements/drafts/{id}` | 500 | 32.2 | 40.8 | 41.5 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): total del servidor | `POST /purchase-settlements` | 10 | 541.8 | 578.6 | 578.6 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): transacción de la reserva | `reservation_tx` | 10 | 86.5 | 101.3 | 101.3 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /purchase-settlements` | 100 | 227.4 | 255.8 | 279.4 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 26 | 34.5 | 47.4 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: total del servidor | `POST /purchase-settlements` | 100 | 575.9 | 763.7 | 821 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 173 | 316.2 | 417 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: total del servidor | `POST /purchase-settlements` | 100 | 575.4 | 703.9 | 739.5 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 165.6 | 292.4 | 340.4 | 2000 | Sí |
| Liquidaciones: primera página, sin filtro | `/purchase-settlements` | 100333 | 16.7 | 20.9 | 22.8 | 2000 | Sí |
| Liquidaciones: búsqueda por número | `/purchase-settlements?search=000054321` | 1 | 63.4 | 73.6 | 88.7 | 2000 | Sí |
| Liquidaciones: búsqueda por identificación del proveedor | `/purchase-settlements?search=1700001234` | 20 | 60 | 68.4 | 70.9 | 2000 | Sí |
| Liquidaciones: búsqueda por nombre del proveedor | `/purchase-settlements?search=PROVEEDOR%20DEL%20BENCHMARK%2001234` | 20 | 65.4 | 75 | 86.4 | 2000 | Sí |
| Liquidaciones: filtro por estado | `/purchase-settlements?state=AUTHORIZED` | 100000 | 38.6 | 46.9 | 57 | 2000 | Sí |
| Bandeja: liquidaciones filtradas por identificación del proveedor | `/documents?documentType=03&identification=1700001234` | 20 | 161.9 | 185.9 | 194.5 | 2000 | Sí |
| Render del RIDE de una liquidación (worker) | `RideWorkerPool` | 30 | 83.4 | 94.3 | 96.3 | 1000 | Sí |
| Render del RIDE del máximo de líneas (500 líneas, 52 páginas) | `RideWorkerPool` | 30 | 571.3 | 631.2 | 641.9 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 34.5 | 0.2 | 149.4 | 61.1 | 11.9 | 255.8 | 264.3 |

## Peor caso y límites de recursos (design D22)

| Caso | Forma | Cuerpo del borrador (KiB) | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| valores por defecto | 100 líneas y 10 pagos, textos multibyte de longitud máxima | 100.9 | 63.7 | 2.9 | 165.6 | 97.8 | 339.6 | 18 | 550 | 622.2 → 737.9 | 745.9 | 152.5 |
| máximos absolutos | 500 líneas y 20 pagos, textos multibyte de longitud máxima | 495.2 | 101.3 | 12.1 | 217.3 | 216.6 | 578.6 | 39.4 | 854.5 | 737.9 → 999.5 | 1008 | 722.8 |

- El peor caso usa el proveedor con nombre y dirección de 300 caracteres, y en cada línea códigos de 25, descripción de 300 y unidad de 50 caracteres multibyte (de 2 y 3 bytes en UTF-8, con glifo en las fuentes del RIDE), cantidad y precio con 6 decimales y la mitad de las líneas al 15 %; los pagos llevan la unidad de tiempo de 10 caracteres y el plazo más largo, y suman exactamente el importe total. Todos los cuerpos caben en el límite de 4 MiB de la ruta del borrador (design D22).
- El tamaño del XML firmado del peor caso (740185 bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.
- Los límites (100 líneas y 10 pagos por defecto; 500 y 20 como máximos absolutos) son una defensa de recursos del sistema, no límites del SRI ni del XSD. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de 622.2 MiB, y la máxima es la de toda la ejecución hasta ese punto.

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| Proveedores distintos | 10 | 13.5 | 173 | 316.2 | 290.2 | 763.7 |
| El mismo proveedor | 10 | 14 | 165.6 | 292.4 | 266.4 | 703.9 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (26 ms), que no espera a nadie. La liquidación no reserva capacidad del proveedor ni de los productos: las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.

Independencia al terminar: 100333 liquidaciones; movimientos de inventario 0 → 0; saldos de inventario sin cambios; comprobantes de retención 0 → 0; terceros sin cambios; productos sin cambios.

Todas las operaciones cumplen su objetivo en este entorno y las liquidaciones no tocan el inventario, las retenciones, los terceros ni los productos.
