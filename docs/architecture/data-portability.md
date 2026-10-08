# Portabilidad de datos

El módulo `data-portability` (`add-data-portability`) exporta los datos y artefactos de la empresa
en el paquete `PORTABILITY_FORMAT_V1` (ERS SEC-010; Q-28). El formato se documenta en
`data-portability-format.md`; las decisiones, en el design del cambio, el ADR 0024 y "Trazabilidad
de `data-portability`" de `../product/capabilities.md` (BR-96 a BR-101 de
`../product/domain-model.md`). No es un respaldo: la restauración es la del respaldo operativo
(`deployment.md`, AC-10).

## Módulo `data-portability`

- **`domain/`:**
  - `format.ts`: la gramática y la construcción de las rutas, el nombre del paquete, la guarda de rutas repetidas sin memoria creciente, las líneas de `SHA256SUMS` y la política de los artefactos esperados y ausentes;
  - `manifest.ts`: el manifiesto, las exclusiones y `LEEME.txt`;
  - `sheets.ts`: las hojas de los seis libros con sus columnas y el tipo de cada celda.
- **`application/`:**
  - `ports.ts`: las fuentes de los módulos dueños, la base, el escritor XLSX y el contenedor ZIP;
  - `generate.ts`: las dos fases de la generación;
  - `errors.ts`: los códigos seguros de las fallas y los errores de la API.
- **`infrastructure/`:**
  - `zip64.ts`: el contenedor ZIP64 propio (ADR 0024);
  - `prisma-data-exports.ts`: el registro de las exportaciones (`data_export`);
  - `package-files.ts`: el directorio privado;
  - `export-job.ts`: el job `portability.export`;
  - `sweeper.ts`: el barrido y la recuperación;
  - `metrics.ts` y `prisma-portability-database.ts`.
- **Dirección:** no lee tablas de otros módulos ni importa `reports`; compone las fuentes de los dueños (`backend.md`, "Portabilidad de datos"). Lo comprueba `backend/test/architecture/data-portability-dependency-direction.test.ts`.

## Generación

1. **Fase 1, base de datos.** Una transacción `REPEATABLE READ, READ ONLY` (`platform/db/read-only-snapshot.ts`) fija `snapshotAt` con `transaction_timestamp()`. Dentro de ella:
   - cada conjunto se cuenta y se escribe por lotes con un cursor en su libro, dividido en hojas si supera 1 048 575 filas de datos;
   - el inventario del paquete se escribe a un temporal: por comprobante, su carpeta y los identificadores, tamaños y SHA-256 de sus artefactos y de sus respuestas;
   - se fijan los logos y los ausentes legítimos;
   - un XML que el estado exige y falta hace fallar la exportación con `DATA_EXPORT_ARTIFACT_MISSING`.

   Antes de empezar, el disco debe tener la reserva fija (`DATA_EXPORT_DISK_RESERVE_MIB`).
2. **Fase 2, artefactos.** Ya sin transacción:
   - el disco debe tener el tamaño sin comprimir de lo inventariado más su margen y la reserva; si no, falla con `DATA_EXPORT_INSUFFICIENT_SPACE`;
   - se escriben, en este orden, el manifiesto, `LEEME.txt`, los libros, las carpetas de los comprobantes y los logos;
   - cada artefacto, respuesta o logo se lee por identificador y se escribe solo si su tamaño y su SHA-256 recalculados coinciden con los inventariados; si no, la exportación falla con `DATA_EXPORT_ARTIFACT_INTEGRITY`;
   - nada creado después de `snapshotAt` entra: no está en el inventario;
   - `SHA256SUMS` se escribe al final, y el SHA-256 del paquete se calcula mientras se escribe.

## Job, *lease* y publicación

- **Solicitud.** Crea la fila `QUEUED`, el job `portability.export` y `data_export.requested` en una sola transacción. La unicidad de `active_company_id` deja una sola generación activa por empresa.
- **Runner propio** con `DATA_EXPORT_MAX_CONCURRENT` lazos. Las exportaciones de otras empresas esperan en la cola durable.
- **Fencing.** La identidad de un arriendo es el job, su dueño y su `attempt_count`, que `claim` incrementa en cada toma.
  - `JobStore.renew` lo extiende cada 20 s sobre un *lease* base de 60 s; si una renovación falla, la generación se aborta.
  - `JobStore.fence` lo comprueba y bloquea la fila del job en la transacción final.
  - Un worker que perdió el *lease* nunca publica, nunca completa el job y nunca registra un evento.
- **Publicación:**
  1. el ZIP se cierra con su SHA-256 y su tamaño, y se hace su `fsync`;
  2. el renombrado atómico de `<exportId>-<intento>.partial` a `<exportId>-<intento>.zip`, con `0400` y el `fsync` del directorio;
  3. una sola transacción que hace `fence`, pasa el paquete vigente anterior a `EXPIRED` (`REPLACED`), deja este `READY` con `expires_at` = ahora + `DATA_EXPORT_TTL_HOURS`, registra `data_export.completed` y hace `complete` del job.
  - Si esa transacción falla, nada queda listo y el archivo publicado se borra.
- **Fallas:**
  - una determinista (integridad, artefacto faltante, espacio, límite del formato o plazo de la fase 1) deja `FAILED` con su código y `data_export.failed`, y detiene el job;
  - una inesperada se reintenta desde el principio hasta `EXPORT_MAX_ATTEMPTS` (3), y entonces queda `DATA_EXPORT_FAILED`.

## Sistema de archivos y barrido

- **Directorio:** `DATA_EXPORT_DIRECTORY` (`0700`), con `work/<exportId>-<intento>/` (`0700`) para los libros, el inventario y `SHA256SUMS` temporales. Se borra siempre al terminar.
- **Barrido**, al arrancar y cada `DATA_EXPORT_SWEEP_INTERVAL_SECONDS`:
  - un paquete listo vencido pasa a `EXPIRED` (`TTL`) y se borra;
  - uno listo y vigente cuyo archivo falta o no tiene su tamaño pasa a `FAILED` (`DATA_EXPORT_PACKAGE_MISSING` o `DATA_EXPORT_PACKAGE_INTEGRITY`), nunca a `EXPIRED`;
  - se borran los parciales, los trabajos y los paquetes que no pertenecen a un paquete listo ni al intento de una generación en curso.
  - Solo toca nombres de la gramática de la portabilidad, sin seguir enlaces, y nunca un dato ni un artefacto de la empresa.
