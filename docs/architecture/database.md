# Database Architecture

## Primary Database

- Engine: PostgreSQL.
- ORM/query layer: Prisma.
- Migration strategy: versioned Prisma migrations.

## Data Ownership

Modelo objetivo derivado de `../product/domain-model.md`. La columna de tenant es
`company_id` en todo el esquema (ADR 0009). Ninguna tabla existe todavía.

| Table/Collection | Owner | Tenant scoped | Notes |
| --- | --- | --- | --- |
| `organization` (plugin Organization de Better Auth) | `identity` | Es el tenant | La empresa: su `id` es el `company_id` de todo recurso privado. Una por instalación en el MVP como política operativa del aprovisionamiento; ninguna restricción estructural limita el número de empresas (ADR 0009). Los datos tributarios van en una tabla propia de `taxpayer`. |
| `company_config_version` | `taxpayer` | Yes | Inmutable; los snapshots de los comprobantes la referencian. |
| `establishment`, `emission_point` | `taxpayer` | Yes | Se desactivan; no se borran si tienen comprobantes. |
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

Los índices de búsqueda por nombre (`pg_trgm` u otro) se añaden solo si la medición con el
volumen de referencia (Q-26) no cumple ERS RNF-005.

## Auth Tables

Better Auth owns its auth-related tables. Application code should not manually mutate password/session internals except through documented Better Auth APIs.
