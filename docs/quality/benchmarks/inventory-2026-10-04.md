# Benchmark del inventario (2026-10-04)

Volumen: 10000 productos inicializados (más 1000 marcados sin inicializar y 1000 sin marca) y el kárdex de 100000 facturas (251990 movimientos con los INICIAL, 20000 entradas y 2000 ajustes), en una empresa. El producto con más movimientos tiene 20013; 1218 saldos son negativos. Siembra por SQL en 84.6 s, con los triggers de integridad activos. Calentamiento de 20 y 200 mediciones secuenciales por consulta desde el cliente HTTP contra `main.ts`; la salida automática se mide en proceso con el seguidor real en su transacción (100 facturas de 5 líneas). Objetivo: ERS RNF-005, P95 menor que 2000 ms (design D15 de `add-minimal-inventory`). Las facturas sembradas quedan en RESERVED: solo son el destino de la clave foránea de sus salidas. Generado por `bench:inventory`; datos en `inventory-2026-10-04.json`.

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
| commit | 4171e47 |

## Volumen

| Tabla | Filas al medir | Tamaño total |
| --- | --- | --- |
| `product` | 12000 | 9104 kB |
| `electronic_document` | 100000 | 110 MB |
| `stock_balance` | 10000 | 3624 kB |
| `stock_movement` | 251990 | 167 MB |

## Resultados

| Operación | Ruta | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Dentro del objetivo |
| --- | --- | --- | --- | --- | --- | --- |
| Lista: primera página, sin filtro | `/inventory/items` | 11000 | 58.3 | 71.4 | 76.6 | Sí |
| Lista: última página, sin filtro | `/inventory/items?page=440` | 11000 | 58.9 | 67.5 | 99.8 | Sí |
| Lista: filtro de estado activo | `/inventory/items?state=TRACKED_INITIALIZED` | 10000 | 55.9 | 65.8 | 81.2 | Sí |
| Lista: filtro de saldo negativo | `/inventory/items?state=NEGATIVE` | 1218 | 15.9 | 20.5 | 23.4 | Sí |
| Lista: filtro sin inicializar | `/inventory/items?state=TRACKED_NOT_INITIALIZED` | 1000 | 48.8 | 55.2 | 65.6 | Sí |
| Lista: búsqueda por código | `/inventory/items?search=inv0012` | 100 | 56.3 | 66.3 | 73.8 | Sí |
| Detalle del producto con más movimientos | `/inventory/items/bench-product-1` | — | 3.9 | 5 | 8.2 | Sí |
| Kárdex: primera página del producto con más movimientos | `/inventory/items/bench-product-1/movements` | 20013 | 6.3 | 9.2 | 13 | Sí |
| Kárdex: filtrado por un mes | `/inventory/items/bench-product-1/movements?from=2026-08-06&to=2026-09-05` | 1787 | 4 | 5.3 | 9 | Sí |
| Entrada manual (HTTP) | `POST /inventory/items/bench-product-1/entries` | — | 8.9 | 34.2 | 39.8 | Sí |
| Salida automática de una factura de 5 líneas (seguidor en su transacción) | `inventoryOutflowFollower` | 100 | 11.4 | 14.3 | 21 | Sí |

Reconciliación diagnóstica al terminar: 0 diferencias, en 3 s.

Todas las operaciones cumplen el objetivo en este entorno y la reconciliación no encuentra diferencias.
