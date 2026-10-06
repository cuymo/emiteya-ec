# Capacidades

Mapa de las capacidades del MVP, su trazabilidad a las fuentes (`ERS`, `CTX`) y el orden
propuesto de los cambios OpenSpec que las construirán. Una capacidad se convierte en
`openspec/specs/<capacidad>/` solo cuando se archiva un cambio que la implementa; este
documento no especifica comportamiento.

## Mapa

| Capacidad              | Qué permite                                                                                       | Fuentes                                                        | Aceptación    | Preguntas abiertas             |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- | ------------------------------ |
| `user-access`          | Iniciar sesión, roles Administrador y Operador, alta y desactivación de usuarios por el administrador. | ERS RF-001, RF-002, RF-409, SEC-001, SEC-005                  | Falta (Q-32)  | Q-41                           |
| `taxpayer-setup`       | Datos de empresa, atributos tributarios, logo, ambiente, establecimientos, puntos, punto predeterminado por usuario y preparación para emitir. | ERS RF-004, RF-005, RF-101..113; CTX §5, §6, §37 | AC-01 | — (Q-23, Q-31 y Q-42 resueltas) |
| `fiscal-numbering`     | Secuenciales atómicos y únicos, y su ajuste administrativo auditado.                              | ERS RF-120..125, RNF-003; CTX §5, §28                          | AC-04         | — (Q-02 resuelta)               |
| `signing-certificate`  | Cargar, validar, reemplazar y vigilar el vencimiento de la firma.                                 | ERS RF-130..135, SEC-002, SEC-004; CTX §20                     | AC-02         | — (Q-17 resuelta)              |
| `fiscal-catalogs`      | Catálogos oficiales versionados, política de consumidor final, registro de esquemas y matriz de casos especiales. | ERS RF-234, SRI-REQ-12; CTX §3.1, §18, §19.3, §35, §38 | AC-03      | — (Q-25 y Q-38 resueltas)      |
| `parties`              | Catálogo único de terceros con roles y búsqueda, y el consumidor final del sistema.               | ERS RF-320..323; CTX §9                                        | AC-02, AC-03  | — (Q-26 parcial: volumen de terceros medido) |
| `products`             | Productos y servicios con precio exacto, referencias fiscales, estado tributario derivado y búsqueda. | ERS RF-301..305; CTX §12.4, §12.5                          | AC-08         | — (Q-26 parcial: volumen de productos medido) |
| `document-emission`    | Núcleo común: emisión idempotente, snapshot, máquina local `RESERVED` → `SIGNED`, clave de acceso, XML, XSD y firma, hasta el artefacto firmado. | ERS RF-006..010, RF-520..525, SRI-REQ-02..05, SRI-REQ-11; CTX §4, §8, §10, §11, §19–21, §39, §41 | AC-02, AC-05 | — (Q-08, Q-14, Q-29, Q-30, Q-35, Q-38, Q-39 y Q-44 resueltas; de Q-34 quedan el SOAP y el PDF; Q-26 parcial: emisión medida con `bench:emission`) |
| `sri-transmission`     | Transmisión con jobs desde `SIGNED`: recepción, autorización asíncrona, errores 43/45/70, reconciliación por clave de los resultados inciertos (automática o del administrador), revisión manual, límite de tamaño versionado y respuestas originales inmutables. Nace apagada. Sin observación de anulaciones (Q-16) ni corrección de devueltos (BR-28). | ERS SRI-REQ-01, SRI-REQ-06..10, RNF-004; CTX §7, §22–27, §29, §32–34, §44, §52 | AC-02, AC-06 | — (Q-06, Q-07 y Q-48 resueltas; Q-47 resuelta como compuerta previa a la transmisión real; Q-16 diferida; Q-34 SOAP resuelta) |
| `correct-returned-document` | Corregir un comprobante `DEVUELTA` (BR-28) con revisión o versionado de solo agregado, si la norma permite conservar la misma identidad. Capacidad futura, separada de `sri-transmission`. | ERS §12.1 (`RETURNED` corregible); CTX §26.1, §27.1 | — | Q-08 (fecha), Q-07 (resuelta) |
| `cancellation-observation` | Detectar anulaciones de comprobantes autorizados con la consulta de validez (`PENDIENTE DE ANULAR`, `ANULADO`), incluidas las de documentos complementarios como la nota de débito, que regulan las resoluciones NAC-DGERCGC25-00000014 y 00000017. Capacidad futura, fuera de `sri-transmission` y de la emisión de `debit-notes`. | CTX §24, §36; Res. NAC-DGERCGC25-00000014 y 00000017 | — | Q-16 |
| `invoices`             | Factura con consumidor final, líneas, pagos y totales; borradores editables antes de emitir.      | ERS RF-010, RF-201..206; CTX §12, §35                          | AC-02, AC-08  | Q-45, Q-46 (Q-18 y Q-19 resueltas) |
| `credit-notes`         | Nota de crédito 1.1.0 contra una factura propia autorizada, con causas `TOTAL_ANNULMENT` y `RETURN` (parcial o total, por líneas de la factura), crédito acumulado nunca mayor que la factura con capacidades acreditable y devolvible independientes que fallan cerradas (reservadas al emitir, aplicadas o liberadas solo al concluir), un único cálculo versionado desde el snapshot de la factura, declaraciones del usuario sobre las exclusiones que el sistema no comprueba, devolución de stock opcional solo por el retorno físico declarado por línea al autorizar la nota, la transmisión y la reconciliación de la factura, su RIDE propio en la bandeja y sus pantallas. Sin descuentos ni bonificaciones ni documentos sustento externos. Medido con `bench:credit-notes`. | ERS RF-210..213, RF-212; CTX §13; Res. NAC-DGERCGC25-00000014 y 00000017 | AC-03         | — (Q-10 y Q-20 resueltas)      |
| `credit-note-discounts-bonuses` | Notas de crédito por descuentos o bonificaciones posteriores a la venta, con su modelo de importes, su asignación tributaria y su redondeo. Capacidad futura, separada de `credit-notes`. | Reglamento de Comprobantes, art. 15 | — | — |
| `external-supporting-documents` | Notas de crédito y de débito (y otros documentos relacionados) contra comprobantes emitidos fuera del sistema: externos, en papel o importados. Capacidad futura, solo si se necesita. No incluye los documentos sustento del comprobante de retención, que son referencias externas por diseño desde `add-withholding-receipts` (Q-50). Incluye el comprobante de venta externo como sustento de una guía de remisión (Q-51). | ERS RF-210, RF-243; CTX §13.4 | — | — |
| `debit-notes`          | Nota de débito 1.0.0 contra una factura propia autorizada del mismo ambiente, por las causas oficiales del artículo 16 (intereses de mora y costos o gastos posteriores), con uno o más conceptos, cada uno con un tratamiento de IVA que ya existía en la factura y su impuesto exacto, la declaración del usuario sobre la factura comercial negociable, su transmisión, su RIDE en la bandeja y sus pantallas. No aumenta la capacidad acreditable de la factura ni mueve inventario. Sin facturas externas ni anulación de la nota. | ERS RF-220..222; CTX §14; Reglamento de Comprobantes de Venta, art. 16 | AC-03         | — (Q-49 resuelta)              |
| `withholding-receipts` | Comprobante de retención 2.0.0 de renta (conceptos de residentes con porcentaje fijo del Catálogo ATS) e IVA (tabla 20), sin ISD, a un proveedor residente identificado, con `parteRel` declarado, período fiscal explícito y uno o más documentos sustento externos (factura, nota de venta o liquidación de compra) con sus impuestos y pagos; base ingresada por el usuario y valor retenido calculado por el servidor desde el porcentaje oficial congelado. Sin inventario ni pagos al exterior. | ERS RF-230..234; CTX §16; ficha v2.34, tablas 19 y 20 y anexo 10; Catálogo ATS; Reglamento de Comprobantes, arts. 8 y 40 | AC-03         | — (Q-50 resuelta)              |
| `withholding-isd` | Retención del impuesto a la salida de divisas (código `6`). Capacidad futura, pendiente de una fuente oficial que determine cuándo aplica cada código y tarifa vigente (la ficha v2.34 publica 4580 al 5 % y 4586 al 2,5 %, ambos sin fecha de fin). | Ficha v2.34, tabla 20; Q-50 | — | Pendiente de evidencia |
| `withholding-foreign-payments` | Retenciones por pagos al exterior: `pagoLocExt` 02, régimen fiscal, país del pago, convenios de doble tributación, sujeto con identificación del exterior y `tipoSujetoRetenido`, y los conceptos de renta para no residentes. Capacidad futura. | Ficha v2.34, anexo 10; Catálogo ATS, tablas 14 a 19 y 3.10; Q-50 | — | — |
| `withholding-special-supports` | Retenciones con estructuras especiales del ATS: reembolsos (sustento 41), dividendos (sustento 10), compra de cajas de banano y autorretenciones (anexo 19). Capacidad futura. | Ficha v2.34, anexos 10 y 19; Q-50 | — | — |
| `withholding-variable-rate-concepts` | Conceptos de renta cuyo porcentaje no es un número fijo en el Catálogo ATS (textuales, rangos, "varios porcentajes", por mil o dependientes de convenio), con su propia regla de selección. Capacidad futura. | Catálogo ATS, tabla 3.10; Q-50 | — | — |
| `shipping-guide-additional-details` | `detallesAdicionales` en los detalles de la guía de remisión (hasta tres pares de nombre y valor por detalle), con su snapshot, su XML y su RIDE. Capacidad futura. | XSD `GuiaRemision_V1.1.0.xsd`; Q-51 | — | — |
| `shipping-guide-multiple-vehicles` | Traslados con varios medios de transporte, placas o conductores (Reglamento de Comprobantes de Venta, art. 30). Capacidad futura: el XML 1.1.0 expresa un solo transportista y una sola placa. | Reglamento, art. 30; Q-51 | — | — |
| `location-stock` | Stock por establecimiento o ubicación y logística de traslados. Capacidad futura: el inventario actual es stock fiscal agregado por empresa, y la guía de remisión no lo mueve. | ERS RF-315; Q-51 | — | — |
| `shipping-guides`      | Guía de remisión 1.1.0 de la propia empresa como remitente: transportista propio (`SELF`) o tercero con el rol `CARRIER` (`PARTY`) y una placa; uno o más destinatarios con su dirección, su motivo y su detalle; por destinatario, una factura propia autorizada o una excepción declarada del artículo 30 del Reglamento. Sin precios, impuestos, total monetario ni inventario. | ERS RF-240..243; CTX §15; ficha v2.34, anexos 2 y 3; Reglamento, arts. 27–38 | AC-03 | — (Q-51 resuelta) |
| `purchase-settlements` | Liquidación de compra separada de la factura.                                                     | ERS RF-250..253; CTX §17                                       | AC-03         | Q-12                           |
| `inventory`            | Stock opcional contabilizado por hechos fiscales autorizados, no reserva de disponibilidad: inicialización única con `INICIAL`; la salida de una factura nace al entrar en `AUTHORIZED` con la decisión congelada en su snapshot (Q-18) y el saldo puede quedar negativo (Q-19); entradas y ajustes idempotentes; movimientos inmutables y kárdex; control fail-closed y no retroactivo; aviso orientativo en el borrador; la `DEVOLUCION_NC` de una nota de crédito autorizada por su retorno físico (`add-credit-notes`). Sin stock reservado ni comprometido. Medido con `bench:inventory`. | ERS RF-310..315, RF-205, RF-206, RF-212                        | AC-08         | — (Q-18, Q-19, Q-20 y Q-21 resueltas) |
| `document-archive`     | Bandeja única de los comprobantes desde la reserva, con filtros; RIDE generado una vez desde el XML autorizado (o el firmado transmitido, con su procedencia) para la factura 1.1.0 y la nota de crédito 1.1.0 (`add-credit-notes`, con su propia distribución) que el sistema emite, con el filtro de tipo; descargas verificadas por hash del RIDE y de los XML; impresión como acción explícita; historial de entregas observables (`DOWNLOAD`, `PRINT_REQUESTED`). Sin correo (Q-24, P1). | ERS RF-401..409; CTX §30, §31, §45, §46                        | AC-07         | Q-16 (futura), Q-27 (go-live) (Q-24 y Q-39 resueltas; el PDF de Q-34, con S-4 y el ADR 0022) |
| `reports`              | Reportes filtrables exportados a XLSX.                                                            | ERS RF-501..505                                                | AC-09         | Q-26                           |
| `audit-trail`          | Auditoría de cambios críticos y de transiciones de estado.                                        | ERS RF-003, RF-105, RF-525, SEC-007, RNF-006                   | Falta (Q-32)  | —                              |
| `data-portability`     | Exportar los datos y artefactos del contribuyente.                                                | ERS SEC-010, RNF-007                                           | AC-10         | Q-28                           |

Requisitos transversales que no forman una capacidad propia y aplican a todos los cambios:
API (ERS API-001..006, CTX §40–41), seguridad (ERS SEC-003, SEC-004, SEC-006, SEC-008,
SEC-009; CTX §47) y no funcionales (ERS RNF-001..012). Ver
`../architecture/non-functional-requirements.md`.

## Secuencia propuesta de cambios OpenSpec

Cada cambio es una unidad revisable que entrega comportamiento verificable. El orden sigue
las dependencias: nada se emite sin empresa, numeración, firma y catálogos, y los cinco
comprobantes restantes reutilizan el núcleo que construye la factura.

| #   | Cambio                     | Capacidades                                           | Depende de     | Cierra        |
| --- | -------------------------- | ----------------------------------------------------- | -------------- | ------------- |
| 0   | `bootstrap-application`    | Ninguna (`skip_specs: true`): monorepo, Express y Next.js sin autenticación, Prisma y PostgreSQL, validación de entorno, logger, salud, pruebas, verificación y CI. Excluye Better Auth, el aprovisionamiento y el shell autenticado, que son de `add-user-access`. Fija Prisma 7.x, porque Better Auth 1.7.7 no admite Prisma 8. | — | — |
| 1   | `add-user-access`          | `user-access`, `audit-trail` (base); crea el registro único de la empresa al instalar (ADR 0009) | 0 | —  |
| 2   | `add-taxpayer-setup`       | `taxpayer-setup`                                      | 1              | AC-01 parcial |
| 3   | `add-fiscal-numbering`     | `fiscal-numbering`                                    | 2              | AC-04         |
| 4   | `add-signing-certificate`  | `signing-certificate`                                 | 2              | AC-01         |
| 5a  | `add-fiscal-catalogs`      | `fiscal-catalogs`: catálogos oficiales versionados, política decimal común, política de consumidor final, registro de esquemas y matriz de casos especiales | 1 | —  |
| 5b  | `add-parties-and-products` | `parties`, `products`: consumen `fiscal-catalogs` como dependencia canónica | 5a | — |
| —   | Spikes técnicos, sin OpenSpec | Validación de `facturacion-electronica-ec`: XSD (S-2, ejecutado, ADR 0021), factura offline (S-3 offline, ejecutado con el builder propio de Q-44), autorización en Pruebas (S-3 online, compuerta de go-live) y PDF (S-4) (Q-34, ADR 0018) | 0 | ADRs de dependencias |
| 6   | `add-invoice-emission`     | `document-emission`, `invoices`                       | 3, 4, 5a, 5b, spike | AC-05    |
| 7   | `add-sri-transmission`     | `sri-transmission`                                    | 6              | AC-06; AC-02 parcial (el RIDE llega con el cambio 8 y la autorización real con S-3 online) |
| 8   | `add-document-archive`     | `document-archive`                                    | 7              | AC-07; completa AC-02 con S-3 online |
| 9   | `add-minimal-inventory`    | `inventory`                                           | 7              | AC-08         |
| 10  | `add-credit-notes`         | `credit-notes`                                        | 7, 9           | AC-03 parcial |
| 11  | `add-debit-notes`          | `debit-notes`                                         | 7, 8, 10       | AC-03 parcial |
| 12  | `add-withholding-receipts` | `withholding-receipts`                                | 7              | AC-03 parcial |
| 13  | `add-shipping-guides`      | `shipping-guides`                                     | 7              | AC-03 parcial |
| 14  | `add-purchase-settlements` | `purchase-settlements`                                | 7              | AC-03         |
| 15  | `add-reports-export`       | `reports`                                             | 8              | AC-09         |
| 16  | `add-data-portability`     | `data-portability`                                    | 8              | AC-10         |

Capacidades futuras sin número en la secuencia, decididas en la revisión de readiness del cambio 7
(2026-10-03): `correct-returned-document` (corrección de un devuelto, BR-28) y
`cancellation-observation` (observación de anulaciones, Q-16). Ninguna amplía `add-sri-transmission`.
En la revisión de readiness del cambio 10 (2026-10-04) se suman `credit-note-discounts-bonuses`
(la norma permite esa causa, pero el MVP no la implementa todavía) y `external-supporting-documents`
(el MVP solo acepta como documento modificado una factura propia autorizada). Ninguna amplía
`add-credit-notes`.
En la revisión de readiness del cambio 12 (2026-10-05) se suman `withholding-isd` (evidencia
insuficiente para elegir la tarifa), `withholding-foreign-payments`, `withholding-special-supports` y
`withholding-variable-rate-concepts`. Ninguna amplía `add-withholding-receipts`.
En la revisión de readiness del cambio 13 (2026-10-06) se suman `shipping-guide-additional-details`,
`shipping-guide-multiple-vehicles` y `location-stock`, y `external-supporting-documents` abarca
también el comprobante de venta externo de una guía. Ninguna amplía `add-shipping-guides`.

Obligaciones de `add-fiscal-catalogs` (5a) para `add-parties-and-products` (5b), que consume
`fiscal-catalogs` como dependencia canónica sin duplicar datasets ni reglas de vigencia:

- validar identificaciones con las reglas del dataset de tipos de identificación, con el tipo `07` reservado;
- crear el consumidor final de cada empresa como registro del sistema, con la identidad que publica la política de consumidor final;
- referenciar impuestos por `(catálogo, entryKey)`, resolverlos solo con `resolveCatalogEntry` y decidir si están disponibles con `effectiveEnablement` e `isUsable`;
- usar las especificaciones decimales `precioUnitario` e `importe` y `decimalString`;
- señalar los productos cuyo impuesto deja de estar vigente o habilitado;
- traer el contrato común de búsqueda y paginación, la prueba de volumen de Q-26 y el aviso de `Catálogos fiscales` sobre productos afectados al deshabilitar.

El cambio 5 se propuso como `add-business-catalogs` y, antes de implementarse, se dividió en 5a y 5b (2026-10-02): `catalogs` no depende de terceros ni productos, y cada parte queda revisable por separado. La propuesta original queda solo en el historial de git.

Estrategia técnica (ADR 0018): los cambios 4 a 14 reutilizan `facturacion-electronica-ec`, detrás de puertos propios, para los builders XML, la clave de acceso, la validación XSD, la firma XAdES-BES y el transporte SOAP, en lugar de reimplementarlos. La orquestación, la numeración, la persistencia, los estados, la idempotencia, los reintentos y la reconciliación siguen siendo de la aplicación. Ningún cambio está implementado por adoptar la librería.

Al terminar el cambio 8 existe una porción vertical completa: una factura configurada,
emitida, autorizada en Pruebas, con RIDE y descargable. Ese es el primer punto para validar
el producto con un contribuyente real.

Cada cambio que implemente un tipo de comprobante cumple la Definition of Done del motor
fiscal (CTX §58). El release v1.0 exige además los no negociables de
`../quality/definition-of-done.md` (sección Go-Live v1.0).

## Requisitos fuente diferidos

Requisitos del ERS que el cambio de su capacidad no implementó. Siguen pendientes y no forman
parte del spec actual de esa capacidad hasta que otro cambio los implemente.

| Requisito | Capacidad | Qué falta | Estado |
| --- | --- | --- | --- |
| ERS RF-202, "ingreso manual permitido" | `invoices` | Líneas de factura sin producto del catálogo. `add-invoice-emission` (cambio 6) solo admite líneas que refieren un producto activo. | Diferido; sus reglas son Q-46. No es Q-45, que trata de modificar el precio de un producto del catálogo. |

## Trazabilidad de `credit-notes`

Fuentes del cambio 10 y qué fija cada una. Los specs distinguen el requisito oficial de la política
del MVP.

| Regla | Origen | Fuente |
| --- | --- | --- |
| Causas: anular operaciones, aceptar devoluciones, conceder descuentos o bonificaciones; la nota consigna denominación, serie y número del comprobante modificado | Requisito oficial | Reglamento de Comprobantes de Venta, art. 15 (citado en la Res. NAC-DGERCGC25-00000014); art. 5 sustituido por la NAC-DGERCGC25-00000017 |
| Una factura con la leyenda "consumidor final" no admite nota de crédito | Requisito oficial, desde el 01/01/2026 | Res. NAC-DGERCGC25-00000014, art. 3, último inciso; disposición final reformada por la 00000017 |
| Sin nota de crédito para facturas comerciales negociables negociadas ni para comprobantes que sustentan una devolución de impuestos | Requisito oficial | Res. NAC-DGERCGC25-00000014, disposiciones generales segunda y tercera |
| Sin plazo para emitir la nota (el de doce meses se eliminó) | Requisito oficial vigente | Res. NAC-DGERCGC25-00000017, art. 1, literal c |
| Anular un comprobante de venta en línea o mediante nota de crédito | Requisito oficial | Res. NAC-DGERCGC25-00000014, art. 2 |
| XML `notaCredito` 1.1.0 y su RIDE | Requisito oficial | `docs/product/sri-xsd/NotaCredito_V1.1.0.xsd`; ficha v2.34, anexo 3 y anexo 2 (página 61) |
| Documento modificado: tipo, número completo, fecha, motivo, valor e impuestos coherentes con él | Contexto técnico | CTX §13.2–13.4 |
| Solo facturas propias autorizadas, del mismo ambiente que la nota, como documento modificado | Política del MVP | Q-10 |
| Causas `TOTAL_ANNULMENT` y `RETURN`; descuentos y bonificaciones diferidos | Política del MVP (alcance) | Q-10 |
| Crédito acumulado no mayor que la factura, y por línea no mayor que su cantidad | Política conservadora del producto | Q-10 |
| Declaraciones del usuario para las exclusiones no comprobables | Política del MVP | Q-10 |
| Devolución de stock al autorizar la nota, por el retorno físico declarado y limitada a la salida original pendiente | Política del producto sobre ERS RF-212 | Q-20 |

Lo que implementa `add-credit-notes` (detalle en `../architecture/fiscal-emission.md`,
`../architecture/database.md` y `../security/access-control.md`):

- **Rutas y permisos:** `GET /api/v1/credit-notes/eligible-invoices` y los borradores (`GET/POST /api/v1/credit-notes/drafts`, `GET/PUT/DELETE /api/v1/credit-notes/drafts/{draftId}`) con `creditNotes.draft`; `POST /api/v1/credit-notes` (con `Idempotency-Key` y las declaraciones) con `creditNotes.emit`; `GET /api/v1/credit-notes`, `GET /api/v1/credit-notes/{creditNoteId}`, `GET /api/v1/credit-notes/{creditNoteId}/transmission` y `GET /api/v1/credit-notes/invoices/{invoiceId}/credit` con `creditNotes.read`; `POST /api/v1/credit-notes/{creditNoteId}/signing-attempts` con `creditNotes.retrySigning`; y `POST /api/v1/credit-notes/{creditNoteId}/reconciliations` con `creditNotes.reconcile`, solo del administrador. La bandeja filtra con `GET /api/v1/documents?documentType=04`.
- **Códigos de error:** `CREDIT_NOTE_NOT_FOUND`, `CREDIT_NOTE_DRAFT_NOT_FOUND`, `CREDIT_NOTE_INVOICE_NOT_FOUND`, `CREDIT_NOTE_DRAFT_CHANGED`, `CREDIT_NOTE_DRAFT_ALREADY_EMITTED`, `CREDIT_NOTE_DRAFT_INCOMPLETE`, `CREDIT_NOTE_INVOICE_NOT_ELIGIBLE`, `CREDIT_NOTE_CONSUMER_FINAL`, `CREDIT_NOTE_INVOICE_INTEGRITY`, `CREDIT_NOTE_CAUSE_INVALID`, `CREDIT_NOTE_REASON_REQUIRED`, `CREDIT_NOTE_LINE_INVALID`, `CREDIT_NOTE_QUANTITY_EXCEEDED`, `CREDIT_NOTE_AMOUNT_EXCEEDED`, `CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE`, `CREDIT_NOTE_PHYSICAL_RETURN_INVALID`, `CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED`, `CREDIT_NOTE_LINE_AMOUNT_NEGATIVE`, `CREDIT_NOTE_DECLARATIONS_REQUIRED` y `CREDIT_NOTE_NOT_RECONCILABLE`, más los de la emisión compartidos con la factura (`IDEMPOTENCY_KEY_*`, firma, punto, esquema, secuencia y `SRI_INTERACTION_IN_PROGRESS`).
- **Métricas:** `credit_note_reservations_total{cause}`, `credit_note_reservation_conflicts_total{reason}`, `credit_note_reservations_unconcluded_over_24h` (la señal de la alerta) e `inventory_movements_total{type="DEVOLUCION_NC"}` (`../quality/observability.md`).
- **Pantallas:** `Notas de crédito` (`/notas-credito`), el borrador con la confirmación de las declaraciones, el detalle, el crédito en el detalle de la factura y el filtro de tipo en `Comprobantes`.
- **Rendimiento:** `bench:credit-notes` (`../quality/performance.md`).

## Trazabilidad de `debit-notes`

Estado: `add-debit-notes` archivado el 2026-10-05 (`openspec/changes/archive/2026-10-05-add-debit-notes/`).

Fuentes del cambio 11 y qué fija cada una (Q-49). Los specs distinguirán el requisito oficial de la
política del MVP.

| Regla | Origen | Fuente |
| --- | --- | --- |
| Causas: cobro de intereses de mora y recuperación de costos y gastos posteriores a la emisión del comprobante; la nota consigna denominación, serie y número del comprobante modificado | Requisito oficial | Reglamento de Comprobantes de Venta, art. 16 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-15-16.txt`) |
| Una factura comercial negociable efectivamente negociada no admite nota de débito | Requisito oficial; el usuario lo declara mientras el sistema no pueda comprobarlo | Reglamento de Comprobantes de Venta, art. 16 |
| IVA del comprobante original, no el vigente a la fecha de la nota | Requisito oficial, con fuente durable archivada | Primaria: ficha v2.34, página 58, "la tarifa de IVA corresponderá a la fecha de emisión del documento de sustento" (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`). Complementaria: la pregunta 11 de las preguntas frecuentes del SRI del cambio de tarifa de 2016 (`sri-catalogs/fuentes/sri-preguntas-frecuentes-tarifa-iva-2016.txt`); el aviso del cambio del 14 % al 12 % no se encontró en el portal y no se archiva. Q-49 |
| XML `notaDebito` 1.0.0 y su RIDE | Requisito oficial | `docs/product/sri-xsd/NotaDebito_V1.0.0.xsd`, verificado contra el portal el 2026-10-05 (`sri-catalogs/fuentes/nota-de-debito-xsd-verificacion.txt`); CTX §14 |
| `pagos` obligatorio en la nota de débito, con su forma de pago y su total | Requisito oficial | Ficha v2.34, páginas 58 y 59 (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`) |
| Exactamente un `pago`, por el valor total exacto, de una forma de pago vigente y habilitada del catálogo | Política del MVP del proyecto, no un límite del SRI; varias formas de pago serían una extensión compatible | Design D8 de `add-debit-notes` |
| Distribución del RIDE de la nota de débito | Requisito oficial | Ficha v2.34, anexo 2, página 62 |
| `infoAdicional` solo cuando corresponde un campo adicional definido por una fuente (hoy ninguno); nunca con contenido inventado | Requisito oficial: la fila "Obligatorio" de la página 59 es el contenedor de campos que la misma tabla marca "Obligatorio cuando corresponda" | Ficha v2.34, páginas 29, 51–59, 69–74 y 135 (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`, Resolución de `infoAdicional`); el anexo 26 sigue en Q-37 |
| Sin plazo de emisión impuesto | Las fuentes oficiales vigentes revisadas no lo establecen; no se extrapola el art. 5 reformado de la NAC-DGERCGC25-00000017, que rige las notas de crédito | Q-49 |
| Solo facturas propias autorizadas, del mismo ambiente, como documento modificado | Política del MVP | Q-11, Q-49 |
| Causas cerradas `LATE_PAYMENT_INTEREST` y `POST_INVOICE_COST_EXPENSE`; cada concepto con un tratamiento de IVA de la factura | Política del MVP sobre el art. 16 | Q-49 |
| Factura a consumidor final no admite nota de débito | Política del producto (receptor identificado, BR-32), no la NAC-DGERCGC25-00000014 | Q-49 |
| No aumenta la capacidad acreditable de la factura ni mueve inventario; una nota de crédito no modifica una nota de débito | Política del producto | Q-49 |
| La anulación de una nota de débito ya emitida queda fuera | Las resoluciones NAC-DGERCGC25-00000014 y 00000017 regulan la anulación de documentos complementarios; es una capacidad futura | Q-16 |

Lo que implementa `add-debit-notes` (detalle en `../architecture/fiscal-emission.md`,
`../architecture/database.md` y `../security/access-control.md`):

- **Rutas y permisos:** `GET /api/v1/debit-notes/eligible-invoices` y los borradores (`GET/POST /api/v1/debit-notes/drafts`, `GET/PUT/DELETE /api/v1/debit-notes/drafts/{draftId}`) con `debitNotes.draft`; `POST /api/v1/debit-notes` (con `Idempotency-Key` y la declaración) con `debitNotes.emit`; `GET /api/v1/debit-notes`, `GET /api/v1/debit-notes/{debitNoteId}` y `GET /api/v1/debit-notes/{debitNoteId}/transmission` con `debitNotes.read`; `POST /api/v1/debit-notes/{debitNoteId}/signing-attempts` con `debitNotes.retrySigning`; y `POST /api/v1/debit-notes/{debitNoteId}/reconciliations` con `debitNotes.reconcile`, solo del administrador. La bandeja filtra con `GET /api/v1/documents?documentType=05`.
- **Códigos de error:** los `DEBIT_NOTE_*` de `packages/contracts/src/debit-notes.ts`, entre ellos `DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE`, `DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE`, `DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH` y `DEBIT_NOTE_DECLARATION_REQUIRED`, más los de la emisión compartidos con la factura.
- **Métricas:** `debit_note_reservations_total` y `debit_note_concepts_total{cause}` (`../quality/observability.md`).
- **Pantallas:** `Notas de débito` (`/notas-debito`), la nueva nota desde la factura o el selector, el borrador con la confirmación de la declaración, el detalle y el tipo `05` en `Comprobantes`.
- **Rendimiento:** `bench:debit-notes` (`../quality/performance.md`).

## Trazabilidad de `withholding-receipts`

Fuentes del cambio 12 y qué fija cada una (Q-50). Los specs distinguirán el requisito oficial de la
política del MVP.

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `comprobanteRetencion` 2.0.0 (ATS) | Requisito oficial | `docs/product/sri-xsd/ComprobanteRetencion_V2.0.0.xsd`, verificado contra el portal el 2026-10-05 (`sri-catalogs/fuentes/comprobante-retencion-xsd-verificacion.txt`); ficha v2.34, anexo 10 |
| Sujeto retenido identificado, nunca consumidor final | Requisito oficial | Ficha v2.34, página 13, notas de la tabla 6 |
| Contenido: sujeto, impuesto, comprobante que motiva la retención, base, porcentaje, valor, ejercicio fiscal y fecha de emisión; totalizado y cerrado individualmente | Requisito oficial | Reglamento de Comprobantes, art. 40 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-3-8-40.txt`) |
| Se emite al pagar o acreditar en cuenta; el catálogo se resuelve con la fecha de emisión | Requisito oficial (art. 8) y política del MVP (fecha efectiva) | Reglamento de Comprobantes, art. 8; Q-50 |
| Impuestos a retener y retención del IVA | Requisito oficial | Ficha v2.34, tablas 19 y 20 |
| Conceptos y porcentajes de la renta; tablas de sustento, tipo de comprobante y formas de pago | Requisito oficial | Catálogo ATS (06/08/2026), referido por la ficha v2.34, página 34 y anexo 10 |
| Renta: solo residentes con porcentaje fijo; IVA sí; ISD no | Política del MVP | Q-50 |
| Período fiscal explícito, editable antes de reservar, nunca posterior al mes de emisión | Política del MVP (la fuente solo exige el ejercicio fiscal de la retención) | Q-50 |
| Uno o más documentos sustento externos de los tipos 01, 02 y 03 | Política del MVP sobre el XSD, que no fija máximo | Q-50 |
| Base ingresada por el usuario; porcentaje del catálogo; valor retenido del servidor con HALF_UP a 2 decimales | Política del MVP y política decimal del proyecto | Q-50, `../architecture/decimal-policy.md` |
| `parteRel` declarado por el usuario | Requisito oficial (obligatorio en el XSD), declarado por el usuario | Q-50 |
| Sin pagos al exterior, reembolsos, dividendos, banano ni autorretenciones | Política del MVP | Q-50; matriz de casos especiales (anexo 19 fuera del MVP) |
| Sin inventario ni capacidad acreditable | Política del producto | Q-50 |

## Trazabilidad de `shipping-guides`

Fuentes del cambio 13 y qué fija cada una (Q-51). Los specs distinguirán el requisito oficial, la
política del MVP y la defensa de recursos.

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `guiaRemision` 1.1.0, codDoc `06` | Requisito oficial | `docs/product/sri-xsd/GuiaRemision_V1.1.0.xsd`, verificado contra el portal el 2026-10-06 (`sri-catalogs/fuentes/guia-remision-xsd-verificacion.txt`); ficha v2.34, tabla 3 y anexo 3 |
| Un transportista (identificación de hasta 13 caracteres) y una placa (hasta 20) por guía | Requisito oficial | XSD y ficha v2.34, anexo 3, página 70 (`sri-catalogs/fuentes/ficha-v2.34-guia-de-remision.txt`) |
| La fecha de inicio del transporte no es menor que la fecha de emisión de la guía | Requisito oficial | Ficha v2.34, página 38, error 82 (BR-37) |
| La fecha de fin no es anterior a la de inicio; sin duración máxima | Validación del proyecto | Q-51 |
| Destinatario identificado, partida, destinos, conductor, placa, mercadería con unidad y cantidad, motivo y fechas | Requisito oficial | Reglamento de Comprobantes de Venta, art. 30 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-27-38.txt`) |
| Comprobante de venta salvo las excepciones a) a e) del art. 30, numeral 8 | Requisito oficial | Reglamento, art. 30 |
| Factura `01` propia, autorizada, del mismo ambiente, o excepción declarada b), c), d) o e); sin venta itinerante ni comprobantes externos | Política del MVP (P1) | Q-51 |
| Traslado entre establecimientos propios con la empresa como destinataria | Política del MVP (P2) | Q-51 |
| Destinatario externo: tercero activo 04, 05 o 06, sin rol obligatorio | Política del MVP (P3) sobre el art. 30 | Q-51 |
| Transportista `SELF` (identidad tributaria) o `PARTY` (rol `CARRIER` obligatorio, 04, 05 o 06) | Política del MVP (P4) | Q-51 |
| Placa como texto fiscal, sin formato vehicular | Política del MVP (P5); la tabla 29 es de facturas de combustibles | Ficha v2.34, anexo 12; Q-51 |
| Sin `detallesAdicionales` | Política del MVP (P6) | Q-51 |
| Cantidad mayor que cero, exacta, de hasta 6 decimales | Política del MVP (P7) sobre el XSD, que admite 0 | Q-51, `../architecture/decimal-policy.md` |
| Sin movimientos de inventario | Política del producto (P8) | Q-51 |
| 10/50 destinatarios, 50/100 detalles por destinatario y 100/300 detalles por guía (por defecto/máximo) | Defensa de recursos del producto (P9), nunca un límite del SRI ni del XSD | Q-51 |
| Sin total monetario ni receptor único en la cabecera común | Política del producto (P10) | Q-51 |
| RIDE propio con la distribución del anexo 2 | Requisito oficial | Ficha v2.34, página 64 |
| Sin aduana, exterior, combustibles, máquina fiscal, factura sustitutiva, emisor itinerante, interrupción del transporte ni varios vehículos | Política del MVP | Reglamento, arts. 30 a 37; matriz de casos especiales; Q-51 |

## Huecos de trazabilidad

El ERS §19 no asigna criterio de aceptación a estos requisitos. Cada cambio que los
implemente define escenarios propios en sus specs (Q-32):

- Autenticación, roles y usuarios (ERS RF-001, RF-002, RF-409).
- Punto de emisión predeterminado por usuario (ERS RF-113).
- Auditoría (ERS RF-003, RF-105, RF-525).
- Distinción de ambientes y advertencia de Pruebas (ERS RF-004, RF-005).
- Validación previa a la firma, decimal exacto, autoría y borradores (ERS RF-006..010): los escenarios de `document-emission` e `invoices` de `add-invoice-emission`.
- Alertas de vencimiento de la firma (ERS RF-135).
- API y OpenAPI (ERS API-001..006), cubiertos solo por "pruebas de contrato".

CTX sí aporta criterios verificables para el motor fiscal: invariantes I-01..I-20 (§61),
casos de recuperación A–E (§52), pruebas de propiedades (§51) y la matriz de certificación
(§49). Ver `../quality/testing.md`.
