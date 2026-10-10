# Observability

## Required Signals

- Application health.
- Request latency and errors.
- Background job status.
- External service failures.
- Authentication failures.
- Import/export progress when applicable.

## Audit Trail

Record an audit entry for critical actions: permission and role changes, financial
movements, deletions, exports, shares, API key and integration changes, and access to
sensitive records.

```text
user_id  tenant_id  operation  resource_type  resource_id  timestamp  request_id  ip  result
```

- Write the entry in the same transaction as the action when the action is a database write, so neither exists without the other.
- Record denied attempts as well as successful ones; a burst of `404` and `403` across many IDs is an enumeration signal.
- Audit entries are append-only for application code.
- Never record passwords, full tokens, secret keys, signed URLs, complete financial data, or sensitive values the investigation does not need.
- Expose the trail only through permission-gated audit views, as `../architecture/frontend.md` requires.

### En este proyecto: rastro de auditoría y eventos de seguridad

El proyecto separa dos conceptos que la plantilla agrupa:

| Concepto | Qué registra | Empresa | Almacenamiento | Retención |
| --- | --- | --- | --- | --- |
| Rastro de auditoría del tenant | Cambios exitosos de un actor conocido: administración de accesos y, en cambios futuros, configuración tributaria, firma, secuenciales y comprobantes (ERS RF-003, SEC-007). Además, cada exportación de un reporte que el servidor terminó de generar (`report.exported`), aunque no cambie datos. | Siempre conocida | Tabla de solo agregado en PostgreSQL, escrita en la misma transacción que la acción | Indefinida, como evidencia |
| Eventos de seguridad | Inicios de sesión fallidos, cuentas inexistentes, límites de intentos alcanzados y denegaciones de autorización, aunque el actor sea conocido. | Opcional: puede no existir | Logs estructurados y métricas; no se guardan en el rastro de auditoría | La del sistema de logs del operador; por defecto se propone 90 días |

- Los intentos denegados se registran como eventos de seguridad, no en el rastro de auditoría: siguen siendo revisables y detectan enumeraciones, sin llenar de ruido una tabla inmutable.
- El rastro de auditoría no guarda direcciones IP. Ni el ERS ni CTX las exigen, y una tabla inmutable no permite borrarlas.
- Better Auth guarda por defecto la IP en cada sesión; el proyecto la anula al crear la sesión, y el estado del límite de intentos vive en memoria, de modo que ninguna IP se persiste en la base de datos.
- Los eventos de seguridad pueden incluir la IP del cliente para limitar intentos y detectar abusos. Detrás de un proxy, la IP se toma de `X-Forwarded-For` solo si viene de un proxy declarado de confianza; si no, se usa la del socket. Nunca se confía en la cabecera de un cliente directo.
- Si en el futuro una IP debe persistirse fuera de los logs, se documentan antes su propósito, ubicación, retención y base legal.

## Transmisión al SRI

Señales de `add-sri-transmission` (design D21; CTX §48), en `/metrics` y sin la empresa en las
etiquetas: hay una sola por instancia.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `fiscal_jobs{type,status}` | Gauge | Jobs pendientes, en arriendo y detenidos de cada tipo |
| `fiscal_jobs_oldest_pending_age_seconds{type}` | Gauge | Antigüedad del job pendiente más viejo |
| `sri_attempts_total{operation,outcome}` | Counter | Intentos con el SRI por operación y resultado |
| `sri_request_duration_seconds{operation}` | Histograma | Duración de las llamadas al SRI |
| `sri_error_code_total{code}` | Counter | Mensajes del SRI con los identificadores `70`, `43`, `45` u `other` |
| `fiscal_documents{state}` | Gauge | Comprobantes por estado, incluidos `SEND_UNKNOWN` y `MANUAL_REVIEW` |
| `invoice_authorization_latency_seconds` | Histograma | Tiempo de `SIGNED` a `AUTHORIZED` |
| `sri_circuit_open{service,environment}` | Gauge | 1 con el circuit breaker abierto o en prueba |
| `sri_transmission_enabled` | Gauge | 1 si la transmisión está habilitada |

Alertas propuestas (el despliegue las configura en su sistema de métricas):

- backlog alto o envejecido: `fiscal_jobs{status="PENDING"}` o `fiscal_jobs_oldest_pending_age_seconds` por encima de lo habitual, con la transmisión habilitada;
- comprobantes `RECEIVED` cerca de agotar la ventana de conclusión;
- aumento de devoluciones: `sri_attempts_total{outcome="RETURNED"}`;
- cualquier job `STOPPED`: `fiscal_jobs{status="STOPPED"} > 0`;
- cualquier `INTEGRITY_FAILED`, que el log registra como error;
- cualquier `TRANSMISSION_SIZE_POLICY_EXCEEDED`, también registrado como error: el comprobante excede la política conservadora de tamaño y hay que reducir su contenido (`sri_transmission_size_policy_blocks_total`);
- comprobantes en `SEND_UNKNOWN` o `MANUAL_REVIEW` que no bajan;
- circuit breaker abierto de forma prolongada: `sri_circuit_open == 1` durante varios minutos.

Los logs de cada intento llevan el comprobante, la clave, la operación, el intento, el resultado,
la duración y la correlación; nunca el XML, el SOAP, secretos ni contraseñas (CTX §47). Las
respuestas originales viven en `sri_response`, no en los logs ni en la auditoría.

## RIDE y archivo documental

Señales de `add-document-archive` (design D14), en `/metrics` y sin la empresa en las etiquetas.
Los jobs del RIDE salen además en `fiscal_jobs{type="document.render_ride",status}` y en
`fiscal_jobs_oldest_pending_age_seconds{type="document.render_ride"}`.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `ride_render_duration_seconds` | Histograma | Duración del render en su worker, sin la espera de la cola |
| `ride_job_wait_seconds` | Histograma | Del momento en que el job debía correr al inicio del render |
| `ride_render_failures_total{code}` | Counter | Fallos por código acotado: los rechazos (`RIDE_GLYPH_MISSING`, `RIDE_SOURCE_INVALID`…), las detenciones de `fiscal` (`RIDE_SOURCE_INTEGRITY`, `RIDE_LOGO_INTEGRITY`…), los fallos del pool (`BUSY`, `TIMEOUT`, `WORKER`, `CLOSED`, `INTERNAL`) u `OTHER` |
| `documents_authorized_without_ride` | Gauge | Comprobantes autorizados que todavía no tienen su RIDE |
| `ride_assets_available` | Gauge | 1 si las fuentes del RIDE, su licencia y su manifiesto están íntegros |
| `document_deliveries_total{event}` | Counter | Descargas servidas (`DOWNLOAD`) y solicitudes de impresión (`PRINT_REQUESTED`) |
| `artifact_integrity_failures_total{kind}` | Counter | Descargas o solicitudes de impresión rechazadas porque los bytes guardados no coinciden con su hash o su tamaño |

Alertas propuestas:

- autorizados sin RIDE durante más de 15 minutos: `documents_authorized_without_ride > 0` sostenido, o `fiscal_jobs_oldest_pending_age_seconds{type="document.render_ride"} > 900`;
- fallos deterministas del render: cualquier aumento de `ride_render_failures_total` con un código `RIDE_*`, o `fiscal_jobs{type="document.render_ride",status="STOPPED"} > 0`;
- fuentes del RIDE no disponibles: `ride_assets_available == 0`;
- cualquier fallo de integridad de un artefacto: `artifact_integrity_failures_total` aumenta, y el log registra el comprobante y el tipo como error.

Ninguna métrica lleva bytes, XML, claves de acceso completas, datos del comprador ni identificadores
de empresa. Los logs del RIDE llevan el job, el comprobante, la procedencia, las páginas y la
duración; nunca el contenido.

## Inventario

Señales de `add-minimal-inventory` (design D14), en `/metrics` y sin la empresa ni el producto en
las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `inventory_movements_total{type}` | Counter | Movimientos registrados por tipo (`INICIAL`, `ENTRADA_MANUAL`, `AJUSTE`, `SALIDA_FACTURA`). Una repetición con la misma clave no cuenta; la salida de una factura se cuenta al registrarla en la transacción de su autorización. |
| `inventory_negative_balances` | Gauge | Productos con saldo negativo, leídos de la base en cada consulta de las métricas |

Alerta propuesta, informativa porque el saldo negativo está permitido (Q-19): los saldos negativos
crecen, por ejemplo `delta(inventory_negative_balances[1d]) > 0` sostenido varios días, que indica
salidas fiscales sin las entradas correspondientes.

Un fallo del seguidor de la salida revierte la autorización y queda en el log del job de la
transmisión con su código, sin datos del comprador; el job reintenta con la respuesta del SRI ya
guardada. La reconciliación diagnóstica (`reconcileStock`) no es un endpoint: la usan las pruebas y
`bench:inventory`.

## Notas de crédito

Señales de `add-credit-notes` (design D20), en `/metrics` y sin la empresa, la factura ni la nota en
las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `credit_note_reservations_total{cause}` | Counter | Notas reservadas al emitir, por causa (`RETURN`, `TOTAL_ANNULMENT`). Una repetición con la misma `Idempotency-Key` no cuenta. |
| `credit_note_reservation_conflicts_total{reason}` | Counter | Emisiones rechazadas por capacidad, por motivo: `QUANTITY` (`CREDIT_NOTE_QUANTITY_EXCEEDED`), `AMOUNT` (`CREDIT_NOTE_AMOUNT_EXCEEDED`), `TOTAL_ANNULMENT` (`CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE`) y `PHYSICAL_RETURN` (`CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED`) |
| `credit_note_reservations_unconcluded_over_24h` | Gauge | Reservas acreditables `RESERVED` de hace más de 24 horas, leídas de la base en cada consulta de las métricas |
| `inventory_movements_total{type="DEVOLUCION_NC"}` | Counter | Devoluciones al inventario de las notas autorizadas, contadas al registrarlas en la transacción de la conclusión |

La transmisión, la reconciliación y el RIDE de la nota usan las señales de la transmisión y del
archivo documental (`fiscal_jobs`, `sri_attempts_total`, `fiscal_documents{state}`,
`ride_render_duration_seconds`…), sin una etiqueta de tipo: la nota no tiene métricas propias de
transmisión.

Alerta propuesta: reservas de capacidad sin conclusión durante más de 24 horas,
`credit_note_reservations_unconcluded_over_24h > 0`. Fallar cerrado es intencional (design D7): una
nota en revisión manual o con resultado incierto retiene su crédito y su retorno físico hasta que su
transmisión concluye o un administrador la reconcilia (`POST /api/v1/credit-notes/{id}/reconciliations`),
y no hay un barrido que la libere. Una reserva `RESERVED` con su nota en un estado terminal no puede
existir: la base la rechaza al confirmar (design D25). Un aumento sostenido de
`credit_note_reservation_conflicts_total` indica notas que compiten por la misma factura o vistas
previas desactualizadas.

Un fallo del seguidor de la conclusión revierte la transición de la nota y queda en el log del job de
la transmisión, sin datos del comprador; el job reintenta con la respuesta del SRI ya guardada. La
reconciliación diagnóstica de las capacidades (`reconcileCreditCapacity` y
`reconcileStockReturnCapacity`) no es un endpoint: la usan las pruebas y `bench:credit-notes`. Los
eventos de auditoría (`credit_note.reserved`, `credit_note.signed`,
`credit_note.signing_retried`, `credit_note.reconciliation_requested`,
`credit_note.reconciliation_completed`) llevan la nota, su
número, la factura y las declaraciones con su versión; nunca XML, SOAP ni la clave del certificado.

## Notas de débito

Señales de `add-debit-notes` (design D24), en `/metrics` y sin la empresa, la factura ni la nota en
las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `debit_note_reservations_total` | Counter | Notas de débito reservadas al emitir. Una repetición con la misma `Idempotency-Key` no cuenta. |
| `debit_note_concepts_total{cause}` | Counter | Conceptos de las notas reservadas, por causa (`LATE_PAYMENT_INTEREST`, `POST_INVOICE_COST_EXPENSE`); solo esos dos valores. |

La nota de débito no tiene capacidades ni movimientos de inventario, así que no tiene señales de
reservas sin conclusión: una nota en revisión manual o con resultado incierto se ve en
`fiscal_documents{state}` y se reconcilia con `POST /api/v1/debit-notes/{id}/reconciliations`. La
transmisión, la reconciliación y el RIDE usan las señales vigentes sin una etiqueta de tipo. Los
eventos de auditoría (`debit_note.reserved`, `debit_note.signed`, `debit_note.signing_retried`,
`debit_note.reconciliation_requested`, `debit_note.reconciliation_completed`) llevan la nota, su
número, la factura, las causas y la declaración con su versión; nunca las descripciones de los
conceptos, XML, SOAP ni la clave del certificado.

## Comprobantes de retención

Señales de `add-withholding-receipts` (design D26), en `/metrics` y sin la empresa, el proveedor ni
el comprobante en las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `withholding_receipt_reservations_total` | Counter | Comprobantes de retención reservados al emitir. Una repetición con la misma `Idempotency-Key` no cuenta. |
| `withholding_receipt_items_total{tax}` | Counter | Retenciones de los comprobantes reservados, por impuesto (`income` para la renta, `iva` para el IVA); solo esos dos valores. |

La retención no tiene capacidades ni movimientos de inventario, así que no tiene señales de
reservas sin conclusión: una retención en revisión manual o con resultado incierto se ve en
`fiscal_documents{state}` y se reconcilia con `POST /api/v1/withholding-receipts/{id}/reconciliations`.
La transmisión, la reconciliación y el RIDE usan las señales vigentes sin una etiqueta de tipo. Los
eventos de auditoría (`withholding_receipt.reserved`, `withholding_receipt.signed`,
`withholding_receipt.signing_retried`, `withholding_receipt.reconciliation_requested`,
`withholding_receipt.reconciliation_completed`) llevan el comprobante, su número, su clave, el
total retenido, el sujeto (identificación y razón social), el período, la declaración de parte
relacionada con su base y las cantidades de documentos y retenciones con sus impuestos; nunca XML,
SOAP ni la clave del certificado. Los borradores, las consultas, la transmisión automática y las
entregas no se auditan.

## Guías de remisión

Señales de `add-shipping-guides` (design D27), en `/metrics` y sin la empresa, los terceros ni la
guía en las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `shipping_guide_reservations_total` | Counter | Guías de remisión reservadas al emitir. Una repetición con la misma `Idempotency-Key` no cuenta. |
| `shipping_guide_recipients_total{support}` | Counter | Destinatarios de las guías reservadas, por clase de sustento (`internal_invoice` para una factura de la empresa, `declared_exception` para una excepción declarada); solo esos dos valores. |

La guía no tiene capacidades ni movimientos de inventario, así que no tiene señales de reservas sin
conclusión: una guía en revisión manual o con resultado incierto se ve en `fiscal_documents{state}`.
La transmisión, la reconciliación y el RIDE usan las señales vigentes sin una etiqueta de tipo. Los
logs registran identificadores, estados y códigos; nunca direcciones, placas, descripciones ni
identificaciones (SEC-003). Los eventos de auditoría (`shipping_guide.reserved`,
`shipping_guide.signed`, `shipping_guide.signing_retried`, `shipping_guide.reconciliation_requested`,
`shipping_guide.reconciliation_completed`) llevan la guía, su número, su clave, el transportista con
su origen, los conteos, las clases de sustento y cada excepción declarada con su caso y la versión de
la política; nunca direcciones, descripciones, la placa, XML, SOAP ni la clave del certificado. Los
borradores, las consultas, la transmisión automática y las entregas no se auditan.

## Liquidaciones de compra

Señales de `add-purchase-settlements` (design D26), en `/metrics` y sin la empresa, los terceros ni la
liquidación en las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `purchase_settlement_reservations_total` | Counter | Liquidaciones de compra reservadas al emitir. Una repetición con la misma `Idempotency-Key` no cuenta. |

La liquidación no tiene capacidades ni movimientos de inventario: una liquidación en revisión manual o
con resultado incierto se ve en `fiscal_documents{state}`. La transmisión, la reconciliación y el
RIDE usan las señales vigentes sin una etiqueta de tipo. Los logs registran identificadores, estados
y códigos; nunca direcciones, descripciones, identificaciones ni declaraciones con datos del
proveedor (SEC-003). Los eventos de auditoría (`purchase_settlement.reserved`,
`purchase_settlement.signed`, `purchase_settlement.signing_retried`,
`purchase_settlement.reconciliation_requested`, `purchase_settlement.reconciliation_completed`) llevan
la liquidación, su número y su clave; la reserva añade el caso de procedencia, la política y su
versión, los identificadores de las cuatro declaraciones, el número de líneas y de pagos y el importe
total; nunca descripciones, direcciones, XML, SOAP ni la clave del certificado. Los borradores, las
consultas, la transmisión automática y las entregas no se auditan.

## Reportes

Señales de `add-reports-export` (design D17), en `/metrics` y sin la empresa, los usuarios ni los
filtros en las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `report_exports_total{report,result}` | Counter | Exportaciones por reporte y resultado: `generated` (generada, auditada y en entrega), `row_limit` (`409`, más filas que el máximo), `busy` (`503`, sin lugar en el semáforo) y `failed` (falló la generación o su auditoría). |
| `report_export_duration_seconds{report}` | Histogram | Duración de la generación de un XLSX, desde el conteo hasta que el archivo queda auditado, sin la entrega al cliente. |
| `report_export_rows` | Histogram | Filas de cada XLSX generado. |

Alerta propuesta: `busy` crece de forma sostenida, por ejemplo `rate(report_exports_total{result="busy"}[15m]) > 0`
durante una hora, que pide revisar `REPORT_EXPORT_MAX_CONCURRENT` con `bench:reports`.

El evento de auditoría `report.exported` se escribe después de generar el libro y antes de
entregarlo: afirma que el servidor generó un XLSX y lo autorizó para entregarlo, no que el usuario lo
recibió, lo abrió o lo guardó. Lleva el actor, el reporte, el número de filas y los filtros sin datos
personales (`from`, `to`, `documentType`, `state`, `environment`, `establishmentId`,
`emissionPointId`, `fiscalPeriod`, `productId`, `movementType`, `role`, `status`); de un filtro con un
dato personal (`customerIdentification`, `supplierIdentification`, `identification`) solo que estuvo
presente. Nunca lleva filas, celdas, el archivo, la ruta temporal, XML ni RIDE. Si no se puede
escribir, no se entrega el archivo. Una exportación rechazada o fallida no se audita, y consultar un
reporte tampoco. Los logs de la exportación llevan el reporte, las filas y la duración, nunca los
filtros con datos personales ni la ruta temporal.

## Portabilidad de datos

Señales de `add-data-portability` (design D21), en `/metrics` y sin la empresa, los usuarios, las
rutas ni el contenido en las etiquetas.

| Métrica | Tipo | Qué mide |
| --- | --- | --- |
| `data_exports_total{result}` | Counter | Exportaciones por resultado: `ready` (paquete listo), `failed` (fallida, incluido un paquete listo que se perdió o se alteró) y `expired` (caducada por vencimiento o reemplazo). |
| `data_export_failures_total{code}` | Counter | Fallas por código seguro (`DATA_EXPORT_*`). |
| `data_export_phase_duration_seconds{phase}` | Histogram | Duración de cada fase de la generación: `SNAPSHOT` (la lectura consistente y los libros), `ARTIFACTS` (los artefactos) y `PUBLISHING` (el cierre, la publicación y la transacción final). |
| `data_export_size_bytes` | Histogram | Tamaño de cada paquete listo. |
| `data_export_downloads_total{result}` | Counter | Descargas por resultado: `started` (verificada, auditada y en envío), `not_ready`, `expired`, `integrity_failed` y `aborted` (el cliente se desconectó durante la verificación, sin evento). |
| `data_export_lease_renewals_failed_total` | Counter | Renovaciones del *lease* rechazadas: el worker perdió el job y su generación se abortó sin publicar. |

Alertas propuestas: cualquier `data_export_failures_total{code=~"DATA_EXPORT_(ARTIFACT|PACKAGE)_INTEGRITY"}`,
que es un incidente de integridad, y `data_export_lease_renewals_failed_total` sostenido, que pide
revisar la carga de la instancia.

Los eventos de auditoría de la portabilidad (design D19) son cuatro:

- `data_export.requested`: el administrador que la pide, con la referencia de la exportación.
- `data_export.completed`: el sistema, cuando el paquete queda listo, con los conteos, el tamaño y el SHA-256, en la misma transacción que lo publica.
- `data_export.failed`: el sistema, con solo el código seguro, también cuando un paquete listo se pierde o se altera antes de caducar.
- `data_export.download_started`: el administrador, registrado después de verificar el paquete y antes del primer byte. Si no se puede escribir, no se entrega nada. No afirma que recibió el archivo completo.

Ningún evento lleva rutas, nombres de archivos interiores, contenido, XML, respuestas del SRI ni
datos personales, y no hay eventos ni entregas por comprobante. Una solicitud o una descarga
rechazadas no se auditan. Los logs de la portabilidad llevan la referencia de la exportación, la
fase, los conteos y las duraciones, nunca rutas del sistema de archivos ni contenido.

## Logging Rules

- Do not log secrets.
- Do not log full sensitive payloads.
- Include stable identifiers for debugging.
- Make error messages actionable for operators and agents.

