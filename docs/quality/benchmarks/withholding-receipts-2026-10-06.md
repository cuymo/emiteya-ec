# Benchmark de los comprobantes de retención (2026-10-06)

Volumen: 10000 proveedores y 100000 retenciones AUTHORIZED de dos retenciones en doce períodos, en una empresa (volumen de Q-26). Siembra por SQL en 83.2 s. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con 20 muestras; la contención son 10 rondas de 10 emisiones simultáneas. El cálculo se mide en proceso (1000 veces) y el RIDE en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D27 de `add-withholding-receipts`). Las respuestas del SRI no participan. Generado por `bench:withholding-receipts`; datos en `withholding-receipts-2026-10-06.json`.

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
| commit | e39c915 |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `party` | 10003 | 7744 kB |
| `electronic_document` | 100001 | 418 MB |
| `withholding_receipt` | 100001 | 27 MB |
| `withholding_receipt_line` | 200002 | 56 MB |
| `withholding_receipt_draft` | 1 | 96 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Proveedores: primera página, sin filtro | `/withholding-receipts/suppliers` | 10002 | 10.4 | 12.9 | 15.3 | 2000 | Sí |
| Proveedores: búsqueda por identificación | `/withholding-receipts/suppliers?search=1700005` | 1000 | 8.9 | 11.5 | 13.6 | 2000 | Sí |
| Proveedores: búsqueda por razón social (todas coinciden) | `/withholding-receipts/suppliers?search=benchmark` | 10000 | 10.8 | 14.9 | 17.5 | 2000 | Sí |
| Resolución de los catálogos (opciones del borrador) | `/withholding-receipts/options` | — | 18.8 | 25.2 | 29.5 | 2000 | Sí |
| Creación del borrador del peor caso (límites por defecto: 10 documentos × 5 retenciones, 5 impuestos y 5 pagos) | `POST /withholding-receipts/drafts` | 20 | 26.5 | 30.4 | 30.7 | 2000 | Sí |
| Vista previa del borrador del peor caso (límites por defecto) | `/withholding-receipts/drafts/{id}` | — | 19.2 | 26.9 | 36.7 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): total del servidor | `POST /withholding-receipts` | 10 | 309.8 | 341.1 | 341.1 | 2000 | Sí |
| Emisión del peor caso (límites por defecto): transacción de la reserva | `reservation_tx` | 10 | 64 | 81.6 | 81.6 | 2000 | Sí |
| Creación del borrador del peor caso (máximos absolutos: 30 documentos × 10 retenciones, 10 impuestos y 10 pagos) | `POST /withholding-receipts/drafts` | 20 | 38 | 41.8 | 42.5 | 2000 | Sí |
| Vista previa del borrador del peor caso (máximos absolutos) | `/withholding-receipts/drafts/{id}` | — | 24.3 | 28.7 | 29.6 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): total del servidor | `POST /withholding-receipts` | 10 | 470.5 | 558.3 | 558.3 | 2000 | Sí |
| Emisión del peor caso (máximos absolutos): transacción de la reserva | `reservation_tx` | 10 | 151.5 | 196.6 | 196.6 | 2000 | Sí |
| Cálculo de 50 retenciones (en proceso) | `calculateWithholdingAmounts` | 50 | 0.4 | 0.6 | 2.2 | 2000 | Sí |
| Cálculo de 300 retenciones (en proceso) | `calculateWithholdingAmounts` | 300 | 2.3 | 3.4 | 5.9 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /withholding-receipts` | 100 | 248.9 | 277.3 | 405.6 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 37.3 | 49.4 | 208.2 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: total del servidor | `POST /withholding-receipts` | 100 | 666.8 | 890.4 | 1017 | 2000 | Sí |
| El mismo proveedor, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 248.4 | 443.2 | 523.6 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: total del servidor | `POST /withholding-receipts` | 100 | 644.1 | 833.3 | 930.2 | 2000 | Sí |
| Proveedores distintos, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 233.9 | 419.2 | 498.2 | 2000 | Sí |
| Retenciones: primera página, sin filtro | `/withholding-receipts` | 100333 | 17.4 | 25 | 25.8 | 2000 | Sí |
| Retenciones: búsqueda por número | `/withholding-receipts?search=000054321` | 1 | 63.5 | 77 | 91.8 | 2000 | Sí |
| Retenciones: búsqueda por proveedor | `/withholding-receipts?search=BENCHMARK%2005432` | 10 | 63.4 | 70.4 | 77.7 | 2000 | Sí |
| Retenciones: filtro por período | `/withholding-receipts?fiscalPeriod=09%2F2026` | 8333 | 25.2 | 29.7 | 31.6 | 2000 | Sí |
| Retenciones: filtro por estado | `/withholding-receipts?state=AUTHORIZED` | 100000 | 38.6 | 46.9 | 57.1 | 2000 | Sí |
| Render del RIDE de una retención (worker) | `RideWorkerPool` | 30 | 80.3 | 96.5 | 98.9 | 1000 | Sí |
| Render del RIDE del máximo de filas (300 retenciones, 15 páginas) | `RideWorkerPool` | 30 | 281.4 | 319.4 | 323.9 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 49.4 | 0.1 | 141.9 | 58.4 | 13.9 | 277.3 | 280.6 |

## Peor caso y límites de recursos (design D25)

| Caso | Forma | Retenciones | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| límites por defecto | 10 documentos × 5 retenciones, 5 impuestos y 5 pagos | 50 | 81.6 | 1.1 | 147.7 | 72.4 | 341.1 | 22.2 | 520 | 761.4 → 853 | 865.6 | 45.5 |
| máximos absolutos | 30 documentos × 10 retenciones, 10 impuestos y 10 pagos | 300 | 196.6 | 4.3 | 160.2 | 146.6 | 558.3 | 26 | 715.5 | 853 → 958.5 | 966.8 | 224.7 |

- El tamaño del XML firmado del peor caso (230114 bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.
- Los límites son una defensa de recursos del sistema. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de 761.4 MiB, y la máxima es la de toda la ejecución hasta ese punto.

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| El mismo proveedor | 10 | 11.2 | 248.4 | 443.2 | 405.9 | 890.4 |
| Proveedores distintos | 10 | 11.8 | 233.9 | 419.2 | 381.9 | 833.3 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (37.3 ms), que no espera a nadie. Una retención no bloquea recursos compartidos: sus documentos sustento son externos (design D16). Las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos; dos retenciones simultáneas al mismo proveedor son válidas.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.

Independencia al terminar: 100333 retenciones; filas de capacidad acreditable 0 → 0 y movimientos de inventario 0 → 0.

Todas las operaciones cumplen su objetivo en este entorno y las retenciones no tocan la capacidad acreditable ni el inventario.
