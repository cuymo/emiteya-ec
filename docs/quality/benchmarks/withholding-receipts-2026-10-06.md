# Benchmark de los comprobantes de retención (2026-10-06)

Volumen: 10000 proveedores y 100000 retenciones AUTHORIZED de dos retenciones en doce períodos, en una empresa (volumen de Q-26). Siembra por SQL en 101.8 s. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con 20 muestras; la contención son 10 rondas de 10 emisiones simultáneas. El cálculo se mide en proceso (1000 veces) y el RIDE en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D27 de `add-withholding-receipts`). Las respuestas del SRI no participan. Generado por `bench:withholding-receipts`; datos en `withholding-receipts-2026-10-06.json`.

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
| commit | 0667d56 |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `party` | 10003 | 7744 kB |
| `electronic_document` | 100001 | 409 MB |
| `withholding_receipt` | 100001 | 27 MB |
| `withholding_receipt_line` | 200002 | 56 MB |
| `withholding_receipt_draft` | 1 | 96 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Proveedores: primera página, sin filtro | `/withholding-receipts/suppliers` | 10002 | 9.8 | 12.5 | 19.4 | 2000 | Sí |
| Proveedores: búsqueda por identificación | `/withholding-receipts/suppliers?search=1700005` | 1000 | 9.4 | 12.2 | 17.2 | 2000 | Sí |
| Proveedores: búsqueda por razón social (todas coinciden) | `/withholding-receipts/suppliers?search=benchmark` | 10000 | 13.2 | 14.3 | 20.3 | 2000 | Sí |
| Resolución de los catálogos (opciones del borrador) | `/withholding-receipts/options` | — | 17.3 | 23.5 | 28.5 | 2000 | Sí |
| Creación del borrador del peor caso (límites por defecto: 10 documentos × 5 retenciones, 5 impuestos y 5 pagos) | `POST /withholding-receipts/drafts` | 20 | 24.2 | 30.4 | 30.8 | 2000 | Sí |
| Vista previa del borrador del peor caso (límites por defecto) | `/withholding-receipts/drafts/{id}` | — | 17.8 | 23.9 | 32.1 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): total del servidor | `POST /withholding-receipts` | 10 | 285.7 | 395.5 | 395.5 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): transacción de la reserva | `reservation_tx` | 10 | 59.6 | 91.4 | 91.4 | 2000 | Sí |
| Creación del borrador del peor caso (máximos absolutos: 30 documentos × 10 retenciones, 10 impuestos y 10 pagos) | `POST /withholding-receipts/drafts` | 20 | 37.4 | 40.1 | 40.8 | 2000 | Sí |
| Vista previa del borrador del peor caso (máximos absolutos) | `/withholding-receipts/drafts/{id}` | — | 22.8 | 26.7 | 32.9 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): total del servidor | `POST /withholding-receipts` | 10 | 456.1 | 478.1 | 478.1 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): transacción de la reserva | `reservation_tx` | 10 | 147.4 | 179.6 | 179.6 | 2000 | Sí |
| Cálculo de 50 retenciones (en proceso) | `calculateWithholdingAmounts` | 50 | 0.4 | 0.5 | 1.1 | 2000 | Sí |
| Cálculo de 300 retenciones (en proceso) | `calculateWithholdingAmounts` | 300 | 2.2 | 2.6 | 5.3 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /withholding-receipts` | 100 | 231.1 | 259.1 | 355.8 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 36 | 45.2 | 48 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: total del servidor | `POST /withholding-receipts` | 100 | 602.3 | 779.4 | 821.1 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 225.5 | 410.2 | 455.6 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: total del servidor | `POST /withholding-receipts` | 100 | 591 | 782.2 | 799.7 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 199.5 | 389.8 | 431.7 | 2000 | Sí |
| Retenciones: primera página, sin filtro | `/withholding-receipts` | 100333 | 17.1 | 25.8 | 26.7 | 2000 | Sí |
| Retenciones: búsqueda por número | `/withholding-receipts?search=000054321` | 1 | 61.6 | 72 | 75.4 | 2000 | Sí |
| Retenciones: búsqueda por proveedor | `/withholding-receipts?search=BENCHMARK%2005432` | 10 | 60.9 | 69.9 | 77 | 2000 | Sí |
| Retenciones: filtro por período | `/withholding-receipts?fiscalPeriod=09%2F2026` | 8333 | 23.5 | 24.6 | 36.3 | 2000 | Sí |
| Retenciones: filtro por estado | `/withholding-receipts?state=AUTHORIZED` | 100000 | 36.9 | 38.3 | 58.4 | 2000 | Sí |
| Render del RIDE de una retención (worker) | `RideWorkerPool` | 30 | 83.5 | 96.6 | 100.2 | 1000 | Sí |
| Render del RIDE del máximo de filas (300 retenciones, 15 páginas) | `RideWorkerPool` | 30 | 286.4 | 299.3 | 305.6 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 45.2 | 0.1 | 134.8 | 57.8 | 11.4 | 259.1 | 261.8 |

## Peor caso y límites de recursos (design D25)

| Caso | Forma | Retenciones | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| límites por defecto | 10 documentos × 5 retenciones, 5 impuestos y 5 pagos | 50 | 91.4 | 1.1 | 168.1 | 79.3 | 395.5 | 21.4 | 521.8 | 685.6 → 779 | 793.1 | 45.5 |
| máximos absolutos | 30 documentos × 10 retenciones, 10 impuestos y 10 pagos | 300 | 179.6 | 4.3 | 148.8 | 124.4 | 478.1 | 25.8 | 683.6 | 779 → 893.5 | 901.6 | 224.7 |

- El tamaño del XML firmado del peor caso (230114 bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.
- Los límites son una defensa de recursos del sistema. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de 685.6 MiB, y la máxima es la de toda la ejecución hasta ese punto.

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| El mismo proveedor | 10 | 12.5 | 225.5 | 410.2 | 374.2 | 779.4 |
| Proveedores distintos | 10 | 12.6 | 199.5 | 389.8 | 353.8 | 782.2 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (36 ms), que no espera a nadie. Una retención no bloquea recursos compartidos: sus documentos sustento son externos (design D16). Las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos; dos retenciones simultáneas al mismo proveedor son válidas.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.

Independencia al terminar: 100333 retenciones; filas de capacidad acreditable 0 → 0 y movimientos de inventario 0 → 0.

Todas las operaciones cumplen su objetivo en este entorno y las retenciones no tocan la capacidad acreditable ni el inventario.
