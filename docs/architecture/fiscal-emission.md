# Emisión fiscal y orquestación SRI

Arquitectura del motor fiscal y de la integración con el SRI. Reconcilia el ERS con CTX y
fija las decisiones del proyecto. No copia el protocolo del SRI: para los detalles técnicos
remite a las secciones de `docs/product/project-sri-integration.md` (CTX). Lo marcado con
`Q-xx` es una propuesta pendiente de `docs/product/open-questions.md`.

## Referencias de CTX que se aplican sin cambios

| Tema                                       | CTX          |
| ------------------------------------------ | ------------ |
| Orden de autoridad de las fuentes          | §1           |
| Web Services por ambiente                  | §7           |
| Clave de acceso y módulo 11                | §8           |
| Identificaciones                           | §9           |
| Reglas XML: UTF-8, orden, escapado, fechas, decimales | §10 |
| `infoTributaria` y snapshot del emisor     | §11          |
| Estructura de cada tipo de comprobante     | §12–17       |
| Catálogos fiscales mínimos                 | §18          |
| Validación XSD, registro y pruebas         | §19          |
| Parámetros de firma XAdES-BES              | §20          |
| Códigos de error y su tratamiento          | §32          |
| Normalización de respuestas                | §44          |
| Seguridad de logs y métricas               | §47, §48     |
| Pruebas de certificación, golden files, propiedades y recuperación | §49–52 |
| Política y checklist de cambios normativos | §53, §54     |
| Qué no se codifica en duro                 | §55          |
| Invariantes I-01..I-20                     | §61          |
| Definition of Done del motor y del go-live | §58, §59     |
| Checklist de PR fiscal                     | §65          |

## Pipeline

```text
                     ┌──────────── add-invoice-emission (cambio 6), local ────────────┐
solicitud ── crear ─▶│ 1 validar ─▶ 2 RESERVED ─(commit)─▶ 3 XML ─▶ 4 XSD ─▶ 5 SIGNED │─▶ respuesta
                     └────────────────────────────────────────────────────────────────┘
                                                    │ artefacto firmado persistido
                     ┌──────────── add-sri-transmission (cambio 7) y siguientes ───────┐
                     │ 6 recepción ─▶ 7 autorización ─▶ 8 RIDE ─▶ 9 entrega            │
                     │ 10 reconciliación     11 recuperación     12 validez            │
                     └────────────────────────────────────────────────────────────────┘
```

| Paso | Qué ocurre | Estado resultante |
| ---- | ---------- | ----------------- |
| 1 | Validación de negocio sin efectos, con la fecha de emisión ya capturada. Fuera de la transacción: permiso, `Idempotency-Key`, búsqueda de una repetición y archivos del esquema con su hash. Dentro de la transacción de reserva y antes del secuencial, con lecturas coherentes: borrador, preparación para emitir, comprador, líneas, impuestos con datos de cálculo, cálculo, pagos, consumidor final, casos especiales no soportados (falla cerrada) y esquema registrado. | Nada se crea si falla |
| 2 | La misma transacción, sin I/O externo: crea el snapshot, reserva el secuencial, bloquea la identidad tributaria, persiste los componentes definitivos de la clave de acceso y crea el comprobante (ver "Transacción de `RESERVED`"). | `RESERVED` |
| 3 | Tras el commit, con el arriendo del intento, construye el XML desde el snapshot con el builder de la versión registrada. | `RESERVED` |
| 4 | Valida el XML contra el XSD del snapshot. Falla cerrada si falta el XSD, su hash no coincide o la versión no está registrada (CTX §19.2, ADR 0021). | `RESERVED` |
| 5 | Firma con la firma vigente, vuelve a validar el XML firmado contra el XSD y persiste sus bytes exactos con su hash, en la misma transacción que la transición y la auditoría (ADR 0004, ADR 0010). El límite de 320 KB lo comprueba la transmisión (BR-26, cambio 7). | `SIGNED` |
| 6 | Recepción: envía el XML firmado persistido y persiste la respuesta original antes de clasificarla. | Cambio 7 |
| 7 | Autorización: consulta por clave con backoff y jitter; persiste la respuesta; extrae el XML autorizado (CTX §34, §45). | Cambio 7 |
| 8 | RIDE desde el comprobante autorizado, guardado como artefacto (CTX §30). | Cambio 8 |
| 9 | Entrega: registra la descarga, la impresión o el correo (CTX §46, Q-24). | Cambio 8 |
| 10 | Reconciliación por la misma clave para resolver respuestas ambiguas y los errores 43 y 45. | Cambio 7 |
| 11 | Recuperación de comprobantes detenidos tras una caída. | Cambio 7 |
| 12 | Consulta periódica de validez para detectar anulaciones (Q-16). | Cambio 7 |

Reglas:

- El orden es invariante: nunca se firma sin XSD válido ni se llama a la red sin el XML firmado persistido (ERS SRI-REQ-03, SRI-REQ-05; CTX §19.1, §21).
- Cada estado persistido es un punto de reanudación: los pasos 3 a 5 se repiten desde el snapshot sin repetir efectos.
- La respuesta de creación no espera al SRI: devuelve comprobante, clave de acceso, secuencial y estado (CTX §41).
- Desde `RESERVED` el comprobante nunca se borra.

## Frontera entre los cambios 6 y 7

- **`add-invoice-emission` termina en `SIGNED`.** No llama al SRI, no tiene jobs ni polling, no reintenta el transporte ni consulta la autorización, y es comprobable por completo offline.
- **`add-sri-transmission` empieza en el artefacto `SIGNED` persistido.** Es dueño del envío, la recepción, los estados del SRI, la autorización, la incertidumbre de red, la reconciliación, los reintentos, los jobs (ADR 0012) y las respuestas originales del SRI. Envía siempre los mismos bytes firmados, nunca un XML regenerado.

## Reglas de la emisión local

- **Fecha de emisión (Q-08).** Es la fecha actual en America/Guayaquil, como restricción de producto del MVP; el SRI no prohíbe toda emisión retroactiva. Se captura una vez al comenzar la creación fiscal y forma parte del snapshot. La misma fecha resuelve vigencias de catálogos y tarifas, la política de consumidor final, la clave de acceso y el XML; el proceso nunca vuelve a leer el día.
- **Cálculo y redondeo (Q-14).** Es una política decimal del producto, no una regla textual del SRI:
  - los cálculos internos son exactos, sin `number` ni redondeos intermedios;
  - un campo fiscal se redondea HALF_UP al materializarlo a la escala de su XSD;
  - los totales se construyen con los valores fiscales ya materializados, para que el XML sea consistente.

  Lo validó la parte offline de S-3. La parte online, con facturas autorizadas en Pruebas del SRI, es la compuerta previa a declarar la emisión lista para go-live o transmisión real. Si la contradice, se abre `/opsx:update`.
- **Impuestos sin datos de cálculo.** Una factura que necesita ICE o IRBPNR sin datos normativos de cálculo, o IVA diferenciado (código 8) sin una tarifa aplicable, se rechaza con un error funcional explícito. El rechazo llega antes de reservar el secuencial, bloquear la identidad tributaria o crear la clave, nunca con un valor por defecto. El producto puede seguir existiendo en `INCOMPLETE`. Las tarifas de ICE se calculan según la normativa vigente: no se copian las históricas de la ficha ni las de `facturacion-electronica-ec`.
- **Consumidor final.**
  - Se permite cuando `importeTotal` es menor o igual que el monto máximo de la política vigente en la fecha del documento: USD 50.00 al corte.
  - Por encima, la factura exige un adquirente identificado y se rechaza antes de reservar.
  - `importeTotal` es la correspondencia explícita del proyecto entre el "valor de la factura" del numeral 9.10 de la ficha y el campo total del XML.
  - El monto sale de la política versionada de `fiscal-catalogs`, nunca de una constante. Con USD 50.00: `49.99` y `50.00` se permiten y `50.01` se rechaza.

## Transacción de `RESERVED`

En la misma transacción en que nace `RESERVED` (design D7 de `add-invoice-emission`):

1. se bloquea la fila del borrador, que serializa las emisiones del mismo borrador;
2. se toma el lock advisory de la configuración y se lee la configuración vigente;
3. se valida, con lecturas coherentes, todo lo que puede fallar funcionalmente (paso 1);
4. se crea el snapshot, todavía sin el secuencial;
5. se reserva el secuencial (`reserveSequentialIn`) con el ambiente del snapshot;
6. se bloquea la identidad tributaria (`lockTaxIdentityIn`);
7. se generan el código numérico criptográfico y la clave de acceso, que completan el snapshot;
8. se crean el comprobante en `RESERVED` y su transición inicial, y el borrador pasa a `EMITTED`;
9. se inserta el registro de idempotencia, cuya clave primaria es la última defensa;
10. se registra la auditoría `invoice.reserved`;
11. commit.

El número solo existe para la respuesta después del commit; un fallo en cualquier paso revierte
todo.

Dentro de esa transacción no hay XML pesado, firma ni I/O externo. Después del commit: XML, XSD,
firma y persistencia de los bytes firmados exactos, que llevan a `SIGNED`.

## Máquina de estados local (cambio 6, Q-35)

```text
RESERVED ──▶ SIGNED
```

| Estado | Significado |
| --- | --- |
| `RESERVED` | Existen, de forma atómica, el comprobante durable, su snapshot, el secuencial confirmado, la clave de acceso definitiva y el bloqueo de la identidad tributaria. El número nunca se reutiliza. No hay rollback de `RESERVED`. |
| `SIGNED` | XML construido, validado contra el XSD, firmado y persistido con sus bytes exactos y su hash. |

Reglas:

- **Reanudación.** Si el proceso cae después de `RESERVED` y antes de `SIGNED`, el comprobante sigue en `RESERVED`. Un reintento con la misma operación y clave de idempotencia reanuda ese comprobante, con su snapshot, secuencial y clave; nunca crea otro.
- **Transiciones guardadas.** La transición es una actualización guardada (`WHERE state = :esperado`) que verifica las filas afectadas; cero filas significa que otro proceso ganó (`idempotency.md`). Cada transición registra en la misma transacción el estado anterior y el nuevo, la causa, el actor y metadatos técnicos no sensibles (ERS RF-525).
- **Sin cola.** El cambio 6 no necesita jobs: la reanudación es el reintento idempotente.

## Estados de transmisión (cambio 7)

`add-sri-transmission` diseña sus estados a partir de `SIGNED`. Punto de partida, desde CTX §26
sin el estado `SENT` de CTX §22.1:

```text
SIGNED → SEND_PENDING → RECEIVED → PENDING_AUTHORIZATION → AUTHORIZED

Ramas
  SEND_PENDING          → RETURNED                                    (corrección, BR-28)
  SEND_PENDING          → PENDING_AUTHORIZATION                       (error 70)
  SEND_PENDING          → SEND_UNKNOWN → (reconciliación) → PENDING_AUTHORIZATION
                                                           | AUTHORIZED | NOT_AUTHORIZED
                                                           | SIGNED (reenviar el mismo XML)
                                                           | MANUAL_REVIEW
  PENDING_AUTHORIZATION → NOT_AUTHORIZED | MANUAL_REVIEW
  AUTHORIZED            → CANCEL_PENDING → CANCELLED                  (Q-16)
```

| Desde | Hacia | Disparador | Actor |
| --- | --- | --- | --- |
| `SIGNED` | `SEND_PENDING` | El job toma el envío. | Sistema |
| `SEND_PENDING` | `RECEIVED` | `RECIBIDA`. | Sistema |
| `SEND_PENDING` | `RETURNED` | `DEVUELTA` por inconsistencia corregible. | Sistema |
| `SEND_PENDING` | `PENDING_AUTHORIZATION` | Error 70: clave en procesamiento (CTX §27.2). | Sistema |
| `SEND_PENDING` | `SEND_UNKNOWN` | Timeout, error de red o de proxy, SOAP ilegible, caída del proceso, error 43 o 45. | Sistema |
| `SEND_UNKNOWN` | `PENDING_AUTHORIZATION` | La consulta indica que el SRI procesa la clave. | Sistema |
| `SEND_UNKNOWN` | `AUTHORIZED` | La consulta devuelve `AUTORIZADO`. | Sistema |
| `SEND_UNKNOWN` | `NOT_AUTHORIZED` | La consulta devuelve `NO AUTORIZADO`. | Sistema |
| `SEND_UNKNOWN` | `SIGNED` | El SRI no conoce la clave: se reenvía el mismo XML firmado (caso A, CTX §52). | Sistema |
| `SEND_UNKNOWN` | `MANUAL_REVIEW` | Intentos agotados o inconsistencia, como un secuencial registrado con otra clave. | Sistema |
| `RECEIVED` | `PENDING_AUTHORIZATION` | Primera consulta tras el intervalo configurado. | Sistema |
| `PENDING_AUTHORIZATION` | `AUTHORIZED` | `AUTORIZADO`. | Sistema |
| `PENDING_AUTHORIZATION` | `NOT_AUTHORIZED` | `NO AUTORIZADO`. | Sistema |
| `PENDING_AUTHORIZATION` | `PENDING_AUTHORIZATION` | En procesamiento: nuevo intento con backoff. | Sistema |
| `PENDING_AUTHORIZATION` | `MANUAL_REVIEW` | Ventana agotada (Q-06) o respuesta sin el bloque esperado (CTX §34). | Sistema |
| `MANUAL_REVIEW` | `SEND_UNKNOWN` | El administrador ordena reconciliar. | Administrador |
| `AUTHORIZED` | `CANCEL_PENDING` | La consulta de validez devuelve `PENDIENTE DE ANULAR` (Q-16). | Sistema |
| `AUTHORIZED`, `CANCEL_PENDING` | `CANCELLED` | La consulta de validez devuelve `ANULADO` (Q-16). | Sistema |
| `CANCEL_PENDING` | `AUTHORIZED` | La consulta de validez vuelve a `AUTORIZADO`. | Sistema |

Reglas que el cambio 7 conserva:

- `SEND_UNKNOWN` nunca es terminal. `RECIBIDA` nunca lleva a `AUTHORIZED`, y un timeout nunca lleva a `NOT_AUTHORIZED` (CTX I-15, I-16).
- `NOT_AUTHORIZED` es terminal hasta resolver Q-07; reemitir crea un comprobante nuevo.
- La corrección de un `RETURNED` (BR-28) conserva la clave y el secuencial, genera un XML firmado nuevo y conserva los artefactos anteriores. Su diseño es del cambio 7.

## Decisiones de diseño de `add-invoice-emission`

Decididas el 2026-10-03 e implementadas por el cambio (design D2 a D12). Lo implementado se
resume en "Implementación de `add-invoice-emission`".

- **Borradores.** Un borrador no pertenece a la máquina fiscal `RESERVED` → `SIGNED`.
  - Antes de reservar puede existir un documento editable: `DRAFT`, después la acción explícita de emitir, las validaciones completas y `RESERVED`.
  - `RESERVED` nunca es editable.
  - Si ERS RF-010 exige borradores en el MVP, el proposal los incluye como recurso editable previo a la emisión. Si eso hace crecer demasiado el cambio, se separan del alcance de forma explícita.
- **Fallo entre `RESERVED` y `SIGNED`.** No hay estado fiscal `ERROR`: si fallan el XML, el XSD o la firma, el comprobante sigue en `RESERVED`.
  - Se guarda aparte del estado fiscal la información operativa del último intento: etapa, código de error, fecha y número de intentos cuando corresponda. Nunca secretos ni el XML inválido, salvo lo imprescindible.
  - Un reintento autorizado reutiliza el comprobante, el snapshot, el secuencial y la clave de acceso, y vuelve a intentar llegar a `SIGNED`. Nunca crea otra factura ni reserva otro número.
  - Un fallo determinista que persiste es visible y accionable, y no provoca un bucle automático de reintentos.
- **Builder de la factura (Q-44).** Es específico de la factura, no un framework para los seis comprobantes:
  - recibe solo el snapshot fiscal inmutable, con los decimales ya materializados como texto exacto;
  - escribe el orden del XSD con escape seguro y solo los opcionales que corresponden, incluidos `agenteRetencion` y `contribuyenteRimpe`;
  - produce XML UTF-8 determinista, sin datos ajenos al comprobante y sin leer base de datos, reloj, empresa, catálogos ni configuración.

  El snapshot pasa por el builder, el XML exacto por el validador XSD y después por el firmador.
- **Aritmética fiscal.** Se centraliza en primitivas exactas de `platform/decimal` y en funciones de dominio explícitas y probadas para cada concepto:
  - subtotal de línea;
  - descuento;
  - base imponible;
  - impuesto;
  - totales;
  - materialización HALF_UP.

  Ningún handler ni builder opera con `decimal.js` directamente, y el builder no calcula importes.
- **XSD en el despliegue.** Los XSD canónicos forman parte de la imagen, y el registro incluye todos los archivos necesarios, también `xmldsig-core-schema.xsd`, con fuente, revisión, SHA-256 y ruta lógica.
  - No hay descargas en tiempo de ejecución ni caída a XSD de terceros: un archivo ausente o con otro hash falla cerrada.
  - Una prueba del artefacto de build demuestra que los esquemas están presentes (ADR 0021).
- **Concurrencia XSD.** La validación usa concurrencia acotada, nunca un worker por solicitud sin límite. El adaptador ya acota la concurrencia, la cola y el plazo, con `VALIDATOR_BUSY` y `VALIDATOR_TIMEOUT` (ADR 0021). El design fija los valores y el comportamiento ante saturación; Q-26 dirá si hay que ajustarlos.
- **Vector oficial de la clave de acceso.** No bloquea el proposal: el algoritmo coincide con CTX §8.3, una prueba independiente comprueba el dígito y S-3 offline la composición completa. Obtener y verificar el vector oficial de la ficha es evidencia adicional; no se inventa. El 2026-10-03 el portal del SRI no fue accesible desde el entorno del proyecto, y el vector queda como evidencia pendiente (S-3 en `open-questions.md`).

## Implementación de `add-invoice-emission`

Cambio 6. Código en `backend/src/modules/invoices/` y contratos en
`packages/contracts/src/invoices.ts`.

| Pieza | Dónde |
| --- | --- |
| Borrador y vista previa del servidor | `invoices/domain/draft.ts`, `invoices/application/drafts.ts` |
| Evaluación pura, con todos los problemas en el orden de D6 | `invoices/domain/evaluation.ts` |
| Aritmética fiscal exacta y materialización HALF_UP | `invoices/domain/amounts.ts`, sobre `platform/decimal` |
| Snapshot versionado (`InvoiceSnapshotV1`) | `invoices/domain/snapshot.ts` |
| Transacción de `RESERVED` | `invoices/application/emission.ts` y `invoices/infrastructure/emission-unit-of-work.ts` |
| Del snapshot al artefacto firmado | `invoices/application/signing-pipeline.ts` |
| Consultas y reintento de la firma | `invoices/application/invoices.ts` |
| Idempotencia durable (Q-30) | `platform/idempotency` (`idempotency.md`) |
| Clave de acceso, builder XML, validación XSD y firmador | `sri-engine` (`AccessKeys`, `InvoiceXmlBuilder`, `XsdValidator`, `ec-sri-signer.ts`) |
| Firma con la firma vigente | `signing` (`documents.signDocument` y la tarea `sign-xml` del pool criptográfico) |
| Comprobante, transiciones y artefacto | `fiscal` (`createDocumentRepository`, `createArtifactStore`) |

### Rutas y permisos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `POST /api/v1/invoices/drafts` | Crear un borrador: líneas con producto, cantidad y descuento, sin precio | `invoices.draft` |
| `GET /api/v1/invoices/drafts` | Listar borradores `DRAFT`, paginado | `invoices.draft` |
| `GET /api/v1/invoices/drafts/{draftId}` | Borrador con su vista previa y sus problemas | `invoices.draft` |
| `PUT /api/v1/invoices/drafts/{draftId}` | Corregir con `expectedVersion` | `invoices.draft` |
| `DELETE /api/v1/invoices/drafts/{draftId}` | Eliminar un borrador `DRAFT` | `invoices.draft` |
| `POST /api/v1/invoices` | Emitir `{ draftId, expectedVersion }` con `Idempotency-Key` | `invoices.emit` |
| `GET /api/v1/invoices` | Listar facturas por estado, número o comprador | `invoices.read` |
| `GET /api/v1/invoices/{invoiceId}` | Detalle desde el snapshot, con el diagnóstico | `invoices.read` |
| `POST /api/v1/invoices/{invoiceId}/signing-attempts` | Reintentar la firma | `invoices.retrySigning` |

- Administrador y operador tienen los cuatro permisos (`../security/access-control.md`).
- Un recurso inexistente o de otra empresa responde `404` (`INVOICE_DRAFT_NOT_FOUND`, `INVOICE_NOT_FOUND`), y los cuerpos son estrictos.
- Ningún paso técnico (XML, clave, firma) es un endpoint.

### Rechazos antes de reservar

La emisión responde `409` con el código del primer problema y la línea o la forma de pago que lo
causa. La vista previa del borrador muestra todos. Ninguno reserva número, crea clave ni bloquea
la identidad tributaria.

| Grupo | Códigos |
| --- | --- |
| Borrador | `INVOICE_DRAFT_CHANGED`, `INVOICE_DRAFT_ALREADY_EMITTED`, `INVOICE_DRAFT_INCOMPLETE`, `INVOICE_TOO_MANY_LINES` (`INVOICE_DRAFT_NOT_FOUND` es `404`) |
| Preparación | `TAXPAYER_NOT_CONFIGURED`, `EMISSION_POINT_NOT_FOUND`, `EMISSION_POINT_UNAVAILABLE`, `SIGNING_CERTIFICATE_NOT_USABLE` |
| Comprador | `BUYER_NOT_FOUND`, `BUYER_NOT_CUSTOMER`, `BUYER_INACTIVE`, `BUYER_IDENTIFICATION_TYPE_NOT_USABLE` |
| Líneas | `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`, `DISCOUNT_EXCEEDS_SUBTOTAL` |
| Impuestos | `TAX_REFERENCE_NOT_USABLE`, `TAX_CALCULATION_DATA_MISSING` (hoy, ICE, IRBPNR e IVA `8`) |
| Cálculo | `AMOUNT_OUT_OF_RANGE` |
| Pagos | `PAYMENT_METHOD_NOT_FOUND`, `PAYMENT_METHOD_NOT_USABLE`, `PAYMENTS_DO_NOT_MATCH_TOTAL` |
| Consumidor final | `CONSUMER_FINAL_POLICY_MISSING`, `CONSUMER_FINAL_LIMIT_EXCEEDED` |
| Casos especiales | `SPECIAL_CASE_UNSUPPORTED`: hoy, el anexo 26, cuando la configuración declara un RUC proveedor distinto del propio |
| Esquema | `SCHEMA_NOT_AVAILABLE` |
| Reserva | `SEQUENCE_EXHAUSTED`, que además se registra como advertencia en el log |

La idempotencia añade `400 IDEMPOTENCY_KEY_REQUIRED` y `409 IDEMPOTENCY_KEY_REUSED`
(`idempotency.md`).

### Del snapshot al artefacto firmado

- **Arriendo.** Cada intento toma un arriendo de 120 s con una actualización guardada. Si otro intento lo tiene, se devuelve el estado actual sin intentar. Una caída deja un arriendo que vence, y la repetición con la misma clave o un reintento lo retoman.
- **Etapas.** `BUILD_XML`, `VALIDATE_XSD`, `SIGN`, `VALIDATE_SIGNED_XSD` y `PERSIST`. La firma la hace la tarea `sign-xml` del pool criptográfico, que comprueba la huella del certificado embebido.
- **Diagnóstico.** Un fallo deja el comprobante `RESERVED` y guarda, aparte del estado, la etapa, el código, la clase, la fecha y el número de intentos. Para `XSD_INVALID` y `SIGNED_XML_INVALID` guarda solo la línea y el nombre del elemento. Nunca guarda secretos, el XML ni la salida de libxml2.

| Clase | Códigos | Acción |
| --- | --- | --- |
| `RETRYABLE_OPERATIONAL` | `VALIDATOR_BUSY`, `VALIDATOR_TIMEOUT`, `CRYPTO_BUSY`, `CRYPTO_TIMEOUT`, `CRYPTO_UNAVAILABLE`, `PERSIST_FAILED` | Reintentar sin cambiar nada |
| `DETERMINISTIC_CONFIGURATION` | `SIGNING_CERTIFICATE_NOT_USABLE`, `CUSTODY_UNAVAILABLE`, `CERTIFICATE_MISMATCH`, `SIGNER_FAILED`, `SCHEMA_UNAVAILABLE`, `SCHEMA_HASH_MISMATCH` | Corregir la configuración o la instalación y reintentar |
| `DETERMINISTIC_VALIDATION` | `XSD_INVALID`, `SIGNED_XML_INVALID`, `INVALID_SNAPSHOT_TEXT`, `INVALID_SNAPSHOT_AMOUNT` | Error del producto: requiere soporte; reintentar da el mismo resultado |

- **Reintento.** `POST /api/v1/invoices/{invoiceId}/signing-attempts` repite las etapas sobre la misma factura, con su snapshot, número y clave:
  - sobre una factura `SIGNED`, la devuelve sin efecto;
  - mientras otro intento tiene el arriendo, devuelve el estado actual y audita el resultado `ATTEMPT_IN_PROGRESS`.
- **Sin bucles.** No hay reintentos automáticos ni jobs en este cambio.

### Auditoría y métricas

- **Auditoría**, siempre con el usuario como actor y sin XML ni bytes:
  - `invoice.reserved`: número, clave, ambiente y total;
  - `invoice.signed`: número y SHA-256 del artefacto;
  - `invoice.signing_retried`: número y resultado (`SIGNED`, el código del diagnóstico o `ATTEMPT_IN_PROGRESS`).

  Los borradores, las consultas y las emisiones rechazadas no generan eventos.
- **Métricas.** Cada emisión alimenta el histograma `invoice_emission_stage_duration_seconds{stage,outcome}` con las etapas `total`, `reservation_tx`, `validation_snapshot`, `arithmetic`, `xml`, `xsd`, `sign` y `persist` (`deployment.md`).
  - Con `EMISSION_STAGE_TIMINGS=1`, que el entorno rechaza en producción, la respuesta lleva además `Server-Timing`.
  - `bench:emission` mide con ellas un P95 total de 884 ms en el entorno registrado (`../quality/benchmarks/emission-2026-10-03.md`).

### Obligaciones cumplidas

| Origen | Obligación | Cumplimiento |
| --- | --- | --- |
| `add-taxpayer-setup` | Identidad tributaria | `lockTaxIdentityIn` en el paso 6 de la transacción de `RESERVED`. |
| `add-taxpayer-setup` | Versión de configuración | El snapshot copia la configuración vigente leída con el lock de configuración tomado; el XML sale solo del snapshot. |
| `add-taxpayer-setup` | Ambiente | Se fija en el snapshot, y el secuencial se reserva con ese ambiente. |
| `add-taxpayer-setup` | Preparación para emitir | El grupo Preparación exige configuración, punto y establecimiento activos y firma utilizable. |
| `add-taxpayer-setup` | Punto predeterminado | El editor lo preselecciona solo si sigue disponible; no restringe el punto de emisión. |
| `add-taxpayer-setup` | RIMPE y anexos | Los anexos 21, 22 y 24 que activa el emisor se evalúan con la matriz y se guardan en el snapshot. El builder escribe `agenteRetencion` (21) y `contribuyenteRimpe` (22, con el texto fijo del XSD) cuando corresponden. |
| `add-taxpayer-setup` | Casos especiales no soportados | `SPECIAL_CASE_UNSUPPORTED` antes de reservar. |
| `add-fiscal-numbering` | Dónde reservar y frontera del commit | `reserveSequentialIn` en el paso 5, sin I/O externo; el número solo sale después del commit y un fallo posterior no lo reutiliza. |
| `add-fiscal-numbering` | Referencia | `electronic_document.reservation_id` es único, y la unicidad del secuencial se repite en el comprobante. |
| `add-fiscal-numbering` | Errores de la reserva | `EMISSION_POINT_*` y `SEQUENCE_EXHAUSTED` llegan como rechazos; el agotamiento, además, al log. |
| `add-signing-certificate` | Firma utilizable | `SIGNING_CERTIFICATE_NOT_USABLE` en la evaluación y en la etapa de firma. |
| `add-signing-certificate` | Secreto solo para firmar | La custodia abre el secreto sellado solo para firmar ese documento y lo transfiere al worker, que pone los bytes a cero (design D9, ADR 0011). |
| `add-signing-certificate` | Fuera del event loop | Tarea `sign-xml` del pool criptográfico; `CRYPTO_BUSY` y `CRYPTO_TIMEOUT` son diagnósticos reintentables. |
| `add-signing-certificate` | Certificado embebido | Una huella distinta de la firma vigente es `CERTIFICATE_MISMATCH`. |
| `add-signing-certificate` | Nunca en registros | Ni el diagnóstico, ni la auditoría, ni los logs llevan secretos ni XML; la prueba end-to-end lo comprueba en la auditoría. |
| `add-fiscal-catalogs` | Resolución de vigencia y utilizable | Cada referencia se resuelve con las lecturas de `catalogs` y la fecha de emisión; solo se usa si es utilizable. |
| `add-fiscal-catalogs` | Reproducibilidad | El snapshot guarda el identificador y los valores de cada versión aplicada y las versiones de los datasets. |
| `add-fiscal-catalogs` | ICE, IRBPNR e IVA diferenciado | `TAX_CALCULATION_DATA_MISSING` antes de reservar. |
| `add-fiscal-catalogs` | Consumidor final y casos especiales | Política versionada y matriz de soporte, aplicadas en la evaluación. |
| `add-fiscal-catalogs` | Decimales y esquemas | Especificaciones de `packages/contracts/src/decimal.ts`; el registro de esquemas con imports se verifica al arrancar (`deployment.md`). |
| `add-parties-and-products` | Fecha del documento y datos de cálculo | La emisión vuelve a resolver cada referencia del producto con la fecha de emisión y exige datos de cálculo completos. |
| `add-parties-and-products` | Sin tarifas copiadas | Las tarifas salen de la versión resuelta y se copian al snapshot, nunca del producto. |
| `add-parties-and-products` | Consumidor final por su marca | Se reconoce por `systemRecord: CONSUMER_FINAL`, y el límite sale de la política. |
| `add-parties-and-products` | Precio sin impuestos | `unitPrice` es el `precioUnitario`; se congela en el snapshot y no se edita por línea (Q-45). |

## Reserva del secuencial

La implementa `add-fiscal-numbering` (módulo `fiscal`) como operación interna
`reserveSequentialIn(scope, clave)`, sin ruta HTTP. La clave es empresa, ambiente,
establecimiento, punto y tipo (ADR 0003). Dentro de la transacción del llamador:

1. **Comienzo:** lee la disponibilidad del punto. Si él o su establecimiento están inactivos, la rechaza sin tocar el contador. Si estaban activos, la reserva se completa aunque una desactivación se confirme mientras está en curso.
2. **Creación perezosa:** crea el contador con `INSERT ... ON CONFLICT DO NOTHING`. Dos primeras reservas simultáneas no producen un error de restricción: la segunda espera la confirmación de la primera.
3. **Incremento:** un `UPDATE ... RETURNING` que avanza `next_number` y bloquea la fila del contador hasta el fin de la transacción, igual que el `SELECT ... FOR UPDATE` de CTX §28. Si el contador está agotado tras el `999999999`, falla con `SEQUENCE_EXHAUSTED`.
4. **Registro:** actualiza `last_reserved` y registra la reserva en `fiscal_sequence_reservation`, cuya restricción única (CTX §5, con el ambiente) respalda la reserva ante cualquier error de código.

- La transacción contiene solo operaciones de base de datos, sin I/O externo, y usa la configuración por defecto de Prisma (`maxWait` 2 s para adquirirla, `timeout` 5 s de duración). La prueba de ERS AC-04 mide como máximo 750 ms por reserva con 120 simultáneas en dos instancias (design D5 de `add-fiscal-numbering`).
- El número reservado nunca vuelve al contador (BR-08) y `next_number > last_reserved` lo impone la base de datos.

## Obligaciones que deja `add-taxpayer-setup`

`add-invoice-emission` debe recoger en sus tareas:

- **Identidad tributaria.** Invocar `lockTaxIdentityIn` (módulo `taxpayer`) dentro de la transacción de `RESERVED`, donde nace la clave de acceso que contiene el RUC: el primer artefacto fiscal que debe conservarse (Q-31, "Transacción de `RESERVED`"). La operación toma el lock advisory de configuración de la empresa (`company-config:<company_id>`), es idempotente y fija el RUC vigente; después, ninguna versión nueva puede cambiarlo.
- **Versión de configuración.** El snapshot del comprobante referencia la versión vigente de `company_config_version` leída en la misma transacción de la reserva, y el XML y el RIDE se construyen solo desde ella (CTX §11, §39).
- **Ambiente.** El ambiente se fija en el snapshot al reservar, de modo que un cambio de ambiente posterior no afecta a una emisión en curso (CTX §6).
- **Preparación para emitir.** La emisión consulta la misma evaluación de requisitos de `GET /api/v1/company/status` y se bloquea si la empresa no está preparada (BR-03).
- **Punto predeterminado.** Solo se preselecciona si sigue disponible; nunca restringe desde dónde se emite (Q-23).
- **Categoría RIMPE y anexos.** Traducir la categoría declarada a la leyenda que corresponda según la matriz del ADR 0014 (anexos 21, 22 y 24, `CONDITIONAL_ISSUER_RULE`); el XSD solo admite el texto fijo `CONTRIBUYENTE RÉGIMEN RIMPE`.
- **Casos especiales no soportados.** Si una operación requiere un caso especial que el sistema no soporta, se rechaza de forma explícita en el paso 1, antes de reservar; nunca se degrada en silencio a un comprobante ordinario (ADR 0014).

## Obligaciones que deja `add-fiscal-numbering`

`add-invoice-emission` debe recoger en sus tareas:

- **Dónde reservar.** Invocar `reserveSequentialIn` dentro de la transacción del paso 2 del pipeline, con el ambiente del snapshot y la configuración de transacción por defecto que la prueba de AC-04 respalda. Mientras mantiene bloqueada la fila del contador, la transacción no hace I/O externo: ni firma, ni llamadas al SRI, ni almacenamiento de archivos, ni correo.
- **Qué significa reservado.** Una reserva que se revierte antes del commit no ha reservado el número. Una vez confirmado el commit, el número no se reutiliza aunque fallen la generación del XML, la firma, el envío al SRI, el RIDE u otra operación posterior; el hueco se tolera.
- **Frontera del commit.** No tratar el número como reservado fuera de la transacción hasta que la reserva se haya confirmado. Eso excluye devolverlo al cliente, registrarlo como reservado, construir, firmar o enviar el XML con él, o exponerlo de cualquier otra forma antes del commit.
- **Referencia.** El comprobante referencia la fila de `fiscal_sequence_reservation` y repite la unicidad del secuencial como segunda defensa.
- **Errores de la reserva.** Traducir `EMISSION_POINT_UNAVAILABLE`, `EMISSION_POINT_NOT_FOUND` y `SEQUENCE_EXHAUSTED` en el resultado de la emisión, y registrar como advertencia en el log la reserva agotada (design D15 de `add-fiscal-numbering`).

## Obligaciones que deja `add-signing-certificate`

`add-invoice-emission` debe recoger en sus tareas:

- **Firma utilizable.** Antes de firmar, consultar la misma condición que la preparación para emitir (`SigningCertificateReadiness`): firma vigente (no vencida) cuyo secreto abre la clave de custodia configurada. Si no lo es, la emisión se bloquea con el motivo, que la pantalla `Firma electrónica` ya explica.
- **Secreto solo en el adaptador de firma.** `CertificateVault.open` se invoca solo dentro de la tarea de firma, con la ligadura empresa y certificado. Su `CustodyError` se traduce a firma no disponible. El P12 y la contraseña viven en memoria durante `sign` y se ponen a cero después (ADR 0011).
- **Fuera del event loop.** La firma de XML es una tarea más de `CryptoWorkerPool` (`platform/workers`): CPU síncrona de 42 ms a 1,3 s según las iteraciones del P12 (spike S-6). Usa la misma concurrencia acotada y el mismo timeout, y propaga `CRYPTO_BUSY` y `CRYPTO_TIMEOUT` como errores tipados.
- **Certificado embebido.** Comprobar en cada firma que el certificado que embebe el firmador es el de la firma vigente (misma huella), como hace la firma de prueba al cargar.
- **Nunca en registros.** Ni bytes del P12, ni contraseña, ni clave privada, ni el XML firmado en logs, errores, auditoría o métricas.
- **Errores de la firma.** `CERTIFICATE_*` y `CRYPTO_*` se traducen al resultado de la emisión; un fallo de firma después de reservar el secuencial deja un hueco, nunca reutiliza el número.

### Proveedores validados

Compatibilidad y validación no son lo mismo (Q-17, design D4 de `add-signing-certificate`):

- **Compatible:** el certificado pasa las reglas técnicas de la carga.
- **Proveedor validado:** se probó al menos un P12 real de ese proveedor, que se cargó, firmó un comprobante autorizado en Pruebas y cuyo RUC se extrajo con un extractor registrado.

Con fixtures sintéticos ningún proveedor figura aquí; Security Data está cubierto solo estructuralmente (OID `1.3.6.1.4.1.37746.3.11`). El primer proveedor validado será preferentemente el del primer cliente piloto: es requisito del go-live (`definition-of-done.md`).

| Proveedor | P12 probado | Ubicación del RUC | Resultado | Fecha |
| --- | --- | --- | --- | --- |
| — | Ninguno todavía | — | — | — |

## Obligaciones que deja `add-fiscal-catalogs`

`add-invoice-emission` debe recoger en sus tareas (design D15 de `add-fiscal-catalogs`):

- **Una sola resolución de vigencia.** Cada impuesto, forma de pago o tipo de identificación se resuelve con `resolveCatalogEntry(catalogType, entryKey, fecha)` del módulo `catalogs`, con la fecha de emisión del comprobante en hora de Ecuador o, cuando la regla del documento lo pida, la del documento sustento (BR-33). Nada fuera de `catalogs` lee sus tablas, y nadie reimplementa la regla.
- **Reproducibilidad.** El snapshot guarda el identificador estable de cada versión aplicada y copia sus valores (código, descripción oficial, tarifa, fuente) (BR-21).
- **Utilizable.** Una entrada solo se usa si `isUsable`: habilitada para la empresa según `effectiveEnablement` y con versión aplicable en la fecha.
- **ICE e IRBPNR.** No se calculan mientras el catálogo no tenga sus tarifas con fuente legal: la ficha v2.34 solo publica códigos (`OFFICIAL_REFERENCE`). La emisión de un producto con ICE o IRBPNR se rechaza de forma explícita, antes de reservar, bloquear la identidad tributaria o crear la clave, hasta que una versión del dataset traiga sus datos de cálculo con fuente legal.
- **IVA diferenciado.** El código 8 no tiene porcentaje fijo (nota 3 de la tabla 17): sin una política o tarifa aplicable con fuente, se rechaza igual que ICE e IRBPNR.
- **Consumidor final.** La política vigente (`consumer_final_policy`, USD 50 al corte) y su identidad canónica se aplican en el paso 1, antes de reservar. El tercero del sistema que la usa lo crea `add-parties-and-products` (ver sus obligaciones).
- **Casos especiales.** La matriz (`special_case_support`, ADR 0014) se aplica en el paso 1: lo no soportado se rechaza de forma explícita.
- **Decimales.** Los importes y tarifas llegan como `DecimalString` validados con las especificaciones de `packages/contracts/src/decimal.ts`, que salen de los XSD (`decimal-policy.md`). El cálculo y el redondeo siguen Q-14 ("Reglas de la emisión local"). Las especificaciones siguen la regla del XSD (Q-43): `tarifa` es un porcentaje de 4/2 sin máximo de 100, y los límites normativos de cada impuesto son de su catálogo.
- **Esquemas.** Los XSD del registro (`schema_registry_entry`) se registran en la librería al arrancar el motor (ADR 0008).

## Obligaciones que deja `add-parties-and-products`

`add-invoice-emission` debe recoger en sus tareas (design D5, D7 y D8 de
`add-parties-and-products`):

- **Fecha del documento, no el estado mostrado.** El estado tributario de un producto (`READY`, `REVIEW_REQUIRED`, `INCOMPLETE`) es orientativo y se evalúa hoy. La emisión vuelve a resolver cada referencia (`catalogType`, `entryKey`) con la fecha del documento, mediante las lecturas internas de `catalogs` (`availability`, `resolveCatalogEntry`). Una referencia no utilizable en esa fecha detiene la emisión antes de reservar.
- **Datos de cálculo completos.** Un comprobante no puede continuar si necesita calcular un impuesto cuya referencia esté en `INCOMPLETE` en la fecha del documento (`calculationData: MISSING`): hoy, ICE sin tarifa legal, IRBPNR sin valor legal e IVA diferenciado sin política de cálculo. Que la entrada exista no basta.
- **Sin tarifas copiadas.** El producto solo guarda referencias; las tarifas y valores se toman de la versión resuelta y se copian al snapshot (BR-21), nunca del producto ni de `facturacion-electronica-ec`.
- **Consumidor final por su marca.** El comprador consumidor final se reconoce por `systemRecord: CONSUMER_FINAL`, nunca comparando su identificación o su razón social. Su identidad es la del tercero del sistema de la empresa.
- **Límite de consumidor final en la emisión.** El monto máximo (USD 50 al corte) sigue en la política versionada y se aplica en el paso 1 con la fecha del documento, sobre `importeTotal` ("Reglas de la emisión local"); el tercero no lo guarda.
- **Precio sin impuestos.** `unitPrice` es el `precioUnitario` del XSD, antes de impuestos y con la escala de `decimal-policy.md`; los subtotales, impuestos y totales los calcula la emisión (Q-14).

## Motor SRI (ADR 0018)

`facturacion-electronica-ec` aporta las piezas del protocolo detrás de puertos propios. La
orquestación de este documento sigue siendo de la aplicación.

- **Qué se usa:** `generateClaveAcceso` detrás de `AccessKeys`, `EcSriSigner` detrás de `XmlSigner` y `SriClient` como transporte, cada uno tras su prueba de contrato. El XML de la factura lo escribe un builder propio (Q-44), y la validación XSD usa `xmllint-wasm` directamente detrás de `XsdValidator`, no `validateXmlAgainstXsd` (ADR 0021). La lista completa de lo propio, lo reutilizado y lo que no se usa está en el ADR 0018.
- **Qué no se usa:** `emitir*`, `ISequenceProvider` ni `EmissionHooks`.
- **Secuencial.** Lo reserva siempre `reserveSequentialIn` en el paso 2. Ningún adaptador implementa `rollback` ni pide otro secuencial:
  - un `DEVUELTA` nunca devuelve el número al contador (BR-08);
  - el error 70 se trata con la misma clave, nunca con un secuencial nuevo.
- **Código numérico.** Lo genera la aplicación con `crypto.randomInt`, porque `generateCodigoNumerico` de la librería usa `Math.random` en ESM.
- **Importes.** La aritmética fiscal calcula y materializa; el builder propio solo escribe el texto exacto del snapshot, sin `number`. El de la librería escribe desde `number` y no conserva valores válidos de 17 o 18 dígitos (S-3, Q-44). Las pruebas comparan el XML con los importes esperados y con los XML de referencia de S-3.
- **Respuestas del SRI.** El `fetch` inyectado en `SriClient` captura la respuesta original, que se persiste antes de actuar. La clasificación de la tabla de abajo se hace sobre esa respuesta, porque `SriClient`:
  - toma una recepción sin estado como `DEVUELTA`;
  - toma una autorización sin bloque como `NO AUTORIZADO`;
  - devuelve solo la primera de varias autorizaciones.
- **Firma.**
  - La custodia descifra el P12 solo para `sign`.
  - La librería nunca recibe el secreto cifrado.
  - No hay logs ni hooks con XML o secretos.
  - Antes de firmar se comprueba que el certificado embebido es el inspeccionado al cargarlo.

## Clave de acceso

Composición, módulo 11 y pruebas obligatorias en CTX §8. En este proyecto:

- Se calcula y persiste en el paso 2, desde el snapshot congelado; nunca se recalcula.
- El código numérico sale de un generador aleatorio criptográfico y se guarda una sola vez (CTX §8.4).
- La unicidad la imponen las restricciones de secuencial y de clave, no el código numérico.
- Ningún reintento, reconciliación ni corrección genera otra clave.

## Idempotencia de la emisión

| Capa | Mecanismo                                                                                   | Protege contra                                       |
| ---- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | `Idempotency-Key` durable en PostgreSQL, con alcance empresa + operación + clave y la huella canónica de la solicitud (Q-30). Misma clave y solicitud: devuelve o reanuda el mismo comprobante. Solicitud distinta: `409 IDEMPOTENCY_KEY_REUSED`. No expira durante la vida fiscal útil del documento. | Doble clic, reintentos HTTP, reenvíos del cliente. |
| 2    | Reanudación del comprobante `RESERVED` de esa clave y transición guardada `RESERVED` → `SIGNED`. | Un segundo número o una segunda clave tras una caída. |
| 3    | Unicidad del secuencial y de la clave de acceso.                                             | Cualquier camino de código que intente duplicar.     |
| 4    | Todo envío usa el XML firmado persistido; nunca se reconstruye para reintentar.             | Nuevas claves o secuenciales tras un timeout.        |
| 5    | Clave de deduplicación por comprobante y paso en cada job, más verificación del estado.      | Jobs ejecutados dos veces.                           |
| 6    | Unicidad del movimiento de stock por comprobante, producto y tipo.                           | Doble descuento de inventario (ERS AC-08).           |

Reglas generales en `idempotency.md`.

## Clasificación de respuestas del SRI

La implementa `add-sri-transmission` (cambio 7).

| Respuesta                                                       | Tratamiento                                                                 | Estado                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| Recepción `RECIBIDA`                                            | Programar la consulta de autorización tras el intervalo configurado.        | `RECEIVED`              |
| Recepción `DEVUELTA` por inconsistencia                          | Persistir todos los mensajes; el usuario corrige.                           | `RETURNED`              |
| Error 70: clave en procesamiento                                | No reenviar ni cambiar clave o secuencial; consultar la autorización.       | `PENDING_AUTHORIZATION` |
| Error 43: clave registrada                                      | Consultar por la clave y reconciliar.                                       | `SEND_UNKNOWN`          |
| Error 45: secuencial registrado                                 | Bloquear el reuso, reconciliar y escalar si no coincide.                    | `SEND_UNKNOWN`          |
| Timeout, conexión reiniciada, error de proxy, SOAP ilegible     | No es un rechazo; reconciliar por la misma clave.                           | `SEND_UNKNOWN`          |
| Autorización `AUTORIZADO`                                       | Guardar la respuesta original, extraer el XML autorizado, calcular su hash, registrar número y fecha. | `AUTHORIZED` |
| Autorización `NO AUTORIZADO`                                    | Persistir los mensajes.                                                     | `NOT_AUTHORIZED`        |
| Autorización en procesamiento                                   | Reprogramar con backoff y jitter dentro de la ventana.                      | `PENDING_AUTHORIZATION` |
| Respuesta sin el bloque esperado                                | No equivale a `NO AUTORIZADO`.                                              | `MANUAL_REVIEW`         |
| Consulta de validez con error 99                                | Fuera de rango o sin datos; registrar sin concluir.                         | Sin cambio              |

Todo mensaje se conserva completo: identificador, mensaje, información adicional, tipo y
fase, incluidos los códigos desconocidos (CTX §32). Los errores se clasifican en transporte,
recepción devuelta, autorización, validación y consulta, siempre con el payload original.

## Resiliencia

La implementa `add-sri-transmission` (cambio 7).

- Timeouts: de conexión corto y de petición controlado, ambos configurables (CTX §33).
- Las consultas se reintentan; el envío nunca se reintenta a ciegas: primero se reconcilia.
- Circuit breaker por servicio y ambiente del SRI; mientras está abierto, los jobs se reprograman sin llamar y la salud informa al SRI no disponible.
- La autorización puede tardar hasta 24 horas desde `RECIBIDA` (CTX §23.1); el umbral de revisión manual es Q-06.
- Un comprobante por envío, sin lotes, y nunca uno que supere el límite de tamaño versionado (CTX §29).
- La caída del SRI no afecta la consulta local ni la emisión hasta `SIGNED` (ERS RNF-004).

| Caso de recuperación (CTX §52)                       | Mecanismo                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| A — timeout al enviar                                | `SEND_UNKNOWN`, consulta por clave, reenvío del mismo XML solo si el SRI no la conoce. |
| B — error 70                                         | `PENDING_AUTHORIZATION` sin reenvío.                                         |
| C — el proceso muere tras `RECIBIDA`                 | El job de autorización persistido continúa tras el reinicio.                 |
| D — el proceso muere tras autorizar y antes de guardar | La reconciliación consulta, encuentra `AUTORIZADO` y guarda los artefactos. |
| E — clave registrada                                 | Error 43 a `SEND_UNKNOWN` y reconciliación.                                  |

## Versionado técnico

| Elemento                           | Mecanismo                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| XSD                                | Registro de esquemas con tipo, raíz, versión, archivo, hash SHA-256, origen y fecha (CTX §19.3). Los archivos se empaquetan con la aplicación y nunca se descargan en tiempo de ejecución. Los antiguos se conservan. |
| Versiones iniciales                | 01 1.1.0, 03 1.1.0, 04 1.1.0, 05 1.0.0, 06 1.1.0, 07 2.0.0 (CTX §3.1, ADR 0008).                                  |
| Catálogos y políticas              | Entradas con vigencia, fuente y versión: impuestos, retenciones, formas de pago, consumidor final, límite de tamaño y endpoints por defecto (CTX §55). |
| Casos especiales                   | Matriz de soporte por anexo con categorías explícitas; lo no soportado se rechaza antes de emitir (ADR 0014).      |
| Snapshot de cada comprobante       | Versiones de XSD, builder, catálogos, configuración de la empresa y renderer del RIDE (CTX §39).                  |
| Cambios normativos                 | Proceso de CTX §53 y checklist de CTX §54 antes de cada release; registro en el repositorio (Q-40).                |

## Firma

- Custodia del certificado en ADR 0011; parámetros de firma en ADR 0013.
- Puerto del firmador según CTX §20.3. Recibe el certificado descifrado solo en memoria y durante la firma.
- Validaciones previas de CTX §20.6 en cada firma, no solo al cargar el certificado.
- El servidor sincroniza su reloj por NTP y la salud reporta la desviación (CTX §20.5).

## Artefactos, RIDE y entrega

- Conjunto probatorio por comprobante según CTX §31, guardado mediante el puerto de almacenamiento, en PostgreSQL al inicio (ADR 0010). El XML firmado lo guarda el cambio 6 con sus bytes exactos y metadatos; las respuestas del SRI y el XML autorizado, el cambio 7. Cada artefacto se escribe una vez y guarda su hash; la descarga recalcula el hash y alerta si no coincide (ERS RF-407).
- El XML autorizado se extrae de la respuesta del SRI, nunca se reconstruye (CTX §45).
- El RIDE se genera tras la autorización, desde el comprobante autorizado, con la marca de Pruebas cuando aplica, y registra la versión del renderer.
- Cada entrega queda registrada; un fallo de entrega no cambia el estado fiscal (CTX §46).

## API de emisión

- Recursos por tipo de comprobante; la factura bajo `/api/v1/invoices` (Q-29), con las rutas de "Implementación de `add-invoice-emission`". La empresa y el ambiente salen del contexto autenticado y de la configuración vigente, nunca de la ruta ni del cliente. Los pasos internos (XML, firma, clave, envío) no son endpoints. La descarga de XML y RIDE, la reconciliación y el reenvío llegan con sus cambios, solo cuando la política lo permite (CTX §40).
- No existe una operación genérica para enviar XML arbitrario (CTX §40).
- La emisión exige `Idempotency-Key` y responde sin esperar al SRI (CTX §41).
- Contratos versionados, validación con Zod en el servidor y documentación OpenAPI (ERS API-001..005).

## Observabilidad

- Los logs registran comprobante, clave de acceso, tipo, ambiente, transición, estado y código del SRI, duración, intento y correlación; nunca el P12, su contraseña, claves privadas ni el XML o SOAP sin redactar (CTX §47).
- Métricas y alertas de CTX §48, incluidos la edad del pendiente más antiguo y los días para el vencimiento del certificado. La emisión local ya publica `invoice_emission_stage_duration_seconds` por etapa y resultado.
- Las transiciones de estado y los eventos de dominio permiten diagnosticar sin leer SOAP sensible (CTX §62).

## Pruebas

Obligatorias del motor fiscal en `../quality/testing.md`: invariantes, golden files,
propiedades, casos de recuperación, concurrencia, idempotencia y la matriz de certificación
en el ambiente de Pruebas del SRI.
