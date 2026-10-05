# Benchmark de las notas de crédito (2026-10-05)

Volumen: 100000 facturas AUTHORIZED de 5 líneas, 10000 de ellas con un crédito previo de 2 líneas (tres de cada cuatro aplicado por una nota autorizada y una reservado por una nota firmada), en una empresa. Siembra por SQL en 468.5 s, con los triggers de la capacidad activos. Calentamiento de 10 y 100 mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra `main.ts`, con la custodia habilitada y la transmisión apagada; la contención son 10 rondas de 10 emisiones simultáneas. El cálculo se mide en proceso (1000 veces) y el RIDE en `RideWorkerPool` con 2 workers. Objetivos: ERS RNF-005, P95 menor que 2000 ms, y el P95 del render del RIDE menor que 1000 ms (design D21 de `add-credit-notes`). Las respuestas del SRI no participan. Generado por `bench:credit-notes`; datos en `credit-notes-2026-10-05.json`.

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
| commit | 334328c |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `electronic_document` | 110002 | 353 MB |
| `document_artifact` | 210003 | 124 MB |
| `credit_capacity` | 10001 | 3120 kB |
| `credit_capacity_line` | 50005 | 18 MB |
| `credit_reservation` | 10001 | 7424 kB |
| `credit_reservation_line` | 20001 | 5976 kB |
| `stock_return_reservation` | 0 | 24 kB |

## Resultados

| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Facturas elegibles: primera página, sin filtro | `/credit-notes/eligible-invoices` | 100003 | 648.6 | 913.4 | 1566.8 | 2000 | Sí |
| Facturas elegibles: búsqueda por número | `/credit-notes/eligible-invoices?search=000054321` | 1 | 752.1 | 935.6 | 1286.4 | 2000 | Sí |
| Facturas elegibles: búsqueda por comprador (todas coinciden) | `/credit-notes/eligible-invoices?search=perno` | 100003 | 670.7 | 902.1 | 1241.9 | 2000 | Sí |
| Vista previa del borrador sin créditos previos | `/credit-notes/drafts/{id}` | — | 12.6 | 15.3 | 17.2 | 2000 | Sí |
| Vista previa del borrador con créditos previos | `/credit-notes/drafts/{id}` | — | 10.6 | 15.5 | 18.6 | 2000 | Sí |
| Vista previa del borrador de 100 líneas | `/credit-notes/drafts/{id}` | — | 15.5 | 19.7 | 27.7 | 2000 | Sí |
| Cálculo de una devolución parcial de 100 líneas con créditos previos (en proceso) | `calculateCreditNoteAmounts` | 100 | 4.3 | 5.8 | 7.5 | 2000 | Sí |
| Emisión con reserva sin créditos previos: total del servidor | `POST /credit-notes` | 100 | 249.7 | 650.4 | 727.1 | 2000 | Sí |
| Emisión con reserva sin créditos previos: transacción de la reserva | `reservation_tx` | 100 | 46.3 | 147.7 | 209.5 | 2000 | Sí |
| Emisión con reserva con créditos previos: total del servidor | `POST /credit-notes` | 100 | 270.1 | 456.4 | 793.5 | 2000 | Sí |
| Emisión con reserva con créditos previos: transacción de la reserva | `reservation_tx` | 100 | 42.5 | 125.6 | 160.3 | 2000 | Sí |
| La misma factura, 10 simultáneas: total del servidor | `POST /credit-notes` | 100 | 726.4 | 1547.1 | 2030.1 | 2000 | Sí |
| La misma factura, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 364.4 | 997.5 | 1709.6 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: total del servidor | `POST /credit-notes` | 100 | 701.8 | 1686.5 | 2402.5 | 2000 | Sí |
| Facturas distintas, 10 simultáneas: transacción de la reserva | `reservation_tx` | 100 | 373.8 | 980.7 | 1905.6 | 2000 | Sí |
| Render del RIDE de la nota (worker) | `RideWorkerPool` | 50 | 83.1 | 93.5 | 95.3 | 1000 | Sí |

## Etapas de la emisión en serie (P95, ms)

| Escenario | `reservation_tx` | `xml` | `xsd` | `sign` | `persist` | `total` | Cliente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sin créditos previos | 147.7 | 0.1 | 132.7 | 61.6 | 106.9 | 650.4 | 653.7 |
| Con créditos previos | 125.6 | 0.1 | 133.5 | 63.7 | 85.4 | 456.4 | 459.3 |

## Contención

| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |
| --- | --- | --- | --- | --- | --- | --- |
| La misma factura | 10 | 9.7 | 364.4 | 997.5 | 951.2 | 1547.1 |
| Facturas distintas | 10 | 9.7 | 373.8 | 980.7 | 934.4 | 1686.5 |

- La espera por bloqueos es lo que el P95 de `reservation_tx` supera a su mediana en serie (46.3 ms), que no espera a nadie. Las reservas de una factura se serializan en su bloqueo de capacidad (design D8); las de una empresa, además, en el de la configuración y en el contador del punto (como la factura, design D7 de `add-invoice-emission`).
- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva (design D4).

Reconciliación al terminar: 0 diferencias acreditables y 0 devolvibles, en 1.2 s.

Todas las operaciones cumplen su objetivo en este entorno y la reconciliación no encuentra diferencias.
