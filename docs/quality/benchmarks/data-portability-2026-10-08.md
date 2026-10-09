# Benchmark de la portabilidad (2026-10-08)

Volumen de Q-26: 100000 comprobantes de los seis tipos en Producción a lo largo de un año y 2000 facturas de Pruebas, con el XML firmado de cada uno y, de cada autorizado, su XML autorizado, su RIDE y dos respuestas del SRI; los bytes son los de una factura real de tres líneas validada contra el XSD y firmada con la firma sintética (8533 bytes) y de su RIDE renderizado (24400 bytes), con la clave de acceso de cada comprobante. Además, 10000 terceros, 10000 productos, 300000 movimientos, 300000 eventos de auditoría, transiciones, entregas, 10 usuarios y las firmas con sus secretos marcados. Siembra por SQL en 483 s, con los triggers de su sesión apagados, seguida de `VACUUM (ANALYZE)` y un `CHECKPOINT`. La generación es la del job real en `main.ts`, con la transmisión deshabilitada, el barrido del RIDE apagado y `DATA_EXPORT_MAX_CONCURRENT` en 1. Generado por `bench:data-portability`; datos en `data-portability-2026-10-08.json`.

## Entorno

| Clave | Valor |
| --- | --- |
| postgres | PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit |
| shared_buffers | 128MB |
| work_mem | 4MB |
| jit | on |
| node | v24.15.0 |
| os | Linux 7.1.6-1-cachyos |
| cpu | AMD Ryzen 5 3600 6-Core Processor (12 núcleos) |
| memory | 16 GiB |
| directory | /dev/sdb2      btrfs |
| commit | 3725dd3 |

## Volumen

| Tabla | Filas | Tamaño total |
| --- | --- | --- |
| `electronic_document` | 102011 | 273 MB |
| `document_artifact` | 289698 | 3614 MB |
| `sri_attempt` | 200944 | 141 MB |
| `sri_response` | 200942 | 672 MB |
| `document_state_transition` | 306001 | 117 MB |
| `document_delivery_event` | 9345 | 4424 kB |
| `audit_event` | 300010 | 98 MB |
| `party` | 10009 | 9904 kB |
| `product` | 10002 | 8040 kB |
| `stock_movement` | 300004 | 224 MB |

## Generación

| Clave | Valor |
| --- | --- |
| Total, desde la solicitud (s) | 590.6 |
| En cola hasta lista (s) | 587.7 |
| Fases (s, `data_export_phase_duration_seconds`) | `{"SNAPSHOT":54.4,"ARTIFACTS":529.5,"PUBLISHING":3.8}` |
| CPU de main.ts (s) | 508.8 |
| Memoria residente de main.ts: inicial y máxima (MiB) | 196.6 y 723.2 |
| Disco máximo del directorio (MiB) | 3743.8 |
| Espacio libre mínimo (GiB) | 113.3 |
| Tamaño del ZIP (bytes) | 3683362811 |
| Tamaño del ZIP (MiB) | 3512.7 |
| Entradas del ZIP | 592630 |
| Conteos | `{"files":592630,"users":13,"parties":10001,"products":10000,"auditEvents":300010,"documentsTest":2000,"stockMovements":300000,"documentsProduction":100000}` |

Progreso por fase (ms desde la solicitud):

| Fase | Desde (ms) | Comprobantes |
| --- | --- | --- |
| SNAPSHOT | 1134 | — |
| ARTIFACTS | 55142 | 0 de 102000 |
| PUBLISHING | 584456 | — |

## Fase 1: transacción de solo lectura

| Clave | Valor |
| --- | --- |
| Transacción más larga en la base (s) | 54 |
| Edad máxima de `backend_xmin` (transacciones) | 891 |
| Escrituras de la tabla de prueba por segundo | 20 |
| Tuplas muertas que VACUUM no pudo quitar (máximo) | 841 |

## Listas de la API (ERS RNF-005, P95 < 2000 ms)

| Momento | Muestras | P50 (ms) | P95 (ms) | Máx. (ms) |
| --- | --- | --- | --- | --- |
| En reposo | 60 | 14.8 | 26.4 | 81 |
| Durante la generación | 47858 | 12.4 | 20.5 | 988.8 |

## Lease

| Clave | Valor |
| --- | --- |
| Renovaciones observadas | 29 |
| Sentencia de renovación sobre el job real (ms) | `{"samples":527,"p50":1.9,"p95":384.4,"max":4910.6}` |

## Concurrencia

| Clave | Valor |
| --- | --- |
| Segunda solicitud de la misma empresa | 409 |
| La otra empresa empezó después de terminar la primera (s) | 0.1 |
| Espera de la otra empresa en la cola (s) | 587.8 |

## Verificación previa y descarga

| Camino | Estado | SHA-256 | Cabeceras (ms) | Total (ms) | MiB/s | Crecimiento de la memoria |
| --- | --- | --- | --- | --- | --- | --- |
| directCold | 200 | Sí | 7578 | 14361 | 245 | backend +94.7 MiB; next +0 MiB |
| directWarm | 200 | Sí | 2608 | 8958 | 392 | backend +31 MiB; next +0 MiB |
| nextCold | 200 | Sí | 6966 | 14820 | 237 | backend +94.9 MiB; next +120.4 MiB |
| nextWarm | 200 | Sí | 2537 | 10195 | 345 | backend +29.8 MiB; next +16 MiB |

## Validación independiente del paquete

| Clave | Valor |
| --- | --- |
| unzipTest | sin errores |
| pythonZipfile | 592630 ok |
| sha256sum | 592629 archivos, todos OK |
| openpyxl | auditoria.xlsx:Eventos:300011;comprobantes.xlsx:Comprobantes:102001;comprobantes.xlsx:Transiciones:306000;comprobantes.xlsx:Intentos SRI:200942;comprobantes.xlsx:Retenciones:18001;comprobantes.xlsx:Destinatarios:9001;comprobantes.xlsx:Entregas:9345;empresa.xlsx:Configuración:3;empresa.xlsx:Establecimientos:3;empresa.xlsx:Puntos de emisión:3;empresa.xlsx:Secuenciales:1;empresa.xlsx:Catálogos habilitados:2;empresa.xlsx:Firmas:3;empresa.xlsx:Usuarios:14;inventario.xlsx:Existencias:10001;inventario.xlsx:Movimientos:300001;productos.xlsx:Productos:10001;productos.xlsx:Impuestos:10001;terceros.xlsx:Terceros:10002 |
| manifest | `{"formatVersion":"1","counts":{"documents":{"TEST":2000,"PRODUCTION":100000,"byType":{"01":72000,"03":6000,"04":8000,"05":4000,"06":6000,"07":6000},"byState":{"AUTHORIZED":93840,"NOT_AUTHORIZED":5100,"RETURNED":3060}},"artifacts":{"signedXml":102000,"authorizedXml":93840,"ride":93840,"sriResponses":200940,"logos":1},"files":592630}}` |
| validationSeconds | 470 |
| XSD (muestra de facturas) | 20 de 20 |

## Recuperación tras matar main.ts

| Clave | Valor |
| --- | --- |
| killedAtProgress | `{"done":25500,"total":102000}` |
| filesLeftByCrash | 1 |
| restartReadySeconds | 5.7 |
| reclaimSeconds | 50.4 |
| readyAfterRestartSeconds | 636.9 |
| finalAttempt | 2 |
| previousStatus | EXPIRED REPLACED |
| directoryAfterSweep | 2 |
| workAfterSweep | 0 |
| completedEvents | 1 |

## Worker obsoleto con dos instancias

| Clave | Valor |
| --- | --- |
| takeoverSeconds | 63.5 |
| finalAttempt | 2 |
| status | READY |
| completedEvents | 1 |
| failedEvents | 0 |
| staleRenewalsRejected | 1 |
| staleFilesLeft | 0 |

## Caducidad con el barrido

| Clave | Valor |
| --- | --- |
| Intervalo del barrido (s) | 10 |
| Caducado y borrado en (s) | 0.5 |

## Fallas

Ninguna.
