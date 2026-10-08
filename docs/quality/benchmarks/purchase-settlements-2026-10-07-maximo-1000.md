# Benchmark de las liquidaciones de compra (2026-10-07)

Volumen: 10000 terceros (5000 con el rol SUPPLIER, con cédula o pasaporte), 10000 productos y 100000 liquidaciones AUTHORIZED con su registro y sus cuatro declaraciones, en una empresa (volumen de Q-26). Siembra por SQL en 119.3 s, seguida de `VACUUM (ANALYZE)` y un `CHECKPOINT` para que las escrituras diferidas de la carga masiva no caigan sobre las mediciones. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con 20 muestras; la contención son 10 rondas de 10 emisiones simultáneas; el cálculo, 200 ejecuciones en el proceso. El RIDE se mide en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D27 de `add-purchase-settlements`). Las respuestas del SRI no participan. Generado por `bench:purchase-settlements`; datos en `purchase-settlements-2026-10-07.json`.

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
| commit | f6e7896 |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `party` | 10002 | 9568 kB |
| `product` | 10000 | 9104 kB |
| `electronic_document` | 100001 | 407 MB |
| `document_artifact` | 200001 | 124 MB |
| `purchase_settlement` | 100001 | 28 MB |
| `purchase_settlement_declaration` | 400004 | 149 MB |
| `purchase_settlement_draft` | 1 | 96 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Proveedores: primera página, sin filtro | `/purchase-settlements/suppliers` | 5001 | 7.6 | 10 | 12 | 2000 | Sí |
| Proveedores: búsqueda por identificación | `/purchase-settlements/suppliers?search=1700001234` | 1 | 7.7 | 9.1 | 12.5 | 2000 | Sí |
| Proveedores: búsqueda por nombre (todos coinciden) | `/purchase-settlements/suppliers?search=proveedor` | 5001 | 7.4 | 9.6 | 10.2 | 2000 | Sí |
| Productos activos: primera página | `/products?status=ACTIVE` | 10000 | 9.8 | 13.7 | 17.3 | 2000 | Sí |
| Productos activos: búsqueda por código | `/products?status=ACTIVE&search=P001234` | 1 | 12.2 | 15.5 | 18.2 | 2000 | Sí |
| Opciones del borrador | `/purchase-settlements/options` | — | 4.3 | 5.3 | 9.2 | 2000 | Sí |
| Cálculo versionado de 100 líneas (en el proceso) | `calculatePurchaseSettlementAmounts` | 100 | 1.63 | 2.1 | 2.92 | 2000 | Sí |
| Cálculo versionado de 1000 líneas (en el proceso) | `calculatePurchaseSettlementAmounts` | 1000 | 17.22 | 18.95 | 23.39 | 2000 | Sí |
| Creación del borrador del peor caso (valores por defecto: 100 líneas y 10 pagos, textos multibyte de longitud máxima) | `POST /purchase-settlements/drafts` | 20 | 22.9 | 29.7 | 31.1 | 2000 | Sí |
| Vista previa del borrador del peor caso (valores por defecto) | `/purchase-settlements/drafts/{id}` | 100 | 14.1 | 19.6 | 22.6 | 2000 | Sí |
| Emisión del peor caso (valores por defecto): total del servidor | `POST /purchase-settlements` | 10 | 299.4 | 326.7 | 326.7 | 2000 | Sí |
| Emisión del peor caso (valores por defecto): transacción de la reserva | `reservation_tx` | 10 | 44.3 | 52.6 | 52.6 | 2000 | Sí |
| Creación del borrador del peor caso (máximos absolutos: 1000 líneas y 20 pagos, textos multibyte de longitud máxima) | `POST /purchase-settlements/drafts` | 20 | 122.7 | 140.6 | 161.7 | 2000 | Sí |
| Vista previa del borrador del peor caso (máximos absolutos) | `/purchase-settlements/drafts/{id}` | 1000 | 58.2 | 63.6 | 79.4 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): total del servidor | `POST /purchase-settlements` | 10 | 814.3 | 836.7 | 836.7 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): transacción de la reserva | `reservation_tx` | 10 | 140.4 | 168.1 | 168.1 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /purchase-settlements` | 100 | 219.4 | 245.8 | 261.2 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 26.6 | 32.2 | 33.8 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: total del servidor | `POST /purchase-settlements` | 100 | 572 | 696.1 | 738.5 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 155.8 | 283.5 | 361.3 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: total del servidor | `POST /purchase-settlements` | 100 | 577.7 | 708.5 | 741.4 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 159.9 | 284.2 | 313.9 | 2000 | Sí |
| Liquidaciones: primera página, sin filtro | `/purchase-settlements` | 100333 | 17.3 | 26.2 | 27.4 | 2000 | Sí |
| Liquidaciones: búsqueda por número | `/purchase-settlements?search=000054321` | 1 | 61.3 | 69.4 | 75 | 2000 | Sí |
| Liquidaciones: búsqueda por identificación del proveedor | `/purchase-settlements?search=1700001234` | 20 | 58.8 | 66.2 | 72.9 | 2000 | Sí |
| Liquidaciones: búsqueda por nombre del proveedor | `/purchase-settlements?search=PROVEEDOR%20DEL%20BENCHMARK%2001234` | 20 | 64.3 | 75.1 | 80.5 | 2000 | Sí |
| Liquidaciones: filtro por estado | `/purchase-settlements?state=AUTHORIZED` | 100000 | 38.1 | 40 | 42 | 2000 | Sí |
| Bandeja: liquidaciones filtradas por identificación del proveedor | `/documents?documentType=03&identification=1700001234` | 20 | 161 | 177.6 | 189.7 | 2000 | Sí |
| Render del RIDE de una liquidación (worker) | `RideWorkerPool` | 30 | 86.1 | 95.5 | 95.8 | 1000 | Sí |
| Render del RIDE del máximo de líneas (1000 líneas, 102 páginas) | `RideWorkerPool` | 30 | 1036.9 | 1073.1 | 1074.6 | 1000 | No |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 32.2 | 0.1 | 141.2 | 55.5 | 11.5 | 245.8 | 249.7 |

## Peor caso y límites de recursos (design D22)

| Caso | Forma | Cuerpo del borrador (KiB) | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| valores por defecto | 100 líneas y 10 pagos, textos multibyte de longitud máxima | 100.9 | 52.6 | 2.2 | 154.9 | 94.4 | 326.7 | 18.1 | 532.7 | 669.8 → 736.9 | 745.1 | 152.5 |
| máximos absolutos | 1000 líneas y 20 pagos, textos multibyte de longitud máxima | 986.9 | 168.1 | 22 | 257.2 | 319.4 | 836.7 | 72.2 | 1187.3 | 736.9 → 1070.6 | 1150.5 | 1433.5 |

- El peor caso usa el proveedor con nombre y dirección de 300 caracteres, y en cada línea códigos de 25, descripción de 300 y unidad de 50 caracteres multibyte (de 2 y 3 bytes en UTF-8, con glifo en las fuentes del RIDE), cantidad y precio con 6 decimales y la mitad de las líneas al 15 %; los pagos llevan la unidad de tiempo de 10 caracteres y el plazo más largo, y suman exactamente el importe total. Todos los cuerpos caben en el límite de 4 MiB de la ruta del borrador (design D22).
- El tamaño del XML firmado del peor caso (1467936 bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.
- Los límites (100 líneas y 10 pagos por defecto; 1000 y 20 como máximos absolutos) son una defensa de recursos del sistema, no límites del SRI ni del XSD. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de 669.8 MiB, y la máxima es la de toda la ejecución hasta ese punto.

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| Proveedores distintos | 10 | 13.9 | 155.8 | 283.5 | 256.9 | 696.1 |
| El mismo proveedor | 10 | 13.9 | 159.9 | 284.2 | 257.6 | 708.5 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (26.6 ms), que no espera a nadie. La liquidación no reserva capacidad del proveedor ni de los productos: las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.

Independencia al terminar: 100333 liquidaciones; movimientos de inventario 0 → 0; saldos de inventario sin cambios; comprobantes de retención 0 → 0; terceros sin cambios; productos sin cambios.

Al menos una operación supera su objetivo o las liquidaciones tocaron el inventario, las retenciones, los terceros o los productos: analizar antes de cambiar índices, límites o estrategia (`/opsx:update`).
