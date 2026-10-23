# Backend Architecture

## Runtime

- Language: TypeScript.
- Runtime: Node.js.
- Framework: Express.js.
- Package manager: pnpm through Corepack.
- Database access: Prisma.
- Database: PostgreSQL.
- Authentication: Better Auth.
- Validation: Zod.
- External HTTP: Axios; excepción: el adaptador SOAP del SRI usa el `fetch` nativo de Node, solo en infraestructura (ADR 0018, enmienda del transporte).

## Estructura del backend en este proyecto

```text
backend/src/
├── main.ts          arranque, validación del entorno y apagado ordenado
├── app.ts           createApp(deps): arma la aplicación HTTP
├── config/          entorno validado con Zod (env.ts)
├── platform/        http (correlación, errores, 404), logging, metrics (y tiempos por etapa), health,
│                    lifecycle, db, decimal, idempotency, search, workers (primitiva de pool y sus
│                    instancias criptográfica y del RIDE), jobs (cola durable) y secrets (sobre
│                    AES-256-GCM con la clave maestra de custodia, para la firma y la contraseña SMTP)
├── generated/       cliente de Prisma generado (no versionado)
├── commands/        comandos de servidor sin ruta HTTP (admin:recover)
└── modules/         un directorio por módulo con domain / application / infrastructure
```

Orden de middleware de `createApp` (ADR 0016):

1. `requestId`: acepta un `x-request-id` entrante válido (8 a 128 caracteres `[A-Za-z0-9._-]`) o genera un UUID, y lo devuelve en la respuesta.
2. `pino-http`: un log por petición con `req.id`, método, URL y estado. No registra cabeceras, IP ni cuerpos; la redacción de `authorization`, `cookie`, `set-cookie`, `password`, `token` y `secret` es una segunda defensa.
3. `helmet`: cabeceras de seguridad; `x-powered-by` deshabilitado.
4. Métricas HTTP por patrón de ruta.
5. Endpoints operacionales: `/health/live`, `/health/ready` y `/metrics`, fuera de `/api` y fuera de la API pública. Restringir su exposición corresponde al despliegue (`deployment.md`).
6. `mountBeforeBodyParser`: punto de montaje para routers que necesitan el cuerpo sin procesar. Monta Better Auth en `/api/auth/*`, precedido del middleware que escribe la IP del cliente y la correlación como cabeceras propias del servidor, con el adaptador acotado: JSON de hasta 8192 bytes, `415` y `413` en otro caso (`authentication.md`, "Adaptador acotado").
7. Guarda de origen de `/api/v1` (`platform/http/request-origin.ts`), antes de leer cualquier cuerpo y de consultar la sesión. `OPTIONS` pasa sin evaluarse; `Sec-Fetch-Site` `same-site` o `cross-site` se rechaza en los demás métodos, y las mutaciones exigen el `Origin` exacto del origen canónico (`../security/hardening.md`, "Origen de las peticiones").
8. `express.json` con límite de 100 KB, salvo las rutas que `jsonBodyExceptions` declara con su propio parser: la carga de la firma electrónica (límite derivado de `CERTIFICATE_MAX_BYTES`) crear y actualizar un borrador de guía de remisión (2 MiB, design D23 de `add-shipping-guides`) y crear y actualizar un borrador de liquidación de compra (4 MiB, design D22 de `add-purchase-settlements`). El límite global no cambia para el resto de la API, tampoco para las emisiones.
9. `/api/v1`: el router de aplicación que recibe `createApp` (ADR 0015).
10. Manejador 404 y manejador de errores.

Contrato de errores:

- Respuesta: `{ error: { code, message, requestId } }`, con el esquema de `@facturador/contracts`.
- `AppError` lleva un código estable, el estado HTTP y un mensaje para el usuario; `NotFoundError`, `ConflictError` y `ValidationError` (desde un `ZodError`) son sus variantes genéricas.
- Errores del parser: `413 PAYLOAD_TOO_LARGE` y `400 INVALID_JSON`. En `/api/auth/*`, además, `415 UNSUPPORTED_MEDIA_TYPE` ante un cuerpo que no es JSON.
- Rechazo por origen o por Fetch Metadata: `403 REQUEST_ORIGIN_REJECTED`, con `Cache-Control: no-store` y un mensaje genérico, sin el origen esperado ni la regla que falló.
- Cualquier otro error responde `500 INTERNAL_ERROR` con un mensaje genérico; el detalle y el stack quedan solo en el log, con el mismo `requestId`.

Ejecución: en desarrollo, `node --watch --env-file-if-exists=.env --conditions=development src/main.ts` (type stripping nativo, sin `tsx`); en producción, `tsc -p tsconfig.build.json` y `node dist/main.js`. El código respeta las restricciones de `erasableSyntaxOnly` descritas en ADR 0016.

## Layers

### Domain

Responsibilities:

- Entities.
- Value objects.
- Domain errors.
- Business invariants.

Forbidden dependencies:

- HTTP frameworks.
- Database clients.
- External SDKs.

### Application / Use Cases

Responsibilities:

- Workflows.
- Ports/interfaces.
- DTOs.
- Transaction boundaries when applicable.

Forbidden dependencies:

- Concrete infrastructure.
- HTTP request/response objects.

### Infrastructure

Responsibilities:

- HTTP controllers/routes.
- Database repositories.
- External service clients.
- Background jobs.
- Runtime configuration.

## REST / API Conventions

- Versioning: application routes live under `/api/v1/`; library-owned routes such as Better Auth's `/api/auth/*` stay outside the prefix (ADR 0015).
- Success response shape: use a consistent envelope, for example `{ data, meta? }`.
- Error response shape: use a consistent envelope, for example `{ error: { code, message, details? } }`.
- Pagination: return page metadata with large collections.
- Auth: protect custom routes with middleware backed by Better Auth sessions.
- Validation: validate request params, query, body, environment variables, and external payloads.
- Idempotency: mutations whose repetition would duplicate an effect accept an `Idempotency-Key` header. See `idempotency.md`.
- Status codes: `404` for any record outside the caller's tenant, `409` for state conflicts and in-flight duplicates, `422` for an idempotency key reused with a different payload.

En este proyecto (Q-30, design D8 de `add-invoice-emission`):

- `POST /api/v1/invoices` exige `Idempotency-Key`; sin ella, `400 IDEMPOTENCY_KEY_REQUIRED`. Las entradas y los ajustes del inventario siguen el mismo contrato, con su clave guardada en el movimiento (`add-minimal-inventory`, design D7).
- La clave reutilizada con otra solicitud responde `409 IDEMPOTENCY_KEY_REUSED`, no `422`.
- El alcance es empresa, operación y clave, sin usuario. El registro es durable en PostgreSQL y no expira durante la vida fiscal útil del documento.
- El registro se escribe en la misma transacción que el efecto, no con un reclamo previo. Detalle y diferencias con la plantilla en `idempotency.md`.

## Auth Boundary

- Better Auth owns `/api/auth/*` or the equivalent auth route prefix.
- Register Better Auth before JSON middleware when the framework requires raw request access.
- Application routes must not manually hash passwords.
- Application use cases receive the authenticated user, tenant, and role as plain data resolved from the session, never from the request payload and never as framework objects.

## Database Boundary

- Prisma Client is infrastructure.
- Repositories map Prisma records into domain/application objects.
- Use migrations for schema changes.
- Do not use ad hoc SQL in application code unless documented and isolated.
- Repositories for tenant-owned data take the tenant context as a required parameter and scope every query with it, including updates and deletes. No unscoped lookup by ID exists for private records. See `../security/access-control.md`.

## External Service Boundary

- Use Axios in infrastructure clients; excepción: el adaptador SOAP del SRI usa el `fetch` nativo de Node, solo en infraestructura (ADR 0018, enmienda del transporte).
- Define typed payloads and normalized application responses.
- Provider tokens come from validated environment/runtime settings.
- Provider errors are normalized before reaching UI code.

## Background Jobs

- Job ownership: el módulo `fiscal` es dueño de los jobs de recepción, autorización y reconciliación (`sri.transmit`, `sri.authorize` y `sri.reconcile`, implementados en `add-sri-transmission`), de la recuperación y del RIDE; `taxpayer`, del aviso de vencimiento del certificado; `reports`, de las exportaciones grandes si la medición las exige; `data-portability`, de `portability.export`, con su runner propio de `DATA_EXPORT_MAX_CONCURRENT` lazos, su *lease* renovado con fencing y su barrido (`add-data-portability`, design D10 y D25; detalle en `data-portability.md`). La consulta de validez para observar anulaciones es una capacidad futura (Q-16). Detalle en `fiscal-emission.md`.
- Persistence: cola durable propia en PostgreSQL, en la misma base de datos que los comprobantes, sin librería de jobs (ADR 0012, aceptado el 2026-10-03), en `platform/jobs`. Tiene deduplicación, exclusión por comprobante, `scheduledAt` y `nextAttemptAt`, intentos, arriendo con expiración, selección con `FOR UPDATE SKIP LOCKED`, último error tipado, workers configurables (`SRI_JOB_WORKERS`) en el proceso de la API y apagado ordenado. Los estados del job (`PENDING`, `LEASED`, `DONE`, `STOPPED`) no son estados fiscales.
- Retry policy: backoff exponencial con jitter, configurable por tipo de job, con un máximo de intentos o una ventana, sin reintentos infinitos ni bucles calientes. Las consultas al SRI se reintentan; el envío a recepción solo se reintenta si el fallo demuestra que la solicitud no salió, y en otro caso se reconcilia antes (CTX §33). La autorización se consulta dentro de la ventana de conclusión, 24 horas por defecto.
- RIDE (`add-document-archive`, design D5 y D6):
  - `document.render_ride`, deduplicado por comprobante (`document.render_ride:{documentId}`), nace en la misma transacción que la transición a `AUTHORIZED` por un seguidor de las transiciones que compone `main.ts`; un barrido idempotente (`RIDE_SWEEP_INTERVAL_SECONDS`) es el backfill y la defensa secundaria, y nunca reactiva un job detenido;
  - lo toma un segundo runner con `RIDE_WORKERS` lazos, que el interruptor de la transmisión no pausa y que no toma nada mientras las fuentes del RIDE no estén verificadas; su arriendo cubre la cola y el plazo del pool;
  - el render corre en `RideWorkerPool`, una instancia de la primitiva `platform/workers/worker-pool.ts` independiente del pool criptográfico;
  - un pool ocupado o un apagado reprograman sin gastar el intento; un plazo vencido, un worker caído o un error inesperado reintentan con backoff hasta `RIDE_JOB_MAX_ATTEMPTS`; un rechazo determinista detiene el job con su motivo. El comprobante sigue `AUTHORIZED`;
  - un usuario con `archive.retryRide` reintenta una generación detenida.
- Inventario (`add-minimal-inventory`, design D5): la salida de una factura no es un job. La registra un seguidor de las transiciones en la misma transacción que la transición a `AUTHORIZED`; un fallo revierte la autorización, el job reintenta y reclasifica la respuesta ya guardada del SRI sin volver a llamarlo.
- Cancellation: los jobs fiscales no se cancelan, porque el comprobante ya tiene efectos ante el SRI; un administrador puede ordenar una reconciliación manual, que también reactiva un envío detenido. `MANUAL_REVIEW` es un estado fiscal y solo sale con esa reconciliación (Q-06, resuelta en `add-sri-transmission`). Los jobs `portability.export` no se cancelan en la versión 1: la generación termina lista o fallida (`add-data-portability`, design D25).
- Progress reporting: el estado fiscal del comprobante es el progreso visible; las exportaciones de portabilidad informan su fase y, cuando se conoce el total, los comprobantes agregados, sin un porcentaje estimado.

Use persisted jobs for long-running work that must continue after browser refresh.

Jobs may run more than once. Give each a deduplication key and make its handler idempotent;
see `idempotency.md`.

## Emisión por tipo de comprobante

La reserva, la firma y la reconciliación manual son de `fiscal` y las comparten todos los tipos que
el sistema emite: factura, liquidación de compra, nota de crédito, nota de débito, comprobante de
retención y guía de remisión (`add-credit-notes`, design D2; `add-debit-notes`, design D2;
`add-withholding-receipts`, design D2; `add-shipping-guides`, design D2; `add-purchase-settlements`,
design D2; detalle en `fiscal-emission.md`):

- `reserveDocumentIn` reserva el secuencial, bloquea la identidad tributaria, compone la clave e
  inserta el comprobante `RESERVED` con su transición, dentro de la transacción del módulo que emite.
  Las columnas del receptor son un comprador con el total (`BUYER`) o, para la guía, sus
  destinatarios en `electronic_document_recipient` sin total ni comprador (`RECIPIENTS`).
- `createSigningPipeline` lleva el comprobante de `RESERVED` a `SIGNED` con el perfil de su tipo
  (`SigningProfile`: builder del XML desde el snapshot y auditoría del paso a `SIGNED`); `main.ts`
  compone `signingPipelines` una vez y entrega a cada módulo su pipeline.
- `requestReconciliationIn` hace la solicitud manual; cada módulo pone su ruta, su permiso y su
  auditoría.
- `fiscal/domain/document-amounts.ts` reúne las primitivas de los importes de un comprobante con
  líneas e impuestos (subtotal, descuento, base, impuesto, materialización HALF_UP y totales), sin
  conocer ningún tipo: la factura las reexporta con sus nombres y la liquidación de compra las usa
  en su cálculo versionado, sin importar `invoices` (`add-purchase-settlements`, design D8).

Por tipo quedan el borrador, la evaluación, el snapshot, el builder del XML, la distribución del
RIDE, las rutas y las pantallas. Un tipo nuevo registra su perfil; no se agrega un conmutador por
`codDoc`.

## Inventario

El módulo `inventory` (`add-minimal-inventory`) lleva stock contabilizado por hechos fiscales
autorizados, nunca una reserva de disponibilidad:

- **Capas.**
  - `domain/stock.ts`: el signo de cada tipo de movimiento, el estado derivado (`NOT_TRACKED`, `TRACKED_NOT_INITIALIZED`, `TRACKED_INITIALIZED`, `DISABLED_INITIALIZED`), las salidas de una factura agrupadas por producto en orden estable y el rango del kárdex en fechas de Ecuador;
  - `application/`: los casos de uso (inicializar, fijar el control, entradas, ajustes, lista, detalle y kárdex) y el seguidor de la autorización (`invoice-outflow.ts`);
  - `infrastructure/`: el repositorio del saldo y del kárdex, sus lecturas, la unidad de trabajo, la reconciliación diagnóstica, las métricas y las rutas.
- **Dirección.** `fiscal`, `invoices` y `products` no importan `inventory`. `main.ts` compone el seguidor `inventoryOutflowFollower`, `StockReads` para `invoices` (la decisión de cada línea en el snapshot versión 2 y los avisos del borrador) e `InventoryInitialization` para `products` (la marca de un producto con inventario solo cambia desde el inventario). El inventario lee el producto, la página de la lista y la marca con la lectura exportada de `products`, y las líneas de la factura con la de `invoices`; nunca sus tablas.
- **Saldo.** Un saldo materializado por producto (`stock_balance`) y un kárdex de solo agregado (`stock_movement`) con variaciones con signo. Cada movimiento suma su variación con una actualización atómica que bloquea la fila del saldo hasta el fin de la transacción y toma de ella su posición y su saldo resultante; nunca se lee, se calcula y se escribe. Los triggers de la base encadenan cada movimiento con el anterior y comprueban al confirmar que el saldo es el resultante de su último movimiento (`database.md`).
- **Concurrencia.** La inicialización, el control, las entradas, los ajustes y la corrección de la marca toman un lock transaccional por empresa y producto (`pg_advisory_xact_lock`). Una factura bloquea los saldos de sus productos en orden de `productId`, así que dos facturas con los mismos productos no se bloquean entre sí.
- **Salida.** Solo de las líneas con `inventoryAffectsStock` en el snapshot, congelado al reservar: el seguidor no consulta el producto ni la marca vigentes, así que desactivar el control no cancela las salidas de las facturas ya emitidas.
- **Reconciliación.** `reconcileStock` compara cada saldo con la suma de su kárdex; la usan las pruebas y `bench:inventory`. No hay ruta para recalcular ni fijar el saldo.
- **Métricas.** `inventory_movements_total{type}` e `inventory_negative_balances` (`observability.md`).

## Notas de crédito

El módulo `credit-notes` (`add-credit-notes`) emite notas de crédito contra facturas propias
autorizadas, con capacidades que fallan cerradas:

- **Capas.**
  - `domain/`: el cálculo único y versionado de los importes (`calculateCreditNoteAmounts`, objetivos acumulados), la evaluación en el orden de design D4, la vista previa pura y el snapshot autosuficiente de la nota;
  - `application/`: borradores, emisión (comprobación previa y transacción de `RESERVED`), reintento de firma, consultas, el perfil de la firma y el seguidor de la capacidad acreditable;
  - `infrastructure/`: borradores, capacidad acreditable y su reconciliación diagnóstica, lecturas de la preparación de la empresa, facturas elegibles, unidades de trabajo, métricas y rutas.
- **Dirección.** `fiscal`, `invoices` e `inventory` no importan `credit-notes`. `main.ts` compone la lectura de la factura (`invoiceCreditSource`, con la integridad del snapshot y de sus artefactos), la capacidad devolvible de `inventory` (`stockReturnCapacity`, puerto `ReturnCapacity`), la firma compartida con `creditNoteSigningProfile` y los seguidores.
- **Capacidad acreditable.** Por factura y por línea (`credit_capacity`, `credit_capacity_line`): reservado y aplicado nunca superan lo original (`CHECK`) y siempre son la suma de las reservas por estado (triggers diferidos). La reserva toma `pg_advisory_xact_lock` de la factura antes de leer lo vigente; la capacidad acreditable se bloquea antes que la devolvible, por producto en orden de `productId`.
- **Capacidad devolvible.** Por factura y producto (`stock_return_capacity`), igual a la salida de la factura, independiente de la acreditable.
- **Ciclo de vida, fallando cerrado.** La capacidad queda reservada en `RESERVED`, `SIGNED`, `RECEIVED`, `SEND_UNKNOWN` y `MANUAL_REVIEW`. En la transacción de la transición terminal de la nota, `creditCapacityFollower` la aplica (`AUTHORIZED`) o la libera (`RETURNED`, `NOT_AUTHORIZED`), y después `creditNoteReturnFollower` aplica el retorno físico con su `DEVOLUCION_NC` o lo libera. Un resultado incierto, un job detenido, un error de transporte o del parser, los reintentos agotados o una caída no la liberan, y no existe un job de limpieza por antigüedad. Los triggers diferidos de design D25 rechazan al confirmar una reserva que no corresponde al estado de su nota.
- **Reconciliación.** `reconcileCreditCapacity` y `reconcileStockReturnCapacity` comparan cada capacidad con sus reservas; las usan las pruebas y `bench:credit-notes`.
- **Métricas.** `credit_note_reservations_total{cause}`, `credit_note_reservation_conflicts_total{reason}` y `credit_note_reservations_unconcluded_over_24h`, la señal de la alerta de reservas sin conclusión (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.

## Notas de débito

El módulo `debit-notes` (`add-debit-notes`) emite notas de débito contra facturas propias
autorizadas, sin capacidades ni inventario:

- **Capas.**
  - `domain/`: los tratamientos de IVA de la factura (`invoiceTaxTreatments`), el cálculo único y versionado por tratamiento (`calculateDebitNoteAmounts`), la evaluación en el orden de design D4, la vista previa pura y el snapshot autosuficiente;
  - `application/`: borradores, emisión (comprobación previa y transacción de `RESERVED`), consultas, reintento de firma, reconciliación manual y el perfil de la firma;
  - `infrastructure/`: borradores, lecturas de la preparación de la empresa con el resolver de `catalogs` para la forma de pago, facturas elegibles, la lista, unidades de trabajo, métricas y rutas.
- **Dirección.** `fiscal`, `invoices`, `inventory` y `credit-notes` no importan `debit-notes`, y `debit-notes` no importa `inventory` ni `credit-notes`. `main.ts` compone la lectura de la factura (`invoiceCreditSource`) y la firma compartida con `debitNoteSigningProfile`.
- **Reserva.** Sin bloqueo de la factura: la nota no consume ninguna capacidad suya y `AUTHORIZED` no tiene salida. El borrador y la configuración se bloquean; la factura de la nota se registra en `debit_note_support`, con un trigger que exige una factura autorizada de la misma empresa y del mismo ambiente y otro, diferido, que impide confirmar un comprobante `05` sin ella (`database.md`).
- **Forma de pago.** Una sola, resuelta con `catalogs.availability` en la fecha de la reserva (vigencia y habilitación) y congelada en `snapshot.payments`; el XML y el RIDE la toman del snapshot.
- **Métricas.** `debit_note_reservations_total` y `debit_note_concepts_total{cause}` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.

## Comprobantes de retención

El módulo `withholding-receipts` (`add-withholding-receipts`) emite comprobantes de retención 2.0.0
de renta e IVA a un proveedor, con documentos sustento externos y sin capacidades ni inventario:

- **Capas.**
  - `domain/`: el cálculo único y versionado (`calculateWithholdingAmounts`), la evaluación pura en el orden de design D15 (`evaluateWithholdingReceipt`), la vista previa y el snapshot autosuficiente (`buildWithholdingSnapshot`);
  - `application/`: borradores, opciones, contexto de catálogos, emisión (comprobación previa y transacción de `RESERVED`), consultas, reintento de firma, reconciliación manual, diagnósticos, la proyección del XML y el perfil de la firma;
  - `infrastructure/`: borradores, lecturas de la preparación de la empresa, la lista, unidades de trabajo, métricas y rutas.
- **Dirección.** `fiscal`, `invoices`, `inventory`, `credit-notes` y `debit-notes` no importan `withholding-receipts`, y `withholding-receipts` no importa ninguno de ellos ni `parties`. `main.ts` compone la lectura de los proveedores (`supplierReader`, puerto `WithheldPartyReader`) y la firma compartida con `withholdingReceiptSigningProfile`. El diagnóstico compartido de la firma y el motivo de una transmisión detenida son de `fiscal` (`signing-diagnostics.ts`, `transmission-messages.ts`).
- **Reserva.** Sin recursos compartidos que bloquear: los documentos sustento son externos y no consumen capacidad. El borrador y la configuración se bloquean; el registro del comprobante y sus líneas (`withholding_receipt`, `withholding_receipt_line`) se insertan con la reserva, con triggers que exigen un comprobante `07` de la misma empresa y otro, diferido, que impide confirmar un `07` sin su registro (`database.md`).
- **Independencia.** Autorizada, devuelta o no autorizada, una retención no registra movimientos de inventario, no cambia las capacidades acreditables ni las devolvibles y no modifica ninguna factura ni nota; las reconciliaciones no informan diferencias (`test/integration/withholding-independence.test.ts`).
- **Métricas.** `withholding_receipt_reservations_total` y `withholding_receipt_items_total{tax}` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.

## Guías de remisión

El módulo `shipping-guides` (`add-shipping-guides`) emite guías de remisión 1.1.0 con uno o varios
destinatarios, sin total monetario, sin inventario, capacidades ni roles:

- **Capas.**
  - `domain/`: el borrador, la evaluación pura en el orden de design D12 (`evaluateShippingGuide`), la vista previa y el snapshot autosuficiente con la declaración congelada por destinatario (`buildShippingGuideSnapshot`);
  - `application/`: borradores (con la propuesta desde una factura), opciones y búsquedas, las mercancías sugeridas no autoritativas (`suggestedGoods`), el contexto de la evaluación, la emisión (comprobación previa, declaración y transacción de `RESERVED`), consultas, reintento de firma, reconciliación manual, diagnósticos, la proyección del XML y el perfil de la firma;
  - `infrastructure/`: borradores, lecturas de la preparación de la empresa y de sus establecimientos, las facturas elegibles, la lista, unidades de trabajo, métricas y rutas.
- **Dirección.** Ningún módulo importa `shipping-guides`, salvo `main.ts`, y `shipping-guides` no importa `inventory`, `invoices`, `parties`, `products` ni otro comprobante. `main.ts` compone los puertos `ShippingPartyReader` (`shippingPartyReader` de `parties`), `ShippingProductReader` (`productReader`) y `ShippingInvoiceReader` (`invoiceCreditSource`, sin cambios), y la firma compartida con `shippingGuideSigningProfile`. El builder XML (`shipping-guide-xml-builder.ts`) vive en `sri-engine` con su proyección del snapshot.
- **Reserva.** Sin recursos compartidos que bloquear: una factura sustento no tiene capacidad que consumir. El borrador y la configuración se bloquean; la cabecera común (`electronic_document`, sin total ni comprador) y sus destinatarios (`electronic_document_recipient`), el registro de la guía y sus destinatarios (`shipping_guide`, `shipping_guide_recipient`) se insertan con la reserva, con triggers que exigen un `06` de la empresa, una factura `01` autorizada del mismo ambiente y un origen distinto del destino en un traslado propio, y otro, diferido, que impide confirmar un `06` sin sus registros (`database.md`).
- **Independencia.** Autorizada, devuelta o no autorizada, una guía no registra movimientos de inventario, no cambia la factura sustento ni sus capacidades y no asigna roles; las reconciliaciones no informan diferencias (`test/integration/shipping-guide-independence.test.ts`).
- **Métricas.** `shipping_guide_reservations_total` y `shipping_guide_recipients_total{support}` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.

## Liquidaciones de compra

El módulo `purchase-settlements` (`add-purchase-settlements`) emite liquidaciones de compra 1.1.0 de
la empresa como adquirente, solo en el caso c) del art. 13 del Reglamento de Comprobantes de Venta,
sin inventario, compras ni retenciones:

- **Capas.**
  - `domain/`: el borrador, el cálculo versionado (`calculatePurchaseSettlementAmounts`, sobre `fiscal/domain/document-amounts.ts`), la evaluación pura en el orden de design D12 (`evaluatePurchaseSettlement`), la vista previa y el snapshot autosuficiente con las cuatro declaraciones congeladas (`buildPurchaseSettlementSnapshot`);
  - `application/`: borradores, opciones y proveedores, el contexto de la evaluación, la emisión (comprobación previa, declaraciones y transacción de `RESERVED`), consultas, reintento de firma, reconciliación manual, diagnósticos, la proyección del XML y el perfil de la firma;
  - `infrastructure/`: borradores, lecturas de la preparación de la empresa y de los catálogos, la lista, unidades de trabajo, métricas y rutas, con el parser propio de 4 MiB de los borradores.
- **Dirección.** Ningún módulo importa `purchase-settlements`, salvo `main.ts`, y `purchase-settlements` no importa `inventory`, `invoices`, `parties`, `products` ni otro comprobante. `main.ts` compone los puertos `PurchaseSupplierReader` (`purchaseSupplierReader` de `parties`) y `PurchaseProductReader` (`productReader`), y la firma compartida con `purchaseSettlementSigningProfile`. El builder XML (`purchase-settlement-xml-builder.ts`) vive en `sri-engine` con su proyección del snapshot.
- **Reserva.** Sin recursos compartidos que bloquear. El borrador y la configuración se bloquean; el comprobante con el proveedor como contraparte genérica y el importe total, el registro de la liquidación y sus cuatro declaraciones (`purchase_settlement`, `purchase_settlement_declaration`) se insertan con la reserva, con un trigger que exige un `03` de la empresa y otro, diferido, que impide confirmar un `03` sin su registro ni sus cuatro declaraciones (`database.md`).
- **Independencia.** Autorizada, devuelta o no autorizada, una liquidación no registra movimientos de inventario ni cambia saldos, capacidades, facturas, productos ni roles, y no crea compras, cuentas por pagar, facturas recibidas ni retenciones (`test/integration/purchase-settlement-independence.test.ts`).
- **Métricas.** `purchase_settlement_reservations_total` (`../quality/observability.md`). Con `EMISSION_STAGE_TIMINGS`, la emisión devuelve sus etapas en `Server-Timing`.

## Reportes

El módulo `reports` (`add-reports-export`) lista y exporta a XLSX los cinco reportes del ERS sin
leer tablas: cada módulo dueño exporta la fuente de su reporte y `main.ts` la compone como puerto.

- **Fuentes.** Una fuente (`platform/db/report-source.ts`) es una sola consulta ordenada, con las tablas calificadas por el esquema: la página la recorre con `LIMIT` y `OFFSET`, la exportación con un cursor (`DECLARE … CURSOR`, `FETCH`) dentro de su transacción, y el conteo usa el mismo `FROM` y el mismo `WHERE`. La lista y el XLSX no pueden divergir.

  | Reporte | Módulo dueño | Lee | Orden total |
  | --- | --- | --- | --- |
  | Documentos emitidos | `fiscal` (`createIssuedDocumentsReportSource`) | `electronic_document` con sus columnas congeladas, sus destinatarios y la proyección de importes de cada tipo | Emisión, creación e identificador, descendentes |
  | Facturas | `fiscal` (`createInvoicesReportSource`) | Las facturas, con el IVA y los otros impuestos de su snapshot | El mismo |
  | Retenciones | `withholding-receipts` (`createWithholdingsReportSource`) | `withholding_receipt_line`, `withholding_receipt` y el comprobante, con la denominación del impuesto de su snapshot | El del comprobante, el sustento y la línea |
  | Existencias | `inventory` (`inventoryBalanceReads`) y `products` (`createReportProductsSource`) | Los productos con `stock_balance` y su saldo registrado, ordenados por `products` | Nombre normalizado e identificador |
  | Movimientos | `inventory` (`createInventoryMovementsReportSource`) y `products` (`reportProductLabels`) | `stock_movement` de toda la empresa, con el código y el nombre vigentes del producto | Momento e identificador, descendentes |
  | Terceros | `parties` (`createPartiesReportSource`) | `party`, con los datos vigentes | Razón social normalizada e identificador |

- **Importes.** Cada módulo de comprobante declara la proyección de su snapshot (`fiscal/infrastructure/reports/amount-projections.ts`): el subtotal y la suma de los impuestos en SQL con `NUMERIC`. La fuente las compone en un `CASE` por tipo y exige una por cada uno de los seis tipos. La retención solo tiene su total retenido y la guía ninguno: nunca un 0.00 inventado.
- **Ambiente.** `taxpayer` exporta `currentEnvironment`, el de la configuración vigente de la empresa, leído en cada solicitud.
- **Dirección.** Ningún módulo importa `reports`, salvo `main.ts`, y `reports` solo importa `identity` y `audit`; `test/architecture/reports-dependency-direction.test.ts` lo comprueba.

## Tablero de Inicio

El módulo `dashboard` (spec `dashboard`) responde `GET /api/v1/dashboard` con el resumen de la
empresa en su ambiente vigente, sin leer tablas: cada módulo dueño exporta su lectura y `main.ts` la
compone como puerto (`DashboardSources`).

| Dato | Módulo dueño | Lee |
| --- | --- | --- |
| Ventas por mes, comprobantes por tipo, atención, rechazos, mejores clientes y productos, últimos comprobantes | `fiscal` (`createDocumentSummary`) | `electronic_document` del ambiente: sus columnas congeladas y las líneas de su snapshot |
| Comprobantes con la transmisión detenida | `fiscal` (`createTransmissionReader().stoppedDocumentIds`) | Los `sri.*` detenidos sin un job posterior |
| Borradores pendientes | `invoices` (`invoiceDraftCount`) | `invoice_draft` en `DRAFT` |
| Productos agotados | `inventory` (`outOfStockCount`) | `stock_balance` con saldo cero o negativo |
| Ambiente | `taxpayer` (`currentEnvironment`) | La configuración vigente |

- **Ventas.** Solo las facturas `AUTHORIZED`; los meses son los de la fecha de emisión, que ya es la
  de Ecuador. Las sumas son `NUMERIC` en SQL y salen como cadenas decimales canónicas.
- **Permiso.** `invoices.read`.
- **Dirección.** Ningún módulo importa `dashboard`, salvo `main.ts`, y `dashboard` solo importa
  `identity` y `catalogs`; `test/architecture/dashboard-dependency-direction.test.ts` lo comprueba.

## Portabilidad de datos

El módulo `data-portability` (`add-data-portability`) genera el paquete de portabilidad sin leer
tablas de otros módulos: cada dueño exporta sus conjuntos y `main.ts` los compone como puertos
(`data-portability/application/ports.ts`). Detalle del módulo en `data-portability.md` y del formato
en `data-portability-format.md`.

- **Fuentes.** Cada conjunto es una sola consulta ordenada de toda la empresa (`sqlCompanyBatches`), recorrida por lotes con un cursor dentro de la transacción `REPEATABLE READ, READ ONLY` de la fase 1. Cada fuente proyecta solo sus columnas permitidas: ninguna lee `signing_certificate_secret` ni las tablas internas de Better Auth.

  | Conjunto | Módulo dueño | Lee |
  | --- | --- | --- |
  | Configuración, logos, establecimientos, puntos y puntos predeterminados | `taxpayer` (`createTaxpayerPortabilitySources`) | `company_config_version` con `company_config`, `configuration_asset` (sin los bytes), `establishment`, `emission_point` y `member_default_emission_point` |
  | Comprobantes, transiciones, intentos, destinatarios, entregas y secuenciales | `fiscal` (`createFiscalPortabilitySources`) | `electronic_document` con la proyección de importes de cada tipo, el inventario de `document_artifact` y de `sri_response`, el job del RIDE, `document_state_transition`, `sri_attempt` con su resultado, `electronic_document_recipient`, `document_delivery_event` y `fiscal_sequence` |
  | Habilitaciones de catálogos | `catalogs` (`createCatalogPortabilitySources`) | `company_fiscal_catalog_setting` con el código de `fiscal_catalog_key` |
  | Firmas | `signing` (`createSigningPortabilitySources`) | Solo los metadatos de `signing_certificate` |
  | Usuarios | `identity` (`createIdentityPortabilitySources`) | `member` con el nombre y el correo de `user` |
  | Terceros, productos e impuestos | `parties`, `products` | `party`, `product` y `product_tax` |
  | Existencias y kárdex | `inventory` (`createInventoryPortabilitySources`) | `stock_balance` y `stock_movement` |
  | Auditoría | `audit` (`createAuditPortabilitySources`) | `audit_event` |
  | Líneas de retención | `withholding-receipts` (`createWithholdingPortabilitySources`) | `withholding_receipt_line` con la clave de acceso del comprobante |

- **Lecturas por identificador.** La fase 2 lee el snapshot inmutable, los artefactos, las respuestas del SRI y los logos por identificador y empresa (`readSnapshot`, `readArtifact`, `readSriResponse`, `readLogo`), con su tamaño y su SHA-256 conservados, que recalcula antes de escribirlos.
- **Dirección.** Ningún módulo importa `data-portability`, salvo `main.ts`, y `data-portability` solo importa `identity` y `audit`; `test/architecture/data-portability-dependency-direction.test.ts` lo comprueba.

## Catálogos de retención y de sustento

`add-withholding-receipts` (design D7 a D12) agrega al módulo `catalogs` cinco catálogos de
entradas, con sus datasets versionados y la misma carga al arrancar:

- **Catálogos.** `withholding-tax` (tabla 19 de la ficha), `withholding-iva-code` (tabla 20),
  `withholding-income-concept` (tabla 3.10 del Catálogo ATS), `support-document-type` (tabla 4) y
  `support-code` (tabla 5). Las fuentes y la derivación están en `../product/sri-catalogs/`.
- **Clasificación.** Cada entrada guarda su `scopeClassification`. `isSelectableScope` (contratos)
  decide si se puede elegir: solo `SUPPORTED`, `SUPPORTED_FIXED` y `SUPPORTED_FIXED_RESIDENT`. Las
  entradas de los catálogos de la factura no tienen clasificación y siempre se pueden elegir.
- **Utilizable.** `isUsable` exige versión aplicable, habilitación y clasificación soportada, así que
  la consulta, `availability` y el resolver de la emisión aplican la misma regla.
- **Habilitación.** `withholding-iva-code` y `withholding-income-concept` son habilitables y
  habilitados por defecto. Habilitar o deshabilitar una entrada sin versión soportada responde
  `400 CATALOG_ENTRY_NOT_SELECTABLE`.
- **Consulta.** La vista de cada versión agrega `withholding`: la clasificación, si se puede elegir,
  el porcentaje (`porcentajeRetener`), el texto literal y los sustentos admitidos. Los códigos se
  ordenan con comparación numérica (`303`, `303A`, `323 M`, `3250`).

## Sensitive Operations

A sensitive operation reads or changes private data, money, inventory, permissions, files,
or anything another account must not see. Before writing one, answer these in the design of
its OpenSpec change:

1. Who may execute this action?
2. Which tenant does the caller belong to?
3. Which tenant does the resource belong to?
4. How is ownership validated?
5. Can changing an ID in the request reach another account's data?
6. What happens if the request arrives twice?
7. What happens if two requests arrive at once?
8. Does the operation need idempotency, and by which mechanism?
9. Which database constraints protect its invariants?
10. Does it need an audit record?
11. Which authorization tests must be added?
12. Is there any path for data to leak between accounts?

An unanswered question blocks implementation, as the screen brief does for interfaces.

### Pipeline

Process a sensitive operation in this order. Each step depends on the ones before it.

```text
authentication
  -> user context
  -> tenant context
  -> authorization
  -> ownership validation
  -> input validation
  -> idempotency claim, when required
  -> transaction or atomic operation
  -> persistence
  -> audit record
  -> sanitized response
```

Authentication and context resolution live in HTTP middleware. Authorization, ownership,
idempotency, and the transaction live in the use case and its tenant-aware repository. Parse
only the identifiers that ownership needs before authorizing, and validate the rest of the
payload afterwards, so an unauthorized caller learns nothing from validation errors.

### Reporting Format

When implementing a sensitive operation, report in this order:

1. The relevant risks.
2. The authorization boundaries.
3. Whether it needs idempotency, and by which mechanism.
4. The implementation.
5. The validations added.
6. The database constraints added.
7. The tests added.
8. Security risks found in existing code, even outside the task.

Never weaken an authorization control to make a test pass, and never trade data isolation for
simpler code.
