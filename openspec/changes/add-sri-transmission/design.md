# Design

## Context

Ver `proposal.md` para la motivación. Estado de partida, tras `add-invoice-emission`:

- **Comprobante.** `electronic_document` admite `RESERVED` y `SIGNED`. Un CHECK exige `signed_at` si y solo si el estado es `SIGNED`, y el trigger `electronic_document_guard` solo permite `RESERVED` → `SIGNED` y congela el snapshot, la clave y la fecha.
- **Artefactos.** `document_artifact` guarda el `SIGNED_XML` con sus bytes exactos (`BYTEA`), su SHA-256 y su tamaño, con `UNIQUE (document_id, kind)` y el CHECK `kind IN ('SIGNED_XML')`. `ArtifactStore.read` devuelve los bytes sin recalcular el hash.
- **Firma.** El paso a `SIGNED` ocurre en una transacción de `invoices/application/signing-pipeline.ts`, con el artefacto, la transición y la auditoría.
- **Infraestructura existente.** Hay una prueba end-to-end con una trampa de salida que exige cero conexiones. No hay cola de jobs, ni tablas de intentos, ni puerto de transporte, ni variables del SRI.
- **Decisiones vigentes**, del 2026-10-03:
  - ADR 0012, aceptado: cola durable propia;
  - enmienda del transporte del ADR 0018: adaptador SOAP propio sobre `fetch`;
  - Q-07: `NOT_AUTHORIZED` es terminal;
  - Q-16: fuera del cambio;
  - Q-34: la parte SOAP resuelta;
  - BR-28: fuera del cambio;
  - decisiones de `fiscal-emission.md`, sección "Decisiones para el diseño de `add-sri-transmission`".
- **Fuentes técnicas:** CTX §7 (servicios), §21–§27 (recepción, autorización, errores 70, 43 y 45), §29 (tamaño), §32–§34 (mensajes, timeouts, worker), §44–§45 (normalización y XML autorizado), §52 (casos A–E) y §61 (I-09, I-11, I-15 a I-19). ERS §12.1 (estados mínimos) y RF-520..525.
- **Fuentes oficiales verificadas durante apply** (2026-10-04, `/opsx:update`): la ficha v2.34 en PDF, con el mismo SHA-256 de los catálogos (§7.2.3, §7.5, §8.2.3, §8.4, tabla 6 y tabla de errores), y los tres WSDL oficiales del ambiente de Pruebas (`RecepcionComprobantesOffline`, `AutorizacionComprobantesOffline` y `ConsultaComprobante`), guardados con su SHA-256 en `docs/product/sri-wsdl/`.

## Goals / Non-Goals

**Goals:**
- Que un comprobante `SIGNED` llegue al SRI con sus bytes exactos y termine en un estado definitivo o reconciliable, sin perder evidencia ni duplicar efectos.
- Mantener separados tres modelos: el estado fiscal del comprobante, el estado del job y el intento con el SRI.
- Diseñar la transmisión sobre el comprobante genérico (`electronic_document`), reutilizable por los otros cinco tipos.

**Non-Goals:**
- El RIDE, la descarga, la bandeja, las anulaciones (Q-16) y la corrección de devueltos (BR-28).
- El envío por lotes (CTX §29: el MVP envía de uno en uno).
- Garantías de rendimiento con el SRI real: el ambiente de Pruebas no se usa para medir (CTX §49).
- Ejecutar S-3 online: este cambio trae su procedimiento, no su evidencia.

## Decisions

### D1. Módulos y fronteras

| Módulo | Responsabilidad nueva |
| --- | --- |
| `platform/jobs` | Cola durable genérica (ADR 0012): repositorio, selección con `SKIP LOCKED`, arriendo, backoff, detención, runner con workers configurables y apagado ordenado. No conoce el SRI. |
| `sri-engine` | Puerto `SriTransport` y su adaptador sobre `fetch`; sobres SOAP; endpoints por ambiente; parsers de las respuestas de recepción y autorización; circuit breaker. Es el único lugar que habla con el SRI. |
| `fiscal` | Máquina de transmisión (dominio), clasificación de resultados, reconciliación y casos de uso de los handlers; repositorios de intentos, respuestas y resultados; artefacto `AUTHORIZED_XML`; exporta `enqueueTransmissionIn(scope, document)` para la transacción que firma. |
| `invoices` | Llama a `enqueueTransmissionIn` en la transacción que firma; ruta de reconciliación manual y vista de la transmisión de la factura. |
| `identity` | Permiso `invoices.reconcile`, solo del administrador. |
| `audit` | Acciones `invoice.reconciliation_requested` e `invoice.reconciliation_completed`. |
| `catalogs` | Dataset y lectura de la política de tamaño del envío (D17). |
| Frontend | Estados nuevos en `Facturas` y la sección de transmisión del detalle. |

- La transmisión vive en `fiscal`, no en `invoices`, porque no depende del tipo de comprobante: opera sobre `electronic_document` y su `SIGNED_XML`.
- `invoices` solo compone sus casos de uso para la API.
- El dominio y la aplicación nunca importan `fetch` ni el parser XML: una regla de ESLint y una prueba de arquitectura lo comprueban, como ya ocurre con `facturacion-electronica-ec`.

### D2. Tres modelos separados

| Modelo | Dónde | Qué es | Qué no es |
| --- | --- | --- | --- |
| Estado fiscal (DOCUMENT STATE) | `electronic_document.state` y `document_state_transition` | El estado tributario del comprobante y su historial, con causa, actor y el intento que la originó | No es la planificación ni la ejecución del trabajo |
| Estado del job (JOB STATE) | `job` | La planificación, el arriendo, los reintentos y la ejecución | No es historial fiscal: un job terminado no dice nada del comprobante |
| Intento con el SRI (SRI ATTEMPT) | `sri_attempt`, `sri_response` y `sri_attempt_result` | La evidencia de cada interacción concreta con el SRI y su clasificación | No es una máquina de estados: nunca se consulta para decidir un estado sin la transición |

- **Toda transición de la transmisión** lleva en sus metadatos el `sriAttemptId` que la causó y la causa (`TRANSMISSION`, `AUTHORIZATION` o `RECONCILIATION`).
- **El job referencia al comprobante,** y el intento referencia al job que lo ejecutó. Ningún estado fiscal se deduce del estado del job.

### D3. Máquina fiscal de la transmisión

```text
SIGNED ──▶ RECEIVED ──▶ AUTHORIZED
  │           │  └────▶ NOT_AUTHORIZED
  │           └───────▶ MANUAL_REVIEW
  ├──▶ RETURNED
  └──▶ SEND_UNKNOWN ──▶ RECEIVED | AUTHORIZED | NOT_AUTHORIZED | RETURNED | MANUAL_REVIEW
MANUAL_REVIEW ──(solo reconciliación manual)──▶ RECEIVED | AUTHORIZED | NOT_AUTHORIZED
```

| Desde | Hacia | Disparador | Actor |
| --- | --- | --- | --- |
| `SIGNED` | `RECEIVED` | Recepción `RECIBIDA` | Sistema |
| `SIGNED` | `RETURNED` | `DEVUELTA` concluyente, sin 70, 43 ni 45 | Sistema |
| `SIGNED` | `SEND_UNKNOWN` | Resultado incierto, 70, 43 o 45 | Sistema |
| `SEND_UNKNOWN` | `RECEIVED` | La reconciliación ve la clave en procesamiento, o un reenvío responde `RECIBIDA` | Sistema o administrador |
| `SEND_UNKNOWN` | `AUTHORIZED` o `NOT_AUTHORIZED` | La reconciliación obtiene una autorización concluyente y válida | Sistema o administrador |
| `SEND_UNKNOWN` | `RETURNED` | Un reenvío permitido responde `DEVUELTA` concluyente | Sistema |
| `SEND_UNKNOWN` | `MANUAL_REVIEW` | Criterios de D4 | Sistema o administrador |
| `RECEIVED` | `AUTHORIZED` o `NOT_AUTHORIZED` | Autorización concluyente y válida | Sistema o administrador |
| `RECEIVED` | `MANUAL_REVIEW` | Criterios de D4 | Sistema o administrador |
| `MANUAL_REVIEW` | `RECEIVED`, `AUTHORIZED` o `NOT_AUTHORIZED` | Una reconciliación manual obtiene un resultado concluyente o "en procesamiento" | Administrador |

- **Terminales:** `AUTHORIZED` y `NOT_AUTHORIZED`. `RETURNED` no tiene salida en este cambio (BR-28 es futura).
- **Reenvío.** Parte de `SEND_UNKNOWN` y no es una transición: el comprobante sigue en `SEND_UNKNOWN` hasta que la respuesta del reenvío se clasifica. Nunca hay `SEND_PENDING`: el envío en curso es un estado del job.
- **Doble defensa:**
  - el dominio expone `canTransition` y cada transición es una actualización guardada (`WHERE state = :esperado`);
  - el trigger `electronic_document_guard` se reescribe con esta tabla, de modo que un camino de código erróneo no puede saltársela.
- `signed_at` es obligatorio en todo estado posterior a `RESERVED`, y el CHECK actual se sustituye.

### D4. `MANUAL_REVIEW` (resuelve Q-06)

- **Fuente.** ERS §12.1 lista `MANUAL_REVIEW` entre los estados mínimos del comprobante: "Requiere intervención por inconsistencia o condición no automatizable". CTX §26 lo dibuja en la máquina del documento, y CTX §34 lleva a él cualquier respuesta de autorización que no se puede normalizar. Por eso es un estado fiscal del comprobante, no una condición operativa.
- **Entrada, lista cerrada:**
  1. **Respuesta inconsistente con el comprobante:**
     - la clave consultada o la del comprobante es distinta;
     - el ambiente es distinto (I-09);
     - un `AUTORIZADO` sin número o sin fecha, o con un número distinto de la clave (CTX §23: en off-line, el número de autorización es la clave);
     - un XML autorizado cuya `claveAcceso` no coincide;
     - varias autorizaciones que no se resuelven por D12.
  2. **Error 45** cuya reconciliación muestra que el SRI no conoce esta clave: el secuencial está registrado con otra.
  3. **Ventana de conclusión agotada:**
     - el SRI siguió respondiendo sin conclusión;
     - o, tras evidencia de que recibió el comprobante (`RECIBIDA`, 70 o 43), siguió sin conocer la clave;
     - la ventana es configurable, con 24 horas por defecto desde la primera evidencia de recepción (CTX §23.1).
- **No entra por errores técnicos recuperables.** Timeouts, SRI caído, HTML o SOAP Fault dejan el comprobante en su estado (`SIGNED`, `SEND_UNKNOWN` o `RECEIVED`) con su job reintentando. Si el job agota sus intentos, queda `STOPPED`, visible y alertado, sin cambiar el estado fiscal.
- **Salida:** solo una reconciliación manual (D15), que aplica las reglas de D12 y D15 con una excepción: desde `MANUAL_REVIEW`, una clave desconocida no habilita el reenvío y el comprobante sigue en revisión.
- **Lo que nunca hace:** liberar el número, cambiar la clave ni el contenido, ni reenviar sin la decisión de D15.

### D5. Cola de jobs (ADR 0012)

**Tabla `job`** (`platform`, privada por empresa):
- `id`, `company_id` y `type`;
- `dedupe_key`;
- `document_id`, nulo para jobs que no son de un comprobante;
- `payload`, en JSONB, sin secretos;
- `status`: `PENDING`, `LEASED`, `DONE` o `STOPPED`;
- `scheduled_at` y `next_attempt_at`;
- `attempt_count`, `max_attempts` y `deadline_at`;
- `lease_owner` y `lease_expires_at`;
- `last_error_code`, `last_error_class`, `last_error_at` y `last_error_detail`, seguro y acotado;
- `origin` (`AUTOMATIC` o `MANUAL`), `requested_by` y `reason`;
- `created_at`, `updated_at` y `completed_at`.

**Índices.** Prisma no expresa índices parciales, así que cada unicidad entre jobs activos es una
columna única que solo tiene valor mientras el job está `PENDING` o `LEASED`, y un CHECK la ata a su
origen (el precedente es `signing_certificate.active_company_id`):
- `active_dedupe_key` única, igual a `dedupe_key` mientras el job está activo: no hay dos jobs activos equivalentes;
- `active_sri_document_id` única, igual a `document_id` mientras un job `sri.*` está activo: como máximo una interacción activa con el SRI por comprobante, en cualquier fase;
- de selección `(status, next_attempt_at)`.

**Selección.** Un `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *` toma:
- jobs `PENDING` vencidos;
- o `LEASED` con el arriendo vencido.

Fija `lease_owner` y `lease_expires_at` e incrementa `attempt_count`. Es SQL crudo en la infraestructura de `platform/jobs`, con la tabla calificada por el esquema configurado: el adaptador de Prisma no califica el SQL crudo, como se vio en el cambio 6. Una prueba lo ejecuta en un esquema distinto de `public`.

**Finalización.**
- El handler confirma su decisión (transición, siguiente job y job actual `DONE`) en una sola transacción.
- Esa transacción está guardada por `lease_owner = yo AND status = 'LEASED'`: si el arriendo se perdió, se revierte sin efecto.

**Fallos.**
- Un error se guarda tipado: código, clase (`RETRYABLE`, `DETERMINISTIC` o `INTEGRITY`), momento y detalle seguro.
- El siguiente intento se programa con backoff exponencial con jitter completo, `next = now + random(0, min(cap, base·2^n))`, nunca por debajo de un mínimo.
- Con `max_attempts` o `deadline_at` agotados, el job pasa a `STOPPED`.
- Un error `DETERMINISTIC` o `INTEGRITY` lo detiene enseguida.
- No hay reintentos infinitos ni bucles calientes.

**Runner.**
- `SRI_JOB_WORKERS` workers en el proceso de la API (0 lo desactiva); también puede correr como proceso separado de la misma imagen.
- Sondea a intervalos con jitter.
- Al apagar:
  1. deja de tomar trabajo;
  2. espera a los jobs en curso hasta un plazo de gracia;
  3. libera los arriendos de los no terminados con `lease_expires_at = now()`, para que otro los retome.

  Se registra como `closer` en `platform/lifecycle`.

**Arriendo.**
- Su duración se valida al arrancar: debe superar el presupuesto completo del transporte (conexión, cabeceras y cuerpo) más un margen.
- Un arriendo nunca vence con una llamada en curso, así que no hay latido.

**Transmisión deshabilitada.** `SRI_TRANSMISSION_ENABLED` es falso por defecto. Así:
- el runner no toma jobs `sri.*`: siguen `PENDING`, sin arriendo, sin consumir intentos y sin reintentos;
- no hay ninguna llamada de red al SRI;
- el encolado al firmar y el barrido siguen creando jobs, de modo que habilitarla después continúa con los existentes;
- la instalación puede declararse lista, y lo deja ver: `GET /health/ready` añade un detalle `sriTransmission: "disabled"`, hay una métrica `sri_transmission_enabled` (0 o 1) y un log de arranque sin secretos.

**Transmisión habilitada.** El arranque y la readiness exigen sus precondiciones técnicas:
- endpoints válidos por ambiente;
- una política de tamaño vigente (D17);
- `SRI_JOB_WORKERS` ≥ 1;
- la base de datos;
- un arriendo que cubre el presupuesto del transporte.

Si falta una, `/health/ready` responde `503` con el motivo en el log y no se envía nada. El interruptor nunca salta una invariante fiscal: la integridad, el tamaño y la evidencia previa se aplican igual.

### D6. Tipos de job, deduplicación y backoff

| Tipo | Clave de deduplicación | Lo encola | Reintenta | Límite |
| --- | --- | --- | --- | --- |
| `sri.transmit` | `sri.transmit:{documentId}` | La transacción que firma (D8 de `fiscal`), el barrido y la reconciliación que decide reenviar | Solo fallos demostrablemente anteriores al envío y pausas del circuit breaker. Si la solicitud pudo salir, nunca reintenta: clasifica | `SRI_TRANSMIT_MAX_ATTEMPTS` y `SRI_TRANSMIT_DEADLINE_HOURS` |
| `sri.authorize` | `sri.authorize:{documentId}` | La transición a `RECEIVED` | Consulta idempotente con backoff (base y tope configurables), con la primera tras `SRI_AUTHORIZATION_FIRST_DELAY_SECONDS` (CTX §23.1) | Ventana de conclusión (D4): con respuestas sin conclusión, `MANUAL_REVIEW`; con fallos de transporte, `STOPPED` |
| `sri.reconcile` | `sri.reconcile:{documentId}` | La transición a `SEND_UNKNOWN` (inmediata, o tras `SRI_ERROR70_DELAY_SECONDS` para el 70) y la reconciliación manual | Igual que `sri.authorize` | Igual que `sri.authorize` |

- **Exclusión entre fases y traspaso atómico.**
  - El índice por comprobante (D5) impide dos jobs `sri.*` activos a la vez.
  - Cada job se encola solo en la transacción que termina el anterior. Por ejemplo, `sri.transmit` pasa a `DONE` y `sri.authorize` nace `PENDING`, o al pasar a `SEND_UNKNOWN`, `sri.transmit` pasa a `DONE` y nace `sri.reconcile`.
  - Dentro de esa transacción, el job actual se actualiza a `DONE` antes de insertar el siguiente. Al terminar, el job saliente vacía sus columnas activas, y la unicidad se comprueba por sentencia, así que la inserción ya no choca con él. Nunca hay una ventana sin job ni dos jobs activos.
  - Si dos workers intentan avanzar el mismo comprobante, solo el dueño del arriendo confirma: la guarda de `lease_owner` y la transición guardada revierten al otro.
  - Una reconciliación manual sobre un comprobante con un job activo se rechaza.
- **Barrido idempotente.** Al arrancar y cada `SRI_SWEEP_INTERVAL_SECONDS`, inserta un `sri.transmit` para cada `SIGNED` sin ningún job, con `INSERT … ON CONFLICT DO NOTHING` sobre la clave.
  - Es el backfill de los firmados que existan al desplegar, y la red de seguridad de la garantía transaccional.
  - No reactiva jobs `STOPPED`: eso es una decisión humana (D15).
- **Circuit breaker.** Por servicio (recepción o autorización) y ambiente, en memoria del proceso.
  - Se abre tras N fallos de transporte seguidos y se entreabre tras una pausa.
  - Mientras está abierto, el job se reprograma sin llamar ni consumir intentos; el plazo sigue corriendo.

### D7. Evidencia: intentos, respuestas originales y resultados

| Registro | Qué contiene | Mutabilidad |
| --- | --- | --- |
| `document_artifact` | Los artefactos fiscales del comprobante, uno por tipo: `SIGNED_XML` (lo enviado) y `AUTHORIZED_XML` (lo recibido, nuevo) | Solo agregado; `UNIQUE (document_id, kind)` se mantiene: la autorización ocurre una vez |
| `sri_attempt` | Una fila por interacción: comprobante, job, operación (`RECEPTION`, `AUTHORIZATION`), número de intento, ambiente, endpoint lógico, origen (`AUTOMATIC` o `MANUAL`) y quién la inició, tiempos de inicio, cabeceras y fin, categoría de transporte (D10), estado HTTP, cabeceras seguras (lista permitida: `content-type`, `content-length`, `date`), y código y clase del error de transporte. En los envíos, el SHA-256 y el tamaño del `SIGNED_XML` enviado y del sobre SOAP | Solo agregado, insertada una sola vez con el resultado del transporte |
| `sri_response` | Los bytes exactos de la respuesta (`BYTEA`), su SHA-256, su tamaño y su tipo de contenido. A lo sumo una por intento; no existe cuando no hubo cuerpo | Solo agregado |
| `sri_attempt_result` | La clasificación de un intento: resultado (D11 y D12), mensajes estructurados (identificador, mensaje, información adicional y tipo; la fase es la operación del intento), campos de autorización leídos y versión del clasificador | Solo agregado; a lo sumo uno por intento |

- **Lo que no se duplica.** El cuerpo de la solicitud de envío no se guarda: es el `SIGNED_XML` en base64, y basta con su SHA-256 y el del sobre.
- **Lo que sí se duplica, por regla de CTX §45:** la respuesta de autorización contiene el XML autorizado, y se guarda la respuesta original y también el artefacto extraído.
  - La respuesta es la evidencia del intercambio (CTX §21, §44).
  - El artefacto es el documento fiscal con su hash, que consumen el RIDE y la descarga (cambio 8).
- **Protección.**
  - Triggers de solo agregado en las tres tablas (patrón `fiscal_document_reject_change`).
  - FK compuestas `(company_id, document_id)`.
  - Sin borrado ni purga en v1 (Q-27).
- **Límite de la respuesta.** Un cuerpo de más de `SRI_RESPONSE_MAX_BYTES` (5 MB por defecto) se corta y el intento se clasifica como incierto. Es una defensa operativa, no una regla del SRI.

### D8. Evidencia antes de la clasificación

```text
transporte ─▶ TX A: sri_attempt + sri_response ─▶ COMMIT
           ─▶ clasificar (puro)
           ─▶ TX B: sri_attempt_result + transición guardada + datos de autorización y artefacto
                    + job actual DONE + siguiente job + auditoría (si es manual) ─▶ COMMIT
```

- Ninguna fila de `sri_attempt_result` existe sin su intento confirmado antes, y ninguna transición de la transmisión existe sin su resultado.
- **Si el clasificador falla** con una excepción o un XML ilegible, la TX B guarda un resultado `UNPARSEABLE`, sin conclusión, y el comprobante va a `SEND_UNKNOWN` desde `SIGNED`, o no cambia desde otros estados. El intento y la respuesta permanecen.
- **Caída entre A y B.** Al retomar el job, el handler busca primero el último intento de ese job sin resultado y lo clasifica desde la respuesta guardada, sin llamar al SRI. Es la generalización del caso D de CTX §52.
- **Pérdida del arriendo.** Si se pierde entre A y B, la TX B se revierte. El intento queda como evidencia, y el job lo clasifica al retomarse.
- **Caída durante la llamada** (precisión de apply, CTX §22.3 "proceso cae"). El intento se inserta una sola vez con el resultado del transporte (D7), así que un arriendo de `sri.transmit` que empezó a llamar y no dejó intento se detecta al retomar: los arriendos del job (`attempt_count`) superan a sus intentos registrados. La solicitud pudo salir, así que no se reenvía: el comprobante pasa de `SIGNED` a `SEND_UNKNOWN` (transición ya prevista para un resultado incierto) con su reconciliación. Para que la cuenta sea exacta, un fallo antes de llamar, el breaker abierto y el apagado reprograman el job sin consumir el intento.

### D9. Integridad antes de cada envío

Antes de cada `sri.transmit`, incluidos los reenvíos:

1. leer el `SIGNED_XML` por `(company_id, document_id, kind)`;
2. comprobar que el artefacto pertenece al comprobante y a la empresa;
3. recalcular el SHA-256 y el tamaño y compararlos con los registrados;
4. comprobar que la clave del comprobante coincide con la del snapshot, y que los bytes contienen exactamente una vez `<claveAcceso>{clave}</claveAcceso>`;
5. comprobar que los metadatos del artefacto son coherentes con el comprobante (tipo de documento y versión del esquema del snapshot);
6. comprobar el tamaño contra la política (D17).

- Si una comprobación falla, el job se detiene con `INTEGRITY_FAILED` o `TOO_LARGE`, de clase determinista y con alerta crítica. El estado fiscal no cambia y no hay ninguna llamada al SRI.
- El sobre lleva el base64 del `Buffer` leído, sin pasar por texto.
- Nunca se reconstruye el XML desde el snapshot.

### D10. Transporte SOAP propio (`SriTransport` y `SriInquiryPort`)

- **Puertos, en la aplicación de `sri-engine`:**
  - `SriTransport.exchange({ environment, service, envelope: Buffer })` devuelve un `TransportOutcome`. Los servicios son `RECEPTION`, `AUTHORIZATION` y `VALIDITY` (`ConsultaComprobante`, CTX §7.3, §7.4, §24).
  - `SriInquiryPort` expone `queryAuthorization(environment, accessKey)` y `queryValidity(environment, accessKey)` sobre el transporte (D15). El dominio decide la estrategia, y el transporte implementa los servicios web.
- **Frontera conservadora.** Solo se clasifica como no enviado lo que se puede demostrar:

  | Clase | Cuándo | Efecto |
  | --- | --- | --- |
  | `PROVABLY_NOT_SENT` | El error de `fetch` tiene como causa un fallo anterior a la conexión: DNS (`ENOTFOUND`, `EAI_AGAIN`), conexión rechazada (`ECONNREFUSED`), plazo de conexión interno de Node (`UND_ERR_CONNECT_TIMEOUT`) o un fallo de verificación TLS (códigos `CERT_*`, `*_SELF_SIGNED_*`, `ERR_TLS_*`). En `fetch` la solicitud HTTP solo se escribe después de conectar y completar el TLS | El comprobante sigue `SIGNED` y el envío se reintenta, sin reconciliar |
  | `MAY_HAVE_BEEN_SENT` | Todo lo demás: plazo propio (`AbortController`) hasta las cabeceras, abort durante la solicitud, socket cortado (`UND_ERR_SOCKET`, `ECONNRESET`), plazo de lectura del cuerpo, cualquier causa desconocida o ausente | `SEND_UNKNOWN`, evidencia guardada y reconciliación antes de cualquier reenvío |

  Un plazo propio es siempre ambiguo, porque `fetch` no expone si ya conectó. Por eso no se configura un plazo de conexión propio: el de conexión es el interno de Node, que da un error demostrable. Los plazos configurables son el de las cabeceras (`SRI_REQUEST_TIMEOUT_MS`, desde el inicio) y el de lectura del cuerpo (`SRI_BODY_TIMEOUT_MS`).
- **Resultado de transporte:** `NOT_SENT`, solo `PROVABLY_NOT_SENT`; `REQUEST_TIMEOUT`, `BODY_TIMEOUT` y `CONNECTION_LOST`, todos `MAY_HAVE_BEEN_SENT`; o `RESPONSE`, con el estado HTTP, las cabeceras seguras, el cuerpo exacto y los tiempos de inicio, cabeceras y fin.

  La clasificación del cuerpo de un `RESPONSE` (D11 y D12) distingue:
  - HTTP sin éxito;
  - HTTP 200 sin SOAP (HTML u otra raíz);
  - SOAP Fault;
  - XML mal formado;
  - SOAP válido con la respuesta del SRI.
- **Adaptador.** Usa el `fetch` nativo de Node, solo en la infraestructura de `sri-engine` (excepción a Axios, ADR 0018). Limita los bytes de la respuesta y no fija certificados TLS (CTX §7.5).
- **Endpoints.** Viven en un módulo central versionado con los valores de CTX §7.1–§7.4 por ambiente y servicio, sobrescribibles por variable de entorno. La lógica de negocio nunca ve una URL.
- **Sobres.**
  - Los de `validarComprobante` (elemento `xml`, base64) y `autorizacionComprobante` (elemento `claveAccesoComprobante`) usan los espacios de nombres `http://ec.gob.sri.ws.recepcion` y `http://ec.gob.sri.ws.autorizacion`, verificados en los WSDL oficiales y en la ficha v2.34, §7.2.3. Los elementos hijos no llevan espacio de nombres (`elementFormDefault="unqualified"`) y la acción SOAP es vacía.
  - El de `consultarEstadoAutorizacionComprobante` (elemento `claveAcceso`, espacio de nombres `http://ec.gob.sri.ws.consultas`) sigue el WSDL oficial de `ConsultaComprobante` y el ejemplo de la ficha v2.34, §8.2.3. Q-48 quedó resuelta el 2026-10-04: el adaptador de validez es real.
  - Son funciones puras con pruebas de igualdad de bytes.
- **Pruebas de contrato de la frontera,** contra servidores locales:
  - puerto cerrado y nombre `.invalid`: `NOT_SENT`;
  - TLS con un certificado no confiable: `NOT_SENT`;
  - servidor que acepta y no responde, socket cortado tras leer la solicitud, abort durante la subida, cabeceras sin cuerpo: `MAY_HAVE_BEEN_SENT`;
  - el mapeo de `UND_ERR_CONNECT_TIMEOUT` y de una causa desconocida, con pruebas unitarias.

### D11. Recepción: parser y clasificación

- **Parser XML.** Una dependencia directa con versión exacta: `fast-xml-parser`, ya presente en el árbol en la versión que usa la librería.
  - Configurado para rechazar DTD y `<!DOCTYPE>`: un documento con DTD es `MALFORMED`.
  - Quita los prefijos de espacio de nombres y conserva el orden y el texto exacto.
  - Solo se usa en la infraestructura de `sri-engine`.
- **Clasificación pura**, de bytes a resultado:

  | Entrada | Resultado | Estado desde `SIGNED` |
  | --- | --- | --- |
  | HTTP sin éxito, HTML, cuerpo vacío o XML mal formado | `UNKNOWN` | `SEND_UNKNOWN` |
  | SOAP Fault | `UNKNOWN` | `SEND_UNKNOWN` |
  | `RespuestaRecepcionComprobante` sin `estado` o con un estado desconocido | `UNKNOWN` | `SEND_UNKNOWN` |
  | `estado` `RECIBIDA` | `RECEIVED` | `RECEIVED` y `sri.authorize` |
  | `estado` `DEVUELTA` con un mensaje de identificador `70` | `KEY_IN_PROCESS` | `SEND_UNKNOWN` y `sri.reconcile` tras la espera del 70 |
  | `estado` `DEVUELTA` con identificador `43` o `45` | `KEY_REGISTERED` o `SEQUENTIAL_REGISTERED` | `SEND_UNKNOWN` y `sri.reconcile` |
  | `estado` `DEVUELTA` sin 70, 43 ni 45 | `RETURNED` | `RETURNED` |
  | `claveAcceso` de la respuesta distinta de la del comprobante | `INCONSISTENT` | `MANUAL_REVIEW`, pasando por `SEND_UNKNOWN` en la misma TX B: la tabla de D3 no tiene `SIGNED` → `MANUAL_REVIEW` (precisión de apply) |

- **Mensajes.** Se guardan todos, en orden, con el identificador, el mensaje, la información adicional y el tipo, incluidos los códigos desconocidos (CTX §22.2, §32).
- **Transporte incierto.** `REQUEST_TIMEOUT`, `BODY_TIMEOUT` y `CONNECTION_LOST` llevan a `SEND_UNKNOWN` sin pasar por el parser. `NOT_SENT` deja el comprobante en `SIGNED` y reprograma el job.

### D12. Autorización: parser y clasificación

`RespuestaAutorizacionComprobante` se lee completa: `claveAccesoConsultada`, `numeroComprobantes` y cada `autorizacion` con su `estado`, `numeroAutorizacion`, `fechaAutorizacion`, `ambiente`, `comprobante` y mensajes.

- **Clave desconocida:**
  - con `numeroComprobantes = 0` y sin autorizaciones, el resultado es `KEY_UNKNOWN`;
  - una `claveAccesoConsultada` distinta es `INCONSISTENT`.
- **Una sola autorización:**
  - `AUTORIZADO` válida → `AUTHORIZED`;
  - `NO AUTORIZADO` o `RECHAZADO` → `NOT_AUTHORIZED`. La ficha v2.34 (§7.2.3) titula "Comprobante No Autorizado" su ejemplo con `<estado>RECHAZADO</estado>`, y su tabla 6 solo define los estados PPR, AUT y NAT: los dos textos son el estado no autorizado (decisión del 2026-10-04, `/opsx:update`);
  - cualquier otro estado, o ninguno → `NO_CONCLUSION`. El texto exacto del estado "en procesamiento" (PPR, CTX §23.1) no se supone: toda respuesta que no es `AUTORIZADO`, `NO AUTORIZADO` ni `RECHAZADO` se trata sin conclusión.
- **Validez de un `AUTORIZADO`:**
  - la clave consultada es la del comprobante;
  - `numeroAutorizacion` existe y es igual a la clave (CTX §23);
  - `fechaAutorizacion` se puede leer: ISO 8601 con desfase (el WSDL la declara `xs:dateTime`), o `dd/MM/yyyy HH:mm:ss` en America/Guayaquil, con el texto original conservado;
  - el `ambiente`, normalizado sin tildes (`PRUEBAS` o `PRODUCCION`), es el del comprobante (I-09);
  - si trae `comprobante`, su `claveAcceso` es la del comprobante.

  Si falla una condición, el resultado es `INCONSISTENT` y el comprobante pasa a `MANUAL_REVIEW`.
- **Varias autorizaciones:** si exactamente una es `AUTORIZADO` válida y ninguna otra es `AUTORIZADO`, el resultado es `AUTHORIZED`. Cualquier otra combinación es `INCONSISTENT`. Todas quedan en la evidencia, y nunca se toma la primera.
- **Transporte.** Cualquier fallo de transporte (`NOT_SENT` incluido) es `NO_CONCLUSION` de transporte: el estado no cambia y el job reintenta.

| Resultado | Desde `RECEIVED` | Desde `SEND_UNKNOWN` (reconciliación, D15) |
| --- | --- | --- |
| `AUTHORIZED` | `AUTHORIZED` | `AUTHORIZED` |
| `NOT_AUTHORIZED` | `NOT_AUTHORIZED` | `NOT_AUTHORIZED` |
| `NO_CONCLUSION`, con clave conocida | Sigue `RECEIVED`; nueva consulta o `MANUAL_REVIEW` al agotar la ventana | `RECEIVED` y `sri.authorize` |
| `KEY_UNKNOWN` | Sigue `RECEIVED` (el SRI aún no indexó); ventana | D15 |
| `INCONSISTENT` | `MANUAL_REVIEW` | `MANUAL_REVIEW` |

### D13. Errores 70, 43 y 45

- **70** (CTX §27.2, caso B):
  - el comprobante pasa a `SEND_UNKNOWN` con la causa `KEY_IN_PROCESS`, su respuesta y su mensaje;
  - se encola `sri.reconcile` tras `SRI_ERROR70_DELAY_SECONDS`;
  - el 70 es evidencia de recepción: una clave desconocida no habilita el reenvío (D15);
  - nunca hay otro número, otra clave, otro snapshot ni otro XML.
- **43** (caso E): `SEND_UNKNOWN` con la causa `KEY_REGISTERED` y reconciliación inmediata. También es evidencia de recepción.
- **45:** `SEND_UNKNOWN` con la causa `SEQUENTIAL_REGISTERED` y reconciliación inmediata.
  - Si el SRI conoce la clave, su estado manda.
  - Si no la conoce, el secuencial está registrado con otra clave: `MANUAL_REVIEW`, sin reenvío y sin reservar otro número (CTX §27.3).
- **Pruebas.** Los tres se prueban con respuestas sintéticas de la estructura oficial: ninguno lleva a `RETURNED` y ninguno toca `reserveSequentialIn`.

### D14. `SEND_UNKNOWN`

- **Significado:** no se puede demostrar si el SRI recibió el comprobante, o una respuesta exige consultar antes de decidir.
- **Orígenes:**
  - `REQUEST_TIMEOUT`, `BODY_TIMEOUT` y `CONNECTION_LOST`;
  - HTTP sin éxito, HTML, cuerpo vacío, XML ilegible, SOAP Fault o estado desconocido;
  - los errores 70, 43 y 45.
- **Lo que nunca hace:** es terminal; equivale a `RETURNED` o a `NOT_AUTHORIZED` (I-15, I-16); reenviar sin reconciliar antes.
- **`NOT_SENT` no lleva a `SEND_UNKNOWN`:** la solicitud demostrablemente no salió, y el comprobante sigue `SIGNED` con su `sri.transmit` reintentando.

### D15. Reconciliación automática y manual

- **Un solo caso de uso,** `reconcileDocument(companyId, documentId, origin)`, con `origin` `AUTOMATIC` (job) o `MANUAL` (administrador, motivo). Usa `SriInquiryPort`, y el dominio decide la estrategia:
  1. **Autorización por clave** (`queryAuthorization`): es la consulta que trae la decisión y el XML autorizado. Se aplica D12.
  2. **Validez por clave** (`queryValidity`, `ConsultaComprobante`), solo antes de concluir que el SRI no conoce la clave. Nunca para observar anulaciones (Q-16), ni en la consulta periódica.
- **Por qué la consulta de validez.** Según CTX §24 y la ficha v2.34 (§8.2.3, §8.4), el servicio responde `estadoAutorizacion` (`AUTORIZADO`, `NO AUTORIZADO`, `PENDIENTE DE ANULAR` o `ANULADO`), o, cuando la clave está fuera del rango de fechas o no hay datos, `estadoConsulta` `RECHAZADA` con el error 99. El texto de la ficha nombra `estadoAutorizacion` para ese caso y su ejemplo usa `estadoConsulta`: el parser acepta cualquiera de los dos.
  - El error 99 solo difiere en su información adicional entre "fuera de rango" y "sin datos", y ninguno distingue "no recibido" de "recibido y en proceso". Por eso la consulta de validez nunca autoriza un reenvío.
  - Sí aporta evidencia útil cuando informa un estado: la clave es conocida, y eso impide un reenvío a ciegas. CTX §24.1 la recomienda para reconciliar.
  - Se usa como guarda: solo puede impedir un reenvío.
- **Decisión ante `KEY_UNKNOWN` de la autorización:**

  | Antecedente o evidencia | Decisión |
  | --- | --- |
  | La validez informa `AUTORIZADO` o `NO AUTORIZADO` | No reenviar: `RECEIVED` y `sri.authorize`, que obtiene el registro concluyente |
  | La validez informa `PENDIENTE DE ANULAR` o `ANULADO` | `MANUAL_REVIEW`: es un estado que este cambio no modela (Q-16) |
  | La validez da el error 99, una respuesta sin estado reconocido o un fallo de transporte, y hay evidencia de recepción (`RECIBIDA`, 70 o 43) | No reenviar: nueva consulta dentro de la ventana; al agotarla, `MANUAL_REVIEW` |
  | Igual, con la causa 45 | `MANUAL_REVIEW` |
  | Igual, sin evidencia de recepción (solo incertidumbre de transporte) | Reenviar: encola `sri.transmit` de reenvío con los mismos bytes (D9). El comprobante sigue `SEND_UNKNOWN` |
  | El comprobante está en `MANUAL_REVIEW` | Sigue en `MANUAL_REVIEW`, sin reenvío |

  La evidencia de recepción se calcula a partir de los resultados guardados de sus intentos, no de una bandera mutable.
- **`MANUAL_REVIEW` es la barrera de falla cerrada.** Solo sale con una reconciliación manual que obtiene evidencia concluyente (`RECEIVED`, `AUTHORIZED` o `NOT_AUTHORIZED`). Si la situación sigue ambigua, permanece. No existe una acción "reenviar de todas formas": una acción manual distinta sería un cambio de OpenSpec explícito.
- **Manual:**
  - `POST /api/v1/invoices/{invoiceId}/reconciliations` con `{ reason }` (de 1 a 500 caracteres) y el permiso `invoices.reconcile`.
  - Se admite en `MANUAL_REVIEW`, `SEND_UNKNOWN`, y en `SIGNED` o `RECEIVED` sin un job `sri.*` activo; es decir, con el job detenido.
  - Encola un `sri.reconcile` con `origin = MANUAL`, `requested_by` y `reason`, y responde `202` con el estado actual.
  - Se rechaza con `409`:
    - `SRI_INTERACTION_IN_PROGRESS` si hay un job `sri.*` activo; las solicitudes simultáneas chocan en el índice único y solo una se programa;
    - `INVOICE_NOT_RECONCILABLE` para `AUTHORIZED`, `NOT_AUTHORIZED`, `RETURNED` y `RESERVED`.
  - Una factura de otra empresa es `404`.
- **Historial:**
  - los intentos guardan el origen, quién inició y el job;
  - las transiciones guardan el actor (`SYSTEM`, o `USER` con el administrador) y la causa `RECONCILIATION`;
  - una reconciliación manual se audita (D19).
- **`SIGNED` con su job detenido:** la reconciliación consulta la clave. Si ninguna evidencia muestra que el SRI la conoce y no hay evidencia de recepción, encola el `sri.transmit`. Así el administrador reactiva un envío detenido sin una operación de envío.

### D16. Autorización registrada y artefacto `AUTHORIZED_XML`

- **Columnas nuevas en `electronic_document`:** `authorization_number`, `authorization_date` (`timestamptz`) y `authorization_environment`.
  - Un CHECK las exige en `AUTHORIZED` y las prohíbe en cualquier otro estado.
  - El trigger las hace inmutables una vez escritas (I-19).
- **Artefacto `AUTHORIZED_XML`:**
  - es un tipo nuevo de `document_artifact` (se amplía el CHECK de `kind`);
  - guarda los bytes UTF-8 exactos del texto del elemento `comprobante` de la respuesta, ya decodificado, sin reconstruir nada (CTX §45);
  - lleva su SHA-256, su tamaño y `application/xml`;
  - sus metadatos guardan el `sriAttemptId`, el número y la fecha.
- **Una sola transacción** (TX B de D8) guarda las columnas, el artefacto si viene, la transición y el resultado.
- **Fuera de la transacción:** la respuesta original ya quedó confirmada en la TX A.
- **Hashes distintos.** `hash(SIGNED_XML)` y `hash(AUTHORIZED_XML)` son artefactos distintos, verificables por separado.
- **Sin XML autorizado.** Si la respuesta no trae `comprobante`, la autorización es igualmente válida y no hay artefacto. Ningún trigger lo exige.

### D17. Límite de tamaño (Q-47)

- **Política versionada** de `fiscal-catalogs` (ADR 0020), en una tabla `sri_transmission_policy` de datos del sistema con el mismo patrón que `consumer_final_policy`: dataset `sri-transmission-policy/1.json` con:
  - `maxSignedDocumentBytes`;
  - `sourceText`, `sourceSection` y `literalUnit`;
  - `interpretation`;
  - vigencia y fuente.
- **Uso.** El límite se resuelve con la fecha del envío, porque es una regla del servicio de recepción, y se compara con el tamaño exacto del `SIGNED_XML`.
- **Falla cerrada.** Sin una versión vigente, ningún envío sale: el job se detiene con `SIZE_POLICY_MISSING`, determinista y alertado.
- **Estado de Q-47.**
  - El 2026-10-03 el portal del SRI devolvió otra vez la página del balanceador, y la fuente no se pudo verificar.
  - 320 000 y 327 680 bytes no se eligen, ni se copia la cifra de una librería.
  - Decisión, con la preferencia del revisor: la comprobación es obligatoria antes de llamar al SRI, así que **Q-47 debe resolverse antes de cerrar `/opsx:apply`**.
  - Las partes independientes se implementan antes. Las pruebas usan una política de prueba insertada por el arnés, marcada como tal.
  - La tarea del dataset oficial es la única que espera la fuente.

### D18. API, permisos y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/invoices`, `GET /api/v1/invoices/{id}` | Se amplían los estados del filtro y el detalle añade el resumen de la transmisión: estado, job detenido con su motivo, datos de autorización y mensajes del último resultado | `invoices.read` |
| `GET /api/v1/invoices/{id}/transmission` | Historial: transiciones e intentos resumidos (operación, momento, origen, resultado y mensajes), sin respuestas originales ni XML; las 100 entradas más recientes, con el total | `invoices.read` |
| `POST /api/v1/invoices/{id}/reconciliations` | Reconciliación manual (D15) | `invoices.reconcile`, solo del administrador |

- No hay ninguna ruta de envío, recepción, autorización ni SOAP.
- Los contratos viven en `packages/contracts/src/invoices.ts`: los estados nuevos y sus etiquetas del glosario, la vista de la transmisión, la solicitud de reconciliación y los códigos de error. `openapi-routes.test.ts` cubre las rutas nuevas.
- `access-policy.ts`, su espejo del frontend y `access-control.md` añaden `invoices.reconcile` con `ADMIN: true` y `OPERATOR: false`. Coincide con la fila "Resolver revisión manual u ordenar una reconciliación" de la matriz.

### D19. Auditoría

- **`invoice.reconciliation_requested`:** número, estado al pedirla y motivo. Actor: el administrador.
- **`invoice.reconciliation_completed`:** número, resultado y estado final. La registra el job con el administrador que la pidió como actor y el `requestId` original como correlación.
- **Lo que no se audita:** las transmisiones, consultas, reintentos y reconciliaciones automáticas. Su evidencia son `sri_attempt` y `document_state_transition`, y auditarlas inundaría una tabla inmutable sin aportar un actor humano (`observability.md`).
- **Nunca** hay respuesta del SRI ni XML en el payload.

### D20. Pantallas

| Pantalla | Cambio |
| --- | --- |
| `Facturas` (`/facturas`) | Estados nuevos con icono y texto del glosario. Filtro "Requiere atención": `SEND_UNKNOWN`, `MANUAL_REVIEW` y transmisión detenida. Los estados `Autorizado`, `Devuelto` y `No autorizado` son filtrables |
| Detalle (`/facturas/{id}`) | Sección "Transmisión al SRI": estado, aviso de transmisión detenida con su motivo, datos de autorización, mensajes del SRI y el historial plegable. Acción "Reconciliar con el SRI" para el administrador en un estado admitido, con un diálogo de motivo |

- **Brief del detalle:**
  - usuario: administrador u operador; a diario, el operador para ver si la factura quedó autorizada y el administrador para destrabar las que requieren atención;
  - decisión: si la factura está lista para entregarse, o necesita una acción;
  - información mínima: estado, mensajes del SRI, número y fecha de autorización, y si la transmisión está detenida;
  - acción principal: "Reconciliar con el SRI", solo para el administrador y en un estado admitido.
- **Brief de `Facturas`:**
  - decisión: qué factura necesita atención;
  - información mínima: número, comprador, total y estado;
  - acción principal: abrir la factura.
- **Prioridades:**
  - P0: estado y acción;
  - P1: mensajes del SRI y datos de autorización;
  - P2: historial;
  - P3: identificadores de intentos, cabeceras y tiempos técnicos, que no se muestran.
- **El diálogo de reconciliación** es una confirmación de un paso con un campo de motivo obligatorio. No es destructiva: no cambia el contenido. Tras confirmar, hay un aviso semántico y el estado se actualiza al terminar.
- **Componentes:** se reutilizan `StatusBadge`, `ConfirmDialog`, `AppDataTable` y `ChipGroup`. Nuevos, locales a la función: `SriMessageList` y `TransmissionHistory`. Ninguno compartido.

### D21. Observabilidad

**Métricas** (Prometheus, en el registro existente; sin empresa en las etiquetas, porque es una sola por instancia):
- `fiscal_jobs{type,status}` (gauge: pendientes, en arriendo, detenidos);
- `fiscal_jobs_oldest_pending_age_seconds{type}`;
- `sri_attempts_total{operation,outcome}`;
- `sri_request_duration_seconds{operation}`;
- `sri_error_code_total{code}`, solo con `70`, `43`, `45` y `other`;
- `fiscal_documents{state}` (gauge, que incluye `SEND_UNKNOWN` y `MANUAL_REVIEW`);
- `invoice_authorization_latency_seconds`, histograma de `SIGNED` a `AUTHORIZED`;
- `sri_circuit_open{service,environment}`.

**Alertas propuestas** (CTX §48):
- backlog alto o envejecido;
- `RECEIVED` sin resolver cerca de la ventana;
- aumento de `DEVUELTA`;
- jobs `STOPPED`;
- cualquier `INTEGRITY_FAILED` o `SIZE_POLICY_MISSING`;
- circuit breaker abierto de forma prolongada.

**Logs:** comprobante, clave, operación, intento, resultado, duración y correlación. Nunca el XML, el SOAP, ni secretos o contraseñas (CTX §47).

### D22. Configuración

Variables nuevas, todas operativas y no normativas, validadas con Zod y documentadas en `deployment.md`:

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `SRI_TRANSMISSION_ENABLED` | `0` | Interruptor de la transmisión |
| `SRI_JOB_WORKERS` | 2 | Workers (de 0 a 8) |
| `SRI_JOB_LEASE_SECONDS` | 120 | Duración del arriendo |
| `SRI_JOB_POLL_INTERVAL_MS` | — | Intervalo de sondeo |
| `SRI_REQUEST_TIMEOUT_MS`, `SRI_BODY_TIMEOUT_MS` | — | Plazos del transporte: hasta las cabeceras y de lectura del cuerpo. El de conexión es el interno de Node (D10) |
| `SRI_RESPONSE_MAX_BYTES` | 5 MB | Tamaño máximo de una respuesta |
| `SRI_AUTHORIZATION_FIRST_DELAY_SECONDS` | — | Espera antes de la primera consulta de autorización |
| `SRI_POLL_BACKOFF_BASE_SECONDS`, `SRI_POLL_BACKOFF_CAP_SECONDS` | — | Backoff de las consultas |
| `SRI_CONCLUSION_WINDOW_HOURS` | 24 | Ventana de conclusión |
| `SRI_ERROR70_DELAY_SECONDS` | — | Espera tras el error 70 |
| `SRI_TRANSMIT_MAX_ATTEMPTS`, `SRI_TRANSMIT_DEADLINE_HOURS` | — | Límites del envío |
| `SRI_SWEEP_INTERVAL_SECONDS` | — | Intervalo del barrido |
| `SRI_BREAKER_FAILURES`, `SRI_BREAKER_COOLDOWN_SECONDS` | — | Circuit breaker |
| `SRI_ENDPOINT_{TEST,PRODUCTION}_{RECEPTION,AUTHORIZATION,VALIDITY}` | — | Endpoints, opcionales |

- **Al arrancar** se comprueba que el arriendo supera la suma de los plazos del transporte (más el plazo interno de conexión de Node) y un margen.
- **El interruptor nace apagado.** Habilitarlo es una decisión de despliegue, después de las compuertas (D23): así un despliegue no transmite al SRI por accidente.

### D23. Pruebas y compuertas de evidencia

- **Unitarias:**
  - la máquina de transmisión: cada transición permitida, el rechazo de las demás, I-15 e I-16;
  - la clasificación de la recepción y de la autorización, con sus tablas completas, sobre respuestas sintéticas construidas con la estructura oficial (CTX §22–§23 y los WSDL) y marcadas como sintéticas;
  - el backoff, la detención y los sobres SOAP, byte a byte;
  - la normalización del ambiente y de la fecha.
- **Contrato del transporte,** contra servidores locales, con la frontera de D10 explícita:
  - `PROVABLY_NOT_SENT`: puerto cerrado, nombre `.invalid` y TLS no confiable;
  - `MAY_HAVE_BEEN_SENT`: plazo de cabeceras, socket cortado tras leer la solicitud, abort durante la subida y plazo del cuerpo;
  - HTML con 200, Fault con 500, XML ilegible, respuesta gigante y respuesta válida.
- **Integración con PostgreSQL y dos empresas:**
  - la cola: concurrencia con `SKIP LOCKED`, deduplicación, exclusión por comprobante, vencimiento del arriendo, apagado ordenado, en un esquema distinto de `public`;
  - el traspaso atómico entre fases (`sri.transmit` → `sri.authorize`, y `sri.transmit` → `sri.reconcile` al pasar a `SEND_UNKNOWN`), sin ventana sin job ni choque con el índice, y dos workers que intentan avanzar la misma factura;
  - con la transmisión deshabilitada: ningún arriendo, ningún intento consumido y ninguna llamada;
  - el encolado al firmar (caída simulada justo después) y el barrido repetido;
  - la evidencia antes de la clasificación, incluida la caída entre la TX A y la TX B;
  - la integridad (hash y tamaño alterados);
  - los errores 70, 43 y 45;
  - varias autorizaciones;
  - los casos A–E de CTX §52, con un SRI simulado;
  - la reconciliación manual: permisos, aislamiento, simultaneidad y auditoría;
  - los triggers de solo agregado y la inmutabilidad de la autorización.
- **End-to-end sobre `main.ts`,** con un SRI simulado en HTTP y los endpoints sobrescritos:
  - emisión, transmisión, autorización y consulta;
  - rearranque a mitad del flujo;
  - la trampa de salida solo admite el SRI simulado.
- **Procedimiento de S-3 online** (`docs/quality/sri-certification.md`), fuera de la CI:
  - P12 ecuatoriano real, contraseña y RUC de Pruebas solo en el entorno del operador, nunca en el repositorio;
  - `SRI_TRANSMISSION_ENABLED=1` con los endpoints de Pruebas por defecto;
  - diez facturas representativas emitidas con la aplicación;
  - verificar que se envía el `SIGNED_XML` persistido, el transporte es el real, la respuesta original queda guardada, los parsers y las transiciones son los reales, y que la autorización y el XML autorizado quedan guardados;
  - las respuestas reales, anonimizadas, pasan a ser fixtures de contrato del parser.

  No existe ninguna ruta especial de prueba.
- **Compuertas previas a la transmisión real:**
  - el vector oficial de la clave (si aparece, se añade a la prueba de contrato de `AccessKeys` con su cita; el algoritmo nunca se cambia para coincidir con una fuente no oficial);
  - S-3 online;
  - un P12 real;
  - un RUC de Pruebas;
  - Q-47.

### D24. Briefs de las operaciones sensibles

| Pregunta | Transmisión automática (jobs) | Reconciliación manual |
| --- | --- | --- |
| 1. Quién ejecuta | El sistema | `invoices.reconcile`, solo el administrador |
| 2. Empresa del llamador | La del job (`job.company_id`) | `res.locals.context.companyId` |
| 3. Empresa del recurso | `electronic_document.company_id`, igual a la del job (FK compuesta) | La misma |
| 4. Propiedad | Cada lectura y escritura con `companyId`; los intentos y respuestas con FK compuesta | Consulta con `companyId` |
| 5. Cambiar un id | No aplica (sin entrada externa) | `404` |
| 6. Dos veces | Deduplicación y transición guardada | El índice de un job `sri.*` activo: la segunda es `409` |
| 7. A la vez | `SKIP LOCKED`, arriendo, índice por comprobante y transición guardada | El índice único: solo una se programa |
| 8. Idempotencia | Natural: clave de acceso, mismos bytes, estado | Natural: el job activo único |
| 9. Restricciones | CHECK de estados y de autorización, trigger de transiciones, triggers de solo agregado, `UNIQUE (document_id, kind)`, unicidades de los jobs activos | Las mismas |
| 10. Auditoría | No (D19) | `invoice.reconciliation_requested` y `invoice.reconciliation_completed` |
| 11. Pruebas de autorización | Dos empresas: los handlers nunca cruzan empresas | Dos empresas, operador, sin sesión, factura ajena, estado no admitido, simultaneidad |
| 12. Fugas | Logs y métricas sin XML, SOAP ni datos de otras empresas; las respuestas originales nunca salen por la API | La vista de la transmisión no expone respuestas originales ni XML |

### D25. Checklist de PR fiscal (CTX §65)

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Fuente oficial | Ficha v2.34 (CTX §7, §21–§29, §32–§34, §44–§45, §52; §7.2.3, §8.2.3 y §8.4 del PDF verificado) y los WSDL oficiales de recepción, autorización y `ConsultaComprobante` (`docs/product/sri-wsdl/`) |
| 2 | Versión y fecha | Ficha v2.34 del 2026-07-27. La cifra exacta del límite de tamaño está pendiente (Q-47) |
| 3 | ¿Afecta XSD? | No |
| 4 | ¿Afecta clave de acceso? | No se genera. Se usa la persistida, y el vector oficial sigue siendo una compuerta |
| 5 | ¿Afecta firma? | No. Se envían los bytes firmados persistidos |
| 6 | ¿Afecta catálogo tributario? | Sí: la política de tamaño del envío (D17) |
| 7 | ¿Afecta cálculos? | No |
| 8 | ¿Afecta RIDE? | No (cambio 8) |
| 9 | ¿Afecta secuenciales? | No. Nunca se libera ni se reserva otro número |
| 10 | ¿Afecta estados o reintentos? | Sí: la máquina de transmisión, `MANUAL_REVIEW`, los jobs y la reconciliación |
| 11 | ¿Incluye fixtures? | Respuestas sintéticas con la estructura oficial; las reales llegan con S-3 online |
| 12 | ¿Incluye pruebas? | Sí (D23) |
| 13 | ¿Probado en certificación del SRI? | No: S-3 online es la compuerta previa a la transmisión real |
| 14 | ¿Cambia un caso especial? | No |
| 15 | ¿Migración de datos o configuración? | Sí: estados, columnas de autorización, tipo de artefacto, cola, intentos, respuestas y resultados; variables del SRI |

## Risks / Trade-offs

- **[Riesgo] Las respuestas sintéticas pueden no reflejar el formato real del SRI** (texto del estado en procesamiento, formato de la fecha, tratamiento del `comprobante`) → El parser trata como "sin conclusión" todo lo que no reconoce: nunca concluye por inferencia. S-3 online graba respuestas reales que pasan a ser fixtures, y su resultado puede abrir un `/opsx:update`.
- **[Riesgo] SQL crudo para `SKIP LOCKED` con esquemas de prueba** → La tabla se califica con el esquema configurado, y una prueba en un esquema distinto de `public` lo comprueba.
- **[Riesgo] Un arriendo que vence con una llamada en curso duplicaría el envío** → El arranque valida que el arriendo supera el presupuesto del transporte, y el índice por comprobante y la transición guardada son la segunda defensa.
- **[Riesgo] Una caída prolongada del SRI acumula jobs `STOPPED`** → Siguen visibles y alertados. El administrador los reactiva con la reconciliación manual, sin cambiar el estado fiscal. No hay reactivación automática para no ocultar el incidente.
- **[Compromiso] El XML autorizado se guarda dos veces,** dentro de la respuesta y como artefacto → Lo exige CTX §45, y separar la evidencia del documento fiscal simplifica el cambio 8.
- **[Compromiso] La transmisión nace deshabilitada** → Evita transmitir por accidente al desplegar. El despliegue documenta cómo habilitarla tras las compuertas.
- **[Riesgo] El circuit breaker vive en la memoria de cada proceso** → Basta con una instancia por empresa; varios procesos solo hacen más intentos durante una caída.
- **[Riesgo] Q-47 sigue abierta y bloquea el cierre de apply** → Las partes independientes avanzan, y la transmisión real ya está bloqueada además por las otras compuertas.
- **[Riesgo] Los contratos SOAP salen de los WSDL y de los ejemplos de la ficha, no de respuestas reales** → Los sobres siguen los WSDL oficiales y las respuestas sintéticas su estructura; S-3 online graba respuestas reales que pasan a ser fixtures, y una diferencia sería un `/opsx:update`.
- **[Riesgo] Una respuesta gigante o maliciosa** → Hay límite de bytes, el parser rechaza DTD y los plazos son por fase.

## Migration Plan

1. **Migración nueva:**
   - estados y CHECK de `electronic_document`, con las columnas de autorización;
   - trigger de transiciones reescrito;
   - CHECK de `document_state_transition` y de `document_artifact.kind`;
   - tablas `job`, `sri_attempt`, `sri_response` y `sri_attempt_result`, con sus índices y triggers.

   Es aditiva: los datos existentes (`RESERVED` y `SIGNED`) siguen válidos.
2. **Despliegue con `SRI_TRANSMISSION_ENABLED=0`.** El barrido crea los `sri.transmit` pendientes de los `SIGNED` existentes, sin llamar al SRI.
3. **Habilitación.** Solo tras las compuertas (S-3 online con un P12 real, vector oficial y Q-47), primero en Pruebas.
4. **Reversión.** Hacia adelante. Apagar el interruptor detiene toda llamada al SRI. Una versión anterior del binario no conoce los estados nuevos y no debe ejecutarse después de transmitir.

## Open Questions

- **Q-47:** la cifra exacta del límite de tamaño. No cambia el enfoque: el dataset espera la fuente oficial y bloquea el cierre de apply (D17).
- **Q-48:** resuelta el 2026-10-04 con el WSDL oficial de `ConsultaComprobante` y la ficha v2.34, §8.2.3 (D10, D15).
- **Formatos reales de la respuesta del SRI:** el texto del estado en procesamiento, el formato de la fecha y si el `comprobante` llega en CDATA o escapado. No cambian el enfoque, porque el parser no concluye ante lo desconocido, y S-3 online los confirma.
