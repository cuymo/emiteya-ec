# Design

## Context

- Q-24 dejó el correo para P1. `DocumentNotificationPort` (`fiscal/application/ports.ts`) existe sin
  implementación ni cableado. El historial de entregas (`document_delivery_event`) solo admite
  `DOWNLOAD` y `PRINT_REQUESTED`, con actor obligatorio y un solo artefacto. No puede representar un
  correo del sistema con dos adjuntos y varias direcciones.
- El paso a AUTORIZADO ocurre en un solo lugar (`applyDecision`, `transmission-step.ts`) y encola la
  generación del RIDE (`rideFollower`). El RIDE se genera después, en el trabajo
  `document.render_ride`, y se guarda en la transacción de éxito de `ride-handler.ts`. Por eso, al
  autorizarse el comprobante el RIDE todavía no existe.
- Artefactos en PostgreSQL (`document_artifact`): `SIGNED_XML`, `AUTHORIZED_XML` (el `<comprobante>`
  que devolvió el SRI, que puede faltar) y `RIDE_PDF`, con su SHA-256.
- Cola de trabajos propia (`platform/jobs`, ADR 0012):
  - deduplicación con `active_dedupe_key`;
  - arrendamientos (leases);
  - reintentos con espera aleatoria y política por manejador;
  - estados `STOPPED` visibles;
  - runners por prefijo en `main.ts`.
- La contraseña del P12 se cifra con sobres AES-256-GCM en `certificate-vault.ts` (ADR 0011), con la
  clave maestra `CERTIFICATE_MASTER_KEY(_FILE)`.
- La transmisión tiene un interruptor `SRI_TRANSMISSION_ENABLED` (por defecto `0`) con su compuerta.
- El backend vive en la red `app` (`internal: true`), sin salida. La salida al SRI es el override
  `deploy/compose.sri-egress.yaml` (ADR 0027).
- Terceros: un `email` opcional de 300 caracteres. Las notas de crédito y de débito no guardan el
  `partyId` del comprador en su snapshot; se llega por su factura.
- Los avisos de la interfaz son condiciones calculadas (`useNotices`) desde `GET /dashboard`.

## Goals / Non-Goals

**Goals:**

- Entregar cada comprobante autorizado una sola vez de forma automática, con los dos archivos, sin
  tocar nunca su estado fiscal.
- Que cada envío deje evidencia verificable: direcciones, intentos, respuesta del servidor y actor.
- Que el servidor SMTP de cada empresa quede aislado y su contraseña nunca salga del backend.
- Que el backend quede completo y probado antes de empezar la interfaz (plan por fases).

**Non-Goals:**

- Un servicio de correo genérico para otros usos (cuenta, invitaciones).
- Procesar rebotes asíncronos ni acuses de lectura (no hay buzón de entrada).
- Reenviar automáticamente los comprobantes autorizados antes de este cambio: se envían a mano.

## Decisions

### D1. Un módulo `email` con su propia cola

- **Ubicación:** `backend/src/modules/email/`, con `domain/` (estados, clasificación de fallos,
  destinatarios), `application/` (casos de uso, puertos, manejadores de trabajos) e
  `infrastructure/` (Prisma, transporte SMTP, HTTP).
- **El puerto anterior se retira:** `DocumentNotificationPort` se borra; su comentario remitía a
  este cambio.
- **Prefijo y runner propios:** los trabajos usan el prefijo `email.` en un runner aparte, con
  concurrencia 2. Un servidor de correo lento no frena la generación de los RIDE ni la
  transmisión.
- **Lectura de fiscal:** `email` lee de `fiscal` el comprobante, sus artefactos y su receptor a
  través de un puerto de lectura (`DeliverableDocumentReader`); no importa su infraestructura.

### D2. El correo se encola al guardar el RIDE

- **Dónde:** la transacción de éxito de `ride-handler.ts` llama a un seguidor (`emailFollower`,
  como `rideFollower`), que crea el envío automático y, si corresponde, encola
  `email.send_document`.
- **Por qué ahí:** así el correo lleva siempre los dos archivos. Si el RIDE falla y alguien lo
  reintenta, el éxito del reintento encola el correo.
- **Estado mientras tanto:** sin RIDE, la lectura del comprobante calcula «pendiente (esperando el
  RIDE)», sin guardar ninguna fila.
- **Una sola vez:** un índice único parcial `UNIQUE (document_id) WHERE origin = 'AUTOMATIC'` impide
  un segundo envío automático, y la clave de deduplicación del trabajo es
  `email:auto:<documentId>`.
- **Al crear el envío se decide su estado:**
  - `DISABLED` si el interruptor está apagado o el envío automático de la empresa está apagado,
    con el motivo de cada caso;
  - `PENDING` con su trabajo en cualquier otro caso. Los destinatarios se resuelven al ejecutar el
    trabajo, no al encolarlo.
- **Descartado:** encolar al autorizar y reprogramar hasta que exista el RIDE. Haría falta una
  regla para el RIDE detenido, y el trabajo daría vueltas sin hacer nada.

### D3. Destinatarios desde el tercero, guardados con el envío

- **Resolución por tipo** (`RecipientResolver`), con los correos actuales del tercero:

  | Tipo | Tercero de donde salen los correos |
  |---|---|
  | 01 Factura | `buyer.partyId` del snapshot |
  | 04 Nota de crédito y 05 nota de débito | La factura modificada (`invoiceId` del borrador), luego su `buyer.partyId` |
  | 07 Retención | `WithholdingReceipt.partyId` |
  | 03 Liquidación de compra | `PurchaseSettlement.supplierPartyId` |
  | 06 Guía de remisión | Los `ShippingGuideRecipient` de tipo PARTY y el transportista de tipo PARTY. Un transportista SELF o un establecimiento propio no aportan direcciones |

- **Limpieza:** se quitan las direcciones duplicadas, sin distinguir mayúsculas.
- **Consumidor final, o sin direcciones:** el envío queda `NO_RECIPIENT`.
- **Ambiente:** se usa el del comprobante (`authorizationEnvironment`), no el actual de la empresa.
  - En Pruebas, la única dirección es el correo de prueba de la configuración y `testRedirect` queda
    verdadero. Sin correo de prueba, `NO_RECIPIENT` con su motivo.
  - Las direcciones del receptor no se guardan en un envío de Pruebas.
- **Copia:** las direcciones usadas y su resultado quedan en el envío. La copia oculta de la empresa
  no se cuenta como destinatario del receptor.

### D4. Mensaje

- **Remitente:** `"<fromName>" <fromAddress>`. La copia oculta es opcional.
- **Asunto:** `«<Tipo> <número> de <razón social>»`, con el prefijo
  `«PRUEBAS – sin validez tributaria · »` en Pruebas.
- **Cuerpo:** texto plano más un HTML mínimo, con todos los valores escapados. Lleva el resumen
  (tipo, número, fecha, receptor, importe total cuando existe y número de autorización) y una línea
  que identifica el envío como la entrega del comprobante electrónico.
- **Adjuntos:** `<claveAcceso>.xml` (`application/xml`) y `<claveAcceso>.pdf`.
  - El XML es `AUTHORIZED_XML` cuando existe; si no, el `SIGNED_XML` transmitido, con la misma regla
    de procedencia que el RIDE.
  - Se adjuntan los bytes exactos, verificados por SHA-256 antes de enviar. Si falta uno o no pasa
    la verificación, el envío falla y no sale.
- **Descartado:** reconstruir el sobre `<autorizacion>` del SRI. Serían bytes que el SRI no emitió.
  El receptor valida por clave de acceso en el SRI.
- **`Message-ID` determinista** (`<envio-<deliveryId>@<dominio del remitente>>`): un reintento tras
  un tiempo agotado ambiguo no aparece como un correo distinto en el cliente del receptor.

### D5. Transporte SMTP con nodemailer (ADR 0029)

- **Por qué nodemailer:** SMTP no es HTTP, así que la regla de Axios no aplica. nodemailer es el
  cliente SMTP de referencia en Node: MIT-0, sin dependencias, mantenido. Se fija en versión exacta.
  Escribir un cliente propio (TLS, STARTTLS, AUTH, MIME, codificación de adjuntos) es más riesgo que
  beneficio.
- **Pruebas:** `smtp-server`, del mismo autor, solo de desarrollo, como servidor falso en las pruebas
  de integración.
- **Un transporte por envío,** sin pool:
  - tiempos de conexión, saludo y socket configurables (por defecto 10 s, 10 s y 60 s);
  - `requireTLS` con STARTTLS;
  - `tls.rejectUnauthorized: true` y `minVersion: TLSv1.2`.
- **Sin cifrado** (`security: NONE`): solo con `EMAIL_ALLOW_PLAINTEXT_SMTP=1`, que pone únicamente
  el override del buzón de pruebas (por defecto `0`).
  - Sin esa variable, guardar un servidor sin cifrado se rechaza.
  - Un envío con una configuración `NONE` guardada antes falla de forma definitiva.
  - La documentación de producción prohíbe la variable.
- **Resultado por dirección:** las listas `accepted` y `rejected` del servidor dan el resultado de
  cada una. El envío queda `SENT` si se aceptó al menos una dirección; las rechazadas guardan su
  motivo.

### D6. Clasificación de fallos y reintentos

- **Temporales (`RETRYABLE`):**
  - respuestas 4xx;
  - errores de red `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH`,
    `EAI_AGAIN` y saludo agotado.
- **Definitivos (`DETERMINISTIC`):**
  - 535 y otros rechazos de autenticación;
  - 550, 553 y 554 del remitente;
  - todas las direcciones rechazadas;
  - errores de certificado TLS;
  - configuración ausente o contraseña que no se puede descifrar.
- **Política de reintentos:** base de 1 min, factor 2, techo de 2 h, hasta 12 intentos y plazo de
  26 h. Cumple las «al menos 24 h» de la spec.
- **Estados:** entre intentos el envío queda `RETRYING`. Al agotarse, o ante un fallo definitivo,
  queda `FAILED` con un código y un motivo en español de una tabla cerrada. La respuesta técnica del
  servidor se recorta a 200 caracteres y se guarda solo en el intento, sin credenciales.
- **Historial:** cada intento es una fila de `email_delivery_attempt` (de solo agregado).
- **Duplicados posibles:** si el proceso cae después de que el servidor aceptó pero antes de
  guardar, el arrendamiento vence y se reenvía. Esa entrega «al menos una vez» queda documentada; el
  `Message-ID` ayuda a deduplicar.

### D7. Interruptor `EMAIL_DELIVERY_ENABLED`

- **Valor:** `z.enum(["0","1"]).default("0")`, igual que `SRI_TRANSMISSION_ENABLED`, con la métrica
  `email_delivery_enabled`.
- **Apagado:**
  - los envíos automáticos nacen `DISABLED`;
  - un trabajo ya encolado comprueba el interruptor al ejecutarse y termina `DISABLED` sin
    conectar;
  - el reenvío y la prueba responden `409 EMAIL_DELIVERY_DISABLED`.
- **Encenderlo no despierta los `DISABLED`:** esos envíos se reenvían a mano. Así se evita una
  ráfaga sorpresa de correos viejos.
- **El runner `email.` no se pausa:** pausarlo acumularía trabajos que saldrían al encenderlo,
  contra la spec.

### D8. Datos

- **`email_settings`:** una fila por empresa, mutable, con `version` para la concurrencia. Campos:
  - conexión: `host`, `port`, `security` (`TLS` | `STARTTLS` | `NONE`) y `username`;
  - remitente: `from_name` y `from_address`;
  - `bcc_address` (opcional);
  - `auto_send` (por defecto verdadero);
  - `test_recipient` (opcional);
  - `updated_at` y `updated_by`.
- **`email_settings_secret`:** la contraseña en un sobre AES-256-GCM, con `wrapped_key`, `nonce`,
  `tag`, `ciphertext`, `key_version`, `format_version` y el AAD
  `email-smtp-password|<companyId>|<formatVersion>`.
- **`email_delivery`:** un envío. Campos:
  - identificación: `id`, `company_id` y `document_id`, con FK compuesta a la empresa;
  - origen: `origin` (`AUTOMATIC` | `MANUAL`) y `requested_by` (obligatorio si es MANUAL, por CHECK);
  - `idempotency_key` (MANUAL) y `request_fingerprint`;
  - envío: `environment`, `test_redirect` y `status` (CHECK con los seis estados);
  - `recipients` (JSONB con `{address, outcome, reason}`), `message_id` y `attempt_count`;
  - resultado: `failure_code`, `failure_reason`, `created_at`, `sent_at` y `finished_at`.
- **Índices de `email_delivery`:**
  - `UNIQUE (document_id) WHERE origin = 'AUTOMATIC'`;
  - `UNIQUE (company_id, idempotency_key)`;
  - `(company_id, status)` para el filtro y el conteo.
  - El último envío de un comprobante es el más reciente por `created_at`.
- **`email_delivery_attempt`:** de solo agregado, con un trigger como `audit_event`. Campos:
  `delivery_id`, `number`, `at`, `outcome`, `smtp_code` y `detail` recortado.
- **Correos del tercero:** `party.email` pasa a una tabla propia, `party_email` (tercero, posición del
  1 al 3 y dirección), con un índice único por tercero y `lower(address)`.
  - La base hace cumplir el máximo de tres y que no se repitan; el formato lo valida el contrato.
  - La migración copia el correo existente como el primero y borra la columna anterior.
  - Una tabla y no una columna `text[]` en `party`: Prisma escribe siempre una columna de lista con
    su valor por defecto, y una columna nueva en `party` rompería las pruebas de las migraciones
    anteriores, que escriben terceros en esquemas sin ella.
  - Los reportes y la portabilidad muestran los correos en una sola columna, separados por comas.
  - El contrato pasa de `email` a `emails: string[]` (máximo 3, sin repetir sin distinguir
    mayúsculas). Es un cambio incompatible de la API; su único consumidor es el frontend, que se
    ajusta en la misma tarea para seguir compilando.
- **Referencias:** a la empresa, al comprobante y al usuario son `Restrict`, como en el resto del
  archivo: las empresas y los comprobantes no se borran, y un usuario con envíos tampoco. Solo el
  secreto se borra en cascada con su configuración.

### D9. La bóveda pasa a `platform/secrets`

- **Qué se mueve:** el cifrado de sobres (generar la clave de datos, envolverla con la clave maestra,
  AES-256-GCM con AAD y la comprobación de la clave) pasa a `backend/src/platform/secrets/` como
  función genérica.
- **Uso:** `certificate-vault.ts` la usa con sus AAD de siempre; su formato y sus pruebas no cambian.
  La contraseña SMTP la usa con su propio AAD.
- **Misma clave maestra:** se reutiliza el anillo de claves (`CERTIFICATE_MASTER_KEY(_FILE)`), con su
  rotación por versión. No hace falta un secreto nuevo en el despliegue. La documentación la llama
  «clave maestra de custodia».
- **Descartado:** una clave propia del correo. Duplicaría la custodia y la recuperación del
  despliegue sin un beneficio claro.

### D10. API

Todas las operaciones van bajo `/api/v1`. La empresa sale de la sesión; ningún id de empresa viaja
en la petición.

| Operación | Permiso | Notas |
|---|---|---|
| `GET /email/settings` | `email.configure` | Sin la contraseña: `passwordSet`, y `deliveryEnabled` (el interruptor) para la interfaz |
| `PUT /email/settings` | `email.configure` | Con `expectedVersion`; `password` opcional (ausente conserva la guardada); `409` con versión desactualizada; una segunda petición igual no cambia nada |
| `POST /email/test` | `email.configure` | `{ to }`; respuesta `{ accepted, message, at }`; límite de 5 por minuto y empresa |
| `GET /documents/:id/email-deliveries` | `archive.read` | El historial con sus intentos; `404` si el comprobante no es de la empresa |
| `GET /documents/:id/email-recipients` | `email.resend` | Las direcciones propuestas para el reenvío, más `environment` y `testRedirect` |
| `POST /documents/:id/email-deliveries` | `email.resend` | `{ recipients }`, de 1 a 10 sin repetir; `Idempotency-Key` obligatoria; misma clave y cuerpo distinto: `409 IDEMPOTENCY_KEY_REUSED`; `202` con el envío `PENDING`; `409 DOCUMENT_NOT_AUTHORIZED`; `409 EMAIL_DELIVERY_DISABLED`; `409 EMAIL_NOT_CONFIGURED` |

- **Bandeja:** `GET /documents` acepta `emailStatus=FAILED` y cada fila trae
  `email: { status } | null` (el último envío).
- **Tablero:** `GET /dashboard` suma `attention.emailFailed` (los comprobantes cuyo último envío
  falló).
- **Roles:** `email.configure` solo para ADMIN; `email.resend` para ADMIN y OPERATOR. El espejo del
  frontend y la tabla de `docs/security/access-control.md` se actualizan; sus pruebas de espejo lo
  exigen.

### D11. Auditoría

- **Acciones nuevas:** `email_settings.changed`, `email.test_sent` y `email.resent`.
- **`email_settings.changed`:** guarda los campos no secretos con su valor anterior y el nuevo. Para
  la contraseña registra solo que cambió, con una clave que no choca con `assertNoSecrets` (por
  ejemplo `smtpLoginChanged`, nunca un nombre con `pass`).
- **Mismo momento:** las tres se escriben en la misma transacción que su efecto.
- **Sin evento:** el envío automático no se audita; el guardado sin cambios no escribe evento.

### D12. Despliegue

- **Salida SMTP:** `deploy/compose.smtp-egress.yaml` conecta el backend a una red `smtp-egress` sin
  `internal`, separada de `sri-egress`. Compose no restringe puertos, así que la documentación
  recomienda limitar en el firewall del host la salida al servidor y puerto SMTP.
- **Buzón de pruebas:** `deploy/compose.mailpit.yaml` agrega `axllent/mailpit` (versión fija) en la
  red `app`.
  - Su SMTP 1025 queda solo interno. Su página 8025 se publica solo en `127.0.0.1`.
  - Pone `EMAIL_DELIVERY_ENABLED=1` y `EMAIL_ALLOW_PLAINTEXT_SMTP=1` al backend.
  - En Configuración → Correos se registra `mailpit:1025` sin cifrado.
  - Nunca se usa en producción, y la documentación de producción no lo incluye.
- **Variables nuevas:** `EMAIL_DELIVERY_ENABLED`, `EMAIL_ALLOW_PLAINTEXT_SMTP`,
  `EMAIL_SMTP_CONNECTION_TIMEOUT_MS`, `EMAIL_SMTP_SOCKET_TIMEOUT_MS` y `EMAIL_JOB_*`. Se documentan
  en `backend/.env.example` y `docs/architecture/deployment.md`.

### D13. Observabilidad y rendimiento

- **Métricas:**
  - `email_delivery_total{outcome}` (sent, failed, retrying, no_recipient, disabled);
  - `email_send_duration_seconds`;
  - `email_delivery_enabled`.
- **Logs:** el id del envío, el del comprobante y el código; nunca las direcciones, el contenido ni
  la respuesta completa del servidor.
- **Tamaño:** un RIDE de ~100 KB y un XML de ~10 KB por correo, leídos de PostgreSQL al ejecutar el
  trabajo. La concurrencia 2 acota la memoria.

### D14. Interfaz (fases posteriores)

Brief de las pantallas nuevas (`cognitive-architecture.md`), para la fase de frontend.

**Configuración → Correos**

- **Quién:** el administrador, ocasionalmente.
- **Para qué:** dejar el envío funcionando y comprobarlo.
- **Decisión principal:** si el envío está listo.
- **Niveles:**
  - P0: el estado (listo, desactivado por el despliegue o sin configurar) y la prueba;
  - P1: servidor, puerto, seguridad, usuario, contraseña y remitente;
  - P2: copia oculta, correo de prueba y envío automático;
  - P3: nada.
- **Composición:** formulario en una columna (`FormField` con ayudas en tooltip, `PasswordField`
  con «contraseña guardada») y un `FormDialog` «Enviar correo de prueba».

**Detalle del comprobante, pestaña Documentos**

- **Composición:** una tarjeta «Correo» con el estado del último envío (insignia y motivo), sus
  direcciones, «Reenviar correo» (`FormDialog` con las direcciones propuestas, editables) y un
  «Historial de envíos» plegable con los intentos.
- **Liquidaciones:** el recordatorio de imprimir los dos RIDE para firmar.

**Otras piezas**

- En «Emitir»: «Se enviará a: …», o el aviso «Sin correo: entrega el RIDE impreso si lo pide» con
  «Agregar correo».
- En la bandeja: el filtro «Correo no enviado» y un indicador en la fila.
- En Avisos: «N comprobantes sin enviar por correo».
- En Terceros: hasta tres correos con agregar y quitar.

## Operaciones sensibles

| Pregunta | Configuración del correo | Reenvío | Envío automático |
|---|---|---|---|
| ¿Quién? | ADMIN (`email.configure`) | ADMIN u OPERATOR (`email.resend`) | El sistema, al guardar el RIDE |
| Inquilino del llamador | La empresa activa de la sesión | Igual | La del comprobante |
| Inquilino del recurso | La fila de la empresa | El comprobante, buscado por id y empresa | El comprobante y su tercero, de la misma empresa (FK compuesta) |
| ¿Un id alcanza otra cuenta? | No: no hay id en la ruta | No: id + empresa de la sesión; si no coincide, `404` | No aplica |
| Dos veces | `expectedVersion`; lo mismo dos veces no cambia nada | `Idempotency-Key` con su huella | Índice único parcial + clave de deduplicación |
| A la vez | Versión optimista: una gana, la otra `409` | `UNIQUE (company_id, idempotency_key)` | Un solo trabajo activo por clave |
| Restricciones | CHECK de puerto y seguridad; secreto en tabla aparte | CHECK de origen y actor; de 1 a 10 direcciones | CHECK de estados; intentos de solo agregado |
| Auditoría | `email_settings.changed` sin secretos | `email.resent` | No (su historial es la fuente) |
| Pruebas de autorización | Operador `403`; otra empresa no ve ni cambia; sin sesión `401` | Otra empresa `404`; no autorizado `409`; sin sesión `401` | Aislamiento del tercero y del comprobante |
| Fugas | La contraseña nunca sale; errores sin respuesta técnica completa | Sin direcciones en los logs | En Pruebas, nunca al receptor |

## Risks / Trade-offs

- [Un correo se envía dos veces si el proceso cae justo después de que el servidor lo aceptó] →
  Entrega «al menos una vez», documentada. El `Message-ID` determinista permite deduplicar al
  cliente del receptor.
- [«Enviado» no prueba que el correo llegó: puede rebotar después] → El estado dice que el servidor
  lo aceptó. Leer rebotes queda fuera de alcance; el usuario puede reenviar.
- [Un servidor SMTP lento o bloqueado acumula trabajos] → Runner propio con concurrencia 2, tiempos
  agotados configurables y plazo de 26 h; nunca frena el RIDE ni la transmisión.
- [Un administrador configura un servidor que envía como spam] → Fuera del control del sistema. La
  documentación recomienda SPF, DKIM y DMARC del dominio del remitente.
- [El cambio de `email` a `emails` rompe clientes de la API] → El frontend es el único consumidor y
  se ajusta en la misma tarea. Se anota en la documentación de la API.
- [Correos de prueba hacia direcciones arbitrarias] → Solo el administrador, con límite por minuto
  y auditoría.
- [Datos personales: direcciones del receptor] → Se guardan solo en el envío, solo para su
  historial. Entran en la portabilidad como los demás datos del comprobante si el formato los
  incluye (no en v1). Se documentan en `docs/security/`.

## Migration Plan

1. Una migración crea `email_settings`, `email_settings_secret`, `email_delivery` y
   `email_delivery_attempt`, y convierte `party.email` en `party.emails` copiando el valor.
2. Con `EMAIL_DELIVERY_ENABLED=0` por defecto, desplegar no envía nada. Sin configuración, los
   comprobantes autorizados quedan `DISABLED` o sin envío, según el interruptor.
3. Los comprobantes autorizados antes del despliegue no tienen envío automático; se envían a mano.
4. Reversión: revertir el código y la migración. La migración inversa devuelve el primer correo de
   cada tercero a `party.email` y pierde el segundo y el tercero. Las tablas del correo se borran
   con su historial.

## Open Questions

- Versión exacta de nodemailer, de `smtp-server` y de la imagen de Mailpit: se fijan al
  implementar, con su revisión de dependencias (`security:dependencies`).
