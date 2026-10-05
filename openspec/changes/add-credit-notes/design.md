# Design

## Context

- **Motivación y alcance:** ver proposal.md. Q-10 y Q-20 están resueltas (`open-questions.md`); las reglas de negocio están en `domain-model.md` (BR-30, BR-33 a BR-35, BR-45, BR-59 a BR-62) y las decisiones previas en `fiscal-emission.md` (Decisiones para el diseño de `add-credit-notes`).
- **Ya es genérico por tipo de comprobante:**
  - numeración: un contador por empresa, ambiente, establecimiento, punto y tipo (`fiscal_sequence`, `reserveSequentialIn` con `documentType`), y el `CHECK` admite `04`;
  - clave de acceso (`sri-engine/infrastructure/access-keys.ts`, `documentType` como dato);
  - `electronic_document`, su máquina de estados, sus transiciones, sus artefactos y sus guardas; el snapshot es JSON libre, pero la transmisión exige `snapshot.key.accessKey` y que el artefacto firmado declare el mismo `documentType` y `schemaVersion` del comprobante;
  - validador XSD y firmador (`signDocument(companyId, xml, documentType)`; la librería mapea `04` a `NOTA_CREDITO`);
  - el registro de esquemas ya tiene `NotaCredito_V1.1.0.xsd` con `supported: true`;
  - transmisión: los handlers, los clasificadores (la autorización solo compara la clave del `<comprobante>`), la evidencia, la reconciliación y el barrido; el seguidor del RIDE;
  - bandeja: la lista y el detalle aceptan cualquier tipo, y las descargas, la impresión y las entregas también (`filenames.ts` ya nombra `nota-de-credito`).
- **Atado hoy a la factura:**
  - la firma (`invoices/application/signing-pipeline.ts`: `documentType "01"` en el esquema, el firmador y los metadatos del artefacto; builder y auditoría de factura);
  - la orquestación de la reserva (`emission.ts`), el registro de idempotencia (`CHECK operation IN ('invoice.emit')`);
  - la reconciliación manual (ruta, permiso `invoices.reconcile` y auditoría `invoice.reconciliation_completed` en `reconcile-handler.ts`);
  - el RIDE (`ride-source.ts` exige `factura` 1.1.0 y `codDoc 01`; el renderer dibuja "FACTURA"; el handler lee formas de pago del snapshot);
  - en el frontend, `AVAILABLE_TYPES = ["01"]`, `DETAIL_PATHS` y las secciones de documentos y transmisión, que reciben una factura.
- **Importes de la factura** (`invoices/domain/amounts.ts`, `decimal-policy.md`): subtotal exacto `cantidad × precio`; tres puntos de redondeo HALF_UP a 2 decimales (base de la línea, impuesto de la línea, totales); totales agrupados por código y tarifa desde los valores ya materializados. Cada línea del snapshot guarda `quantity`, `unitPrice`, `discount`, `subtotal` exacto, `taxableBase` y por impuesto `percentage`, `base` y `amount`; el comprador guarda `consumerFinal`.
- **Seguidores y recuperación:** `DocumentTransitionFollower` corre en la TX B de cada transición (autorización, reconciliación automática y manual); la TX A ya guardó la respuesta del SRI, y si la TX B falla el reintento la reclasifica sin llamar al SRI. Transiciones: `RETURNED`, `AUTHORIZED` y `NOT_AUTHORIZED` no tienen salida; `SEND_UNKNOWN` y `MANUAL_REVIEW` sí.

## Goals / Non-Goals

**Goals:**

- Una nota de crédito que reutiliza la reserva, la firma, la transmisión, la reconciliación, la bandeja y el RIDE, con lo genérico extraído una vez y lo propio del tipo aislado.
- La factura no cambia: mismos snapshot, XML, artefacto y respuestas para los mismos datos.
- Capacidades acreditable y devolvible con defensa en la base, ciclo de vida transaccional e idempotente, y sin estados huérfanos.
- Importes exactos sin deriva de centavos, con golden tests.

**Non-Goals:**

- Un pipeline genérico para los seis tipos: solo se generaliza lo que la nota necesita.
- Reetiquetar métricas existentes o cambiar la clasificación del SRI.
- Corregir una nota devuelta (`correct-returned-document`): si llega, deberá volver a reservar capacidad.

## Decisions

### D1. Módulo `credit-notes` y dirección de las dependencias

- Módulo nuevo `credit-notes` con `domain/`, `application/` e `infrastructure/`, como `invoices`.
- Depende de lecturas y operaciones exportadas: de `fiscal` (reserva compartida, documentos, artefactos, firma genérica, reconciliación, transmisión), de `invoices` (la lectura de la factura para la nota, D3), de `taxpayer`, `catalogs` y `signing` (inyectada, como en `invoices`).
- `fiscal`, `invoices` e `inventory` no importan `credit-notes`. El inventario recibe sus datos por un puerto (D10) y por sus propias filas.
- `main.ts` compone el módulo, sus seguidores y los puertos. Una prueba de arquitectura comprueba la dirección, como la del inventario.
- **Alternativa descartada:** extender el módulo `invoices`. La nota tiene su propio borrador, cálculo, capacidad y ciclo de vida; mezclarlos agranda un módulo que ya es el más grande y acopla dos tipos que cambian por razones distintas.

### D2. Qué se generaliza y qué queda por tipo

| Pieza | Decisión |
| --- | --- |
| Reserva del comprobante | `fiscal/application/document-reservation.ts` (`reserveDocumentIn`): secuencial, bloqueo de la identidad tributaria, clave, `insertReserved` y transición a `RESERVED`, con el tipo como dato. `invoices` pasa a usarla sin cambiar su comportamiento. |
| Firma | El pipeline pasa a `fiscal/application/signing-pipeline.ts`, parametrizado por un perfil por tipo: tipo, builder del XML desde el snapshot, versión del builder y acciones de auditoría. El esquema sale del snapshot y el tipo del comprobante. `invoices` y `credit-notes` registran su perfil; `main.ts` los compone. |
| Idempotencia | `credit_note.emit` en `IDEMPOTENT_OPERATIONS` y en el `CHECK` de `idempotency_record`. |
| Reconciliación manual | La solicitud ya es genérica en `fiscal`; cada módulo expone su ruta y su permiso. La auditoría de finalización en `reconcile-handler.ts` elige la acción por tipo (`invoice.*` o `credit_note.*`). |
| RIDE | Lectura y distribución por raíz y versión (D14); el handler lee las formas de pago solo si el snapshot las tiene. |
| Por tipo | Borrador, evaluación, snapshot, builder XML, distribución del RIDE, capacidad acreditable y devolvible, rutas y pantallas. |

- **Refactor protegido.** La generalización va primero, en su propio grupo, después de fijar el contrato de regresión de la factura con las pruebas existentes y fixtures deterministas: la misma reserva, la misma clave, el mismo comportamiento del snapshot, el mismo XML byte a byte, la misma validación XSD, la misma firma, los mismos hashes de artefacto para entradas deterministas, las mismas transiciones, los mismos errores y la misma idempotencia. La factura no cambia para "ser más genérica" si la nota no lo necesita.
- **Interfaces pequeñas, sin conmutador central.** Orquestación y primitivas compartidas, y por tipo solo lo que difiere, en interfaces separadas por responsabilidad: el builder del XML (snapshot → bytes), la metadata de la firma (tipo, versión del builder, acciones de auditoría), la lectura y la distribución del RIDE, y los seguidores de las transiciones. Ningún tipo implementa funciones que no usa, y no hay un `switch` por `codDoc` que concentre las diferencias.
- **Alternativa descartada:** copiar el pipeline de firma en `credit-notes`. Duplica la etapa más delicada (arriendo, diagnóstico, artefacto, transición, encolado) y dos copias divergen.

### D3. Lectura inmutable de la factura

- `invoices` exporta `invoiceCreditSource(db).find(companyId, invoiceId)`: identificador, tipo, número, fecha de emisión, clave, número, fecha y ambiente de la autorización, estado, `consumerFinal`, comprador, líneas (posición, producto, códigos, descripción, cantidad, precio, descuento, subtotal exacto, base, impuestos con código, tarifa, porcentaje, base e importe, `inventoryAffectsStock`), totales y versión del snapshot.
- La integridad de la factura se comprueba con el almacén de artefactos de `fiscal`: `SIGNED_XML` y, si existe, `AUTHORIZED_XML` con su SHA-256 y tamaño, además de la versión y la forma del snapshot. Se comprueba al crear o actualizar el borrador (su vista previa la informa como problema que bloquea) y otra vez antes de emitir. Una diferencia falla cerrada: no se emite, y nunca se repara con el producto o el tercero vigentes.
- La nota nunca lee el producto, el tercero, el catálogo ni la configuración para un importe histórico. Los datos del emisor de la nota sí son los vigentes al reservarla: es un comprobante nuevo, emitido hoy, con la misma identidad tributaria bloqueada.

### D4. Orden de las comprobaciones antes de reservar

- **Antes de la transacción**, sin consumir secuencial, clave, firma ni llamada al SRI: permiso → empresa de la sesión → factura existente en la empresa (`404` igual que inexistente) → estado `AUTHORIZED` → snapshot y artefactos íntegros → no consumidor final → causa → motivo → forma de las líneas y cantidades → retorno físico permitido por línea → declaraciones completas y de la versión vigente → empresa preparada, punto disponible, firma utilizable y esquema registrado → cálculo y comprobación preliminar de las capacidades.
- **Transacción de `RESERVED`**, sin I/O externo dentro del bloqueo: bloquear la factura (y su capacidad) → recalcular con lo reservado y aplicado vigente (D6) y comprobar → reservar la capacidad acreditable → reservar la capacidad devolvible → reservar el secuencial → componer la clave → crear el snapshot inmutable → crear el comprobante `RESERVED` y su transición → registro de idempotencia → auditoría → commit. La construcción del XML, la firma y la red ocurren después del commit.
- **Todo o nada:** si cualquier paso falla, no queda capacidad reservada, secuencial consumido, clave, comprobante parcial ni snapshot de declaraciones. Una prueba lo comprueba forzando el fallo después de cada paso.

### D5. Borrador, causas y emisión

- **Borrador:** `credit_note_draft` (empresa, factura, punto de emisión, causa `TOTAL_ANNULMENT` o `RETURN`, motivo, versión, estado `DRAFT`/`EMITTED`, comprobante) y `credit_note_draft_line` (línea de la factura, cantidad acreditada, retorno físico). En `TOTAL_ANNULMENT` la cantidad acreditada de cada línea es la completa y no se elige; las líneas solo llevan el retorno físico, que el usuario declara de 0 a la cantidad original en los bienes cuya línea afectaba al inventario, siempre 0 en los servicios y en las demás, y sujeto a la capacidad devolvible. Nunca se asume un retorno total.
- **Anulación total estricta:** solo si la capacidad acreditable de la factura tiene reservado = 0 y aplicado = 0. Después de cualquier devolución, aunque sea mínima, no procede.
- El punto de emisión lo elige el usuario; por defecto, su punto predeterminado. La norma no exige el punto de la factura.
- La vista previa la calcula el servidor en cada lectura del borrador con la capacidad vigente (D6, D7, D10) y lista los problemas por línea; el borrador no reserva nada.
- **Emisión:** `POST /credit-notes` con `Idempotency-Key` y `{ draftId, expectedVersion, declarations: { version, statements } }`. La huella cubre los tres. La causa es un enum cerrado; el motivo es texto de una línea (1 a 300, `[^\n]*` del XSD) que nunca selecciona comportamiento.

### D6. Cálculo exacto de las líneas acreditadas

- **Una sola primitiva fiscal, versionada:** `calculateCreditNoteAmounts` en `credit-notes/domain/` (versión de cálculo `1`, guardada en el snapshot). Recibe solo el estado fiscal inmutable de la línea, lo acreditado vigente y las cantidades pedidas, y devuelve por línea la cantidad acreditada, el subtotal, el descuento atribuible, la base, las bases y los importes de cada impuesto y el total; los totales del documento; y los valores de capacidad resultantes. La vista previa, la emisión (que congela su resultado en el snapshot), la comprobación de la capacidad y la pantalla usan ese resultado. El builder del XML solo transcribe el snapshot y el frontend solo muestra lo que devuelve el servidor: ninguno calcula.

Para cada línea de la factura con cantidad `Q`, precio `p`, descuento `D`, subtotal exacto `S`, base `B` e impuestos `T_i` (porcentaje `pct_i`), y para una cantidad acumulada `C` (acreditada vigente más la pedida):

- **Objetivos acumulados**, con `round` = HALF_UP a 2 decimales y decimal exacto (`platform/decimal`, sin `number`):
  - `sub(C) = C × p` (exacto);
  - `disc(C) = min(D, round(D × C / Q))`;
  - `base(C) = min(B, round(sub(C) − disc(C)))`;
  - `tax_i(C) = min(T_i, round(base(C) × pct_i / 100))`;
  - en `C = Q`, cada objetivo es exactamente el original (`S`, `D`, `B`, `T_i`).
- **Línea de la nota:** cantidad pedida `q`, precio `p`, y para cada importe `X` (subtotal, descuento, base, cada impuesto): `X_nota = objetivo_X(C) − Σ X de las notas vigentes de esa línea` (reservadas y aplicadas).
  - Así la suma de las notas vigentes de una línea es siempre su objetivo acumulado, y la que completa la línea toma exactamente el remanente, aunque una nota anterior se haya liberado.
  - Cada importe de la nota difiere de la fórmula ingenua (`round(q × p − descuento)`, `round(base × pct)`) en menos de un centavo, y la diferencia no se acumula entre notas.
  - Si algún importe resultara negativo, la nota se rechaza (`CREDIT_NOTE_LINE_AMOUNT_NEGATIVE`) indicando la línea.
- **Anulación total:** `C = Q` en todas las líneas sin crédito previo: cada línea copia la original.
- **Totales de la nota:** `totalSinImpuestos = Σ base`; `totalConImpuestos` agrupado por código y tarifa con `Σ base` y `Σ impuesto`; `valorModificacion = totalSinImpuestos + Σ impuestos`. En una anulación total es exactamente el total de la factura.
- **Invariante de particiones:** para cualquier partición válida de la cantidad original en notas sucesivas, al acreditar la totalidad, la suma de cada componente materializado de las notas (subtotal, descuento, base, cada base e importe de impuesto) es igual al componente original. La garantizan los objetivos acumulados; si una regla del XSD o del SRI impidiera mantenerla para un campo, la implementación se detiene y documenta la contradicción: no hay ajustes arbitrarios de centavos ni líneas de redondeo.
- **Impuestos:** la factura del MVP solo emite IVA (ICE e IRBPNR no tienen datos de cálculo y la emisión los rechaza), así que la nota solo acredita IVA; las pruebas no inventan ICE ni IRBPNR.
- **Property tests** con un generador determinista con semilla (como el de los benchmarks, sin dependencias nuevas) sobre particiones aleatorias de cantidades de hasta 6 decimales, con descuentos originales e IVA, y secuencias de notas parciales con liberaciones intermedias: la invariante de particiones y que ningún importe es negativo.
- **Golden tests** (`backend/test/credit-notes/amounts.test.ts`), entre otros:
  - línea 3 × 10.00 con descuento 3.00 e IVA 15 %: completa (27.00, 4.05); una unidad (descuento 1.00, base 9.00, IVA 1.35); tres notas de una unidad que suman 27.00 y 4.05;
  - línea 3 × 3.333333 sin descuento (base 10.00, IVA 1.50): notas de una unidad con bases 3.33, 3.34 y 3.33 e IVA 0.50 cada una; suman 10.00 y 1.50;
  - varias líneas con varias tarifas; cantidades de 6 decimales (`0.333333` de `1.000000`); remanente después de liberar una nota; acumulación que intenta exceder la línea; descuento casi total con cantidad mínima (importe negativo rechazado).

**Alternativa descartada:** calcular cada nota con la fórmula ingenua y que solo la última tome el remanente. Con muchas notas, la última absorbe la suma de todos los redondeos (más de un centavo), y una nota liberada deja una diferencia que nadie corrige.

### D7. Capacidad acreditable y su ciclo de vida

- **Modelo** (tablas de `credit-notes`):
  - `credit_capacity` (empresa, factura): total original, reservado y aplicado; `CHECK reservado ≥ 0, aplicado ≥ 0, reservado + aplicado ≤ original`; el original no cambia (trigger).
  - `credit_capacity_line` (empresa, factura, posición): producto, cantidad original, reservada y aplicada, con el mismo `CHECK` sobre cantidades.
  - `credit_reservation` (una por nota, única por comprobante): factura, causa, importe, estado `RESERVED` → `APPLIED` o `RELEASED`, momentos; solo esas dos transiciones (trigger), de solo agregado en lo demás.
  - `credit_reservation_line`: línea, cantidad, importes acreditados (subtotal, descuento, base, impuestos) y retorno físico; inmutable. Es la fuente de "lo acreditado vigente" del D6.
- **Inicialización perezosa e idempotente:** la primera reserva sobre una factura crea sus filas de capacidad desde el snapshot (`INSERT ... ON CONFLICT DO NOTHING`) bajo el bloqueo de la factura. No hay backfill: las facturas existentes se inicializan al recibir su primera nota, y nunca se tocan la factura ni sus artefactos.
- **Reserva** (en la transacción de `RESERVED`, después del bloqueo): sumar a reservado el importe y las cantidades con incrementos atómicos; un exceso viola el `CHECK` y la transacción se revierte sin número. La anulación total exige reservado + aplicado = 0 y reserva el total y todas las cantidades.
- **Fallar cerrado:** la capacidad sigue reservada en `RESERVED`, `SIGNED`, `RECEIVED`, `SEND_UNKNOWN` y `MANUAL_REVIEW`. Nunca se libera por tiempo, por un job detenido, por un error de transporte o del parser, por reintentos agotados ni por una caída del proceso: un problema operacional no demuestra que el SRI rechazó la nota. No existe un job de limpieza que libere reservas por antigüedad; una nota incierta reserva hasta que una reconciliación concluye.
- **Reservas de solo agregado:** cada nota tiene su fila de reserva, que solo pasa de `RESERVED` a `APPLIED` o `RELEASED` y nunca se borra ni se reutiliza para otra nota; las filas liberadas quedan como evidencia. Los totales materializados de la capacidad son la suma de sus reservas por estado.
- **Aplicación y liberación:** un seguidor de `credit-notes` en la TX B de la transición de la nota:
  - a `AUTHORIZED`: `UPDATE credit_reservation SET status = 'APPLIED' WHERE id = … AND status = 'RESERVED'`; si cambió una fila, mueve importe y cantidades de reservado a aplicado;
  - a `RETURNED` o `NOT_AUTHORIZED`: lo mismo con `RELEASED`, restando de reservado;
  - a cualquier otro estado: nada. Una repetición no cambia filas (la actualización guardada no coincide), así que no aplica ni libera dos veces.
- **Recuperación:** si la transición terminal falla localmente después de conocer el resultado del SRI, la respuesta ya está guardada, el reintento la reclasifica y vuelve a intentar la transición; aplicar y liberar son idempotentes.
- Los totales de la capacidad son siempre la suma de sus reservas por estado; la reconciliación diagnóstica (`reconcileCreditCapacity`, solo pruebas y benchmark) lo comprueba.
- **Capacidades independientes:** la acreditable responde cuánto de la factura y de cada línea se puede acreditar todavía; la devolvible (D10), cuánto de lo que salió del inventario puede volver. Ninguna se deriva de la otra. Ejemplo: factura de 10 unidades con salida de 10; nota que acredita 5 con retorno físico 2; al autorizarse quedan 5 acreditables y 8 devolvibles.

### D8. Concurrencia

- La reserva toma `pg_advisory_xact_lock` de la factura (`credit-capacity:{empresa}:{factura}`) antes de leer lo acreditado vigente y calcular. Dos notas de la misma factura se serializan; la segunda calcula con la reserva de la primera ya confirmada.
- Los incrementos atómicos con `CHECK` son la última defensa si algún camino olvidara el bloqueo.
- **Orden de bloqueos:** en la reserva, capacidad acreditable de la factura y después capacidad devolvible por producto en orden de `productId` (D10). En la TX B de la nota, el seguidor de la capacidad acreditable corre antes que el del inventario, que bloquea capacidad devolvible y saldos en orden de `productId`. Ningún camino toma estos bloqueos en otro orden, y la salida de la factura solo bloquea saldos.
- Pruebas con PostgreSQL real, entre otras (línea de 10 unidades):
  - A: devolución A reserva 6; devolución B pide 5 → B falla antes de reservar número;
  - B: A reserva 6 y B reserva 4 → ambas válidas;
  - C: A reservada y una anulación total → la anulación se rechaza;
  - D: anulación total reservada y una devolución simultánea → la devolución se rechaza;
  - E: A termina no autorizada → su capacidad se libera y una devolución nueva la consume;
  - F: A queda verificando con el SRI → su capacidad sigue reservada y una devolución nueva no la consume;
  - G: dos retornos físicos simultáneos nunca exceden la `SALIDA_FACTURA`;
  - además: dos anulaciones totales, devolución con remanente exacto, nota autorizada contra otro movimiento del producto, fallo después de la autorización externa y antes del commit local, repetición y reclasificación, y liberación al terminar devuelta.

### D9. Declaraciones de elegibilidad

- Una política versionada en `@facturador/contracts` (`CREDIT_NOTE_ELIGIBILITY_DECLARATION`, versión `1`) con dos afirmaciones de identificador estable: `NOT_NEGOTIATED_COMMERCIAL_INVOICE` y `NOT_TAX_REFUND_SUPPORT`, cada una con su texto y su fuente (disposiciones generales segunda y tercera de la NAC-DGERCGC25-00000014).
- La emisión exige la versión vigente y las dos afirmaciones; el snapshot guarda `declarations: { version, statements, declaredBy, declaredAt, basis: "USER_DECLARED" }`. Nunca hay `SYSTEM_VERIFIED`.
- La semántica son los identificadores y la versión, no el texto visible. La interfaz muestra cada afirmación completa, con su contexto (qué es una factura comercial negociable negociada, qué es sustentar una devolución de impuestos) y la advertencia de que es una declaración del usuario, no una comprobación del sistema; nunca casillas genéricas. Un cambio del texto legal es una versión nueva de la política.
- Una exclusión que el sistema conoce (consumidor final, D4) se evalúa antes y no depende de las declaraciones.

### D10. Capacidad devolvible y devolución de stock

- **Modelo** (tablas de `inventory`):
  - `stock_return_capacity` (empresa, factura, producto): salida original (el valor absoluto de la `SALIDA_FACTURA` de esa factura y ese producto), reservado y aplicado; `CHECK reservado + aplicado ≤ salida`.
  - `stock_return_reservation` (empresa, nota, producto): factura, cantidad, estado `RESERVED` → `APPLIED` o `RELEASED`, con las mismas guardas que D7.
- **Puerto `ReturnCapacity`**, implementado por `inventory` e inyectado en `credit-notes` por `main.ts`: `reserve(db, { companyId, invoiceId, creditNoteId, returns })` en la transacción de la reserva de la nota. Bloquea por producto en orden estable, crea la capacidad desde la salida de la factura si falta (`INSERT ... ON CONFLICT DO NOTHING`; sin salida, la capacidad es cero y cualquier retorno se rechaza) y suma lo reservado.
- **Seguidor del inventario** en la TX B de la nota, que lee solo sus filas de reserva:
  - a `AUTHORIZED`: agrupa por producto con suma exacta, bloquea los saldos en orden de `productId`, agrega una `DEVOLUCION_NC` positiva por producto (origen sistema, comprobante = la nota, número de la nota), suma al saldo y pasa la reserva a aplicada con una actualización guardada;
  - a `RETURNED` o `NOT_AUTHORIZED`: libera;
  - el saldo existe siempre, porque la línea afectaba al inventario cuando se reservó la factura y un saldo nunca se borra; el control actual no se consulta; un saldo negativo no impide la devolución.
- La unicidad vigente `(company_id, document_id, product_id, movement_type)` impide una segunda devolución por nota y producto. La recuperación es la de la salida de la factura: la TX B se revierte entera y el reintento reclasifica la respuesta guardada.
- `inventory` no importa `credit-notes`: el número de la nota lo lee de `fiscal`, como el de la factura.
- La capacidad devolvible es independiente de la acreditable (D7): `retorno físico ≤ cantidad acreditada` por línea, y `devuelto aplicado + reservado + pedido ≤ salida original` por producto.

### D11. Numeración, clave e idempotencia

- Tipo `04`; contador por empresa, ambiente, establecimiento, punto y tipo, con la reserva atómica vigente (fiscal-numbering). La nota no comparte contador con la factura.
- La clave se compone con la misma función, con `documentType: "04"`, en la reserva, y se guarda en `snapshot.key.accessKey`, la ruta que la transmisión comprueba.
- Idempotencia: operación `credit_note.emit`, alcance empresa, operación y clave, sin TTL; el registro se inserta en la transacción de `RESERVED`, como `invoice.emit`. La huella canónica cubre `draftId`, `expectedVersion` (que fija la factura, la causa, el punto, las líneas, el retorno físico y el motivo) y las declaraciones con su versión. Repetición con la misma huella: la misma nota, también si ya quedó reservada (se reanuda la firma); otra huella: `409 IDEMPOTENCY_KEY_REUSED`.

### D12. Builder XML `notaCredito` 1.1.0

- `sri-engine/infrastructure/credit-note-xml-builder.ts`, puro y determinista, con versión de builder `1`. Mapea únicamente desde el snapshot de la nota y no usa el builder de alto nivel de la dependencia. El pipeline valida contra el XSD antes y después de firmar, como en la factura.
- Reutiliza `xml-writer.ts` (escape y caracteres prohibidos), el `infoTributaria` extraído del builder de la factura (con `codDoc` como dato) y el texto decimal exacto del snapshot, sin formatear importes.
- `infoNotaCredito`: fecha, establecimiento, comprador, contribuyente especial, contabilidad, `codDocModificado` 01, `numDocModificado`, `fechaEmisionDocSustento`, `totalSinImpuestos`, `valorModificacion`, `moneda` DOLAR, `totalConImpuestos` y `motivo`; `detalles` con código interno y adicional opcionales, descripción, cantidad, precio, descuento, total sin impuesto e impuestos con tarifa.
- Golden fixtures (bytes exactos) y validación contra el XSD oficial en las pruebas; la firma reutiliza el firmador con `04`.

### D13. Transmisión y reconciliación

- Sin cambios en el transporte, la cola, los clasificadores ni la máquina de reconciliación. Casos de contrato y extremo a extremo con una nota de crédito: recibida, devuelta, error 70, errores 43 y 45, tiempo agotado o resultado incierto, autorizada, no autorizada, revisión manual, reclasificación de la respuesta guardada y reconciliación manual. Una nota incierta conserva su capacidad.
- Rutas de la nota: historial de la transmisión (`TransmissionReader`, sin filtro de tipo) y reconciliación manual (`creditNotes.reconcile`), que usan las operaciones de `fiscal`.
- `invoice_authorization_latency_seconds` ya observa cualquier comprobante; `observability.md` lo documenta. No se reetiqueta.

### D14. RIDE de la nota de crédito

- Lectura `notaCredito` 1.1.0 en `sri-engine/infrastructure/ride/` con su lista blanca (los elementos que el builder escribe, solo IVA) y un modelo `RideCreditNote` (los datos de la factura más el comprobante modificado, su fecha, la razón y el valor de la modificación, sin formas de pago).
- El renderer elige la lectura y la distribución por raíz y versión (`factura` 1.1.0, `notaCredito` 1.1.0); cada distribución tiene su versión de renderer.
- La distribución sigue la ficha v2.34, anexo 2, página 61: cabecera con RUC, "NOTA DE CRÉDITO", número, autorización, ambiente, emisión y clave con Code128; emisor; comprador; bloque del comprobante que se modifica (FACTURA, número, fecha) y razón de la modificación; detalle; información adicional; subtotales con el valor total.
- Reutiliza pdfmake, bwip-js, Noto Sans, la paginación, el pool de workers (sin duplicarlo), el job, el modelo de artefactos y las entregas. El Code128 codifica la clave de la nota, nunca la de la factura. Las pruebas leen el Code128 y comprueban el texto de las páginas con golden propios de la nota.

### D15. Bandeja y frontend compartido

- `AVAILABLE_TYPES = ["01", "04"]`: aparece el filtro de tipo, conectado a la API, y el tipo bajo el número. `DETAIL_PATHS["04"] = "/notas-credito"`.
- `DocumentsSection` y `TransmissionSection` reciben el comprobante (identificador, tipo, estado) en lugar de una factura, con textos por tipo; la factura las usa igual que antes.
- Las reglas de disponibilidad no cambian: RIDE solo de un comprobante autorizado, XML autorizado solo si su artefacto existe, y el XML firmado siempre distinto del autorizado. Los documentos históricos de factura siguen igual.

### D16. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/credit-notes/eligible-invoices` | Facturas autorizadas sin consumidor final y con capacidad, con búsqueda por número o comprador | `creditNotes.draft` |
| `GET /api/v1/credit-notes/invoices/{invoiceId}/credit` | Crédito de una factura: aplicado, reservado, disponible y por línea | `creditNotes.read` |
| `GET/POST /api/v1/credit-notes/drafts`, `GET/PUT/DELETE /api/v1/credit-notes/drafts/{draftId}` | Borradores con su vista previa | `creditNotes.draft` |
| `POST /api/v1/credit-notes` | Emisión con `Idempotency-Key` (`201`, o `200` en la repetición) | `creditNotes.emit` |
| `GET /api/v1/credit-notes`, `GET /api/v1/credit-notes/{creditNoteId}` | Consulta y detalle | `creditNotes.read` |
| `GET /api/v1/credit-notes/{creditNoteId}/transmission` | Historial de la transmisión | `creditNotes.read` |
| `POST /api/v1/credit-notes/{creditNoteId}/signing-attempts` | Reintento de firma | `creditNotes.retrySigning` |
| `POST /api/v1/credit-notes/{creditNoteId}/reconciliations` | Reconciliación manual (`202`) | `creditNotes.reconcile` |

- Códigos: `CREDIT_NOTE_INVOICE_NOT_ELIGIBLE`, `CREDIT_NOTE_CONSUMER_FINAL`, `CREDIT_NOTE_INVOICE_INTEGRITY`, `CREDIT_NOTE_CAUSE_INVALID`, `CREDIT_NOTE_LINE_INVALID`, `CREDIT_NOTE_QUANTITY_EXCEEDED`, `CREDIT_NOTE_AMOUNT_EXCEEDED`, `CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE`, `CREDIT_NOTE_PHYSICAL_RETURN_INVALID`, `CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED`, `CREDIT_NOTE_LINE_AMOUNT_NEGATIVE`, `CREDIT_NOTE_DECLARATIONS_REQUIRED`, `CREDIT_NOTE_DRAFT_CHANGED`, más los de la emisión (`IDEMPOTENCY_KEY_*`, firma, punto, esquema).
- Consultas no estrictas; cuerpos estrictos (un `companyId` se rechaza). Cantidades e importes como texto decimal.

### D17. Permisos

- `creditNotes.read`, `creditNotes.draft`, `creditNotes.emit` y `creditNotes.retrySigning`: administrador y operador (ERS: el operador emite comprobantes). Quien emite confirma las declaraciones.
- `creditNotes.reconcile`: administrador, como `invoices.reconcile`.
- Cada caso de uso exige su permiso en el servidor antes de leer o escribir; la empresa sale siempre de la sesión, nunca de un `invoiceId` o `companyId` del cliente.
- Bandeja y descargas: `archive.*` vigentes. Matriz en `access-control.md` y espejo en el frontend.

### D18. Auditoría

- `credit_note.reserved` (nota, número, clave, ambiente, valor de la modificación, factura y su número, causa, versión de la declaración y afirmaciones, y los hechos funcionales seguros: número de líneas acreditadas y si hay retorno físico), `credit_note.signed`, `credit_note.signing_retried`, `credit_note.reconciliation_requested` y `credit_note.reconciliation_completed`. Sin XML ni datos innecesarios del comprador.
- Sin eventos para borradores, consultas, transmisión automática, aplicación o liberación de capacidad, devolución de stock ni entregas: su evidencia son la capacidad, las transiciones, el kárdex y el historial de entregas.

### D19. Pantallas

- **Notas de crédito** (`/notas-credito`, en "Operación"). Brief: administrador u operador; objetivo, encontrar una nota y su estado; decisión, qué nota abrir; información mínima, número, factura modificada, causa, comprador, valor y estado; acción principal, abrir la nota; secundaria, "Nueva nota de crédito". P0 número, estado y valor; P1 factura, causa, comprador y fecha; P2 búsqueda y filtros; P3 identificadores, no se muestran. `AppDataTable` con paginación del servidor, filtros en la URL y tarjetas por debajo de 768 px.
- **Borrador** (`/notas-credito/borradores/{id}`). Brief: corregir una venta autorizada sin equivocar importes ni existencias; decisión, causa, líneas, cantidades y retorno físico; información mínima, factura, lo acreditable por línea, importes de la nota y problemas; acción principal, "Emitir nota de crédito". Pasos: elegir la factura (selector con búsqueda), la causa (`SegmentedControl` de dos opciones), las líneas y cantidades en una devolución (en una anulación total no se eligen), el retorno físico donde se permite (deshabilitado con su explicación en servicios y en líneas que no afectaban al inventario), el motivo y el punto. La emisión pide en un `ConfirmDialog` las dos declaraciones como casillas separadas, con su texto y su fuente, que dice que son declaraciones del usuario; sin ambas no se emite. Vista previa del servidor con los problemas junto a su línea.
- **Detalle** (`/notas-credito/{id}`): estado, factura modificada con enlace, causa, motivo, líneas con su retorno físico, declaraciones "declaradas por" el usuario, diagnóstico y reintento de firma, transmisión y documentos.
- **Factura:** en su detalle, el crédito aplicado, reservado y disponible, y la acción "Emitir nota de crédito" cuando la factura es elegible y el usuario tiene permiso.
- Se cubren carga, vacío, error, sin permiso, éxito, responsive, teclado y los dos temas, y el doble clic que envía una sola emisión.

### D20. Observabilidad

- `credit_note_reservations_total{cause}` (reservas confirmadas) y `credit_note_reservation_conflicts_total{reason}` (rechazos por capacidad: cantidad, importe, anulación total, retorno físico); sin empresa ni comprobante como etiqueta.
- La transmisión, el RIDE y el inventario usan sus métricas vigentes; la devolución cuenta en `inventory_movements_total{type="DEVOLUCION_NC"}`.
- Alerta propuesta: reservas de capacidad sin conclusión durante más de 24 horas (`credit_reservation` en `RESERVED` con su nota en un estado terminal, que no debería existir; o una nota en revisión manual con capacidad reservada).

### D21. Rendimiento

- `bench:credit-notes`, fuera de `verify`, sobre un esquema aislado con 100 000 facturas, 10 000 de ellas con créditos previos de varias líneas. Mide por separado: búsqueda de facturas elegibles, vista previa del borrador, reserva sin créditos previos, reserva con créditos previos, cálculo de una devolución parcial de muchas líneas, reservas que compiten por la misma factura, reservas simultáneas de facturas distintas y RIDE de la nota. Para la contención informa el rendimiento (reservas por segundo) y la espera por bloqueos cuando es material. Termina con la reconciliación de las capacidades sin diferencias. Objetivo: ERS RNF-005 (P95 menor que 2 s) donde aplica, y el P95 del render del RIDE menor que 1 s como el de la factura. Ningún bloqueo se mantiene durante el XML, la firma ni la red.

### D22. Migraciones

- Una migración aditiva: borradores de nota y sus líneas; `credit_capacity`, `credit_capacity_line`, `credit_reservation`, `credit_reservation_line`; `stock_return_capacity` y `stock_return_reservation`; `credit_note.emit` en el `CHECK` de `idempotency_record`.
- Triggers de inmutabilidad y de transición de estado de las reservas; FK compuestas por empresa; sin índices parciales (la prueba de deriva de Prisma).
- Sin backfill ni cambios a facturas, artefactos o movimientos existentes. La capacidad de una factura existente nace con su primera nota (D7, D10).

### D23. Operaciones sensibles

| Pregunta | Borrador y vista previa | Emisión (reserva) | Aplicación y liberación | Devolución de stock |
| --- | --- | --- | --- | --- |
| Quién | `creditNotes.draft` | `creditNotes.emit` | El sistema, en la transición | El sistema, al autorizar |
| Empresa | La de la sesión | La de la sesión | La del comprobante | La del comprobante |
| Propiedad | Factura y borrador por `(company_id, id)` | Igual, y capacidad por factura | Reserva por nota | Reserva por nota y producto |
| ¿Otro ID llega a otra empresa? | No: `404` | No: `404` | No | No |
| Dos veces | Versión del borrador | `Idempotency-Key` | Actualización guardada por estado | Unicidad por nota y producto |
| A la vez | Versión | Bloqueo de la factura y `CHECK` | La TX B de la nota | Bloqueos por producto en orden |
| Restricciones | Forma y cantidades | `CHECK` de capacidades, idempotencia | Triggers de transición | `CHECK` de capacidad devolvible, unicidad |
| Auditoría | No | `credit_note.reserved` | No | No (kárdex) |

### D24. Snapshot autosuficiente de la nota

- Después de `RESERVED`, la verdad fiscal de la nota es su snapshot; nunca se relee la factura para reconstruir sus importes. La factura solo se lee para integridad y relaciones.
- Guarda como mínimo: causa; motivo; identidad de la factura (identificador, tipo, número, fecha, clave, número y fecha de autorización, ambiente); por línea, la posición de la línea original, el producto, los códigos, la descripción, la cantidad acreditada, el retorno físico y los importes e impuestos resultantes del cálculo; los totales y el valor de la modificación; la versión del cálculo; las declaraciones con su versión, actor y momento; los datos del emisor vigentes al reservar; el comprador de la factura; el punto, el establecimiento, el secuencial, el código numérico y la clave (`key.accessKey`); y las versiones del esquema, del builder, de los datasets y de la configuración.

### D25. Coherencia atómica de la transición terminal

- En `AUTHORIZED`, la misma TX B deja juntos: el comprobante autorizado con su metadata y su artefacto, la reserva acreditable en `APPLIED`, las reservas devolvibles en `APPLIED`, las `DEVOLUCION_NC` y los saldos actualizados; o ninguno.
- En `RETURNED` o `NOT_AUTHORIZED`, la misma TX B deja juntos la transición y las reservas acreditable y devolvibles en `RELEASED`, sin movimientos.
- **Triggers de restricción diferidos** lo imponen al confirmar: una reserva `APPLIED` exige su nota `AUTHORIZED`; una `RELEASED`, su nota `RETURNED` o `NOT_AUTHORIZED`; y una nota de crédito en un estado terminal no puede tener reservas en `RESERVED`. Es un acoplamiento en la base entre `electronic_document` y las reservas, intencional para que nunca exista un estado local intermedio, y lo documenta `database.md`.

## Risks / Trade-offs

- [Un importe de línea de una nota parcial puede diferir en menos de un centavo de la fórmula ingenua, y el SRI podría validar la aritmética de la línea] → La diferencia está acotada y no se acumula (D6); los golden tests la fijan; la matriz de certificación en Pruebas del SRI incluye devoluciones parciales con redondeo, como la política de redondeo de la factura (Q-14) es una compuerta de go-live.
- [Generalizar la firma rompe la factura] → La generalización va en su propio grupo, primero, con las pruebas y los golden existentes de la factura sin cambios.
- [Una nota en revisión manual retiene capacidad indefinidamente] → Es intencional (fallar cerrado); el administrador la reconcilia, y la alerta de D20 la hace visible.
- [Una nota devuelta libera su capacidad y una corrección futura la reenviaría con la misma clave] → `correct-returned-document` no existe; si llega, debe volver a reservar capacidad antes de reenviar, y queda escrito en su capacidad futura.
- [El cambio es grande] → Grupos ordenados por dependencia y verificables por separado (tasks.md); la factura no cambia en ninguno.

## Migration Plan

- Desplegar la migración aditiva y el código. Las facturas existentes no cambian; su capacidad nace con su primera nota.
- Rollback: el código anterior ignora las tablas nuevas. Las notas emitidas son comprobantes fiscales reales: no se revierten, y una versión anterior seguiría mostrándolas en la bandeja como comprobantes de tipo 04.
