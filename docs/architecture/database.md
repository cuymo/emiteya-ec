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
| `certificate` | `taxpayer` | Yes | Metadatos y secreto cifrado; nunca se expone (ADR 0011). |
| `member` (plugin Organization de Better Auth) | `identity` | Yes | La membresía: rol `ADMIN` u `OPERATOR` y `status`, con `UNIQUE (organizationId, userId)` y `CHECK` propios. Las cuentas son de Better Auth. |
| `fiscal_sequence` | `fiscal` | Yes | Bloqueo de fila al reservar. |
| `party`, `product` | `catalogs` | Yes | Editables; los comprobantes guardan su copia. |
| `fiscal_catalog_entry`, `consumer_final_policy`, `schema_registry_entry`, `special_case_support` | `catalogs` | No | Datos versionados distribuidos con cada release. La habilitación por empresa va en una tabla aparte (Q-25). |
| `electronic_document` | `fiscal` | Yes | Nunca se borra desde `SEQUENCE_RESERVED`. |
| `document_line`, `document_relation`, `tax_detail`, `payment` | `fiscal` | Yes | Inmutables desde la firma, salvo corrección de un devuelto (BR-28). |
| `document_state_transition` | `fiscal` | Yes | Solo agregado (ERS RF-525). |
| `sri_attempt` | `fiscal` | Yes | Solo agregado. |
| `artifact` | `fiscal` | Yes | Solo agregado: metadatos y hash; el contenido vive en el almacenamiento (ADR 0010). |
| `delivery_attempt` | `fiscal` | Yes | Solo agregado. |
| `stock_movement` | `inventory` | Yes | Solo agregado (ERS RF-313). |
| `idempotency_record` | `platform` | Yes | Purga por ventana declarada. |
| `job` | `platform` | Yes | Cola persistida (ADR 0012). |
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
UNIQUE (company_id, emission_point_id, document_type)          -- fiscal_sequence; + environment si Q-02
CHECK  (next_number BETWEEN 1 AND 999999999)
UNIQUE (company_id, environment, establishment_code, emission_point_code, document_type, sequential)
                                                               -- electronic_document (CTX §5, I-12)

-- Clave de acceso (ERS §13.1; CTX I-01, I-02, I-13)
UNIQUE (access_key) WHERE access_key IS NOT NULL
CHECK  (access_key ~ '^[0-9]{49}$')

-- Idempotencia de la emisión (Q-30)
UNIQUE (company_id, user_id, operation, idempotency_key)       -- ERS y CTX proponen (company_id, idempotency_key)

-- Catálogos
UNIQUE (company_id, identification_type, identification_number) -- party
UNIQUE (company_id, main_code) WHERE main_code IS NOT NULL     -- product
UNIQUE (company_id) WHERE status = 'ACTIVE'                    -- certificate: uno activo

-- Inventario (ERS RF-206, AC-08)
UNIQUE (document_id, product_id, movement_type)
  WHERE movement_type IN ('SALIDA_FACTURA', 'DEVOLUCION_NC')
```

- El comprobante guarda los códigos de establecimiento y punto como parte de su snapshot, además de las claves foráneas.
- Importes, cantidades y tarifas son `NUMERIC` con escala suficiente para el campo XSD más preciso (seis decimales en la versión 1.1.0); el builder aplica la escala de cada campo (CTX §10.6). Nunca `float` ni `double`.
- Las claves foráneas desde las tablas fiscales hacia terceros, productos, usuarios y establecimientos usan `ON DELETE RESTRICT`. Nada borra en cascada comprobantes ni artefactos (ERS §13.1).
- Las tablas de solo agregado se protegen en la base de datos: el rol de la aplicación no tiene `UPDATE` ni `DELETE` sobre ellas, o un trigger lo rechaza. La decisión entre ambos va en el cambio que las cree.
- Las transiciones de estado son actualizaciones guardadas; la base de datos no codifica la máquina de estados completa, pero el estado es un enum cerrado.

## Esquema actual

Migraciones: `backend/prisma/migrations/20261002083000_add_user_access` (cambio
`add-user-access`) y `20261002120000_add_taxpayer_setup` (cambio `add-taxpayer-setup`). Las tablas
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

- Ninguna restricción limita el número de empresas: una sola empresa es política del aprovisionamiento (ADR 0009, design de `add-user-access`).
- El trigger se prefiere a privilegios separados porque una instalación self-hosted puede usar un solo usuario de base de datos.
- La pertenencia del actor y del usuario afectado a la empresa del evento la garantizan los casos de uso, que los resuelven desde el contexto y la membresía. Una clave foránea compuesta `(company_id, user_id) → member` no se declara porque el actor es opcional y Prisma no admite una relación compuesta opcional con un campo obligatorio; escrita a mano, Prisma la eliminaría en la siguiente migración.
- `member` referencia `organization` y `user` con el borrado en cascada del plugin. No tiene efecto: el producto nunca borra usuarios ni empresas, y los endpoints de borrado están cerrados.
- Discrepancia histórica: la premisa de la nota anterior no se sostiene con Prisma 7.10, que sí acepta una relación compuesta opcional con un campo obligatorio y otro opcional (`add-taxpayer-setup` la usa para el logo: `company_id`, `logo_asset_id`). La nota describe la decisión tal como la tomó `add-user-access` y la auditoría no cambia. Declarar esa clave compuesta, o cualquier otra modificación del modelo de auditoría, se hace con un cambio OpenSpec separado.
- Las escrituras de la configuración tributaria toman `pg_advisory_xact_lock(hashtext('company-config:' || company_id))` al empezar la transacción, de modo que también el primer registro, sin fila que bloquear, queda serializado. Bloquear la identidad tributaria toma el mismo lock.
- Las funciones de los triggers que leen otras tablas fijan `search_path` al esquema en que se crearon (`SET search_path FROM CURRENT`), de modo que resuelven las tablas correctas también en los esquemas aislados de las pruebas.
- `taxpayer-schema.test.ts` prueba cada invariante con dos empresas escribiendo directamente en las tablas, sin pasar por la aplicación.

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
| Jobs listos para ejecutar                                         | `(status, run_at)`                                             |
| Terceros por identificación y nombre (ERS RF-323)                 | `(company_id, identification_number)`; búsqueda por nombre según medición. |
| Productos por código principal, auxiliar y nombre (ERS RF-304)    | `(company_id, main_code)`, `(company_id, auxiliary_code)`; nombre según medición. |
| Kárdex por producto y fechas (ERS RF-314)                         | `(company_id, product_id, occurred_at)`                        |
| Auditoría por fecha                                               | `(company_id, occurred_at)`                                    |
| Membresía activa del usuario de la sesión (cada petición, D3)     | `member (userId)`                                              |
| Usuarios de la empresa                                            | `member (organizationId)` y el único `(organizationId, userId)` |

Los índices de búsqueda por nombre (`pg_trgm` u otro) se añaden solo si la medición con el
volumen de referencia (Q-26) no cumple ERS RNF-005.

## Auth Tables

Better Auth owns its auth-related tables. Application code should not manually mutate password/session internals except through documented Better Auth APIs.
