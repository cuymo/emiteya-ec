# Design

## Context

Ver `proposal.md` para la motivación y `specs/document-archive/spec.md` para los requisitos.
Estado de partida, tras `add-sri-transmission`:

- **Comprobante.** `electronic_document` guarda el tipo, el ambiente, el establecimiento y el punto, el número, la fecha de emisión, el estado, el snapshot inmutable, copias del receptor (identificación y nombre) y del total, y la autorización (número, fecha y ambiente), que un trigger impide cambiar.
- **Artefactos.** `document_artifact` es de solo agregado, con `UNIQUE (document_id, kind)` y un CHECK que hoy admite `SIGNED_XML` y `AUTHORIZED_XML` con `application/xml`. El `AUTHORIZED_XML` existe solo si la respuesta del SRI trajo el comprobante: una autorización válida sin él no crea artefacto.
- **Paso a `AUTHORIZED`.** Toda transición de la transmisión pasa por `applyDecision` (`fiscal/application/transmission-step.ts`), en una transacción que guarda el resultado, la transición, el `AUTHORIZED_XML` y los jobs siguientes. Esto vale para la autorización, la reconciliación automática y la manual.
- **Infraestructura reutilizable:**
  - la cola durable (`platform/jobs`), con claim `SKIP LOCKED`, arriendos, backoff, detención y runner;
  - el barrido de firmados sin job (`transmission-sweeper.ts`);
  - el pool de `worker_threads` criptográfico (`platform/workers`), con workers fijos, cola acotada, plazo que reemplaza el worker y resultados tipados;
  - el patrón de descarga binaria del logo (`ETag` con el SHA-256, `nosniff`, rutas con `binaryContentTypes` en el registro OpenAPI);
  - las métricas `fiscal_jobs{type,status}` y la del pendiente más antiguo por tipo.
- **Datos inmutables que el XML no trae:**
  - las denominaciones de las formas de pago están en el snapshot (`payments[].officialLabel` y `versionId`);
  - el logo cuelga de la versión de configuración del snapshot (`taxpayerConfig.versionId`): `company_config_version` y `configuration_asset` son de solo agregado, y el logo es PNG o JPEG con SHA-256 (CHECK de la base).
- **Decisiones vigentes:**
  - ADR 0022 y spike S-4: pdfmake 0.3.11, bwip-js 4.11.4, Noto Sans OFL, determinismo por versión, render fuera del event loop. El prototipo y su benchmark están en la rama `spike/s4-ride-pdf`, que no se fusiona;
  - Q-24: correo en P1;
  - ADR 0010: artefactos en PostgreSQL;
  - ADR 0012: cola propia;
  - matriz de `access-control.md`, fila "Consultar la bandeja y descargar XML y RIDE": administrador y operador.
- **Fuentes:** ERS RF-401..409, AC-02 y AC-07; CTX §30 (RIDE), §31 (conjunto probatorio), §45 (XML autorizado) y §46 (entrega); ficha v2.34, §9.19–9.21 y anexo 2 (página 60), anexo 22 (RIMPE).

## Goals / Non-Goals

**Goals:**
- Que todo comprobante autorizado tenga su RIDE guardado una vez, con su procedencia y sus versiones, sin depender de datos vigentes.
- Servir siempre los bytes guardados, verificados, y dejar rastro de lo que la aplicación sirvió o inició.
- Diseñar la bandeja, los artefactos y las entregas sobre el comprobante genérico, para los otros cinco tipos.

**Non-Goals:**
- Un RIDE para estados no autorizados, versiones de impresión propias o marcas de agua que la ficha no exige.
- Regenerar RIDE históricos o migrar sus bytes cuando cambien las librerías o las fuentes.
- Observar si un documento se imprimió o llegó a su receptor: el sistema no puede saberlo.
- Correo, anulaciones (Q-16), corrección de devueltos (BR-28) y reportes.

## Decisions

### D1. Módulos y fronteras

| Pieza | Módulo | Motivo |
| --- | --- | --- |
| Lectura del XML para el RIDE (modelo de la factura) | `sri-engine/infrastructure` | Es el único lugar del parser XML (regla de ESLint del motor SRI). |
| Renderer del RIDE (pdfmake, bwip-js, fontkit) y sus fuentes | `sri-engine/infrastructure`, detrás de los puertos `RideSourceReader` y `RideRenderer` de `sri-engine/application` | La ficha define el formato: es una pieza del protocolo, como el builder XML y el firmador. Una regla de ESLint limita pdfmake, bwip-js y fontkit a esa carpeta. |
| Job `document.render_ride`, su seguidor de la autorización, barrido, artefacto `RIDE_PDF`, bandeja, descargas, entregas y reintento | `fiscal/application/archive/` y `fiscal/infrastructure/archive/` | ARCHITECTURE.md asigna `document-archive` y los jobs del RIDE a `fiscal`. Las carpetas propias hacen verificable la dirección de las dependencias. |
| Seguidores de las transiciones del comprobante (puerto genérico) | `fiscal/application/document-transitions.ts` | Lo conocen la transmisión y el archivo; no conoce a ninguno de los dos. |
| Pool de workers genérico | `platform/workers` | El criptográfico y el del RIDE comparten el mecanismo, no la instancia. |
| Pantalla `Comprobantes` y sección de documentos | `frontend/src/features/archive/` | La sección se monta en el detalle de la factura, que no duplica su contenido. |

- **Sin dependencias nuevas entre módulos de negocio.** `fiscal` lee el snapshot del comprobante que ya guarda, nunca `parties`, `products`, `taxpayer` ni `catalogs`. Para el logo usa una lectura interna del asset por identificador de versión, de solo lectura y sobre tablas de solo agregado.
- **Dirección de las dependencias.** El archivo depende de la transmisión, nunca al revés.
  - `sri-transmission` (handlers, `transmission-step.ts`, sus puertos y su infraestructura) no importa nada de `archive/` ni nombra el tipo `document.render_ride`.
  - El único punto que une los dos es la composición al arrancar (`main.ts`), que entrega al paso de la transmisión los seguidores registrados (D5).
  - Una prueba de arquitectura lo impide: ningún archivo de `src/` fuera de `archive/` y de `main.ts` importa de `archive/`, y ningún archivo de la transmisión contiene `document.render_ride`. Detecta cada violación en archivos de ejemplo, como las pruebas de fronteras existentes.

### D2. Bandeja de comprobantes

- **Fuente:** `electronic_document` de la empresa de la sesión, de cualquier tipo, desde `RESERVED`. Los borradores no están en esa tabla.
- **Filtros** (RF-402), validados con Zod:
  - `from` y `to` (fechas ISO de emisión, inclusivas, `from <= to`);
  - `documentType` (tabla 3);
  - `state`, con los estados de `INVOICE_STATES`;
  - `identification` (identificación exacta del receptor);
  - `search` (prefijo del número o del nombre del receptor, como en `Facturas`);
  - `establishmentId` y `emissionPointId`;
  - paginación del contrato común.
- **Orden:** fecha de emisión descendente y después el identificador, estable para la paginación.
- **Cada elemento:** identificador, tipo, número, fecha de emisión, receptor (nombre e identificación), total, estado, transmisión detenida (la lectura del cambio 7) y documentos:
  - `ride`: `AVAILABLE`, `PENDING`, `STOPPED` o `NOT_APPLICABLE`;
  - `authorizedXml` y `signedXml`: booleanos.

  Una sola consulta paginada con `EXISTS` por artefacto y por job, sin N+1.
- **Resumen de un comprobante** (`GET /documents/{id}`):
  - lo mismo que el elemento de la lista;
  - los artefactos disponibles con su tipo, SHA-256, tamaño, fecha y, para el RIDE, su procedencia;
  - la generación del RIDE con su estado, su motivo y la fecha si está detenida.

  El contenido de la factura sigue en `GET /invoices/{id}`, y su historial de transmisión, en `GET /invoices/{id}/transmission`: no se duplican.
- **Alternativa descartada:** ampliar `GET /invoices` con los filtros y los documentos. Mezclaría la lista operativa de un tipo con la bandeja única de los seis (RF-401), que no puede vivir bajo `/invoices` cuando lleguen las notas de crédito.

### D3. Fuente canónica del RIDE

```text
comprobante AUTHORIZED
  ├─ con AUTHORIZED_XML ──▶ fuente AUTHORIZED_XML          (procedencia AUTHORIZED_XML)
  └─ sin AUTHORIZED_XML ──▶ fuente SIGNED_XML transmitido  (procedencia SIGNED_XML_FALLBACK)
       + autorización inmutable (número, fecha, ambiente) del comprobante
       + denominaciones de las formas de pago del snapshot
       + logo de la versión de configuración del snapshot, si existe
```

- **Fallback.** Se usa solo si el comprobante está `AUTHORIZED` y no tiene `AUTHORIZED_XML`, es decir, si el SRI autorizó de forma concluyente sin devolver el comprobante. Es válido porque el `SIGNED_XML` es exactamente lo transmitido (el cambio 7 lo verifica antes de cada envío), y la clave, el ambiente y la autorización ya se reconciliaron.
  - La procedencia se guarda en el artefacto y se muestra en el resumen.
  - El XML firmado nunca se ofrece ni se nombra como XML autorizado.
- **Verificaciones antes de dibujar** (código determinista, la generación se detiene):
  - el artefacto de origen pertenece al comprobante y a su empresa, y su SHA-256 y su tamaño coinciden con los guardados: `RIDE_SOURCE_INTEGRITY`;
  - la clave del XML coincide con la del comprobante y con el número de autorización, y su ambiente con el de la autorización: `RIDE_AUTHORIZATION_MISMATCH`;
  - el XML no trae `<!DOCTYPE` ni entidades, mide 2 MiB o menos y anida 24 niveles o menos: `RIDE_SOURCE_INVALID`;
  - el documento es una factura (`codDoc` 01) de versión 1.1.0: `RIDE_SOURCE_INVALID`;
  - solo trae el contenido que el sistema emite (lista abajo): `RIDE_SOURCE_UNSUPPORTED`, con los nombres de los elementos;
  - el SHA-256 del logo coincide con el de su asset: `RIDE_LOGO_INTEGRITY`.
- **Solo la factura 1.1.0.** Es la única versión que escribe el builder de `add-invoice-emission` (`INVOICE_SCHEMA_VERSION`), y el sistema no importa comprobantes externos: ningún `electronic_document` puede tener otra. Leer la 1.0.0 sería comportamiento sin fuente.
- **Solo el contenido que el sistema emite.** El lector conoce exactamente los elementos que escribe el builder, más la firma:
  - `infoTributaria` completa, con `nombreComercial`, `agenteRetencion` y `contribuyenteRimpe` opcionales;
  - `infoFactura` con `dirEstablecimiento`, `contribuyenteEspecial` y `direccionComprador` opcionales, `totalConImpuestos` y `pagos` con `formaPago` y `total`;
  - `detalle` con `codigoPrincipal` y `codigoAuxiliar` opcionales, e `impuestos`.
  - Todo impuesto es IVA (código 2): la emisión rechaza ICE e IRBPNR, que no tienen datos de cálculo en los catálogos.
  - Cualquier otro elemento (ICE, IRBPNR, propina, `infoAdicional`, guía de remisión, `detallesAdicionales`, plazos de pago, reembolsos, retenciones…) detiene la generación con `RIDE_SOURCE_UNSUPPORTED`. Nunca se omite en silencio, y el spec no afirma un soporte que la emisión no tiene.
  - Cuando la emisión añada uno de ellos, su cambio amplía el lector y el renderer con sus pruebas.
- **Textos e importes** salen del texto exacto del XML, nunca convertidos a `number` (S-4).

### D4. Artefacto `RIDE_PDF`

- **Fila de `document_artifact`:** `kind = 'RIDE_PDF'`, `media_type = 'application/pdf'`, bytes exactos, SHA-256 y tamaño.
- **Metadatos:**
  - `rendererVersion` (versión propia del layout, empieza en `1`);
  - `pdfmake`, `pdfkit`, `bwipJs` y `fontkit` (versiones exactas);
  - `fonts` (nombre, versión y SHA-256 de Regular y Bold);
  - `source` (`kind`, `sha256` y `provenance`: `AUTHORIZED_XML` o `SIGNED_XML_FALLBACK`);
  - `authorizationNumber`;
  - `jobId`.
- **CHECK de la base:** los tipos XML con `application/xml` y `RIDE_PDF` con `application/pdf`.
- **Una vez y para siempre.** `UNIQUE (document_id, kind)` y el trigger de solo agregado ya existentes impiden un segundo RIDE y cualquier cambio. Un RIDE histórico conserva sus bytes y versiones aunque cambien las librerías o la fuente (ADR 0022).

### D5. Job `document.render_ride` y su programación

- **Tipo y deduplicación:** `document.render_ride`, clave `document.render_ride:{documentId}`.
  - Usa la clave activa de la cola, así que hay a lo sumo uno activo por comprobante.
  - No usa la exclusión `sri.`: puede convivir con una transmisión, aunque no la hay tras `AUTHORIZED`.
- **Programación al autorizar, sin invertir la dependencia.**

  ```text
  fiscal/application/document-transitions.ts   (puerto genérico, no conoce a nadie)
      DocumentTransitionFollower(db, { companyId, documentId, from, to, cause, at })
            ▲                                   ▲
            │ lo invoca                         │ lo implementa
  transmission-step.ts (applyDecision)    archive/ride-follower.ts
            │                                   │ to === "AUTHORIZED" → enqueueIn(db, document.render_ride)
            └──────────── main.ts los compone al arrancar ─────────┘
  ```

  - `applyDecision` recibe la lista de seguidores en sus dependencias y llama a cada uno después de guardar cada transición y su artefacto, con el cliente de la misma transacción (TX B).
  - El seguidor del archivo encola `document.render_ride` cuando la transición llega a `AUTHORIZED`. Si ya hay un job activo con la clave, la garantía ya se cumple. Un error del seguidor revierte la transacción entera.
  - Así, el commit de `AUTHORIZED` y el job durable del RIDE son la misma operación: una caída antes del commit no deja ni la autorización ni el job (el mismo patrón que `sri.transmit` al firmar). Vale para la autorización, la reconciliación automática y la manual, que pasan todas por `applyDecision`.
  - La lista de seguidores es una dependencia obligatoria del paso: olvidarla al componer es un error de tipos. La prueba end-to-end sobre `main.ts` comprueba que un comprobante recién autorizado tiene su job sin esperar al barrido.
  - El barrido sigue siendo la defensa secundaria, nunca el camino normal.
- **Barrido idempotente** (`ride-sweeper.ts`), al arrancar y cada `RIDE_SWEEP_INTERVAL_SECONDS`.
  - Inserta un job para cada `AUTHORIZED` sin `RIDE_PDF` que no tenga ningún job del tipo activo ni detenido.
  - Usa `INSERT … SELECT … ON CONFLICT DO NOTHING` sobre la clave activa.
  - Es el backfill de los autorizados existentes y la red de seguridad de la garantía transaccional. Nunca reactiva un job `STOPPED`.
- **Handler** (`fiscal/application/ride-handler.ts`), sobre un job arrendado:
  1. Lee el comprobante. Si no existe o no está `AUTHORIZED`, el job se detiene con un código determinista.
  2. Si ya tiene `RIDE_PDF`, completa el job sin generar nada.
  3. Elige la fuente (D3), la verifica y lee el logo.
  4. Pide el render al pool (D6).
  5. En una transacción guarda el `RIDE_PDF` y completa el job, guardado por el arriendo. Si `UNIQUE (document_id, kind)` choca, otra ejecución ya lo guardó: se completa sin error y sin un segundo RIDE.
- **Clasificación de fallos:**

  | Fallo | Acción |
  | --- | --- |
  | Pool ocupado (cola llena) o apagado pedido | Reprogramar sin consumir el intento |
  | Plazo del render vencido, worker caído, error inesperado | `FAIL` reintentable con backoff |
  | `RIDE_GLYPH_MISSING`, `RIDE_SOURCE_*`, `RIDE_AUTHORIZATION_MISMATCH`, `RIDE_LOGO_INTEGRITY`, `RIDE_FONTS_UNAVAILABLE` | `STOP` determinista: reintentar da lo mismo |

  Los límites son `RIDE_JOB_MAX_ATTEMPTS` y el backoff de la cola. El comprobante sigue `AUTHORIZED`: el fallo es estado del job.
- **Reintento manual.** `POST /documents/{id}/ride-attempts`, con el permiso `archive.retryRide`, en el patrón de `POST /invoices/{id}/signing-attempts`. Se admite si el comprobante está `AUTHORIZED`, no tiene `RIDE_PDF` y su generación está `STOPPED`. Nunca reemplaza un RIDE, nunca deja dos jobs activos y nunca cambia el estado fiscal.
  - Encola un job `MANUAL` con `requested_by`.
  - Las solicitudes simultáneas chocan en la clave activa y solo una se programa.
  - Responde `409 RIDE_ALREADY_AVAILABLE` si ya existe el RIDE, y `409 RIDE_GENERATION_IN_PROGRESS` si hay un job activo.
  - Se rechaza con `409 DOCUMENT_NOT_AUTHORIZED` en otro estado.

### D6. Pool de workers del RIDE

- **Extracción conservadora.** La primitiva genérica sale de `crypto-worker-pool.ts` a `platform/workers/worker-pool.ts`: workers fijos, cola acotada, plazo que termina y reemplaza el worker, resultados tipados y cierre ordenado.
  - Antes de mover código se fija la semántica del pool criptográfico con pruebas de caracterización: cola, ocupado, plazo, reemplazo del worker y cierre ordenado. Esas pruebas y las de la firma pasan igual antes y después del refactor, sin cambiar sus aserciones.
  - `CryptoWorkerPool` y `RideWorkerPool` son instancias independientes de la primitiva, cada una con sus errores, su entrada, su tamaño y su ciclo de vida. El criptográfico conserva sus errores HTTP de hoy.
  - El del RIDE usa la entrada `serve-ride-tasks.ts`, y sus workers cargan pdfmake y las fuentes una vez.
  - No se mezclan las cargas: un render de 100–200 ms y 25–60 KB no debe competir con las firmas.
- **Configuración** (`env.ts`, validada con Zod):

  | Variable | Defecto | Rango |
  | --- | --- | --- |
  | `RIDE_WORKERS` | 2 | 1 a 8 |
  | `RIDE_QUEUE` | 4 | 0 a 64 |
  | `RIDE_TASK_TIMEOUT_MS` | 30000 | 5000 a 120000 |
  | `RIDE_JOB_MAX_ATTEMPTS` | 5 | 1 a 50 |
  | `RIDE_SWEEP_INTERVAL_SECONDS` | 300 | 10 a 86400 |

  El defecto de 2 sale del benchmark de S-4: P95 de 182–191 ms por documento con menos memoria que 4 workers. Que 4 terminen antes un lote no justifica más hilos.
- **Runner propio.** Los jobs `document.*` los toma una segunda instancia del runner, con `RIDE_WORKERS` lazos, así que la concurrencia del job coincide con la del pool y la cola del pool casi nunca se usa.
  - El interruptor de la transmisión (prefijo `sri.`) no la pausa.
  - Comparte el apagado ordenado: deja de tomar trabajo, espera el render en curso hasta el plazo de gracia, vence los arriendos y cierra el pool.
- **Comportamiento:**
  - una cola llena responde ocupado y el job se reprograma sin gastar el intento;
  - un plazo vencido termina el worker, lo reemplaza y falla el intento;
  - un worker que muere se reemplaza;
  - el hilo principal nunca recibe el error original, solo su código.

### D7. Contenido, formato y fuentes

- **Contenido.** El del anexo 2 de la ficha para lo que la factura 1.1.0 del sistema trae (D3), sin datos inventados:
  - **cabecera:** RUC, "FACTURA", número, número y fecha de autorización (en hora de Ecuador), ambiente y emisión (tablas 4 y 2), clave y Code128;
  - **emisor:** razón social, nombre comercial, direcciones de la matriz y del establecimiento, contribuyente especial, obligado a llevar contabilidad, agente de retención y leyenda RIMPE (anexo 22);
  - **comprador:** razón social, identificación, fecha de emisión y dirección si existe;
  - **detalle:** código principal y código auxiliar solo si alguna línea los tiene; cantidad, descripción, precio unitario, descuento y precio total;
  - **formas de pago**, con su denominación del snapshot y su valor;
  - **subtotales llenados**, en el orden del anexo 2: por tarifa de IVA de menor a mayor, 0 %, no objeto y exento; después sin impuestos, descuento, IVA por tarifa y valor total.
- **Composición interna.** El renderer arma secciones independientes, de modo que añadir una (información adicional, ICE, propina) sea un cambio local. Hoy no existe ninguna sección para contenido que el sistema no emite: el lector lo rechaza antes (D3).
- **Formato numérico: el texto exacto del XML,** sin separador de miles ni coma decimal. El anexo 2 no exige un formato.
  - Una transformación léxica sería posible, pero añadiría una regla por campo (cantidad y precio con hasta 6 decimales, importes con 2) sin un requisito que la pida.
  - Se descarta por simplicidad, y nunca se convierte, recalcula ni redondea.
- **Fuentes.**
  - Noto Sans 2.015, Regular y Bold (OFL 1.1), en `backend/assets/fonts/noto-sans/` con `OFL.txt` y un manifiesto (`manifest.json`) con nombre, versión, licencia, archivo y SHA-256.
  - El manifiesto es parte del artefacto de ejecución: el build copia las fuentes, la licencia y el manifiesto a `dist/assets/fonts/noto-sans/`.
  - **Comprobaciones separadas por responsabilidad.** `check:xsd-artifact` sigue comprobando solo los esquemas. Un script nuevo, `check:ride-assets`, comprueba en el artefacto construido el manifiesto, las fuentes, la licencia y cada hash. `verify` ejecuta los dos.
  - **Readiness por responsabilidad.** Un XSD faltante o alterado deja no lista la emisión (como hoy). Unas fuentes o un manifiesto faltantes o alterados dejan no listo el RIDE: `/health/ready` responde no listo con el motivo en el log, y el runner del RIDE no toma jobs. Son dos comprobaciones distintas, cada una con su detalle.
  - Se embeben con subconjunto y solo dentro del PDF; no se sirven por otra ruta.
  - Cada carácter dibujado debe tener glifo en ambas; si no, `RIDE_GLYPH_MISSING` con los códigos.
- **Code128.**
  - bwip-js codifica la clave, y las barras se dibujan como rectángulos vectoriales con zona de silencio de 10 módulos.
  - Módulo de 0.329 mm y alto de al menos el 15 % del ancho y 6.35 mm.
  - La clave completa va debajo como texto.
- **Paginación.**
  - A4; encabezado repetido desde la segunda página (número, RUC y clave), encabezado del detalle repetido y pie "Página X de Y".
  - Las filas nunca se parten y el bloque de totales y formas de pago es indivisible.
- **Determinismo.**
  - La fecha de creación del PDF es la de autorización, y pdfkit deriva el identificador y el prefijo de las fuentes de datos fijos.
  - Con las mismas versiones y la misma entrada, los mismos bytes. Las pruebas lo comprueban; no se promete entre versiones distintas.

### D8. Descargas, impresión y nombres de archivo

- **Rutas** (D10):
  - `GET /documents/{id}/ride`;
  - `GET /documents/{id}/authorized-xml`;
  - `GET /documents/{id}/signed-xml`;
  - `POST /documents/{id}/print-requests`.

  No hay rutas con nombres o rutas de archivo del cliente.
- **Antes de servir** (los tres `GET`):
  1. Se comprueban la sesión y el permiso (`401` y `403`), y después la empresa de la sesión y el comprobante: si es de otra empresa o no existe, `404`.
  2. Se comprueba la disponibilidad (D2): si no hay documento, `404 DOCUMENT_NOT_AVAILABLE`.
  3. Se leen los bytes del artefacto por `(company_id, document_id, kind)` y se recalculan el SHA-256 y el tamaño. Si no coinciden, `500 ARTIFACT_INTEGRITY_FAILED`, sin servir nada, con un log de error y una métrica.
  4. Determinado que se responde con el artefacto, se registra `DOWNLOAD` (D9).
  5. Se sirven los bytes.
- **`DOWNLOAD`** significa que la aplicación inició una respuesta autorizada de descarga con el artefacto. No significa que el cliente terminó de recibir o guardar el archivo.
- **Cabeceras:**
  - `Content-Type` (`application/pdf` o `application/xml`) y `Content-Length`;
  - `Content-Disposition: attachment` con el nombre de archivo;
  - `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` y `ETag` con el SHA-256.
- **Nombre de archivo:** `{tipo}-{número}.{pdf|xml}`, con sufijo `-autorizado` o `-firmado` en los XML. Ejemplo: `factura-001-001-000000001-autorizado.xml`. El tipo sale de una tabla fija y el número, del comprobante, con el patrón `\d{3}-\d{3}-\d{9}` comprobado. Nunca se usa texto del cliente.
- **Impresión como acción explícita.** Un `GET` nunca registra una solicitud de impresión, así que una precarga, una caché, un rastreador o una repetición automática no crean `PRINT_REQUESTED` falsos.
  1. La interfaz llama a `POST /documents/{id}/print-requests` (permiso `archive.download`).
  2. El servidor comprueba lo mismo que una descarga (pasos 1 a 3), registra `PRINT_REQUESTED` y responde `201` con el evento (identificador y momento), sin bytes.
  3. La interfaz pide los bytes con el mismo `GET /documents/{id}/ride`, que registra su `DOWNLOAD` porque la aplicación sí sirvió el artefacto.
  4. Los abre como blob en un `iframe` oculto y llama a `print()`.

  No hay una versión "imprimible" ni otro artefacto: son los mismos bytes del `RIDE_PDF`. Una impresión deja, por tanto, un `PRINT_REQUESTED` y un `DOWNLOAD`, y cada uno dice exactamente lo que la aplicación hizo.

### D9. Historial de entregas

- **Tabla `document_delivery_event`,** de solo agregado (triggers contra `UPDATE`, `DELETE` y `TRUNCATE`):
  - `id`, `company_id` y `document_id` (FK compuesta al comprobante);
  - `event` (`DOWNLOAD` o `PRINT_REQUESTED`);
  - `artifact_kind` y `artifact_sha256`;
  - `actor_user_id` (FK con `RESTRICT`: desactivar un usuario no borra el historial, RF-409);
  - `request_id` y `occurred_at`.
- **Momento del registro.** La entrega se registra después de verificar la integridad y antes de enviar los bytes: significa que la aplicación inició una descarga autorizada. Una solicitud rechazada por permiso, disponibilidad o integridad no deja entrega.
- **Consulta:** `GET /documents/{id}/deliveries`, las 100 más recientes con el total, sin hash completo en la vista (solo el tipo de documento, el evento, el actor y el momento).
- **Sin auditoría duplicada.** Las entregas no se registran en `audit_event`: el historial es su única fuente de verdad (D12).
- **Puerto de notificación.** `DocumentNotificationPort` (`fiscal/application/ports.ts`), sin implementación ni cableado: el punto de extensión del correo en P1. Sus eventos futuros reflejarán la evidencia del proveedor (Q-24).

### D10. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/documents` | Bandeja con filtros y paginación (D2) | `archive.read` |
| `GET /api/v1/documents/{documentId}` | Resumen: documentos disponibles, artefactos y generación del RIDE | `archive.read` |
| `GET /api/v1/documents/{documentId}/ride` | RIDE guardado; registra `DOWNLOAD` | `archive.download` |
| `GET /api/v1/documents/{documentId}/authorized-xml` | XML autorizado guardado; registra `DOWNLOAD` | `archive.download` |
| `GET /api/v1/documents/{documentId}/signed-xml` | XML firmado guardado; registra `DOWNLOAD` | `archive.download` |
| `POST /api/v1/documents/{documentId}/print-requests` | Solicitud de impresión del RIDE guardado (`201`, sin bytes); registra `PRINT_REQUESTED` | `archive.download` |
| `GET /api/v1/documents/{documentId}/deliveries` | Historial de entregas | `archive.read` |
| `POST /api/v1/documents/{documentId}/ride-attempts` | Reintentar una generación detenida (`202`) | `archive.retryRide` |

- El detalle de la factura y su transmisión siguen en `/invoices`. Ninguna ruta de generación, render o hash.
- **Contratos** en `packages/contracts/src/archive.ts`: filtros, vistas, códigos de error, estados de la generación y eventos de entrega.
- El registro OpenAPI declara las respuestas binarias con `binaryContentTypes`, y `openapi-routes.test.ts` cubre las rutas.

### D11. Permisos

- **Permisos nuevos:**
  - `archive.read` para la bandeja, el resumen y las entregas;
  - `archive.download` para descargar e imprimir;
  - `archive.retryRide` para reintentar una generación detenida.

  Los tres son de `ADMIN` y `OPERATOR`.
- **Fila de la matriz.** `archive.read` y `archive.download` son literalmente la fila "Consultar la bandeja y descargar XML y RIDE" (ambos roles).
- **El reintento** no tiene fila propia. Este cambio lo confirma bajo esa misma fila, como `add-invoice-emission` confirmó `invoices.retrySigning` bajo "Corregir un comprobante con XML inválido", y lo registra así en `access-control.md`:
  - solo vuelve a programar la producción del mismo documento que el usuario ya tiene derecho a descargar;
  - no cambia datos fiscales, no reemplaza un RIDE y no deja dos jobs activos;
  - darlo solo al administrador sería una separación de roles sin fuente en la matriz.
- Se actualizan `access-policy.ts`, su espejo del frontend (la prueba de espejo del cambio 7 lo comprueba) y `access-control.md`, cuya prueba de documentación también lo comprueba.

### D12. Auditoría

- **Ningún evento nuevo.** Las descargas y las solicitudes de impresión son historial operativo (D9).
- **El reintento manual** queda en el job, con origen `MANUAL`, quien lo pidió y el momento.
- **La generación automática** queda en el artefacto y en el job.
- Ninguna de estas acciones cambia datos fiscales ni de acceso, que es lo que audita `audit-trail`.

### D13. Pantallas

**`Comprobantes` (bandeja, `/comprobantes`).**

- **Brief:**
  - **usuario:** administrador u operador;
  - **objetivo:** encontrar un comprobante emitido para descargarlo, imprimirlo o revisar su estado;
  - **decisión:** qué comprobante abrir o qué documento entregar;
  - **información mínima:** número, fecha, receptor, total, estado y si el RIDE está disponible;
  - **acción principal:** abrir el comprobante.
- **Uso:** diario y rutinario, por usuarios con experiencia media, primero en escritorio. Un error es leve, porque solo lee y descarga.
- **Niveles:** P0 número, estado y RIDE; P1 fecha, receptor y total; P2 filtros avanzados (establecimiento, punto y tipo); P3 (identificadores y hashes) no se muestra.
- **Componentes:**
  - `AppDataTable` con paginación del servidor y filtros en la URL;
  - `ChipGroup` del estado y búsqueda por número o receptor;
  - `Select` de establecimiento, punto y tipo; el de tipo se oculta mientras haya un solo tipo;
  - rango de fechas con dos `DatePickerField`.
- **`DatePickerField`** es el componente compartido que pide `component-system.md` y todavía no existe. Se implementa sobre `<input type="date">`, localizado por el navegador, con etiqueta, limpieza y error en el campo, sin una dependencia de calendario. Por debajo de 768 px los filtros pasan a un panel.
- **Fila:** el número enlaza al detalle de su tipo (`/facturas/{id}`). Si el RIDE está disponible, un botón de icono descarga el RIDE (P1). El estado usa la insignia y el texto del glosario.

**Sección "Documentos" en el detalle de la factura** (debajo de "Transmisión al SRI").

- **Brief:**
  - **objetivo:** entregar el comprobante autorizado;
  - **decisión:** qué documento descargar o si imprimir;
  - **información mínima:** si el RIDE está disponible, en preparación o detenido;
  - **acción principal:** "Descargar RIDE".
- **Niveles:** P0 el estado del RIDE y la acción; P1 "Imprimir", "XML autorizado" y "XML firmado" (este último rotulado como firmado); P2 el historial de entregas plegable; P3 (hashes, versiones del renderer y procedencia) no se muestra.
- **"Imprimir"** llama primero a `POST /print-requests` y, si responde `201`, pide el RIDE con el mismo `GET` de la descarga y abre el diálogo de impresión (D8). Un error del `POST` se explica y no abre el diálogo.
- **Rótulos:** "XML autorizado" solo para el `AUTHORIZED_XML` que devolvió el SRI. El RIDE generado desde el respaldo nunca se rotula como salido de un XML autorizado.
- **Estados:**
  - autorizado con RIDE;
  - RIDE en preparación, con refresco cada 5 s mientras está pendiente;
  - RIDE detenido, con su motivo y "Reintentar generación" para quien tiene el permiso;
  - sin autorizar, solo el XML firmado;
  - reservado, sin documentos.

  Se cubren también la carga, el error, sin permiso, el diseño responsive, los dos temas y el teclado.

### D14. Observabilidad

- **Ya existentes por tipo:** `fiscal_jobs{type="document.render_ride",status}` y `fiscal_jobs_oldest_pending_age_seconds{type}`.
- **Nuevas:**

  | Métrica | Tipo | Significado |
  | --- | --- | --- |
  | `ride_render_duration_seconds` | Histograma | Duración del render en el worker, sin la espera |
  | `ride_job_wait_seconds` | Histograma | Del momento programado del job al inicio del render: la espera de cola |
  | `ride_render_failures_total{code}` | Contador | Fallos por código acotado (`RIDE_GLYPH_MISSING`, `RIDE_SOURCE_INVALID`, `TIMEOUT`, `BUSY`…) |
  | `documents_authorized_without_ride` | Gauge | Comprobantes autorizados sin `RIDE_PDF` |
  | `document_deliveries_total{event}` | Contador | `DOWNLOAD` y `PRINT_REQUESTED` servidos |
  | `artifact_integrity_failures_total{kind}` | Contador | Descargas rechazadas por integridad |

- **Nunca** bytes, XML, claves de acceso completas, datos del comprador ni identificadores de empresa como etiqueta.
- Ninguna métrica se llama "entregado": las entregas son acciones de la aplicación.
- **Alertas propuestas** en `observability.md`:
  - autorizados sin RIDE durante más de 15 minutos;
  - fallos deterministas del render;
  - cualquier fallo de integridad de un artefacto.

### D15. Rendimiento

- Objetivo de S-4: P95 del render menor que 1 s por documento en el entorno registrado, sin la espera de cola.
- `bench:ride` (gate dedicado fuera de `verify`, como `bench:emission`) mide 50 RIDE representativos con calentamiento aparte, con el código real: el job, el lector, el pool del RIDE y la persistencia. Informa por separado el render (P50, P95 y máximo) y la espera de cola, con el comprobante autorizado desde el XML del builder real.
- **El event loop HTTP nunca ejecuta pdfmake.**
  - Una prueba de arquitectura limita pdfmake, bwip-js y fontkit a la infraestructura del RIDE que solo carga la entrada del worker.
  - Una prueba concurrente genera varios RIDE a la vez por el pool mientras mide el retraso del event loop del hilo principal y atiende peticiones HTTP: el retraso máximo queda muy por debajo de un render (100–220 ms en el hilo, S-4).
  - `bench:ride` informa también ese retraso.
- Los 200 ms del spike no son una promesa universal de hardware.

### D16. Briefs de las operaciones sensibles

| Pregunta | Descargas e impresión | Reintento de la generación | Bandeja y entregas |
| --- | --- | --- | --- |
| Quién | `archive.download` | `archive.retryRide` | `archive.read` |
| Empresa del llamador | La de la sesión | La de la sesión | La de la sesión |
| Empresa del recurso | `electronic_document.company_id` | Igual | Igual |
| Propiedad | Lectura por `(company_id, id)`; artefacto por `(company_id, document_id, kind)` | Igual | Filtro por empresa en toda consulta |
| ¿Otro ID llega a otra empresa? | No: `404` sin datos | No: `404` | No |
| Dos veces | Dos entregas, porque son dos descargas servidas o dos solicitudes explícitas; un `GET` nunca registra una impresión | La segunda choca con el job activo: `409` | Sin efecto |
| A la vez | Dos entregas independientes | Una sola se programa (clave activa) | Sin efecto |
| Idempotencia | No aplica a una lectura | La clave activa del job | No aplica |
| Restricciones de la base | Artefacto inmutable y único por tipo; entrega de solo agregado con FK compuesta | Clave activa única; `RIDE_PDF` único | — |
| Auditoría | No; historial de entregas (D12) | No; el job guarda quién la pidió | No |
| Pruebas de autorización | Sin sesión, sin permiso, otra empresa, no disponible e integridad | Sin permiso, otra empresa, estados y simultaneidad | Sin permiso, otra empresa y filtros |
| Filtración | Ningún byte antes de verificar; nombre de archivo sin texto del cliente; errores sin rutas | Mensajes sin datos internos | Vistas sin hashes ni datos técnicos |

### D17. Checklist de PR fiscal (CTX §65)

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Fuente oficial | Ficha v2.34, §9.19–9.21, anexo 2 (página 60) y anexo 22; ERS RF-401..409; CTX §30, §31, §45 y §46 |
| 2 | Versión y fecha | Ficha v2.34 del 2026-07-27 |
| 3 | ¿Afecta XSD? | No |
| 4 | ¿Afecta clave de acceso? | No se genera: se dibuja la persistida |
| 5 | ¿Afecta firma? | No |
| 6 | ¿Afecta catálogo tributario? | No: las denominaciones salen del snapshot |
| 7 | ¿Afecta cálculos? | No: los importes salen del XML sin recalcular |
| 8 | ¿Afecta RIDE? | Sí: este cambio lo crea (ADR 0022) |
| 9 | ¿Afecta secuenciales? | No |
| 10 | ¿Afecta estados o reintentos? | No cambia estados fiscales. Añade el job del RIDE con sus reintentos |
| 11 | ¿Incluye fixtures? | Facturas del builder real, validadas contra el XSD y firmadas con la firma sintética |
| 12 | ¿Incluye pruebas? | Sí: Code128 decodificado con pdf.js y zxing, Unicode, paginación, seguridad, determinismo y concurrencia |

## Risks / Trade-offs

- **[Riesgo] Un carácter sin glifo detiene el RIDE de una factura autorizada** → Noto Sans cubre latín, griego y cirílico. La detención es visible y alertada. Si llega a ocurrir, una fuente adicional en otro cambio y el reintento manual lo resuelven sin tocar el comprobante.
- **[Riesgo] El RSS sube con los workers del RIDE** (unos 120 MiB en el benchmark) → Dos workers por defecto, configurables, y un heap que vuelve a su base tras la recolección (sin fugas).
- **[Compromiso] El RIDE ocupa 25–60 KB por factura en PostgreSQL** → Entra en el mismo almacenamiento que los XML (ADR 0010). El puerto permite migrar a almacenamiento de objetos.
- **[Riesgo] Una dependencia nueva cambia los bytes en una actualización** → Los RIDE guardados no se regeneran, y las pruebas fijan el determinismo por versión. Los metadatos permiten diagnosticar con qué versión se generó cada uno.
- **[Riesgo] `@types/pdfmake` mete los tipos del navegador** → Declaraciones locales mínimas (ADR 0022).
- **[Compromiso] Un `GET` que registra `DOWNLOAD`** → Es un registro de acceso de una respuesta que sí se sirvió, no un comando de negocio: `DOWNLOAD` no afirma que el cliente guardó el archivo. La impresión, que sí es una intención del usuario, va por `POST` (D8).
- **[Riesgo] Una factura futura con contenido nuevo no tiene RIDE** → El lector la detiene con `RIDE_SOURCE_UNSUPPORTED` en vez de omitir contenido. El cambio que amplíe la emisión amplía el lector y el renderer.
- **[Riesgo] El fallback al XML firmado podría confundirse con un XML autorizado** → La procedencia queda guardada y visible para soporte. La interfaz nunca rotula el XML firmado como autorizado y la ruta del XML autorizado responde no disponible.

## Migration Plan

1. **Migración aditiva:**
   - CHECK de `document_artifact` con `RIDE_PDF` y `application/pdf`;
   - tabla `document_delivery_event` con sus triggers y su índice `(company_id, document_id, occurred_at)`;
   - índices de la bandeja: `(company_id, issue_date, id)` y `(company_id, buyer_identification)`.

   Los datos existentes siguen válidos.
2. **Despliegue.** Al arrancar, el barrido encola el RIDE de cada autorizado existente, y el runner del RIDE los genera de a `RIDE_WORKERS`.
3. **Reversión.** Hacia adelante. Una versión anterior ignora los artefactos `RIDE_PDF` y la tabla de entregas, y no los borra.

## Open Questions

Ninguna que cambie los specs, el enfoque o las tareas.
