# Design

## Context

Ver proposal.md para la motivación. Estado actual que condiciona el diseño:

- **`catalogs` (5a, archivado):**
  - expone `resolveCatalogEntry` sin sesión, como puerto de aplicación;
  - la política de consumidor final y la habilitación por empresa solo se leen con las operaciones del servicio HTTP, que exigen un `RequestContext` y `fiscalCatalogs.read`;
  - design D1 de 5a prometía esas lecturas como puertos de aplicación para este cambio;
  - una prueba de arquitectura impide leer las tablas de catálogos fuera del módulo.
- **Creación de empresas:**
  - la única vía es el aprovisionamiento al arrancar (`identity`), en una unidad de trabajo con una transacción de Prisma y el adapter de Better Auth (`runWithAdapter`);
  - `main.ts` carga los catálogos después del aprovisionamiento;
  - 28 archivos de pruebas crean empresas directamente con `insertCompany`.
- **Arquitectura:** `ARCHITECTURE.md` todavía asigna terceros y productos al módulo `catalogs`, lo que contradice design D1 de 5a.
- **Contratos existentes:**
  - la lista de usuarios tiene su propio esquema de paginación (25 por defecto, 100 como máximo);
  - la política decimal vive en `packages/contracts/src/decimal.ts` (`DECIMAL_SPECS.precioUnitario`: 18 dígitos y 6 decimales, mínimo 0) y en `platform/decimal` (`UnitPrice`);
  - su descripción solo está en el design D10 archivado de 5a.
- **PostgreSQL:** 17 en `compose.yaml` y en CI.

## Goals / Non-Goals

**Goals:**

- Que terceros y productos consuman `fiscal-catalogs` solo por puertos de aplicación, sin SQL cruzado y sin que `catalogs` dependa de ellos.
- Que la existencia del consumidor final de cada empresa sea una garantía de la base de datos, no solo del código que crea empresas.
- Que el estado tributario de un producto se derive siempre de los catálogos vigentes, sin una copia que pueda quedar desactualizada.
- Que la unicidad y la concurrencia descansen en restricciones de la base de datos, con errores de dominio estables.

**Non-Goals:**

- Un motor de reglas tributarias o de cálculo.
- Un combobox con búsqueda: llega con la primera pantalla que lo necesite a escala, como el selector de productos de la factura.
- Ordenar por columnas arbitrarias, o paginar por cursor.

## Decisions

### Brief de operaciones sensibles

Aplica al alta, la corrección y el cambio de estado de terceros y productos.

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Quién ejecuta | Consultar, registrar y corregir: `ADMIN` y `OPERATOR`. Desactivar y reactivar: `ADMIN` (D12). |
| 2 | Tenant del llamante | `RequestContext.companyId`, derivado de la sesión. |
| 3 | Tenant del recurso | `company_id` de cada tercero, producto e impuesto del producto. |
| 4 | Validación de propiedad | Toda lectura y escritura filtra por `company_id` de la sesión. Un recurso de otra empresa responde `404`, igual que uno inexistente. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No. El identificador de la ruta solo se busca dentro de la empresa de la sesión, y un `companyId` en el cuerpo lo rechaza el esquema estricto. En la consulta se ignora, como en usuarios. |
| 6 | Petición repetida | El alta repetida choca con la unicidad cuando hay identificación o código principal (`409`). Un producto sin código principal puede duplicarse, como cualquier alta sin clave natural (riesgo aceptado, ver Riesgos). El estado es un estado deseado; la corrección exige `expectedVersion`. |
| 7 | Peticiones simultáneas | Altas: las restricciones únicas deciden y la perdedora recibe `409`. Correcciones: `UPDATE` condicionado a la versión. Estado: `UPDATE` condicionado al estado anterior. Solo la transición real se audita (D14). |
| 8 | Idempotencia | Por clave natural y por estado deseado; sin `Idempotency-Key`. |
| 9 | Restricciones | Unicidad por empresa, `CHECK`, protección del consumidor final, consumidor final obligatorio por empresa, IVA obligatorio por producto, IRBPNR solo en bienes y claves foráneas a la identidad de las entradas fiscales (D15). |
| 10 | Auditoría | Sí, en la misma transacción (D13). |
| 11 | Pruebas de autorización | El operador recibe `403` al cambiar el estado. Con dos empresas: lectura, corrección y estado cruzados dan `404`, la búsqueda y los recuentos no muestran datos de la otra, y un `companyId` en el cuerpo da `400`. |
| 12 | Fugas | El `409` de unicidad nombra solo el tercero o producto de la propia empresa. Los recuentos son por empresa. La auditoría guarda la identificación y la razón social, nunca los valores de contacto. |

### D1. Módulos, propiedad y dependencias

- **Propiedad:**
  - `catalogs`: conocimiento fiscal normativo, resolución de vigencia, habilitación y los puertos internos de D2;
  - `parties`: terceros y el consumidor final;
  - `products`: productos y servicios, su precio y sus referencias fiscales.
- **Dependencias:**
  - `parties` usa los puertos de `catalogs` (reglas de identificación y política de consumidor final);
  - `products` usa los puertos de `catalogs` (disponibilidad de entradas);
  - ambos usan `identity` (`Authorizer`) y `audit`;
  - `catalogs` no importa `parties` ni `products`, y `parties` y `products` no se importan entre sí;
  - `identity` no importa `parties`: el consumidor final se crea mediante un iniciador que registra la raíz de composición (D5).
- **Estructura:** dos módulos nuevos en `backend/src/modules/`, con dominio, aplicación e infraestructura como `taxpayer`.
- **Pruebas de arquitectura:**
  - la frontera de tablas de `catalogs` se mantiene, y se añade la equivalente para las tablas de `parties` y de `products`;
  - una prueba de importaciones impide que `catalogs` importe `parties` o `products`, y que estos se importen entre sí.
- **`ARCHITECTURE.md`:** se corrige la fila de `catalogs` y se añaden `parties` y `products`.

### D2. Puertos internos de `fiscal-catalogs`

`catalogs` expone, desde su infraestructura, `fiscalCatalogQueries`: operaciones de aplicación sin
HTTP y sin sesión. Quien llama autoriza su propia operación y aporta la empresa de su contexto.

- **`consumerFinalPolicy(date)`:** la versión aplicable de la política en esa fecha, resuelta con la regla única de D5 de 5a, o ninguna.
- **`resolveCatalogEntry(catalogType, entryKey, date)`:** el puerto existente.
- **`identificationRule(code, date)`:** la versión aplicable del tipo de identificación, con su patrón, su descripción y `reservedFor`, o ninguna.
- **`availability(companyId, catalogType, date)`:** devuelve, por `entryKey`:
  - el código;
  - la versión aplicable (identificador, denominación y semántica de la tarifa), o ninguna;
  - si la última versión está retirada;
  - la habilitación efectiva (`effectiveEnablement`) y si es utilizable (`isUsable`);
  - `calculationData`, que vale `COMPLETE` o `MISSING`.
- **`calculationDataStatus(version)`:** función pura del dominio de `catalogs`. Hoy:
  - es `COMPLETE` para `PERCENTAGE` con porcentaje, `NOT_SUBJECT` y `EXEMPT`;
  - es `MISSING` para `DIFFERENTIATED`, `PER_NORMATIVE` (ICE) y `PER_UNIT` (IRBPNR), porque el catálogo no publica sus valores.
  - Cuando un dataset posterior traiga esos valores con su fuente, la función lo reflejará sin tocar `products`.
- **Implementación:** reutiliza el lector y el repositorio de decisiones existentes. La disponibilidad se pide por catálogo completo (como mucho 75 entradas), así que los listados no hacen N+1.
- **Alternativa descartada:** llamar al servicio HTTP con el contexto del usuario. Acopla la lectura interna a un permiso de pantalla y no sirve sin sesión, por ejemplo al arrancar.

### D3. Modelo de tercero

- **Campos:**
  - tipo de identificación (dos dígitos) e identificación (1 a 20 caracteres sin saltos de línea);
  - razón social o nombres (1 a 300);
  - dirección (hasta 300), correo (hasta 300, con formato de correo) y teléfono (hasta 50, sin saltos de línea), todos opcionales;
  - roles como conjunto de `CUSTOMER`, `SUPPLIER` y `CARRIER`, que puede estar vacío;
  - estado `ACTIVE` o `INACTIVE`;
  - `systemRecord`, que es `CONSUMER_FINAL` o nulo;
  - versión, y fechas y autores de creación y modificación.
- **Normalización:** los textos pasan a NFC y se recortan, como en `taxpayer`. Los roles se guardan sin duplicados y en orden canónico.
- **Sin rol:** un tercero sin roles existe y no aparece al filtrar por un rol. Ningún rol es obligatorio.
- **Vista:** el tipo con su denominación oficial (resuelta con D2), la identificación, los datos, los roles, el estado, `systemRecord` y la versión.

### D4. Identificación

- **Validación:** `identificationRule(tipo, hoy en Ecuador)`.
  - Sin versión aplicable: `400 PARTY_IDENTIFICATION_TYPE_UNAVAILABLE`.
  - Con `reservedFor`, es decir el `07`: `400 PARTY_IDENTIFICATION_RESERVED`.
  - Si no cumple el patrón: `400 PARTY_IDENTIFICATION_INVALID`, con la descripción de la regla. El sobre de error no lleva campos; el frontend lo asocia a la identificación por su código.
- **Sin dígito verificador:** no hay algoritmo de dígito verificador (ERS RF-322, CTX §9.1).
- **Unicidad:** comparación exacta, después de NFC y del recorte; no se pliegan mayúsculas (D14).
- **En la base de datos:** solo se comprueba la forma del tipo (`^[0-9]{2}$`). Los tipos válidos son dato del catálogo, y un `CHECK` con la lista bloquearía una versión futura del dataset.

### D5. Consumidor final y su ciclo de vida

**Identidad.** Tipo `07`, identificación `9999999999999` y la razón social canónica de la versión
de la política aplicable el día de su creación en Ecuador. El rol es cliente, y el estado,
`ACTIVE`. No guarda el monto máximo.

**Creación:**

- **A. Empresas existentes al desplegar:**
  - `main.ts` ejecuta `ensureConsumerFinalParties()` después de cargar los catálogos y antes de escuchar;
  - es idempotente y segura ante arranques simultáneos: `INSERT … ON CONFLICT DO NOTHING` sobre la unicidad de identificación;
  - al terminar, comprueba que toda empresa tiene uno, y si alguna no lo tiene, el arranque falla con un error fatal.
  - **Alternativa descartada:** el backfill en SQL dentro de la migración. Duplicaría la regla de vigencia de la política fuera de `resolveCatalogEntry`, y en una instalación que salta de una versión anterior a 5a la política todavía no está cargada al migrar.
- **B. Empresa creada con el sistema en marcha** (hoy, el aprovisionamiento):
  - la unidad de trabajo de `identity` acepta iniciadores de empresa (`CompanyInitializer`, un puerto de `identity`);
  - `TransactionScope.initializeCompany(companyId)` los ejecuta con el cliente de la transacción, justo después de `createCompany`;
  - la raíz de composición registra el iniciador de `parties`;
  - el iniciador resuelve la identidad con la política vigente, leída con el cliente principal porque es un dato inmutable del sistema. Sin política aplicable falla de forma explícita, y la transacción del aprovisionamiento se revierte entera sin crear nada;
  - toda vía futura de creación de empresas usará la misma unidad de trabajo.
- **C. Reparación:** el mismo `ensureConsumerFinalParties()` del caso A, en cada arranque. No es la única garantía.
- **Orden de arranque:** cargar catálogos → aprovisionar → reponer consumidores finales → escuchar. Cargar los catálogos no depende de ninguna empresa.

**Garantías de la base de datos:**

- **Coherencia del registro del sistema:**
  - un tercero con `system_record` tiene el tipo `07`, la identificación `9999999999999`, el rol cliente y el estado `ACTIVE`;
  - un tercero sin `system_record` no puede tener el tipo `07` (`CHECK`).
- **Como mucho uno por empresa:** lo garantiza la unicidad por empresa, tipo e identificación, porque el `07` está reservado.
- **Inmutable:** un trigger rechaza `UPDATE` y `DELETE` de un registro del sistema, y que un tercero cambie su `system_record`.
- **Obligatorio:** un trigger de restricción diferido (`AFTER INSERT ON organization`, `DEFERRABLE INITIALLY DEFERRED`) rechaza al confirmar una empresa sin consumidor final.
  - Las empresas existentes no se comprueban al migrar; las cubre el caso A antes de atender peticiones.
  - `insertCompany` de las pruebas pasa a crear también el consumidor final.

**Reconocimiento:**

- el dominio y la API lo reconocen por `systemRecord: "CONSUMER_FINAL"`, nunca por el texto ni por la identificación;
- corregirlo o cambiar su estado responde `409 PARTY_SYSTEM_RECORD` antes de llegar a la base de datos;
- aparece en las búsquedas, activo y marcado como registro del sistema.

**Auditoría:** no se audita, porque es un dato del sistema creado con la empresa; el aprovisionamiento ya registra `company.provisioned`.

**Si la política cambia:** una versión posterior con otra identidad canónica no actualiza el tercero, porque el trigger lo impide, y este diseño no la migra en silencio. Será un cambio explícito de datos y de invariante; el tipo y la identificación los fija ya la política de 5a.

**Pruebas explícitas.** Cada una termina con la invariante intacta: exactamente un consumidor final por empresa, con su identidad.

- **A. Empresa nueva:** el aprovisionamiento crea la empresa y su consumidor final antes de confirmar, y un fallo después de `createCompany` no deja ninguno de los dos.
- **B. Empresa existente sin consumidor final:** la reposición al arrancar crea exactamente uno.
- **C. Segundo arranque:** no crea duplicados ni modifica el existente.
- **Concurrencia y protecciones:**
  - dos aprovisionamientos simultáneos;
  - alta de un tercero normal con el tipo `07`;
  - corregir, desactivar y borrar el consumidor final.

### D6. Modelo de producto

- **Campos:**
  - código principal y código auxiliar, opcionales (1 a 25, sin saltos de línea);
  - nombre (1 a 300), que será la `descripcion` del XML;
  - descripción interna opcional (hasta 1000), que no va al XML;
  - tipo `GOOD` o `SERVICE`;
  - precio unitario (D9);
  - `stockTracked` (identificador del glosario), solo en bienes;
  - estado, versión, y fechas y autores de creación y modificación.
- **Normalización:** como en terceros.
- **Control de stock:** `stockTracked` es solo un dato. No genera existencias, movimientos ni bloqueos (ADR 0006); el comportamiento es del cambio 9.
- **Coherencia del tipo:** cada alta y cada corrección validan el estado final que resulta de la solicitud, no solo los campos que cambian.
  - Un servicio no lleva `stockTracked` ni IRBPNR.
  - Pasar a `SERVICE` un bien que conserva su IRBPNR o su `stockTracked` responde `400 PRODUCT_GOODS_ONLY`, indicando qué quitar.
  - La misma solicitud puede pasar a `SERVICE`, dejar el IRBPNR vacío y desactivar el control de stock: el estado final es válido.
  - Lo respaldan un `CHECK` sobre el control de stock y un trigger de restricción diferido sobre el IRBPNR. El trigger es diferido para que el resultado no dependa del orden de las sentencias dentro de la transacción.

### D7. Referencias a IVA, ICE e IRBPNR

- **Contrato:** `taxes: { iva: entryKey, ice: entryKey | null, irbpnr: entryKey | null }`, estricto.
  - La forma del objeto fija las cantidades: un IVA obligatorio, y como mucho un ICE y un IRBPNR.
  - Un porcentaje, una denominación, un arreglo o campos desconocidos se rechazan.
  - El catálogo lo determina la posición: `iva-rate`, `ice-rate` o `irbpnr-rate`.
- **Almacenamiento:** una fila por impuesto en `product_tax` (`catalog_type`, `entry_key`), con clave foránea a la identidad de la entrada (`fiscal_catalog_key`). El producto nunca copia una tarifa, una denominación ni un porcentaje.
- **Validación al asignar o cambiar:** solo se validan las referencias nuevas o distintas de la guardada, con `availability(empresa, catálogo, hoy en Ecuador)`. Las razones de rechazo son:
  - `NOT_FOUND`: la entrada no existe;
  - `NOT_IN_FORCE`: no tiene versión aplicable;
  - `DISABLED`: no es utilizable para la empresa.

  Cada una responde `400 PRODUCT_TAX_UNAVAILABLE`, con el impuesto y la razón. Las referencias que no cambian no se validan otra vez, para que corregir el precio de un producto en revisión sea posible.
- **IRBPNR:** solo en bienes; un servicio con IRBPNR responde `400 PRODUCT_GOODS_ONLY`, el mismo código que el control de stock en un servicio, con un mensaje que dice qué quitar. Al corregir, se evalúa sobre el estado final, junto con las demás invariantes del tipo (D6); la disponibilidad de una referencia que no cambia no se vuelve a validar.
- **Respaldo en la base de datos:**
  - clave primaria `(product_id, catalog_type)`: como mucho una por impuesto;
  - `CHECK` de los tres catálogos;
  - clave foránea a `fiscal_catalog_key`;
  - un trigger de restricción diferido exige exactamente un IVA por producto al confirmar;
  - un trigger de restricción diferido rechaza, al confirmar, el IRBPNR en un servicio.
- **Vista:** por impuesto se muestran el catálogo, `entryKey`, el código, la denominación y la semántica de la tarifa de la versión aplicable hoy (o de la última, si no hay aplicable), y su disponibilidad.

### D8. Estado derivado de la configuración tributaria

- **Cálculo:** `taxConfiguration = { status, reasons[], evaluatedOn }`, con `availability` en la fecha de hoy en Ecuador.
  - `REVIEW_REQUIRED` si una referencia no tiene versión aplicable (`NOT_IN_FORCE`), su última versión está retirada (`WITHDRAWN`) o no es utilizable para la empresa (`DISABLED`).
  - Si no, `INCOMPLETE` si alguna tiene `calculationData: MISSING` (motivo `NO_CALCULATION_DATA`). Hoy pasa con ICE sin tarifa legal, IRBPNR sin valor legal e IVA diferenciado sin política de cálculo. No impide guardar el producto.
  - Si no, `READY`.
- **Nunca se guarda:** no hay columna `needsTaxReview`. Cada consulta lo vuelve a calcular, y nada cambia las referencias.
- **Filtro y recuentos sin SQL cruzado:**
  - `products` pide `availability` de los tres catálogos (como mucho 85 entradas) y construye los conjuntos de claves no utilizables y sin datos de cálculo;
  - la consulta filtra con `EXISTS` sobre `product_tax`, usando esas claves como parámetros.
  - Así se resuelven el filtro `taxStatus` y `GET /products/tax-summary`.
- **Emisión:** el estado mostrado es orientativo. `add-invoice-emission` volverá a resolver cada referencia con la fecha del documento, y un comprobante no podrá continuar si necesita calcular un impuesto cuya referencia esté en `INCOMPLETE` en esa fecha. La obligación se registra en `fiscal-emission.md`.
- **Alternativa descartada:** un booleano persistido que un job recalcula. Queda obsoleto entre ejecuciones, duplica la regla de vigencia y no sirve para otra fecha.

### D9. Precio y política decimal

- **Contrato:** `unitPrice` es `decimalString(DECIMAL_SPECS.precioUnitario)`: cadena exacta y no negativa.
  - Regla del XSD (`totalDigits` 18, `fractionDigits` 6): como máximo 18 dígitos en total y como máximo 6 de ellos decimales; nunca 18 enteros más 6 decimales (24 dígitos). La parte entera puede tener hasta 18 dígitos cuando no hay decimales.
  - La especificación lo declara con `maxIntegerDigits: 18`, y `decimalSpecViolation` comprueba también el total. Las demás especificaciones conservan su máximo de enteros (dígitos totales menos decimales), así que su comportamiento no cambia.
  - Los decimales se cuentan como se escriben: `1.1234560` tiene 7 y se rechaza, sin redondear.
  - Casos límite fijados en contrato y pruebas:
    - se aceptan `0`, `0.000001`, `999999999999999999` y `999999999999.999999`;
    - se rechazan `1000000000000000000`, `1234567890123.123456`, `0.0000001`, `1.1234560`, `-1`, el número JSON `12.5` y `1e3`, con el mensaje de su límite.
  - El dominio, no el typmod de PostgreSQL, es la fuente de verdad: valores que un `NUMERIC` aceptaría, como `1000000000000000000` o `0.1234567`, se rechazan.
  - Un número JSON se rechaza.
  - Más decimales de los admitidos es un error, sin redondeo.
  - Se devuelve en la forma canónica más corta.
- **Backend y base de datos:**
  - El dominio usa `UnitPrice` de `platform/decimal`.
  - La columna es `NUMERIC` sin precisión ni escala, que guarda exactamente el valor recibido y no redondea.
  - Un `CHECK` de dominio garantiza la regla: `unit_price >= 0`, `scale(unit_price) <= 6` y `unit_price < 10^(18 - scale(unit_price))`, es decir, 18 dígitos en total como máximo.
  - El repositorio guarda la forma canónica más corta, así la escala guardada es la del valor. La conversión con Prisma es por texto.
  - Se descartó `NUMERIC(18,6)`: limita la parte entera a 12 dígitos. También se descartó `NUMERIC(24,6)`: admitiría 18 enteros más 6 decimales y redondearía en silencio un séptimo decimal.
- **Sin impuestos:** el precio no incluye impuestos, y este cambio no calcula ninguno.
- **Frontend:**
  - entrada con `inputMode="decimal"` que se envía como texto, validada con la misma especificación;
  - visualización con `formatDecimal`, sin `number` y sin redondear.
- **Documento vigente:** se crea `docs/architecture/decimal-policy.md` con el resumen vigente de la política (D10 de 5a), y `database.md` y `fiscal-emission.md` remiten a él.

### D10. Búsqueda y paginación

- **Contrato común** (`packages/contracts/src/pagination.ts`):
  - `searchParam`: recortado, hasta 100 caracteres;
  - `pageParams`: `page` desde 1 y por defecto 1; `pageSize` de 1 a 100 y por defecto 25, con coerción desde la consulta;
  - `sortDirection`;
  - `listMetaSchema`: `{ page, pageSize, total }`.
  - `users.ts` no cambia.
- **Claves de búsqueda:** las calcula la aplicación al escribir, con una función compartida: NFD, sin marcas diacríticas, en minúsculas y con los espacios colapsados.
  - Terceros: `search_name` y `search_identification`.
  - Productos: `search_name`, `search_main_code` y `search_auxiliary_code`.
  - El texto buscado pasa por la misma función, y los comodines de `LIKE` se escapan.
- **Coincidencia:**
  - terceros: la identificación empieza por el texto, o la razón social lo contiene;
  - productos: el código principal o el auxiliar empiezan por el texto, o el nombre lo contiene.
- **Filtros:**
  - terceros: estado (`ACTIVE` por defecto, `INACTIVE` o `ALL`) y rol;
  - productos: estado, tipo y `taxStatus`.
- **Orden estable:**
  - `sort` admite una lista cerrada: en terceros `name` o `identification`, y en productos `name` o `mainCode`, con los nulos al final;
  - la dirección es ascendente por defecto;
  - el desempate final siempre es `id`.
- **Paginación:** por desplazamiento (`OFFSET`) con `COUNT` sobre el mismo filtro. Una página más allá de la última devuelve una lista vacía con el total.
- **Índices:**
  - las claves de búsqueda por prefijo tienen colación `C`, y su índice btree `(company_id, clave)` resuelve `LIKE 'prefijo%'` como una condición de rango, con cualquier colación de la base. Se descartó `text_pattern_ops`: Prisma 7 lo acepta en el esquema, pero no lo conserva al comparar la base con el esquema, y cada migración futura lo borraría y lo volvería a crear;
  - btree `(company_id, status, search_name, id)` para el orden;
  - el fragmento de nombre recorre las filas de la empresa; sin `pg_trgm` salvo que el benchmark lo exija (D16).

### D11. API

Todo bajo `/api/v1` (ADR 0015), con contratos en `packages/contracts` y OpenAPI regenerado. Las
consultas no son estrictas (un `companyId` se ignora); los cuerpos sí lo son.

| Ruta | Permiso | Notas |
| --- | --- | --- |
| `GET /parties` | `parties.read` | `search`, `status`, `role`, `sort`, `direction`, `page`, `pageSize`; `{ data, meta }`. |
| `POST /parties` | `parties.manage` | `201`. Errores: `409 PARTY_IDENTIFICATION_TAKEN`, `400 PARTY_IDENTIFICATION_INVALID`, `400 PARTY_IDENTIFICATION_RESERVED` y `400 PARTY_IDENTIFICATION_TYPE_UNAVAILABLE`. |
| `GET /parties/{partyId}` | `parties.read` | `404 PARTY_NOT_FOUND` fuera de la empresa. |
| `PUT /parties/{partyId}` | `parties.manage` | Con `expectedVersion`. Errores: `409 PARTY_CHANGED`, `409 PARTY_SYSTEM_RECORD` y `409 PARTY_IDENTIFICATION_TAKEN`. |
| `PUT /parties/{partyId}/status` | `parties.changeStatus` | Estado deseado; `409 PARTY_SYSTEM_RECORD`. |
| `GET /products` | `products.read` | `search`, `status`, `kind`, `taxStatus`, `sort`, `direction`, `page`, `pageSize`; `{ data, meta }`. |
| `POST /products` | `products.manage` | `201`. Errores: `409 PRODUCT_MAIN_CODE_TAKEN`, `400 PRODUCT_TAX_UNAVAILABLE` y `400 PRODUCT_GOODS_ONLY` (servicio con IRBPNR o con control de stock). |
| `GET /products/{productId}` | `products.read` | `404 PRODUCT_NOT_FOUND` fuera de la empresa. |
| `PUT /products/{productId}` | `products.manage` | Con `expectedVersion`; `409 PRODUCT_CHANGED` y los errores del alta. |
| `PUT /products/{productId}/status` | `products.changeStatus` | Estado deseado. |
| `GET /products/tax-summary` | `products.read` | Fecha de evaluación, recuento de productos activos por estado tributario, y productos activos por entrada (`catalogType`, `entryKey`). |

Las opciones de impuestos del formulario salen de `GET /fiscal-catalogs/{type}/entries`, filtradas
por `usable`. No hace falta una ruta nueva.

### D12. Permisos

Se añaden al mapa central y a su espejo en el frontend:

- `parties.read`, `parties.manage` y `parties.changeStatus`;
- `products.read`, `products.manage` y `products.changeStatus`.

`ADMIN` tiene todos. `OPERATOR` tiene `*.read` y `*.manage`, y no tiene `*.changeStatus`. Se
confirman las filas propuestas en `access-control.md` ("Crear y editar terceros y productos" y
"Desactivar terceros y productos"). Nadie corrige ni cambia el estado del consumidor final (D5).

### D13. Auditoría

Las acciones nuevas se escriben en la misma transacción que el cambio:

| Acción | Cuándo | `changes` |
| --- | --- | --- |
| `party.created` | Alta | Tipo e identificación, razón social y roles. |
| `party.updated` | Corrección que cambia algo | `*.from` y `*.to` de tipo, identificación, razón social y roles. `changedFields`, con los nombres de los campos de contacto cambiados (`address`, `email` y `phone`), nunca sus valores anteriores ni nuevos. |
| `party.deactivated`, `party.reactivated` | Transición real | Tipo e identificación. |
| `product.created` | Alta | Códigos, nombre, tipo, precio e impuestos (catálogo y `entryKey`). |
| `product.updated` | Solo si cambian el precio o algún impuesto | `unitPrice.from`/`unitPrice.to` y `taxes.<impuesto>.from`/`.to`. |
| `product.deactivated`, `product.reactivated` | Transición real | Código principal y nombre. |

No se auditan las lecturas, las búsquedas, las correcciones solo descriptivas de un producto, las
correcciones sin cambios ni la creación del consumidor final.

### D14. Unicidad y concurrencia

- **Reglas de unicidad:**
  - **Tercero:** `UNIQUE (company_id, identification_type, identification)`, que incluye los desactivados y, por el `07` reservado, limita a uno el consumidor final.
  - **Producto:** `UNIQUE (company_id, main_code)`. PostgreSQL trata los nulos como distintos, así que los productos sin código no chocan.
  - **Impuesto del producto:** clave primaria `(product_id, catalog_type)`.
  - Las comparaciones son exactas, después de NFC y del recorte.
- **La base de datos decide:** no hay "comprobar y luego insertar" como garantía. La violación (`P2002` o `23505`) se traduce, en el repositorio, a un error de dominio:
  - `409 PARTY_IDENTIFICATION_TAKEN`, con el identificador y la razón social del tercero existente de la misma empresa;
  - `409 PRODUCT_MAIN_CODE_TAKEN`.
- **Correcciones:** `UPDATE … WHERE id = $id AND company_id = $empresa AND version = $esperada`.
  - Si no actualiza nada y el registro existe: `409 *_CHANGED`. Si no existe en la empresa: `404`.
  - Las filas de impuestos se reemplazan en la misma transacción.
- **Estado:** `UPDATE … SET status = $deseado, version = version + 1 WHERE … AND status <> $deseado`. Solo si actualiza una fila se audita, así que dos desactivaciones simultáneas producen un evento.
- **Consumidor final:** ver D5. El aprovisionamiento ya está serializado por su advisory lock, y la reposición usa `ON CONFLICT DO NOTHING`.
- **Pruebas:** `Promise.all` de dos altas con la misma identificación o código, de dos correcciones con la misma versión y de dos desactivaciones; en cada caso, un resultado, el `409` estable y un solo evento.

### D15. Tablas y migración

La migración `add_parties_and_products` crea las tablas, y una segunda migración, que llega con el iniciador de empresa, añade el consumidor final obligatorio por empresa (así cada grupo de tareas queda verificable con toda la suite). Entre las dos crean:

- **`party`:**
  - columnas de D3, más `search_name`, `search_identification`, `created_by` y `updated_by` (nulos en el registro del sistema);
  - `CHECK` de longitudes, sin saltos de línea, tipo `^[0-9]{2}$`, estado, roles incluidos en los tres valores y coherencia del registro del sistema (D5);
  - `UNIQUE` de D14;
  - índices de D10;
  - trigger de inmutabilidad del registro del sistema.
- **`product`:**
  - columnas de D6, más las claves de búsqueda;
  - `unit_price NUMERIC` sin escala fija, con el `CHECK` de dominio de D9 (no negativo, como máximo 6 decimales y 18 dígitos en total). Lo fija una tercera migración, `unit_price_domain`, porque las dos anteriores ya estaban aplicadas;
  - `CHECK (NOT stock_tracked OR kind = 'GOOD')`, longitudes y estado;
  - `UNIQUE (company_id, main_code)` y `UNIQUE (id, company_id)`, este último para la clave foránea compuesta;
  - índices de D10.
- **`product_tax`:**
  - `(product_id, company_id, catalog_type, entry_key)`;
  - clave foránea `(product_id, company_id)` al producto y `(catalog_type, entry_key)` a `fiscal_catalog_key`;
  - `CHECK` de los tres catálogos;
  - índice `(company_id, catalog_type, entry_key)` para los recuentos.
- **Triggers de restricción diferidos:**
  - consumidor final obligatorio por empresa (sobre `organization`);
  - IVA obligatorio por producto (sobre `product` y `product_tax`).
- **Trigger de restricción diferido de IRBPNR solo en bienes** (sobre `product_tax`, y sobre `product` al cambiar el tipo).
- **Datos:** las tablas empiezan vacías. Los consumidores finales los crea el arranque (D5). Revertir la versión deja las tablas sin uso.

`database.md` documenta las tablas, su propietario y que los triggers sobre `organization` y las
claves foráneas a `fiscal_catalog_key` son objetos de `parties` y `products`. `migrations.test.ts`
fija las restricciones, los índices y los triggers.

### D16. Benchmark de búsqueda (Q-26)

- **Volumen de referencia:** 10 000 terceros y 10 000 productos en una sola empresa objetivo. Q-26 pasa a parcial: el volumen de comprobantes y de usuarios concurrentes sigue pendiente para la emisión.
- **Objetivo:** P95 de 300 ms o menos por petición, en el entorno registrado. No es una garantía independiente del hardware.
- **Ejecución:** `corepack pnpm --filter @facturador/backend bench:search`, como gate dedicado.
  - Queda fuera de `verify` y de las pruebas de Vitest.
  - Necesita una base PostgreSQL 17 dedicada y sin carga ajena, por ejemplo el servicio de `compose.yaml`.
- **Procedimiento:**
  1. Crea un esquema aislado con las migraciones y arranca `main.ts` sobre él.
  2. Siembra un dataset determinista (generador con semilla fija, nombres con tildes, identificaciones y códigos con prefijos repetidos, y una parte desactivada) e inicia sesión.
  3. Calienta con 30 peticiones por consulta y mide 300 peticiones secuenciales por consulta desde el cliente HTTP.
  4. Calcula P50, P95 por rango más cercano y el máximo.
- **Consultas representativas:**
  - terceros: prefijo de identificación, fragmento de nombre, primera página sin búsqueda, última página y filtro por rol;
  - productos: prefijo de código principal, prefijo de código auxiliar, fragmento de nombre, última página y filtro `taxStatus=REVIEW_REQUIRED`;
  - además, `GET /products/tax-summary`.
- **Entorno registrado:**
  - `SELECT version()`;
  - `shared_buffers`, `work_mem`, `effective_cache_size` y `jit`;
  - Node.js, sistema operativo, CPU y núcleos, memoria y commit.
- **Resultado:** se escribe en `docs/quality/benchmarks/` con el JSON de mediciones y una tabla legible.
- **En CI normal:**
  - comportamiento de búsqueda y paginación;
  - índices esperados en `migrations.test.ts`;
  - planes de consulta con `EXPLAIN`, sobre datos sembrados y analizados, para comprobar que las búsquedas por prefijo usan su índice con una condición de rango.
- **Si no se cumple el objetivo:**
  1. se analizan los planes de consulta y se identifica la causa;
  2. si hace falta cambiar índices o la estrategia, o añadir `pg_trgm`, se propone con `/opsx:update` antes de incorporarlo.
  - Nunca se sube el umbral para hacer pasar el benchmark, y `pg_trgm` no se añade de forma preventiva.

### D17. Interfaz

**Navegación:** grupo principal nuevo "Operación", con `Terceros` (`/terceros`, `parties.read`) y
`Productos` (`/productos`, `products.read`).

**Brief de `Terceros`:**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador y operador. |
| Objetivo | Encontrar o registrar a quien se le vende, compra o encarga un traslado, con su identificación correcta. |
| Decisión principal | ¿Ya existe este tercero o lo registro? |
| Información mínima | Identificación con su tipo, razón social, roles y estado. |
| Acción principal | `Nuevo tercero`. |
| Frecuencia y riesgo | Diaria; riesgo medio: una identificación errónea llegará a los comprobantes. |

- **P0:** búsqueda y tabla (identificación, razón social, roles, estado) con `AppDataTable` y paginación de servidor; `Nuevo tercero`.
- **P1:** filtros de estado y rol con `ChipGroup`; corregir en `FormDialog`, con la regla del tipo como ayuda y los roles como chips de selección múltiple.
- **P2:** dirección, correo y teléfono en el detalle.
- **P3:** historial; queda fuera.
- **Comportamiento:**
  - el consumidor final aparece con la marca "Del sistema" y sin acciones;
  - desactivar o reactivar es solo para el administrador, con deshacer desde el toast en lugar de un diálogo;
  - el `409` de identificación repetida ofrece abrir el tercero existente.

**Brief de `Productos`:**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador y operador. |
| Objetivo | Tener los ítems que se venden con su precio sin impuestos y sus impuestos correctos. |
| Decisión principal | ¿Este producto está listo para facturar, o qué hay que corregir? |
| Información mínima | Código, nombre, tipo, precio unitario, IVA y estado tributario. |
| Acción principal | `Nuevo producto`. |
| Frecuencia y riesgo | Frecuente; riesgo medio: un impuesto equivocado llegará a los comprobantes. |

- **P0:** búsqueda y tabla (código, nombre, tipo, precio, IVA y estado tributario con `StatusBadge`: "Listo", "Revisar impuestos" o "Incompleto"); `Nuevo producto`.
- **P1:**
  - filtros con recuentos por estado tributario (de `tax-summary`), estado y tipo;
  - formulario en `FormDialog`:
    - tipo con `SegmentedControl`;
    - precio con `inputMode="decimal"`;
    - IVA con `Select` de las tarifas utilizables;
    - ICE con `Select` de los códigos utilizables, con la variante visible;
    - IRBPNR, que solo se ofrece en bienes;
    - control de stock como casilla, solo en bienes.
- **P2:** los motivos del estado tributario, con un enlace a `Catálogos fiscales` para el administrador.
- **P3:** historial; queda fuera.

**Cambios en `Catálogos fiscales`:**

- cada entrada en uso muestra "Usada por N productos activos";
- el encabezado muestra "N productos necesitan revisión", con enlace a `Productos` filtrado;
- deshabilitar una entrada en uso abre un `ConfirmDialog` que nombra la entrada y la consecuencia;
- el `Switch` solo cambia al confirmar;
- los recuentos salen de `GET /products/tax-summary`, compuestos en el frontend: el backend de `catalogs` no consulta productos.

**Estado en la URL:** búsqueda, filtros y página, como pide `data-tables.md`.

**Revisión:** carga, vacío, error, sin permiso, éxito, móvil a 375 y 320 px con objetivos de 44 px, teclado, temas claro y oscuro, barrido a 640, 768, 1024 y 1440 px y `frontend-checklist.md`, registrada en `ui-review.md`.

### D18. Pruebas

- **Unitarias:**
  - claves de búsqueda;
  - normalización de roles;
  - estado tributario derivado con cada motivo y su precedencia;
  - `calculationDataStatus`;
  - validación de identificación con las reglas del catálogo;
  - contrato de precio con los casos límite de D9;
  - invariantes del tipo sobre el estado final (D6).
- **Contratos:** cuerpos estrictos, `companyId` rechazado, precio como texto, `taxes` con su forma, y paginación con sus límites.
- **Integración de esquema:**
  - cada `CHECK`, unicidad y trigger;
  - el consumidor final obligatorio con un rollback;
  - el IVA obligatorio al confirmar y el IRBPNR en servicios.
- **HTTP con dos empresas:** cada escenario de las specs de `parties`, `products` y `audit-trail`, incluidos los concurrentes.
- **Arranque:**
  - los caminos A, B y C del consumidor final, y sus pruebas de concurrencia y protección (D5);
  - el arranque falla si queda una empresa sin consumidor final.
- **Arquitectura:** las fronteras de tablas e importaciones de D1.
- **End-to-end contra `main.ts`:**
  1. el arranque crea el consumidor final;
  2. el operador registra un tercero y un producto con IVA;
  3. el administrador deshabilita la tarifa y el producto pasa a revisión;
  4. el operador no desactiva;
  5. la auditoría tiene exactamente los eventos esperados;
  6. un segundo arranque no duplica el consumidor final.
- **Interfaz:** pruebas de componentes y recorrido contra el backend real.
- **Rendimiento:** el benchmark dedicado de D16, fuera de `verify`.

### D19. Documentación

Se actualizan:

- `ARCHITECTURE.md` (D1);
- `database.md` (D15) y el nuevo `decimal-policy.md` (D9);
- `domain-model.md`: tercero sin rol obligatorio, consumidor final por `systemRecord`, estado tributario derivado y referencias por `entryKey`;
- `glossary.md`: estado de la configuración tributaria, roles y `stockTracked`;
- `access-control.md` (D12);
- `fiscal-emission.md`: las obligaciones de D8, el consumidor final por `systemRecord` y el límite aplicado en la emisión;
- `capabilities.md` y `open-questions.md` (Q-26 parcial);
- `frontend.md`: el contrato de paginación.

## Risks / Trade-offs

- [El trigger diferido sobre `organization` es de `parties` y vive en otra tabla de otro módulo] → Se documenta en `database.md` como objeto de `parties`, y `migrations.test.ts` lo fija. La alternativa, confiar solo en el código que crea empresas, no da la garantía pedida.
- [Las 28 pruebas que usan `insertCompany` necesitan el consumidor final] → El helper lo crea con la identidad canónica; un solo cambio, verificado con toda la suite.
- [Productos sin código principal duplicables por un doble envío] → La interfaz deshabilita el envío mientras guarda (`FormDialog`); una clave de idempotencia sería desproporcionada para un catálogo que se corrige y se desactiva sin pérdida.
- [El fragmento de nombre recorre las filas de la empresa] → Con 10 000 filas cuesta milisegundos; el benchmark lo mide y `pg_trgm` solo entra con evidencia.
- [`Select` para ICE si una empresa habilita muchos códigos] → Solo lista los habilitados, que son pocos en la práctica. El combobox con búsqueda llegará con el selector de productos de la factura.
- [El estado tributario cambia sin que nadie toque el producto] → Es el comportamiento pedido: se deriva de los catálogos vigentes. La interfaz explica el motivo, y la emisión vuelve a validar con la fecha del documento.
- [La identidad del consumidor final no sigue a una política posterior] → Lo impide el trigger de inmutabilidad; un cambio así exigirá un cambio explícito de datos y de invariante.
- [Downgrade binario después de migrar] → La invariante "una empresa, exactamente un consumidor final" no la conoce la versión anterior, así que el downgrade no es compatible automáticamente. La estrategia normal es avanzar con una corrección (Migration Plan).

## Migration Plan

1. Desplegar la versión. La migración crea las tablas, las restricciones y los triggers.
2. Al arrancar: cargar catálogos → aprovisionar si falta la empresa (con su consumidor final) → reponer los consumidores finales que falten → atender peticiones.
3. Sin pasos manuales ni configuración nueva.
4. **Marcha atrás.** Esta migración introduce la invariante "cada empresa tiene exactamente un consumidor final", que una versión anterior de la aplicación no conoce.
   - Una vez aplicada, un downgrade binario a una versión anterior no es compatible automáticamente.
   - La estrategia normal es avanzar: corregir con una versión nueva.
   - Si alguna vez hiciera falta volver atrás, se sigue un runbook explícito o se restaura una copia compatible tomada antes de migrar.
   - Nunca se recomienda quitar una protección de integridad y continuar.
   - `deployment.md` lo documenta. No se construye ahora un sistema de reversión de migraciones.
