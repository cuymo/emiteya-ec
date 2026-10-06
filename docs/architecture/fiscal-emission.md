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
| 5 | Firma con la firma vigente, vuelve a validar el XML firmado contra el XSD y persiste sus bytes exactos con su hash, en la misma transacción que la transición, la auditoría y el job `sri.transmit` (ADR 0004, ADR 0010). El límite de tamaño lo comprueba la transmisión antes de cada envío (BR-26, Q-47). | `SIGNED` |
| 6 | Recepción: envía el XML firmado persistido y persiste la respuesta original antes de clasificarla. | `RECEIVED`, `RETURNED` o `SEND_UNKNOWN` |
| 7 | Autorización: consulta por clave con backoff y jitter; persiste la respuesta original antes de clasificarla; guarda número, fecha, ambiente y XML autorizado (CTX §34, §45). | `AUTHORIZED`, `NOT_AUTHORIZED` o `MANUAL_REVIEW` |
| 8 | RIDE desde el comprobante autorizado, guardado como artefacto (CTX §30). | Cambio 8 |
| 9 | Entrega: registra la descarga, la impresión o el correo (CTX §46, Q-24). | Cambio 8 |
| 10 | Reconciliación por la misma clave para resolver resultados inciertos y los errores 43, 45 y 70; automática o pedida por el administrador. | El que determine la evidencia |
| 11 | Recuperación tras una caída: arriendos que vencen, barrido de firmados sin job y guarda de la llamada interrumpida. | Sin cambio |
| 12 | Consulta periódica de validez para detectar anulaciones. | Capacidad futura (Q-16), fuera del cambio 7 |

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

Decididos el 2026-10-03, antes de proponer `add-sri-transmission`. La máquina fiscal es
independiente de los jobs: el envío en curso, el arriendo y la espera del siguiente intento son
estados del job (ADR 0012), no del comprobante.

```text
SIGNED ──(envío)──▶ RECEIVED ──▶ AUTHORIZED | NOT_AUTHORIZED | MANUAL_REVIEW
  │
  ├──▶ RETURNED
  └──▶ SEND_UNKNOWN ──(reconciliación por clave)──▶ RECEIVED | AUTHORIZED | NOT_AUTHORIZED | RETURNED | MANUAL_REVIEW
                     └──(el SRI no conoce la clave y no hay evidencia de recepción)──▶ reenvío de los mismos bytes firmados

MANUAL_REVIEW ──(reconciliación manual concluyente)──▶ RECEIVED | AUTHORIZED | NOT_AUTHORIZED
```

| Estado | Significado | Terminal |
| --- | --- | --- |
| `SIGNED` | Firmado, con su artefacto exacto; espera el envío. | No |
| `RECEIVED` | Recepción `RECIBIDA`, o la consulta indica que el SRI procesa la clave. Pendiente de autorización: agrupa el `PENDING_AUTHORIZATION` de ERS §12.1. | No |
| `SEND_UNKNOWN` | No se sabe si el SRI recibió el XML, o la respuesta exige reconciliar (43, 45, 70). | Nunca |
| `RETURNED` | Recepción `DEVUELTA` concluyente. Conserva el comprobante, su número, su clave y sus artefactos; no libera el secuencial. | Sin salida en el cambio 7: su corrección es una capacidad futura (BR-28) |
| `AUTHORIZED` | `AUTORIZADO`, con número, fecha, ambiente y respuesta original guardados. | Sí |
| `NOT_AUTHORIZED` | `NO AUTORIZADO` concluyente, o `RECHAZADO` como en el ejemplo "Comprobante No Autorizado" de la ficha v2.34, §7.2.3 (Q-07). | Sí |
| `MANUAL_REVIEW` | Respuesta inconsistente con el comprobante, error 45 con el secuencial registrado con otra clave, o ventana de conclusión agotada (design D4 de `add-sri-transmission`). | No: sale solo con una reconciliación manual concluyente |

Reglas:

- **UNKNOWN no es REJECTED.** Un resultado incierto nunca lleva a `RETURNED` ni a `NOT_AUTHORIZED` sin una respuesta concluyente, y `SEND_UNKNOWN` nunca es terminal (CTX I-15, I-16).
- `RECIBIDA` nunca lleva directamente a `AUTHORIZED`: hace falta la autorización.
- Ningún estado posterior a `SIGNED` libera o reutiliza el secuencial, genera otra clave o regenera el XML firmado.
- **Revisión manual (Q-06, resuelta).** `MANUAL_REVIEW` es un estado fiscal (ERS §12.1, CTX §26 y §34), con una lista cerrada de entradas. Los errores técnicos recuperables (timeouts, SRI caído, HTML o SOAP Fault) nunca llevan a él: dejan el comprobante en su estado con el job reintentando y, si el job agota sus límites, lo detienen (`STOPPED`) de forma visible, sin cambiar el estado fiscal. La salida es solo una reconciliación manual del administrador con evidencia concluyente; una clave desconocida no habilita el reenvío desde `MANUAL_REVIEW`.
- `CANCEL_PENDING` y `CANCELLED` pertenecen a la capacidad futura de anulaciones (Q-16).

## Decisiones para el diseño de `add-sri-transmission`

Decididas el 2026-10-03 en la revisión de readiness del cambio 7; el design del cambio las concreta.

- **Jobs (ADR 0012, aceptado).** Cola durable propia en PostgreSQL, sin librería ni infraestructura adicional.
  - El job inicial de un comprobante nuevo se crea en la misma transacción que su paso a `SIGNED`, o con una estrategia equivalente que no pueda perder un comprobante firmado sin job.
  - Un backfill idempotente crea los jobs de los `SIGNED` que existan al desplegar.
  - La deduplicación por comprobante y fase impide dos transmisiones simultáneas.
  - No hay reintentos infinitos ni bucles calientes.
- **Transporte (ADR 0018, enmienda del transporte).** Adaptador SOAP propio sobre el `fetch` nativo, en la infraestructura de `sri-engine`. Captura la respuesta original y tiene su propio parser, su clasificación y su consulta por clave. Los timeouts son configuración operativa.
- **Intentos y respuestas originales.** Cada interacción con el SRI es un intento durable y de solo agregado, por ejemplo `sri_attempt`:
  - identificador, comprobante y operación;
  - número de intento, inicio y fin;
  - resultado;
  - metadatos HTTP y de error seguros.

  La respuesta original queda asociada a su intento.
  - **Orden obligatorio:** bytes de la respuesta → persistir la respuesta original → clasificar → transición. Nunca se clasifica antes de conservar la evidencia.
  - El SOAP original nunca va a los logs ni a la auditoría.
  - No se reutiliza `document_artifact`, cuyo `UNIQUE(document_id, kind)` impide guardar varias respuestas.
- **`NO AUTORIZADO` (Q-07).** Incluye el texto `RECHAZADO` del ejemplo oficial de la ficha v2.34 (§7.2.3), cuya tabla 6 solo define PPR, AUT y NAT. Es terminal: se persiste la respuesta original, se clasifica, se guardan los mensajes estructurados y el comprobante pasa a `NOT_AUTHORIZED`. Nunca hay reintento automático ni reenvío, ni otra clave, ni otro número, ni reutilización del secuencial.
- **`DEVUELTA`.** El comprobante pasa a `RETURNED` con su respuesta y sus mensajes, sin reutilizar el número. Un reintento nunca cambia el contenido. La corrección (BR-28) es la capacidad futura `correct-returned-document`.
  - Retransmitir los mismos bytes por un resultado incierto y corregir el contenido después de un `DEVUELTA` son casos distintos.
- **Error 70.** Se conservan el comprobante, la clave, el secuencial y el `SIGNED_XML`; nunca se genera otro comprobante.
  - Antes de cualquier reenvío se reconcilia por clave. Solo si la reconciliación determina que procede, se reenvían exactamente los mismos bytes persistidos.
  - La espera es configuración operativa mientras no haya una fuente normativa.
- **Verificación antes de cada envío.** Del artefacto `SIGNED_XML` se comprueban el SHA-256, el tamaño, la relación con el comprobante y la clave de acceso. Nunca se regenera el XML.
- **43, 45 y resultados inciertos.** No implican `DEVUELTA`: primero se reconcilia. Lo mismo aplica a:
  - un timeout después de transmitir;
  - una conexión cortada, DNS o una interrupción;
  - HTTP 200 con HTML;
  - un SOAP Fault ambiguo;
  - un cuerpo vacío o malformado;
  - cualquier caso en que no se sepa si el SRI recibió el XML.

  Nunca se reenvía a ciegas.
- **Reconciliación.** Es una operación interna de consulta por clave, automática desde el job o manual del administrador; el historial distingue las dos. No hay un endpoint público de bajo nivel para consultar el SOAP: la API sigue orientada a la factura.
- **Autorización.** Al autorizar se guardan de forma inmutable:
  - el número y la fecha de autorización;
  - el ambiente confirmado;
  - la respuesta original;
  - el XML autorizado exacto, si viene en la respuesta.

  El `SIGNED_XML` (lo enviado) no se reemplaza. El XML autorizado (lo recibido) es otro artefacto, y ambos se verifican por hash.
- **Límite de tamaño.** Es una política versionada de `fiscal-catalogs`, con el texto fuente, la sección, la unidad y la interpretación exacta en bytes.
  - Entre 320 000 y 327 680 bytes no se decide sin la fuente oficial (Q-47), y la cifra no se inventa ni se copia de la librería.
  - Resuelto en el cambio 7 (2026-10-04): Q-47 es una compuerta previa a la transmisión real. La política existe y falla cerrada; su cifra se publicará en un cambio pequeño cuando haya evidencia oficial.
- **API.** No hay `POST /send`, `/soap`, `/reception` ni `/authorization`: el sistema transmite con jobs. La API de facturas expone el estado, los mensajes de negocio y el historial útil. Si el design la justifica, añade una acción de reconciliación solo para el administrador.
- **Compuertas externas.** No bloquean proponer ni apply; sí bloquean la transmisión real y el go-live:
  - el vector oficial de la clave de acceso: cumplido el 2026-10-04 (ficha v2.34, secciones 5.2 y 7.2.3, en la prueba de contrato de `AccessKeys`);
  - S-3 online con nuestro `SIGNED_XML` persistido, nuestro adaptador, nuestra clave, nuestros parsers y nuestras transiciones;
  - un P12 ecuatoriano real;
  - un RUC habilitado en Pruebas del SRI.

  Nada sensible va al repositorio ni a la CI pública.
- **Fuera del cambio 7:**
  - la observación de anulaciones (Q-16);
  - la corrección de un devuelto (BR-28, `correct-returned-document`);
  - el RIDE y la entrega (cambio 8).

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
- **Vector oficial de la clave de acceso.** No bloquea el proposal: el algoritmo coincide con CTX §8.3, una prueba independiente comprueba el dígito y S-3 offline la composición completa. Obtener y verificar el vector oficial de la ficha es evidencia adicional; no se inventa. El 2026-10-03 el portal del SRI no fue accesible desde el entorno del proyecto. El vector queda como evidencia pendiente y como compuerta previa a la transmisión: no bloquea el archive de este cambio (S-3 en `open-questions.md`). Se obtuvo el 2026-10-04 en `add-sri-transmission`: el ejemplo de verificación de la sección 5.2 y la clave del ejemplo de recepción de la sección 7.2.3 pasan con el algoritmo sin cambios.

## Implementación de `add-invoice-emission`

Cambio 6. Código en `backend/src/modules/invoices/` y contratos en
`packages/contracts/src/invoices.ts`.

| Pieza | Dónde |
| --- | --- |
| Borrador y vista previa del servidor | `invoices/domain/draft.ts`, `invoices/application/drafts.ts` |
| Evaluación pura, con todos los problemas en el orden de D6 | `invoices/domain/evaluation.ts` |
| Aritmética fiscal exacta y materialización HALF_UP | `invoices/domain/amounts.ts`, sobre `platform/decimal` |
| Snapshot versionado (`InvoiceSnapshotV1`) | `invoices/domain/snapshot.ts` |
| Transacción de `RESERVED` | `invoices/application/emission.ts` y `invoices/infrastructure/emission-unit-of-work.ts`, con la reserva compartida `fiscal/application/document-reservation.ts` (`add-credit-notes`) |
| Del snapshot al artefacto firmado | `fiscal/application/signing-pipeline.ts`, compartido por tipo desde `add-credit-notes`, con el perfil `invoices/application/signing-profile.ts` |
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
  - mientras otro intento tiene el arriendo, devuelve el estado actual sin intentar y sin auditoría.
- **Sin bucles.** No hay reintentos automáticos ni jobs en este cambio.

### Auditoría y métricas

- **Auditoría**, siempre con el usuario como actor y sin XML ni bytes:
  - `invoice.reserved`: número, clave, ambiente y total;
  - `invoice.signed`: número y SHA-256 del artefacto;
  - `invoice.signing_retried`: número y resultado (`SIGNED` o el código del diagnóstico), solo cuando comienza un intento sobre una factura `RESERVED`.

  Los borradores, las consultas, las solicitudes rechazadas antes de iniciar una operación fiscal y los reintentos que no inician un intento no generan eventos.
- **Métricas.** Cada emisión alimenta el histograma `invoice_emission_stage_duration_seconds{stage,outcome}` con las etapas `total`, `reservation_tx`, `validation_snapshot`, `arithmetic`, `xml`, `xsd`, `sign` y `persist` (`deployment.md`).
  - Con `EMISSION_STAGE_TIMINGS=1`, que el entorno rechaza en producción, la respuesta lleva además `Server-Timing`.
  - `bench:emission` mide con ellas un P95 total de 1630 ms en el entorno registrado (884 ms en una ejecución anterior sobre el mismo código; `../quality/performance.md`).

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

## Implementación de `add-sri-transmission`

Cambio 7. Código en `backend/src/modules/fiscal/`, `backend/src/modules/sri-engine/` y
`backend/src/platform/jobs/`; contratos en `packages/contracts/src/invoices.ts`.

| Pieza | Dónde |
| --- | --- |
| Máquina fiscal: estados, transiciones, causas y terminales | `fiscal/domain/document.ts` |
| Tipos de job, operaciones, resultados y motivos de detención | `fiscal/domain/transmission.ts` |
| Cola durable: reclamo con `SKIP LOCKED`, arriendos, backoff y runner | `platform/jobs` (`jobs.ts`, `prisma-job-store.ts`, `runner.ts`) |
| Encolado al firmar | `fiscal/application/signing-pipeline.ts` y `fiscal/infrastructure/signed-unit-of-work.ts`, con `fiscal/application/transmission-jobs.ts` |
| Barrido de firmados sin job e interruptor | `fiscal/infrastructure/transmission-sweeper.ts`, `transmission-gate.ts` |
| Paso con el SRI: evidencia antes de la clasificación y decisión guardada | `fiscal/application/transmission-step.ts` |
| Envío, autorización y reconciliación | `fiscal/application/transmit-handler.ts`, `authorize-handler.ts`, `reconcile-handler.ts` |
| Intentos, respuestas originales y resultados | `fiscal/infrastructure/prisma-sri-evidence.ts` |
| Transporte SOAP, sobres, endpoints y circuit breaker | `sri-engine/infrastructure` (`soap-transport.ts`, `soap-envelopes.ts`, `endpoints.ts`, `circuit-breaker.ts`, `sri-gateway.ts`) |
| Clasificadores de recepción, autorización y validez | `sri-engine/infrastructure` (`reception-classifier.ts`, `authorization-classifier.ts`, `validity-classifier.ts`) |
| Política de tamaño | `catalogs` (dataset `sri-transmission-policy`) |
| Consultas y reconciliación manual | `invoices/application/invoices.ts` e `invoices/infrastructure/http/invoices-router.ts`, con la solicitud compartida `fiscal/application/reconciliation-request.ts` (`add-credit-notes`) |
| Métricas | `fiscal/infrastructure/transmission-metrics.ts` |
| Pantallas | `frontend/src/features/archive/transmission-section.tsx`, compartida por la factura y la nota de crédito con textos, rutas y permiso por tipo (`document-kinds.ts`, `add-credit-notes`) |

### Rutas y permisos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/invoices` | Además filtra por los estados nuevos y por "requiere atención" (`SEND_UNKNOWN`, `MANUAL_REVIEW` o transmisión detenida), y marca la transmisión detenida | `invoices.read` |
| `GET /api/v1/invoices/{invoiceId}` | Añade el resumen de la transmisión: interacción en curso, transmisión detenida con su motivo, autorización, mensajes del último resultado y si admite reconciliación | `invoices.read` |
| `GET /api/v1/invoices/{invoiceId}/transmission` | Historial: transiciones e intentos resumidos, sin respuestas originales ni XML; las 100 entradas más recientes, con el total | `invoices.read` |
| `POST /api/v1/invoices/{invoiceId}/reconciliations` | Reconciliación manual `{ reason }` (de 1 a 500 caracteres); responde `202` con el estado actual | `invoices.reconcile` |

- `invoices.reconcile` es solo del administrador (`../security/access-control.md`).
- La reconciliación se admite en `MANUAL_REVIEW`, `SEND_UNKNOWN`, y en `SIGNED` o `RECEIVED` sin un job `sri.*` activo: con el envío o la consulta detenidos, o una firmada que el barrido aún no encoló. Responde `409 SRI_INTERACTION_IN_PROGRESS` si hay un job activo (dos solicitudes simultáneas chocan en el índice único y solo una se programa) y `409 INVOICE_NOT_RECONCILABLE` en `RESERVED`, `RETURNED`, `AUTHORIZED` y `NOT_AUTHORIZED`. Una factura de otra empresa es `404`.
- No hay ninguna ruta de envío, recepción, autorización ni SOAP.

### Jobs

| Tipo | Lo encola | Reintenta | Límite |
| --- | --- | --- | --- |
| `sri.transmit` | La transacción que firma, el barrido y la reconciliación que decide reenviar | Solo fallos demostrablemente anteriores al envío y pausas del circuit breaker; si la solicitud pudo salir, clasifica | `SRI_TRANSMIT_MAX_ATTEMPTS` y `SRI_TRANSMIT_DEADLINE_HOURS` |
| `sri.authorize` | La transición a `RECEIVED` | Consulta con backoff y jitter, la primera tras `SRI_AUTHORIZATION_FIRST_DELAY_SECONDS` | Ventana de conclusión: sin conclusión, `MANUAL_REVIEW`; con fallos de transporte, `STOPPED`. Decide la última consulta: si falla por transporte, el job se detiene aunque las anteriores no concluyeran |
| `sri.reconcile` | La transición a `SEND_UNKNOWN` (tras `SRI_ERROR70_DELAY_SECONDS` para el 70) y la reconciliación manual | Igual que `sri.authorize` | Igual que `sri.authorize` |

- **Un job `sri.*` activo por comprobante.** La deduplicación (`sri.{fase}:{documentId}`) y la exclusión por comprobante son columnas únicas que solo ocupan los jobs activos. Cada job se encola en la transacción que termina el anterior, así que nunca hay una ventana sin job ni dos jobs activos.
- **Arriendo guardado.** Solo el dueño del arriendo confirma una decisión; los demás pierden la carrera sin efectos. Un arriendo vencido se retoma, y si el intento anterior no dejó evidencia de su llamada, el comprobante pasa a `SEND_UNKNOWN` y se reconcilia sin reenviar (CTX §22.3).
- **Barrido.** Al arrancar y cada `SRI_SWEEP_INTERVAL_SECONDS`, encola `sri.transmit` para cada `SIGNED` sin job. No reactiva un job detenido: eso es la reconciliación manual.
- **Transmisión detenida.** Un job que agota sus límites, o que encuentra un problema que no se corrige reintentando, queda `STOPPED` con uno de estos motivos, sin cambiar el estado fiscal:

  | Motivo | Cuándo |
  | --- | --- |
  | `INTEGRITY_FAILED` | El `SIGNED_XML` no coincide con su hash, su tamaño, su comprobante o su clave. No se envía nada. |
  | `TOO_LARGE` | El XML firmado supera el límite de la política vigente. No se envía. |
  | `SIZE_POLICY_MISSING` | No hay política de tamaño vigente para la fecha del envío. No se envía. |
  | `SRI_UNAVAILABLE` | Fallos de transporte hasta agotar los intentos, el plazo o la ventana. |
  | `HANDLER_ERROR` | Un fallo inesperado del handler hasta agotar los intentos. |

### Transporte y evidencia

- **`NOT_SENT` contra la incertidumbre.** Solo un fallo que demuestra que la solicitud no salió (DNS, conexión rechazada, plazo de conexión, certificado TLS no confiable) es `NOT_SENT` y reintenta el envío. Los plazos propios de cabeceras y cuerpo, un corte o una causa desconocida pudieron ocurrir después de enviar: el envío pasa a `SEND_UNKNOWN`.
- **Evidencia antes de la clasificación.** Cada llamada se registra en `sri_attempt` con su respuesta original (`sri_response`) en una transacción, antes de clasificarla. La clasificación (`sri_attempt_result`) y la transición van en otra. Un intento sin clasificar se clasifica al retomar el job, sin volver a llamar.
- **Integridad antes de cada envío.** Se recalculan el SHA-256 y el tamaño del `SIGNED_XML`, y se comprueban su comprobante y su clave. El intento guarda el hash y el tamaño de lo enviado.
- **Autorización.** El número, la fecha y el ambiente se guardan una sola vez en el comprobante, y el XML autorizado, tal como vino en la respuesta, es el artefacto `AUTHORIZED_XML`. El `SIGNED_XML` nunca se reemplaza.

### Reconciliación

- **Estrategia.** Primero la autorización por clave, que trae la decisión y el XML autorizado; si falla por transporte, se reintenta sin cambiar el estado. Si el SRI no conoce la clave, la consulta de validez es una guarda: un estado informado impide el reenvío, y nunca lo autoriza; su error 99, una respuesta sin estado reconocido o un fallo de transporte no aportan evidencia (design D15). Una respuesta de cualquiera de las dos consultas por otra clave es inconsistente y lleva a `MANUAL_REVIEW`.
- **Reenvío.** Solo desde `SEND_UNKNOWN`, o desde `SIGNED` con el envío detenido, cuando ni la autorización ni la validez conocen la clave y no hay evidencia de recepción (`RECIBIDA`, 70 o 43) en los resultados guardados. Encola `sri.transmit` con los mismos bytes firmados: así el administrador reactiva un envío detenido sin una operación de envío.
- **Revisión manual.** Desde `MANUAL_REVIEW`, una clave desconocida deja el comprobante en revisión: no existe una acción "reenviar de todas formas".
- **Historial.** Los intentos guardan el origen (`AUTOMATIC` o `MANUAL`) y quién los pidió; las transiciones, el actor (`SYSTEM` o el administrador) y la causa `RECONCILIATION`.

### Auditoría y métricas

- **Auditoría**, sin respuestas del SRI ni XML:
  - `invoice.reconciliation_requested`: número, estado al pedirla y motivo, con el administrador como actor;
  - `invoice.reconciliation_completed`: número, resultado y estado final, con el administrador que la pidió como actor y la correlación de la solicitud. Se registra solo cuando la reconciliación concluye por su propia decisión, también al detenerse por la ventana agotada. Si el job se detiene por fallos inesperados del handler (`HANDLER_ERROR`), la reconciliación no terminó y no hay evento: la factura muestra la transmisión detenida (`../quality/technical-debt.md`).

  Las transmisiones, consultas, reintentos y reconciliaciones automáticas no se auditan: su evidencia son `sri_attempt` y `document_state_transition`.
- **Métricas** (`../quality/observability.md`): `fiscal_jobs`, `fiscal_jobs_oldest_pending_age_seconds`, `fiscal_documents`, `sri_attempts_total`, `sri_request_duration_seconds`, `sri_error_code_total`, `invoice_authorization_latency_seconds`, `sri_circuit_open` y `sri_transmission_enabled`.

### Obligaciones cumplidas

| Origen | Obligación | Cumplimiento |
| --- | --- | --- |
| Decisiones del cambio 7 | Job inicial sin perder un firmado | `sri.transmit` en la transacción de `SIGNED`, y el barrido como backfill y red de seguridad. |
| Decisiones del cambio 7 | Sin dos transmisiones ni bucles | Un job `sri.*` activo por comprobante; límites de intentos, plazo y ventana; backoff con jitter. |
| Decisiones del cambio 7 | Transporte propio con respuesta original | `SriTransport` y `SriInquiryPort` sobre el `fetch` nativo, con parsers propios. |
| Decisiones del cambio 7 | Respuesta antes de clasificar | `sri_attempt` y `sri_response` antes de `sri_attempt_result`, en transacciones separadas. |
| Decisiones del cambio 7 | `NO AUTORIZADO` y `RECHAZADO` | `NOT_AUTHORIZED`, terminal, con sus mensajes. |
| Decisiones del cambio 7 | `DEVUELTA` | `RETURNED` con sus mensajes, sin liberar el número. |
| Decisiones del cambio 7 | Errores 70, 43 y 45 | `SEND_UNKNOWN` y reconciliación; nunca `RETURNED` ni otro secuencial; el 45 sin la clave conocida es `MANUAL_REVIEW`. |
| Decisiones del cambio 7 | Verificación antes de cada envío | Hash, tamaño, comprobante y clave del `SIGNED_XML`. |
| Decisiones del cambio 7 | Autorización inmutable | Número, fecha y ambiente guardados una vez; `AUTHORIZED_XML` aparte del firmado. |
| Decisiones del cambio 7 | Límite de tamaño versionado | Dataset `sri-transmission-policy`; sin política vigente no se envía. La cifra oficial en bytes es una compuerta previa a la transmisión real (Q-47). |
| Decisiones del cambio 7 | API orientada a la factura | Historial y reconciliación del administrador; ninguna ruta de envío ni de SOAP. |
| `add-invoice-emission` | Envía siempre los mismos bytes | El envío y el reenvío usan el `SIGNED_XML` persistido; nunca se regenera. |

## Implementación de `add-document-archive`

Cambio 8. El RIDE se dibuja en `backend/src/modules/sri-engine/infrastructure/ride/` (ADR 0022).

| Pieza | Dónde |
| --- | --- |
| Puertos `RideSourceReader` y `RideRenderer`, y los motivos de rechazo | `sri-engine/application/ride.ts` |
| Lectura del XML de origen | `sri-engine/infrastructure/ride/ride-source.ts` |
| Renderer (pdfmake, bwip-js y fontkit) | `sri-engine/infrastructure/ride/ride-renderer.ts` |
| Fuentes, licencia y manifiesto, con sus hashes | `backend/assets/fonts/noto-sans/` y `ride-assets.ts` |
| Worker del RIDE y su pool | `ride/serve-ride-tasks.ts`, `ride/pooled-ride-renderer.ts` y `platform/workers/ride-worker-pool.ts` |
| Seguidores de las transiciones (puerto genérico) | `fiscal/application/document-transitions.ts`, invocados por `transmission-step.ts` |
| Job `document.render_ride`: seguidor de la autorización, handler y barrido | `fiscal/application/archive/` (`ride-jobs.ts`, `ride-handler.ts`) y `fiscal/infrastructure/archive/` (`ride-sweeper.ts`, `ride-unit-of-work.ts`, `ride-metrics.ts`) |
| Logo de una versión de la configuración | `taxpayer/infrastructure/prisma-configuration-assets.ts` (`createConfigurationLogoReader`), compuesto en `main.ts` |

### Rutas y permisos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/documents` | Bandeja: comprobantes desde `RESERVED`, nunca borradores, con filtros de fecha de emisión (`from`, `to`, inclusivos), tipo, estado, identificación del receptor, búsqueda por número o receptor, establecimiento y punto; de la fecha más reciente a la más antigua y, en el mismo día, del creado más tarde al más temprano, con los documentos disponibles (`ride`: `AVAILABLE`, `PENDING`, `STOPPED` o `NOT_APPLICABLE`; `authorizedXml` y `signedXml`) | `archive.read` |
| `GET /api/v1/documents/{documentId}` | Resumen: lo mismo que la bandeja, los artefactos con su tipo, SHA-256, tamaño, fecha y la procedencia del RIDE, y la generación del RIDE con su motivo si está detenida | `archive.read` |
| `GET /api/v1/documents/{documentId}/ride` | RIDE guardado; registra `DOWNLOAD` | `archive.download` |
| `GET /api/v1/documents/{documentId}/authorized-xml` | XML autorizado que devolvió el SRI; registra `DOWNLOAD` | `archive.download` |
| `GET /api/v1/documents/{documentId}/signed-xml` | XML firmado transmitido; registra `DOWNLOAD` | `archive.download` |
| `POST /api/v1/documents/{documentId}/print-requests` | Solicitud de impresión del RIDE guardado (`201`, sin bytes); registra `PRINT_REQUESTED` | `archive.download` |
| `GET /api/v1/documents/{documentId}/deliveries` | Historial de entregas: las 100 más recientes y el total, sin hashes | `archive.read` |
| `POST /api/v1/documents/{documentId}/ride-attempts` | Reintentar una generación detenida del RIDE (`202` con el resumen): autorizado, sin RIDE y con su último job detenido. Encola un job `MANUAL` con quien lo pidió; `409 RIDE_ALREADY_AVAILABLE`, `409 RIDE_GENERATION_IN_PROGRESS` (también si dos solicitudes chocan en la clave activa) o `409 DOCUMENT_NOT_AUTHORIZED`. Sin auditoría: el job guarda quién lo pidió | `archive.retryRide` |

- La empresa sale de la sesión; un comprobante de otra empresa es `404 DOCUMENT_NOT_FOUND`. El detalle de la factura y su historial de transmisión siguen en `/invoices`.
- **Antes de servir:** permiso, empresa y comprobante, disponibilidad (`404 DOCUMENT_NOT_AVAILABLE`) y el SHA-256 y el tamaño recalculados; si no coinciden, `500 ARTIFACT_INTEGRITY_FAILED`, sin ningún byte ni entrega.
- **Cabeceras:** `Content-Type`, `Content-Length`, `Content-Disposition: attachment` con `{tipo}-{número}.pdf` o `-autorizado.xml` y `-firmado.xml` (sin texto del cliente), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` y el SHA-256 como `ETag`.
- **`HEAD`:** las rutas de descarga responden `405` con `Allow: GET`; un `HEAD` no envía el documento y nunca registra una descarga.
- **Impresión:** una acción explícita; ningún `GET` registra una solicitud de impresión. La interfaz pide después el mismo RIDE, que registra su `DOWNLOAD`.
- **Entregas:** `document_delivery_event`, de solo agregado y sin auditoría duplicada. `DocumentNotificationPort` (`fiscal/application/ports.ts`) es el punto de extensión del correo en P1, sin implementación.

### RIDE

- **Solo lo que el sistema emite.** El lector admite la factura 1.1.0 (`codDoc` 01), la única que escribe el builder, con exactamente sus elementos y la firma. Todo impuesto es IVA, porque ICE e IRBPNR no tienen datos de cálculo y la emisión los rechaza.
- **Rechazos deterministas.** La generación se detiene con uno de estos motivos, y un detalle seguro (nombres de elementos o puntos de código, nunca contenido):

  | Motivo | Cuándo |
  | --- | --- |
  | `RIDE_SOURCE_INVALID` | XML con `<!DOCTYPE>` o entidades, de más de 2 MiB, con más de 24 niveles, mal formado, no UTF-8, o que no es una factura 1.1.0. |
  | `RIDE_SOURCE_UNSUPPORTED` | Un elemento que el sistema no emite (propina, información adicional, guía de remisión, plazos de pago…) o un impuesto que no es IVA. Nunca se omite en silencio. |
  | `RIDE_AUTHORIZATION_MISMATCH` | La clave del XML no es la del comprobante o la del número de autorización, o el ambiente no coincide. |
  | `RIDE_GLYPH_MISSING` | Un carácter sin glifo en Noto Sans Regular o Bold, con sus puntos de código. |
  | `RIDE_LOGO_INVALID` | El logo no es un PNG o un JPEG. |
  | `RIDE_FONTS_UNAVAILABLE` | Las fuentes del worker faltan o no coinciden con su manifiesto. |

- **Contenido** del anexo 2 de la ficha v2.34 (página 60):
  - cabecera con RUC, "FACTURA", número, autorización con su fecha en hora de Ecuador, ambiente y emisión (tablas 4 y 2), y la clave como texto y como Code128;
  - emisor con sus leyendas (contribuyente especial, contabilidad, agente de retención y RIMPE del anexo 22), comprador, detalle (códigos solo si alguna línea los tiene), formas de pago con su denominación del snapshot;
  - subtotales llenados: por tarifa de IVA de menor a mayor, 0 %, no objeto y exento; sin impuestos, descuento, IVA por tarifa y valor total.
- **Importes:** el texto exacto del XML, sin separadores, conversión, recálculo ni redondeo.
- **Code128:** vectorial, con zona de silencio de 10 módulos. Ocupa la columna de la autorización, con unos 0.33 mm por módulo (nunca menos de 0.25) y un alto de al menos el 15 % del ancho y 6.35 mm. Las pruebas lo rasterizan y lo leen con zxing (y con zbar si está instalado).
- **Paginación:** A4; desde la segunda página, número, RUC y clave arriba; encabezado del detalle repetido; "Página X de Y"; filas sin partir; pagos y totales juntos; autorización y código enteros en la primera página.
- **Fuentes:** Noto Sans 2.015 Regular y Bold (OFL 1.1), embebidas como subconjunto desde memoria. Nunca fuentes del sistema.
- **Sin recursos externos:** pdfmake niega toda URL y todo archivo local; el texto se dibuja literal, sin enlaces, acciones, scripts ni archivos embebidos.
- **Determinismo por versión.** La fecha de creación del PDF es la de autorización: con las mismas versiones y la misma entrada salen los mismos bytes, también en otro proceso. El RIDE informa `rendererVersion` (`1`), las versiones exactas de pdfmake, pdfkit, bwip-js y fontkit, y el nombre, la versión y el SHA-256 de cada fuente. Un cambio de versión no reescribe los RIDE guardados.
- **Fuera del hilo HTTP.** Solo el worker del RIDE carga el renderer: una prueba de arquitectura lo comprueba sobre los imports de `src/`.

### Job del RIDE

- **Programación.** `document.render_ride` nace en la transacción que guarda la transición a `AUTHORIZED` (autorización, reconciliación automática o manual), por el seguidor que compone `main.ts`. Una caída antes del commit no deja ni la autorización ni el job.
- **Fuente.** El `AUTHORIZED_XML`, o el `SIGNED_XML` transmitido si el SRI autorizó sin devolver el comprobante, siempre con su SHA-256 y su tamaño comprobados. La procedencia (`AUTHORIZED_XML` o `SIGNED_XML_FALLBACK`) queda en el artefacto. Las denominaciones de pago salen del snapshot y el logo, de la versión de configuración del snapshot con su hash.
- **Artefacto.** `RIDE_PDF` con `application/pdf`, sus bytes, SHA-256 y tamaño, y en los metadatos las versiones, las páginas, el origen (`kind`, `sha256`, `provenance`), el hash del logo, el número de autorización y el job. Un segundo RIDE choca con `UNIQUE (document_id, kind)` y el job termina sin error.
- **Detenciones propias de `fiscal`:** `RIDE_SOURCE_INTEGRITY` (origen ausente o alterado), `RIDE_LOGO_INTEGRITY`, `RIDE_DOCUMENT_NOT_AUTHORIZED`, `RIDE_DOCUMENT_NOT_FOUND`, además de los rechazos del renderer.

## Implementación de `add-minimal-inventory`

Cambio 9. El inventario reacciona a la autorización; `fiscal` e `invoices` no lo importan
(`backend.md`, sección Inventario).

| Pieza | Dónde |
| --- | --- |
| Decisión de inventario de cada línea, congelada en el snapshot versión 2 | `invoices/domain/snapshot.ts` (`inventoryAffectsStock`, `lineAffectsInventory`), con los saldos de `StockReads` leídos en la evaluación |
| Líneas de inventario de una factura para el seguidor | `invoices/infrastructure/stock-lines.ts` (`invoiceStockLines`) |
| Seguidor de la autorización | `inventory/application/invoice-outflow.ts` (`inventoryOutflowFollower`), compuesto en `main.ts` junto al seguidor del RIDE |
| Avisos de existencias del borrador | `invoices/domain/stock-warnings.ts` |

- **Snapshot versión 2.** Al reservar, cada línea guarda `inventoryAffectsStock`: verdadero solo si el producto estaba marcado como controlado y tenía inventario inicializado. Un snapshot versión 1 se lee como `false` en todas sus líneas. El campo no llega al XML: los bytes del XML firmado no cambian con la versión.
- **Salida.** Al entrar en `AUTHORIZED` (autorización, reconciliación automática o manual), en la TX B de la decisión, el seguidor lee del snapshot el número y las líneas con `inventoryAffectsStock`, las agrupa por producto con su suma exacta y registra una `SALIDA_FACTURA` por producto, en orden de `productId`. Nunca consulta el producto ni la marca vigentes, y nunca falla por un saldo insuficiente: el saldo puede quedar negativo (Q-19).
- **No retroactivo.** Desactivar el control solo afecta a las emisiones nuevas. Una factura emitida con el control activo descuenta al autorizarse aunque el control se haya desactivado antes; una emitida con el control desactivado no descuenta aunque se reactive antes de autorizarla; emitir activo, desactivar y reactivar antes de autorizar deja exactamente una salida.
- **Una sola vez.** `UNIQUE (company_id, document_id, product_id, movement_type)` sobre el kárdex. Una repetición de la transición no duplica la salida.
- **Recuperación.** La respuesta del SRI queda guardada en la TX A. Si la TX B falla, incluso después de insertar el movimiento, se revierten juntos la transición, la autorización, el artefacto y la salida; el job reintenta y reclasifica la respuesta guardada sin volver a llamar al SRI.
- **Transmisión apagada.** Sin `AUTHORIZED` no hay salida: con `SRI_TRANSMISSION_ENABLED` apagado, las facturas firmadas no descuentan (Q-18).

### Rutas y permisos del inventario

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/inventory/items` | Productos marcados o con inventario, con su estado, saldo (`null` sin inicializar), indicador negativo y último movimiento; `search` por código o nombre y `state` (`TRACKED_NOT_INITIALIZED`, `TRACKED_INITIALIZED`, `DISABLED_INITIALIZED`, `NEGATIVE`), paginados | `inventory.read` |
| `GET /api/v1/inventory/items/{productId}` | Detalle, también sin marca ni inventario (`NOT_TRACKED`), con la inicialización y el último movimiento | `inventory.read` |
| `GET /api/v1/inventory/items/{productId}/movements` | Kárdex por fechas de Ecuador inclusivas (`from`, `to`), del más reciente al más antiguo, con el saldo resultante, el origen, el actor, el número de la factura y el motivo o la nota | `inventory.read` |
| `POST /api/v1/inventory/items/{productId}/initialization` | Inicializar con `INICIAL` (`201`), una sola vez, con cantidad mayor o igual que cero | `inventory.initialize` |
| `POST /api/v1/inventory/items/{productId}/entries` | Entrada manual mayor que cero, con `Idempotency-Key` (`201`, o `200` en la repetición) | `inventory.entry` |
| `POST /api/v1/inventory/items/{productId}/adjustments` | Ajuste con signo, distinto de cero y con motivo, con `Idempotency-Key` (`201`, o `200` en la repetición) | `inventory.adjust` |
| `PUT /api/v1/inventory/items/{productId}/tracking` | Activar o desactivar el control de un producto inicializado; desactivar exige saldo cero | `inventory.configure` |

- Administradores y operadores tienen `inventory.read` e `inventory.entry`; solo el administrador, los demás. La empresa sale de la sesión; un producto de otra empresa es `404 PRODUCT_NOT_FOUND`.
- Rechazos `409`: `INVENTORY_ALREADY_INITIALIZED`, `INVENTORY_NOT_INITIALIZED`, `STOCK_TRACKING_REQUIRED`, `STOCK_TRACKING_DISABLED`, `STOCK_TRACKING_HAS_BALANCE`, `IDEMPOTENCY_KEY_REUSED`; y en la corrección del producto, `STOCK_TRACKING_MANAGED_BY_INVENTORY`. Sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.
- Sin rutas para editar o borrar movimientos ni para recalcular o fijar el saldo.
- **Borrador.** `preview.stockWarnings`, aparte de `issues`: `STOCK_BELOW_REQUESTED` cuando la suma de las líneas de un producto marcado supera su saldo, y `STOCK_NOT_INITIALIZED`, sin saldo, para un producto marcado sin inventario. Nunca bloquean la emisión ni garantizan existencias.
- **Auditoría.** `inventory.initialized`, `inventory.tracking_enabled` e `inventory.tracking_disabled`, además del cambio de la marca en `product.updated`. Las entradas, los ajustes y las salidas no se auditan aparte: el kárdex guarda el actor, el momento y el motivo.

## Decisiones para el diseño de `add-credit-notes`

Decididas el 2026-10-04 en la revisión de readiness del cambio 10 (Q-10 y Q-20); el proposal y el
design del cambio las concretan. Las reglas de negocio están en `docs/product/domain-model.md`
(BR-30, BR-33 a BR-35, BR-45 y BR-59 a BR-62), con su origen oficial o de política del MVP en
`docs/product/capabilities.md` (Trazabilidad de `credit-notes`).

- **Documento propio.** La nota de crédito (`codDoc` 04, XSD `NotaCredito_V1.1.0`, ya en el registro de esquemas) tiene su secuencial por establecimiento, punto y tipo, su clave de acceso, su snapshot inmutable, su XML validado, firmado y archivado, sus jobs de transmisión, su reconciliación, su autorización y su evidencia. Reutiliza el pipeline existente; no lo copia en un sistema paralelo.
- **Genérico y por tipo.**
  - Genérico: reserva del secuencial y clave, `electronic_document` con su máquina de estados y sus transiciones, etapas de la firma con el builder y el XSD del tipo, artefactos, jobs `sri.*`, evidencia, reconciliación, puerto de seguidores de las transiciones, bandeja, descargas, entregas y el job, el runner y el pool del RIDE.
  - Por tipo: la construcción de la nota desde el snapshot de la factura (sin borrador libre), su snapshot, su builder `notaCredito` 1.1.0, la distribución de su RIDE, la capacidad acreditable de la factura y la devolución de stock.
- **Antes de reservar.** Permiso, empresa, factura propia en `AUTHORIZED` con snapshot y artefactos íntegros, exclusión de consumidor final, causa cerrada, cantidades contra la capacidad, declaraciones del usuario: todo se valida antes de consumir secuencial, clave, firma o llamada al SRI.
- **Concurrencia de la capacidad (estrategia propuesta; el proposal fija el modelo).** La reserva de la nota toma, en su misma transacción, un lock sobre la factura modificada y consume una capacidad acreditable materializada por línea de la factura (cantidad e importes originales y acreditados), con incrementos atómicos y un `CHECK` de que lo acreditado no supera lo original. Así dos notas simultáneas no validan contra el mismo saldo, y la base es la última defensa. El retorno físico consume a la vez una capacidad devolvible por factura y producto, igual a su `SALIDA_FACTURA`, con el mismo tipo de defensa; la `DEVOLUCION_NC` la aplica después el seguidor al autorizar la nota. El design decide cuándo una nota libera su capacidad (por ejemplo, solo al terminar en `NOT_AUTHORIZED`), siempre fallando cerrado.
- **Importes de una devolución.** Decimal exacto desde la línea original del snapshot: la cantidad acreditada fija la proporción, y la nota que completa una línea toma exactamente el remanente de base, descuento e impuestos, para que la suma de las notas no difiera del documento original. Con golden tests de línea completa, parcial, varias líneas, notas sucesivas, último remanente, impuestos, descuentos originales, cantidades de 6 decimales y una acumulación que intenta exceder la línea.
- **Devolución de stock.** Otro seguidor de las transiciones, en la misma transacción que la entrada de la nota en `AUTHORIZED`; `fiscal` no importa `inventory`. Agrupa por producto con la suma exacta y bloquea los saldos en orden estable de `productId`, como la salida de la factura.
- **RIDE.** La distribución oficial de la nota de crédito está en la ficha v2.34, anexo 2, página 61: la misma cabecera con la autorización y el Code128, emisor, comprador, el bloque del comprobante que se modifica con su fecha y la razón de modificación, el detalle, la información adicional y los subtotales, sin formas de pago. Usa las primitivas del RIDE de la factura validadas por S-4 (pdfmake, bwip-js, Noto Sans y paginación), sin otro spike; no es el RIDE de la factura con otro título. La nota aparece en la bandeja (`document-archive`), no en otra.

## Implementación de `add-credit-notes`

Cambio 10, en curso. Esta sección crece con cada grupo del cambio.

### Reserva y firma compartidas por tipo

La factura y la nota de crédito comparten la orquestación; cada tipo aporta solo lo que difiere, en
interfaces pequeñas y sin un conmutador por `codDoc` (design D2). La generalización no cambió la
factura: `backend/test/integration/invoice-regression-contract.test.ts` fija, con entradas
deterministas y fixtures generados antes del refactor, la reserva, el número, la clave, el
snapshot, el XML byte a byte, el XML firmado que solo agrega la firma, su validación XSD, su
verificación, los metadatos y el hash del artefacto, las transiciones, la auditoría, el job de
envío, la idempotencia y los errores.

| Pieza | Compartida en `fiscal` | Por tipo |
| --- | --- | --- |
| Reserva | `reserveDocumentIn` (`application/document-reservation.ts`): secuencial, identidad tributaria bloqueada, código numérico y clave, `insertReserved` y transición a `RESERVED`, con el tipo como dato | El módulo bloquea su borrador, evalúa, arma el snapshot (`withKey`) y sus columnas, y registra su idempotencia y su auditoría en la misma transacción |
| Firma | `createSigningPipeline` (`application/signing-pipeline.ts`): arriendo, XML, XSD antes y después de firmar, firma con el tipo del comprobante, artefacto con sus metadatos, paso a `SIGNED`, transición, encolado del `sri.transmit` y diagnóstico. El esquema sale del snapshot y el tipo, del comprobante | `SigningProfile`: el builder del XML desde el snapshot (`SnapshotXmlBuilder`, que traduce sus fallos a `XmlBuildFailure`) y la auditoría del paso a `SIGNED` (`SignedAudit`). La factura: `invoiceSigningProfile` |
| Composición | `signingPipelines` (`infrastructure/signing-pipelines.ts`) y `createSignedUnitOfWork`: `main.ts` y los arneses la crean una vez con el firmador, el validador y la cola | Cada módulo recibe su pipeline: `invoicesModule({ signing: documentSigning.pipeline(invoiceSigningProfile()) })` |
| Reconciliación manual | `requestReconciliationIn` (`application/reconciliation-request.ts`): comprobante bloqueado, estado reconciliable, `sri.reconcile` manual y auditoría en una transacción; la finalización elige su acción por tipo en `reconcile-handler.ts` (`invoice.reconciliation_completed`, `credit_note.reconciliation_completed` o `debit_note.reconciliation_completed`) | Cada módulo expone su ruta, su permiso, sus errores y la acción de la solicitud |

### RIDE de la nota de crédito

- **Lectura por raíz.** `readRideDocument` (`sri-engine/infrastructure/ride/ride-source.ts`) aplica las mismas defensas al XML de origen y elige la lectura por la raíz y la versión: `factura` 1.1.0 (la lectura de la factura no cambió) o `notaCredito` 1.1.0, con su propia lista blanca de los elementos que escribe el builder de la nota y el modelo `RideCreditNote` (sin formas de pago, sin dirección del comprador y sin total de descuentos, que el XML de la nota no trae; con el comprobante modificado, su fecha y la razón de la modificación).
- **Distribución propia.** El renderer dibuja la nota con la distribución de la ficha v2.34, anexo 2, página 61: "NOTA DE CRÉDITO" con su autorización y el Code128 de la clave de la nota, el bloque del comprobante que se modifica y los subtotales con el valor total, sin formas de pago. Su versión de distribución (`CREDIT_NOTE_RIDE_RENDERER_VERSION`) es distinta de la de la factura y viaja a los metadatos del artefacto. El pool de workers, el job, el artefacto y las descargas son los de la factura.
- **Factura sin cambios.** Los bytes del RIDE de cada factura de las pruebas son los mismos antes y después de este cambio.

### Bandeja y secciones compartidas

- **Comprobantes.** La bandeja ofrece los tipos que el sistema emite (`01`, `04` y, desde `add-debit-notes`, `05`) en el filtro "Tipo de comprobante" de los filtros avanzados, en la URL (`tipo`) y enviado a la API como `documentType`; un tipo desconocido en la URL no filtra. Cada fila muestra el tipo bajo el número y enlaza al detalle de su tipo (`/facturas/{id}`, `/notas-credito/{id}` o `/notas-debito/{id}`).
- **Por tipo, sin cambiar las reglas.** `frontend/src/features/archive/document-kinds.ts` guarda lo que cambia por tipo: el nombre con que se nombra al usuario, la ruta del detalle, la ruta de su API, el permiso de reconciliación (`invoices.reconcile`, `creditNotes.reconcile` o `debitNotes.reconcile`), el código del estado no reconciliable y la clave de caché. `DocumentsSection` y `TransmissionSection` reciben el comprobante (identificador, tipo, estado y transmisión) y no muestran nada para un tipo que el sistema no emite. Las reglas de disponibilidad de los documentos siguen en el servidor: RIDE solo de un comprobante autorizado, XML autorizado solo si su artefacto existe y el XML firmado como un documento distinto.

### Medición

- Con `EMISSION_STAGE_TIMINGS=1`, `POST /api/v1/credit-notes` devuelve sus etapas en `Server-Timing` (`total`, `reservation_tx` y las de la firma compartida: `xml`, `xsd`, `sign`, `persist`), como la emisión de la factura; nunca en producción.
- `bench:credit-notes` (design D21) mide la búsqueda de facturas elegibles, la vista previa, la emisión con su reserva, el cálculo de muchas líneas, la contención y el RIDE de la nota, y termina con la reconciliación de las capacidades acreditable y devolvible (`../quality/performance.md`).

### Pantallas de la nota de crédito

- **Notas de crédito** (`/notas-credito`, en "Operación", `creditNotes.read`): `frontend/src/features/credit-notes/credit-notes-screen.tsx`, con búsqueda por número o comprador, estado y causa en la URL (`q`, `estado`, `causa`), tarjetas por debajo de 768 px y los borradores en curso con su eliminación.
- **Borrador** (`/notas-credito/borradores/nueva`, con `?factura={id}` desde la factura, y `/notas-credito/borradores/{id}`, `creditNotes.draft`): `credit-note-draft-editor.tsx`. La causa se elige (no se infiere); la devolución elige líneas y cantidades y la anulación total no; el retorno físico se deshabilita con su explicación en las líneas que no afectaban al inventario o sin salida por devolver. Los importes y los problemas son la vista previa del servidor del borrador guardado. "Emitir nota de crédito" (`creditNotes.emit`) pide en un `ConfirmDialog` las dos declaraciones como casillas separadas, con su texto, su contexto y su fuente; sin ambas no se confirma. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/notas-credito/{id}`): `credit-note-detail.tsx`, con el reintento de la firma (`creditNotes.retrySigning`), la transmisión y los documentos compartidos, la factura modificada, las líneas con su retorno físico y las declaraciones "declaradas por" el usuario.
- **Factura:** su detalle muestra el crédito aplicado, reservado y disponible (`invoice-credit-section.tsx`) y "Emitir nota de crédito" cuando la factura no es a consumidor final, tiene valor acreditable y el usuario puede preparar notas.

## Implementación de `add-debit-notes`

Cambio 11, implementado el 2026-10-05 (todas sus tareas) y pendiente de archivar.

### Cálculo de la nota de débito

- **Una primitiva versionada.** `calculateDebitNoteAmounts` (`debit-notes/domain/amounts.ts`, versión de cálculo `1`) recibe los conceptos (importe y clave del tratamiento) y los tratamientos de IVA de la factura (`invoiceTaxTreatments`, `debit-notes/domain/treatments.ts`), y devuelve las bases por concepto, la base y el impuesto de cada tratamiento, el subtotal y el valor total. La vista previa, el snapshot, el XML y el RIDE usan ese resultado; ninguno calcula.
- **Por tratamiento, nunca por concepto.** Cada base de concepto es su importe exacto (hasta 2 decimales); la base de un tratamiento es la suma exacta de sus conceptos; su impuesto se materializa HALF_UP a 2 decimales una sola vez sobre esa suma; el valor total es el subtotal más los impuestos. Tres conceptos de 0.10 al 15 % dan un IVA de 0.05, no 0.06, y cualquier partición de la misma base da el mismo impuesto.
- **Tratamientos de la factura.** Las combinaciones distintas `taxCode:rateCode` de los impuestos IVA de sus líneas, con el porcentaje y las referencias del catálogo de su snapshot. 0 %, no objeto y exento son tres tratamientos distintos, cada uno con su `codigoPorcentaje`.
- **Evaluación.** `evaluateDebitNote` (`debit-notes/domain/evaluation.ts`) informa los problemas en el orden de la design D4 de `add-debit-notes`: estado, integridad, ambiente, consumidor final (política del proyecto, BR-32), conceptos, forma de pago, declaración, preparación y cálculo. La forma de pago llega resuelta por el resolver de `catalogs`, y su total se comprueba igual al valor total con decimal exacto (`paymentCoversTotal`).
- **Pruebas.** `backend/test/debit-notes/amounts.test.ts` fija los golden de la design D7 y comprueba con un generador determinista las identidades de bases, impuestos y totales, la independencia de la partición y del orden, y que el módulo no usa `number`.

### XML y firma de la nota de débito

- **Builder propio.** `createDebitNoteXmlBuilder` (`sri-engine/infrastructure/debit-note-xml-builder.ts`, versión de builder `1`) escribe `notaDebito` 1.0.0 desde la proyección del snapshot (`toDebitNoteXmlSnapshot`, `debit-notes/application/xml-snapshot.ts`), en el orden del XSD, con `infoTributaria` (`codDoc` 05), `xml-writer.ts` y el texto decimal exacto del snapshot. No usa el builder de alto nivel de la dependencia.
- **Contenido.** `infoNotaDebito` con el comprador de la factura, `codDocModificado` 01, `numDocModificado`, `fechaEmisionDocSustento`, `totalSinImpuestos`, un `impuesto` por tratamiento (código, código de porcentaje, tarifa, base e impuesto), `valorTotal` y `pagos`; `motivos` con un `motivo` por concepto (`razon` es la descripción, `valor` la base).
- **Forma de pago.** `pagos` se escribe siempre con un solo `pago` (`formaPago` y `total` de `snapshot.payments`), porque la ficha técnica v2.34 lo marca como obligatorio en la nota de débito (páginas 58 y 59) aunque el XSD lo permita omitir. Un solo pago es una política del MVP del proyecto. Sin `plazo` ni `unidadTiempo`: el modelo no registra un plazo de crédito.
- **Lo que no escribe:** `rise`, `compensaciones`, `valorDevolucionIva`, `maquinaFiscal` ni `infoAdicional`. `infoAdicional` se escribe solo cuando corresponde un campo adicional definido por una fuente, nunca con contenido inventado; hoy ninguno corresponde (la ficha v2.34 lo resuelve así pese a la fila "Obligatorio" de la página 59, y el RIDE del anexo 26 queda para Q-37): `../product/sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`.
- **Firma.** `debitNoteSigningProfile` registra el builder en la firma compartida y la auditoría `debit_note.signed`; el firmador recibe el tipo `05` (`NOTA_DEBITO` en la librería), y el XML se valida contra `NotaDebito_V1.0.0.xsd` antes y después de firmar. Los golden de bytes exactos están en `backend/test/fixtures/debit-note-xml/`.

### Emisión de la nota de débito

- **Comprobaciones previas** (`createDebitNoteEmission`, `debit-notes/application/emission.ts`), fuera de la transacción y en el orden de la design D4: permiso `debitNotes.emit`, `Idempotency-Key`, el borrador de la empresa, la huella y la repetición, los archivos del esquema, la factura, y la evaluación con la forma de pago resuelta en la fecha de emisión y la declaración. Un rechazo no consume secuencial, clave, firma ni llamada al SRI.
- **Transacción de `RESERVED`** (`createDebitNoteEmissionUnitOfWork`): borrador bloqueado, configuración bloqueada, la factura y la evaluación otra vez con lecturas de la base, el snapshot, `reserveDocumentIn` con el tipo `05`, la factura de la nota (`debit_note_support`), el borrador `EMITTED`, el registro de idempotencia y `debit_note.reserved`. Sin I/O externo y sin bloquear la factura; un fallo en cualquier paso no deja nada (`debit-note-atomicity.test.ts`). Después del commit, la firma compartida con el perfil de la nota.
- **Idempotencia.** Operación `debit_note.emit`, sin TTL. La huella (`debitNoteFingerprint`) cubre el borrador, su versión, la declaración y los datos funcionales de esa versión: factura, punto, forma de pago y conceptos en orden. Misma huella: la misma nota (`200`), y si quedó reservada se reanuda su firma; otra: `409 IDEMPOTENCY_KEY_REUSED`; el borrador ya emitido con otra clave: `409 DEBIT_NOTE_DRAFT_ALREADY_EMITTED`; sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.
- **Rutas:** `POST /api/v1/debit-notes` (`debitNotes.emit`, `201`, o `200` en la repetición) y `POST /api/v1/debit-notes/{id}/signing-attempts` (`debitNotes.retrySigning`, `debit_note.signing_retried`); los borradores y las facturas elegibles en `/api/v1/debit-notes/drafts` y `/api/v1/debit-notes/eligible-invoices` (`debitNotes.draft`).
- **Códigos de rechazo** (`409`): `DEBIT_NOTE_INVOICE_NOT_ELIGIBLE`, `DEBIT_NOTE_INVOICE_INTEGRITY`, `DEBIT_NOTE_CONSUMER_FINAL`, `DEBIT_NOTE_CONCEPTS_REQUIRED`, `DEBIT_NOTE_CONCEPTS_TOO_MANY`, `DEBIT_NOTE_CONCEPT_INVALID`, `DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE`, `DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE`, `DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH`, `DEBIT_NOTE_AMOUNT_OUT_OF_RANGE`, `DEBIT_NOTE_DRAFT_INCOMPLETE`, `DEBIT_NOTE_DRAFT_CHANGED` y los compartidos de la emisión; los recursos inexistentes o de otra empresa son `404` (`DEBIT_NOTE_NOT_FOUND`, `DEBIT_NOTE_DRAFT_NOT_FOUND`, `DEBIT_NOTE_INVOICE_NOT_FOUND`).
- **Métricas:** `debit_note_reservations_total` y `debit_note_concepts_total{cause}` (`../quality/observability.md`).

### Consulta, transmisión y reconciliación de la nota de débito

- **Consulta:** `GET /api/v1/debit-notes` (búsqueda por número o comprador, `state` y `cause`, que filtra por la causa de alguno de los conceptos del snapshot), `GET /api/v1/debit-notes/{id}` (el detalle desde el snapshot: factura con su autorización, conceptos con su causa y su tratamiento, impuestos por tratamiento, forma de pago, declaración "declarada por" el usuario, diagnóstico y transmisión) y `GET /api/v1/debit-notes/{id}/transmission`, con `debitNotes.read`.
- **Transmisión sin cambios.** Los handlers de envío, autorización y reconciliación, la cola, los clasificadores, la evidencia guardada antes de clasificar y la reclasificación de la respuesta guardada atienden el tipo `05` igual que la factura (`debit-note-transmission.test.ts`, con respuestas sintéticas). Los seguidores de la capacidad acreditable, de la devolución de stock y de la salida de inventario no hacen nada para una nota de débito.
- **Reconciliación manual:** `POST /api/v1/debit-notes/{id}/reconciliations` (`debitNotes.reconcile`, solo el administrador) con la solicitud compartida `requestReconciliationIn` y la auditoría `debit_note.reconciliation_requested`; la finalización se audita como `debit_note.reconciliation_completed` (`COMPLETED_AUDIT` de `reconcile-handler.ts`). Un estado que no se reconcilia es `409 DEBIT_NOTE_NOT_RECONCILABLE`.

### RIDE de la nota de débito

- **Lectura por raíz.** `readRideDocument` elige la lectura de `notaDebito` 1.0.0 (`readDebitNote`, `ride-source.ts`) con su propia lista blanca de los elementos que escribe el builder de la nota y el modelo `RideDebitNote`: el comprobante modificado y su fecha, un motivo por concepto, la única forma de pago y los impuestos por tratamiento con la tarifa de cada `impuesto`. Información adicional, compensaciones, un segundo `pago` o un segundo bloque de `pagos` detienen la generación (`RIDE_SOURCE_UNSUPPORTED`).
- **Distribución propia.** El renderer dibuja la nota con la distribución de la ficha v2.34, anexo 2, página 62: "NOTA DE DÉBITO" con su autorización y el Code128 de la clave de la nota; el comprador con el comprobante que se modifica y su fecha; la tabla "RAZÓN DE LA MODIFICACIÓN" y "VALOR DE LA MODIFICACIÓN"; "Forma de pago" con la denominación de `snapshot.payments` (el handler ya la lee así para la factura, sin consultar el catálogo); y los subtotales por tratamiento con el IVA y el valor total, sin total de descuentos. Su versión de distribución es `nota-debito-1` (`DEBIT_NOTE_RIDE_RENDERER_VERSION`).
- **Sin cambios para los demás.** El pool, el job, el artefacto, las descargas y las entregas son los de la factura; el RIDE de la factura y el de la nota de crédito tienen los mismos golden que antes.

### Bandeja con notas de débito

- **Un tipo más en el registro.** `EMITTED_DOCUMENT_TYPES` incluye `05` y `DOCUMENT_KINDS` guarda su nombre ("nota de débito"), el detalle `/notas-debito/{id}`, su API `/debit-notes`, el permiso `debitNotes.reconcile`, el código `DEBIT_NOTE_NOT_RECONCILABLE` y sus esquemas de vista y transmisión. El filtro "Tipo de comprobante" ofrece los tres tipos; `DocumentsSection` y `TransmissionSection` reciben la nota sin otra rama y las reglas de disponibilidad de los documentos siguen en el servidor.

### Medición de la nota de débito

- Con `EMISSION_STAGE_TIMINGS=1`, `POST /api/v1/debit-notes` devuelve sus etapas en `Server-Timing` (`total`, `reservation_tx` y las de la firma compartida: `xml`, `xsd`, `sign`, `persist`), como la factura y la nota de crédito; nunca en producción.
- `bench:debit-notes` (design D25) mide la búsqueda de facturas elegibles, la vista previa de 1 y de 100 conceptos, el cálculo, la emisión con su reserva, la contención en una misma factura y en facturas distintas y el RIDE de la nota, y termina comprobando que las notas no tocaron la capacidad acreditable ni el inventario (`../quality/performance.md`).
- `test/integration/e2e-debit-notes.test.ts` recorre el flujo sobre `main.ts` con el SRI simulado: una factura con dos tarifas, una nota de dos tratamientos autorizada con su RIDE en la bandeja y su único `pago` en los XML, otra no autorizada, y la factura con el mismo crédito, el mismo inventario y las reconciliaciones sin diferencias.

### Pantallas de la nota de débito

- **Notas de débito** (`/notas-debito`, en "Operación", `debitNotes.read`): `frontend/src/features/debit-notes/debit-notes-screen.tsx`, con búsqueda por número o comprador, estado y causa en la URL (`q`, `estado`, `causa` con `intereses` o `costos`), las causas de los conceptos de cada nota, tarjetas por debajo de 768 px y los borradores en curso con su eliminación (`debitNotes.draft`).
- **Nueva nota** (`/notas-debito/borradores/nueva`, con `?factura={id}` desde la factura, `debitNotes.draft`): `debit-note-draft-editor.tsx` (`NewDebitNoteDraftScreen`). Elegir la factura en el selector de facturas elegibles, o confirmar la que llega desde su detalle con "Preparar nota de débito", crea el borrador (`POST /debit-notes/drafts`) y abre su ruta: los tratamientos que se ofrecen son los de la factura y los devuelve la vista previa del servidor, no el cliente.
- **Borrador** (`/notas-debito/borradores/{id}`, `debitNotes.draft`): `DebitNoteDraftScreen`. Conceptos en una lista ordenada con agregar (el foco va a la descripción nueva) y quitar (el foco vuelve a "Agregar concepto"); por concepto, la causa en un control segmentado de dos opciones, la descripción, el importe y el tratamiento entre los de la factura (control segmentado hasta 5 y `Select` desde 6), nombrado "IVA 15 %" cuando su denominación oficial es solo un porcentaje (`debit-note-format.ts`), como en la nota de crédito. La forma de pago es un `Select` de las entradas utilizables del catálogo `payment-method`; una guardada que dejó de serlo se muestra como no disponible y la vista previa lo explica. Los importes (bases e impuestos por tratamiento, valor total y la forma de pago con su total) y los problemas, junto a su concepto o en el resumen, son la vista previa del servidor del borrador guardado. "Emitir nota de débito" (`debitNotes.emit`) pide en un `ConfirmDialog` el resumen y la declaración como casilla, con su texto, su contexto, su fuente y el aviso de que es una declaración del usuario; sin ella no se confirma. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/notas-debito/{id}`, `debitNotes.read`): `debit-note-detail.tsx`, desde el snapshot de la nota: estado, número y valor total; la factura modificada con su enlace; los conceptos con su causa, su descripción, su importe y su tratamiento; las bases e impuestos por tratamiento y el valor total; la forma de pago con su total; la declaración "declarada por" el usuario, que el sistema no puede comprobar; el diagnóstico y el reintento de la firma (`debitNotes.retrySigning`); la transmisión con la reconciliación (`debitNotes.reconcile`) y los documentos compartidos.
- **Factura:** su detalle muestra "Emitir nota de débito" (`invoice-debit-note-action.tsx`, enlace a `/notas-debito/borradores/nueva?factura={id}`) cuando la factura está autorizada, no es a consumidor final, es del ambiente vigente y el usuario tiene `debitNotes.draft`. Es presentación: la API vuelve a comprobar la elegibilidad al crear el borrador y al emitir.

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

- **Qué se usa:** `generateClaveAcceso` detrás de `AccessKeys` y `EcSriSigner` detrás de `XmlSigner`, cada uno tras su prueba de contrato.
  - El XML de la factura lo escribe un builder propio (Q-44).
  - La validación XSD usa `xmllint-wasm` directamente detrás de `XsdValidator`, no `validateXmlAgainstXsd` (ADR 0021).
  - El transporte SOAP es un adaptador propio sobre el `fetch` nativo, detrás de `SriTransport` (enmienda del transporte, Q-34).

  La lista completa de lo propio, lo reutilizado y lo que no se usa está en el ADR 0018.
- **Qué no se usa:** `SriClient` como dueño del protocolo, `emitir*`, `ISequenceProvider` ni `EmissionHooks`.
- **Secuencial.** Lo reserva siempre `reserveSequentialIn` en el paso 2. Ningún adaptador implementa `rollback` ni pide otro secuencial:
  - un `DEVUELTA` nunca devuelve el número al contador (BR-08);
  - el error 70 se trata con la misma clave, nunca con un secuencial nuevo.
- **Código numérico.** Lo genera la aplicación con `crypto.randomInt`, porque `generateCodigoNumerico` de la librería usa `Math.random` en ESM.
- **Importes.** La aritmética fiscal calcula y materializa; el builder propio solo escribe el texto exacto del snapshot, sin `number`. El de la librería escribe desde `number` y no conserva valores válidos de 17 o 18 dígitos (S-3, Q-44). Las pruebas comparan el XML con los importes esperados y con los XML de referencia de S-3.
- **Respuestas del SRI.** El adaptador propio captura la respuesta original, que se persiste antes de clasificarla con nuestro parser. Se descartó `SriClient` porque:
  - toma una recepción sin estado como `DEVUELTA`;
  - toma una autorización sin bloque como `NO AUTORIZADO`;
  - devuelve solo la primera de varias autorizaciones;
  - no devuelve la respuesta original;
  - no consulta por clave.
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

La implementa `add-sri-transmission` (cambio 7). Toda respuesta se persiste antes de clasificarla.

| Respuesta | Tratamiento | Estado |
| --- | --- | --- |
| Recepción `RECIBIDA` | Programar la consulta de autorización tras el intervalo configurado. | `RECEIVED` |
| Recepción `DEVUELTA` concluyente | Persistir la respuesta y todos los mensajes. La corrección es una capacidad futura (BR-28). | `RETURNED` |
| Error 70: clave en procesamiento | No reenviar ni cambiar la clave o el secuencial. Reconciliar por clave, y reenviar los mismos bytes solo si la reconciliación lo determina. | `SEND_UNKNOWN` |
| Error 43: clave registrada | Reconciliar por la clave. | `SEND_UNKNOWN` |
| Error 45: secuencial registrado | Reconciliar por la clave, sin reutilizar el secuencial. Si el SRI no conoce la clave, el secuencial está registrado con otra: `MANUAL_REVIEW`. | `SEND_UNKNOWN` |
| Timeout después de transmitir, conexión cortada, DNS o interrupción, HTTP 200 con HTML, SOAP Fault ambiguo, cuerpo vacío o malformado | No es un rechazo: reconciliar por la misma clave. | `SEND_UNKNOWN` |
| Autorización `AUTORIZADO` | Guardar la respuesta original, el número, la fecha, el ambiente confirmado y el XML autorizado exacto con su hash. | `AUTHORIZED` |
| Autorización `NO AUTORIZADO` o `RECHAZADO` | Persistir la respuesta y los mensajes estructurados, sin reintento ni reenvío (Q-07). | `NOT_AUTHORIZED` |
| Autorización en procesamiento | Reprogramar con backoff y jitter dentro de la ventana de conclusión; al agotarla, `MANUAL_REVIEW`. | `RECEIVED` |
| Autorización sin el bloque esperado | No equivale a `NO AUTORIZADO`. Una respuesta ilegible es un fallo técnico que reintenta. Sin autorizaciones, con la clave consultada y `numeroComprobantes` en 0, el SRI no conoce la clave: desde `RECEIVED` se vuelve a consultar dentro de la ventana, y desde `SEND_UNKNOWN` decide la reconciliación. Sin autorizaciones y sin esa confirmación, se vuelve a consultar dentro de la ventana. Con autorizaciones pero sin la clave consultada no se pueden atribuir al comprobante: `MANUAL_REVIEW`. | Sin conclusión |

Todo mensaje se conserva completo: identificador, mensaje, información adicional, tipo y
fase, incluidos los códigos desconocidos (CTX §32). Los errores se clasifican en transporte,
recepción devuelta, autorización, validación y consulta, siempre con el payload original.

## Resiliencia

La implementa `add-sri-transmission` (cambio 7).

- Timeouts: de conexión corto y de petición controlado, ambos configurables (CTX §33).
- Las consultas se reintentan; el envío nunca se reintenta a ciegas: primero se reconcilia.
- Circuit breaker por servicio y ambiente del SRI; mientras está abierto, los jobs se reprograman sin llamar ni consumir intentos, y la métrica `sri_circuit_open` lo muestra.
- La autorización puede tardar hasta 24 horas desde `RECIBIDA` (CTX §23.1): es la ventana de conclusión por defecto (`SRI_CONCLUSION_WINDOW_HOURS`), y al agotarla sin conclusión el comprobante pasa a `MANUAL_REVIEW` (design D4).
- Un comprobante por envío, sin lotes, y nunca uno que supere el límite de tamaño versionado (CTX §29); su cifra exacta en bytes espera la fuente oficial (Q-47, compuerta previa a la transmisión real) y, mientras tanto, ningún envío sale.
- La caída del SRI no afecta la consulta local ni la emisión hasta `SIGNED` (ERS RNF-004).

| Caso de recuperación (CTX §52)                       | Mecanismo                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| A — timeout al enviar                                | `SEND_UNKNOWN`, consulta por clave, reenvío del mismo XML solo si el SRI no la conoce. |
| B — error 70                                         | `SEND_UNKNOWN` y reconciliación por clave; reenvío de los mismos bytes solo si la reconciliación lo determina. |
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

- Conjunto probatorio por comprobante según CTX §31, guardado mediante el puerto de almacenamiento, en PostgreSQL al inicio (ADR 0010). El XML firmado lo guarda el cambio 6 con sus bytes exactos y metadatos. En el cambio 7, cada respuesta original del SRI queda asociada a su intento, y el XML autorizado es un artefacto propio que nunca reemplaza al firmado. Cada artefacto se escribe una vez y guarda su hash. Antes de enviar o descargar se recalcula el hash, y si no coincide se alerta (ERS RF-407).
- El XML autorizado se extrae de la respuesta del SRI, nunca se reconstruye (CTX §45).
- El RIDE se genera una vez tras la autorización, desde el `AUTHORIZED_XML` y metadatos inmutables (autorización, denominaciones del snapshot y logo de su versión de configuración), nunca desde datos vigentes. Muestra el ambiente de Pruebas cuando aplica y registra la versión del renderer. Se guarda como artefacto inmutable con su SHA-256, y toda descarga o impresión usa esos mismos bytes (ADR 0022, spike S-4).
- Cada entrega observable queda registrada (`DOWNLOAD` o `PRINT_REQUESTED`), sin afirmar que se imprimió o que el receptor la recibió; el correo es P1 (Q-24). Un fallo de entrega no cambia el estado fiscal (CTX §46).

## API de emisión

- Recursos por tipo de comprobante; la factura bajo `/api/v1/invoices` (Q-29), con las rutas de "Implementación de `add-invoice-emission`". La empresa y el ambiente salen del contexto autenticado y de la configuración vigente, nunca de la ruta ni del cliente. Los pasos internos (XML, firma, clave, envío) no son endpoints. La descarga de XML y RIDE llega con su cambio. El cambio 7 transmite con jobs y no expone endpoints de envío ni de SOAP: añade el historial de la transmisión y la reconciliación del administrador ("Implementación de `add-sri-transmission`", CTX §40).
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
