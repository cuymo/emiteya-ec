# Design

## Context

El ERS pide un mecanismo para exportar los datos y artefactos del contribuyente (SEC-010). La revisión
de readiness del 2026-10-08 fijó el alcance con las decisiones D1 a D9 del dueño del producto
(Trazabilidad de `data-portability` en `docs/product/capabilities.md`; Q-28 resuelta con
`PORTABILITY_FORMAT_V1`; BR-96 a BR-101). Ver proposal.md para la motivación.

Lo que ya existe y este cambio reutiliza:

- **Datos de la empresa:** todos viven en PostgreSQL y casi todo lo fiscal es inmutable o de solo agregado.
  - Artefactos (`document_artifact`), respuestas del SRI (`sri_response`) y logos (`configuration_asset`): `bytea` con su SHA-256 y su tamaño, protegidos por triggers de solo agregado y un `CHECK` de tamaño.
  - El snapshot congelado de cada comprobante.
  - Las transiciones de estado, el kárdex (`stock_movement`) y la auditoría.
  - Los datos mutables son los terceros, los productos, los establecimientos y puntos, los secuenciales, el estado del comprobante, el saldo del inventario y las membresías.
- **Integridad:**
  - La descarga del archivo verifica el hash y falla cerrada (`fiscal/application/archive/downloads.ts`).
  - El almacén de artefactos (`prisma-artifacts.ts`) no verifica al leer.
  - El GET del logo y la lectura de las respuestas del SRI tampoco verifican.
- **RIDE:** se genera una vez por un job y se guarda. Un comprobante autorizado puede no tenerlo todavía (pendiente o detenido, `rideStatusOf`).
- **Cola durable** (`platform/jobs`, ADR 0012):
  - selección con `FOR UPDATE SKIP LOCKED`, `job.document_id` nulo permitido y deduplicación por clave activa;
  - no renueva el *lease*: el `JobStore` no tiene `renew` ni heartbeat.
- **Escritor XLSX del cambio 15** (`reports/infrastructure/xlsx`, ADR 0023):
  - primitivas verificadas de texto, número seguro, decimal exacto como texto, fecha, momento y defensa contra fórmulas;
  - su contenedor ZIP no tiene ZIP64, solo acepta texto, siempre comprime y guarda el directorio central en memoria.
  - La regla de arquitectura "nadie importa `reports`" impide usarlo desde otro módulo donde está.
- **Lectura consistente de los reportes:** `readOnlySnapshot` (`REPEATABLE READ, READ ONLY`, plazo de 5 min), en `reports/infrastructure`.
- **Despliegue:** una sola instancia de API (`deployment.md`, "Número de instancias").
- **Frontend:**
  - Next.js reescribe `/api/*` hacia el backend;
  - las descargas actuales cargan el archivo en un `Blob` (`apiFetchFile`), algo que no sirve para varios GB.
- **Volumen** (Q-26 y benchmarks previos), estimado en el readiness:
  - 100 000 comprobantes de unos 57 KB cada uno sin comprimir;
  - unos 5,7 GB sin comprimir y unos 2,6 GB comprimidos;
  - de 500 000 a 600 000 entradas en el ZIP.

## Goals / Non-Goals

**Goals:**

- Un paquete autodescriptivo, versionado e interpretable sin la aplicación, cuya integridad se verifique con herramientas estándar.
- Un momento consistente sin sostener una transacción durante la copia de GB.
- Fallar cerrado ante cualquier artefacto alterado y nunca entregar un paquete parcial.
- Memoria y disco acotados, con defensas medidas.
- Respetar la dirección de dependencias: el módulo de portabilidad no lee tablas ajenas ni importa `reports`.

**Non-Goals:**

- Importar, restaurar o reabrir el paquete, o cualquier ida y vuelta (D1 del readiness).
- Respaldos de la base de datos o la verificación de AC-10.
- Cancelar una generación en curso: la versión 1 no tiene estado `CANCELLED`. La generación termina o falla.
- Exportaciones filtradas, programadas, por correo o con un enlace firmado.
- Varias instancias de API compartiendo el directorio del paquete (ver Risks).

## Decisions

### D1. Módulo `data-portability` y dirección de las dependencias

- Módulo nuevo `data-portability`, con:
  - `domain/`: formato, rutas, manifiesto, estados y política de ausentes;
  - `application/`: solicitud, generación por fases, descarga y barrido;
  - `infrastructure/`: HTTP, registro de las exportaciones, sistema de archivos, contenedor ZIP y composición.
- No lee tablas de otros módulos. Cada dueño exporta una **fuente de portabilidad** de solo lectura, que `main.ts` compone como puerto:
  - `taxpayer`: versiones de la configuración, logos (por identificador, con su SHA-256 y tamaño), establecimientos, puntos y el punto predeterminado de cada membresía;
  - `catalogs`: las habilitaciones de catálogos de la empresa;
  - `signing`: los metadatos de las firmas (nunca `signing_certificate_secret`);
  - `identity`: los miembros de la empresa con nombre, correo, rol y estado (nunca las tablas internas de Better Auth);
  - `parties`, `products` (con sus impuestos) e `inventory` (existencias y kárdex);
  - `fiscal`:
    - los secuenciales;
    - el inventario de comprobantes con su estado, sus transiciones, sus intentos con el SRI y sus entregas;
    - el snapshot, los artefactos y las respuestas del SRI por identificador;
    - la fila de cada comprobante con la proyección de importes por tipo del cambio 15 (las `report-amounts.ts` de cada módulo), sin pasar por `reports`;
  - `withholding-receipts` y `shipping-guides`: las líneas de retención y los destinatarios de la guía, como en el cambio 15;
  - `audit`: los eventos de la empresa.
- Cada fuente expone solo las columnas permitidas, por proyección explícita, nunca `SELECT *`. Así una columna secreta nueva no entra por accidente.
- Nadie importa `data-portability`, y `data-portability` no importa `reports`. Una prueba de arquitectura lo fija, como la de `reports`.
- **Alternativa descartada:** reutilizar las fuentes de `reports`. Exigiría importar `reports` o duplicar sus filtros por defecto, y sus columnas no bastan (clave de acceso, autorización, artefactos).

### D2. Formato `PORTABILITY_FORMAT_V1`

```
datos-AAAAMMDD-HHMMSS.zip
  manifest.json
  LEEME.txt
  data/empresa.xlsx  data/terceros.xlsx  data/productos.xlsx
  data/comprobantes.xlsx  data/inventario.xlsx  data/auditoria.xlsx
  documents/<ambiente>/<tipo>/<numero>/snapshot.json
                                     /firmado.xml  /autorizado.xml  /ride.pdf
                                     /sri/<intento>-<operacion>.<ext>
  assets/logos/<sha256>.<png|jpg>
  SHA256SUMS
```

- **Componentes de las rutas**, todos generados por el servidor:
  - `<ambiente>`: `produccion` o `pruebas`;
  - `<tipo>`: `01-factura`, `03-liquidacion-de-compra`, `04-nota-de-credito`, `05-nota-de-debito`, `06-guia-de-remision` o `07-comprobante-de-retencion`;
  - `<numero>`: `^\d{3}-\d{3}-\d{9}$`, que ya valida `filenames.ts` del archivo;
  - `<intento>`: el número del intento, con ceros a la izquierda hasta tres dígitos;
  - `<operacion>`: `recepcion`, `autorizacion` o `validez`;
  - `<ext>`: `xml` si el tipo de contenido conservado es XML, y `bin` en otro caso;
  - `<sha256>`: 64 caracteres hexadecimales.
- **Validación de cada ruta antes de escribirla:**
  - debe cumplir la gramática `^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$`;
  - sin `..`, sin `/` inicial, sin barra invertida y con un máximo de 200 caracteres.
- **Unicidad:** la garantizan las claves (ambiente, tipo, número), que la base ya hace únicas, y el escritor la comprueba sin memoria creciente:
  - cada carpeta de comprobante debe ser estrictamente mayor que la anterior en el orden de las entradas;
  - cada archivo de una carpeta debe ser único dentro de ella;
  - una ruta repetida falla la generación, nunca se acepta en silencio.
  - Pruebas: dos ambientes que comparten números, una ruta repetida, `/` y `\`, `..`, una ruta absoluta y los caracteres de control o de salto de línea, que la gramática hace imposibles.
- **Orden de las entradas, determinista:** manifiesto, `LEEME.txt`, `data/`, `documents/` por ambiente, tipo y número, `assets/` y, al final, `SHA256SUMS`.
- **Nombre del paquete:** sale de `generatedAt` en hora de Ecuador. Nunca lleva el RUC: el de una persona natural contiene su cédula.

### D3. Manifiesto, `SHA256SUMS` y `LEEME.txt`

- **`manifest.json`** (UTF-8, JSON con sangría de dos espacios):
  - `formatVersion: "1"`, `generatedAt` y `snapshotAt` (ISO 8601 en UTC, con su equivalente en Ecuador);
  - `generator` (versión de la aplicación);
  - `company`: RUC, razón social y nombre comercial de la versión vigente en `snapshotAt`;
  - `scope`: ambientes, tipos y estados incluidos;
  - `counts`, por conjunto, y por ambiente, tipo y estado en los comprobantes;
  - `datasets`: cada conjunto con su libro y sus hojas (D8);
  - `formats`:
    - las versiones de `snapshotVersion` por tipo presentes;
    - las versiones de los XSD de los XML;
    - la versión de las columnas de los libros;
  - `exclusions`: firma y secretos, datos internos de autenticación, borradores, catálogos globales del SRI y datos técnicos, cada uno con su motivo;
  - `absent`: cada artefacto esperado pero ausente, con su clave de acceso, su tipo y su motivo (D13).
  - Nunca lleva el inventario de archivos.
- **`SHA256SUMS`:**
  - una línea `<sha256 en minúsculas><dos espacios><ruta>\n` por cada entrada interior salvo él mismo, incluidos el manifiesto y `LEEME.txt`;
  - en el orden determinista de las entradas, con rutas relativas generadas por el servidor, en UTF-8 con `\n`;
  - compatible con `sha256sum -c` y `shasum -a 256 -c`;
  - se escribe por streaming a un temporal mientras se agregan las entradas.
- **SHA-256 del paquete:** se calcula mientras se escribe el ZIP y se guarda con su tamaño en el registro de la exportación (D10), en la pantalla y en `data_export.completed`.
- **`LEEME.txt`**, en español:
  - qué es el paquete y que no es un respaldo ni se puede importar;
  - qué incluye y qué excluye (la firma, los secretos, los datos de autenticación y los borradores, con sus motivos);
  - los dos ambientes;
  - cómo verificarlo con `SHA256SUMS`;
  - la versión del formato y dónde se documenta (`docs/architecture/data-portability-format.md`).

### D4. Libros XLSX y sus hojas

| Libro | Hojas |
| --- | --- |
| `empresa.xlsx` | Configuración (cada versión, desde su vigencia), Establecimientos, Puntos de emisión, Secuenciales, Catálogos habilitados, Firmas (metadatos) y Usuarios (nombre, correo, rol, estado, punto predeterminado) |
| `terceros.xlsx` | Terceros, en todos sus estados, con roles, contacto y la marca del consumidor final del sistema |
| `productos.xlsx` | Productos y sus impuestos |
| `comprobantes.xlsx` | Comprobantes, Transiciones, Intentos SRI, Retenciones (una fila por línea), Destinatarios (de las guías) y Entregas |
| `inventario.xlsx` | Existencias y Movimientos |
| `auditoria.xlsx` | Eventos |

- **Claves entre hojas y archivos:**
  - comprobantes: la clave de acceso;
  - usuarios: el correo;
  - productos: el código;
  - terceros: la identificación.
  - Ningún UUID interno se usa como clave. Los cambios de la auditoría se exportan tal como se conservan.
- **Comprobantes:**
  - ambiente, tipo, número, clave de acceso, fecha de emisión;
  - el tercero congelado (o "N destinatarios" en la guía), los importes según la proyección de cada tipo (la guía sin importes y la retención con su total retenido);
  - estado, número y fecha de autorización, la carpeta, y el SHA-256 y el tamaño de cada artefacto presente.
- **Intentos SRI:** clave de acceso, número del intento, operación, ambiente, inicio y fin, resultado del transporte, estado HTTP, resultado clasificado, mensajes como texto, y el archivo, el SHA-256, el tamaño, el tipo de contenido y la marca de truncado de su respuesta.
  - El sobre enviado solo aparece por su SHA-256 y su tamaño: no se persiste.
- **Auditoría:** momento, tipo de actor, correo del actor, acción, correo del usuario afectado y los cambios como texto JSON. Nunca IP ni user agent, que la auditoría no guarda.
- **Columnas de cada hoja:** las publica `data-portability-format.md` con su tipo de celda. Cambiar una columna cambia la versión de las columnas en el manifiesto.

### D5. `snapshot.json`

- **Contenido:**
  - es el valor congelado del comprobante tal como lo devuelve la base, serializado con `JSON.stringify(valor, null, 2)` y un `\n` final;
  - los importes siguen siendo texto decimal;
  - `jsonb` normaliza el orden de las claves y los espacios: la autoridad del snapshot es su valor, y la de los bytes fiscales son los XML.
- **Esquemas:** cada `snapshotVersion` por tipo (factura 2; los demás 1) tiene su esquema publicado en `data-portability-format.md`.
- **Inmutabilidad:** el snapshot no cambia (trigger de inmutabilidad), así que se lee en la fase 2 por identificador sin perder la consistencia (D12).

### D6. Exclusiones y política de secretos

- **Nunca salen:**
  - `signing_certificate_secret`: el P12 cifrado, su contraseña cifrada, la clave envuelta, `key_check`, `key_version` y los nonces;
  - `CERTIFICATE_MASTER_KEY`;
  - `user.password` y las cuentas de `account`;
  - `session`, `verification` e `invitation`;
  - `BETTER_AUTH_SECRET`;
  - las IP y los user agents.
- **Tampoco salen:** los borradores de los cinco tipos, los catálogos globales y el registro de XSD (datos públicos del SRI), ni los datos técnicos (`job`, `idempotency_record`, capacidades y reservas derivadas).
- **Cómo se garantiza:**
  - las fuentes de D1 no exponen esas columnas;
  - una prueba de contenido siembra una firma, contraseñas, sesiones y borradores con marcadores conocidos, genera el paquete y busca esos marcadores, en claro y en base64, en cada entrada descomprimida: ninguno aparece.
- **Dos capas de prueba:**
  - **A, la proyección:** una prueba enumera las columnas de cada fuente de portabilidad y comprueba que no incluyen ninguna columna de `signing_certificate_secret`, `account`, `session`, `verification` ni `invitation`, ni `user.password`, IP o user agent.
  - **B, el paquete completo:**
    - siembra marcadores en el archivo y la contraseña de una firma de prueba, en los campos cifrados y en la clave envuelta, en un hash de contraseña, una sesión, una verificación y una invitación, en un análogo del secreto de autenticación y en una IP y un user agent;
    - busca cada marcador, en claro y en base64 cuando tiene sentido, en cada entrada descomprimida del paquete.
  - Nunca se intenta descifrar un secreto para probar su ausencia.
- **La exclusión de la firma** se justifica en la spec `signing-certificate` ("no devolverlos nunca, a ningún rol y por ninguna vía") y en el ADR 0011.

### D7. Respuestas originales del SRI

- Se copian los bytes de `sri_response.body` tal como se conservan, uno por intento con respuesta, en `sri/<intento>-<operacion>.<ext>`.
- **Antes de agregarlas:** se comprueban su tamaño y su SHA-256 contra los conservados (D13).
- **Truncadas:** se exportan como están, con su marca de truncado en "Intentos SRI".
- **Intento sin respuesta:** un intento sin cuerpo, como `NOT_SENT` o un plazo vencido, aparece en la hoja sin archivo.
- **Nunca:** se interpretan, se vuelven a pedir al SRI, entran en una celda, se registran en logs o en la auditoría, ni salen con la solicitud enviada.

### D8. Escritor XLSX en una capa neutral

- `reports/infrastructure/xlsx/` pasa a `platform/xlsx/` (escritor, celdas, ZIP interno y sus pruebas) sin cambiar su comportamiento: la prueba de bytes deterministas existente debe seguir dando los mismos bytes. `reports` lo importa desde ahí.
- `readOnlySnapshot` pasa a `platform/db/`.
- **Hojas divididas:** una hoja admite 1 048 576 filas: el encabezado más 1 048 575 de datos. Cuando un conjunto las supera, sigue en hojas sucesivas.
  - Los nombres son `<Hoja>`, `<Hoja> (2)`, `<Hoja> (3)`…, con el encabezado repetido en cada una, el mismo orden total y sin perder ni repetir filas en el límite.
  - El manifiesto nombra las hojas de cada conjunto.
  - Pruebas con el límite real en la escritura y con uno reducido inyectado: máximo menos uno, máximo y máximo más uno.
- **Libros:** cada libro se escribe como archivo temporal y entra en el paquete sin recomprimir (D9).
- **Límite del ZIP interno:** un libro que superara los 4 GiB sin comprimir falla con `DATA_EXPORT_LIMIT`. Con el volumen de Q-26, el mayor libro queda muy por debajo, y el benchmark lo mide.
- **Sin extensiones:** solo los tipos de celda existentes (texto, importe, decimal, fecha y momento).

### D9. Contenedor ZIP64: spike y ADR 0024

- **Primera tarea técnica del apply:** un spike fuera del código de producción que compare:
  - **A:** ampliar el contenedor propio con registros ZIP64 (campo extra 0x0001, descriptor de 64 bits, registro y localizador ZIP64 del fin del directorio), entradas binarias desde streams, STORE y DEFLATE por entrada, y el directorio central volcado a un temporal;
  - **B:** una biblioteca de producción mantenida con ZIP64 y streaming real.
- **Criterios**, todos obligatorios:
  - ZIP64, más de 65 535 entradas y más de 4 GiB;
  - entradas binarias desde streams, con memoria acotada;
  - memoria del directorio central acotada;
  - STORE para PDF, XLSX, PNG y JPEG, y DEFLATE para XML, JSON y texto;
  - nombres UTF-8 seguros, sin enlaces simbólicos (atributos externos de archivo regular);
  - bytes deterministas para un momento fijo;
  - licencia compatible y mantenimiento razonable;
  - lectura con herramientas independientes: Python `zipfile`, `unzip -t` de Info-ZIP, 7-Zip, `bsdtar` y, cuando esté disponible, el explorador de Windows y la utilidad de archivos de macOS.
- **Dependencia:** queda preautorizada si el ADR 0024 demuestra que es la mejor opción y cumple todos los criterios. Se registra en `stack.md`.
- **Gate:** si ninguna opción cumple, el apply se detiene y se reporta el bloqueo.
- **Escritura del paquete:** se escribe a un archivo con contrapresión, calculando su SHA-256 al vuelo.
- Nunca se usa el ZIP interno del escritor XLSX para el paquete.

### D10. Registro de la exportación y máquina de estados

- **Tabla `data_export`**, propiedad del módulo, con:
  - la empresa, quien la pidió, el estado y la fase;
  - el progreso (hecho y total);
  - el intento de generación;
  - `snapshot_at`, `generated_at`, `expires_at` y el motivo de caducidad;
  - el nombre interno del archivo, su tamaño y su SHA-256;
  - los conteos (JSON), la versión del formato, el código de error y las fechas.
- **Estados explícitos** con un `CHECK`, nunca deducidos de nulos:

```
QUEUED ──► GENERATING ──► READY ──► EXPIRED   (TTL o REPLACED)
                │            │
                │            └──► FAILED   (PACKAGE_MISSING o PACKAGE_INTEGRITY)
                └──────────────► FAILED   (con su código)
```

- `EXPIRED` es solo la indisponibilidad intencional: el vencimiento (`TTL`) o el reemplazo por un paquete nuevo (`REPLACED`).
- Un `READY` cuyo archivo falta, no tiene su tamaño o no coincide con su SHA-256 antes de caducar pasa a `FAILED`, con `DATA_EXPORT_PACKAGE_MISSING` o `DATA_EXPORT_PACKAGE_INTEGRITY`, registra `data_export.failed` y nunca se entrega. El error no expone rutas.

- **`CHECK` por estado:**
  - `READY` exige `snapshot_at`, `generated_at`, `expires_at`, tamaño, SHA-256 y archivo;
  - `FAILED` exige un código;
  - `EXPIRED` exige un motivo.
- **Índices únicos parciales:**
  - una generación activa por empresa (`status IN ('QUEUED','GENERATING')`);
  - un `READY` por empresa.
- **Solicitud** (`POST`): en una sola transacción, inserta la fila `QUEUED`, encola el job `portability.export` (clave `portability.export:<exportId>`, carga `{exportId}`) y registra `data_export.requested`. Nunca queda una fila sin job, un job sin fila ni un evento sin solicitud: si cualquiera falla, se revierte todo.
  - El índice de la generación activa convierte una solicitud repetida o simultánea en `409 DATA_EXPORT_IN_PROGRESS`, sin segundo efecto. No hace falta `Idempotency-Key`.
- **Runner propio** del prefijo `portability.`, con `DATA_EXPORT_MAX_CONCURRENT` lazos. No lo pausa el interruptor de la transmisión. Las exportaciones de otras empresas esperan en la cola durable.
- **Al tomar el job:** la fila pasa a `GENERATING` con el intento del job. Los fallos:
  - reintentables (worker caído, *lease* perdido, error transitorio de la base): vuelven a generar desde el principio, con `maxAttempts` de 3;
  - deterministas (integridad, artefacto faltante, espacio insuficiente, límite del formato, plazo de la fase 1): detienen el job y dejan la fila `FAILED` con su código.
- **Códigos de falla:**
  - de la generación: `DATA_EXPORT_ARTIFACT_INTEGRITY`, `DATA_EXPORT_ARTIFACT_MISSING`, `DATA_EXPORT_INSUFFICIENT_SPACE` (también ante un `ENOSPC` inesperado), `DATA_EXPORT_SNAPSHOT_TIMEOUT`, `DATA_EXPORT_LIMIT` y `DATA_EXPORT_FAILED` (intentos agotados);
  - del paquete listo: `DATA_EXPORT_PACKAGE_MISSING` y `DATA_EXPORT_PACKAGE_INTEGRITY`.

### D11. Renovación del *lease*

- **Fencing:** el `attempt_count` del job, que `claim` incrementa en la misma sentencia que da el *lease*, es el token monótono de cada arriendo. La identidad del arriendo es (`id`, `lease_owner`, `attempt_count`); el dueño solo no basta.
- **El `JobStore` gana dos métodos**, sin cambiar `claim`, `complete`, `reschedule`, `fail` ni `stop`, que los jobs del SRI y del RIDE siguen usando igual:
  - `renew(db, job, { leaseMs, now })`: `UPDATE job SET lease_expires_at = now + leaseMs WHERE id = $id AND status = 'LEASED' AND lease_owner = $owner AND attempt_count = $attempt AND lease_expires_at > now`. Sin fila, lanza `LeaseLostError`;
  - `fence(db, job, now)`: la misma condición, que además bloquea la fila del job dentro de la transacción en curso. Sin fila, lanza `LeaseLostError`. Con la fila bloqueada, `claim` (`SKIP LOCKED`) no puede tomarla antes del commit.
  - Si el apply encuentra que esto no es seguro para la cola genérica, se detiene y lo reporta antes de seguir.
- **El handler de la portabilidad:**
  - toma un *lease* base de 60 s (hipótesis del benchmark) y lo renueva cada 20 s con un heartbeat;
  - si una renovación falla, aborta la generación con su `AbortSignal`, borra su parcial y no confirma nada.
- **Completar, en este orden:**
  1. el ZIP cerrado, con su SHA-256 y su tamaño conocidos;
  2. el `fsync` del archivo, el renombrado atómico dentro del mismo sistema de archivos a `<exportId>-<intento>.zip` con `0400`, y el `fsync` del directorio;
  3. una sola transacción que:
     - hace `fence`;
     - comprueba que `data_export` sigue `GENERATING` con ese intento;
     - pasa el `READY` anterior de la empresa a `EXPIRED` (`REPLACED`);
     - pasa la exportación a `READY` con su tamaño, su SHA-256, `generated_at` y `expires_at`;
     - registra `data_export.completed`;
     - hace `complete` del job.
  - Si esa transacción falla, nada queda `READY` y no hay evento `completed`. El archivo publicado queda huérfano y lo borra el barrido (D14).
- **Un worker obsoleto nunca publica:** si A pierde el *lease* (pausado, sin heartbeat) y B toma el job con otro `attempt_count`, la transacción final de A falla en `fence`, porque cambiaron el dueño o el intento. A no marca `READY`, no completa el job, no registra `completed` ni reemplaza el `READY` vigente.
- **Archivos por intento:** el paquete se escribe como `<exportId>-<intento>.partial` y se publica como `<exportId>-<intento>.zip`. Dos intentos nunca escriben el mismo archivo, y el de un worker perdido queda huérfano para el barrido (D14).
- **Pruebas:**
  - una generación más larga que el *lease* base que termina gracias a la renovación;
  - la renovación rechazada tras perder el *lease*;
  - un worker matado a mitad de la generación y la recuperación por otro, con un solo `READY` y sin parciales;
  - dos runners compitiendo por el mismo job, con una sola generación publicada;
  - el caso obligatorio: A toma el job, queda pausado, su *lease* vence, B lo toma, genera y completa, y A vuelve. A no puede publicar ni cambiar el estado final, y su intento se limpia;
  - los jobs existentes, intactos.

### D12. Consistencia en dos fases

- **Fase 1, base de datos.** Una transacción `REPEATABLE READ, READ ONLY` (`readOnlySnapshot`, plazo de 5 min) fija `snapshotAt` con la hora de la base y:
  - escribe los seis libros desde las fuentes de D1, por lotes con cursor;
  - escribe a un temporal el inventario del paquete, una línea por comprobante:
    - su identificador, ambiente, tipo, número, clave y estado;
    - los identificadores, tipos, tamaños y SHA-256 de sus artefactos y de las respuestas de sus intentos;
    - el motivo de cada ausente;
  - escribe los logos referenciados.
  - Después hace `COMMIT`.
- **Fase 2, artefactos.** Fuera de cualquier transacción larga, lee solo los identificadores del inventario, por lotes con lecturas cortas:
  - el snapshot inmutable de cada comprobante;
  - cada artefacto, cada respuesta y cada logo, que se verifican (D13) y se agregan al ZIP.
  - Nada creado después de `snapshotAt` entra: no está en el inventario. Los artefactos de solo agregado garantizan que los bytes leídos son los de `snapshotAt`.
- **Duración de la fase 1:** la mide el benchmark. Si se acerca al plazo o crea presión MVCC visible (la edad del `xmin` y el bloqueo del autovacuum), el design se corrige con `/opsx:update`, sin degradar la consistencia en silencio. Superar el plazo falla con `DATA_EXPORT_SNAPSHOT_TIMEOUT`.

### D13. Integridad de los artefactos y ausentes

- **Lectura y verificación:** cada artefacto, respuesta o logo se lee por identificador y empresa, se recalculan su tamaño y su SHA-256, y se comparan con los del inventario.
- **Si no coinciden:**
  - la generación aborta, borra su parcial y queda `FAILED` con `DATA_EXPORT_ARTIFACT_INTEGRITY`;
  - suma a `data_export_failures_total{code="DATA_EXPORT_ARTIFACT_INTEGRITY"}` y deja un log con la clave de acceso y el tipo, nunca los bytes. No reutiliza la métrica `artifact_integrity_failures_total` del archivo: es de otro módulo;
  - registra `data_export.failed` con solo el código.
- **Ausentes legítimos:** se declaran en `absent` del manifiesto y nunca se generan.
  - RIDE de un comprobante `AUTHORIZED` sin RIDE: `RIDE_PENDING` o `RIDE_STOPPED`, según el job del RIDE en `snapshotAt`;
  - respuesta de un intento sin cuerpo: aparece en la hoja, no como ausente.
- **Ausentes que violan un invariante:** el XML firmado de un comprobante que no está `RESERVED`, o el XML autorizado de uno `AUTHORIZED`. Fallan cerrado con `DATA_EXPORT_ARTIFACT_MISSING`.
- **No esperados:** un comprobante `RESERVED` no tiene XML y eso no es un ausente.

### D14. Ciclo de vida en el sistema de archivos

- **`DATA_EXPORT_DIRECTORY`:**
  - por defecto, un subdirectorio de `os.tmpdir()` para el desarrollo;
  - en producción, un volumen persistente que sobreviva un reinicio durante las 24 h del paquete (`deployment.md`), fuera de cualquier directorio público o estático;
  - al arrancar, se crea o se comprueba con modo `0700` y como directorio propio del proceso; si no se puede asegurar, el arranque falla.
- **Escritura:**
  - el trabajo de un intento va en `work/<exportId>-<intento>/` (`0700`: libros, inventario y `SHA256SUMS` temporales);
  - el paquete se escribe en `<exportId>-<intento>.partial` (`0600`), con `fsync`;
  - se renombra a `<exportId>-<intento>.zip`, con modo `0400` y `fsync` del directorio;
  - el trabajo se borra siempre.
- **Barrido** al arrancar, antes de iniciar el runner, y cada `DATA_EXPORT_SWEEP_INTERVAL_SECONDS`:
  1. un `READY` vencido pasa a `EXPIRED` (`TTL`) y se borra su archivo;
  2. un `READY` todavía vigente cuyo archivo no existe o no tiene su tamaño pasa a `FAILED` (`DATA_EXPORT_PACKAGE_MISSING` o `DATA_EXPORT_PACKAGE_INTEGRITY`), con `data_export.failed`, métrica y log. Si ya venció, pasa a `EXPIRED` (`TTL`);
  3. se borran los archivos y directorios de trabajo que no pertenecen a un `READY` ni a un `GENERATING` con el *lease* vigente: los parciales, los intentos obsoletos y los publicados que no llegaron a `READY`;
  4. un `EXPIRED` o `FAILED` cuyo archivo sigue existiendo pierde el archivo.
  - El barrido comprueba la existencia y el tamaño. El SHA-256 completo lo comprueba la descarga (D16), porque es caro.
  - Si una plataforma no permite el `fsync` del directorio, la recuperación es esta misma reconciliación: un renombrado perdido deja un `.partial` o un archivo sin `READY`, que se borran, y la exportación vuelve a generarse o queda fallida.
- **Seguridad del barrido:**
  - solo borra hijos directos del directorio, o de `work/`, cuyo nombre es `<uuid>-<intento>.partial`, `<uuid>-<intento>.zip` o `<uuid>-<intento>`;
  - nunca sigue enlaces y nunca toca los artefactos fiscales, que viven en PostgreSQL.
- **Historia:** las filas no se borran; son pequeñas y son la historia de las exportaciones de la pantalla.

### D15. Caducidad y paquete vigente

- **Caducidad:** `DATA_EXPORT_TTL_HOURS` = 24 (rango de 1 a 168), y `expires_at = generated_at + TTL`, donde `generated_at` es el momento en que pasó a `READY`. Una exportación que esperó dos horas en cola no pierde esas dos horas de descarga.
- **Generar de nuevo** se permite con un `READY` vigente si no hay una generación activa.
  - Cuando el nuevo queda `READY`, en la misma transacción el anterior pasa a `EXPIRED` (`REPLACED`); su archivo se borra después del commit, con el barrido como respaldo.
  - Si el nuevo falla, el anterior sigue vigente.
- **Disco acotado por empresa:** como máximo un paquete `READY` y una generación con su parcial.

### D16. Descarga

- **Ruta:** `GET /api/v1/data-exports/{id}/download`. Comprueba, en orden:
  1. la sesión (`401`);
  2. `dataPortability.export` (`403`);
  3. la búsqueda con la empresa de la sesión (`404` si no existe o es de otra empresa);
  4. el estado:
     - `QUEUED`, `GENERATING` o `FAILED`: `409 DATA_EXPORT_NOT_READY`;
     - `EXPIRED`: `410 DATA_EXPORT_EXPIRED`;
     - `READY` con `expires_at <= now`: `410`.
- **Integridad, antes de cualquier cabecera:** abre el archivo una vez y comprueba su tamaño y su **SHA-256 completo** sobre ese mismo descriptor.
  - Si el archivo falta: la fila pasa a `FAILED` (`DATA_EXPORT_PACKAGE_MISSING`) y responde `500` con ese código.
  - Si no coinciden: la fila pasa a `FAILED` (`DATA_EXPORT_PACKAGE_INTEGRITY`) y responde `500` con ese código, sin cuerpo binario.
  - En ambos casos hay métrica, log y `data_export.failed`, nunca una ruta en la respuesta.
  - El costo de esta verificación lo mide el benchmark.
- **Auditoría:** después de la verificación se registra `data_export.download_started`. Si falla, responde `500` y no entrega nada.
- **Entrega:**
  - `200` con `Content-Type: application/zip` y `Content-Length`;
  - `Content-Disposition: attachment; filename="datos-AAAAMMDD-HHMMSS.zip"` (ASCII);
  - `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`;
  - el cuerpo sale por streaming desde el mismo descriptor, con contrapresión.
- **Lo que no se ofrece:** `HEAD` responde `405`, no hay rangos ni enlaces firmados o públicos.
- **Lo que no se afirma:** un hash calculado durante el envío no evita servir datos corruptos, así que la garantía es la verificación previa. El residuo (cambiar el archivo `0400` entre la verificación y el envío) exige acceso al sistema de archivos del servidor y queda documentado.
- **Frontend:** descarga navegando a la ruta (un enlace con `download`), nunca con `fetch(...).blob()`. El navegador escribe a disco a través de la reescritura `/api/*`.
- **Gate de verificación del streaming:** la revisión de la interfaz y el benchmark descargan un paquete de varios GB a través de la reescritura `/api/*` y miden la memoria residente del backend y del proceso de Next.
  - Si Next almacena el ZIP, se corrige el enrutado antes de cerrar el cambio: una ruta del mismo origen que preserve el streaming y la sesión, nunca una URL pública sin autenticación.
  - Un diseño que solo funciona con archivos pequeños no se acepta.

### D17. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `POST /api/v1/data-exports` | Solicita una exportación: `202` con su vista `QUEUED`; `409 DATA_EXPORT_IN_PROGRESS` | `dataPortability.export` |
| `GET /api/v1/data-exports` | Lista paginada de las exportaciones de la empresa, la más reciente primero | `dataPortability.export` |
| `GET /api/v1/data-exports/{id}` | Estado, fase, progreso, `snapshotAt`, caducidad, tamaño, SHA-256, conteos y código de falla | `dataPortability.export` |
| `GET /api/v1/data-exports/{id}/download` | El paquete (D16) | `dataPortability.export` |

- **Cuerpo del `POST`:** un objeto estricto vacío, que rechaza `companyId` (`400`).
- **Vistas:**
  - muestran a quien la pidió por su nombre y nunca el nombre interno del archivo;
  - el tamaño va como texto decimal.
- **Contratos:** las vistas, los estados, las fases y los códigos van en `packages/contracts`, con su OpenAPI y la descarga como respuesta binaria.

### D18. Permisos

- `dataPortability.export`, solo del administrador. Confirma la fila "Exportar todos los datos del contribuyente" de `access-control.md`.
- Va en `access-policy.ts`, su espejo del frontend y `access-control.md`, con la prueba que compara el documento con el código.
- Se verifica en el servidor en las cuatro rutas.

### D19. Auditoría

| Acción | Actor | Cambios |
| --- | --- | --- |
| `data_export.requested` | El administrador | `exportId` |
| `data_export.completed` | Sistema | `exportId`, `formatVersion`, conteos de comprobantes, archivos y ambientes, `sizeBytes` y `sha256` |
| `data_export.failed` | Sistema | `exportId` y `code` |
| `data_export.download_started` | El administrador | `exportId` |

- Ningún evento lleva rutas, nombres de archivos interiores, contenido, XML, respuestas del SRI ni datos personales. Las claves pasan `assertNoSecrets`: `sha256`, nunca `hash`.
- No hay eventos ni entregas (`document_delivery_event`) por comprobante: el historial de entregas del archivo sigue siendo el de sus descargas individuales.
- Una solicitud rechazada no registra nada.

### D20. Defensa de recursos

Todos son defensas de recursos del proyecto, hipótesis hasta medirlas con `bench:data-portability`.

| Variable | Valor inicial | Significado |
| --- | --- | --- |
| `DATA_EXPORT_MAX_CONCURRENT` | 1 (rango de 1 a 2) | Generaciones a la vez por instancia |
| `DATA_EXPORT_TTL_HOURS` | 24 (rango de 1 a 168) | Vigencia de un paquete listo |
| `DATA_EXPORT_DISK_HEADROOM_PERCENT` | 10 (rango de 0 a 100) | Margen sobre el tamaño sin comprimir |
| `DATA_EXPORT_DISK_RESERVE_MIB` | 512 (rango de 64 a 65 536) | Reserva fija del disco |
| `DATA_EXPORT_DIRECTORY` | Subdirectorio de `os.tmpdir()` | Directorio privado del paquete (D14) |

- **Reserva de disco:**
  - antes de la fase 1, `fs.statfs` exige la reserva fija;
  - antes de la fase 2 exige la suma de los tamaños sin comprimir del inventario, más el margen, más la reserva. El paquete comprimido nunca la supera en la práctica: STORE añade solo cabeceras.
  - Si no hay espacio, falla con `DATA_EXPORT_INSUFFICIENT_SPACE`, sin paquete parcial, con `data_export.failed`.
- **Sin máximo de filas:** el paquete está completo o falla.

### D21. Observabilidad

- **Métricas** sin etiquetas de empresa ni datos personales:
  - `data_exports_total{result}` (`ready`, `failed`, `expired`);
  - `data_export_failures_total{code}`;
  - `data_export_phase_duration_seconds{phase}` y `data_export_size_bytes`;
  - `data_export_downloads_total{result}` (`started`, `not_ready`, `expired`, `integrity_failed`);
  - `data_export_lease_renewals_failed_total`.
- **Logs:** el identificador de la exportación, la fase, los conteos y las duraciones. Nunca rutas del sistema de archivos, nombres de archivos interiores ni contenido.

### D22. Rendimiento

- **`bench:data-portability`**, fuera de `verify`, sobre un esquema y un directorio aislados, con el volumen de Q-26:
  - 100 000 comprobantes de los seis tipos en los dos ambientes;
  - XML firmados y autorizados de tamaño real, RIDE reales de una muestra renderizada y respuestas del SRI;
  - 10 000 terceros, 10 000 productos, 300 000 movimientos y unos 300 000 eventos de auditoría.
- **Mide:**
  - el reloj de cada fase y el total, la CPU y la memoria residente máxima;
  - el disco temporal máximo, el tamaño del ZIP y su número de entradas;
  - la duración de la transacción de la fase 1 y su presión MVCC;
  - el costo de la verificación previa a la descarga;
  - el P95 de una lista de la API durante la generación;
  - la cola entre empresas y el `409` de la misma empresa;
  - la recuperación tras matar el proceso, la renovación del *lease* y la caducidad con el barrido.
- **Validación del paquete:** se valida con Python `zipfile`, `unzip -t`, `sha256sum -c`, openpyxl, un parser JSON y los XSD sobre una muestra de XML.
- **Resultado:** queda en `docs/quality/benchmarks/` y fija los valores de D20, o corrige el design con `/opsx:update`.

### D23. Pantalla Portabilidad de datos

- **Brief** (`cognitive-architecture.md`):
  - usuario: el administrador;
  - objetivo: llevarse los datos de su empresa fuera del sistema;
  - decisión: generar un paquete y descargarlo antes de que caduque;
  - información mínima: qué incluye y qué no, el estado de la exportación vigente y su verificación;
  - acción principal: "Generar exportación" o "Descargar", según el estado.
- **Niveles de información:**
  - P0: el estado de la exportación actual con su acción;
  - P1: el momento del snapshot, la caducidad, el tamaño y el SHA-256;
  - P2: la explicación de lo incluido y lo excluido, y la historia;
  - P3: los identificadores internos, que no se muestran.
- **Ruta y navegación:** `/configuracion/portabilidad`, en el grupo Configuración, con `dataPortability.export`. El operador no la ve y, si abre la ruta, ve el estado sin permiso.
- **Componentes:**
  - la explicación como texto con dos listas, incluido y excluido. No es una condición de la instalación, así que no va en `NoticeStrip`;
  - "Generar exportación" con `AsyncButton`;
  - un `ConfirmDialog` al generar de nuevo con un paquete vigente, que explica que el anterior caducará cuando el nuevo esté listo;
  - el estado con `StatusBadge` (En cola, Generando, Lista, Fallida, Expirada) y el progreso por fase, con "N de M comprobantes" solo cuando se conoce el total y nunca un porcentaje estimado, consultado cada 2 s mientras está en cola o generándose;
  - el SHA-256 en monoespaciado, partido y con copia;
  - la descarga como enlace con el aspecto de un botón;
  - la historia en `AppDataTable` paginada, con tarjetas por debajo de 768 px.
- **Mensajes:** explican el `409`, cada código de falla y la caducidad sin detalles internos.
- **Estados:** carga, vacío, error con reintento y sin permiso. Escritorio, 375 y 320 px, temas claro y oscuro, teclado y contraste.

### D24. Migraciones

- Una migración crea `data_export` con:
  - las FK a `organization` y `user`;
  - los `CHECK` de estado, fase, código y motivo, y los campos que exige cada estado;
  - los dos índices únicos parciales de D10;
  - el índice por empresa y fecha de solicitud.
  - Sin triggers de solo agregado: la fila cambia de estado.
- **El tipo `portability.export`** cumple el `CHECK` existente de `job.type`.
- **`migrations.test.ts`** prueba los `CHECK`, los índices únicos parciales y el rechazo de un `READY` incompleto.

### D25. Frontera del cambio

- El paquete no se importa ni se restaura. AC-10, RNF-007 y SEC-008 siguen en la compuerta del respaldo operativo (`deployment.md`). La verificación de SEC-010 es la de D22, sin reimportación.
- Ningún dato de la empresa se borra al exportar ni al caducar.
- `backend.md` actualiza "Background Jobs":
  - `data-portability` es el dueño de `portability.export`;
  - los jobs de exportación no se cancelan en la versión 1.

### D26. Operaciones sensibles (`docs/architecture/backend.md`)

| Pregunta | Respuesta |
| --- | --- |
| ¿Quién? | El administrador (`dataPortability.export`) |
| Empresa del llamador | La de la sesión |
| Empresa del recurso | `data_export.company_id`; cada fuente filtra por la empresa en cada consulta |
| Validación de la propiedad | Búsqueda por identificador y empresa; otra empresa responde `404` |
| ¿Cambiar un identificador alcanza datos ajenos? | No: ninguna consulta omite la empresa, y los esquemas estrictos rechazan `companyId` |
| ¿Dos veces? | La segunda solicitud responde `409 DATA_EXPORT_IN_PROGRESS`; dos descargas son dos `download_started` |
| ¿A la vez? | El índice único parcial deja una sola generación activa por empresa; el runner acota las generaciones por instancia; el *lease* renovado impide dos generaciones del mismo job |
| Idempotencia | La fila activa única y la clave del job `portability.export:<exportId>`; el handler regenera desde el principio |
| Restricciones de la base | `CHECK` de estados y campos requeridos, índices únicos parciales, FK |
| Auditoría | Las cuatro acciones de D19 |
| Pruebas de autorización | Operador `403` en las cuatro rutas; sin sesión `401`; otra empresa `404`; `companyId` rechazado; el paquete sin datos de otra empresa |
| Fugas | Sin enlaces públicos ni firmados; nombres sin datos personales; rutas solo de componentes del servidor; secretos excluidos por proyección y probados por contenido; `no-store`; logs sin rutas |

## Risks / Trade-offs

- [La fase 1 dura demasiado con el volumen real] → la mide el benchmark, y D12 prevé `/opsx:update` en lugar de degradar la consistencia.
- [La verificación completa antes de cada descarga cuesta segundos con varios GB] → el benchmark la mide; solo el administrador descarga, con un paquete vigente por empresa.
- [La reescritura `/api/*` de Next.js podría almacenar la descarga] → es un gate de verificación (D16): se mide la memoria de Next con un paquete de varios GB y se corrige el enrutado si almacena.
- [Varias instancias de API sin un directorio compartido] → fuera de alcance: el MVP tiene una instancia (`deployment.md`). Con varias, el directorio debe compartirse o la descarga fijarse a la instancia que generó.
- [El directorio por defecto en `os.tmpdir()` no sobrevive a un reinicio] → `deployment.md` exige un volumen persistente en producción. Un paquete perdido antes de caducar pasa a `FAILED` (`DATA_EXPORT_PACKAGE_MISSING`) y se genera de nuevo.
- [Un artefacto alterado bloquea toda portabilidad] → es deliberado: fallar cerrado. El incidente se trata con el respaldo operativo, y el log identifica el comprobante.
- [El directorio central de cientos de miles de entradas] → criterio del ADR 0024: memoria acotada, volcando a un temporal.
- [El snapshot sale como valor JSON, no como bytes originales] → `jsonb` no conserva bytes; la autoridad fiscal en bytes son los XML.
- [La CPU del XLSX en el hilo principal durante la fase 1] → por lotes y con contrapresión, como en el cambio 15. El benchmark mide el P95 de la API durante la generación, y si no es sano, el runner pasa a un proceso propio (ADR 0012 lo permite).

## Migration Plan

- **Despliegue:**
  - una migración aditiva (`data_export`);
  - el permiso, las acciones de auditoría y las variables de entorno son aditivos;
  - el escritor XLSX y `readOnlySnapshot` se mueven sin cambiar su comportamiento.
  - En producción se configura `DATA_EXPORT_DIRECTORY` en un volumen persistente antes de habilitar la pantalla.
- **Reversión:**
  - se retiran las rutas, la pantalla, el permiso y el runner;
  - el barrido o el operador borra el directorio del paquete;
  - la tabla puede quedarse vacía o eliminarse con una migración posterior.
  - Los eventos de auditoría ya registrados permanecen, como toda la auditoría.

## Open Questions

- Los encabezados exactos de cada hoja se fijan durante el apply en `data-portability-format.md`, dentro de los conjuntos de D4. No cambian los specs ni las tareas.
