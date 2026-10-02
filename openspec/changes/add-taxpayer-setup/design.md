# Design

## Context

Ver `proposal.md` (Why) y las specs `taxpayer-setup` y `audit-trail` de este cambio.

Estado actual que condiciona el diseño:

- `add-user-access` dejó la empresa como fila `organization` de Better Auth, la membresía en `member` con `UNIQUE (organizationId, userId)`, el mapa central de permisos denegado por defecto (`identity/domain/access-policy.ts`), `createAuthorizer` (permiso, pertenencia y validación, con evento de seguridad en cada denegación), el contexto de petición resuelto en el servidor, y `audit_event` de solo agregado sin `CHECK` sobre `action`.
- La unidad de trabajo de `identity` existe para enlazar Better Auth a una transacción de Prisma. Este cambio no usa Better Auth y no la necesita.
- `express.json()` es global y solo procesa `application/json`, así que una ruta puede leer un cuerpo binario con su propio parser.
- La política de snapshots (CTX §39, ADR 0008) exige que cada comprobante referencie la versión de configuración con que se emitió. El logo se guarda según el ADR 0017.
- XSD oficiales obtenidos del portal del SRI el 2026-10-02 y conservados byte a byte en `docs/product/sri-xsd/` con su SHA-256 y el de cada paquete ZIP de origen (`README.md`). Son las versiones del MVP (Q-13): factura 1.1.0, liquidación 1.1.0, nota de crédito 1.1.0, nota de débito 1.0.0, guía 1.1.0 y retención 2.0.0. Las restricciones del emisor de D3 salen de ellos.
- Q-23, Q-31 y Q-42 están resueltas; Q-37 (RUC proveedor) y Q-38 (anexos y leyendas) siguen abiertas sin bloquear este cambio.

## Goals / Non-Goals

**Goals:**

- Una versión de configuración siempre completa y válida, para que el cambio de emisión pueda tomarla como snapshot sin volver a validar ni completar nada.
- Invariantes críticas en la base de datos además de la aplicación: versiones y assets inmutables, RUC bloqueado, códigos únicos e inmutables, aislamiento por empresa con claves foráneas compuestas.
- Un mecanismo de bloqueo de la identidad tributaria listo para que `add-invoice-emission` lo invoque, sin decidir aquí cuándo.
- Preparación para emitir extensible: `add-signing-certificate` añade su requisito sin rediseñar la lista.

**Non-Goals:**

- Mapear la configuración a XML (`ambiente` `1`/`2`, `obligadoContabilidad` `SI`/`NO`, leyenda RIMPE): es del motor fiscal en `add-invoice-emission`.
- Exponer por HTTP versiones anteriores o assets históricos: el RIDE (cambio 8) los leerá por el puerto de assets.
- Paginación de establecimientos y puntos (ver D7).

## Decisions

### D1. Módulo `taxpayer`

Módulo nuevo `backend/src/modules/taxpayer/` con las capas de `backend.md`:

- `domain/`: perfil tributario normalizado, comparación de versiones, disponibilidad de puntos y requisitos de preparación. Sin dependencias de framework.
- `application/`: casos de uso de configuración, ambiente, logo, establecimientos, puntos, predeterminado y preparación. Reciben el `RequestContext` como datos y autorizan con el `createAuthorizer` de `identity`.
- `infrastructure/`: repositorios de Prisma, almacén de assets en PostgreSQL y routers HTTP.

Transacciones: un puerto `TaxpayerUnitOfWork.run(work)` implementado con `prisma.$transaction` interactivo, que entrega repositorios y un `AuditLog` (`createAuditLog(tx)`) ligados a la misma transacción. Así el evento y el cambio se confirman o revierten juntos (spec `audit-trail`, registro atómico).

Alternativa descartada: reutilizar la unidad de trabajo de `identity`. Arrastraría Better Auth (`runWithAdapter`) a un módulo que no lo usa y rompería el aislamiento del módulo único de integración (D2b de `add-user-access`).

### D2. Configuración versionada

Dos tablas:

- `company_config_version`: una fila inmutable por versión, con todos los datos de la empresa, los atributos tributarios, el ambiente y la referencia opcional al asset de logo. `version` es consecutiva por empresa (`UNIQUE (company_id, version)`). Guarda `created_at` y `created_by` (usuario, FK `RESTRICT`).
- `company_config`: una fila por empresa con la versión vigente (`current_version_id` y `current_version`) y el estado de la identidad tributaria (D4). Clave foránea compuesta `(company_id, current_version_id)` hacia `company_config_version (company_id, id)`, para que la vigente sea siempre de la misma empresa.

Reglas:

- Una versión siempre es completa y válida. Antes del primer registro no existe ninguna fila: la empresa no tiene datos, su ambiente es `TEST` y la identidad no está bloqueada.
- Cada escritura de configuración (datos, ambiente, logo) calcula el estado deseado completo a partir de la versión vigente y lo compara, ya normalizado, con ella. Si son iguales, responde con la vigente sin crear versión ni evento. Si difieren y la solicitud trae un `expectedVersion` que no es el vigente, responde `409 CONFIG_VERSION_CONFLICT`. En otro caso inserta la versión `vigente + 1`, actualiza `company_config` y registra el evento.
- Este orden hace idempotente el reenvío del mismo cambio (spec "Envío repetido") y rechaza el cambio concurrente distinto.
- `expectedVersion` es `null` en el primer registro. Va en el cuerpo de las rutas JSON y en la consulta de las del logo.
- Toda escritura de configuración toma `pg_advisory_xact_lock(hashtext('company-config:' || company_id))` al empezar la transacción. Serializa también el primer registro, cuando aún no hay fila que bloquear con `FOR UPDATE`. `add-invoice-emission` debe tomar el mismo lock al bloquear la identidad (D4).
- Inmutabilidad en la base de datos: trigger de solo agregado en `company_config_version`, que rechaza `UPDATE`, `DELETE` y `TRUNCATE`, igual que en `audit_event`. `company_config` no admite `DELETE`.

Alternativas descartadas:

- Una sola fila mutable más el historial en la auditoría: los snapshots no tendrían una versión estable que referenciar (CTX §39).
- La vigente como `MAX(version)` sin fila de cabecera: no ofrece un lugar donde guardar el bloqueo, y obliga a buscar la máxima en cada lectura.

### D3. Validación conforme a los XSD oficiales

Esquemas Zod estrictos en `packages/contracts/src/taxpayer.ts`, compartidos por backend y frontend. Rechazan campos desconocidos, incluido `companyId`.

Normalización antes de validar y comparar: Unicode NFC y recorte de espacios al inicio y al final. Un opcional vacío se guarda como `null`.

| Dato | Campo XSD | Regla | Fuente |
| --- | --- | --- | --- |
| RUC | `ruc` | `^[0-9]{10}001$`, obligatorio | XSD `numeroRuc`. Sin dígito verificador: CTX §1.1 y §9.1 prohíben rechazar un RUC por un algoritmo local. |
| Razón social | `razonSocial` | 1 a 300, obligatorio | XSD `[^\n]*`. También se rechaza `\r`. |
| Nombre comercial | `nombreComercial` | 1 a 300, opcional | XSD |
| Dirección matriz | `dirMatriz` | 1 a 300, obligatoria | XSD |
| Obligado a llevar contabilidad | `obligadoContabilidad` | booleano obligatorio, sin valor por defecto | ERS RF-103: se declara y no se infiere. El XSD lo hace opcional (`SI`/`NO`). |
| Contribuyente especial | `contribuyenteEspecial` | `^[A-Za-z0-9]{3,13}$`, opcional | XSD de cinco tipos; la retención 2.0.0 admite solo de 3 a 5 (ver Riesgos). |
| Agente de retención | `agenteRetencion` | `^[0-9]{1,8}$`, opcional: número de resolución | XSD. Corrige el booleano de CTX §5 (ver abajo). |
| Gran contribuyente | — | booleano, `false` = no declarado | CTX §5 y leyenda del Anexo 24 (Q-38). No es un campo del XSD. |
| Categoría RIMPE | `contribuyenteRimpe` | `EMPRENDEDOR`, `NEGOCIO_POPULAR` o `null` | CTX §5. El XSD solo admite el texto fijo `CONTRIBUYENTE RÉGIMEN RIMPE`; su mapeo por categoría es de Q-38. |
| RUC proveedor | — | `^[0-9]{10}001$`, opcional, vacío por defecto | CTX §37.1 y Q-37: nunca un valor propio ni ficticio. |
| Teléfono | — | hasta 30 caracteres entre dígitos, espacios, `+`, `-`, `(` y `)`, opcional | Límite de producto; va en `infoAdicional`, cuyo máximo es 300. |
| Correo | — | correo válido, hasta 254 caracteres, opcional | RFC 5321; `infoAdicional` admite 300. |
| Código de establecimiento o punto | `estab`, `ptoEmi` | `^[0-9]{3}$` | XSD |
| Dirección de establecimiento | `dirEstablecimiento` | 1 a 300 | XSD. Obligatoria por ERS RF-110, aunque el XSD la haga opcional. |
| Descripción de punto | — | hasta 100 caracteres, opcional | Producto: etiqueta para reconocer el punto. No va al XML. |

Contradicción CTX §5 frente al XSD: CTX §5 modela `withholdingAgent?: boolean`, pero el XSD oficial define `agenteRetencion` como dígitos de hasta 8, el número de la resolución que designa al agente. El orden de CTX §1 pone el XSD oficial por encima de los documentos del proyecto, así que se guarda el número. Se registra como C-10 en `open-questions.md`, para no decidirlo en silencio.

`tipoEmision` no se configura: es siempre `1` (off-line) y lo fija el motor fiscal. El logo nunca entra al XML (ERS RF-102).

Las mismas reglas existen como `CHECK` en la base de datos para RUC, RUC proveedor, códigos, ambiente y categoría RIMPE, y como longitudes de columna para los textos. Los mensajes al usuario salen de Zod.

### D4. Identidad tributaria bloqueada (`taxIdentityLocked`)

- Estado en `company_config`: `tax_identity_locked_at timestamptz NULL` y `locked_ruc char(13) NULL`, con `CHECK ((tax_identity_locked_at IS NULL) = (locked_ruc IS NULL))`. `taxIdentityLocked` es `tax_identity_locked_at IS NOT NULL` y se expone en `GET /api/v1/taxpayer`.
- La aplicación rechaza un cambio de RUC con la identidad bloqueada con `409 TAX_IDENTITY_LOCKED` y el mensaje "El RUC ya no puede cambiar en esta empresa. Para emitir con otro RUC se necesita otra empresa." El resto del perfil sigue siendo editable.
- Defensa en la base de datos:
  - Un trigger `BEFORE INSERT` en `company_config_version` rechaza una versión cuyo RUC difiere de `locked_ruc`.
  - Un trigger `BEFORE UPDATE` en `company_config` rechaza desbloquear o cambiar `locked_ruc` una vez fijado.
  - Al bloquear, el mismo trigger exige que `locked_ruc` sea el RUC de la versión vigente.
- Operación interna `lockTaxIdentity(companyId)` en la capa de aplicación de `taxpayer`, sin ruta HTTP, idempotente, que toma el lock de D2.
  - Ningún flujo de este cambio la invoca; las pruebas la usan para cubrir ambos estados.
  - `add-invoice-emission` la invocará dentro de la transacción que defina como hito, como máximo al crear el primer artefacto fiscal que deba conservarse (Q-31), y decidirá si ese hito tiene evento propio.
  - Queda anotado en `fiscal-emission.md`.
- UI: con la identidad sin bloquear, el RUC es un campo editable con la ayuda "Puedes corregir el RUC hasta que se use en un comprobante." Bloqueada, el RUC aparece como etiqueta de solo lectura con esa explicación (`forms-and-workflows.md`, campos inmutables).

Alternativa descartada: derivar el bloqueo de la existencia de comprobantes con una consulta. Acoplaría este módulo a tablas que todavía no existen y dejaría la invariante sin defensa en la base de datos.

### D5. Logo y assets de configuración (ADR 0017)

- Tabla `configuration_asset`:
  - Columnas: `id`, `company_id` (FK `RESTRICT`), `kind` (`LOGO`), `mime_type`, `size_bytes`, `sha256` (hex de 64), `content bytea`, `created_at` y `created_by`.
  - `UNIQUE (company_id, sha256)` deduplica por empresa.
  - `UNIQUE (company_id, id)` es el destino de la FK compuesta desde la versión.
  - `CHECK`: `size_bytes = octet_length(content)`, tamaño positivo, `mime_type IN ('image/png', 'image/jpeg')`.
  - Trigger de solo agregado: rechaza `UPDATE`, `DELETE` y `TRUNCATE`.
- `company_config_version.logo_asset_id` es nullable, con FK compuesta `(company_id, logo_asset_id)`.
- Puerto `ConfigurationAssetStore`: `save(companyId, bytes) → AssetRef` (calcula SHA-256 y reutiliza el asset existente con `INSERT ... ON CONFLICT DO NOTHING` y lectura posterior) y `read(companyId, assetId) → { bytes, mimeType, sizeBytes, sha256 }`. El adaptador PostgreSQL es el único; una migración a object storage cambia el adaptador, no el contrato (ADR 0017).
- Validación en el borde, por contenido:
  - El formato se reconoce por la firma: PNG `89 50 4E 47 0D 0A 1A 0A` y JPEG `FF D8 FF`.
  - Las dimensiones se leen de la cabecera (`IHDR` en PNG, marcador `SOFn` en JPEG). Se rechaza una cabecera ilegible o más de 4096 px por lado, para no guardar imágenes que el renderizador del RIDE no pueda decodificar sin riesgo de memoria.
  - El tipo MIME guardado es el detectado, nunca el declarado.
  - SVG queda fuera porque puede contener scripts. GIF y WebP quedan fuera porque el RIDE no los necesita, y PNG y JPEG los admite cualquier librería PDF candidata (Q-34).
- Límite: variable `LOGO_MAX_BYTES`, por defecto 524 288 (512 KiB) y entre 16 KiB y 2 MiB, validada al arrancar. ERS y CTX no fijan un valor.
- Transporte:
  - `PUT /api/v1/taxpayer/logo?expectedVersion=n` recibe el cuerpo binario (`express.raw`) con `Content-Type` `image/png`, `image/jpeg` o `application/octet-stream`.
  - Otro tipo responde `415`. Un cuerpo mayor que el límite responde `413` con el límite en el mensaje, dentro del sobre de error.
  - Sin `multipart` ni dependencia nueva.
- Lectura: `GET /api/v1/taxpayer/logo` devuelve los bytes del logo vigente con su MIME, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-cache` y `ETag` igual al SHA-256. Sin logo responde `404`.
- Eliminar: `DELETE /api/v1/taxpayer/logo?expectedVersion=n` crea una versión con `logo_asset_id = NULL`. Sin logo vigente no hace nada.
- Logo antes del primer registro: `409 TAXPAYER_NOT_CONFIGURED`.

### D6. Ambiente

- Vive en la versión (`environment` `TEST` o `PRODUCTION`, con `CHECK`), porque CTX §5 lo incluye en la configuración que referencia el snapshot. Sin versión, el ambiente es `TEST`.
- Se cambia solo con `PUT /api/v1/taxpayer/environment { environment, expectedVersion }` (permiso `environment.change`). `PUT /api/v1/taxpayer` no acepta `environment`: el esquema estricto lo rechaza. Sin datos registrados: `409 TAXPAYER_NOT_CONFIGURED`.
- Confirmación en la UI, según la escalera de `forms-and-workflows.md`:
  - A `Producción`: `ConfirmDialog` que explica que los comprobantes tendrán validez tributaria y exige escribir el RUC de la empresa. Así se evita el cambio accidental y el cambio en la instalación equivocada (CTX §6).
  - A `Pruebas`: confirmación de un paso.
- CTX §6 también prohíbe cambiar de ambiente "durante la misma operación". `add-invoice-emission` lo garantiza fijando el ambiente en el snapshot al reservar. Queda anotado en `fiscal-emission.md`.
- Aviso: el shell lee `GET /api/v1/company/status` con React Query (`refetchOnWindowFocus`) y lo invalida tras cambiar el ambiente.
  - En `TEST`: franja persistente bajo la cabecera, sin botón de cierre, con icono, texto y color de advertencia: "Ambiente de Pruebas: los comprobantes no tienen validez tributaria."
  - En `PRODUCTION`: `StatusBadge` "Producción" en la cabecera.
  - Si el estado aún carga, se reserva el espacio. Si falla, el aviso muestra "Ambiente desconocido" en vez de suponer `Producción`.

### D7. Establecimientos y puntos de emisión

- `establishment`: `id`, `company_id` (FK `RESTRICT`), `code char(3)` con `CHECK (code ~ '^[0-9]{3}$')`, `address varchar(300)`, `active` y fechas. `UNIQUE (company_id, code)` y `UNIQUE (company_id, id)`.
- `emission_point`: `id`, `company_id`, `establishment_id`, `code char(3)` con el mismo `CHECK`, `description varchar(100) NULL`, `active` y fechas.
  - FK compuesta `(company_id, establishment_id)` hacia `establishment (company_id, id)`.
  - `UNIQUE (establishment_id, code)` y `UNIQUE (company_id, id)`.
- El código y la pertenencia son inmutables: un trigger `BEFORE UPDATE` rechaza cambiar `code`, `company_id` o `establishment_id`. Los esquemas de edición no aceptan `code`.
  - Supuesto registrado: ERS RF-110 dice "editar" sin decir qué. Un código equivocado se corrige creando el correcto y desactivando el otro, que queda reservado.
  - La alternativa de editar el código mientras no se use dependería de los cambios 3 y 6 y se olvidaría fácilmente.
- No hay borrado; solo `active`. Un punto está disponible si él y su establecimiento están activos. Desactivar un establecimiento no cambia el `active` de sus puntos, de modo que al reactivarlo vuelven los que estaban activos.
- El alta concurrente del mismo código la resuelve la restricción única: P2002 se traduce a `409 ESTABLISHMENT_CODE_TAKEN` o `409 EMISSION_POINT_CODE_TAKEN`.
- Las ediciones son de estado deseado (`PUT`), idempotentes y de último en escribir, porque cada recurso tiene uno o dos campos y queda auditado.
- `GET /api/v1/establishments` devuelve todos los establecimientos de la empresa ordenados por código, con sus puntos anidados y el indicador `available` de cada punto, sin paginación. El techo teórico es 999 establecimientos; el MVP espera decenas (Q-26). Si una medición lo exige, se pagina sin cambiar el resto del contrato.
- Se puede crear un punto en un establecimiento inactivo: queda no disponible hasta reactivarlo.

### D8. Punto de emisión predeterminado

- Tabla `member_default_emission_point`: `company_id`, `user_id`, `emission_point_id` y `updated_at`, con `PRIMARY KEY (company_id, user_id)`.
  - FK compuesta `(company_id, user_id)` hacia `member (organizationId, userId)`.
  - FK compuesta `(company_id, emission_point_id)` hacia `emission_point (company_id, id)`.
  - Las tablas de Better Auth no cambian, y el CLI de esquema sigue fusionando sin conflicto.
- Se guarda el punto; el establecimiento se deriva de él, de modo que no pueden contradecirse.
- `GET /api/v1/me/default-emission-point` (permiso `account.read`) y `PUT /api/v1/me/default-emission-point { emissionPointId | null }` (permiso `account.setDefaultEmissionPoint`), ambos roles.
  - Elegir un punto no disponible responde `409 EMISSION_POINT_UNAVAILABLE`; uno de otra empresa, `404`.
  - La respuesta incluye establecimiento, punto y `available`.
- Si el punto deja de estar disponible, el predeterminado se conserva con `available: false`. La UI lo indica, y `add-invoice-emission` no lo preselecciona. No se borra al desactivar, para no escribir en preferencias de otros usuarios desde la gestión de establecimientos.
- `GET /api/v1/me` no cambia: su contrato, de lista permitida, es de `user-access`.
- Supuesto registrado: cada usuario define el suyo (ERS RF-113). Que un administrador lo defina por otro queda fuera.
- Sin evento de auditoría: es una preferencia personal que no cambia ningún dato fiscal ni permiso, fuera de ERS RF-003 y SEC-007.

### D9. Preparación para emitir

- Se calcula en cada lectura, no se guarda. `GET /api/v1/company/status` (permiso `readiness.read`, ambos roles) devuelve:
  - `environment`;
  - `displayName`: nombre comercial o razón social, o `null` sin datos;
  - `readiness: { ready, checks: [{ key, status }] }`.
- Requisitos, en orden:
  - `TAXPAYER_DATA`: existe una versión.
  - `EMISSION_POINT`: existe al menos un punto disponible.
  - `SIGNING_CERTIFICATE`: lo provee un puerto `SigningCertificateReadiness`, cuya implementación de este cambio responde siempre `PENDING`; `add-signing-certificate` la reemplaza.
- `ready` es verdadero solo si todos están `MET`. El ambiente no es un requisito: siempre está definido, `TEST` por defecto (BR-03), y se muestra junto a la lista.
- El bloqueo efectivo de la emisión es de `add-invoice-emission`, que consultará esta misma función.

### D10. Permisos

Filas nuevas en el mapa central de `identity/domain/access-policy.ts`, denegado por defecto, con espejo en `frontend/src/lib/permissions.ts` y en la tabla de `access-control.md` (la prueba `access-policy-doc` comprueba la coincidencia):

| Permiso | Operación | `ADMIN` | `OPERATOR` |
| --- | --- | --- | --- |
| `taxpayer.read` | Consultar los datos tributarios, la versión vigente, el bloqueo y el logo | Sí | No |
| `taxpayer.configure` | Registrar o corregir los datos y atributos, y cargar, reemplazar o eliminar el logo | Sí | No |
| `environment.change` | Cambiar el ambiente SRI | Sí | No |
| `establishments.read` | Consultar establecimientos y puntos de emisión | Sí | Sí |
| `establishments.manage` | Crear, editar, activar y desactivar establecimientos y puntos | Sí | No |
| `readiness.read` | Consultar el ambiente y la preparación para emitir | Sí | Sí |
| `account.setDefaultEmissionPoint` | Definir el punto de emisión predeterminado propio | Sí | Sí |

`environment.change` va aparte de `taxpayer.configure` porque la matriz de Q-22 los separa y porque su riesgo y su confirmación son distintos. El operador lee establecimientos para elegir su predeterminado, pero no ve los datos tributarios, que no necesita (mínimo privilegio).

### D11. Auditoría

Acciones nuevas en `AUDIT_ACTIONS`, sin migración porque `action` no tiene `CHECK`:

- `taxpayer.configured`
- `taxpayer.environment_changed`
- `taxpayer.logo_replaced`
- `taxpayer.logo_removed`
- `establishment.created`, `establishment.updated`, `establishment.deactivated`, `establishment.reactivated`
- `emission_point.created`, `emission_point.updated`, `emission_point.deactivated`, `emission_point.reactivated`

Formato de `changes`, plano como en `AuditChanges`:

- `configVersion` en los eventos de configuración.
- Por cada dato cambiado, `<campo>.from` y `<campo>.to`. El primer registro solo lleva `.to`.
- El logo, por metadatos: `logoSha256.from`/`.to`, `logoMimeType.*` y `logoSizeBytes.*`. Nunca bytes.
- `establishmentId` y `establishmentCode`, y `emissionPointId` y `emissionPointCode`, en los de establecimientos y puntos.

Los nombres evitan las palabras que rechaza `assertNoSecrets` (`sha256`, no `hash`). Los datos tributarios no son secretos, y conservar sus valores anteriores es lo que piden ERS RF-105 y SEC-007.

### D12. API

Todas bajo `/api/v1/` (ADR 0015), con `requireContext`, el sobre `{ data }` o `{ error }`, y registradas en `packages/contracts/src/api/routes.ts` para el OpenAPI generado:

| Ruta | Permiso | Éxito | Errores propios |
| --- | --- | --- | --- |
| `GET /company/status` | `readiness.read` | `200` | — |
| `GET /taxpayer` | `taxpayer.read` | `200` (`configured: false` sin datos) | — |
| `PUT /taxpayer` | `taxpayer.configure` | `200` con la vigente | `400`, `409 CONFIG_VERSION_CONFLICT`, `409 TAX_IDENTITY_LOCKED` |
| `PUT /taxpayer/environment` | `environment.change` | `200` | `400`, `409 CONFIG_VERSION_CONFLICT`, `409 TAXPAYER_NOT_CONFIGURED` |
| `GET /taxpayer/logo` | `taxpayer.read` | `200` binario | `404` |
| `PUT /taxpayer/logo` | `taxpayer.configure` | `200` con la vigente | `400` formato o dimensiones, `413`, `415`, `409` |
| `DELETE /taxpayer/logo` | `taxpayer.configure` | `200` con la vigente | `409` |
| `GET /establishments` | `establishments.read` | `200` | — |
| `POST /establishments` | `establishments.manage` | `201` | `400`, `409 ESTABLISHMENT_CODE_TAKEN` |
| `PUT /establishments/:establishmentId` | `establishments.manage` | `200` | `400`, `404` |
| `PUT /establishments/:establishmentId/status` | `establishments.manage` | `200` | `404` |
| `POST /establishments/:establishmentId/emission-points` | `establishments.manage` | `201` | `400`, `404`, `409 EMISSION_POINT_CODE_TAKEN` |
| `PUT /establishments/:establishmentId/emission-points/:emissionPointId` | `establishments.manage` | `200` | `400`, `404` |
| `PUT /establishments/:establishmentId/emission-points/:emissionPointId/status` | `establishments.manage` | `200` | `404` |
| `GET /me/default-emission-point` | `account.read` | `200` (`null` sin predeterminado) | — |
| `PUT /me/default-emission-point` | `account.setDefaultEmissionPoint` | `200` | `404`, `409 EMISSION_POINT_UNAVAILABLE` |

- Orden de comprobación de `createAuthorizer`: permiso (`403` con evento de seguridad), pertenencia (`404` igual que inexistente, con evento de seguridad) y validación (`400`).
- Un punto se busca siempre por `(company_id, establishment_id, id)`, de modo que cambiar el establecimiento de la URL no alcanza puntos de otro.
- Sin `Idempotency-Key`: ninguna mutación duplica un efecto al repetirse. Las de configuración son de estado deseado con `expectedVersion`; las altas chocan con la restricción única; las demás son `PUT` de estado deseado (`idempotency.md`).

### D13. Datos

Una migración, `add_taxpayer_setup`, con las tablas de D2, D4, D5, D7 y D8, sus claves foráneas compuestas, `CHECK`, índices y triggers. Lo que Prisma no expresa va en SQL dentro de la migración:

- triggers de solo agregado e inmutabilidad;
- guarda del RUC bloqueado;
- inmutabilidad de códigos;
- FK compuesta hacia `member`.

Una prueba comprueba que siguen presentes tras regenerar el esquema con el CLI de Better Auth.

- Ninguna tabla de Better Auth cambia. Todas las FK son `RESTRICT`, y ninguna restricción limita el número de empresas (ADR 0009).
- Índices: los `UNIQUE` cubren las búsquedas por empresa y código; `company_config_version (company_id, version)` cubre el historial.

### D14. Interfaz

Destinos nuevos en el grupo `Configuración` de la barra lateral, solo para `ADMIN`: `Empresa` (`taxpayer.read`), `Ambiente` (`environment.change`) y `Establecimientos` (`establishments.manage`). El ambiente va en su propio destino, como pide `forms-and-workflows.md` para los ajustes de alto riesgo.

Componentes compartidos nuevos, añadidos a la tabla de `frontend.md`:

- `ConfirmDialog`, con nombre escrito opcional.
- `FileField` de un archivo: tipos y límite visibles antes de elegir; nombre, tipo, tamaño y estado de validación; reemplazar y quitar.
- `SegmentedControl`.
- `Select`.

**Inicio: preparación para emitir** (reemplaza la página técnica de marcador)

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador y operador. |
| Objetivo | Saber si la empresa puede emitir y, si no, qué falta. |
| Decisión principal | Qué requisito resolver primero, o a quién pedírselo. |
| Información mínima | Estado general y cada requisito cumplido o pendiente; ambiente. |
| Acción principal | Para el administrador, el enlace al primer requisito pendiente. El operador no tiene acción. |
| Frecuencia y riesgo | Alta al instalar y después ocasional; riesgo bajo, solo lectura. |

- P0: "Lista para emitir" o "Aún no puede emitir", con `StatusBadge`. P1: lista de requisitos con icono y texto, y enlace "Configurar" para el administrador. La firma dice "Disponible próximamente". P2: ambiente vigente. P3: nada.
- Estados: skeleton con la geometría de la lista; error con reintento. El operador ve "Pide a un administrador que complete la configuración".

**Empresa**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador. |
| Objetivo | Registrar o corregir los datos con que la empresa emite. |
| Decisión principal | Qué datos y atributos declarar, sabiendo que cada cambio aplica a los comprobantes futuros. |
| Información mínima | Los campos de D3, si el RUC está bloqueado y el logo vigente. |
| Acción principal | `Guardar datos`. |
| Frecuencia y riesgo | Rara; riesgo alto: un dato erróneo sale en todos los comprobantes siguientes. |

- Página completa con secciones de ancho completo: `Identificación` (RUC, razón social, nombre comercial), `Contacto` (dirección matriz, teléfono, correo), `Atributos tributarios`, `Proveedor del sistema` y `Logo`.
- `Atributos tributarios`:
  - Obligado a llevar contabilidad: `SegmentedControl` `Sí`/`No`, sin preselección (D3).
  - Contribuyente especial y agente de retención: casillas que revelan su número.
  - Gran contribuyente: casilla.
  - Categoría RIMPE: `SelectionCardGroup` `No aplica`/`Emprendedor`/`Negocio popular`.
- `Proveedor del sistema`: RUC proveedor con ayuda: "Solo si un tercero te provee este sistema (Anexo 26). Déjalo vacío si no aplica."
- P0: formulario y `Guardar datos`. P1: estado del RUC (corregible o bloqueado) y "Versión N" junto al título. P2: logo. P3: historial, fuera de la pantalla.
- Se guarda al pulsar `Guardar datos`, con un aviso visible: "Los cambios aplican a los comprobantes que se emitan después." Ante errores se conservan los valores y cada error queda asociado a su campo.
- Ante `409 CONFIG_VERSION_CONFLICT`: "Otro administrador cambió los datos. Recarga para ver la versión vigente", con acción `Recargar`.
- Logo con `FileField`: "PNG o JPEG, hasta 512 KB" según el límite configurado, que la API publica en `GET /taxpayer`. Vista previa. `Reemplazar`, y `Eliminar` con confirmación de un paso: "Los comprobantes ya emitidos conservan su logo". Deshabilitado, con explicación, hasta el primer registro.
- Estados: skeleton; primer registro con el formulario vacío y el texto "Registra los datos con que tu empresa emitirá"; error con reintento; sin permiso.

**Ambiente**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador. |
| Objetivo | Pasar de Pruebas a Producción cuando la empresa está lista, o volver a Pruebas. |
| Decisión principal | Si emitir con validez tributaria desde ahora. |
| Información mínima | Ambiente vigente, qué significa cada uno y la preparación para emitir. |
| Acción principal | `Cambiar a Producción` o `Volver a Pruebas`. |
| Frecuencia y riesgo | Muy rara; riesgo crítico. |

- P0: ambiente vigente con `StatusBadge` y la acción. P1: qué cambia ("En Producción los comprobantes autorizados tienen validez tributaria") y un resumen de la preparación. P2 y P3: nada.
- `ConfirmDialog` de D6. Sin datos registrados, la acción se deshabilita con "Registra primero los datos de la empresa".

**Establecimientos**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador. |
| Objetivo | Mantener los locales y puntos desde los que se emite. |
| Decisión principal | Qué crear, corregir, desactivar o reactivar. |
| Información mínima | Código, dirección, estado y puntos de cada establecimiento. |
| Acción principal | `Crear establecimiento`. |
| Frecuencia y riesgo | Rara; riesgo medio: desactivar es reversible. |

- Lista de establecimientos por código, cada uno con su código como `001`, dirección, `StatusBadge` y sus puntos como `001-002` más la descripción, la disponibilidad y su estado.
- Volumen pequeño (D7): lista agrupada, no `AppDataTable` con paginación. La búsqueda se añade si el volumen lo pide.
- Acciones por establecimiento: `Editar dirección`, `Agregar punto`, `Desactivar` o `Reactivar`. Por punto: `Editar descripción`, `Desactivar` o `Reactivar`. Todas con `RowActionButton` y tooltip.
- Alta y edición con `FormDialog`. El código se pide solo al crear; después aparece como etiqueta.
- Desactivar es de un paso con `Deshacer` en el toast, que reactiva. El toast de un establecimiento con puntos avisa: "Sus puntos de emisión dejarán de estar disponibles".
- P0: lista y `Crear establecimiento`. P1: puntos y disponibilidad. P2: fechas. P3: identificadores, fuera.
- Estados: skeleton; vacío como requisito pendiente: "Crea tu primer establecimiento para poder emitir"; error con reintento; sin permiso; móvil con tarjetas apiladas y objetivos de 44 px.

**Mi cuenta: punto de emisión predeterminado** (sección nueva, ambos roles)

- `Select` de los puntos disponibles, agrupados por establecimiento (`001 · Dirección` / `001-002 · Descripción`), con la opción `Sin predeterminado`, y `Guardar`. Se esperan de cinco a quince opciones (`component-selection.md`); si una instalación necesita más, un cambio posterior lo sustituye por `ComboboxField`.
- Si el predeterminado no está disponible: aviso "Tu punto predeterminado no está disponible; elige otro".
- Sin puntos disponibles: "Aún no hay puntos de emisión disponibles".

**Shell**: aviso de ambiente de D6 en todas las pantallas autenticadas, legible por lectores de pantalla (`role="status"` al cargar, sin interrumpir).

Comunes: toda mutación pasa por `useMutationFeedback`, y `PermissionGate` es solo presentación. Se revisa cada pantalla con `docs/quality/frontend-checklist.md` en los temas claro y oscuro.

### D15. Observabilidad y rendimiento

- Los cambios quedan en la auditoría. Los logs de petición existentes registran la ruta y el estado, nunca el cuerpo, de modo que no se registran datos tributarios ni bytes del logo.
- Las denegaciones ya emiten eventos de seguridad (D12).
- Rendimiento: cada lectura es por clave primaria o única, y el estado de preparación hace tres consultas indexadas. El logo se sirve desde `bytea` acotado por `LOGO_MAX_BYTES`, con `ETag` para revalidar.

### Brief de operaciones sensibles

Responde las 12 preguntas de `backend.md` para todas las mutaciones de este cambio.

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Quién ejecuta | Según D10: configuración, logo, ambiente y establecimientos solo `ADMIN`; el predeterminado propio, ambos roles. |
| 2 | Tenant del llamante | `RequestContext.companyId`, derivado de la sesión y de la membresía activa (`requireContext`). |
| 3 | Tenant del recurso | `company_id` de cada fila; la configuración y el logo son siempre los de la empresa del contexto. |
| 4 | Validación de propiedad | Los repositorios exigen `companyId` y filtran por él; los puntos, además, por establecimiento. Las FK compuestas impiden referencias cruzadas en la base de datos. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No: un ID de otra empresa no se encuentra y responde `404`, con evento de seguridad. `companyId` en el cuerpo se rechaza por el esquema estricto. |
| 6 | Petición repetida | Configuración: estado deseado; si es igual a la vigente, no crea versión ni evento. Altas: la segunda choca con la restricción única (`409`). Estado y predeterminado: `PUT` idempotentes. |
| 7 | Peticiones simultáneas | Configuración: lock advisory por empresa más `expectedVersion`, sin pérdida de escrituras. Altas: restricción única. Ediciones de establecimientos y puntos: último en escribir, auditado. |
| 8 | Idempotencia | Por estado deseado, versión esperada y restricciones únicas; no hace falta `Idempotency-Key`. |
| 9 | Restricciones | `UNIQUE (company_id, version)`, `UNIQUE (company_id, sha256)`, `UNIQUE (company_id, code)`, `UNIQUE (establishment_id, code)`, FK compuestas, `CHECK` de formatos, triggers de solo agregado, guarda del RUC bloqueado e inmutabilidad de códigos. |
| 10 | Auditoría | Sí, según D11, en la misma transacción. El predeterminado propio no se audita (D8). |
| 11 | Pruebas de autorización | Operador `403` en cada mutación y en `GET /taxpayer` y su logo; operador `200` en estado, establecimientos y predeterminado; otra empresa `404` en establecimientos, puntos y predeterminado; `companyId` en el cuerpo rechazado. |
| 12 | Fugas entre cuentas | Ninguna lectura sin `companyId`. El logo se sirve solo desde la configuración de la empresa del contexto, sin URL pública ni identificador de asset en la API. Los errores no distinguen "de otra empresa" de "inexistente". |

## Risks / Trade-offs

- [El número de contribuyente especial se acepta con 3 a 13 caracteres, como en cinco de los seis XSD, pero la retención 2.0.0 solo admite de 3 a 5] → Se registra en el `README.md` de los XSD. `add-withholding-receipts` debe validar antes de construir el XML y bloquear con un mensaje claro. Restringir aquí a 5 rechazaría números válidos para la factura.
- [El agente de retención se modela como número de resolución, contra el booleano de CTX §5] → El XSD oficial prevalece (CTX §1). Se registra C-10 para que la revisión normativa (CTX §53) lo vea.
- [La categoría RIMPE `NEGOCIO_POPULAR` no tiene un texto propio en el XSD] → Se guarda la categoría declarada. Cómo se expresa en el comprobante lo decide Q-38 en `add-invoice-emission`, sin cambiar este modelo.
- [El bloqueo de la identidad no tiene todavía quién lo active en producción] → Las pruebas cubren ambos estados con la operación interna y los triggers. `fiscal-emission.md` y las tareas de `add-invoice-emission` lo deben recoger como obligación explícita.
- [Un cambio de ambiente mientras se emite] → No hay emisión en este cambio. `add-invoice-emission` fija el ambiente en el snapshot al reservar (anotado en `fiscal-emission.md`).
- [La base de datos crece con cada logo distinto] → Límite configurable, deduplicación por empresa y un puerto para migrar a object storage (ADR 0017).
- [Un proxy inverso con un límite de cuerpo menor que `LOGO_MAX_BYTES` responde antes que la API] → `deployment.md` documenta el ajuste del proxy.
- [Un PNG o JPEG con cabecera válida pero cuerpo corrupto pasa la validación] → El RIDE (cambio 8) debe degradar sin logo y registrar el fallo. Decodificar la imagen completa aquí exigiría una dependencia de imágenes que no se justifica.
- [Colisiones de `hashtext` en el lock advisory] → Solo serializan escrituras de dos empresas distintas; no afectan la corrección.
- [Lista de establecimientos sin paginación] → Volúmenes del MVP pequeños (Q-26). El contrato admite añadir paginación después.
- [Dos XSD (guía 1.1.0 y retención 2.0.0) usan CRLF] → `.gitattributes` los trata como binarios, para que su SHA-256 coincida con el manifiesto en cualquier checkout.

## Migration Plan

1. Migración aditiva `add_taxpayer_setup`: solo crea tablas, funciones y triggers; no modifica las existentes ni requiere relleno. La empresa existente queda sin configuración hasta que el administrador la registre, y su preparación muestra los requisitos pendientes.
2. Variable nueva `LOGO_MAX_BYTES`, con valor por defecto; ninguna instalación necesita configurarla.
3. Despliegue normal: `prisma migrate deploy` antes de arrancar la API, como en `deployment.md`.
4. Reversión: volver a la versión anterior de la aplicación deja las tablas nuevas sin uso y sin efecto. Borrarlas solo procede en desarrollo, y la protección de solo agregado obliga a hacerlo con una migración explícita, nunca con `migrate reset` sin consentimiento.

## Trazabilidad de requisitos

| Requisito | Fuente | Decisiones |
| --- | --- | --- |
| Registro de los datos de la empresa | ERS RF-101, AC-01 | D2, D3, D12, D14 |
| Formatos conforme a los esquemas oficiales | ERS RF-104; XSD oficiales; CTX §1.1, §9.1 | D3 |
| Atributos tributarios declarados por el administrador | ERS RF-103; CTX §5, §37.1; Q-37, Q-38 | D3 |
| Historial inmutable de la configuración | ERS RF-105; CTX §39 | D2 |
| Cambios concurrentes de la configuración | `backend.md` (operaciones sensibles) | D2 |
| Corrección del RUC sin bloqueo / RUC inmutable con bloqueo | Q-31 | D4 |
| Carga y reemplazo / eliminación del logo | ERS RF-102; ADR 0017 | D5 |
| Ambiente SRI | ERS RF-004; CTX §5, §6 | D6 |
| Aviso persistente del ambiente | ERS RF-004, RF-005; CTX §6 | D6, D14 |
| Establecimientos y puntos de emisión (cuatro requisitos) | ERS RF-110..112; CTX §5 | D7 |
| Punto de emisión predeterminado propio | ERS RF-113; Q-23 | D8 |
| Permisos de la configuración tributaria | Q-22; `access-control.md` | D10 |
| Aislamiento de la configuración por empresa | ADR 0009 | D7, D8, D12, D13 |
| Preparación para emitir | ERS AC-01 (parcial), BR-03 | D9 |
| Auditoría de los cambios de configuración tributaria | ERS RF-003, RF-105, SEC-007 | D11 |
