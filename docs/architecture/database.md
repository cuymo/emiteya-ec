# Database Architecture

## Primary Database

- Engine: PostgreSQL.
- ORM/query layer: Prisma.
- Migration strategy: versioned Prisma migrations.

## Data Ownership

Modelo objetivo derivado de `../product/domain-model.md`. La columna de tenant es
`company_id` en todo el esquema (ADR 0009). Las tablas existentes y sus restricciones están en
"Esquema actual"; el resto de la tabla es el modelo objetivo.

| Table/Collection | Owner | Tenant scoped | Notes |
| --- | --- | --- | --- |
| `organization` (plugin Organization de Better Auth) | `identity` | Es el tenant | La empresa: su `id` es el `company_id` de todo recurso privado. Una por instalación en el MVP como política operativa del aprovisionamiento; ninguna restricción estructural limita el número de empresas (ADR 0009). Los datos tributarios van en una tabla propia de `taxpayer`. |
| `company_config` | `taxpayer` | Yes | Cabecera: versión vigente e identidad tributaria bloqueada. |
| `company_config_version` | `taxpayer` | Yes | Inmutable; los snapshots de los comprobantes la referencian. |
| `configuration_asset` | `taxpayer` | Yes | Logo y demás contenido inmutable con tipo MIME, tamaño y SHA-256; la versión de configuración lo referencia y no se duplica (ADR 0017). |
| `establishment`, `emission_point` | `taxpayer` | Yes | Se desactivan; nunca se borran. Código inmutable. |
| `member_default_emission_point` | `taxpayer` | Yes | Punto predeterminado de cada membresía; solo preselecciona (Q-23). |
| `signing_certificate` | `signing` | Yes | Metadatos de la firma electrónica; a lo sumo una `ACTIVE` por empresa; sin borrado, solo `ACTIVE` → `REPLACED` (ADR 0011). |
| `signing_certificate_secret` | `signing` | Yes | P12 y contraseña cifrados de la firma `ACTIVE`; nunca se exponen; se destruyen al reemplazar (ADR 0011). |
| `signing_certificate_settings` | `signing` | Yes | Anticipación del aviso de vencimiento por empresa; sin fila, 30 días. |
| `member` (plugin Organization de Better Auth) | `identity` | Yes | La membresía: rol `ADMIN` u `OPERATOR` y `status`, con `UNIQUE (organizationId, userId)` y `CHECK` propios. Las cuentas son de Better Auth. |
| `fiscal_sequence` | `fiscal` | Yes | Contador por empresa, ambiente, establecimiento, punto y tipo; bloqueo de fila al reservar. |
| `fiscal_sequence_reservation` | `fiscal` | Yes | Solo agregado: un registro por número reservado, con la unicidad de CTX §5. |
| `party` | `parties` | Yes | Se desactivan; nunca se borran. Los comprobantes guardan su copia. El consumidor final es un registro del sistema, uno por empresa e inmutable. |
| `product`, `product_tax` | `products` | Yes | Se desactivan; nunca se borran. Los comprobantes guardan su copia; los impuestos refieren la identidad de una entrada fiscal, nunca una tarifa. |
| `fiscal_catalog_dataset`, `fiscal_catalog_key`, `fiscal_catalog_entry`, `consumer_final_policy`, `sri_transmission_policy`, `schema_registry_entry`, `special_case_support` | `catalogs` | No | Datos normativos versionados del sistema, que el cargador aplica al arrancar desde los datasets del repositorio (ADR 0020). Sin borrado; las versiones publicadas solo cierran su vigencia o se retiran. |
| `company_fiscal_catalog_setting` | `catalogs` | Yes | Decisión explícita de una empresa sobre una entrada habilitable; sin fila rige la política por defecto del catálogo. |
| `invoice_draft`, `invoice_draft_line`, `invoice_draft_payment` | `invoices` | Yes | Borrador editable previo a la emisión, sin datos fiscales; emitido, queda inmutable con su comprobante. |
| `electronic_document` | `fiscal` | Yes | Nace en `RESERVED` con su snapshot inmutable, su secuencial confirmado y su clave de acceso; solo pasa a `SIGNED` con su artefacto, sigue la tabla de transiciones de la transmisión y nunca se borra (Q-35). La autorización, una vez escrita, no cambia. |
| `document_line`, `document_relation`, `tax_detail`, `payment` | `fiscal` | Yes | Inmutables desde la firma. La corrección de un devuelto (BR-28) es una capacidad futura (`correct-returned-document`). |
| `document_state_transition` | `fiscal` | Yes | Solo agregado (ERS RF-525). |
| `sri_attempt`, `sri_response`, `sri_attempt_result` | `fiscal` | Yes | Solo agregado: un intento por interacción con el SRI, su respuesta original confirmada antes de clasificarla y, aparte, su clasificación (design D5 de `add-sri-transmission`). |
| `document_artifact` | `fiscal` | Yes | Solo agregado: bytes exactos en `bytea`, con hash y metadatos, detrás de un puerto de almacenamiento (ADR 0010). |
| `document_delivery_event` | `fiscal` | Yes | Solo agregado: entregas observables (`DOWNLOAD`, `PRINT_REQUESTED`) atadas a un artefacto existente, sin el contenido del documento (Q-24, design D9 de `add-document-archive`). |
| `stock_balance` | `inventory` | Yes | Su existencia es la inicialización del inventario de un producto. Guarda el saldo materializado, siempre igual al kárdex. No se borra (design D2 de `add-minimal-inventory`). |
| `stock_movement` | `inventory` | Yes | Solo agregado (ERS RF-313): variación con signo, saldo resultante y posición en el kárdex. |
| `credit_note_draft`, `credit_note_draft_line` | `credit-notes` | Yes | Borrador de nota de crédito sobre una factura propia; no reserva nada. Emitido, queda inmutable con su comprobante (design D5 de `add-credit-notes`). |
| `credit_capacity`, `credit_capacity_line` | `credit-notes` | Yes | Capacidad acreditable de una factura y de cada línea: original inmutable, reservado y aplicado, siempre la suma de sus reservas. Nace con la primera nota; no se borra (design D7). |
| `credit_reservation`, `credit_reservation_line` | `credit-notes` | Yes | Una reserva por nota, de solo agregado: solo pasa de `RESERVED` a `APPLIED` o `RELEASED`. Sus líneas, inmutables, son lo acreditado vigente (design D6 y D7). |
| `stock_return_capacity`, `stock_return_reservation` | `inventory` | Yes | Capacidad devolvible por factura y producto, igual a su salida, y el retorno físico reservado por nota y producto, con las guardas de la reserva acreditable (design D10). |
| `debit_note_draft`, `debit_note_draft_concept` | `debit-notes` | Yes | Borrador de nota de débito sobre una factura propia, con su única forma de pago y sus conceptos; no reserva nada. Emitido, queda inmutable con su comprobante (design D20 y D26 de `add-debit-notes`). |
| `debit_note_support` | `debit-notes` | Yes | La factura que modifica cada nota de débito, una por nota e inmutable (design D26). |
| `idempotency_record` | `platform` | Yes | Solo agregado: empresa, operación, clave y huella de la solicitud. Sin purga mientras dure la vida fiscal del comprobante (Q-30). |
| `job` | `platform` | Yes | Cola durable propia con deduplicación, arriendo e intentos (ADR 0012, aceptado). Sus estados no son estados fiscales. |
| `audit_event` | `audit` | Yes | Solo agregado. |
| `report_export` | `reports` | Yes | Opcional (ERS §13). |

## Migration Rules

- Schema changes require a migration.
- Generated database docs must be refreshed after migrations.
- Destructive migrations require an explicit data plan.
- Production migration credentials should be limited after initial provisioning.
- Use PostgreSQL in production. Do not silently fall back to SQLite.
- Avoid data loss on redeploy. Application containers must not own production database storage.

## Integrity Constraints

Critical invariants live in the database, not only in application code. Code-level checks
race, and every new code path can forget them.

```sql
-- One outcome per idempotency key, scoped by tenant, user, and operation.
UNIQUE (tenant_id, user_id, operation, idempotency_key)

-- One local record per provider payment, per tenant.
UNIQUE (tenant_id, external_payment_id)

-- Each provider event is processed once.
UNIQUE (provider, provider_event_id)

-- A balance never goes negative, whatever the code does.
CHECK (balance >= 0)
```

- Use foreign keys for every real relationship.
- For tenant-owned children, use composite foreign keys that include the tenant, so a row cannot reference another tenant's parent.
- Prisma does not express `CHECK` constraints or Row-Level Security policies in the schema. Add them to the migration SQL and list them in this document.
- When Row-Level Security is used, set the tenant per transaction and never per pooled connection.

```prisma
model Project {
  id       String @id @default(cuid())
  tenantId String
  tasks    Task[]

  @@unique([tenantId, id])
}

model Task {
  id        String  @id @default(cuid())
  tenantId  String
  projectId String
  project   Project @relation(fields: [tenantId, projectId], references: [tenantId, id])

  @@index([tenantId, projectId])
}
```

See `idempotency.md` and `../security/access-control.md` for the rules these constraints back.

### Restricciones del proyecto

Fuentes: ERS §13.1, CTX §5 y §61. Las marcadas con `Q-xx` dependen de una pregunta abierta.

```sql
-- Estructura de emisión (ERS RF-112)
UNIQUE (company_id, code)                                      -- establishment
UNIQUE (company_id, establishment_id, code)                    -- emission_point
CHECK  (code ~ '^[0-9]{3}$')                                   -- ambos

-- Numeración (ERS RF-120, RF-124; CTX §5)
UNIQUE (company_id, environment, emission_point_id, document_type) -- fiscal_sequence (ADR 0003)
CHECK  (next_number BETWEEN 1 AND 1000000000)                 -- 1000000000: agotado, valor interno
CHECK  (next_number > COALESCE(last_reserved, 0))
UNIQUE (company_id, environment, establishment_code, emission_point_code, document_type, sequential)
                                                               -- electronic_document (CTX §5, I-12)

-- Clave de acceso (ERS §13.1; CTX I-01, I-02, I-13)
UNIQUE (access_key) WHERE access_key IS NOT NULL
CHECK  (access_key ~ '^[0-9]{49}$')

-- Idempotencia de la emisión (Q-30): empresa del contexto autenticado, con la huella canónica
-- de la solicitud; durable mientras dure la vida fiscal útil del documento
UNIQUE (company_id, operation, idempotency_key)

-- Catálogos
UNIQUE (company_id, identification_type, identification_number) -- party
UNIQUE (company_id, main_code) WHERE main_code IS NOT NULL     -- product
UNIQUE (active_company_id)                                     -- signing_certificate: una ACTIVE por empresa

-- Inventario (ERS RF-206, AC-08; design D2 de add-minimal-inventory). Sin índices parciales:
-- document_id solo existe en salidas y devoluciones, y la clave solo en entradas y ajustes.
UNIQUE (company_id, document_id, product_id, movement_type)
UNIQUE (company_id, idempotency_operation, idempotency_key)
UNIQUE (company_id, product_id, position)                -- con INICIAL ⇔ position = 1

-- Notas de crédito (design D7 y D10 de add-credit-notes): la capacidad nunca se excede, aunque un
-- camino olvide el bloqueo de la factura
CHECK (reserved_total + applied_total <= original_total)        -- credit_capacity
CHECK (reserved_quantity + applied_quantity <= original_quantity) -- credit_capacity_line, stock_return_capacity
UNIQUE (company_id, credit_note_id)                             -- credit_reservation: una por nota
```

- El comprobante guarda los códigos de establecimiento y punto como parte de su snapshot, además de las claves foráneas.
- Importes, precios, cantidades y tarifas son `NUMERIC` sin escala fija, con un `CHECK` de dominio que fija la regla del XSD de su especificación decimal (mínimo, decimales y dígitos totales), según `decimal-policy.md`. Nunca `NUMERIC(p, s)`, que limita la parte entera (Q-43). El builder aplica la escala de cada campo (CTX §10.6). Nunca `float` ni `double`.
- Las claves foráneas desde las tablas fiscales hacia terceros, productos, usuarios y establecimientos usan `ON DELETE RESTRICT`. Nada borra en cascada comprobantes ni artefactos (ERS §13.1).
- Las tablas de solo agregado se protegen en la base de datos: el rol de la aplicación no tiene `UPDATE` ni `DELETE` sobre ellas, o un trigger lo rechaza. La decisión entre ambos va en el cambio que las cree.
- Las transiciones de estado son actualizaciones guardadas; la base de datos no codifica la máquina de estados completa, pero el estado es un enum cerrado.

## Esquema actual

Migraciones: `backend/prisma/migrations/20261002083000_add_user_access` (cambio
`add-user-access`), `20261002120000_add_taxpayer_setup` (cambio `add-taxpayer-setup`),
`20261002180000_add_fiscal_numbering` (cambio `add-fiscal-numbering`),
`20261002200000_add_signing_certificate` (cambio `add-signing-certificate`),
`20261003100000_add_fiscal_catalogs` (cambio `add-fiscal-catalogs`) y
`20261003200000_add_parties_and_products`, `20261003210000_require_consumer_final` y
`20261003220000_unit_price_domain` (cambio `add-parties-and-products`), y
`20261003230000_xsd_decimal_domains` (mantenimiento de Q-43), y
`20261004100000_add_invoice_emission`, `20261004100100_schema_registry_imports` y `20261004100200_document_attempt_detail` (cambio
`add-invoice-emission`). Las tablas
de Better Auth y de sus plugins las genera el CLI `auth`; las columnas de esas tablas usan los
nombres que fija Better Auth (`organizationId`, `userId`).

| Tabla | Origen | Contenido |
| --- | --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth | Identidad global, sesiones, credenciales (hash) y verificaciones. |
| `organization` | Plugin Organization | La empresa (tenant). Nombre y slug provisionales; sin datos tributarios. |
| `member` | Plugin Organization | Membresía: `organizationId`, `userId`, `role` y `status`. |
| `invitation` | Plugin Organization | Sin uso en el MVP: sus endpoints están cerrados. |
| `audit_event` | Propia (`audit`) | Rastro de auditoría: `company_id`, `actor_type`, `actor_user_id`, `action`, `target_user_id`, `changes` (JSON redactado), `correlation_id`, `occurred_at`. Sin direcciones IP. |
| `company_config` | Propia (`taxpayer`) | Una fila por empresa desde el primer registro: `current_version_id`, `current_version`, `tax_identity_locked_at` y `locked_ruc` (identidad tributaria bloqueada), `updated_at`. |
| `company_config_version` | Propia (`taxpayer`) | Versión completa e inmutable: datos y atributos tributarios, `environment` (`TEST` o `PRODUCTION`), `logo_asset_id` opcional, `version` consecutiva por empresa, `created_at` y `created_by`. |
| `configuration_asset` | Propia (`taxpayer`) | Asset inmutable (`kind` `LOGO`): `mime_type` detectado, `size_bytes`, `sha256` y `content` (`bytea`), `created_by`. |
| `establishment` | Propia (`taxpayer`) | `code` de tres dígitos, `address`, `active`. |
| `emission_point` | Propia (`taxpayer`) | `establishment_id`, `code` de tres dígitos y `active`; sin otros atributos. |
| `member_default_emission_point` | Propia (`taxpayer`) | Punto predeterminado de una membresía: `company_id`, `user_id`, `emission_point_id`. |
| `fiscal_sequence` | Propia (`fiscal`) | Contador: clave `company_id`, `environment`, `establishment_id`, `emission_point_id`, `document_type`; `next_number` (1000000000 es el valor interno de agotado) y `last_reserved`. Se crea con su primera reserva o ajuste. |
| `fiscal_sequence_reservation` | Propia (`fiscal`) | Número reservado: la clave del contador más `sequential`, `reserved_at`, `reserved_by` opcional y `correlation_id`. |
| `signing_certificate` | Propia (`signing`) | Metadatos de una firma: `status` (`ACTIVE` o `REPLACED`), `active_company_id` (la empresa mientras está `ACTIVE`, nulo después), titular, emisor, serie, `fingerprint_sha256`, `not_before`, `not_after`, `detected_ruc`, algoritmo y bits de la clave, `uploaded_by`, `created_at`, `replaced_at` y `replaced_by_id`. |
| `signing_certificate_secret` | Propia (`signing`) | Secreto de la firma `ACTIVE` (formato 1 del design D5 de `add-signing-certificate`): `format_version`, `key_version`, `key_check`, la clave de datos envuelta con su nonce, y el P12 y la contraseña cifrados con AES-256-GCM, cada uno con su nonce. |
| `signing_certificate_settings` | Propia (`signing`) | `expiry_alert_days` por empresa. |
| `fiscal_catalog_dataset` | Propia (`catalogs`) | Versión aplicada de cada dataset normativo: `catalog_type`, `version`, fuente (documento, versión, fecha de publicación, URL y SHA-256), `enablement_policy`, `checksum` del contenido canónico y `loaded_at`. |
| `fiscal_catalog_key` | Propia (`catalogs`) | Identidad estable de una entrada: `(catalog_type, entry_key)` y su `code` fiscal, que puede repetirse entre claves (tabla 18 de la ficha). |
| `fiscal_catalog_entry` | Propia (`catalogs`) | Versión de una entrada: `id` estable, `official_label`, `effective_from` con `effective_from_basis` (`SOURCE_STATED` o `PROJECT_BASELINE`), `effective_to`, `normative_status`, `source_ref`, `dataset_version`, las versiones del dataset que la cerraron o retiraron, y las columnas tipadas de su catálogo (`tax_kind`, `sri_tax_code`, `rate_kind`, `percentage NUMERIC`, `identification_pattern`, `identification_rule`, `reserved_for`). |
| `consumer_final_policy` | Propia (`catalogs`) | Versiones de la política: `max_amount NUMERIC`, moneda, identidad canónica (`07`, `9999999999999`, razón social), vigencia con su base, `source_ref` y versión del dataset. |
| `sri_transmission_policy` | Propia (`catalogs`) | Versiones del límite de tamaño del comprobante firmado para su envío individual al SRI (design D17 de `add-sri-transmission`, Q-47): `max_signed_document_bytes`, la cita literal (`source_text`), su sección, la unidad literal, la interpretación en bytes con su justificación, vigencia con su base y versión del dataset. Vacía mientras la cifra exacta no se verifique en la fuente oficial: sin una versión vigente no se transmite. |
| `schema_registry_entry` | Propia (`catalogs`) | Archivos XSD por versión del dataset, con clave `(path, dataset_version)`: `kind` (`DOCUMENT` o `IMPORT`), ruta lógica, tipo, versión y raíz (solo documentos), archivo, SHA-256, fuente, `revision` (solo imports), `imports` por ruta lógica, `downloaded_at` y `supported`. La migración `20261004100100_schema_registry_imports` rellena la ruta de la versión 1 con el trigger de inmutabilidad desactivado solo dentro de ella. |
| `special_case_support` | Propia (`catalogs`) | Categoría de cada anexo por versión del dataset (ADR 0014). |
| `company_fiscal_catalog_setting` | Propia (`catalogs`) | Decisión de una empresa: `(company_id, catalog_type, entry_key)`, `enabled`, `updated_at` y `updated_by`. |
| `party` | Propia (`parties`) | Tercero: `identification_type`, `identification`, `legal_name`, `address`, `email`, `phone`, `roles` (`CUSTOMER`, `SUPPLIER`, `CARRIER`), `status`, `system_record` (`CONSUMER_FINAL` o nulo), `version`, las claves de búsqueda `search_name` y `search_identification` (colación `C`), y autores y fechas (nulos en el registro del sistema). |
| `product` | Propia (`products`) | Producto o servicio: `kind` (`GOOD`, `SERVICE`), `main_code`, `auxiliary_code`, `name`, `description`, `unit_price NUMERIC` sin impuestos (sin escala fija, guardado en forma canónica), `stock_tracked`, `status`, `version`, las claves de búsqueda `search_name`, `search_main_code` y `search_auxiliary_code` (las dos últimas con colación `C`), y autores y fechas. |
| `product_tax` | Propia (`products`) | Referencia de un producto a una entrada fiscal: `(product_id, catalog_type)` con `company_id` y `entry_key`; `catalog_type` es `iva-rate`, `ice-rate` o `irbpnr-rate`. |
| `invoice_draft` | Propia (`invoices`) | Borrador de factura: punto de emisión y comprador opcionales mientras se edita (FK compuestas a la misma empresa), `status` (`DRAFT`, `EMITTED`), `document_id` único al emitir, `version`, y autores y fechas (ERS RF-008). |
| `invoice_draft_line` | Propia (`invoices`) | Línea del borrador: producto de la misma empresa, `quantity` y `discount` (`NUMERIC` con la regla del XSD), sin precio: la emisión toma el del producto. |
| `invoice_draft_payment` | Propia (`invoices`) | Forma de pago del borrador por su entrada del catálogo `payment-method`, con `amount` opcional. |
| `electronic_document` | Propia (`fiscal`) | Comprobante desde `RESERVED`: tipo, ambiente, establecimiento, punto, número, secuencial, reserva (única), clave de acceso (única), código numérico, fecha de emisión, `state` (`RESERVED`, `SIGNED`, `SEND_UNKNOWN`, `RECEIVED`, `RETURNED`, `AUTHORIZED`, `NOT_AUTHORIZED`, `MANUAL_REVIEW`), `snapshot` JSON, versión del esquema, copias del comprador y del total para listar, autor, fecha de firma, diagnóstico del último intento de firma (etapa, código, clase, fecha, intentos, arriendo y, para `XSD_INVALID`, solo la línea y el elemento en `last_attempt_detail`) y la autorización: `authorization_number` (igual a la clave), `authorization_date` y `authorization_environment` (igual al ambiente), solo en `AUTHORIZED`. |
| `job` | Propia (`platform`) | Job de la cola durable (ADR 0012): `type`, `dedupe_key`, `active_dedupe_key` (única, igual a la clave mientras el job está `PENDING` o `LEASED`), `document_id` y `active_sri_document_id` (única, igual al comprobante mientras un job `sri.*` está activo), `payload`, `status` (`PENDING`, `LEASED`, `DONE`, `STOPPED`), programación, intentos, máximo y plazo, arriendo (dueño y vencimiento), último error (código, clase `RETRYABLE`, `DETERMINISTIC` o `INTEGRITY`, fecha y detalle), origen (`AUTOMATIC`, `MANUAL` con su solicitante y motivo) y fechas. |
| `sri_attempt` | Propia (`fiscal`) | Intento de interacción con el SRI: comprobante de la misma empresa (FK compuesta), job, número de intento por comprobante, operación (`RECEPTION`, `AUTHORIZATION`, `VALIDITY`), ambiente, endpoint, origen e iniciador, tiempos (inicio, cabeceras y fin), clase de resultado del transporte, estado HTTP, cabeceras seguras, código del fallo, SHA-256 y tamaño del sobre y del artefacto enviado. |
| `sri_response` | Propia (`fiscal`) | Respuesta original de un intento, una como mucho: `body` (`bytea`), tamaño, SHA-256, tipo de contenido y si se truncó en el límite. |
| `sri_attempt_result` | Propia (`fiscal`) | Clasificación de un intento, una como mucho: resultado, mensajes estructurados del SRI, datos interpretados y versión del clasificador. |
| `document_state_transition` | Propia (`fiscal`) | Historial de transiciones: estado anterior y nuevo, causa, actor y metadatos no sensibles (ERS RF-525). |
| `document_artifact` | Propia (`fiscal`) | Artefacto exacto de un comprobante: `kind` (`SIGNED_XML`, el enviado; `AUTHORIZED_XML`, el recibido del SRI; `RIDE_PDF`, el RIDE generado una vez con sus versiones y su procedencia en los metadatos), tipo de medio, `content` (`bytea`), tamaño, SHA-256 y metadatos (ADR 0010). |
| `document_delivery_event` | Propia (`fiscal`) | Entrega observable: comprobante de la misma empresa (FK compuesta), `event` (`DOWNLOAD`, `PRINT_REQUESTED`), `artifact_kind` con FK al artefacto `(document_id, kind)`, `artifact_sha256`, actor (`→ user`, `RESTRICT`), `request_id` y `occurred_at`. Nunca bytes, ni "impreso" ni "recibido". |
| `idempotency_record` | Propia (`platform`) | Clave de idempotencia de la emisión de una factura, de una nota de crédito o de una nota de débito con su huella y su comprobante (Q-30). |
| `stock_balance` | Propia (`inventory`) | Inventario inicializado de un producto, `(company_id, product_id)` con FK compuesta al producto: `balance NUMERIC` (dominio `existencia`, con signo), `last_position`, `initialized_at`, `initialized_by` (`→ user`, `RESTRICT`) y `updated_at`. |
| `stock_movement` | Propia (`inventory`) | Movimiento del kárdex. Datos: `movement_type` (`INICIAL`, `ENTRADA_MANUAL`, `SALIDA_FACTURA`, `DEVOLUCION_NC`, `AJUSTE`), `delta` con signo, `balance_after` y `position`. Referencias: FK al saldo, comprobante de la misma empresa con su número (FK compuesta, solo en salidas y devoluciones), `origin` (`USER` o `SYSTEM`), actor (`→ user`, `RESTRICT`) y `reason`. Idempotencia: `idempotency_operation`, `idempotency_key` y `request_hash`, solo en entradas y ajustes. Además, `occurred_at`. |
| `credit_note_draft` | Propia (`credit-notes`) | Borrador de nota de crédito: factura y punto de emisión de la misma empresa (FK compuestas), `cause` (`TOTAL_ANNULMENT`, `RETURN`), `reason` (motivo de una línea, de 1 a 300), `status` (`DRAFT`, `EMITTED`), `document_id` único al emitir (FK compuesta), `version`, y autores y fechas. |
| `credit_note_draft_line` | Propia (`credit-notes`) | Línea del borrador por la posición de la línea de la factura: `quantity` acreditada y `physical_return` (dominio `cantidad`, el retorno nunca mayor que lo acreditado). |
| `credit_capacity` | Propia (`credit-notes`) | Capacidad acreditable de una factura, `(company_id, invoice_id)` con FK compuesta al comprobante: `original_total` (el total de la factura), `reserved_total`, `applied_total` (dominio `importe`) y `created_at`. |
| `credit_capacity_line` | Propia (`credit-notes`) | Capacidad de una línea de la factura, `(company_id, invoice_id, position)`: producto de la misma empresa y `original_quantity`, `reserved_quantity`, `applied_quantity` (dominio `cantidad`). |
| `credit_reservation` | Propia (`credit-notes`) | Reserva acreditable de una nota: capacidad de la factura y nota de la misma empresa (FK compuestas, una por nota), `cause`, `amount` (el valor de la modificación), `status` (`RESERVED`, `APPLIED`, `RELEASED`), `reserved_at` y `concluded_at`. |
| `credit_reservation_line` | Propia (`credit-notes`) | Línea acreditada: FK a su reserva y a la línea de la capacidad de la misma factura, `quantity`, `subtotal` exacto, `discount`, `taxable_base`, `taxes` (arreglo JSON con código, tarifa, porcentaje, base e importe) y `physical_return`. |
| `stock_return_capacity` | Propia (`inventory`) | Capacidad devolvible, `(company_id, invoice_id, product_id)` con FK compuestas a la factura y al producto: `original_quantity` (el valor absoluto de la `SALIDA_FACTURA`, o cero), `reserved_quantity`, `applied_quantity` (dominio `existencia`, no negativos) y `created_at`. |
| `stock_return_reservation` | Propia (`inventory`) | Retorno físico de una nota y producto, `(company_id, credit_note_id, product_id)`: FK a la nota y a la capacidad devolvible, `quantity` positiva, `status`, `reserved_at` y `concluded_at`. |
| `debit_note_draft` | Propia (`debit-notes`) | Borrador de nota de débito: factura y punto de emisión de la misma empresa (FK compuestas), `payment_method` (la clave de una entrada del catálogo `payment-method`, nunca una etiqueta), `status` (`DRAFT`, `EMITTED`), `document_id` único al emitir (FK compuesta), `version`, y autores y fechas. |
| `debit_note_draft_concept` | Propia (`debit-notes`) | Concepto del borrador por posición, de 1 a 100: `cause` (`LATE_PAYMENT_INTEREST`, `POST_INVOICE_COST_EXPENSE`), `description` (`razon` de una línea, de 1 a 300), `amount` (dominio `importe`, mayor que cero) y `tax_treatment` (`taxCode:rateCode`), cada uno opcional mientras se prepara. |
| `debit_note_support` | Propia (`debit-notes`) | Factura de una nota de débito, `(company_id, debit_note_id)` con FK compuestas a la nota y a la factura, y `created_at`. |

Restricciones de la migración, incluidas las que Prisma no expresa (verificadas por
`backend/test/integration/migrations.test.ts`):

| Restricción | Tabla | Regla | Dónde se declara |
| --- | --- | --- | --- |
| `member_organizationId_userId_key` | `member` | `UNIQUE (organizationId, userId)`: una membresía por usuario y empresa | `@@unique` en el esquema |
| `member_role_check` | `member` | `CHECK (role IN ('ADMIN', 'OPERATOR'))` | SQL de la migración |
| `member_status_check` | `member` | `CHECK (status IN ('ACTIVE', 'DEACTIVATED'))`; la columna es `NOT NULL` | SQL de la migración |
| `audit_event_company_id_fkey` | `audit_event` | `company_id → organization(id)`, `ON DELETE RESTRICT` | Relación en el esquema |
| `audit_event_actor_user_id_fkey`, `audit_event_target_user_id_fkey` | `audit_event` | Actor y usuario afectado `→ user(id)`, `ON DELETE RESTRICT` | Relación en el esquema |
| `audit_event_actor_type_check` | `audit_event` | `CHECK (actor_type IN ('USER', 'SYSTEM', 'TECHNICAL_ADMIN'))` | SQL de la migración |
| `audit_event_actor_user_check` | `audit_event` | Hay usuario actor si y solo si el actor es `USER` | SQL de la migración |
| `audit_event_append_only` | `audit_event` | Trigger `BEFORE UPDATE OR DELETE` que rechaza el cambio | SQL de la migración |
| `audit_event_no_truncate` | `audit_event` | Trigger `BEFORE TRUNCATE` que rechaza el vaciado | SQL de la migración |
| `user_email_key`, `session_token_key`, `organization_slug_key` | Better Auth | Únicos que define el CLI | Esquema generado |
| `company_config_version_company_id_version_key` | `company_config_version` | `UNIQUE (company_id, version)` | `@@unique` en el esquema |
| `company_config_version_company_id_id_key`, `configuration_asset_company_id_id_key`, `establishment_company_id_id_key`, `emission_point_company_id_id_key` | Varias | `UNIQUE (company_id, id)`: destino de las claves foráneas compuestas | `@@unique` en el esquema |
| `configuration_asset_company_id_sha256_key` | `configuration_asset` | `UNIQUE (company_id, sha256)`: un contenido se guarda una vez por empresa | `@@unique` en el esquema |
| `establishment_company_id_code_key` | `establishment` | `UNIQUE (company_id, code)` | `@@unique` en el esquema |
| `emission_point_establishment_id_code_key` | `emission_point` | `UNIQUE (establishment_id, code)` | `@@unique` en el esquema |
| `member_default_emission_point_company_id_emission_point_id_idx` | `member_default_emission_point` | Índice `(company_id, emission_point_id)`: usuarios con un punto como predeterminado | `@@index` en el esquema |
| `company_config_company_id_current_version_id_fkey` | `company_config` | `(company_id, current_version_id) → company_config_version(company_id, id)`: la vigente es de la misma empresa | Relación en el esquema |
| `company_config_version_company_id_logo_asset_id_fkey` | `company_config_version` | `(company_id, logo_asset_id) → configuration_asset(company_id, id)`; sin logo no se comprueba | Relación en el esquema |
| `emission_point_company_id_establishment_id_fkey` | `emission_point` | `(company_id, establishment_id) → establishment(company_id, id)` | Relación en el esquema |
| `member_default_emission_point_company_id_user_id_fkey` | `member_default_emission_point` | `(company_id, user_id) → member(organizationId, userId)` | Relación en el esquema |
| `member_default_emission_point_company_id_emission_point_id_fkey` | `member_default_emission_point` | `(company_id, emission_point_id) → emission_point(company_id, id)` | Relación en el esquema |
| `company_config_company_id_fkey`, `company_config_version_company_id_fkey`, `configuration_asset_company_id_fkey`, `establishment_company_id_fkey`, `company_config_version_created_by_fkey`, `configuration_asset_created_by_fkey` | Tablas de `taxpayer` | Empresa `→ organization(id)` y autor `→ user(id)`, `ON DELETE RESTRICT` | Relación en el esquema |
| `company_config_version_ruc_check`, `company_config_version_provider_ruc_check` | `company_config_version` | `^[0-9]{10}001$` (XSD `numeroRuc`) | SQL de la migración |
| `company_config_version_special_taxpayer_check`, `company_config_version_withholding_check` | `company_config_version` | `^[A-Za-z0-9]{3,13}$` y `^[0-9]{1,8}$` (XSD) | SQL de la migración |
| `company_config_version_environment_check`, `company_config_version_rimpe_check`, `company_config_version_version_check` | `company_config_version` | Ambiente `TEST` o `PRODUCTION`, categoría RIMPE declarada, `version >= 1` | SQL de la migración |
| `company_config_version_texts_check`, `establishment_address_check` | Varias | Textos fiscales no vacíos y sin `\r` ni `\n` | SQL de la migración |
| `company_config_tax_identity_lock_check`, `company_config_current_version_check` | `company_config` | Fecha y RUC del bloqueo van juntos; `current_version >= 1` | SQL de la migración |
| `configuration_asset_kind_check`, `configuration_asset_mime_type_check`, `configuration_asset_size_check`, `configuration_asset_sha256_check` | `configuration_asset` | `LOGO`; `image/png` o `image/jpeg`; tamaño positivo igual al del contenido; SHA-256 hexadecimal | SQL de la migración |
| `establishment_code_check`, `emission_point_code_check` | Varias | `^[0-9]{3}$` (XSD `estab` y `ptoEmi`) | SQL de la migración |
| `company_config_version_append_only`, `company_config_version_no_truncate`, `configuration_asset_append_only`, `configuration_asset_no_truncate` | Versiones y assets | Triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` | SQL de la migración |
| `company_config_no_delete`, `company_config_no_truncate` | `company_config` | Triggers que rechazan borrar la cabecera | SQL de la migración |
| `company_config_version_locked_ruc` | `company_config_version` | Trigger `BEFORE INSERT`: con la identidad bloqueada, el RUC de la versión nueva debe ser `locked_ruc` | SQL de la migración |
| `company_config_lock` | `company_config` | Trigger `BEFORE INSERT OR UPDATE`: el bloqueo no se revierte, `locked_ruc` es el RUC de la versión vigente y la empresa no cambia | SQL de la migración |
| `establishment_identity`, `emission_point_identity` | Varias | Triggers `BEFORE UPDATE` que rechazan cambiar el código, la empresa o el establecimiento | SQL de la migración |
| `emission_point_company_id_establishment_id_id_key` | `emission_point` | `UNIQUE (company_id, establishment_id, id)`: destino de la clave compuesta de los contadores | `@@unique` en el esquema |
| `fiscal_sequence_company_id_environment_establishment_id_emi_key` | `fiscal_sequence` | `UNIQUE` de la clave del contador: un contador por empresa, ambiente, establecimiento, punto y tipo (ADR 0003) | `@@unique` en el esquema |
| `fiscal_sequence_reservation_company_id_environment_establis_key` | `fiscal_sequence_reservation` | `UNIQUE` de la clave más `sequential`: la unicidad del secuencial con el ambiente (CTX §5) | `@@unique` en el esquema |
| `fiscal_sequence_company_id_fkey` | `fiscal_sequence` | Empresa `→ organization(id)`, `ON DELETE RESTRICT` | Relación en el esquema |
| `fiscal_sequence_company_id_establishment_id_emission_point_fkey` | `fiscal_sequence` | `(company_id, establishment_id, emission_point_id) → emission_point(company_id, establishment_id, id)`: el punto pertenece a ese establecimiento y a esa empresa | Relación en el esquema |
| `fiscal_sequence_reservation_company_id_environment_establi_fkey` | `fiscal_sequence_reservation` | Clave de cinco columnas `→ fiscal_sequence`: toda reserva pertenece a un contador | Relación en el esquema |
| `fiscal_sequence_reservation_reserved_by_fkey` | `fiscal_sequence_reservation` | Usuario que reservó `→ user(id)`, opcional | Relación en el esquema |
| `fiscal_sequence_environment_check`, `fiscal_sequence_document_type_check` | `fiscal_sequence` | `TEST` o `PRODUCTION`; `01`, `03`, `04`, `05`, `06` o `07` (CTX §56) | SQL de la migración |
| `fiscal_sequence_next_number_check`, `fiscal_sequence_last_reserved_check` | `fiscal_sequence` | Siguiente de 1 a 1000000000 (este último, agotado); último reservado de 1 a 999999999 o nulo | SQL de la migración |
| `fiscal_sequence_next_above_reserved_check` | `fiscal_sequence` | `next_number > COALESCE(last_reserved, 0)`: ningún ajuste ni reserva vuelve a un número reservado | SQL de la migración |
| `fiscal_sequence_reservation_sequential_check` | `fiscal_sequence_reservation` | Secuencial de 1 a 999999999 | SQL de la migración |
| `fiscal_sequence_no_delete`, `fiscal_sequence_no_truncate` | `fiscal_sequence` | Triggers que rechazan borrar contadores | SQL de la migración |
| `fiscal_sequence_reservation_append_only`, `fiscal_sequence_reservation_no_truncate` | `fiscal_sequence_reservation` | Triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` | SQL de la migración |
| `fiscal_sequence_guard` | `fiscal_sequence` | Trigger `BEFORE UPDATE`: la clave no cambia y `last_reserved` no disminuye ni vuelve a nulo | SQL de la migración |
| `signing_certificate_active_company_id_key` | `signing_certificate` | `UNIQUE (active_company_id)`: a lo sumo una firma `ACTIVE` por empresa. Los `NULL` de las reemplazadas no cuentan. Sustituye al índice parcial `UNIQUE (company_id) WHERE status = 'ACTIVE'`, que el esquema de Prisma 7.10 no expresa sin una función en preview | `@unique` en el esquema |
| `signing_certificate_company_id_id_key`, `signing_certificate_secret_company_id_certificate_id_key` | ambas | Destinos de las claves compuestas por empresa | `@@unique` en el esquema |
| `signing_certificate_company_id_replaced_by_id_fkey`, `signing_certificate_secret_company_id_certificate_id_fkey` | ambas | `(company_id, …) → signing_certificate(company_id, id)`: el reemplazo y el secreto son de la misma empresa | Relación en el esquema |
| `signing_certificate_status_check`, `signing_certificate_active_state_check` | `signing_certificate` | `ACTIVE` exige `active_company_id = company_id` (no nulo) y sin fecha ni enlace de reemplazo; `REPLACED` exige `active_company_id` nulo y `replaced_at` | SQL de la migración |
| `signing_certificate_key_check`, `signing_certificate_ruc_check`, `signing_certificate_validity_check`, `signing_certificate_fingerprint_check` | `signing_certificate` | Clave RSA de 2048 bits o más; RUC de 13 dígitos terminado en 001; `not_after > not_before`; huella hexadecimal de 64 caracteres | SQL de la migración |
| `signing_certificate_secret_format_check`, `signing_certificate_secret_sizes_check` | `signing_certificate_secret` | Formato 1 o posterior; `key_check` de 32 bytes y nonces de 12 | SQL de la migración |
| `signing_certificate_settings_expiry_alert_days_check` | `signing_certificate_settings` | Anticipación de 1 a 90 días | SQL de la migración |
| `signing_certificate_no_delete`, `signing_certificate_no_truncate` | `signing_certificate` | Triggers que rechazan borrar metadatos: conservan la historia | SQL de la migración |
| `signing_certificate_guard` | `signing_certificate` | Trigger `BEFORE UPDATE`. Solo admite dos cambios: `ACTIVE` → `REPLACED` (con `active_company_id` nulo y `replaced_at`), y después, una vez, el enlace `replaced_by_id`. Lo demás no cambia | SQL de la migración |
| `signing_certificate_secret_no_update` | `signing_certificate_secret` | Trigger que rechaza `UPDATE`. El borrado sí está permitido: es la destrucción intencional del secreto al reemplazar, excepción deliberada a la escritura única de los ADR 0010 y 0017 (ADR 0011) | SQL de la migración |
| `signing_certificate_secret_active_only` | `signing_certificate_secret` | Trigger `BEFORE INSERT`: solo una firma `ACTIVE` de la misma empresa tiene secreto | SQL de la migración |
| `fiscal_catalog_dataset_pkey`, `fiscal_catalog_entry_catalog_type_entry_key_effective_from_key`, `consumer_final_policy_effective_from_key`, `sri_transmission_policy_effective_from_key` | Catálogos | Una versión de dataset por catálogo; una versión de entrada por fecha de inicio; una versión de la política por fecha de inicio. Son también el respaldo del cargador ante cargas simultáneas | `@@id` y `@@unique` en el esquema |
| `fiscal_catalog_entry_catalog_type_dataset_version_fkey`, `fiscal_catalog_entry_catalog_type_entry_key_fkey`, `company_fiscal_catalog_setting_catalog_type_entry_key_fkey` | Catálogos | Toda versión pertenece a un dataset aplicado y a una clave; toda decisión de empresa, a una clave existente | Relación en el esquema |
| `fiscal_catalog_dataset_catalog_type_check`, `fiscal_catalog_dataset_version_check`, `fiscal_catalog_dataset_hashes_check` | `fiscal_catalog_dataset` | Los nueve datasets conocidos, versión desde 1, checksum y SHA-256 de la fuente hexadecimales | SQL de la migración |
| `fiscal_catalog_dataset_enablement_policy_check` | `fiscal_catalog_dataset` | IVA, ICE, IRBPNR y formas de pago tienen `DEFAULT_ENABLED` o `DEFAULT_DISABLED`; los demás, `NOT_ENABLEABLE` | SQL de la migración |
| `fiscal_catalog_key_catalog_type_check`, `fiscal_catalog_key_entry_key_check`, `fiscal_catalog_key_code_check` | `fiscal_catalog_key` | Los seis catálogos de entradas; `entry_key` `^[0-9A-Z][0-9A-Z-]{0,63}$`; `code` de 1 a 4 dígitos (`codigoPorcentaje` y equivalentes). Sin único sobre el código | SQL de la migración |
| `fiscal_catalog_entry_basis_check`, `fiscal_catalog_entry_status_check`, `fiscal_catalog_entry_range_check` | `fiscal_catalog_entry` | Base y estado conocidos; una versión `WITHDRAWN` tiene la vigencia cerrada; `effective_to >= effective_from` | SQL de la migración |
| `fiscal_catalog_entry_attributes_check` | `fiscal_catalog_entry` | Columnas tipadas por catálogo: el porcentaje existe solo en tarifas `PERCENTAGE` de IVA; ICE es `PER_NORMATIVE` e IRBPNR `PER_UNIT`, sin valores | SQL de la migración |
| `consumer_final_policy_values_check`, `consumer_final_policy_basis_check`, `consumer_final_policy_range_check` | `consumer_final_policy` | Monto no negativo en USD, identidad `07` y `9999999999999`, base conocida y vigencia ordenada | SQL de la migración |
| `sri_transmission_policy_values_check` | `sri_transmission_policy` | Bytes positivos, cita, sección, unidad e interpretación no vacías, base conocida y vigencia ordenada | SQL de la migración |
| `fiscal_catalog_entry_percentage_check`, `consumer_final_policy_max_amount_check` | `fiscal_catalog_entry`, `consumer_final_policy` | Regla del XSD: porcentaje no negativo con 2 decimales y 4 dígitos en total como máximo, sin máximo de 100; monto con 2 decimales y 14 dígitos en total como máximo (Q-43) | SQL de la migración |
| `schema_registry_entry_values_check`, `special_case_support_values_check`, `company_fiscal_catalog_setting_catalog_type_check` | Varias | Tipos de comprobante, hash y reglas por `kind` del registro (ruta lógica que termina en el archivo; documentos con tipo, versión y raíz; imports sin ellos y con revisión); categorías del ADR 0014; solo catálogos habilitables en las decisiones de empresa | SQL de la migración |
| `fiscal_catalog_dataset_immutable`, `fiscal_catalog_key_immutable`, `schema_registry_entry_immutable`, `special_case_support_immutable` y sus `*_no_truncate` | Datos del sistema | Triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` | SQL de la migración |
| `fiscal_catalog_entry_no_delete`, `consumer_final_policy_no_delete`, `sri_transmission_policy_no_delete` y sus `*_no_truncate` | Versiones | Triggers que rechazan borrar versiones | SQL de la migración |
| `fiscal_catalog_entry_guard`, `consumer_final_policy_guard`, `sri_transmission_policy_guard` | Versiones | Trigger `BEFORE UPDATE`: una versión publicada solo cierra una vigencia abierta o pasa a `WITHDRAWN`, una vez y con la versión del dataset que lo hizo; nada más cambia (design D4 de `add-fiscal-catalogs`) | SQL de la migración |
| `fiscal_catalog_entry_no_overlap`, `consumer_final_policy_no_overlap`, `sri_transmission_policy_no_overlap` | Versiones | Trigger `BEFORE INSERT OR UPDATE`: las versiones de una entrada no se superponen (`daterange` inclusivo; sin fin, abierta) | SQL de la migración |
| `party_company_id_identification_type_identification_key` | `party` | `UNIQUE (company_id, identification_type, identification)`, también con terceros desactivados; con el `07` reservado, limita a uno el consumidor final por empresa | `@@unique` en el esquema |
| `party_identification_check`, `party_text_check`, `party_status_check`, `party_roles_check`, `party_version_check` | `party` | Tipo `^[0-9]{2}$`; identificación, razón social y contactos no vacíos y sin saltos de línea; estado `ACTIVE` o `INACTIVE`; roles incluidos en `CUSTOMER`, `SUPPLIER` y `CARRIER`; versión desde 1 | SQL de la migración |
| `party_system_record_check` | `party` | Un tercero normal no usa el tipo `07` y tiene autor; el registro del sistema es exactamente el consumidor final: `07`, `9999999999999`, `ACTIVE`, rol cliente y sin autor (design D5 de `add-parties-and-products`) | SQL de la migración |
| `party_system_record_guard`, `party_no_truncate` | `party` | Triggers: el consumidor final no se corrige, no se desactiva ni se borra; ningún tercero cambia su marca de registro del sistema; la tabla no se trunca | SQL de la migración |
| `product_company_id_main_code_key` | `product` | `UNIQUE (company_id, main_code)`, también con productos desactivados; los nulos no chocan | `@@unique` en el esquema |
| `product_kind_check`, `product_status_check`, `product_text_check`, `product_unit_price_check`, `product_stock_tracked_check`, `product_version_check` | `product` | Tipo `GOOD` o `SERVICE`; estado; nombre y códigos no vacíos y sin saltos de línea; precio no negativo, con 6 decimales y 18 dígitos en total como máximo; control de stock solo en bienes; versión desde 1 | SQL de la migración |
| `product_tax_pkey`, `product_tax_catalog_type_check` | `product_tax` | Como mucho una referencia por impuesto; solo `iva-rate`, `ice-rate` e `irbpnr-rate` | `@@id` en el esquema y SQL de la migración |
| `product_tax_company_id_product_id_fkey`, `product_tax_catalog_type_entry_key_fkey` | `product_tax` | La referencia es del producto de la misma empresa y de una entrada fiscal existente (`fiscal_catalog_key`). Esta clave foránea es un objeto de `products` sobre una tabla de `catalogs`; `products` nunca lee esas tablas | Relación en el esquema |
| `product_invariants`, `product_tax_invariants` | `product`, `product_tax` | Triggers de restricción diferidos: al confirmar, cada producto tiene exactamente un IVA y, si es un servicio, ningún IRBPNR, sin importar el orden de las sentencias | SQL de la migración |
| `invoice_draft_values_check`, `invoice_draft_line_values_check`, `invoice_draft_payment_values_check` | `invoice_draft`, `invoice_draft_line`, `invoice_draft_payment` | Estado `DRAFT` o `EMITTED`, este con su comprobante; cantidad 18/6 y descuento e importe 14/2 no negativos (regla del XSD); forma de pago del catálogo `payment-method` | SQL de la migración |
| `invoice_draft_company_id_emission_point_id_fkey`, `invoice_draft_company_id_buyer_party_id_fkey`, `invoice_draft_line_company_id_product_id_fkey` | `invoice_draft`, `invoice_draft_line` | Punto, comprador y producto de la misma empresa (FK compuestas; `party_company_id_id_key` es su destino) | `@relation` en el esquema |
| `invoice_draft_guard`, `invoice_draft_line_guard`, `invoice_draft_payment_guard` | `invoice_draft`, `invoice_draft_line`, `invoice_draft_payment` | Triggers: un borrador emitido, sus líneas y sus pagos no cambian ni se borran; la empresa y el autor no cambian | SQL de la migración |
| `electronic_document_values_check`, `electronic_document_access_key_key`, `electronic_document_reservation_id_key`, `electronic_document_company_id_environment_establishment_id_key` | `electronic_document` | Tipo, ambiente, estado con su fecha de firma, clave de 49 dígitos, código de 8, número `EEE-PPP-SSSSSSSSS`, secuencial y total (regla del XSD de `importe`); clave, reserva y número únicos | SQL de la migración y `@@unique` |
| `electronic_document_authorization_check` | `electronic_document` | Los tres campos de la autorización existen juntos y solo en `AUTHORIZED`; el número es la clave de acceso y el ambiente, el del comprobante | SQL de la migración |
| `electronic_document_guard`, `electronic_document_no_truncate` | `electronic_document` | Triggers: el estado solo sigue la tabla de transiciones (design D3 de `add-sri-transmission`; `AUTHORIZED` y `NOT_AUTHORIZED` son terminales y `RETURNED` no tiene salida), la fecha de firma no cambia tras `RESERVED`, la autorización no cambia una vez escrita y solo cambia además el diagnóstico del intento de firma; sin borrado ni truncado | SQL de la migración |
| `electronic_document_requires_artifact` | `electronic_document` | Trigger de restricción diferido: todo comprobante posterior a `RESERVED` tiene su artefacto `SIGNED_XML` al confirmar | SQL de la migración |
| `electronic_document_attempt_detail_check` | `electronic_document` | El detalle del intento es un objeto JSON | SQL de la migración |
| `document_state_transition_values_check`, `document_artifact_values_check`, `document_artifact_document_id_kind_key`, `idempotency_record_values_check` | `document_state_transition`, `document_artifact`, `idempotency_record` | Estados y actor; artefacto `SIGNED_XML` o `AUTHORIZED_XML` con `application/xml`, o `RIDE_PDF` con `application/pdf`, con tamaño igual a sus bytes y SHA-256 hex, uno por tipo; operación `invoice.emit`, `credit_note.emit` o `debit_note.emit`, clave ASCII visible de 1 a 100 y huella hex | SQL de la migración y `@@unique` |
| `document_state_transition_append_only`, `document_artifact_append_only`, `idempotency_record_append_only` y sus `*_no_truncate` | `document_state_transition`, `document_artifact`, `idempotency_record` | Triggers: solo de agregado | SQL de la migración |
| `document_delivery_event_values_check` | `document_delivery_event` | Evento `DOWNLOAD` o `PRINT_REQUESTED`; tipo de artefacto conocido; una solicitud de impresión solo del `RIDE_PDF`; SHA-256 hex; `request_id` con el formato del middleware | SQL de la migración |
| `document_delivery_event_company_id_document_id_fkey`, `document_delivery_event_document_id_artifact_kind_fkey`, `document_delivery_event_actor_user_id_fkey` | `document_delivery_event` | El comprobante es de la misma empresa, el artefacto existe y el actor no se puede borrar (`ON DELETE RESTRICT`, ERS RF-409) | Relaciones en el esquema |
| `document_delivery_event_append_only`, `document_delivery_event_no_truncate` | `document_delivery_event` | Triggers: solo de agregado, sin truncado | SQL de la migración |
| `document_delivery_event_company_id_document_id_occurred_at_idx`, `electronic_document_company_id_issue_date_id_idx`, `electronic_document_company_id_buyer_identification_idx` | `document_delivery_event`, `electronic_document` | Índices del historial de entregas de un comprobante y de la bandeja: orden por fecha de emisión e identificador, y filtro por la identificación del receptor (design D2 de `add-document-archive`) | `@@index` en el esquema |
| `stock_balance_values_check`, `stock_movement_values_check` | `stock_balance`, `stock_movement` | Dominio `existencia` (30 dígitos y 6 decimales, con signo). Tipo conocido, `INICIAL` exactamente en la posición 1, signo por tipo (`INICIAL >= 0`, entrada `> 0`, salida `< 0`, devolución `> 0`, ajuste `<> 0`). Comprobante y número solo y siempre en salidas y devoluciones. Salida del sistema y movimientos manuales de un usuario, con actor solo con origen `USER`. Motivo obligatorio en el ajuste. Operación, clave y huella juntas y solo en entradas (`inventory.entry`) y ajustes (`inventory.adjust`). | SQL de la migración |
| `stock_balance_company_id_product_id_fkey`, `stock_balance_initialized_by_fkey`, `stock_movement_company_id_product_id_fkey`, `stock_movement_company_id_document_id_fkey`, `stock_movement_actor_user_id_fkey` | `stock_balance`, `stock_movement` | El producto y el comprobante son de la misma empresa; ningún movimiento existe sin su saldo; los usuarios no se pueden borrar (`ON DELETE RESTRICT`) | Relaciones en el esquema |
| `stock_movement_company_id_product_id_position_key`, `stock_movement_document_product_type_key`, `stock_movement_idempotency_key` | `stock_movement` | Posición única por producto (un solo `INICIAL` en toda su vida), una salida por factura y producto, y una entrada o un ajuste por empresa, operación y clave | `@@unique` en el esquema |
| `stock_movement_append_only`, `stock_movement_no_truncate`, `stock_balance_no_delete`, `stock_balance_no_truncate`, `stock_balance_guard` | `stock_movement`, `stock_balance` | Triggers: movimientos de solo agregado. El saldo no se borra, y su empresa, producto e inicialización no cambian; su posición solo avanza. | SQL de la migración |
| `stock_movement_chain`, `stock_movement_in_balance`, `stock_balance_matches_ledger` | `stock_movement`, `stock_balance` | Cada movimiento sigue al anterior, sin huecos, con el saldo anterior más su variación. Al confirmar, cada movimiento está en su saldo, y cada saldo tiene su `INICIAL` y es igual al `balance_after` del último movimiento: el saldo es la suma del kárdex. | SQL de la migración (triggers de restricción diferidos los dos últimos) |
| `stock_balance_company_id_balance_idx`, `stock_movement_company_id_product_id_occurred_at_idx` | `stock_balance`, `stock_movement` | Filtro de saldo negativo de la lista y kárdex por rango de fechas (design D8 de `add-minimal-inventory`) | `@@index` en el esquema |
| `job_values_check`, `job_active_dedupe_key_key`, `job_active_sri_document_id_key`, `job_document_id_fkey` | `job` | Estado, tipo `dominio.acción`, origen con su solicitante y motivo de 1 a 500, intentos; `LEASED` con su arriendo; las columnas activas iguales a la clave y al comprobante solo mientras el job está activo; fin solo en `DONE` y `STOPPED`; clase de error. Un job activo por clave y una interacción activa con el SRI por comprobante: columnas únicas que solo tienen valor mientras el job está activo, porque Prisma no expresa índices parciales | SQL de la migración y `@unique` |
| `sri_attempt_values_check`, `sri_attempt_document_id_attempt_number_key`, `sri_attempt_company_id_document_id_fkey` | `sri_attempt` | Operación, ambiente, origen con su iniciador, clase del transporte, estado HTTP solo con `RESPONSE`, hashes hex y fin posterior al inicio; número de intento único por comprobante; comprobante de la misma empresa | SQL de la migración, `@@unique` y `@relation` |
| `sri_response_values_check`, `sri_attempt_result_values_check`, `sri_response_company_id_attempt_id_fkey`, `sri_attempt_result_company_id_attempt_id_fkey` | `sri_response`, `sri_attempt_result` | Tamaño igual a los bytes y SHA-256 hex; resultado dentro de la lista cerrada del clasificador y mensajes como arreglo JSON; uno por intento y de la misma empresa | SQL de la migración y `@relation` |
| `sri_attempt_append_only`, `sri_response_append_only`, `sri_attempt_result_append_only` y sus `*_no_truncate` | `sri_attempt`, `sri_response`, `sri_attempt_result` | Triggers: solo de agregado | SQL de la migración |
| `credit_note_draft_values_check`, `credit_note_draft_line_values_check`, `credit_note_draft_guard`, `credit_note_draft_line_guard` | `credit_note_draft`, `credit_note_draft_line` | Causa y estado cerrados, este con su comprobante; motivo de 1 a 300 caracteres, sin salto de línea y no vacío; cantidad y retorno en el dominio `cantidad`, el retorno nunca mayor que lo acreditado. Triggers: un borrador emitido y sus líneas no cambian ni se borran; la empresa, la factura y el autor no cambian | SQL de la migración |
| `credit_capacity_values_check`, `credit_capacity_line_values_check`, `stock_return_capacity_values_check` | `credit_capacity`, `credit_capacity_line`, `stock_return_capacity` | Dominios `importe`, `cantidad` y `existencia`, no negativos, y lo reservado más lo aplicado nunca supera lo original: la última defensa de la capacidad (design D7, D8 y D10 de `add-credit-notes`) | SQL de la migración |
| `credit_capacity_origin`, `credit_capacity_line_origin`, `stock_return_capacity_origin` | `credit_capacity`, `credit_capacity_line`, `stock_return_capacity` | Triggers `BEFORE INSERT`: la capacidad nace de una factura de la misma empresa en `AUTHORIZED` y con su total; cada línea, con el producto y la cantidad de la misma posición del snapshot; la devolvible, con el valor absoluto de la `SALIDA_FACTURA` de la factura y el producto, o cero | SQL de la migración |
| `credit_capacity_guard`, `credit_capacity_line_guard`, `stock_return_capacity_guard` y sus `*_no_delete` y `*_no_truncate` | Capacidades | Triggers: el original no cambia, solo lo reservado y lo aplicado; sin borrado ni truncado | SQL de la migración |
| `credit_reservation_values_check`, `credit_reservation_line_values_check`, `stock_return_reservation_values_check` | Reservas | Causa y estado cerrados, concluida si y solo si no está `RESERVED`; importes de línea no negativos (`CREDIT_NOTE_LINE_AMOUNT_NEGATIVE`), impuestos como arreglo JSON y retorno físico nunca mayor que lo acreditado; retorno reservado positivo | SQL de la migración |
| `credit_reservation_guard`, `stock_return_reservation_guard`, `credit_reservation_line_append_only` y los `*_no_delete` y `*_no_truncate` | Reservas | Triggers: una reserva nace `RESERVED` para un comprobante `04`, solo pasa de `RESERVED` a `APPLIED` o `RELEASED` con su conclusión, no cambia nada más y nunca se borra ni se reutiliza; las líneas acreditadas son de solo agregado | SQL de la migración |
| `credit_capacity_matches_reservations`, `credit_capacity_line_matches_reservations`, `credit_reservation_in_capacity`, `credit_reservation_line_in_capacity`, `stock_return_capacity_matches_reservations`, `stock_return_reservation_in_capacity` | Capacidades y reservas | Triggers de restricción diferidos: al confirmar, lo reservado y lo aplicado de cada capacidad (y de cada línea) es la suma de sus reservas por estado. Por eso la reserva puede sumar a la capacidad antes de reservar el secuencial y escribir sus filas después de crear la nota, en la misma transacción | SQL de la migración |
| `credit_reservation_matches_note`, `stock_return_reservation_matches_note`, `credit_note_matches_reservations` | Reservas y `electronic_document` | Triggers de restricción diferidos (design D25): una reserva `APPLIED` exige su nota `AUTHORIZED`; una `RELEASED`, su nota `RETURNED` o `NOT_AUTHORIZED`; una `RESERVED`, su nota en un estado no terminal. Una nota de crédito confirmada tiene su reserva acreditable, y en un estado terminal ninguna reserva `RESERVED` | SQL de la migración |
| `debit_note_draft_values_check`, `debit_note_draft_concept_values_check`, `debit_note_draft_guard`, `debit_note_draft_concept_guard` | `debit_note_draft`, `debit_note_draft_concept` | Estado cerrado con su comprobante; forma de pago como clave de entrada (`^[0-9A-Z][0-9A-Z-]{0,63}$`); conceptos de la posición 1 a la 100, causa cerrada, descripción de 1 a 300 sin salto de línea y no vacía, importe positivo en el dominio `importe` y tratamiento `taxCode:rateCode`. Triggers: un borrador emitido y sus conceptos no cambian ni se borran; la empresa, la factura y el autor no cambian | SQL de la migración |
| `debit_note_support_origin`, `debit_note_support_immutable`, `debit_note_support_no_truncate` | `debit_note_support` | Trigger `BEFORE INSERT`: la nota es un comprobante `05` y la factura un `01` en `AUTHORIZED`, de la misma empresa y del mismo ambiente (design D26 de `add-debit-notes`). La relación no cambia, no se borra ni se trunca | SQL de la migración |
| `debit_note_has_support` | `electronic_document` | Trigger de restricción diferido: un comprobante `05` no se confirma sin su factura en `debit_note_support` | SQL de la migración |

- Ninguna restricción limita el número de empresas: una sola empresa es política del aprovisionamiento (ADR 0009, design de `add-user-access`).
- El trigger se prefiere a privilegios separados porque una instalación self-hosted puede usar un solo usuario de base de datos.
- La pertenencia del actor y del usuario afectado a la empresa del evento la garantizan los casos de uso, que los resuelven desde el contexto y la membresía. Una clave foránea compuesta `(company_id, user_id) → member` no se declara porque el actor es opcional y Prisma no admite una relación compuesta opcional con un campo obligatorio; escrita a mano, Prisma la eliminaría en la siguiente migración.
- `member` referencia `organization` y `user` con el borrado en cascada del plugin. No tiene efecto: el producto nunca borra usuarios ni empresas, y los endpoints de borrado están cerrados.
- Discrepancia histórica: la premisa de la nota anterior no se sostiene con Prisma 7.10, que sí acepta una relación compuesta opcional con un campo obligatorio y otro opcional (`add-taxpayer-setup` la usa para el logo: `company_id`, `logo_asset_id`). La nota describe la decisión tal como la tomó `add-user-access` y la auditoría no cambia. Declarar esa clave compuesta, o cualquier otra modificación del modelo de auditoría, se hace con un cambio OpenSpec separado.
- Las escrituras de la configuración tributaria toman `pg_advisory_xact_lock(hashtext('company-config:' || company_id))` al empezar la transacción, de modo que también el primer registro, sin fila que bloquear, queda serializado. Bloquear la identidad tributaria toma el mismo lock.
- Las funciones de los triggers que leen otras tablas fijan `search_path` al esquema en que se crearon (`SET search_path FROM CURRENT`), de modo que resuelven las tablas correctas también en los esquemas aislados de las pruebas.
- `taxpayer-schema.test.ts`, `signing-certificate-schema.test.ts` y `fiscal-catalogs-schema.test.ts` prueban cada invariante escribiendo directamente en las tablas, sin pasar por la aplicación; `credit-notes-schema.test.ts`, los de las notas de crédito, y `debit-notes-schema.test.ts`, los de las notas de débito.
- **Acoplamiento intencional de las notas de crédito** (design D25 de `add-credit-notes`): `credit_note_matches_reservations` es un trigger sobre `electronic_document`, de `fiscal`, que lee las reservas de `credit-notes` e `inventory`, y los triggers de las reservas leen el estado del comprobante. Es deliberado: la transición terminal de una nota, la aplicación o liberación de sus reservas y la `DEVOLUCION_NC` se confirman juntas o ninguna, y la base rechaza al confirmar cualquier estado local intermedio. El trigger solo se evalúa en comprobantes `04`, así que la factura no paga su costo.
- **Acoplamiento intencional de las notas de débito** (design D26 de `add-debit-notes`): `debit_note_has_support` es un trigger diferido sobre `electronic_document` que lee `debit_note_support`, de `debit-notes`, con el mismo patrón que la nota de crédito: una nota de débito y la factura que modifica se confirman juntas en la transacción de la reserva, o ninguna. Solo se evalúa en comprobantes `05`; la factura y la nota de crédito no lo disparan.
- El cargador de catálogos toma su propio `pg_advisory_xact_lock(hashtext('fiscal-catalogs:loader'))`, distinto del lock de las migraciones de Prisma, y aplica todos los datasets pendientes en una sola transacción (design D3 de `add-fiscal-catalogs`).

Regenerar el esquema de Better Auth:

```bash
corepack pnpm --filter @facturador/backend db:auth-schema
```

El CLI `auth` 1.7.7 fusiona con `prisma/schema.prisma`: añade lo que cambie en los modelos de
Better Auth y conserva los modelos, relaciones y `@@unique` propios. Los `CHECK` y los triggers
viven solo en el SQL de las migraciones, que el CLI no toca. Tras regenerar, una migración nueva
recoge las diferencias; `migrations.test.ts` comprueba que la regeneración no cambia el esquema
actual y que migraciones y esquema coinciden.

## Indexing

- List critical queries.
- Map each critical query to an index.
- Lead composite indexes with the tenant column for tenant-scoped queries, such as `(tenant_id, created_at)`.

| Consulta crítica                                                  | Índice                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Bandeja por fecha (ERS RF-402)                                    | `(company_id, issue_date DESC)`                                |
| Bandeja por tipo y estado                                         | `(company_id, document_type, state, issue_date DESC)`          |
| Búsqueda por identificación del receptor                          | `(company_id, recipient_identification)`                       |
| Búsqueda por número de comprobante                                | La restricción única de secuencial.                            |
| Comprobantes por reconciliar o en espera                          | `(company_id, state, updated_at)`                              |
| Jobs listos para ejecutar                                         | `(status, next_attempt_at)`                                    |
| Jobs e intentos del SRI de un comprobante                         | `job (company_id, document_id)` y `sri_attempt (company_id, document_id, started_at)` |
| Terceros por identificación y nombre (ERS RF-323)                 | `(company_id, search_identification)` con colación `C` para el prefijo; `(company_id, status, search_name, id)` para el orden; el fragmento de nombre, según medición. |
| Productos por código principal, auxiliar y nombre (ERS RF-304)    | `(company_id, search_main_code)` y `(company_id, search_auxiliary_code)` con colación `C`; `(company_id, status, search_name, id)` para el orden; el fragmento de nombre, según medición. |
| Kárdex por producto y fechas (ERS RF-314)                         | `(company_id, product_id, occurred_at)`                        |
| Auditoría por fecha                                               | `(company_id, occurred_at)`                                    |
| Membresía activa del usuario de la sesión (cada petición, D3)     | `member (userId)`                                              |
| Usuarios de la empresa                                            | `member (organizationId)` y el único `(organizationId, userId)` |

Los índices de búsqueda por nombre (`pg_trgm` u otro) se añaden solo si la medición con el
volumen de referencia (Q-26) no cumple ERS RNF-005. Las claves de búsqueda por prefijo usan la
colación `C`, para que su índice btree resuelva `LIKE 'prefijo%'` con cualquier colación de la
base: Prisma 7 no conserva `text_pattern_ops` en un índice btree al comparar la base con el esquema.

## Auth Tables

Better Auth owns its auth-related tables. Application code should not manually mutate password/session internals except through documented Better Auth APIs.
