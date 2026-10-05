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
| Rastro de auditoría del tenant | Cambios exitosos de un actor conocido: administración de accesos y, en cambios futuros, configuración tributaria, firma, secuenciales y comprobantes (ERS RF-003, SEC-007). | Siempre conocida | Tabla de solo agregado en PostgreSQL, escrita en la misma transacción que la acción | Indefinida, como evidencia |
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
- cualquier `INTEGRITY_FAILED` o `SIZE_POLICY_MISSING`, que el log registra como error;
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

## Logging Rules

- Do not log secrets.
- Do not log full sensitive payloads.
- Include stable identifiers for debugging.
- Make error messages actionable for operators and agents.

