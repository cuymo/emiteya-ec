# Benchmark de las notas de crédito (2026-10-05)

Volumen: 100000 facturas AUTHORIZED de 5 líneas, 10000 de ellas con un crédito previo de 2 líneas (tres de cada cuatro aplicado por una nota autorizada y una reservado por una nota firmada), en una empresa. Siembra por SQL en 480.8 s, con los triggers de la capacidad activos. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada y la transmisión apagada; la contención son 10 rondas de 10 emisiones simultáneas. El cálculo se mide en proceso (1000 veces) y el RIDE en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D21 de `add-credit-notes`). Las respuestas del SRI no participan. Generado por `bench:credit-notes`; datos en `credit-notes-2026-10-05.json`.

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
| commit | f235a6a |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `electronic_document` | 110002 | 353 MB |
| `document_artifact` | 210003 | 124 MB |
| `credit_capacity` | 10001 | 3120 kB |
| `credit_capacity_line` | 50005 | 18 MB |
| `credit_reservation` | 10001 | 7432 kB |
| `credit_reservation_line` | 20001 | 5976 kB |
| `stock_return_reservation` | 0 | 24 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Facturas elegibles: primera página, sin filtro | `/credit-notes/eligible-invoices` | 100003 | 639.1 | 819.4 | 3236.2 | 2000 | Sí |
| Facturas elegibles: búsqueda por número | `/credit-notes/eligible-invoices?search=000054321` | 1 | 739.5 | 845.7 | 1851.1 | 2000 | Sí |
| Facturas elegibles: búsqueda por comprador (todas coinciden) | `/credit-notes/eligible-invoices?search=perno` | 100003 | 669.8 | 866.5 | 1838.8 | 2000 | Sí |
| Vista previa del borrador sin créditos previos | `/credit-notes/drafts/{id}` | — | 9.3 | 11.9 | 21.7 | 2000 | Sí |
| Vista previa del borrador con créditos previos | `/credit-notes/drafts/{id}` | — | 10.5 | 13.6 | 17.7 | 2000 | Sí |
| Vista previa del borrador de 100 líneas | `/credit-notes/drafts/{id}` | — | 19 | 23.6 | 30.9 | 2000 | Sí |
| Cálculo de una devolución parcial de 100 líneas con créditos previos (en proceso) | `calculateCreditNoteAmounts` | 100 | 4.3 | 5.9 | 7.7 | 2000 | Sí |
| Emisión con reserva sin créditos previos: total del servidor | `POST /credit-notes` | 100 | 294.6 | 436.5 | 2585 | 2000 | Sí |
| Emisión con reserva sin créditos previos: transacción de la reserva | `reservation_tx` | 100 | 52.4 | 108.9 | 1344.7 | 2000 | Sí |
| Emisión con reserva con créditos previos: total del servidor | `POST /credit-notes` | 100 | 263.8 | 561.1 | 1287.6 | 2000 | Sí |
| Emisión con reserva con créditos previos: transacción de la reserva | `reservation_tx` | 100 | 35.9 | 120.2 | 158.7 | 2000 | Sí |
| La misma factura, 10 simultáneas: total del servidor | `POST /credit-notes` | 100 | 758.6 | 1556 | 2256.8 | 2000 | Sí |
| La misma factura, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 380.2 | 980.9 | 1761.5 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: total del servidor | `POST /credit-notes` | 100 | 702.7 | 1109.5 | 1318 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 373.3 | 768.1 | 929.7 | 2000 | Sí |
| Render del RIDE de la nota (worker) | `RideWorkerPool` | 50 | 82.2 | 94.1 | 108.5 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| Escenario | `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sin créditos previos | 108.9 | 0.2 | 151.6 | 62.1 | 68.3 | 436.5 | 440.3 |
| Con créditos previos | 120.2 | 0.1 | 153.3 | 60.9 | 115.8 | 561.1 | 565.3 |

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| La misma factura | 10 | 9.5 | 380.2 | 980.9 | 928.5 | 1556 |
| Facturas distintas | 10 | 9.8 | 373.3 | 768.1 | 715.7 | 1109.5 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (52.4 ms), que no espera a nadie. Las reservas de una factura se serializan en su bloqueo de capacidad (design D8); las de una empresa, además, en el de la configuración y en el contador del punto (como la factura, design D7 de `add-invoice-emission`).
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva (design D4).

Reconciliación al terminar: 0 diferencias acreditables y 0 devolvibles, en 1.1 s.

Todas las operaciones cumplen su objetivo en este entorno y la reconciliación no encuentra diferencias.
