# Tasks

## 1. Contenedor ZIP64 y capa neutral del XLSX

- [x] 1.1 Primera tarea técnica (design D9): hacer un spike corto, fuera del código de producción, que compare ampliar el contenedor ZIP propio con ZIP64 (A) y una biblioteca de producción mantenida con ZIP64 y streaming real (B).
  - Criterios obligatorios:
    - ZIP64 con más de 65 535 entradas y más de 4 GiB;
    - entradas binarias desde streams con memoria acotada;
    - memoria del directorio central acotada;
    - STORE y DEFLATE por entrada;
    - nombres UTF-8 seguros y sin enlaces simbólicos;
    - bytes deterministas;
    - licencia compatible y mantenimiento razonable;
    - lectura con Python `zipfile`, `unzip -t`, 7-Zip y `bsdtar`.
  - Registrar la elección y su evidencia en `docs/architecture/adr/0024-*.md` y en `docs/architecture/stack.md`.
  - Si la elegida es una biblioteca de producción que cumple todos los criterios, añadirla (preautorizado). Si ninguna opción cumple, detener el apply y reportar el bloqueo.
  - Verificar que el ADR recoge las mediciones de las dos opciones con un paquete de más de 65 535 entradas y más de 4 GiB.
- [x] 1.2 Implementar el contenedor elegido en `data-portability/infrastructure`: escritura a un archivo con contrapresión, SHA-256 del paquete al vuelo, STORE para PDF, XLSX, PNG y JPEG, y DEFLATE para XML, JSON y texto. Verificar con pruebas que leen el paquete con un lector independiente:
  - más de 65 535 entradas;
  - una entrada y un total por encima de 4 GiB, en una prueba marcada como lenta;
  - las entradas binarias exactas;
  - los atributos de archivo regular;
  - los bytes deterministas;
  - la memoria acotada.
- [ ] 1.3 Mover `reports/infrastructure/xlsx/` a `platform/xlsx/` y `readOnlySnapshot` a `platform/db/` sin cambiar su comportamiento (design D8). Actualizar las importaciones de `reports` y sus pruebas. Verificar que la prueba de bytes deterministas del escritor da los mismos bytes, que las pruebas de los reportes pasan y que la prueba de arquitectura de `reports` sigue en verde

## 2. Registro, cola, contratos, permisos, entorno y auditoría

- [ ] 2.1 Crear la migración de `data_export` (design D10 y D24):
  - los estados y las fases con su `CHECK`;
  - los campos que exige cada estado;
  - el índice único parcial de una generación activa por empresa y el de un `READY` por empresa;
  - las FK y el índice por empresa y fecha.

  Documentarla en `docs/architecture/database.md`. Verificar con `migrations.test.ts` los `CHECK`, los dos índices únicos y el rechazo de un `READY` incompleto
- [x] 2.2 Añadir `renew` al `JobStore` (design D11), guardado por el dueño, el estado `LEASED` y el *lease* vigente, sin cambiar los demás métodos.
  - Si el cambio resultara inseguro para los jobs existentes, detener el apply y reportar el bloqueo.
  - Añadir también `fence`, con la identidad del arriendo (`id`, dueño y `attempt_count` como token monótono) y el *lease* vigente, bloqueando la fila en la transacción en curso (design D11).
  - Verificar con pruebas de integración de la cola:
    - la renovación extiende el *lease*;
    - una renovación tras perderlo lanza `LeaseLostError`;
    - `claim` no toma un job con el *lease* renovado ni uno bloqueado por `fence`;
    - el caso obligatorio: A toma el job, queda pausado, su *lease* vence, B lo toma y completa, y A vuelve: `renew` y `fence` de A fallan y A no cambia nada;
    - los jobs del SRI y del RIDE no cambian de comportamiento.
- [ ] 2.3 Crear `packages/contracts/src/data-portability.ts` (design D17):
  - el cuerpo estricto vacío del `POST`;
  - la vista de una exportación con estado, fase, progreso, `snapshotAt`, caducidad, tamaño como texto, SHA-256, conteos y código;
  - la lista paginada y los códigos de error;
  - sus rutas en `api/routes.ts`, con la descarga como respuesta binaria.

  Verificar con pruebas de contrato el `companyId` rechazado, cada estado y el OpenAPI regenerado
- [ ] 2.4 Añadir `dataPortability.export` solo para el administrador en `access-policy.ts`, su espejo del frontend y `access-control.md`, confirmando la fila "Exportar todos los datos del contribuyente" (design D18). Verificar con las pruebas de la política y la del documento
- [ ] 2.5 Añadir al esquema de entorno las variables de design D20, marcadas como hipótesis del benchmark, y documentarlas en `deployment.md` como defensas de recursos, con `DATA_EXPORT_DIRECTORY` como volumen persistente y privado en producción. Las variables son:
  - `DATA_EXPORT_DIRECTORY`;
  - `DATA_EXPORT_MAX_CONCURRENT`;
  - `DATA_EXPORT_TTL_HOURS`;
  - `DATA_EXPORT_DISK_HEADROOM_PERCENT`;
  - `DATA_EXPORT_DISK_RESERVE_MIB`;
  - `DATA_EXPORT_SWEEP_INTERVAL_SECONDS`.

  Verificar con pruebas del entorno
- [ ] 2.6 Añadir las acciones `data_export.requested`, `data_export.completed`, `data_export.failed` y `data_export.download_started` al dominio de la auditoría (design D19) y documentarlas, con las métricas de design D21, en `observability.md`. Verificar con la prueba de las acciones de auditoría y la de `assertNoSecrets` con las claves de D19

## 3. Fuentes de portabilidad de los módulos dueños

- [ ] 3.1 Exportar desde `taxpayer` las versiones de la configuración, los logos por identificador con su tamaño y su SHA-256, los establecimientos, los puntos y el punto predeterminado de cada membresía. Exportar desde `fiscal` los secuenciales, desde `catalogs` las habilitaciones de la empresa y desde `signing` solo los metadatos de las firmas (design D1). Verificar con pruebas de integración:
  - cada versión y cada estado;
  - el aislamiento por empresa;
  - que ninguna fuente expone columnas de `signing_certificate_secret`.
- [ ] 3.2 Exportar desde `identity` los miembros de la empresa con nombre, correo, rol, estado y desde cuándo, sin ninguna columna de `account`, `session`, `verification` ni `invitation`, y desde `parties`, `products` (con sus impuestos), `inventory` (existencias y kárdex) y `audit` sus conjuntos completos en todos sus estados, por lotes con cursor y en un orden total. Verificar con pruebas de integración:
  - los inactivos;
  - el saldo registrado sin recalcular;
  - los eventos de auditoría sin IP;
  - el aislamiento por empresa.
- [ ] 3.3 Exportar desde `fiscal` el inventario de comprobantes de los seis tipos desde la reserva, en los dos ambientes y en todos sus estados. Incluye la fila de cada comprobante con la proyección de importes por tipo del cambio 15, sus transiciones, sus intentos con el SRI, sus entregas, los identificadores, tamaños y SHA-256 de sus artefactos y respuestas, y el estado del job del RIDE. Exportar también las lecturas por identificador del snapshot, de los artefactos y de las respuestas, y desde `withholding-receipts` y `shipping-guides` las líneas de retención y los destinatarios. Verificar con pruebas de integración:
  - los seis tipos;
  - ningún borrador;
  - el tercero congelado tras corregirlo;
  - el intento sin respuesta;
  - la respuesta truncada;
  - el aislamiento por empresa.
- [ ] 3.4 Añadir la prueba de arquitectura de `data-portability`: nadie lo importa, no importa `reports` ni lee tablas de otros módulos, y solo usa las fuentes que compone `main.ts`. Documentar las fuentes y la dirección en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba detecta cada violación en archivos de ejemplo

## 4. Generación del paquete

- [ ] 4.1 Implementar el dominio (design D2, D3 y D13):
  - la gramática y la construcción de las rutas;
  - el nombre del paquete desde `generatedAt` en Ecuador;
  - el manifiesto con su versión, sus conteos, sus formatos, sus exclusiones y los ausentes con su motivo;
  - las líneas de `SHA256SUMS`;
  - el texto de `LEEME.txt`;
  - la política de artefactos esperados, ausentes legítimos y faltantes por invariante.

  Verificar con pruebas unitarias:
  - una razón social `../../etc/passwd` nunca llega a una ruta;
  - la gramática rechaza `/` inicial, `\`, `..`, rutas absolutas y caracteres de control o de salto de línea;
  - una ruta repetida falla, nunca se acepta en silencio;
  - el orden de `SHA256SUMS` es estable y no se incluye a sí mismo;
  - el mismo número en los dos ambientes no colisiona;
  - el nombre sin RUC;
  - el manifiesto sin inventario;
  - `RIDE_PENDING`, `RIDE_STOPPED` y el `RESERVED` sin ausentes.
- [ ] 4.2 Implementar la fase 1 (design D12):
  - la transacción `REPEATABLE READ, READ ONLY` con `snapshotAt`;
  - los seis libros con las hojas de design D4, divididas por encima de 1 048 575 filas de forma determinista;
  - el inventario del paquete a un temporal.

  Verificar con pruebas de integración:
  - los tipos de celda (identificación como texto, 106.00 como número exacto, el valor que excede la precisión como texto, `=HYPERLINK` como texto sin fórmula y la fecha sin desplazamiento);
  - la división de una hoja en máximo menos uno, máximo y máximo más uno filas de datos, con el encabezado repetido y sin perder ni repetir filas en el límite, con el límite real en la escritura y con uno reducido inyectado;
  - un comprobante emitido y un tercero editado después de `snapshotAt` que no entran.
- [ ] 4.3 Implementar la fase 2 (design D7, D12 y D13):
  - la lectura por lotes de los snapshots, los artefactos, las respuestas y los logos del inventario;
  - la verificación de su tamaño y su SHA-256 antes de agregarlos;
  - el paquete con `SHA256SUMS` al final;
  - la reserva de disco con `fs.statfs` antes de la fase 1 y de la fase 2 (design D20).

  Verificar con pruebas de integración:
  - un artefacto, una respuesta y un logo alterados fallan cerrado sin paquete;
  - un XML autorizado faltante en un `AUTHORIZED` falla con `DATA_EXPORT_ARTIFACT_MISSING`;
  - un comprobante autorizado durante la generación sale firmado y sin XML autorizado;
  - sin espacio, falla con `DATA_EXPORT_INSUFFICIENT_SPACE` antes de la fase 2, sin parcial;
  - un `ENOSPC` inesperado a mitad del ZIP falla con el mismo código, borra el parcial y no publica;
  - el XML autorizado del paquete es idéntico al de la descarga de la bandeja;
  - `sha256sum -c` sobre el paquete descomprimido pasa.
- [ ] 4.4 Implementar las dos capas de design D6:
  - **A:** una prueba de las proyecciones que enumera las columnas de cada fuente y comprueba que ninguna es de `signing_certificate_secret`, `account`, `session`, `verification` ni `invitation`, ni `user.password`, IP o user agent;
  - **B:** una prueba del paquete completo que siembra marcadores en una firma de prueba (archivo y contraseña), en los campos cifrados y la clave envuelta, en un hash de contraseña, una sesión, una verificación, una invitación, un análogo del secreto de autenticación, una IP, un user agent y un borrador, y los busca en claro y en base64 en cada entrada descomprimida, sin descifrar nada.

  Verificar que ninguno aparece y que el manifiesto y `LEEME.txt` declaran las exclusiones
- [ ] 4.5 Implementar el job `portability.export` (design D10, D11 y D14):
  - el runner propio con `DATA_EXPORT_MAX_CONCURRENT` lazos;
  - el heartbeat de renovación con aborto al perder el *lease*;
  - los archivos por intento con `0600`, `fsync`, el renombrado y `0400`;
  - el orden de completar de design D11: ZIP cerrado con su SHA-256 y tamaño, `fsync`, renombrado atómico, `fsync` del directorio, y una sola transacción con `fence`, el anterior a `EXPIRED` (`REPLACED`), `READY` con `expires_at` desde ese momento, `data_export.completed` y `complete`;
  - los fallos reintentables y deterministas con sus códigos;
  - `data_export.completed` y `data_export.failed`.

  Verificar con pruebas de integración:
  - una generación más larga que el *lease* base;
  - un worker perdido que no publica;
  - dos runners con una sola generación publicada;
  - la generación fallida que conserva el `READY` anterior;
  - el worker obsoleto: A pausado tras el *lease*, B completa, A vuelve y no publica, no marca `READY`, no completa ni registra `completed`, y su intento se limpia;
  - una transacción final fallida que no deja `READY` ni `completed` y cuyo archivo borra el barrido;
  - `expires_at` contado desde `READY`, no desde la solicitud;
  - los eventos sin rutas.
- [ ] 4.6 Implementar el barrido y la recuperación al arrancar (design D14 y D15):
  - los `READY` vencidos pasan a `EXPIRED` (`TTL`);
  - los `READY` vigentes con el archivo faltante o de otro tamaño pasan a `FAILED` (`DATA_EXPORT_PACKAGE_MISSING` o `DATA_EXPORT_PACKAGE_INTEGRITY`) con `data_export.failed`, nunca a `EXPIRED`;
  - se borran los parciales, los directorios de trabajo y los archivos sin fila válida;
  - solo se borran nombres de la gramática, sin seguir enlaces.

  Verificar con pruebas de integración cada caso, que un enlace simbólico en el directorio no se sigue y que ningún dato de la empresa cambia
- [ ] 4.7 Documentar el formato `PORTABILITY_FORMAT_V1` en `docs/architecture/data-portability-format.md`:
  - la estructura y las rutas;
  - el manifiesto;
  - `SHA256SUMS`;
  - cada libro con sus hojas, columnas y tipos de celda;
  - el esquema de cada `snapshotVersion`;
  - los ausentes;
  - las exclusiones.

  Documentar el módulo en `docs/architecture/data-portability.md`, enlazado desde `ARCHITECTURE.md`. Verificar con una prueba que el documento cita cada hoja y cada columna que generan los libros

## 5. API y descarga

- [ ] 5.1 Implementar `POST /api/v1/data-exports` (`202`), `GET /api/v1/data-exports` y `GET /api/v1/data-exports/{id}` con `dataPortability.export` (design D10 y D17), con `data_export.requested` en la transacción de la solicitud. Verificar con pruebas de integración por HTTP:
  - la solicitud en cola, con la fila, el job y el evento creados juntos, y nada de los tres si la transacción falla;
  - la segunda solicitud con `409 DATA_EXPORT_IN_PROGRESS`;
  - dos solicitudes simultáneas con una sola generación;
  - la generación de otra empresa en cola;
  - el progreso y la vista lista;
  - el operador con `403` y sin sesión con `401`;
  - otra empresa con `404`;
  - `companyId` rechazado;
  - ningún evento ante un rechazo.
- [ ] 5.2 Implementar `GET /api/v1/data-exports/{id}/download` (design D16), en este orden:
  - el estado y la vigencia;
  - el tamaño y el SHA-256 completos sobre el mismo descriptor antes de cualquier cabecera;
  - `data_export.download_started` antes del primer byte, sin entregar si falla;
  - las cabeceras de adjunto con nombre ASCII, `no-store` y `nosniff`;
  - el streaming desde el descriptor;
  - `HEAD` con `405`.

  Verificar con pruebas de integración:
  - la descarga con el SHA-256 de la vista;
  - el paquete alterado en el disco, sin ningún byte, con `500 DATA_EXPORT_PACKAGE_INTEGRITY` y la exportación `FAILED`;
  - el paquete borrado del disco, con `500 DATA_EXPORT_PACKAGE_MISSING` y la exportación `FAILED`;
  - `409` en cola o generándose;
  - `410` caducado;
  - la auditoría que falla, sin entregar;
  - dos descargas, dos eventos;
  - `403`, `401` y otra empresa con `404`.
- [ ] 5.3 Documentar las rutas, los estados, los códigos y la descarga en `docs/architecture/data-portability.md`, y actualizar "Background Jobs" de `backend.md` (design D25). Verificar con una prueba que el documento cita cada ruta registrada, las variables reales, el permiso y las acciones

## 6. Pantalla Portabilidad de datos

- [ ] 6.1 Implementar Portabilidad de datos en `/configuracion/portabilidad`, en el grupo Configuración, con `dataPortability.export` (design D23):
  - la explicación de lo incluido y lo excluido: no es un respaldo, sin la firma, con Pruebas y Producción y sin los borradores;
  - "Generar exportación", con la confirmación al generar de nuevo con un paquete vigente;
  - el estado y el progreso consultados mientras está en cola o generándose;
  - el momento del snapshot, la caducidad, el tamaño y el SHA-256 copiable;
  - la descarga por navegación, sin `Blob`;
  - la historia paginada con tarjetas por debajo de 768 px;
  - los mensajes del `409`, de cada código de falla y de la caducidad.

  Verificar con pruebas de componente:
  - la carga, el vacío, el error con reintento y sin permiso;
  - la cola, el progreso, el listo, el fallido y el caducado;
  - la confirmación;
  - el enlace de descarga;
  - la entrada de la navegación, solo para el administrador.
- [ ] 6.2 Documentar la pantalla, su ruta y su permiso en `docs/architecture/data-portability.md`. Verificar que coincide con la navegación implementada
- [ ] 6.3 Revisar la pantalla con `docs/quality/frontend-checklist.md` contra el backend real, a través de la reescritura `/api/*` del frontend, con datos sintéticos en un esquema y un directorio aislados. La revisión cubre escritorio, 375 y 320 px, los temas claro y oscuro, el teclado y el contraste.
  - Descargar un paquete por el navegador y verificarlo con `sha256sum -c`, Python `zipfile` y openpyxl.
  - Gate del streaming (design D16): descargar un paquete de varios GB a través de la reescritura `/api/*` midiendo la memoria residente del backend y del proceso de Next. Si Next lo almacena, corregir el enrutado con una ruta del mismo origen que preserve el streaming y la sesión antes de cerrar.
  - Registrar la revisión en `openspec/changes/add-data-portability/ui-review.md`.
  - Verificar que no quedan hallazgos abiertos.

## 7. Rendimiento, end-to-end y verificación

- [ ] 7.1 Añadir `bench:data-portability` en `backend/scripts/` (design D22), con el volumen de Q-26, artefactos de tamaño real, respuestas del SRI, auditoría y kárdex. Debe medir:
  - el reloj de cada fase y el total, la CPU, la memoria máxima, el disco temporal máximo, el tamaño del ZIP y sus entradas;
  - la duración y la presión MVCC de la transacción de la fase 1;
  - el costo de la verificación previa a la descarga;
  - el P95 de una lista de la API durante la generación;
  - la memoria residente del proceso de Next durante la descarga a través de `/api/*`;
  - el costo del heartbeat y de la renovación;
  - la cola entre empresas, el `409`, la recuperación tras matar el proceso, el worker obsoleto y la caducidad con el barrido.

  Registrar el resultado en `docs/quality/benchmarks/` y en `performance.md`, y fijar con la evidencia los valores de design D20 en el entorno y en `deployment.md`. Si la fase 1, la verificación previa o la generación en el proceso de la API no son sanas, corregir el design con `/opsx:update`. Verificar que el paquete del benchmark pasa `unzip -t`, `sha256sum -c` y la lectura con Python `zipfile` y openpyxl
- [ ] 7.2 Añadir la prueba end-to-end sobre `main.ts`:
  - comprobantes sintéticos de los seis tipos en los dos ambientes, con sus artefactos y respuestas, configuración con logo y varias versiones, terceros, productos, inventario, auditoría, una firma cargada y borradores;
  - solicitar la exportación por HTTP, esperar `READY`, descargarla y verificar `SHA256SUMS`, el manifiesto, los libros, los snapshots y los bytes de cada artefacto;
  - comprobar la ausencia de los secretos y de los borradores;
  - comprobar los cuatro eventos de auditoría y que los datos de la empresa no cambian;
  - comprobar que un reinicio a mitad de la generación termina con un solo paquete.

  Verificar que la prueba pasa
- [ ] 7.3 Ejecutar `corepack pnpm verify` y `openspec validate --all --strict`, y verificar que pasan formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact`, `check:ride-assets` y la validación de los specs
