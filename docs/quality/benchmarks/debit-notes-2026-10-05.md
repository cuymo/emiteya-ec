# Benchmark de las notas de débito (2026-10-05)

Volumen: 100000 facturas AUTHORIZED de 5 líneas en dos tratamientos de IVA (15 % y 0 %), en una empresa. Siembra por SQL en 45.6 s. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada y la transmisión apagada; la contención son 10 rondas de 10 emisiones simultáneas. El cálculo se mide en proceso (1000 veces) y el RIDE en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D25 de `add-debit-notes`). Las respuestas del SRI no participan. Generado por `bench:debit-notes`; datos en `debit-notes-2026-10-05.json`.

## Entorno

| Clave | Valor |
| --- | --- |
| postgres | PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit |
| shared_buffers | 128MB |
| work_mem | 4MB |
| effective_cache_size | 4GB |
| jit | on |
| node | v24.21.0 |
| os | Linux 7.1.6-1-cachyos |
| cpu | AMD Ryzen 5 3600 6-Core Processor (12 núcleos) |
| memory | 16 GiB |
| commit | f1a2b21 |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `electronic_document` | 100002 | 309 MB |
| `document_artifact` | 200003 | 118 MB |
| `debit_note_support` | 1 | 48 kB |
| `debit_note_draft` | 1 | 96 kB |
| `debit_note_draft_concept` | 2 | 32 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Facturas elegibles: primera página, sin filtro | `/debit-notes/eligible-invoices` | 100001 | 614.6 | 648.1 | 677.2 | 2000 | Sí |
| Facturas elegibles: búsqueda por número | `/debit-notes/eligible-invoices?search=000054321` | 1 | 740.4 | 807.7 | 829.6 | 2000 | Sí |
| Facturas elegibles: búsqueda por comprador (todas coinciden) | `/debit-notes/eligible-invoices?search=perno` | 100001 | 644.1 | 677 | 724.6 | 2000 | Sí |
| Vista previa del borrador de 1 concepto | `/debit-notes/drafts/{id}` | — | 9.6 | 12.3 | 19.3 | 2000 | Sí |
| Vista previa del borrador de 100 conceptos en dos tratamientos | `/debit-notes/drafts/{id}` | — | 11.6 | 14 | 17.7 | 2000 | Sí |
| Cálculo de 100 conceptos de un tratamiento (en proceso) | `calculateDebitNoteAmounts` | 100 | 0.5 | 0.7 | 1.6 | 2000 | Sí |
| Cálculo de 100 conceptos en cinco tratamientos (en proceso) | `calculateDebitNoteAmounts` | 100 | 0.5 | 0.8 | 1.2 | 2000 | Sí |
| Emisión con reserva: total del servidor | `POST /debit-notes` | 100 | 208.8 | 271.7 | 291.7 | 2000 | Sí |
| Emisión con reserva: transacción de la reserva | `reservation_tx` | 100 | 20.4 | 39.6 | 54.7 | 2000 | Sí |
| La misma factura, 10 simultáneas: total del servidor | `POST /debit-notes` | 100 | 579.4 | 722.9 | 735.8 | 2000 | Sí |
| La misma factura, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 130.3 | 232.8 | 269.2 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: total del servidor | `POST /debit-notes` | 100 | 568 | 685 | 715.3 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 124.6 | 224.4 | 245.8 | 2000 | Sí |
| Render del RIDE de la nota (worker) | `RideWorkerPool` | 50 | 85.2 | 91.6 | 99.2 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- |
| 39.6 | 0.1 | 126.7 | 60.5 | 21.6 | 271.7 | 275.5 |

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| La misma factura | 10 | 13.7 | 130.3 | 232.8 | 212.4 | 722.9 |
| Facturas distintas | 10 | 14.3 | 124.6 | 224.4 | 204 | 685 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (20.4 ms), que no espera a nadie. Una nota de débito no bloquea su factura (design D14): las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como la factura y la nota de crédito.
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva.

Independencia al terminar: 311 notas emitidas; filas de capacidad acreditable 0 → 0 y movimientos de inventario 0 → 0.

Todas las operaciones cumplen su objetivo en este entorno y las notas no tocan la capacidad acreditable ni el inventario.
