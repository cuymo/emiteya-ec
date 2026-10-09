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
   - el disco debe tener el tamaño sin comprimir de lo inventariado más su margen (`DATA_EXPORT_DISK_HEADROOM_PERCENT`) y la reserva; si no, falla con `DATA_EXPORT_INSUFFICIENT_SPACE`;
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

## Rendimiento

`bench:data-portability` (design D22; `../quality/benchmarks/data-portability-2026-10-08.md`) genera el paquete de una empresa con el volumen de Q-26 en unos 10 min: 3.68 GB y 592 630 entradas, con unos 0,9 núcleos, 723 MiB de memoria residente y un pico de 3,7 GiB de disco, sin afectar a las listas de la API. La verificación previa a la descarga tarda de 2,5 a 7,6 s en un SSD con ese paquete, y de 8 a 11 s por GiB en un disco giratorio (`openspec/changes/add-data-portability/ui-review.md`).

## Sistema de archivos y barrido

- **Directorio:** `DATA_EXPORT_DIRECTORY` (`0700`), con `work/<exportId>-<intento>/` (`0700`) para los libros, el inventario y `SHA256SUMS` temporales. Se borra siempre al terminar.
- **Barrido**, al arrancar y cada `DATA_EXPORT_SWEEP_INTERVAL_SECONDS`:
  - un paquete listo vencido pasa a `EXPIRED` (`TTL`) y se borra;
  - uno listo y vigente cuyo archivo falta pasa a `FAILED` con `DATA_EXPORT_PACKAGE_MISSING`, y uno que no tiene su tamaño, con `DATA_EXPORT_PACKAGE_INTEGRITY`, nunca a `EXPIRED`;
  - se borran los parciales, los trabajos y los paquetes que no pertenecen a un paquete listo ni al intento de una generación en curso.
  - Solo toca nombres de la gramática de la portabilidad, sin seguir enlaces, y nunca un dato ni un artefacto de la empresa.

## Estados

| Estado | Significado | Sale a |
| --- | --- | --- |
| `QUEUED` | En cola, con su job `portability.export` pendiente | `GENERATING`; `FAILED` |
| `GENERATING` | Generándose, con la fase (`SNAPSHOT`, `ARTIFACTS`, `PUBLISHING`) y, solo cuando se conoce el total, los comprobantes agregados (`progress.done` de `progress.total`); nunca un porcentaje | `READY`; `FAILED`; un nuevo intento la retoma desde el principio |
| `READY` | Listo y vigente hasta `expiresAt`, `DATA_EXPORT_TTL_HOURS` después de quedar listo (no de solicitarse) | `EXPIRED` (`TTL` o `REPLACED`); `FAILED` (`DATA_EXPORT_PACKAGE_MISSING` o `DATA_EXPORT_PACKAGE_INTEGRITY`) |
| `FAILED` | Fallida con su código seguro | Final |
| `EXPIRED` | Caducada por vencimiento (`TTL`) o por un paquete nuevo (`REPLACED`); su archivo se borra | Final |

- `EXPIRED` es solo para el vencimiento y el reemplazo; un paquete listo perdido o alterado antes de caducar queda `FAILED`.
- A lo sumo una generación activa (`QUEUED` o `GENERATING`) y un `READY` por empresa. Mientras se genera una nueva, el `READY` anterior sigue descargable; cuando la nueva queda lista, el anterior caduca con `REPLACED` en la misma transacción. Si la nueva falla, el anterior sigue vigente hasta su caducidad.
- **Códigos de las fallas** (`errorCode`), sin rutas ni detalles internos:
  - `DATA_EXPORT_ARTIFACT_INTEGRITY`: un artefacto, una respuesta del SRI o un logo no coincide con su tamaño o su SHA-256;
  - `DATA_EXPORT_ARTIFACT_MISSING`: falta un artefacto que el estado del comprobante exige;
  - `DATA_EXPORT_INSUFFICIENT_SPACE`: el disco no tiene la reserva;
  - `DATA_EXPORT_SNAPSHOT_TIMEOUT`: la fase 1 superó su plazo;
  - `DATA_EXPORT_LIMIT`: un límite del formato;
  - `DATA_EXPORT_FAILED`: se agotaron los intentos;
  - `DATA_EXPORT_PACKAGE_MISSING`: el paquete listo desapareció antes de caducar;
  - `DATA_EXPORT_PACKAGE_INTEGRITY`: el paquete listo no tiene su tamaño o su SHA-256 antes de caducar.

## API

Las rutas exigen `dataPortability.export`, que solo tiene el administrador, y la empresa sale siempre de la sesión. Sin sesión responden `401`; el operador, `403`; una exportación de otra empresa, `404`, como si no existiera. Un rechazo no registra ningún evento.

| Ruta | Respuesta |
| --- | --- |
| `POST /api/v1/data-exports` | `202` con la exportación `QUEUED`. El cuerpo es `{}` estricto: un `companyId` u otro campo responde `400 VALIDATION_ERROR`. Con una generación activa de la empresa, `409 DATA_EXPORT_IN_PROGRESS`, también para solicitudes simultáneas, sin otra fila, otro job ni otro evento |
| `GET /api/v1/data-exports` | Las exportaciones de la empresa, la más reciente primero, paginadas con `page` y `pageSize` |
| `GET /api/v1/data-exports/{id}` | La exportación, o `404 DATA_EXPORT_NOT_FOUND` |
| `GET /api/v1/data-exports/{id}/download` | El paquete; ver "Descarga" |

- **La vista** (`dataExportViewSchema`): estado, fase, progreso, quién la pidió (solo el nombre), los momentos de solicitud, inicio, snapshot, generación, caducidad y fin, el tamaño (texto decimal), el SHA-256 del paquete, la versión del formato, los conteos (los comprobantes por ambiente), el código de la falla y el motivo de la caducidad. Nunca el nombre interno del archivo ni el directorio.
- **Errores de la API:**
  - `409 DATA_EXPORT_IN_PROGRESS`: ya hay una en cola o generándose;
  - `404 DATA_EXPORT_NOT_FOUND`: no existe en la empresa de la sesión;
  - `409 DATA_EXPORT_NOT_READY`: en cola, generándose o fallida;
  - `410 DATA_EXPORT_EXPIRED`: caducada, o lista con `expiresAt` vencido aunque el barrido no haya pasado;
  - `500 DATA_EXPORT_PACKAGE_MISSING` y `500 DATA_EXPORT_PACKAGE_INTEGRITY`: ver "Descarga".
- No hay cancelación en la versión 1: una generación termina lista o fallida.

## Descarga

`GET /api/v1/data-exports/{id}/download` comprueba todo antes del primer byte, en este orden:

1. la sesión, el permiso, la empresa (`404`), el estado `READY` (`409`) y la vigencia (`410`);
2. abre el paquete sin seguir enlaces y calcula su tamaño y su SHA-256 completos sobre ese mismo descriptor:
   - si el archivo falta: `FAILED` con `DATA_EXPORT_PACKAGE_MISSING`;
   - si el tamaño o el SHA-256 no coinciden: `FAILED` con `DATA_EXPORT_PACKAGE_INTEGRITY`;
   - en los dos casos registra `data_export.failed`, cuenta `integrity_failed` y responde `500` en JSON, sin ningún byte del paquete ni una ruta;
3. registra `data_export.download_started`; si no puede registrarlo, responde `500` sin ningún byte y la exportación sigue lista;
4. las cabeceras:
   - `Content-Type: application/zip`;
   - `Content-Length`;
   - `Content-Disposition: attachment; filename="datos-AAAAMMDD-HHMMSS.zip"`, ASCII, con la hora de Ecuador de la generación y sin datos personales;
   - `Cache-Control: no-store`;
   - `X-Content-Type-Options: nosniff`;
5. el cuerpo, por streaming desde el mismo descriptor en bloques de 1 MiB, y el descriptor se cierra al terminar.

- `HEAD` responde `405` con `Allow: GET`: nunca verifica ni audita una descarga. No hay rangos ni enlaces firmados o públicos.
- **En el frontend:** el reenvío general de `/api` (`next.config.ts`) corta una respuesta que no empieza en 30 s, y la verificación de un paquete de varios GB dura más. La descarga tiene su ruta del mismo origen, `frontend/src/app/api/v1/data-exports/[id]/download/route.ts`, que reenvía la cookie al backend (`API_INTERNAL_URL`, leída en cada descarga) sin plazo y devuelve su respuesta por streaming, sin almacenarla. El reenvío general es `fallback` para que esa ruta dinámica tenga prioridad. La autenticación, el permiso y la verificación siguen siendo del backend. Para el proxy de producción, ver "Proxy inverso y descarga" en `deployment.md`.
- Una desconexión durante la verificación la abandona: no registra `data_export.download_started` ni responde, porque la descarga no empezó.
- Una desconexión durante el envío no es un error del servidor. `data_export.download_started` registra que la descarga empezó, no que llegó completa; dos descargas son dos eventos.
- La métrica `data_export_downloads_total` cuenta cada resultado (`started`, `not_ready`, `expired`, `integrity_failed`, `aborted`).

## Pantalla

Portabilidad de datos, en `/configuracion/portabilidad`, en el grupo Configuración de la navegación y solo con `dataPortability.export` (design D23; `frontend/src/features/data-portability/`). El operador no ve la entrada y, si abre la ruta, ve que no tiene acceso, sin consultar exportaciones.

- **P0:** el estado de la exportación vigente con su acción:
  - "Generar exportación" sin una en curso. Con un paquete vigente es la acción secundaria y pide confirmar: el actual sigue disponible y caduca cuando el nuevo queda listo;
  - "Descargar paquete" con un paquete listo y vigente.
- **El estado:** En cola, Generando, Lista, Fallida o Expirada, con la fase y, solo cuando se conoce el total, "N de M comprobantes", nunca un porcentaje. Se consulta cada 2 s mientras hay una en cola o generándose, y cada minuto con un paquete listo; uno cuya caducidad pasó se muestra expirado aunque el barrido todavía no pasó.
- **P1:** el momento de los datos (`snapshotAt`), la caducidad, el tamaño y el SHA-256 en monoespaciado, partido y con un botón para copiarlo.
- **La descarga** es un enlace del mismo origen con el aspecto de un botón (`download`), que el navegador sigue: el paquete nunca pasa por `fetch` ni por un `Blob`. Después del clic, la pantalla vuelve a consultar, y un paquete que no pasó la verificación aparece fallido con su explicación.
- **Mensajes:** cada código de falla y la caducidad se explican sin detalles internos, con lo que se puede hacer. El `409` de una exportación ya en curso lo explica un aviso y la pantalla muestra la que está en curso. Una falla más reciente que el paquete vigente se explica junto a él.
- **P2:** lo incluido y lo excluido, como texto con dos listas: los dos ambientes, sin la firma ni los secretos, sin los datos de autenticación ni los borradores, que no es un respaldo y que caduca 24 horas después de quedar listo; y la historia paginada en `AppDataTable`, con tarjetas por debajo de 768 px.
- **P3:** los identificadores internos, que no se muestran.
