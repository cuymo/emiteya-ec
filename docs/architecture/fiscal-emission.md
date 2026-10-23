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
| 5 | Firma con la firma vigente, vuelve a validar el XML firmado contra el XSD y persiste sus bytes exactos con su hash, en la misma transacción que la transición, la auditoría y el job `sri.transmit` (ADR 0004, ADR 0010). La política de tamaño la comprueba la transmisión antes de cada envío (BR-26, Q-47 resuelta por política de producto). | `SIGNED` |
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
- **Límite de tamaño.** Es la política conservadora de EmiteYa, `PRODUCT_CONSERVATIVE_POLICY_V1`, una constante del código (`fiscal/domain/transmission-size-policy.ts`). Q-47 quedó resuelta por política de producto el 2026-10-09 (`adopt-conservative-sri-transmission-size-policy-v1`).
  - Todo envío individual, en Pruebas y en Producción, debe medir menos de 40 000 bytes en el XML firmado, su base64 y el cuerpo SOAP, medidos sobre el cuerpo que se construye una sola vez y se envía tal cual.
  - No es el límite oficial del SRI: la ficha dice «320 Kb» sin definir la unidad ni la representación.
  - Al excederla, la transmisión se detiene antes de la red sin recortar el comprobante.
  - Los límites de recursos de los borradores no garantizan que un comprobante sea transmisible.
  - En el cambio 7 (2026-10-04) era una política versionada de `fiscal-catalogs` que nunca se publicó; se retiró junto con la sesión de certificación.
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
| Aritmética fiscal exacta y materialización HALF_UP | `fiscal/domain/document-amounts.ts` (reexportada por `invoices/domain/amounts.ts`, `add-purchase-settlements` design D8), sobre `platform/decimal` |
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
| `POST /api/v1/invoices/drafts/preview` | Vista previa de un contenido sin guardarlo, con la evaluación de la emisión; no crea ni cambia borradores | `invoices.draft` |
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
| Casos especiales | `SPECIAL_CASE_UNSUPPORTED`, con la regla compartida de `fiscal/domain/special-cases.ts` (`block-unsupported-special-cases-before-emission`): el anexo 24 con la empresa declarada gran contribuyente (factura, liquidación de compra, nota de crédito y nota de débito) y el anexo 26 con un RUC proveedor distinto del propio (los seis tipos), siempre antes de reservar |
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
| Política de tamaño | `fiscal` (constante `PRODUCT_CONSERVATIVE_POLICY_V1`, no un catálogo) |
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
  | `TRANSMISSION_SIZE_POLICY_EXCEEDED` | El XML firmado, su base64 o el SOAP llegan a los 40 000 bytes de la política conservadora. No se envía, sin intento con el SRI ni transición. |
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
| Decisiones del cambio 7 | Límite de tamaño | Hoy es la política conservadora `PRODUCT_CONSERVATIVE_POLICY_V1`: menos de 40 000 bytes en el XML firmado, su base64 y el SOAP, en Pruebas y en Producción (Q-47 resuelta por política de producto, `adopt-conservative-sri-transmission-size-policy-v1`). |
| Decisiones del cambio 7 | API orientada a la factura | Historial y reconciliación del administrador; ninguna ruta de envío ni de SOAP. |
| `add-invoice-emission` | Envía siempre los mismos bytes | El envío y el reenvío usan el `SIGNED_XML` persistido; nunca se regenera. |

## Borradores en las listas (`unify-drafts-into-document-lists`)

Cada tipo de comprobante lista sus borradores en su propia tabla, sin un destino aparte.

- **API.** `GET /<prefijo>/entries` en facturas, notas de crédito, notas de débito, liquidaciones de
  compra, retenciones y guías de remisión. Devuelve entradas `{ kind: "DRAFT", draft }` o
  `{ kind: "DOCUMENT", document }` con las vistas de resumen de siempre. Las listas
  `GET /<prefijo>` y `GET /<prefijo>/drafts` no cambian.
- **Orden y paginación.** Los borradores ocupan las primeras posiciones (el último editado arriba)
  y los emitidos las siguientes, con un total exacto. `draftsFirstPage`
  (`backend/src/platform/pagination/drafts-first.ts`) arma cada página con la paginación de las
  dos listas: una página de borradores y como mucho dos de emitidos.
- **Filtros.**
  - `state=DRAFT` deja solo los borradores; un estado emitido y «Requiere atención» los excluyen.
  - La causa de las notas de crédito y el período de las retenciones filtran también los
    borradores; la causa de las notas de débito los excluye.
  - La búsqueda los encuentra por el tercero o por la factura modificada que muestran. Recorre en
    memoria los 500 borradores más recientes del tipo (`DRAFT_SEARCH_LIMIT`).
- **Permisos.** La ruta exige el permiso de consulta del tipo. Los borradores aparecen solo con el
  de borrador (`authorizer.allows`, sin evento de seguridad).
- **Pantallas.**
  - El borrador muestra «Borrador» en la columna del número, con enlace a su editor, y la insignia
    neutra `DraftStateBadge`.
  - Su total previo va en verde, o «Incompleto».
  - Muestra «Editado» con su fecha y hora (`features/documents/draft-entries.tsx`).
  - Sus acciones son «Continuar» y «Eliminar borrador», con confirmación.
  - El filtro de estado ofrece «Borradores» (`?estado=borradores`) justo después de «Todos».

## Lista de facturas (`productize-invoice-list-and-shared-table-foundation`)

`frontend/src/features/invoices/invoices-screen.tsx` compone la base de listas (`data-tables.md`) sobre `GET /api/v1/invoices/entries`: los borradores primero y después las facturas emitidas (`unify-drafts-into-document-lists`, ver «Borradores en las listas» más abajo).

- **Encabezado.** `PageHeader` con «Facturas» y «Nueva factura» como única acción principal, hacia `/borradores/nuevo`, solo con `invoices.draft`.
- **Vistas y estado.** Vistas «Todas» y «Requiere atención» (`vista=atencion`, `attention=true`) y un filtro «Estado» de opción única con «Borradores» (`estado=borradores`, `state=DRAFT`) y los ocho estados del glosario (`estado=procesando`, `firmadas`, `verificando`, `recibidas`, `devueltas`, `autorizadas`, `no-autorizadas` y `revision`), que se combina con la vista como en el servidor. `estado=atencion`, de los enlaces anteriores, abre la vista y se reescribe.
- **Conteo de atención.** Una consulta `attention=true&pageSize=1` lee `meta.total`, con su propia clave: cuenta toda la empresa con la semántica vigente (`SEND_UNKNOWN`, `MANUAL_REVIEW` o transmisión detenida) y no se repite al cambiar la página, las filas, el estado ni la búsqueda.
- **Búsqueda.** «Número, comprador o identificación», lo que busca el servidor, con 300 ms de espera, hasta 100 caracteres y de vuelta a la primera página.
- **URL.** `vista`, `estado`, `q`, `pagina` y `filas` (`useListUrlState`). Los valores no válidos se ignoran, y una página posterior a la última lleva a la última.
- **Columnas.** Factura (número enlazado, fecha y marcas), Estado (`StateCell`), Comprador e identificación, Total y el menú de acciones. Sin orden por columna: el servidor entrega primero las más recientes. Por debajo de 640 px de contenedor (`@table-wide`), la misma tabla pasa a dos columnas (identidad, comprador y estado; total, fecha y menú).
- **Marcas.** La de atención es un punto con el nombre «Requiere atención», con la misma regla que el servidor. La de ambiente aparece solo si el ambiente de la factura difiere del vigente de la empresa: «Pruebas» con «sin validez tributaria», neutra, o «Producción» como contexto, nunca en verde. Si el vigente no se confirma no hay ambiente con el que coincidir, así que cada fila indica el suyo («Pruebas» con «sin validez tributaria» o «Producción» como contexto), tomado solo del dato de la factura. El estado y el ambiente son independientes: una factura autorizada en Pruebas sigue sin validez tributaria.
- **Apertura y acciones.** El número es un enlace real; el clic en una zona no interactiva de la fila abre la factura, salvo con modificadores, una selección de texto o desde un control. El menú de la fila («Acciones de la factura …») tiene solo «Ver factura» y «Copiar número», que copia el número visible y lo confirma. Sin acciones fiscales, sin «Descargar RIDE» y sin consultas por fila: el RIDE y las notas siguen en el detalle.
- **Estados.** Esqueleto sin cifras de paginación, vacío inicial con «Nueva factura» en `outline`, vacío por filtros que los nombra y ofrece «Limpiar filtros», y error con «Intentar de nuevo», todo dentro de la superficie de la tabla.
- **Brechas del backend.** En `../quality/technical-debt.md`.

## Editor de facturas

`frontend/src/features/invoices/draft-editor.tsx` (`/borradores/nuevo` y `/borradores/{id}`) compone
la base de formularios (`component-system.md`) sobre las rutas de borradores, la vista previa sin
guardar y la emisión. Rediseño pedido por el propietario (2026-10-16): el recorrido es el de la
persona, comprador, productos, pago, total y emitir, no el técnico de guardar para calcular.

- **Lugar.** Pertenece a Facturas antes y después del primer guardado; las migas van en la barra
  superior («Inicio / Ventas / Facturas / Nueva factura»). El título es «Factura», con el badge
  «Nueva» hasta el primer guardado y «Borrador» después (`EditorTitle`, decisión del propietario,
  2026-10-22, como en los demás editores). Guardar no vuelve a montar el editor: lleva la
  versión guardada en su estado y, en un borrador nuevo, cambia la dirección a `/borradores/{id}`
  con `window.history.replaceState`.
- **Vista previa en vivo.** Mientras se escribe, el editor pide `POST /api/v1/invoices/drafts/preview`
  con el contenido válido, 350 ms después del último cambio, y conserva la anterior atenuada mientras
  llega la nueva («Actualizando»). Es la misma evaluación de la emisión y no guarda nada. El navegador
  no calcula impuestos ni totales; solo suma los importes que se reparten entre varias formas de pago
  para decir cuánto falta. Una forma de pago todavía sin elegir no detiene la vista previa.
- **Secciones.**
  - **Datos de la factura,** sin título visible (el de la página ya dice «Factura»; la sección sigue
    nombrada para la asistencia). El comprador es una ficha, no un campo (decisiones del propietario,
    2026-10-22): a la izquierda, el ícono de la persona (azul con comprador, gris sin él); su nombre
    y su identificación con el tipo («Cédula …», «RUC …», «Consumidor final · …»); y a la derecha
    «Cambiar» o «Elegir comprador», los dos en el azul primario. Antes de ellos, «Consumidor final»
    lo elige en un clic, salvo que ya sea el comprador. En el selector de comprador, el consumidor
    final va primero con un degradado azulado suave y su título en azul (`QuickOption.highlight`).
    Todos los botones del editor llevan su ícono. El
    establecimiento y el punto van en dos selectores lado a lado, y el punto se elige entre los del
    establecimiento elegido (decisión del propietario, 2026-10-17). Con un solo establecimiento,
    este queda elegido; al cambiarlo, uno con un solo punto disponible lo elige y otro vacía el
    punto. Con un solo punto en la empresa, los dos se muestran como datos, sin selectores. Los
    problemas del servidor sobre el comprador (`BUYER_*`) y el punto (`EMISSION_POINT_*`) van junto
    a su dato.
  - **Productos.** Sin productos, un vacío con «Agregar producto»; con productos, la misma acción en
    el encabezado; las dos en el azul primario. «Agregar producto» abre una tabla de los productos
    activos (`ProductPickerDialog`, `product-picker-dialog.tsx`) con búsqueda, filtro por tipo y
    paginación, donde se marcan varios con sus casillas, también en páginas distintas; «Agregar N
    productos» los suma como líneas en el orden en que se eligieron, y el foco va a la cantidad de la
    primera. Con productos, una fila de encabezados desde 40rem de contenedor: producto (con su código
    en monoespaciada), cantidad compacta, precio unitario (solo lectura), descuento en USD, IVA (una
    etiqueta en el tono informativo) y subtotal del servidor en verde, con los números a la derecha.
    Quitar una línea no pide confirmación (el aviso ofrece «Deshacer») y su botón va en rojo. Se
    acepta la coma decimal («1,5»).
  - **Formas de pago,** cuando ya hay algún producto, sin título visible (el de la sección queda
    para la asistencia: cada campo lleva su etiqueta) y con la forma de pago y el importe en cuatro
    quintos y un quinto (decisión del propietario, 2026-10-22). Con una, su importe es el total de
    la factura en un campo deshabilitado, sin pedirlo. «Dividir el pago», un botón punteado alto a
    todo el ancho que al pasar el ratón toma un degradado azulado, agrega otra: cada una lleva su
    importe; en la etiqueta de la primera «Forma de pago», la ayuda («Reparte el total entre las
    formas de pago.») va en su tooltip y una insignia dice cuánto falta (en el tono de aviso), cuánto
    sobra (en rojo) o que el pago cubre el total (en verde); una forma de pago sin importe ofrece
    «Asignar lo pendiente». Una forma de pago
    nueva propone lo que falta si las demás ya llevan su importe. Cada una muestra su nombre corriente
    («Efectivo», «Tarjeta de crédito») y, como detalle, «SRI 01 · Sin utilización del sistema
    financiero». Al volver a una sola, su importe vuelve a ser el total.
- **Resumen,** en un carril fijo de 20rem al lado desde 57,5rem de contenedor: el número de
  productos, el subtotal sin impuestos, el descuento (en rojo y con su signo cuando lo hay), cada IVA
  y el total destacado en verde; al dividir el pago, lo asignado y lo pendiente. Los importes del
  editor van con «$», como en tablas y detalles. Debajo, «Para emitir» con lo que falta en ámbar
  (comprador, punto de emisión, productos, forma de pago), los problemas generales en «Antes de emitir», y el estado del
  guardado junto al título del resumen: «Sin guardar», «Guardando…» o «Guardado», en texto neutro.
- **Emitir y guardar.**
  - «Emitir factura» es la acción principal; «Guardar borrador», secundaria (principal sin
    `invoices.emit`, que no muestra emitir).
  - Emitir está disponible con el contenido completo, la vista previa al día y sin problemas. No pide
    guardar antes: si hay cambios o no hay borrador, la confirmación guarda primero y emite esa
    versión. La `Idempotency-Key` es una por versión: un reintento de la misma versión la repite.
  - Mientras no está disponible, dice qué falta en un texto asociado con `aria-describedby`.
  - Guardar está disponible siempre salvo durante un guardado o una emisión, que dejan el
    formulario sin edición (un `fieldset` deshabilitado). Ctrl/⌘ + S guarda.
  - Un conflicto de versión ofrece «Recargar borrador», que trae la versión vigente sin perder el
    editor.
- **Acciones,** al pie del resumen cuando va al lado y, apilado, en una barra fija al pie con el
  total, con el alto reservado para que el foco no quede debajo.
- **Ambiente** (design D21). Además de la franja global de Pruebas, `EmissionEnvironmentNotice` va
  encima de las acciones y en la confirmación: «Pruebas · esta factura no tendrá validez tributaria»,
  «No pudimos confirmar el ambiente…», o nada en Producción, que la confirmación muestra como
  contexto.
- **Confirmación.** Reserva el número y firma, no se puede deshacer, y muestra el comprador con su
  identificación, los productos, el pago, el ambiente y el total, con el aviso de consumidor final
  cuando aplica. Una confirmación repetida no envía una segunda solicitud.
- **Salir con cambios.** Mientras haya cambios, cerrar o recargar la pestaña pide confirmación
  (`beforeunload`), que se retira en cuanto el servidor confirma el guardado. El punto
  predeterminado de un borrador nuevo es su punto de partida, no un cambio. La navegación interna no
  se intercepta: el App Router no ofrece un bloqueo fiable (brecha en
  `../quality/technical-debt.md`).
- **Estados.** El borrador de otra empresa es, para esta, inexistente (`404`): «El borrador no
  existe», sin ningún dato. La carga y el error usan el mismo encabezado y la misma distribución.

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

Cambio 10, archivado el 2026-10-05.

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
- **Nueva nota sobre la lista** (decisión del propietario, 2026-10-22): «Nueva nota de crédito» (`useNewCreditNote`, `new-credit-note.tsx`) abre el selector de facturas elegibles encima de la tabla, sin cambiar de página; elegir una lleva al editor con `?factura={id}` y cerrarlo sin elegir deja la lista. La creación rápida llega con `/notas-credito?nueva=1`, que abre lo mismo; `/notas-credito/borradores/nueva` sin `?factura` redirige allí (`next.config.ts`).
- **Borrador** (`/notas-credito/borradores/nueva?factura={id}`, desde la lista o desde la factura, y `/notas-credito/borradores/{id}`, `creditNotes.draft`): `credit-note-draft-editor.tsx`. «Factura que se modifica» se titula como la etiqueta de un campo y «Causa y motivo» no tiene título visible; el motivo es un `SingleLineTextarea` con su cuenta; y el motivo por el que todavía no se puede emitir va centrado debajo de «Guardar borrador» (decisiones del propietario, 2026-10-22). «Cambiar factura» abre el mismo selector encima del editor: cancelarlo conserva la factura y elegir otra la cambia en la dirección. La causa, en un control segmentado a todo el ancho, empieza en «Devolución» en una nota nueva (decisión del propietario, 2026-10-22); la factura que se modifica lleva su ícono grande y su total en verde, con «Cambiar factura» en el azul primario; el establecimiento y el punto van en los selectores dependientes `EstablishmentPointFields`, mitad y mitad; los botones llevan su ícono y los importes van con «$». La devolución elige líneas y cantidades y la anulación total no; el retorno físico se deshabilita con su explicación en las líneas que no afectaban al inventario o sin salida por devolver. Los importes y los problemas son la vista previa del servidor del borrador guardado. "Emitir nota de crédito" (`creditNotes.emit`) pide en un `ConfirmDialog` las dos declaraciones como casillas separadas, con su texto, su contexto y su fuente; sin ambas no se confirma. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/notas-credito/{id}`): `credit-note-detail.tsx`, con el reintento de la firma (`creditNotes.retrySigning`), la transmisión y los documentos compartidos, la factura modificada, las líneas con su retorno físico y las declaraciones "declaradas por" el usuario.
- **Factura:** su detalle muestra el crédito aplicado, reservado y disponible (`invoice-credit-section.tsx`) y "Emitir nota de crédito" cuando la factura no es a consumidor final, tiene valor acreditable y el usuario puede preparar notas.

## Implementación de `add-debit-notes`

Cambio 11, archivado el 2026-10-05.

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
- **Secuencial propio.** La nota de débito reserva el secuencial del tipo `05` en el ámbito del punto (ambiente, establecimiento y punto), como la factura (`01`) y la nota de crédito (`04`): `test/integration/debit-note-sequences.test.ts` emite factura, nota de crédito, nota de débito y factura, y después nota de débito, nota de crédito y factura, y comprueba que cada tipo sigue su contador sin huecos ni cruces en el número, la columna, la clave de acceso y el XML firmado.

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
- **Nueva nota sobre la lista** (decisión del propietario, 2026-10-22): «Nueva nota de débito» (`useNewDebitNote`, `new-debit-note.tsx`) abre el selector de facturas elegibles encima de la tabla; elegir una crea el borrador (`POST /debit-notes/drafts`) y abre su editor, y un error se avisa sin dejar la lista. La creación rápida llega con `/notas-debito?nueva=1`; `/notas-debito/borradores/nueva` sin `?factura` redirige allí.
- **Nueva nota desde la factura** (`/notas-debito/borradores/nueva?factura={id}`, `debitNotes.draft`): `NewDebitNoteDraftScreen` muestra la factura para confirmarla con "Preparar nota de débito" u "Elegir otra factura" en el mismo selector; preparar crea el borrador y reemplaza la página por su editor, así volver no ofrece prepararla otra vez. Los tratamientos que se ofrecen son los de la factura y los devuelve la vista previa del servidor, no el cliente.
- **Borrador** (`/notas-debito/borradores/{id}`, `debitNotes.draft`): `DebitNoteDraftScreen`. En orden (decisión del propietario, 2026-10-22): la factura que se modifica (su total en verde y sus tratamientos como etiquetas), el establecimiento y el punto en dos selectores dependientes lado a lado (`EstablishmentPointFields`, `establishment-point-fields.tsx`; con un solo punto, como datos), los conceptos y la forma de pago. Conceptos en una lista ordenada con agregar (`AddRowButton`, el mismo botón punteado y alto de «Dividir el pago», con su degradado azulado al pasar el ratón; el foco va a la descripción nueva) y quitar (en rojo; el foco vuelve a "Agregar concepto"); cada concepto en dos columnas, 10 % y 90 % (decisiones del propietario, 2026-10-22): en la primera, «Concepto N» vertical en azul sobre una franja con un degradado azul discreto (en un teléfono, horizontal arriba); en la segunda, sus campos, con quitar el concepto (en rojo) junto al tratamiento; la nota de los conceptos va en el tooltip de su título, «Factura que se modifica» se titula como la etiqueta de un campo, «Establecimiento y punto de emisión» no tiene título visible y el motivo por el que todavía no se puede emitir va centrado debajo de «Guardar borrador»; por concepto, la causa, el importe y el tratamiento en una fila de tres columnas desde 36rem de campos (por debajo, apilados): la causa en un `Select`, con «Intereses de mora» elegida en un concepto nuevo; el tratamiento en un `Select` con los de la factura, tenga uno o varios; debajo, la descripción en un área de texto de tres líneas que se puede agrandar, con su cuenta «N/300», donde Enter no parte la línea y los saltos pegados se vuelven espacios. La factura que se modifica lleva su ícono grande en un círculo azul; nombrado "IVA 15 %" cuando su denominación oficial es solo un porcentaje (`debit-note-format.ts`), como en la nota de crédito. La forma de pago es un `Select` de las entradas utilizables del catálogo `payment-method`, sin título visible de su sección (la etiqueta del campo ya lo dice, como en la factura); una guardada que dejó de serlo se muestra como no disponible y la vista previa lo explica. Los importes (bases e impuestos por tratamiento, valor total y la forma de pago con su total) y los problemas, junto a su concepto o en el resumen, son la vista previa del servidor del borrador guardado. "Emitir nota de débito" (`debitNotes.emit`) pide en un `ConfirmDialog` el resumen y la declaración como casilla, con su texto, su contexto, su fuente y el aviso de que es una declaración del usuario; sin ella no se confirma. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión.
- **Detalle** (`/notas-debito/{id}`, `debitNotes.read`): `debit-note-detail.tsx`, desde el snapshot de la nota: estado, número y valor total; la factura modificada con su enlace; los conceptos con su causa, su descripción, su importe y su tratamiento; las bases e impuestos por tratamiento y el valor total; la forma de pago con su total; la declaración "declarada por" el usuario, que el sistema no puede comprobar; el diagnóstico y el reintento de la firma (`debitNotes.retrySigning`); la transmisión con la reconciliación (`debitNotes.reconcile`) y los documentos compartidos.
- **Factura:** su detalle muestra "Emitir nota de débito" (`invoice-debit-note-action.tsx`, enlace a `/notas-debito/borradores/nueva?factura={id}`) cuando la factura está autorizada, no es a consumidor final, es del ambiente vigente y el usuario tiene `debitNotes.draft`. Es presentación: la API vuelve a comprobar la elegibilidad al crear el borrador y al emitir.

## Implementación de `add-withholding-receipts`

Cambio 12, archivado el 2026-10-06.

### Cálculo, evaluación y snapshot de la retención

- **Una primitiva versionada.** `calculateWithholdingAmounts` (`withholding-receipts/domain/amounts.ts`, versión de cálculo `1`) recibe cada retención con su base y el porcentaje de su entrada del catálogo, y devuelve la base a 2 decimales, el porcentaje en su forma canónica (`1.75`, `10`, `100`), el valor retenido `round(base × porcentaje / 100)` con HALF_UP a 2 decimales, una sola vez por retención, y el total retenido como suma exacta. La vista previa, el snapshot, el XML y el RIDE usan ese resultado; ninguno calcula. 100.29 al 1.75 % retiene 1.76, 0.03 al 2 % retiene 0.00, y la retención en cero (código 7) retiene 0.00 de forma explícita.
- **Evaluación.** `evaluateWithholdingReceipt` (`withholding-receipts/domain/evaluation.ts`) es pura e informa los problemas en el orden de la design D15: sujeto (existe, activo, no es el consumidor final, con RUC, cédula o pasaporte y con el rol de proveedor) y parte relacionada; período (`MM/AAAA`, no posterior al mes de emisión, con el aviso que no bloquea si difiere); límites de recursos; por documento, el tipo del MVP, el sustento compatible y vigente, el número, la fecha (no posterior a la emisión), la autorización, los totales, los impuestos declarados (con el código de porcentaje vigente en la fecha del documento, la tarifa del catálogo para el IVA y declarada para ICE e IRBPNR, y el IVA diferenciado rechazado) y las formas de pago utilizables; por retención, el impuesto (renta o IVA), la entrada soportada, vigente y habilitada, y la base; el cálculo; y el contribuyente especial compatible (3 a 5 caracteres). Cada problema lleva la posición del documento y, dentro de él, la del impuesto, el pago o la retención. Los importes declarados se transcriben sin sumas ni comparaciones.
- **Lo que la evaluación nunca hace.** No agrega retenciones que el usuario no eligió (ni el código 7 ni el 8), no convierte el código 8 en una retención del 0 % (`WITHHOLDING_IVA_CODE_NOT_SUPPORTED`) y no corrige el período.
- **Snapshot.** `buildWithholdingSnapshot` (`withholding-receipts/domain/build-snapshot.ts`, `snapshotVersion` 1) congela el sujeto, la parte relacionada como `USER_DECLARED` (nunca verificada) con quien la declaró, el período, cada documento con sus impuestos, pagos y retenciones anidadas y sus referencias de catálogo (`catalogType`, `entryKey`, `versionId`, `datasetVersion`), la versión del cálculo, el total retenido y los catálogos usados.
- **Pruebas.** `backend/test/withholding-receipts/amounts.test.ts` (golden de la design D13 y property tests con generador determinista), `evaluation.test.ts` (cada rechazo con su posición, sobre los datasets instalados) y `snapshot.test.ts`.

### Borradores, vista previa, proveedores y opciones de la retención

- **Borradores** (`createWithholdingDrafts`, `withholding-receipts/application/drafts.ts`): `GET/POST /api/v1/withholding-receipts/drafts` y `GET/PUT/DELETE /api/v1/withholding-receipts/drafts/{id}` (`withholdings.draft`). Un borrador nuevo sin período toma el mes de hoy en Ecuador. Se guardan incompletos, con los documentos sustento en `supports` (`JSONB`), con versión y sin auditoría; los límites de recursos configurados (`WITHHOLDING_MAX_*`) se aplican al guardar (`409 WITHHOLDING_RESOURCE_LIMIT`, una defensa del sistema), un proveedor de otra empresa es `404 WITHHOLDING_SUBJECT_NOT_FOUND` y un punto de otra empresa `400 EMISSION_POINT_NOT_FOUND`.
- **Vista previa.** Cada consulta recalcula la evaluación con la fecha del día (`loadWithholdingContext`, `application/context.ts`): las retenciones con el código, la denominación, el porcentaje y el valor del servidor, el total retenido, el aviso del período distinto del mes de emisión y los problemas con su posición. Las retenciones válidas se calculan aunque otras no lo sean; el total aparece solo si todas se calculan.
- **Proveedores:** `GET /api/v1/withholding-receipts/suppliers` (`withholdings.draft`), sobre el puerto `WithheldPartyReader` que `main.ts` compone con `supplierReader` de `parties`: solo proveedores activos con RUC, cédula o pasaporte, sin el consumidor final.
- **Opciones:** `GET /api/v1/withholding-receipts/options` (`withholdings.draft`, `createWithholdingOptions`): los impuestos a retener, los conceptos de renta y los códigos del IVA utilizables (soportados, vigentes y habilitados), los tipos de documento del MVP con sus sustentos compatibles y vigentes, los códigos de porcentaje de IVA, ICE e IRBPNR con todas sus vigencias (sin el IVA diferenciado), las formas de pago habilitadas de la empresa y los límites efectivos.

### Emisión de la retención

- **Comprobaciones previas** (`createWithholdingEmission`, `withholding-receipts/application/emission.ts`), fuera de la transacción y en el orden de la design D15: permiso `withholdings.emit`, `Idempotency-Key`, el borrador de la empresa, la huella y la repetición, los archivos del esquema y la evaluación completa con la fecha de emisión (la de hoy en Ecuador, capturada una vez). Un rechazo no consume secuencial, clave, firma ni llamada al SRI; la prueba negativa sin documentos ni retenciones lo comprueba.
- **Transacción de `RESERVED`** (`createWithholdingEmissionUnitOfWork`): borrador bloqueado, configuración bloqueada, el tercero y los catálogos leídos y evaluados otra vez con la fecha de la reserva, el snapshot, `reserveDocumentIn` con el tipo `07` (la columna `total` del comprobante es el total retenido y el receptor es el sujeto), el registro del comprobante con sus líneas (`withholding_receipt` y `withholding_receipt_line`), el borrador `EMITTED`, el registro de idempotencia y `withholding_receipt.reserved`. Sin I/O externo y sin recursos compartidos que bloquear, porque los documentos sustento son externos: dos retenciones simultáneas al mismo proveedor son válidas. Un fallo en cualquier paso no deja nada (`withholding-atomicity.test.ts`). Después del commit, la firma compartida con el perfil de la retención.
- **Idempotencia.** Operación `withholding_receipt.emit`, sin TTL. La huella (`withholdingFingerprint`) cubre el borrador, su versión y los datos funcionales de esa versión: proveedor, parte relacionada, período, punto y cada documento en orden con todos sus campos, impuestos, pagos y retenciones (impuesto, `entryKey` y base), con posiciones explícitas. Misma huella: la misma retención (`200`), y si quedó reservada se reanuda su firma; otra: `409 IDEMPOTENCY_KEY_REUSED`; el borrador ya emitido con otra clave: `409 WITHHOLDING_DRAFT_ALREADY_EMITTED`; sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.
- **Congelado.** El snapshot conserva el código, la denominación y el porcentaje de cada entrada aplicada al reservar: un cambio posterior del catálogo (otra versión del dataset o la habilitación) no cambia el XML firmado de una retención reservada que se firma después.
- **Rutas:** `POST /api/v1/withholding-receipts` (`withholdings.emit`, `201`, o `200` en la repetición) y `POST /api/v1/withholding-receipts/{id}/signing-attempts` (`withholdings.retrySigning`, `withholding_receipt.signing_retried`).
- **Códigos de rechazo** (`409`): los de la evaluación (`WITHHOLDING_SUBJECT_*`, `WITHHOLDING_RELATED_PARTY_REQUIRED`, `WITHHOLDING_FISCAL_PERIOD_*`, `WITHHOLDING_SUPPORTS_REQUIRED`, `WITHHOLDING_SUPPORT_*`, `WITHHOLDING_ITEMS_REQUIRED`, `WITHHOLDING_TAX_NOT_SUPPORTED`, `WITHHOLDING_CONCEPT_NOT_SUPPORTED`, `WITHHOLDING_IVA_CODE_NOT_SUPPORTED`, `WITHHOLDING_ENTRY_NOT_USABLE`, `WITHHOLDING_BASE_INVALID`, `WITHHOLDING_AMOUNT_OUT_OF_RANGE`, `WITHHOLDING_RESOURCE_LIMIT`, `WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE`), los del borrador (`WITHHOLDING_DRAFT_INCOMPLETE`, `WITHHOLDING_DRAFT_CHANGED`, `WITHHOLDING_DRAFT_ALREADY_EMITTED`) y los compartidos de la emisión; los recursos inexistentes o de otra empresa son `404` (`WITHHOLDING_RECEIPT_NOT_FOUND`, `WITHHOLDING_DRAFT_NOT_FOUND`, `WITHHOLDING_SUBJECT_NOT_FOUND`).
- **Métricas:** `withholding_receipt_reservations_total` y `withholding_receipt_items_total{tax}` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.
- **Secuencial propio.** La retención reserva el secuencial del tipo `07` en el ámbito del punto: `test/integration/debit-note-sequences.test.ts` emite factura, nota de crédito, nota de débito, retención y factura, y después retención, nota de débito, nota de crédito y factura, y comprueba que cada tipo sigue su contador sin huecos ni cruces en el número, la columna, la clave de acceso y el XML firmado.

### XML y firma de la retención

- **Builder propio.** `createWithholdingReceiptXmlBuilder` (`sri-engine/infrastructure/withholding-receipt-xml-builder.ts`, versión de builder `1`) escribe `comprobanteRetencion` 2.0.0 desde la proyección del snapshot (`toWithholdingReceiptXmlSnapshot`, `withholding-receipts/application/xml-snapshot.ts`), en el orden del XSD, con `infoTributaria` (`codDoc` 07, `agenteRetencion` y `contribuyenteRimpe` cuando corresponden), `xml-writer.ts` y el texto decimal exacto del snapshot. No usa el builder de alto nivel de la dependencia.
- **Contenido.** `infoCompRetencion` con `fechaEmision`, `dirEstablecimiento`, `contribuyenteEspecial` cuando la empresa lo tiene, `obligadoContabilidad`, el tipo de identificación del sujeto, `parteRel` (la declaración del usuario), su razón social, su identificación y `periodoFiscal`. En `docsSustento`, un `docSustento` por documento con `codSustento`, `codDocSustento`, `numDocSustento`, `fechaEmisionDocSustento`, `numAutDocSustento` si se declaró, `pagoLocExt` 01, `totalSinImpuestos`, `importeTotal`, sus `impuestosDocSustento` (código 2, 3 o 5, código de porcentaje, base, tarifa y valor declarados, en su orden), sus `retenciones` anidadas (`codigo` 1 o 2, `codigoRetencion` literal, base, porcentaje en forma canónica y valor retenido) y sus `pagos`.
- **Códigos del documento sustento.** `codDocSustento` es el código fiscal de dos caracteres del snapshot (`01`, `02`, `03`), nunca un número: el builder rechaza un código que no tenga dos dígitos, y los golden verifican literalmente `<codDocSustento>01</codDocSustento>`, `02` y `03`. `codSustento` lleva los dos dígitos literales de la tabla 5.
- **Lo que no escribe:** `tipoSujetoRetenido`, `fechaRegistroContable`, `tipoRegi`, `paisEfecPago`, `aplicConvDobTrib`, `pagExtSujRetNorLeg`, `pagoRegFis`, los totales de reembolso, `reembolsos`, `dividendos`, `compraCajBanano`, `maquinaFiscal` ni `infoAdicional` (el anexo 10 lo marca "Opcional").
- **Firma.** `withholdingReceiptSigningProfile` registra el builder en la firma compartida y la auditoría `withholding_receipt.signed`; el firmador recibe el tipo `07` (`COMPROBANTE_RETENCION` en la librería) y el XML se valida contra `ComprobanteRetencion_V2.0.0.xsd` antes y después de firmar. Los golden de bytes exactos, todos válidos contra el XSD oficial, están en `backend/test/fixtures/withholding-receipt-xml/` (renta; renta e IVA; varios documentos con varias retenciones, con y sin autorización; retención en cero con el código 7; impuestos del sustento solo IVA, IVA e ICE, IRBPNR y varias entradas; caracteres especiales). Los golden de la factura y de las notas no cambian.

### Consulta, transmisión y reconciliación de la retención

- **Consulta:** `GET /api/v1/withholding-receipts` (búsqueda por número o proveedor, `state` y `fiscalPeriod` en `MM/AAAA`, que filtra por el período del registro del comprobante), `GET /api/v1/withholding-receipts/{id}` (el detalle desde el snapshot: sujeto, `parteRel` como declarada por el usuario, período, documentos sustento con sus impuestos, pagos y retenciones, total retenido, diagnóstico y transmisión) y `GET /api/v1/withholding-receipts/{id}/transmission` (el historial sin respuestas originales ni XML), con `withholdings.read`. Otra empresa u otro tipo de comprobante es `404 WITHHOLDING_RECEIPT_NOT_FOUND`.
- **Transmisión sin cambios.** Los handlers de envío, autorización y reconciliación, la cola, los clasificadores, la evidencia guardada antes de clasificar y la reclasificación de la respuesta guardada atienden el tipo `07` igual que la factura y las notas, sin cambios en el transporte (`withholding-transmission.test.ts`, con respuestas sintéticas y sin red: RECIBIDA, DEVUELTA, 70, 43 y 45, una respuesta sin estado, `NOT_SENT` que deja el comprobante firmado y reprograma el envío sin reconciliar, `SEND_UNKNOWN` con su reconciliación por clave, AUTORIZADO, NO AUTORIZADO y MANUAL_REVIEW). Los seguidores de la capacidad acreditable, de la devolución de stock y de la salida de inventario no hacen nada para una retención. `SRI_TRANSMISSION_ENABLED` sigue apagado.
- **Reconciliación manual:** `POST /api/v1/withholding-receipts/{id}/reconciliations` (`withholdings.reconcile`, solo el administrador) con la solicitud compartida `requestReconciliationIn` y la auditoría `withholding_receipt.reconciliation_requested`; la finalización se audita como `withholding_receipt.reconciliation_completed` (`COMPLETED_AUDIT` de `reconcile-handler.ts`). Un estado que no se reconcilia es `409 WITHHOLDING_NOT_RECONCILABLE` y una interacción en curso `409 SRI_INTERACTION_IN_PROGRESS`.

### RIDE de la retención

- **Lectura por raíz.** `readRideDocument` elige la lectura de `comprobanteRetencion` 2.0.0 (`readWithholdingReceipt`, `ride-source.ts`) con su propia lista blanca de los elementos que escribe el builder de la retención y el modelo `RideWithholdingReceipt`: el sujeto retenido, el período fiscal y cada documento sustento con sus impuestos declarados y sus retenciones. Información adicional, un impuesto a retener distinto de renta o IVA (ISD), un impuesto declarado distinto de IVA, ICE o IRBPNR, un tipo de documento sustento fuera del MVP, un pago al exterior, sus campos (`tipoRegi`, `paisEfecPago`…) o un bloque repetido detienen la generación (`RIDE_SOURCE_UNSUPPORTED`).
- **Denominaciones del snapshot.** El handler del RIDE lee del snapshot del comprobante `07`, sin importar `withholding-receipts`, la denominación del tipo de cada documento sustento, la del impuesto de cada retención y la de cada impuesto declarado, y las entrega como `withholdingLabels`, igual que las de las formas de pago; nunca consulta el catálogo vigente. Sin denominación, el RIDE muestra el código.
- **Distribución propia.** El renderer dibuja la retención con la distribución de la ficha v2.34, anexo 2, página 63, que la ficha manda usar para la versión 2.0.0 (página 108): "COMPROBANTE DE RETENCIÓN" con su autorización y el Code128 de su clave; el sujeto retenido con su identificación y la fecha de emisión; la tabla con las columnas Comprobante, Número, Fecha Emisión, Ejercicio Fiscal, Base Imponible para la Retención, Impuesto, Porcentaje Retención y Valor Retenido, una fila por retención con los datos de su documento, con el encabezado repetido en cada página y sin partir filas; y, como datos adicionales (anexo 2, página 60), un bloque por documento sustento con sus impuestos declarados (código, código de porcentaje, base, tarifa y valor), que nunca se parte. Sin totales: el XML no trae un total retenido y el RIDE no suma. Su versión de distribución es `retencion-1` (`WITHHOLDING_RIDE_RENDERER_VERSION`).
- **Sin cambios para los demás.** El pool, el job, el artefacto, las descargas y las entregas son los de la factura; el RIDE de la factura y el de las notas tienen los mismos golden que antes. Pruebas: `test/sri-engine/ride/ride-withholding-receipt.test.ts` (golden en `test/fixtures/withholding-receipt-ride/`, regenerables con `WITHHOLDING_RIDE_UPDATE=1`; paginación con el máximo de 30 documentos de 10 retenciones y 10 impuestos; Code128; rechazos; mismos bytes en otro proceso) y `test/integration/withholding-ride.test.ts` (el job nace con la autorización, el RIDE se guarda una vez con su procedencia y se descarga verificado).

### Bandeja con retenciones

- **Un tipo más en el registro.** `EMITTED_DOCUMENT_TYPES` incluye `07` y `DOCUMENT_KINDS` guarda su nombre en las frases ("retención", en femenino, porque `DocumentsSection` y `TransmissionSection` concuerdan sus textos en femenino y no cambian), el detalle `/retenciones/{id}`, su API `/withholding-receipts`, el permiso `withholdings.reconcile`, el código `WITHHOLDING_NOT_RECONCILABLE` y sus esquemas de vista y transmisión. El filtro "Tipo de comprobante" ofrece los cuatro tipos, con "Comprobante de retención" (`DOCUMENT_TYPE_LABELS`). La fila de una retención muestra como total el total retenido y como receptor al sujeto retenido, que el servidor ya guarda en esas columnas; las reglas de disponibilidad de los documentos siguen en el servidor (`frontend/test/documents-screen.test.tsx`, `withholding-sections.test.tsx`).

### Medición de la retención

- Con `EMISSION_STAGE_TIMINGS=1`, `POST /api/v1/withholding-receipts` devuelve sus etapas en `Server-Timing` (`total`, `reservation_tx` y las de la firma compartida: `xml`, `xsd`, `sign`, `persist`), como los demás tipos; nunca en producción.
- `bench:withholding-receipts` (design D27) mide la búsqueda de proveedores, la resolución de los catálogos, el borrador y la emisión del peor caso con los límites por defecto y con los máximos absolutos (con el CPU y la memoria residente del backend), el cálculo, la emisión en serie, la contención para un mismo proveedor y para proveedores distintos, la lista y la búsqueda y el RIDE de una retención y del máximo de filas, y termina comprobando que las retenciones no tocaron la capacidad acreditable ni el inventario (`../quality/performance.md`). Registra el tamaño del XML firmado del peor caso solo como medición de recursos, sin relación con Q-47.
- `test/integration/e2e-withholding-receipts.test.ts` recorre el flujo sobre `main.ts` con el SRI simulado: una retención de renta e IVA sobre dos facturas de un proveedor autorizada con su RIDE en la bandeja y sus documentos sustento en los XML, otra no autorizada, y la factura propia de la empresa con el mismo estado, el mismo crédito, el mismo inventario y las reconciliaciones sin diferencias.

### Pantallas de la retención

- **Retenciones** (`/retenciones`, en "Operación", `withholdings.read`): `frontend/src/features/withholding-receipts/withholding-receipts-screen.tsx`, con número, proveedor, período fiscal, total retenido y estado; búsqueda por número o proveedor, estado y período en la URL (`q`, `estado`, `periodo` como `AAAA-MM`), tarjetas por debajo de 768 px y los borradores en curso con su eliminación (`withholdings.draft`).
- **Nueva retención sobre la lista** (decisión del propietario, 2026-10-22): «Nueva retención» (`useNewWithholding`, `new-withholding.tsx`) abre el selector de proveedores (`SupplierChooser`, `supplier-chooser.tsx`, que también usa «Cambiar proveedor» en el editor) encima de la tabla; cerrarlo sin elegir ni registrar un proveedor deja la lista. Elegir el proveedor (`EntityPickerDialog` sobre `GET /withholding-receipts/suppliers`) o registrarlo con "Nuevo proveedor", que abre `PartyDialog` con el rol de proveedor marcado, crea el borrador (`POST /withholding-receipts/drafts`) con el período del mes de hoy y abre su ruta. La creación rápida llega con `/retenciones?nueva=1`; la antigua `/retenciones/borradores/nueva` redirige allí.
- **Borrador** (`/retenciones/borradores/{id}`, `withholdings.draft`): `WithholdingDraftScreen`, con las opciones utilizables de `GET /withholding-receipts/options`. Con el diseño de los demás editores (decisión del propietario, 2026-10-22): «Proveedor» titulado como la etiqueta de un campo; sin título visible «Establecimiento y punto de emisión», «Parte relacionada», «Período fiscal» ni, en cada documento, «Formas de pago» y «Retenciones»; la nota de los documentos sustento en el tooltip de su título; cada documento en un `NumberedItem`, con «Documento sustento N» en su franja y quitarlo al final de la fila del tipo; un separador entre los datos del documento, sus impuestos, sus formas de pago y sus retenciones, cada grupo con su botón de agregar; un documento nuevo empieza como factura; con cambios sin guardar, el cálculo de cada retención se oculta y «Guarda el borrador para ver el porcentaje y el valor.» va centrado debajo de «Guardar borrador», y el motivo de no poder emitir, centrado debajo de «Emitir retención»; el proveedor en una ficha con su ícono grande y «Cambiar proveedor» en el azul primario en la misma fila; el establecimiento y el punto en `EstablishmentPointFields`, mitad y mitad, antes de la parte relacionada; los controles segmentados (parte relacionada, tipo de documento, impuesto e impuesto a retener) a todo el ancho; un impuesto nuevo empieza en IVA y una retención nueva en Renta (un borrador guardado conserva lo suyo); el concepto de renta o el código del IVA y la base en una fila, mitad y mitad, con el cálculo debajo; «Agregar impuesto», «Agregar forma de pago», «Agregar retención» y «Agregar documento sustento» con `AddRowButton`; quitar en rojo; íconos en «Emitir» y «Guardar» e importes con «$», el total retenido en verde. La parte relacionada en un control segmentado Sí/No sin selección inicial, con el aviso de que es una declaración del usuario; el período con mes y año (el de emisión y los cuatro anteriores) y un aviso inmediato cuando difiere del mes de emisión; los documentos sustento (`withholding-support-card.tsx`) en una lista ordenada con agregar y quitar: el tipo en un control segmentado de tres opciones, el sustento en un `Select` filtrado por el tipo, el número con la máscara `001-001-000000001` (el borrador guarda los 15 dígitos), la fecha (`DatePickerField`, nunca posterior a la evaluación) y la autorización opcional; los totales, los impuestos (impuesto en un control segmentado IVA/ICE/IRBPNR, el código de porcentaje vigente en la fecha del documento en un `Select` para IVA e IRBPNR y en el combobox con búsqueda para los 75 códigos de ICE, la tarifa declarada solo para ICE e IRBPNR, antes de la base y el valor; con IVA la tarifa sale del código y la base y el valor ocupan la fila; sin título visible «Impuestos del documento», con su nota en el tooltip del primer «Impuesto») y los pagos (forma de pago en un `Select` y total); las retenciones con el impuesto en un control segmentado Renta/IVA, el concepto de renta en el combobox con búsqueda (el `EntityPickerDialog` sobre las opciones ya cargadas, por código o denominación) o el código de IVA en un `Select` con la nota oficial del código 7, y la base. El porcentaje y el valor retenido nunca son campos: son los de la vista previa del servidor del borrador guardado, junto a cada retención y en el resumen con el total retenido. Los problemas van junto a su documento, su impuesto, su pago o su retención, o en "Antes de emitir". "Emitir retención" (`withholdings.emit`) pide en un `ConfirmDialog` el resumen (ambiente, proveedor, período resaltado si difiere, parte relacionada, documentos y total retenido) y, si el período guardado difiere del mes de emisión, una casilla que lo confirma. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión. Los límites de recursos se presentan como límites del sistema, no del SRI.
- **Detalle** (`/retenciones/{id}`, `withholdings.read`): `withholding-receipt-detail.tsx`, desde el snapshot: estado, número y total retenido; el proveedor; cada documento sustento con su sustento, su autorización y sus retenciones (impuesto, código, denominación, base, porcentaje y valor; en tabla desde 640 px y apiladas por debajo), la nota de que es un documento declarado por el usuario que el sistema no verifica en el SRI, y plegados sus totales, impuestos y pagos declarados; la parte relacionada "declarada por" el usuario, que el sistema no puede comprobar; el diagnóstico y el reintento de la firma (`withholdings.retrySigning`); la transmisión con la reconciliación (`withholdings.reconcile`) y los documentos compartidos.
- **Catálogos fiscales** (`/configuracion/catalogos-fiscales`): cinco secciones nuevas (conceptos de renta, códigos de retención del IVA, impuestos a retener, tipos de documento sustento y sustentos tributarios) con su fuente (la ficha, o el Catálogo ATS con su fecha de actualización y el SHA-256 del archivo), la clasificación de cada entrada ("Soportada" o "Fuera de alcance") y, en las que no se eligen, su razón (por no residente, por porcentaje variable, por estructura especial excluida o por representación ambigua en la fuente: los 323 M, N, O y P quedan pendientes de evidencia y de soporte futuro; el código 8 del IVA, porque la fuente no define su representación en el comprobante), sin control de habilitación, y en cada tipo de documento sustento los sustentos que el Catálogo ATS le asigna; los conceptos de renta y los códigos de IVA soportados se habilitan por empresa (administrador). La fecha base de una entrada nombra su fuente: "ficha v2.34" o el Catálogo ATS con su publicación.
- **Navegación:** "Retenciones" en el grupo Operación (`withholdings.read`).

## Decisiones para el diseño de `add-shipping-guides`

Decididas el 2026-10-06 en la revisión de readiness del cambio 13 (Q-51, P1 a P10); el proposal y
el design del cambio las concretan. Las reglas de negocio están en `docs/product/domain-model.md`
(BR-37 y BR-76 a BR-87), con su origen oficial, de política del MVP o de defensa de recursos en
`docs/product/capabilities.md` (Trazabilidad de `shipping-guides`).

- **Documento propio sobre el pipeline existente.** La guía de remisión (`codDoc` 06, XSD `GuiaRemision_V1.1.0`, ya en el registro de esquemas y en el paquete del build) reutiliza `reserveDocumentIn`, un perfil de firma propio sobre `documentSigning.pipeline`, el registro de esquemas, el firmador, los jobs durables `sri.*`, el transporte SOAP, la respuesta guardada antes de clasificar, la reconciliación, el archivo, el job y el pool del RIDE y el historial de entregas. No hay un pipeline paralelo; por tipo quedan su borrador, su evaluación, su snapshot, su builder `guiaRemision` 1.1.0 y la distribución de su RIDE.
- **Secuencial propio.** Su contador `06` existe desde `add-fiscal-numbering`; una prueba demuestra que reservar 01, 04, 05, 07 y 06 en el mismo punto de emisión no altera ningún otro contador.
- **Sustento tipado por destinatario (P1, P2).** `INTERNAL_INVOICE` referencia una factura propia de la misma empresa y del mismo ambiente, en `AUTHORIZED` e íntegra, y copia del documento fiscal inmutable los cuatro datos del sustento; `DECLARED_EXCEPTION` guarda el caso (b, c, d o e), la versión de la política, el actor y el momento, `USER_DECLARED`, fuera del XML. En el caso d la guía elige un establecimiento de origen y el destinatario uno de destino, propios, activos y distintos, sin compararlos con el establecimiento del punto; la partida se deriva del origen, una dirección libre no prueba esta excepción, y el destinatario es la propia empresa desde su snapshot tributario con la dirección y el código del destino; no se crea un tercero que la duplique. La factura a consumidor final es sustento con un destinatario identificado (política del MVP), y las mercancías de una factura son una sugerencia no autoritativa. La guía no tiene una factura obligatoria a nivel de guía ni toca la factura: sin saldo por despachar, capacidad ni reservas de líneas.
- **Transportista con origen explícito (P4).** `SELF` toma la identidad tributaria de la empresa (RUC, tipo 04) y `PARTY` un tercero activo con el rol `CARRIER`, tipo 04, 05 o 06 e identificación de hasta 13 caracteres. El snapshot congela origen, tipo, identificación y razón social; después de `RESERVED` no se relee el tercero ni la configuración tributaria. La guía no asigna roles.
- **Antes de reservar.** Permiso, empresa derivada de la sesión, sustentos, destinatarios, transportista, placa, cantidades, fechas (inicio no anterior a la fecha de emisión que fija la reserva, por el error 82; fin no anterior al inicio) y límites se validan antes de consumir secuencial, clave, firma o llamada al SRI, y fallan cerrados.
- **Sin inventario (P8).** La guía no importa `inventory` y sus transiciones no tienen seguidores de stock; los seguidores existentes (capacidad acreditable, devolución de stock y salida de la factura) no hacen nada para el tipo 06. Una prueba de arquitectura lo fija.
- **Cabecera común sin total ni receptor único (P10).** `electronic_document.total` pasa a ser nulo solo para el tipo 06, con un `CHECK` que lo exige para los demás tipos y lo prohíbe para el 06; la bandeja y su contrato lo admiten nulo. Las columnas del receptor no guardan el primer destinatario: si pueden ser nulas para el 06, lo son, y la bandeja deriva "su nombre" o "N destinatarios"; si la compatibilidad exige otra forma, el design la resuelve sin un receptor único silencioso. Con pruebas de base de datos, de API y de la bandeja.
- **RIDE.** Renderer propio con la distribución de la ficha v2.34, anexo 2, página 64: cabecera, emisor, bloque del transporte y un bloque por destinatario con su sustento y su tabla de cantidad, descripción y códigos. Sin importes ni una fila inventada para la fecha de emisión. La lectura del XML firmado es una lista blanca de `guiaRemision` 1.1.0 que rechaza lo que el sistema no emite.
- **Defensa de recursos (P9).** Límites configurables y compuestos de destinatarios por guía (10, hasta 50), detalles por destinatario (50, hasta 100) y detalles por guía (100, hasta 300), nunca límites del SRI, del XSD ni de Q-47. `bench:shipping-guides` mide CPU, memoria, latencia y RIDE antes de cerrar el apply.
- **Fuera del cambio, sin campos parciales.** `detallesAdicionales`, `docAduaneroUnico`, `maquinaFiscal`, `infoAdicional` y `rise` no se escriben; tampoco hay exterior, combustibles, factura sustitutiva, emisor itinerante, interrupción del transporte ni varios vehículos. `SRI_TRANSMISSION_ENABLED` sigue apagado.

## Implementación de `add-shipping-guides`

Cambio 13, archivado el 2026-10-07. Las decisiones están en la sección anterior y en el design del cambio.

### Cabecera común sin total ni comprador único

- **Base de datos** (migración `document_recipients_optional_totals`): `electronic_document.total`, `buyer_identification` y `buyer_name` son nulos si y solo si el tipo es `06`; el `CHECK` lo exige en las dos direcciones y mantiene el dominio `importe` cuando el total existe. Los destinatarios de un comprobante sin comprador viven en `electronic_document_recipient` (de `fiscal`): se escriben en la misma transacción de la reserva, son inmutables, tienen posiciones contiguas desde 1 (trigger diferido) y no son autoridad del XML ni del RIDE, que salen del snapshot. Sin backfill: los demás tipos siguen con sus columnas de comprador.
- **Reserva:** `DocumentColumns` es la unión `{ receiver: "BUYER", buyerIdentification, buyerName, total }` o `{ receiver: "RECIPIENTS", recipients }`. La factura, las notas y la retención usan `BUYER` sin otros cambios. `StoredDocument` expone el comprador y el total como nulos posibles, y `documentBuyer` (de `fiscal`) los devuelve no nulos para los tipos que los tienen o falla como invariante rota.
- **Bandeja:** `documentListItemSchema` lleva `buyer` y `total` nulos solo en el `06`, y `recipients: { count, name | null }` solo en el `06`, con una refinación que lo exige en las dos direcciones. El filtro por identificación encuentra una guía por cualquiera de sus destinatarios, y la búsqueda por nombre también. El frontend deriva el receptor (el comprador, el nombre del único destinatario o "N destinatarios") y muestra el total de una guía como "—" con el texto accesible "Sin total monetario".

### Borradores, búsquedas y opciones

Rutas de `/api/v1` del módulo `shipping-guides`, todas con el permiso `shippingGuides.draft` (ADMIN y OPERATOR). Una referencia de otra empresa responde `404`, igual que una inexistente; el punto de emisión de otra empresa es `400` (`EMISSION_POINT_NOT_FOUND`), como en los demás tipos. Ninguna reserva número, escribe auditoría ni habla con el SRI.

| Ruta | Qué devuelve |
| --- | --- |
| `GET /shipping-guides/carriers` | Terceros activos con el rol `CARRIER` y tipo 04, 05 o 06, por identificación o razón social. Uno cuya identificación tiene más de 13 caracteres viene con `selectable: false` y su motivo (ficha v2.34, anexo 3). |
| `GET /shipping-guides/recipients` | Terceros activos de tipo 04, 05 o 06 con cualquier rol, sin el consumidor final ni el `08`. |
| `GET /shipping-guides/eligible-invoices` | Facturas `AUTHORIZED` de la empresa en el ambiente vigente, por número, identificación o nombre del comprador. Incluye las emitidas a consumidor final: el destinatario de la guía es otro tercero identificado (política del MVP). |
| `GET /shipping-guides/eligible-invoices/{invoiceId}/goods` | Todas las líneas de la factura con sus datos históricos (códigos, descripción y cantidad facturada) y una sugerencia no autoritativa: `PRODUCT` si su producto es hoy un bien activo, `FREE_LINE` si no, para agregarla como línea libre. Nunca rotula una línea como servicio ni como no trasladable y no decide la elegibilidad. |
| `GET /shipping-guides/options` | La política de excepciones (literales b a e del art. 30, numeral 8, con su texto y `version: 1`), los establecimientos propios activos, la identidad del transporte propio (RUC y razón social) y los límites efectivos de recursos. |
| `GET`, `POST /shipping-guides/drafts` | Lista de borradores `DRAFT` con su transportista y sus cantidades; creación de un borrador, incompleto o no, con su vista previa. |
| `GET`, `PUT`, `DELETE /shipping-guides/drafts/{draftId}` | Consulta con la vista previa recalculada con la fecha del día, corrección con `expectedVersion` (`SHIPPING_GUIDE_DRAFT_CHANGED` si cambió) y eliminación sin rastro fiscal. Un borrador emitido responde `SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED`. |

- **Vista previa:** la evaluación de design D12 con la fecha del día. Devuelve la partida, el transportista y cada destinatario tal como irían al XML, los problemas con el campo, la posición del destinatario y la del detalle, y si la emisión pedirá confirmar la declaración de una excepción.
- **Partida:** sin partida ni origen, el borrador nuevo propone como texto la dirección del establecimiento del punto. El establecimiento de origen nunca tiene valor por defecto; al elegirlo, la partida sale de su dirección y no se envía.
- **Desde una factura** (`{ fromInvoiceId }`): propone un destinatario con el comprador de la factura si es un tercero activo de tipo 04, 05 o 06 (a consumidor final, ninguno), la factura como sustento y como detalle solo las sugerencias `PRODUCT`. Las líneas libres las agrega el usuario.
- **Traslado propio:** el origen y el destino son establecimientos de la empresa, registrados, activos y distintos entre sí; no se comparan con el establecimiento del punto.
- **Límites:** los efectivos (`SHIPPING_GUIDE_MAX_*`) se aplican al guardar con `409 SHIPPING_GUIDE_RESOURCE_LIMIT`, presentados como defensa de recursos del sistema y no como límite del SRI.
- **Cuerpo del borrador** (design D23, segunda capa): `POST /shipping-guides/drafts` y `PUT /shipping-guides/drafts/{id}` leen su cuerpo con un límite propio de 2 MiB (`SHIPPING_GUIDE_DRAFT_BODY_LIMIT_BYTES`), declarado en `jsonBodyExceptions` de `main.ts` con `isShippingGuideDraftBody`; las demás rutas JSON sin parser propio, también la emisión y la eliminación del borrador, conservan el límite global de 100 KB. Es una defensa de recursos HTTP del proyecto, no un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47: un borrador en los máximos absolutos con textos multibyte de longitud máxima mide unos 400 KB, o unos 880 KB con cada carácter escapado como `\u`, y llega a la validación del dominio. Un cuerpo de más de 2 MiB recibe `413 PAYLOAD_TOO_LARGE` antes del dominio; dentro de los 2 MiB rigen el contrato y los límites estructurales. `test/integration/e2e-shipping-guide-body-limit.test.ts` lo prueba sobre `main.ts`.
- **Contrato y vista previa:** el contrato rechaza al guardar, con `400 VALIDATION_ERROR`, lo que no tiene la forma de su campo: un texto de más caracteres que su máximo (medido ya sin los espacios de los extremos), un código de destino que no tiene 3 dígitos o una cantidad que no es un decimal de hasta 18 dígitos y 6 decimales. Si el problema está dentro de un destinatario o de un detalle, el mensaje lo nombra (`Destinatario 2, detalle 1: La descripción admite como máximo 300 caracteres.`). Lo demás se guarda y lo informa la vista previa junto a su destinatario y su detalle: un motivo o una descripción vacíos, o una cantidad cero, que la emisión rechaza por política del sistema aunque el XSD la admita.

### Emisión de la guía

- **Comprobaciones previas** (`createShippingGuideEmission`, `shipping-guides/application/emission.ts`), fuera de la transacción: permiso `shippingGuides.emit`, `Idempotency-Key`, el borrador de la empresa, la huella y la repetición, los archivos del esquema, la evaluación completa con la fecha de emisión (la de hoy en Ecuador, capturada una vez) y la declaración. Un rechazo no consume secuencial, clave, firma ni llamada al SRI. Un borrador preparado un día y emitido al siguiente se evalúa con la fecha de la emisión: si el transporte empezaba antes, es `SHIPPING_GUIDE_START_BEFORE_ISSUE` (error 82 de la ficha).
- **Declaración de las excepciones** (design D14). La emisión lleva `exceptionDeclaration: { policyVersion: 1 } | null`. Con algún destinatario `DECLARED_EXCEPTION` es obligatoria (`SHIPPING_GUIDE_DECLARATION_REQUIRED`) y debe citar la versión vigente de la política (`SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH`); sin excepciones debe ser nula (`SHIPPING_GUIDE_DECLARATION_NOT_APPLICABLE`). El actor es el usuario que emite y el momento el de la reserva: se congelan por destinatario en el snapshot (caso, literal, versión, `USER_DECLARED`, actor, nombre y momento), en `shipping_guide_recipient` y en la auditoría, nunca en el XML. La consulta la presenta como declarada por el usuario, nunca como verificada.
- **Transacción de `RESERVED`** (`createShippingGuideEmissionUnitOfWork`): borrador bloqueado, configuración bloqueada, terceros, establecimientos de origen y destino, productos y facturas leídos y evaluados otra vez con la fecha de la reserva, el snapshot, `reserveDocumentIn` con el tipo `06` y las columnas `RECIPIENTS` (sin total ni comprador; los destinatarios en `electronic_document_recipient`, en orden), el registro de la guía y de sus destinatarios (`shipping_guide` y `shipping_guide_recipient`), el borrador `EMITTED`, el registro de idempotencia y `shipping_guide.reserved`. Sin I/O externo. Una factura no tiene capacidad que consumir: dos guías simultáneas sobre la misma factura son válidas, y dos emisiones del mismo borrador se serializan por su bloqueo (`shipping-guide-concurrency.test.ts`). Un fallo en cualquier paso no deja nada (`shipping-guide-atomicity.test.ts`). Después del commit, la firma compartida con el perfil de la guía.
- **Idempotencia.** Operación `shipping_guide.emit`, sin TTL. La huella (`shippingGuideFingerprint`) cubre el borrador, su versión, los datos funcionales de esa versión (punto, origen, partida, transportista, placa, fechas y cada destinatario en orden con su destinatario, sus textos, su sustento con su caso y sus detalles) y la confirmación de la declaración con su versión, con posiciones explícitas: la misma clave con otra declaración es otra huella. Misma huella: la misma guía (`200`), y si quedó reservada se reanuda su firma; otra: `409 IDEMPOTENCY_KEY_REUSED`; el borrador ya emitido con otra clave: `409 SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED`; sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.
- **Congelado.** El snapshot conserva el transportista, los establecimientos con su dirección, los destinatarios y los códigos de los productos al reservar: un tercero, un producto o un establecimiento corregido después no cambia el XML firmado de una guía reservada que se firma después.
- **Rutas:** `POST /api/v1/shipping-guides` (`shippingGuides.emit`, `201`, o `200` en la repetición), `GET /api/v1/shipping-guides/{id}` (`shippingGuides.read`, la guía desde su snapshot) y `POST /api/v1/shipping-guides/{id}/signing-attempts` (`shippingGuides.retrySigning`, con el mismo número, la misma clave y la misma fecha de emisión, y `shipping_guide.signing_retried`).
- **Códigos de rechazo** (`409`): los de la evaluación (`SHIPPING_GUIDE_CARRIER_*`, `SHIPPING_GUIDE_PLATE_INVALID`, `SHIPPING_GUIDE_DATE_INVALID`, `SHIPPING_GUIDE_START_BEFORE_ISSUE`, `SHIPPING_GUIDE_END_BEFORE_START`, `SHIPPING_GUIDE_DEPARTURE_ADDRESS_INVALID`, `SHIPPING_GUIDE_RECIPIENT*`, `SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED`, `SHIPPING_GUIDE_SAME_ESTABLISHMENT`, `SHIPPING_GUIDE_ESTABLISHMENT_*`, `SHIPPING_GUIDE_MOTIVE_REQUIRED`, `SHIPPING_GUIDE_ADDRESS_REQUIRED`, `SHIPPING_GUIDE_SUPPORT_REQUIRED`, `SHIPPING_GUIDE_INVOICE_*`, `SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH`, `SHIPPING_GUIDE_DETAILS_REQUIRED`, `SHIPPING_GUIDE_DESCRIPTION_INVALID`, `SHIPPING_GUIDE_CODE_INVALID`, `SHIPPING_GUIDE_PRODUCT_*`, `SHIPPING_GUIDE_QUANTITY_INVALID`, `SHIPPING_GUIDE_RESOURCE_LIMIT`), los de la declaración (`SHIPPING_GUIDE_DECLARATION_REQUIRED`, `SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH`, `SHIPPING_GUIDE_DECLARATION_NOT_APPLICABLE`), los del borrador (`SHIPPING_GUIDE_DRAFT_INCOMPLETE`, `SHIPPING_GUIDE_DRAFT_CHANGED`, `SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED`) y los compartidos de la emisión; los recursos inexistentes o de otra empresa son `404` (`SHIPPING_GUIDE_NOT_FOUND`, `SHIPPING_GUIDE_DRAFT_NOT_FOUND` y los de las referencias del borrador). El rechazo informa el primer problema, y su mensaje nombra el destinatario y el detalle cuando el problema está en ellos (`Destinatario 1, detalle 2: …`); la vista previa los lista todos con sus posiciones. Un código de destino mal formado no llega a la emisión: lo rechaza el contrato al guardar (`SHIPPING_GUIDE_DESTINATION_CODE_INVALID` y `SHIPPING_GUIDE_RECIPIENT_INVALID` siguen en la lista de códigos del contrato, pero hoy no se producen).
- **Auditoría** `shipping_guide.reserved`: la guía, su número, su clave, el ambiente, el origen del transportista con su identificación y su nombre, los conteos de destinatarios y detalles, las clases de sustento y cada excepción declarada como `posición:caso` con la versión de la política. Sin direcciones, descripciones, placa, XML ni SOAP. Ningún rechazo audita.
- **Métricas:** `shipping_guide_reservations_total` y `shipping_guide_recipients_total{support}` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.
- **Secuencial propio.** La guía reserva el secuencial del tipo `06` en el ámbito del punto: `test/integration/debit-note-sequences.test.ts` emite factura, nota de crédito, nota de débito, retención, guía y factura, y después guía, retención, nota de débito, nota de crédito y factura, y comprueba que cada tipo sigue su contador sin huecos ni cruces.

### Consulta, transmisión y reconciliación de la guía

- **Consulta** (`createShippingGuides`, `shipping-guides/application/shipping-guides.ts`, `shippingGuides.read`): `GET /api/v1/shipping-guides` lista las guías por estado y busca por número, por el transportista congelado en `shipping_guide` (identificación o razón social) o por la identificación o el nombre de cualquiera de sus destinatarios (`electronic_document_recipient`), las más recientes primero (`createShippingGuideListReader`). Cada fila lleva el transportista, "N destinatarios" o el nombre del único, las fechas del transporte y el estado, sin importes. `GET /api/v1/shipping-guides/{id}` devuelve la guía desde su snapshot (transportista, placa, fechas, partida y cada destinatario con su sustento y su detalle; la excepción como declarada por el usuario) con su artefacto, su diagnóstico y su transmisión; `GET /api/v1/shipping-guides/{id}/transmission`, las 100 entradas más recientes del historial sin respuestas originales ni XML. Otra empresa o un comprobante de otro tipo es `404 SHIPPING_GUIDE_NOT_FOUND`.
- **Reconciliación manual:** `POST /api/v1/shipping-guides/{id}/reconciliations` (`shippingGuides.reconcile`, solo el administrador) con la solicitud compartida de `fiscal`: comprueba el estado con el comprobante bloqueado, encola un `sri.reconcile` manual y audita `shipping_guide.reconciliation_requested` en la misma transacción. Un estado no reconciliable es `409 SHIPPING_GUIDE_NOT_RECONCILABLE` y una interacción en curso `409 SRI_INTERACTION_IN_PROGRESS`. El tipo `06` está en `COMPLETED_AUDIT` del handler de reconciliación: la finalización se audita como `shipping_guide.reconciliation_completed`.
- **Transmisión sin cambios.** Los handlers de envío, autorización y reconciliación, la cola, los clasificadores, la evidencia guardada antes de clasificar y la reclasificación de la respuesta guardada atienden el tipo `06` igual que los demás comprobantes, sin cambios en el transporte (`shipping-guide-transmission.test.ts`, con respuestas sintéticas y sin red: RECIBIDA, DEVUELTA, también con el error 82, que la deja devuelta por la clasificación genérica y sin corrección de devueltos, 70, 43 y 45, una respuesta sin estado, `NOT_SENT` que deja la guía firmada y reprograma el envío sin reconciliar, `SEND_UNKNOWN` con su reconciliación por clave, AUTORIZADO con su XML autorizado y el job del RIDE, NO AUTORIZADO y MANUAL_REVIEW). Los seguidores de la capacidad acreditable, de la devolución de stock y de la salida de inventario no hacen nada para una guía. `SRI_TRANSMISSION_ENABLED` sigue apagado.

### Pantallas de la guía

- **Guías de remisión** (`/guias-remision`, en "Operación", `shippingGuides.read`): `frontend/src/features/shipping-guides/shipping-guides-screen.tsx`, con número, destinatarios ("N destinatarios" o el nombre del único), transportista, fechas del transporte y estado, sin importes; búsqueda por número, transportista o identificación de un destinatario y estado en la URL (`q`, `estado`), tarjetas por debajo de 768 px y los borradores en curso con su eliminación (`shippingGuides.draft`).
- **Nueva guía de remisión sobre la lista** (decisión del propietario, 2026-10-22): «Nueva guía de remisión» (`useNewShippingGuide`, `new-shipping-guide.tsx`) crea el borrador al instante (`POST /shipping-guides/drafts`) con el punto predeterminado del usuario, de cuyo establecimiento el servidor propone la partida, y abre su editor: ya no hay una página intermedia con un texto y un botón. La creación rápida llega con `/guias-remision?nueva=1`, que pide confirmar con "Preparar borrador" porque la creación rápida nunca crea por sí misma; la antigua `/guias-remision/borradores/nueva` redirige allí. Desde el detalle de una factura autorizada del ambiente vigente, "Nueva guía de remisión" (`InvoiceShippingGuideAction`, `shippingGuides.draft`) crea el borrador propuesto desde la factura (`{ fromInvoiceId }`) y abre el editor.
- **Borrador** (`/guias-remision/borradores/{id}`, `shippingGuides.draft`): `ShippingGuideDraftScreen`, con las opciones de `GET /shipping-guides/options`. Con el diseño de los demás editores (decisión del propietario, 2026-10-22): los controles segmentados (quién transporta, punto de partida, destinatario, comprobante de venta y producto o línea libre) y la placa a todo el ancho; el transportista, el destinatario y la factura en `PickedCard`, con su ícono grande y, en la misma fila, el botón para elegirlos o cambiarlos en el azul primario; la factura muestra su número, su comprador con su identificación, su fecha y su total (la de un borrador guardado se busca por su número en las facturas elegibles; sin resultado, la fecha y la autorización de la vista previa), con «Cargar mercancías de la factura» a la derecha; un destinatario nuevo, o uno guardado sin sustento, empieza con «Factura» (sin factura elegida no se envía, así que el borrador sigue igual al guardado); el motivo en `SingleLineTextarea` con su cuenta «N/300», y la ruta y el código de destino en una fila, mitad y mitad; «Agregar detalle» y «Agregar destinatario» con `AddRowButton`; quitar en rojo; íconos en «Emitir» y «Guardar». El transporte con un control segmentado Propio/Tercero sin selección inicial: el propio muestra la identidad tributaria de la empresa; el tercero se elige en el `EntityPickerDialog` de transportistas, donde los que no se pueden elegir aparecen deshabilitados con su motivo, y "Nuevo transportista" abre `PartyDialog` con el rol de transportista marcado y visible. La placa. Las fechas de inicio y fin (`DatePickerField`) y la partida con un control segmentado: el establecimiento de origen en un `Select` sin selección inicial, con su dirección de solo lectura, u otra dirección propuesta desde el establecimiento del punto (al crear el borrador con el punto predeterminado, o en el editor al elegir el punto con la dirección vacía, sin reemplazar nunca una escrita). Los destinatarios (`shipping-guide-recipient-card.tsx`) en una lista ordenada con agregar y quitar: un tercero (selector de destinatarios y "Nuevo destinatario" con `PartyDialog` sin roles; dirección, motivo, ruta y código del establecimiento de destino) o un establecimiento propio de destino en un `Select` que excluye el origen y pide elegir primero el origen, con su dirección y su código de solo lectura. El sustento: "Factura" con el selector de facturas elegibles y "Cargar mercancías de la factura", que abre un diálogo con las líneas de la factura (las sugerencias `PRODUCT` marcadas, las `FREE_LINE` sin marcar con "Agregar como línea libre" y sus datos históricos, y el aviso de que es una sugerencia), o "Sin factura" con los casos del art. 30 para un tercero y su texto oficial; el establecimiento propio fija el traslado entre establecimientos y lo muestra de solo lectura. El detalle con un control segmentado Producto/Línea libre: el producto en un selector de bienes activos con sus códigos de solo lectura, o los códigos opcionales de la línea libre; la descripción con el rótulo "Descripción (incluye unidad y características)", el ejemplo en la ayuda, el contador de 300 y la vista previa del texto tal como irá al XML y al RIDE; y la cantidad decimal. Los problemas de la vista previa del servidor van junto a su destinatario y su detalle, o en "Antes de emitir". "Emitir guía de remisión" (`shippingGuides.emit`) pide en un `ConfirmDialog` el resumen (ambiente, transportista, placa, fechas y cada destinatario con su sustento y su número de detalles) y, si hay excepciones declaradas, las lista con su texto y exige la casilla "Declaro que los traslados sin factura corresponden a los casos indicados del art. 30 del Reglamento de Comprobantes"; la emisión envía la versión de la política. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión. Los límites de recursos se presentan como límites del sistema, no del SRI.
- **Detalle** (`/guias-remision/{id}`, `shippingGuides.read`): `shipping-guide-detail.tsx`, desde el snapshot: estado y número; el transporte (transportista con su origen e identificación, placa, fechas y partida); cada destinatario con su destino, motivo, ruta, código de destino, su sustento (la factura con su enlace a `/facturas/{id}`, su fecha y su autorización, o la excepción "declarada por" el usuario con su momento, que el sistema no puede comprobar) y su detalle (en tabla desde 640 px y apilado por debajo); el resumen sin total monetario; el diagnóstico y el reintento de la firma (`shippingGuides.retrySigning`); la transmisión con la reconciliación (`shippingGuides.reconcile`) y los documentos compartidos.
- **Selector con elementos no elegibles.** `EntityPickerDialog` acepta `isDisabled`: el elemento se muestra con `aria-disabled` y no se elige; su motivo lo dibuja `renderItem`.
- **Navegación:** "Guías de remisión" en el grupo Operación (`shippingGuides.read`).

### La guía en la bandeja

- **Un tipo más en el registro.** `EMITTED_DOCUMENT_TYPES` incluye `06` y `DOCUMENT_KINDS` guarda su nombre en las frases compartidas ("guía", en femenino: "la guía", "firmada", "autorizada"; `DocumentsSection` y `TransmissionSection` no cambian), el detalle `/guias-remision/{id}`, su API `/shipping-guides`, el permiso `shippingGuides.reconcile`, el código `SHIPPING_GUIDE_NOT_RECONCILABLE` y sus esquemas de vista y transmisión. El filtro "Tipo de comprobante" ofrece los cinco tipos, con "Guía de remisión" (`DOCUMENT_TYPE_LABELS`).
- **Receptor y total.** La fila de una guía muestra el nombre de su único destinatario o "N destinatarios", y el total "—" con el texto accesible "Sin total monetario"; la tarjeta móvil omite la fila del total. Las reglas de disponibilidad de los documentos siguen en el servidor (`frontend/test/documents-screen.test.tsx`, `shipping-guide-sections.test.tsx`).

### RIDE de la guía

- **Lectura.** `ride-source.ts` lee la guía de remisión 1.1.0 por su raíz (`guiaRemision`) y su versión (`RIDE_SHIPPING_GUIDE_VERSION`), con una lista blanca de los elementos que escribe el builder: `rise`, `docAduaneroUnico`, `detallesAdicionales`, `maquinaFiscal`, `infoAdicional`, un `codDocSustento` distinto de `01`, un sustento incompleto o un bloque repetido detienen la generación (`RIDE_SOURCE_UNSUPPORTED`, con el elemento). El modelo `RideShippingGuide` (`kind: "SHIPPING_GUIDE"`) no tiene fecha de emisión, porque el XML de la guía no la trae. Todo sale del XML: el RIDE de la guía no necesita denominaciones del snapshot.
- **Distribución propia** según la ficha v2.34, anexo 2, página 64, versión `guia-remision-1` (`SHIPPING_GUIDE_RIDE_RENDERER_VERSION`): la cabecera con "GUÍA DE REMISIÓN", su autorización y el Code128 de su clave; el emisor con sus leyendas; el transporte con la identificación y la razón social del transportista, la placa, el punto de partida y las fechas de inicio y fin; y un bloque por destinatario con su comprobante de venta (FACTURA y su número), su fecha y su autorización, el motivo, el destino, la identificación, la razón social, el documento aduanero, el código del establecimiento de destino y la ruta, con los rótulos sin dato vacíos como en el modelo, y la tabla de cantidad, descripción, código principal y código auxiliar. Sin importes ni una fila para la fecha de emisión de la guía. Los datos del destinatario y el encabezado de su tabla son las filas de cabecera de la tabla: se repiten en cada página que continúa el bloque, nunca se separan de su primera fila y ninguna fila se parte. La comparación rótulo por rótulo con la página 64 está en `openspec/changes/archive/2026-10-07-add-shipping-guides/ride-review.md`.
- **Pruebas.** `test/sri-engine/ride/ride-shipping-guide.test.ts` (golden del texto de las páginas en `backend/test/fixtures/shipping-guide-ride/`, regenerables con `SHIPPING_GUIDE_RIDE_UPDATE=1`; varios destinatarios; destinatario sin factura con los rótulos vacíos; sin importes; paginación con 50 destinatarios y 300 detalles; Code128; contenido no emitido; los mismos bytes en otro proceso) y `test/integration/shipping-guide-ride.test.ts` (el RIDE nace con la autorización, se guarda una vez con su procedencia, se descarga verificado y la solicitud de impresión entrega el mismo). El job, el pool, las descargas y las entregas no cambian; el RIDE de los demás tipos tampoco.

### Medición de la guía

- Con `EMISSION_STAGE_TIMINGS=1`, `POST /api/v1/shipping-guides` devuelve sus etapas en `Server-Timing` (`total`, `reservation_tx` y las de la firma compartida: `xml`, `xsd`, `sign`, `persist`), como los demás tipos; nunca en producción.
- `bench:shipping-guides` (design D28) mide la búsqueda de transportistas, de destinatarios y de facturas elegibles, las mercancías sugeridas de una factura, el borrador y la emisión del peor caso con los límites por defecto y con los máximos absolutos (con el CPU y la memoria residente del backend), la emisión en serie, la contención sobre la misma factura y sobre facturas distintas, la lista y la búsqueda de guías, la bandeja filtrada por la identificación de un destinatario y el RIDE de una guía y del máximo de filas; asienta la base con `VACUUM (ANALYZE)` y un `CHECKPOINT` después de la siembra, y termina comprobando que las guías no crearon movimientos de inventario ni cambiaron una factura, sus XML o los roles de un tercero (`../quality/performance.md`). La ejecución registrada midió los máximos absolutos con textos de 100 caracteres, porque entonces regía el límite global de 100 KB para el borrador; hoy los borradores admiten 2 MiB.
- `test/integration/e2e-shipping-guides.test.ts` recorre el flujo sobre `main.ts` con el SRI simulado: una guía con transporte propio desde el establecimiento 001 hacia el cliente de una factura autorizada (con las mercancías sugeridas de la factura) y hacia el establecimiento propio 002, autorizada con su RIDE en la bandeja y en el filtro por la identificación de cualquiera de sus destinatarios, y con el transporte, la partida y los dos destinatarios en sus XML; otra guía sobre la misma factura que el SRI no autoriza y queda sin RIDE; la factura, el inventario y los roles del cliente sin cambios, las reconciliaciones sin diferencias y la auditoría de las guías limitada a su emisión.

## Decisiones para el diseño de `add-purchase-settlements`

Decididas el 2026-10-07 en la revisión de readiness del cambio 14 (Q-12); el proposal y el design del
cambio las concretan. Las reglas de negocio están en `docs/product/domain-model.md` (BR-38 y BR-88 a
BR-95), con su origen oficial, de política del MVP o de defensa de recursos en
`docs/product/capabilities.md` (Trazabilidad de `purchase-settlements`).

- **Documento propio sobre el pipeline existente.** La liquidación de compra (`codDoc` 03, XSD `LiquidacionCompra_V1.1.0`, verificado contra el portal y ya en el registro de esquemas) reutiliza `reserveDocumentIn` con las columnas del comprador como contraparte, un perfil de firma propio sobre `documentSigning.pipeline`, el registro de esquemas, el firmador, los jobs durables `sri.*`, la reconciliación, la bandeja, el pool del RIDE y las entregas. No hay un pipeline paralelo.
- **Firmador.** La librería firma el 03 con un import privado de `ec-sri-invoice-signer@1.8.2` (ADR 0018). Su prueba de contrato es la primera tarea técnica del apply; si el mapeo no funciona con el pipeline, es un bloqueo real y se reporta antes de seguir. No se migra a la API de alto nivel de la librería.
- **Secuencial propio.** Su contador `03` existe desde `add-fiscal-numbering`; una prueba demuestra que reservar 01, 03, 04, 05, 06 y 07 en el mismo punto de emisión no altera ningún otro contador.
- **Procedencia (Q-12).** Solo el caso c) del artículo 13 del Reglamento vigente, con la política `PURCHASE_SETTLEMENT_ELIGIBILITY_V1` (`ART_13_C_RUSTICITY_NO_ACTIVE_RUC`). El sistema verifica la empresa, el tercero activo con el rol `SUPPLIER` y su identificación 05 o 06, el cálculo y los catálogos; el usuario declara, en cuatro declaraciones separadas con su versión, su actor y su momento, que el proveedor es una persona natural no obligada a llevar contabilidad, que no está inscrito en el RUC o lo tiene suspendido, que por su nivel cultural o rusticidad no puede emitir comprobantes de venta, y que la operación es de bienes muebles o servicios. Las declaraciones van al snapshot, a la huella de idempotencia y a la evidencia de la emisión, nunca al XML. No se consulta el estado del RUC.
- **Proveedor.** Tercero activo de la empresa con el rol `SUPPLIER`, que nunca se asigna solo (el alta en línea permite marcarlo de forma explícita), identificado con 05 o 06 (04, 07 y 08 se rechazan en el MVP) y con dirección obligatoria. El snapshot congela tipo, identificación, nombre y dirección; después de `RESERVED` no se relee el tercero.
- **Líneas.** Producto opcional, solo como conveniencia para sugerir código y nombre, o línea libre; el precio es siempre el de la operación. Código cuando exista, descripción, unidad de medida cuando corresponda, cantidad, precio unitario, descuento (siempre materializado, incluso `0.00`) e IVA. Sin `precioSinSubsidio` ni `detallesAdicionales`.
- **Impuestos y cálculo.** Solo IVA, con `codigoPorcentaje` y tarifa del catálogo `iva-rate` vigente en la fecha de emisión, congelados con su referencia. Un cálculo versionado es la única autoridad de la vista previa, el snapshot, el XML y el RIDE; si las fórmulas de la ficha equivalen a las de la factura, se extraen las primitivas matemáticas a un módulo fiscal neutral (nunca `purchase-settlements` → `invoices`, ADR 0002); si la extracción amenaza una regresión, el cálculo es propio. Decimales exactos.
- **Pagos y moneda.** De uno a varios pagos, cada uno con `formaPago`, `total`, `plazo` y `unidadTiempo` (la ficha exige `plazo` aunque el XSD lo deje opcional); la suma de los pagos es exactamente el importe total. Moneda `DOLAR`, la política monetaria vigente del proyecto.
- **Retención.** El caso c) obliga a retener el 100 % del IVA y el 3 % de la renta, pero el comprobante de retención es otro documento: el cambio no lo emite ni espera, y muestra un aviso de la obligación después de la vista previa y en el detalle, sin presentarlo como evidencia de que la retención ya se emitió. La asociación interna futura (`internal-purchase-settlement-withholding-link`) nunca reescribirá snapshots históricos.
- **Sin inventario, sin compras.** La liquidación no reserva, aumenta ni ajusta stock ni crea movimientos, aunque una línea tenga un producto bien; tampoco crea órdenes de compra, cuentas por pagar ni facturas recibidas.
- **Fecha.** La fecha de emisión es la fecha fiscal congelada en la reserva; sin una ventana propia del tipo 03.
- **RIDE.** Renderer propio (`liquidacion-compra-1`) con la distribución de la ficha v2.34, anexo 2, página 65, sin imprimir campos que la liquidación 1.1.0 no tiene ("Placa/Matrícula", "Guía Remisión", subsidios).
- **Bandeja.** El proveedor ocupa provisionalmente las columnas del comprador como contraparte del documento, y la interfaz lo rotula siempre "Proveedor".
- **Defensa de recursos.** `PURCHASE_SETTLEMENT_MAX_LINES` (100 por defecto, hasta 1000; el design lo corrigió después a 500 con la evidencia del benchmark) y un máximo de pagos que fija el design (hipótesis: 10), nunca límites del SRI, del XSD ni de Q-47. `bench:purchase-settlements` los confirma antes del archive.
- **Fuera del cambio, sin campos parciales.** Los demás casos del artículo 13 y de la LRTI, `reembolsos`, `maquinaFiscal`, `tipoNegociable`, subsidios, ICE e IRBPNR; tampoco la firma del RIDE por el proveedor (Q-53). `SRI_TRANSMISSION_ENABLED` sigue apagado.

## Implementación de `add-purchase-settlements`

Cambio 14, archivado el 2026-10-08. Las decisiones están en la sección anterior y en el design del
cambio (`openspec/changes/archive/2026-10-08-add-purchase-settlements/`).

### Cálculo, evaluación y snapshot de la liquidación

- **Primitivas compartidas.** Las funciones de los importes de un comprobante con líneas e impuestos están en `fiscal/domain/document-amounts.ts`; la factura las reexporta con sus nombres y sus importes no cambian (pruebas de importes, contrato de regresión y golden en verde).
- **Una primitiva versionada.** `calculatePurchaseSettlementAmounts` (`purchase-settlements/domain/amounts.ts`, versión `purchase-settlement-amounts-1`) calcula cada línea (subtotal exacto, base materializada HALF_UP, IVA de la base) y los totales por tarifa, sin impuestos, de descuentos e importe total, con solo IVA. La vista previa, el snapshot, el XML y el RIDE usan su resultado; ninguno calcula. El ejemplo del spec (10 × 4.50 − 5.00 al 15 % y 2 × 30.00 al 0 %) da 100.00, 5.00, IVA 6.00 e importe 106.00.
- **Evaluación.** `evaluatePurchaseSettlement` (`purchase-settlements/domain/evaluation.ts`) es pura e informa los problemas en el orden de la design D12: preparación; proveedor (existe, activo, no es el consumidor final, cédula o pasaporte, con el rol `SUPPLIER`); dirección; límites de recursos; líneas (producto activo opcional, descripción, textos escribibles en XML, cantidad mayor que cero, precio, IVA vigente y habilitado con tarifa de cálculo, descuento hasta el subtotal); el cálculo; y los pagos (forma de pago utilizable, total, plazo, unidad de tiempo y suma exacta sin tolerancia, con lo que falta o sobra). Cada problema lleva el campo y la posición de la línea o del pago. El RUC se rechaza como restricción del sistema para el caso c), no como regla para toda liquidación. Las líneas válidas se calculan aunque otras no lo sean.
- **Snapshot.** `buildPurchaseSettlementSnapshot` (`purchase-settlements/domain/build-snapshot.ts`, `snapshotVersion` 1) congela el emisor, el proveedor con su dirección, la procedencia (`ART_13_C`, `PURCHASE_SETTLEMENT_ELIGIBILITY_V1`, versión 1) con las cuatro declaraciones `USER_DECLARED` de quien emite y su momento, las líneas con su producto opcional, sus textos, la cantidad y el precio en forma canónica, el descuento y el IVA con su referencia de catálogo, los totales y la versión del cálculo, los pagos con su plazo y su unidad de tiempo, la moneda `DOLAR`, los conteos y los catálogos usados.
- **Pruebas.** `backend/test/purchase-settlements/amounts.test.ts`, `evaluation.test.ts` y `snapshot.test.ts`.

### Borradores, vista previa, proveedores y opciones de la liquidación

- **Borradores** (`createPurchaseSettlementDrafts`, `purchase-settlements/application/drafts.ts`): `GET/POST /api/v1/purchase-settlements/drafts` y `GET/PUT/DELETE /api/v1/purchase-settlements/drafts/{id}` (`purchaseSettlements.draft`). Se guardan incompletos, con las líneas y los pagos en `lines` y `payments` (`JSONB`), con versión y sin auditoría. Al elegir un proveedor con la dirección vacía, el borrador propone la del tercero. Los límites configurados (`PURCHASE_SETTLEMENT_MAX_*`) se aplican al guardar (`409 PURCHASE_SETTLEMENT_RESOURCE_LIMIT`, una defensa del sistema); un proveedor o un producto de otra empresa es `404` (`PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND`, `PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND`) y un punto de otra empresa `400 EMISSION_POINT_NOT_FOUND`.
- **Vista previa.** Cada consulta recalcula la evaluación con la fecha del día (`loadPurchaseSettlementContext`, `application/context.ts`): los importes de las líneas que pueden calcularse, los totales, la suma de los pagos, la política de procedencia con las cuatro declaraciones que se confirmarán al emitir, el aviso de la retención y los problemas con su campo y su posición.
- **Proveedores:** `GET /api/v1/purchase-settlements/suppliers` (`purchaseSettlements.draft`), sobre el puerto `PurchaseSupplierReader` que `main.ts` compone con `purchaseSupplierReader` de `parties`: los terceros activos con el rol `SUPPLIER`, sin el consumidor final; solo la cédula y el pasaporte son seleccionables y los demás llevan su motivo. Los productos se eligen con `GET /api/v1/products` (`products.read`), como en la factura y en la guía.
- **Opciones:** `GET /api/v1/purchase-settlements/options` (`purchaseSettlements.draft`, `createPurchaseSettlementOptions`): la política con sus declaraciones y su versión, el aviso de la retención, la moneda, las tarifas de IVA utilizables con tarifa de cálculo (sin el IVA diferenciado), las formas de pago habilitadas y los límites efectivos. El punto de emisión se elige como en los demás borradores, con el punto predeterminado y los establecimientos de la empresa.
- **Cuerpo del borrador** (design D22): `POST /purchase-settlements/drafts` y `PUT /purchase-settlements/drafts/{id}` leen su cuerpo con un límite propio de 4 MiB (`PURCHASE_SETTLEMENT_DRAFT_BODY_LIMIT_BYTES`), declarado en `jsonBodyExceptions` de `main.ts` con `isPurchaseSettlementDraftBody`; las demás rutas JSON sin parser propio, también la emisión, la eliminación del borrador y la reconciliación, conservan el límite global de 100 KB. Es una defensa de recursos HTTP del proyecto, no un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47: un borrador con los valores por defecto (100 líneas y 10 pagos) y textos multibyte de longitud máxima mide unos 117 KB, o 245 KB escapado, y uno en los máximos absolutos (500 líneas y 20 pagos) unos 0,56 MiB, o 1,16 MiB con cada carácter escapado como `\u`, y llega a la validación del dominio. Un cuerpo de más de 4 MiB recibe `413 PAYLOAD_TOO_LARGE` antes del dominio; dentro de los 4 MiB rigen el contrato y los límites. `test/integration/e2e-purchase-settlement-body-limit.test.ts` lo prueba sobre `main.ts`.

### Emisión de la liquidación

- **Comprobaciones previas** (`createPurchaseSettlementEmission`, `purchase-settlements/application/emission.ts`), fuera de la transacción: permiso `purchaseSettlements.emit`, `Idempotency-Key`, el borrador de la empresa, la huella y la repetición, los archivos del esquema, la evaluación completa con la fecha de emisión (la de hoy en Ecuador, capturada una vez) y las cuatro declaraciones. Un rechazo no consume secuencial, clave, firma ni llamada al SRI.
- **Declaraciones** (design D3): la emisión lleva `declarations: { policyVersion, statements }`; exige la versión vigente de `PURCHASE_SETTLEMENT_ELIGIBILITY_V1` (`409 PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH`) y los cuatro identificadores (`409 PURCHASE_SETTLEMENT_DECLARATION_REQUIRED`, con el texto de la primera que falta). Un identificador desconocido o una casilla genérica son `400`. Se congelan como `USER_DECLARED` con quien emite y el momento de la reserva, en el snapshot y en `purchase_settlement_declaration`; nunca en el XML, y el sistema no consulta el estado del RUC.
- **Transacción de `RESERVED`** (`createPurchaseSettlementEmissionUnitOfWork`): borrador bloqueado, configuración bloqueada, el proveedor, los productos y los catálogos leídos y evaluados otra vez con la fecha de la reserva, el snapshot, `reserveDocumentIn` con el tipo `03` y las columnas `BUYER` (el proveedor como contraparte, con el importe total), el registro de la liquidación con sus cuatro declaraciones, el borrador `EMITTED`, el registro de idempotencia y `purchase_settlement.reserved`. Sin I/O externo. Un fallo en cualquier paso no deja nada (`purchase-settlement-atomicity.test.ts`); dos emisiones simultáneas del mismo borrador dejan una sola liquidación y borradores distintos reciben secuenciales sin huecos (`purchase-settlement-concurrency.test.ts`). Después del commit, la firma compartida con el perfil de la liquidación.
- **Idempotencia.** Operación `purchase_settlement.emit`, sin TTL. La huella (`purchaseSettlementFingerprint`) cubre el borrador, su versión, los datos funcionales de esa versión (punto, proveedor, dirección, líneas y pagos con posiciones explícitas) y las declaraciones con su versión, en orden canónico. Misma huella: la misma liquidación (`200`), y si quedó reservada se reanuda su firma; otra huella, también con otras declaraciones: `409 IDEMPOTENCY_KEY_REUSED`; el borrador ya emitido con otra clave: `409 PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED`; sin clave: `400 IDEMPOTENCY_KEY_REQUIRED`.
- **Congelado.** Un cambio posterior del proveedor, del producto o del catálogo no cambia el XML firmado de una liquidación reservada que se firma después (`purchase-settlement-signing-retry.test.ts`).
- **Rutas:** `POST /api/v1/purchase-settlements` (`purchaseSettlements.emit`, `201`, o `200` en la repetición) y `POST /api/v1/purchase-settlements/{id}/signing-attempts` (`purchaseSettlements.retrySigning`, `purchase_settlement.signing_retried`).
- **Códigos de rechazo** (`409`): los de la evaluación (`PURCHASE_SETTLEMENT_SUPPLIER_*`, `PURCHASE_SETTLEMENT_ADDRESS_REQUIRED`, `PURCHASE_SETTLEMENT_LINES_REQUIRED`, `PURCHASE_SETTLEMENT_DESCRIPTION_INVALID`, `PURCHASE_SETTLEMENT_CODE_INVALID`, `PURCHASE_SETTLEMENT_PRODUCT_INACTIVE`, `PURCHASE_SETTLEMENT_QUANTITY_INVALID`, `PURCHASE_SETTLEMENT_PRICE_INVALID`, `PURCHASE_SETTLEMENT_DISCOUNT_EXCEEDS_SUBTOTAL`, `PURCHASE_SETTLEMENT_IVA_RATE_*`, `PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE`, `PURCHASE_SETTLEMENT_PAYMENTS_REQUIRED`, `PURCHASE_SETTLEMENT_PAYMENT_*`, `PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH`, `PURCHASE_SETTLEMENT_RESOURCE_LIMIT`), los de las declaraciones, los del borrador (`PURCHASE_SETTLEMENT_DRAFT_INCOMPLETE`, `PURCHASE_SETTLEMENT_DRAFT_CHANGED`, `PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED`) y los compartidos de la emisión; los recursos inexistentes o de otra empresa son `404` (`PURCHASE_SETTLEMENT_NOT_FOUND`, `PURCHASE_SETTLEMENT_DRAFT_NOT_FOUND`, `PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND`, `PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND`).
- **Auditoría y métrica:** `purchase_settlement.reserved` lleva el caso, la política y su versión, los identificadores de las declaraciones, el número de líneas y de pagos y el importe total, sin descripciones, direcciones, XML ni SOAP; `purchase_settlement_reservations_total` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.

### XML y firma de la liquidación

- **Builder propio.** `createPurchaseSettlementXmlBuilder` (`sri-engine/infrastructure/purchase-settlement-xml-builder.ts`, versión de builder `1`) escribe `liquidacionCompra` 1.1.0 desde la proyección del snapshot (`toPurchaseSettlementXmlSnapshot`, `purchase-settlements/application/xml-snapshot.ts`), en el orden del XSD, con `infoTributaria` (`codDoc` 03), `xml-writer.ts` y el texto decimal exacto del snapshot. No usa el builder de alto nivel de la dependencia.
- **Contenido.** `infoLiquidacionCompra` con `fechaEmision`, `dirEstablecimiento`, `contribuyenteEspecial` cuando la empresa lo tiene, `obligadoContabilidad`, el proveedor (tipo, razón social, identificación y dirección), `totalSinImpuestos`, `totalDescuento`, `totalConImpuestos` (código 2, código de porcentaje, base, tarifa y valor por tarifa), `importeTotal`, `moneda` y los `pagos` con `formaPago`, `total`, `plazo` y `unidadTiempo`. Cada `detalle` lleva los códigos y la unidad cuando existen, la descripción, la cantidad, el precio unitario, el descuento siempre (también `0.00`), `precioTotalSinImpuesto` y un único `impuesto`, el IVA.
- **Lo que no escribe:** `reembolsos` ni sus totales, `codDocReembolso`, `descuentoAdicional`, `precioSinSubsidio`, `detallesAdicionales`, `tipoNegociable`, `maquinaFiscal`, `infoAdicional` ni las declaraciones de procedencia.
- **Firma.** `purchaseSettlementSigningProfile` registra el builder en la firma compartida y la auditoría `purchase_settlement.signed`; el firmador recibe el tipo `03`, que la librería firma con el import privado de `ec-sri-invoice-signer@1.8.2` (`LIQUIDACION_COMPRA`, ADR 0018), fijado por la prueba de contrato `backend/test/sri-engine/purchase-settlement-signer.contract.test.ts`. El XML se valida contra `LiquidacionCompra_V1.1.0.xsd` antes y después de firmar. Los golden de bytes exactos, todos válidos contra el XSD oficial, están en `backend/test/fixtures/purchase-settlement-xml/` (cédula con producto y línea libre; pasaporte con varias tarifas, incluidos el 0 %, no objeto y exento; seis decimales; caracteres especiales; longitudes máximas).

### Consulta, transmisión y reconciliación de la liquidación

- **Consulta:** `GET /api/v1/purchase-settlements` (búsqueda por número o por la identificación o el nombre del proveedor, sobre las columnas genéricas de la contraparte, y filtro `state`), `GET /api/v1/purchase-settlements/{id}` (el detalle desde el snapshot: proveedor, líneas, IVA por tarifa, pagos con su plazo, las cuatro declaraciones "declaradas por" el usuario con su momento, el aviso de la retención, el diagnóstico y la transmisión) y `GET /api/v1/purchase-settlements/{id}/transmission` (el historial sin respuestas originales ni XML), con `purchaseSettlements.read`. Otra empresa u otro tipo de comprobante es `404 PURCHASE_SETTLEMENT_NOT_FOUND`.
- **Transmisión:** sin cambios en el transporte, la cola, la máquina de estados ni los clasificadores; `purchase-settlement-transmission.test.ts` repite con una liquidación y respuestas sintéticas `RECIBIDA`, `DEVUELTA`, `NO AUTORIZADO`, `AUTORIZADO` (con su XML autorizado y el job del RIDE), los errores 70, 43 y 45, `NOT_SENT`, `SEND_UNKNOWN` con su reconciliación por clave, la revisión manual (también al agotar la ventana) y la respuesta guardada antes de clasificar.
- **Reconciliación manual:** `POST /api/v1/purchase-settlements/{id}/reconciliations` (`purchaseSettlements.reconcile`, solo el administrador, `202`), con `requestReconciliationIn` y `purchase_settlement.reconciliation_requested`; la finalización se audita con `purchase_settlement.reconciliation_completed` (`"03"` en `COMPLETED_AUDIT` de `fiscal/application/reconcile-handler.ts`). Un estado no reconciliable es `409 PURCHASE_SETTLEMENT_NOT_RECONCILABLE` y una interacción en curso `409 SRI_INTERACTION_IN_PROGRESS`.

### Pantallas de la liquidación

- **Liquidaciones de compra** (`/liquidaciones-compra`, en "Operación", `purchaseSettlements.read`): `frontend/src/features/purchase-settlements/purchase-settlements-screen.tsx`, con número, proveedor con su identificación, fecha, importe total y estado; búsqueda por número o por la identificación o el nombre del proveedor y estado en la URL (`q`, `estado`), tarjetas por debajo de 768 px y los borradores en curso con su proveedor, sus líneas y el importe de su vista previa, y su eliminación confirmada (`purchaseSettlements.draft`). El estado vacío explica cuándo se emite una liquidación (art. 13, letra c).
- **Nueva liquidación de compra sobre la lista** (decisión del propietario, 2026-10-22): «Nueva liquidación de compra» (`useNewPurchaseSettlement`, `new-purchase-settlement.tsx`) crea el borrador al instante (`POST /purchase-settlements/drafts`) con el punto predeterminado del usuario y abre su editor. La creación rápida llega con `/liquidaciones-compra?nueva=1`, que pide confirmar con "Preparar borrador" y explica cuándo corresponde la liquidación; la antigua `/liquidaciones-compra/borradores/nueva` redirige allí.
- **Borrador** (`/liquidaciones-compra/borradores/{id}`, `purchaseSettlements.draft`): `PurchaseSettlementDraftScreen`, con las opciones de `GET /purchase-settlements/options`. Con el diseño de los demás editores (decisión del propietario, 2026-10-22): «Establecimiento y punto de emisión» sin título visible, «Proveedor» titulado como la etiqueta de un campo y las notas del proveedor y de los pagos en el tooltip de su título; cada línea en un `NumberedItem`, con «Línea N» en su franja y quitar la línea al final de la fila del producto; la base y el IVA de cada línea en su propia fila, centrados, y un separador debajo de «Agregar línea», antes de los pagos; el establecimiento y el punto en `EstablishmentPointFields`, mitad y mitad; el proveedor en una ficha con su ícono grande y «Cambiar proveedor» en el azul primario en la misma fila; en cada línea, el producto y «Quitar producto» (en rojo) en tres cuartos y un cuarto, o la elección a todo el ancho sin producto; la descripción en `SingleLineTextarea` con su cuenta «N/300»; «Agregar línea» y «Agregar pago» con `AddRowButton`; quitar en rojo; íconos en los botones e importes con «$», el total en verde. El proveedor se elige en el `EntityPickerDialog` de `GET /purchase-settlements/suppliers`, con los que no se pueden elegir deshabilitados y su motivo, y "Nuevo proveedor", que abre `PartyDialog` con el rol de proveedor marcado a la vista (elegir un tercero existente nunca le asigna el rol); la dirección del proveedor, propuesta desde el tercero al elegirlo sin reemplazar una escrita. Las líneas (`purchase-settlement-lines.tsx`) en una lista ordenada con agregar y quitar: un producto opcional en el selector de productos activos (bienes o servicios, `GET /products`), que propone el código, el código auxiliar y la descripción pero nunca el precio, o una línea libre; la descripción, la unidad de medida, la cantidad, el precio unitario de esta compra, el descuento opcional y el IVA en un `Select` sin selección inicial; con el borrador guardado, la base imponible y el IVA de la vista previa. Los pagos con la forma de pago, el total, el plazo y la unidad de tiempo, ninguno precargado, y la suma de los pagos frente al importe total. Los problemas de la vista previa van junto a su línea o su pago, o en "Antes de emitir". El resumen muestra los subtotales por tarifa, el subtotal sin impuestos, el descuento, el IVA por tarifa y el importe total del servidor, el aviso de la retención y las cuatro declaraciones que se confirmarán. El formulario valida solo el formato de lo escrito y nunca envía importes ni datos derivados. "Emitir liquidación de compra" (`purchaseSettlements.emit`) pide en un `ConfirmDialog` el resumen (ambiente, proveedor, importe total, líneas y pagos) y las cuatro declaraciones de la política, cada una con su texto completo y su propia casilla, con el aviso de que son declaraciones del usuario que el sistema no puede comprobar; sin las cuatro marcadas la confirmación queda deshabilitada, y no hay una casilla genérica. La emisión envía la versión de la política y las declaraciones; un rechazo las desmarca. La `Idempotency-Key` nace en la confirmación y se repite en el reintento de la misma versión. Los límites de recursos se presentan como límites del sistema, no del SRI.
- **Detalle** (`/liquidaciones-compra/{id}`, `purchaseSettlements.read`): `purchase-settlement-detail.tsx`, desde el snapshot: estado y número; el aviso de la retención; el proveedor congelado con su tipo de identificación y su dirección; la procedencia con las cuatro declaraciones "declaradas por" el usuario con su momento, que el sistema no puede comprobar; las líneas con su unidad, sus códigos, su descuento y su IVA; los pagos con su plazo; los totales por tarifa y la clave; el diagnóstico y el reintento de la firma (`purchaseSettlements.retrySigning`); la transmisión con la reconciliación (`purchaseSettlements.reconcile`) y los documentos compartidos.
- **Navegación:** "Liquidaciones de compra" en el grupo Operación (`purchaseSettlements.read`), después de Facturas.
- **Pruebas:** `frontend/test/purchase-settlements-screen.test.tsx`, `purchase-settlement-draft-editor.test.tsx`, `purchase-settlement-detail.test.tsx` y `app-shell.test.tsx`.

### La liquidación en la bandeja

- **Un tipo más en el registro.** `EMITTED_DOCUMENT_TYPES` incluye `03`, en el orden del filtro (factura, liquidación de compra, nota de crédito, nota de débito, guía de remisión y comprobante de retención), y `DOCUMENT_KINDS` guarda su nombre en las frases compartidas ("liquidación", en femenino: "la liquidación", "firmada", "autorizada"; `DocumentsSection` y `TransmissionSection` no cambian), el detalle `/liquidaciones-compra/{id}`, su API `/purchase-settlements`, el permiso `purchaseSettlements.reconcile`, el código `PURCHASE_SETTLEMENT_NOT_RECONCILABLE`, sus esquemas de vista y transmisión y el rótulo de su contraparte. El filtro "Tipo de comprobante" ofrece los seis tipos, con "Liquidación de compra" (`DOCUMENT_TYPE_LABELS`); el nombre de las descargas es `liquidacion-de-compra`.
- **Proveedor e importe.** El contrato de la bandeja no cambia: la liquidación lleva a su proveedor en las columnas genéricas del comprador (deuda registrada en `../quality/technical-debt.md`) y su importe total. La fila lo rotula "Proveedor" junto a su identificación, y la tarjeta móvil "Proveedor:" antes del nombre; nunca "Comprador". Las reglas de disponibilidad de los documentos siguen en el servidor: autorizada, el RIDE, la impresión, el XML autorizado y el firmado; firmada sin autorizar, solo el XML firmado (`frontend/test/documents-screen.test.tsx`, `purchase-settlement-sections.test.tsx`; `backend/test/integration/documents-six-types-api.test.ts` lista juntos los seis tipos y filtra por cada uno).

### RIDE de la liquidación

- **Lectura.** `ride-source.ts` lee la liquidación de compra 1.1.0 por su raíz (`liquidacionCompra`), su versión (`RIDE_PURCHASE_SETTLEMENT_VERSION`) y su `codDoc` 03, con una lista blanca de los elementos que escribe el builder: `reembolsos` y sus totales, `codDocReembolso`, `precioSinSubsidio`, `detallesAdicionales`, `maquinaFiscal`, `infoAdicional` o un impuesto distinto del IVA detienen la generación (`RIDE_SOURCE_UNSUPPORTED`, con el elemento); otra versión es `RIDE_SOURCE_INVALID`. El modelo `RidePurchaseSettlement` (`kind: "PURCHASE_SETTLEMENT"`) tiene el proveedor con su identificación y su dirección, la fecha de emisión, las líneas con su unidad, los pagos con su plazo y su unidad de tiempo y los totales de IVA. Las denominaciones de las formas de pago salen del snapshot (`payments[].officialLabel`), como en la factura.
- **Distribución propia** según la ficha v2.34, anexo 2, página 65, versión `liquidacion-compra-1` (`PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION`): la cabecera con "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS", su autorización y el Code128 de su clave; el emisor con sus leyendas; el proveedor ("Razón Social / Nombres y Apellidos", "Identificación", "Fecha Emisión" y "Dirección"); el detalle con "Cod. Principal" y "Cod. Auxiliar" cuando alguna línea los trae, cantidad, descripción, "Unidad" cuando alguna línea la trae, precio unitario, descuento y precio total; cada forma de pago con su plazo (`plazo` y `unidadTiempo`) y su valor; y los subtotales llenados por tratamiento de IVA, el subtotal sin impuestos, el IVA por tarifa y el valor total. No imprime "Placa / Matrícula", "Guía Remisión", "Detalle Adicional", "Subsidio" ni "Precio sin Subsidio", que el dibujo hereda de la factura, ni el total de descuentos, que el modelo no lleva. El encabezado del detalle se repite en cada página, ninguna fila se parte y los pagos y los totales pasan juntos a otra página si no caben.
- **Pruebas.** `test/sri-engine/ride/ride-purchase-settlement.test.ts` (golden del texto de las páginas en `backend/test/fixtures/purchase-settlement-ride/`, regenerables con `PURCHASE_SETTLEMENT_RIDE_UPDATE=1`; dos líneas al 15 % y al 0 % con dos pagos; sin los campos heredados; frente a la factura; sin códigos ni unidades; pasaporte, seis decimales y caracteres especiales; paginación con las 500 líneas del máximo absoluto; Code128; contenido no emitido; los mismos bytes en otro proceso) y `test/integration/purchase-settlement-ride.test.ts` (el RIDE nace con la autorización, se guarda una vez con su procedencia, se descarga verificado, la solicitud de impresión entrega el mismo y el historial registra las entregas). El job, el pool, las descargas y las entregas no cambian; el RIDE de los demás tipos tampoco.

### Medición de la liquidación

- Con `EMISSION_STAGE_TIMINGS=1`, `POST /api/v1/purchase-settlements` devuelve sus etapas en `Server-Timing` (`total`, `reservation_tx` y las de la firma compartida: `xml`, `xsd`, `sign`, `persist`), como los demás tipos; nunca en producción.
- `bench:purchase-settlements` (design D27) mide la búsqueda de proveedores y de productos, las opciones, la creación y la vista previa del borrador del peor caso con los valores por defecto (100 líneas y 10 pagos) y con los máximos absolutos (500 líneas y 20 pagos), con textos multibyte de longitud máxima, el cálculo versionado de 100 y de 500 líneas, la emisión en serie y la del peor caso (con el CPU y la memoria residente del backend), 10 rondas de 10 emisiones simultáneas a proveedores distintos y al mismo proveedor, la lista y la búsqueda de liquidaciones, la bandeja filtrada por la identificación del proveedor y el RIDE de una liquidación y del máximo de líneas; asienta la base con `VACUUM (ANALYZE)` y un `CHECKPOINT` después de la siembra, y termina comprobando que las liquidaciones no crearon movimientos de inventario ni comprobantes de retención y no cambiaron los terceros ni los productos (`../quality/performance.md`). El tamaño del XML firmado del peor caso es solo una medición de recursos, sin relación con Q-47. La ejecución del 2026-10-07 confirma los valores por defecto; con el máximo inicial de 1000 líneas, el RIDE del peor caso superaba su objetivo de 1 s, y el máximo absoluto se corrigió a 500 (design D22), con el que todas las operaciones cumplen su objetivo (`../quality/performance.md`).
- `test/integration/e2e-purchase-settlements.test.ts` recorre el flujo sobre `main.ts` con el SRI simulado: una liquidación a un proveedor con cédula, con una línea con un bien con control de existencias y otra libre, dos pagos con plazo y las cuatro declaraciones, autorizada con su RIDE en la bandeja con el proveedor como contraparte y en el filtro por su identificación, y con el proveedor, las líneas y los pagos con su plazo en sus XML, sin las declaraciones; otra liquidación que el SRI no autoriza y queda sin RIDE; el inventario, los terceros y la ausencia de comprobantes de retención sin cambios, la reconciliación del inventario sin diferencias y la auditoría de las liquidaciones limitada a su emisión.

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
- **Fuera del event loop.** La firma de XML es una tarea más de `CryptoWorkerPool` (`platform/workers`): CPU síncrona de 42 ms a 1,3 s según las iteraciones del P12 (spike S-6), y hasta unos 1,7 s con el techo de 131 072 iteraciones (ADR 0019, «Techo de iteraciones»). Usa la misma concurrencia acotada y el mismo timeout, y propaga `CRYPTO_BUSY` y `CRYPTO_TIMEOUT` como errores tipados.
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
- Un comprobante por envío, sin lotes, y nunca uno que exceda la política conservadora de tamaño (CTX §29, Q-47 resuelta por política de producto): menos de 40 000 bytes en el XML firmado, su base64 y el SOAP.
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
| Catálogos y políticas              | Entradas con vigencia, fuente y versión: impuestos, retenciones, formas de pago, consumidor final y endpoints por defecto (CTX §55). La política de tamaño es una constante del código, no un catálogo. |
| Casos especiales                   | Matriz de soporte por anexo con categorías explícitas; lo no soportado se rechaza antes de emitir (ADR 0014).      |
| Snapshot de cada comprobante       | Versiones de XSD, builder, catálogos, configuración de la empresa y renderer del RIDE (CTX §39).                  |
| Cambios normativos                 | Proceso de CTX §53 y checklist de CTX §54 antes de cada release; registro en el repositorio (Q-40).                |

## Firma

- Custodia del certificado en ADR 0011; parámetros de firma en ADR 0013.
- Puerto del firmador según CTX §20.3. Recibe el certificado descifrado solo en memoria y durante la firma.
- Validaciones previas de CTX §20.6 en cada firma, no solo al cargar el certificado.
- El servidor sincroniza su reloj por NTP o un mecanismo equivalente, con evidencia operativa de la infraestructura; la aplicación no mide la desviación (CTX §20.5; `deployment.md`, "Requisitos del servidor").

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
