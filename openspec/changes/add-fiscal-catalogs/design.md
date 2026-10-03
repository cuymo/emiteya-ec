# Design

## Context

Motivación y alcance en `proposal.md`; comportamiento en `specs/`. Lo que condiciona el diseño:

- **Decisiones ya tomadas:**
  - ADR 0020 (Q-25): los catálogos son datos normativos versionados del sistema, distribuidos con cada release. Solo la habilitación es de cada empresa, y no hay sincronización en tiempo de ejecución.
  - ADR 0014 enmendado (Q-38): la matriz de casos especiales tiene categorías explícitas.
  - ADR 0008: el registro de esquemas.
  - ADR 0009: la empresa como tenant.
  - ADR 0018: `facturacion-electronica-ec` no es fuente de verdad.
- **Origen de este cambio:** la propuesta `add-business-catalogs` (commit `493e184`) se dividió antes de implementarse. Este cambio es la base compartida; `add-parties-and-products` dependerá de él.
- **Fuente oficial:** la ficha técnica v2.34 del SRI, de fecha 2026-07-27 (CTX SRI-02). Se descargó para este diseño desde la URL de CTX, con SHA-256 `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9`.
  - **Lo que publica:**
    - tipos de identificación (tabla 6, con las notas sobre consumidor final y exterior);
    - impuestos (tabla 16);
    - tarifas de IVA (tabla 17, sin fechas, con la nota 3 sobre el IVA diferenciado);
    - códigos de ICE (tabla 18, páginas impresas 30 a 32): 76 filas con 71 códigos distintos. Los códigos 3041 y 3541 aparecen tres veces cada uno, con escalas distintas. El 3671 aparece dos veces idéntico (páginas 31 y 32), con el mismo código, la misma denominación y las mismas tarifas. Las tarifas de la tabla son de 2023, y la ficha avisa que "deberán calcularse en base a la normativa vigente";
    - formas de pago (tabla 24, con fechas de inicio);
    - consumidor final hasta USD 50 (numeral 9.10), con la razón social `CONSUMIDOR FINAL` en sus ejemplos.
  - **Lo que no publica:** no hay tabla de IRBPNR. Su código de porcentaje `5001` solo aparece en la especificación del XML de factura, que remite por error a la tabla 18.
- **Código existente:**
  - No hay módulo `catalogs` ni ninguna columna `NUMERIC`.
  - Los tipos de comprobante, el ambiente y el tipo de emisión ya son constantes del protocolo en los contratos (CTX §56).
  - `decimal.js` 10.6.0 está en el lockfile como dependencia transitiva de Prisma.
  - Los XSD oficiales y su manifiesto con hashes están en `docs/product/sri-xsd/`.

## Goals / Non-Goals

**Goals:**

- Datasets trazables hasta su tabla y su página de la fuente, con inmutabilidad comprobada en cada arranque.
- Una sola operación de dominio que resuelve la versión aplicable en una fecha, con un identificador estable para reproducirla.
- Una política decimal común cuyas escalas salen de los tipos del XSD, lista para terceros, productos y emisión.
- Un contrato de lectura estable para `add-parties-and-products` y `add-invoice-emission`.

**Non-Goals:**

- Terceros, productos, el registro del consumidor final por empresa, el contrato común de paginación y la prueba de volumen (Q-26): todo eso es de `add-parties-and-products`.
- Tarifas de ICE e IRBPNR con valores, la política del IVA diferenciado y el redondeo de comprobantes (Q-14).
- Empaquetar los XSD en la imagen y validar XML (spike S-2).

## Decisions

### Brief de operaciones sensibles

La única operación sensible es la habilitación de entradas por empresa. La consulta de catálogos
oficiales lee datos del sistema, y la de la habilitación, datos de la empresa de la sesión.

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Quién ejecuta | Consultar: `ADMIN` y `OPERATOR`. Habilitar y deshabilitar: `ADMIN` (D12). |
| 2 | Tenant del llamante | `RequestContext.companyId`. |
| 3 | Tenant del recurso | La habilitación es de `company_id`. Los catálogos oficiales no son de ninguna empresa. |
| 4 | Validación de propiedad | La habilitación siempre se lee y se escribe con la empresa de la sesión. La ruta solo identifica el catálogo y la entrada, que son datos del sistema. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No: no hay identificadores de empresa en la ruta, y un `companyId` en el cuerpo lo rechaza el esquema estricto. |
| 6 | Petición repetida | Es un estado deseado: repetirla no cambia nada ni audita. |
| 7 | Peticiones simultáneas | Un advisory lock de transacción por empresa y entrada serializa los cambios; no se crea ninguna fila para poder bloquearla. Solo se escribe y se audita la transición real (D9). |
| 8 | Idempotencia | Por estado deseado; no hace falta clave. |
| 9 | Restricciones | Clave primaria compuesta con la empresa; clave foránea a la identidad de la entrada; un `CHECK` limita las filas a los catálogos habilitables; triggers de inmutabilidad de los datos del sistema (D14). |
| 10 | Auditoría | Solo de la transición real, en la misma transacción (D13). |
| 11 | Pruebas de autorización | El operador recibe `403` al habilitar y `200` al consultar. La empresa B no ve la habilitación de la empresa A. Un `companyId` en el cuerpo da `400`. |
| 12 | Fugas | La consulta devuelve solo la habilitación de la empresa de la sesión. Los datos oficiales son los mismos para todas. |

### D1. Módulo `catalogs`

Módulo nuevo en `backend/src/modules/catalogs/`, con dominio, aplicación e infraestructura como
`taxpayer`.

- **Contiene:** datasets, cargador, resolución de vigencia, habilitación y lecturas.
- **Usa:** el `Authorizer` de `identity` y la auditoría de `audit`.
- **Ofrece**, como puertos de aplicación para los cambios siguientes:
  - `resolveCatalogEntry` (D5);
  - la habilitación de una entrada para una empresa;
  - la política de consumidor final vigente;
  - las reglas de los tipos de identificación;
  - el registro de esquemas;
  - la matriz de casos especiales.
- **Sin dependencias hacia terceros ni productos.** El cambio siguiente los consume desde fuera del módulo, y `catalogs` no sabe que existen.

### D2. Datasets incluidos

| Dataset | Fuente | Entradas | Habilitación | Por defecto |
| --- | --- | --- | --- | --- |
| Tipos de identificación | Tabla 6 (página 13) y XSD | 5: `04`, `05`, `06`, `07`, `08`, con su regla de formato (D7); `07` reservado al consumidor final | No | — |
| Impuestos | Tabla 16 (página 29) | 3: `2` IVA, `3` ICE, `5` IRBPNR | No | — |
| Tarifas de IVA | Tabla 17 (páginas 29–30) | 9: `0` 0 %, `2` 12 %, `3` 14 %, `4` 15 %, `5` 5 %, `6` no objeto, `7` exento, `8` IVA diferenciado, `10` 13 % | Sí | Habilitadas |
| Códigos de ICE | Tabla 18 (páginas 30–32) | 75 entradas para las 76 filas de la fuente (D6), cada una con su `entryKey`, su código y su denominación, sin tarifas | Sí | Deshabilitados |
| Códigos de IRBPNR | Especificación del XML de factura (código `5`, porcentaje `5001`) | 1, sin tarifa | Sí | Deshabilitado |
| Formas de pago | Tabla 24 (página 79) | 8: `01`, `15`–`21`, con fecha de inicio | Sí | Habilitadas |
| Política de consumidor final | Numeral 9.10 (página 29), tabla 6 (página 13) y ejemplos | 1: USD 50.00, tipo `07`, `9999999999999` y `CONSUMIDOR FINAL` | No | — |
| Registro de esquemas | `docs/product/sri-xsd/README.md` | 6 (CTX §3.1) | No | — |
| Matriz de casos especiales | ADR 0014 sobre el capítulo de anexos de la ficha | 26 | No | — |

- **Valores por defecto de la habilitación:** son datos de cada dataset (D9). ICE e IRBPNR están deshabilitados porque pocas empresas los usan y su presencia invita a errores.
- **Fuera de estos datasets:**
  - tipos de comprobante, ambiente y tipo de emisión, que siguen siendo constantes del protocolo (CTX §56);
  - retenciones (tablas 19 y siguientes);
  - países (tabla 25);
  - tipos de proveedor de reembolso (tabla 26).

### D3. Formato, carga y trazabilidad de los datasets

- **Archivos:** un JSON por dataset y versión en `backend/src/modules/catalogs/datasets/<catálogo>/<versión>.json`, validado con Zod. Una versión nueva añade un archivo; nunca edita el anterior.
- **Cabecera:** catálogo, versión del dataset (entera y creciente), fuente (documento, versión, fecha de publicación, URL y SHA-256) y política de habilitación por empresa del catálogo (D9).
- **Cada entrada:**
  - `entryKey` (D6) y `code`;
  - `officialLabel`, transcrita literalmente;
  - `effectiveFrom` y `effectiveFromBasis`, con dos valores y una semántica fija:
    - `SOURCE_STATED`: la fuente declara esa fecha de inicio, por ejemplo la tabla 24 de formas de pago;
    - `PROJECT_BASELINE`: la fuente no declara inicio, y el proyecto usa como base la fecha de publicación de la versión de la fuente que la contiene (2026-07-27 para la ficha v2.34). No es una fecha legal de vigencia.
  - `effectiveTo`;
  - `normativeStatus`: `OFFICIAL` (código y valores de una tabla oficial), `OFFICIAL_REFERENCE` (código oficial sin valores vigentes en la fuente: ICE e IRBPNR) o `WITHDRAWN` (retirado por una versión posterior, con la vigencia cerrada);
  - `sourceRef`: tabla o numeral, y página;
  - los atributos propios del catálogo (D7 y D8).
- **Base del proyecto, no historia:** las tablas 6, 16, 17 y 18, la especificación del IRBPNR y el numeral 9.10 no traen fechas de inicio. Sus entradas llevan `PROJECT_BASELINE` con 2026-07-27, y no se inventa ninguna historia anterior.
  - La resolución por fecha (D5) usa esa base para el alcance actual del producto, que no emite comprobantes anteriores a su instalación.
  - La API devuelve `effectiveFromBasis` con cada versión. La interfaz y la documentación la presentan como "base del proyecto: publicación de la ficha v2.34", nunca como fecha legal de vigencia.
  - Si más adelante una fuente normativa establece la fecha real, entra como versión nueva del dataset, con `SOURCE_STATED` y su fuente.
  - Hoy, solo las formas de pago llevan `SOURCE_STATED`.
- **Manifiesto:** `docs/product/sri-catalogs/README.md` lista cada dataset con su versión, la fuente, su hash y las tablas transcritas.
  - Una prueba compara el manifiesto con los archivos y fija los valores críticos: códigos y porcentajes de IVA, formas de pago y sus fechas, monto e identidad del consumidor final, filas de ICE y categorías de la matriz.
  - El PDF no se commitea: quedan su URL y su hash.
- **Carga controlada al arrancar.** `main.ts` llama a `loadFiscalCatalogs` después de las migraciones y del aprovisionamiento, antes de aceptar peticiones. La estrategia no supone que haya una sola instancia:
  1. **Validación sin tocar la base.** Lee todos los archivos, los valida con Zod y comprueba en memoria las versiones de cada catálogo: contiguas, sin superposición y con transiciones permitidas entre versiones consecutivas (D4). Calcula el checksum SHA-256 del contenido canónico de cada archivo. Un dataset inválido aborta aquí, sin abrir ninguna transacción.
  2. **Una sola transacción para todo.** Abre una transacción interactiva y toma `pg_advisory_xact_lock` con una clave propia del cargador. La clave se deriva de `fiscal-catalogs:loader`, es distinta del lock de las migraciones de Prisma y se libera sola al terminar la transacción.
  3. **Comparación con lo aplicado.** Lee `fiscal_catalog_dataset`. Para cada archivo:
     - si su versión ya está aplicada con el mismo checksum y la misma fuente, no hace nada;
     - si está aplicada con otro checksum u otra fuente, lanza `FiscalCatalogDatasetConflict` con el catálogo y la versión, y la transacción se revierte;
     - si no está aplicada, debe ser la siguiente de su catálogo.
  4. **Aplicación y registro.** Aplica las versiones pendientes en orden: claves, versiones, transiciones, política, registro y matriz. Comprueba lo publicado contra el archivo, y una alteración aborta. Registra cada versión con su checksum, su fuente y su política de habilitación, y confirma la transacción. Una versión, o el conjunto de varias, se aplica entera o no se aplica: nunca queda una carga parcial.
  5. **Instancias que pierden la carrera.** Esperan el lock y, al obtenerlo, leen lo confirmado por la ganadora (`READ COMMITTED` toma una instantánea nueva por sentencia). Reconocen las versiones ya aplicadas con el mismo checksum y siguen arrancando.
  6. **Respaldo sin lock.** Si un despliegue alterara el lock, los únicos de `(catalog_type, version)` en `fiscal_catalog_dataset` y de `(catalog_type, entry_key, effective_from)` en las versiones hacen fallar la transacción concurrente, que se revierte entera. El cargador reintenta una vez desde el paso 2, y ahí reconoce lo aplicado.
  - No audita por empresa. Registra en el log las versiones aplicadas, o "ya aplicadas", y el número de entradas nuevas.
- **Por qué al arrancar y no con una migración SQL:**
  - el JSON es la única fuente;
  - la inmutabilidad se comprueba en cada arranque, no solo una vez;
  - las pruebas cargan los mismos datos en sus esquemas aislados.
  - Una migración generada desde el JSON duplicaría la fuente y no detectaría una edición posterior del archivo.

### D4. Modelo de versiones

- **Identidad:** `(catálogo, entryKey)`, en `fiscal_catalog_key`.
- **Versión:** `(catálogo, entryKey, effectiveFrom)`, en `fiscal_catalog_entry`, con su identificador estable, su descripción, sus valores, su fuente, su estado y la versión del dataset que la publicó.
- **Sin superposición:** las versiones de una entrada no se superponen. El cargador lo comprueba antes de escribir, y un trigger lo rechaza en la base de datos.
- **Transiciones permitidas:** una versión posterior del dataset solo puede añadir entradas o versiones, cerrar un `effectiveTo` abierto, o pasar `OFFICIAL` u `OFFICIAL_REFERENCE` a `WITHDRAWN`.
  - Cada transición registra la versión del dataset que la hizo.
  - Un trigger rechaza cualquier otro `UPDATE` y todo `DELETE` o `TRUNCATE`.
- **Fechas:** `DATE`, inclusivas en ambos extremos, del calendario de Ecuador (`America/Guayaquil`).

### D5. `resolveCatalogEntry`: la única resolución de vigencia

- **La operación:** el dominio de `catalogs` expone una función pura, `resolveCatalogEntry(versions, effectiveDate)`. Devuelve la versión con `effectiveFrom <= fecha` y con `effectiveTo` nulo o mayor o igual que la fecha, o ninguna.
  - El puerto de aplicación `resolveCatalogEntry(catalogType, entryKey, effectiveDate)` la usa sobre las versiones guardadas.
  - La fecha es siempre explícita: el puerto nunca usa el reloj.
- **Resultado:** el identificador estable de la versión, sus valores y su fuente. Un comprobante futuro guardará ese identificador y copiará los valores a su snapshot (BR-21), así podrá reproducir qué versión aplicaba aunque se añadan versiones.
- **Un solo lugar:** la API de lectura, la carga de productos de `add-parties-and-products` y la emisión usan este puerto. Ningún otro módulo reimplementa la regla. Una prueba de arquitectura comprueba que solo `catalogs` lee las tablas de entradas.
- **Qué fecha usará la emisión:** la de emisión del comprobante en hora de Ecuador. En notas de crédito y débito, cuando la regla del documento lo pida, la del documento sustento (BR-33, CTX §13.4 y §14.3). Este cambio solo lo deja como obligación (D15).

### D6. Identidad de las entradas de ICE con códigos repetidos

- **El problema:** en la tabla 18, `code` no identifica una fila. El 3041 aparece como cerveza industrial de gran, mediana y pequeña escala, y el 3541 como cerveza gran escala, industrial de mediana escala e industrial de pequeña escala (CAE). Cada fila tiene una denominación distinta y será una tarifa distinta cuando haya fuente legal.
- **Fila repetida idéntica:** el 3671 ("ICE calefones y sistemas de calentamiento de agua a gas SRI") aparece en las páginas 31 y 32 con el mismo código, la misma denominación y las mismas tarifas. Es la misma fila normativa repetida, no una variante. Tiene una sola entrada (`entryKey` `3671`), y su `sourceRef` cita ambas páginas. Así hay 75 entradas para las 76 filas de la fuente.
- **La regla:** `entryKey` es la identidad interna estable de la fila o variante normativa, y `code` sigue siendo el código fiscal visible que irá al XML.
  - En los catálogos sin repeticiones, `entryKey` es igual al código.
  - En las filas repetidas, el dataset fija un sufijo explícito, nunca derivado al cargar: `3041-GRAN-ESCALA`, `3041-MEDIANA-ESCALA`, `3041-PEQUENA-ESCALA`, `3541-GRAN-ESCALA-CAE`, `3541-MEDIANA-ESCALA-CAE` y `3541-PEQUENA-ESCALA-CAE`.
  - Una versión posterior conserva esas claves aunque cambien las denominaciones.
- **En la base de datos:** el patrón de `entryKey` es `^[0-9A-Z][0-9A-Z-]{0,63}$`, y no hay ninguna restricción única sobre `(catálogo, code)`.
- **Fuente de revisión:** `docs/product/sri-catalogs/fuentes/ficha-v2.34-tabla-18.txt` es el extracto literal de la tabla 18, obtenido con `pdftotext -layout` de las páginas impresas 30 a 32. Su cabecera indica el SHA-256 del PDF y el método de extracción. La denominación de cada entrada es la de la fuente, con los espacios del maquetado reducidos a uno y las líneas de una misma celda unidas con un espacio.
- **Pruebas sobre el extracto y el dataset:**
  - el extracto tiene 76 filas y 71 códigos distintos;
  - solo se repiten 3041 y 3541 (tres filas cada uno, con denominaciones distintas) y 3671 (dos filas idénticas);
  - el dataset tiene 75 entradas, y sus códigos son los del extracto menos la repetición idéntica de 3671;
  - cada denominación aparece, palabra por palabra y en orden, en el bloque de su fila del extracto;
  - `entryKey` es único;
  - cada entrada tiene tabla y página en `sourceRef`;
  - todo `code` cumple el patrón `codigoPorcentaje` del XSD (1 a 4 dígitos);
  - el esquema estricto del dataset de ICE no admite campos de tarifa;
  - las claves de una versión anterior siguen existiendo en la siguiente.
  - La revisión fila a fila contra el PDF se completa en la tarea del dataset, antes de cerrar el grupo.

### D7. Tipos de identificación y consumidor final

- **Reglas de formato como datos:** cada tipo lleva su regla de formato con su fuente.
  - `04`: `^[0-9]{10}001$` (tabla 5 de la ficha y tipo `ruc` del XSD).
  - `05`: `^[0-9]{10}$` (tabla 5).
  - `06` y `08`: de 1 a 20 caracteres sin saltos de línea (tipo `identificacionComprador` del XSD).
  - `07`: `reservedFor: "CONSUMER_FINAL"`.
  - No hay algoritmo de dígito verificador (ERS RF-322, CTX §9.1).
  - Una prueba compila cada patrón y lo comprueba con ejemplos válidos e inválidos.
- **Política de consumidor final:** `consumer_final_policy` guarda versiones con:
  - monto máximo `NUMERIC(14,2)` (D10);
  - moneda `USD`;
  - tipo de identificación (`07`), identificación (`9999999999999`) y razón social canónica (`CONSUMIDOR FINAL`);
  - vigencia, fuente y `sourceRef`.
- **Sin terceros:** este cambio no crea ningún tercero. `add-parties-and-products` creará el registro del sistema de cada empresa con esta identidad, leída del puerto de la política (D15).

### D8. Modelo tributario de las entradas

Las tarifas no se reducen a `percentage: number`. Columnas tipadas de `fiscal_catalog_entry`, con
`CHECK` por catálogo:

- **Comunes a las tarifas:**
  - `tax_kind`: `IVA`, `ICE` o `IRBPNR`;
  - `sri_tax_code`: `2`, `3` o `5`, coherente con el dataset de impuestos;
  - `code`: el código de porcentaje del XML.
- **IVA:** `rate_kind` toma uno de cuatro valores. Un `CHECK` exige `percentage` si y solo si es `PERCENTAGE`.
  - `PERCENTAGE`, con `percentage NUMERIC(4,2)`: 0, 12, 14, 15, 5 y 13;
  - `NOT_SUBJECT` (código 6);
  - `EXEMPT` (código 7);
  - `DIFFERENTIATED` (código 8), sin porcentaje, porque su tarifa la fija un decreto (nota 3 de la ficha).
- **ICE:** `rate_kind = PER_NORMATIVE`, sin columnas de tarifa. Las tarifas de 2023 de la tabla no se transcriben como vigentes.
- **IRBPNR:** `rate_kind = PER_UNIT`, sin columna de importe.
- **Solo lo sustentado.** No se crean columnas para valores que hoy no existen. Cuando haya fuente legal, una migración y una versión del dataset añadirán los componentes de ICE (ad valorem y específico con su unidad) y el importe por unidad del IRBPNR. Será antes de la capacidad que los calcule (D15). Ningún valor se estima ni se copia de `facturacion-electronica-ec`.

### D9. Habilitación por empresa

- **Política como dato.** Cada dataset declara la política de habilitación de su catálogo:
  - `NOT_ENABLEABLE` para tipos de identificación e impuestos;
  - `DEFAULT_ENABLED` para tarifas de IVA y formas de pago;
  - `DEFAULT_DISABLED` para ICE e IRBPNR.
  - Se guarda con la versión del dataset en `fiscal_catalog_dataset`. Rige la de la última versión aplicada del catálogo, y cambiarla exige una versión nueva del dataset, trazable como cualquier otra.
- **Estado efectivo.** Se calcula a partir de tres datos:
  1. la versión normativa resuelta para la fecha con `resolveCatalogEntry` (D5);
  2. el valor por defecto que declara la política del dataset del catálogo;
  3. la decisión explícita de la empresa, si existe.

  Conceptualmente, `enabled = decisiónDeLaEmpresa ?? valorPorDefecto`, y una entrada es utilizable si tiene versión aplicable en la fecha y está habilitada.
- **Decisiones de la empresa:** `company_fiscal_catalog_setting (company_id, catalog_type, entry_key, enabled, updated_at, updated_by)`, con clave primaria compuesta y clave foránea a `fiscal_catalog_key`.
  - Una fila representa una decisión explícita de la empresa. Nunca se crea una fila solo para copiar el valor por defecto.
  - Un `CHECK` admite solo los catálogos habilitables. La API responde `400 FISCAL_CATALOG_NOT_ENABLEABLE` para los demás, y `404` si la entrada no existe.
- **Funciones de dominio únicas** (`domain/enablement.ts`):
  - `effectiveEnablement({ decision, policy })` devuelve `{ enabled, source }`:
    - `COMPANY`: rige la decisión de la empresa;
    - `DEFAULT`: no hay decisión, y rige el valor por defecto de la política;
    - `NOT_ENABLEABLE`: el catálogo no admite decisiones por empresa (tipos de identificación e impuestos). No equivale a deshabilitada: la entrada está siempre disponible (`enabled: true`), y su uso depende solo de su vigencia.
  - `isUsable(applicable, enablement)` trabaja sobre la versión ya resuelta para una fecha explícita, es decir, sobre el resultado de `resolveCatalogEntry`. Exige que esa versión exista y que la entrada esté habilitada.
  - Todo lector (API, `add-parties-and-products`, emisión) usa esas funciones, así que la ausencia de fila tiene siempre el mismo significado.
- **Semántica determinista:**
  - **Empresa sin decisión:** hereda el valor por defecto vigente del catálogo. Una empresa nueva no tiene filas.
  - **Entrada nueva de un dataset posterior:** ninguna empresa tiene decisión sobre ella, y hereda el valor por defecto. No se copian filas.
  - **Repetir el estado efectivo actual:** no crea fila ni auditoría.
  - **Cambio real:** crea o actualiza la decisión de la empresa y audita exactamente una transición (D13).
  - **Volver al valor por defecto:** si una decisión vuelve a coincidir con el valor por defecto, la fila se conserva, porque sigue siendo una decisión de la empresa y no depende de cambios futuros de la política.
  - **Entrada que vence o se retira:** la decisión se conserva como historia, pero en una fecha sin versión aplicable la entrada no es utilizable. Una decisión de la empresa nunca vuelve utilizable una entrada vencida o `WITHDRAWN`.
  - **Habilitar una entrada sin versión vigente ni futura:** `400 FISCAL_CATALOG_ENTRY_NOT_IN_FORCE`. Deshabilitar siempre se permite.
- **La vista de la API** devuelve, por entrada, `enablement: { enabled, source }`, con `source` `DEFAULT`, `COMPANY` o `NOT_ENABLEABLE`, y `usable` en la fecha consultada.
- **Cambio:** `PUT …/enablement { enabled }` en una transacción:
  1. comprueba que la entrada existe y, si se habilita, que tiene una versión vigente o futura;
  2. toma `pg_advisory_xact_lock` con una clave por empresa y entrada (`fiscal-catalog-enablement:{companyId}:{catalogType}:{entryKey}`). El lock serializa los cambios simultáneos de la misma entrada en la misma empresa y se libera al terminar la transacción;
  3. lee la decisión y calcula el estado efectivo con `effectiveEnablement`;
  4. si el estado efectivo cambia, guarda la decisión y audita la transición en la misma transacción;
  5. si no cambia, responde `200` sin escribir ni auditar.
  - **Por qué un advisory lock y no `FOR UPDATE`:** sin decisión previa no hay fila que bloquear, y crearla con el valor por defecto para poder bloquearla sería precisamente una copia del catálogo.
- **Efecto:** la habilitación no altera datos oficiales. Su efecto en terceros, productos y comprobantes lo definen los cambios que los crean (D15).

### D10. Política decimal común

- **Representación universal y tipos.** `DecimalString` es la representación textual universal del producto: `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`, sin exponente, coma decimal, separadores, ceros a la izquierda, espacios, signo `+` ni `-0`. Admite negativos, porque una capacidad futura puede necesitarlos; algunos campos del XSD, como `totalDescuentos` o el `valor` de la guía, no tienen mínimo.
  - Los tipos del dominio la restringen: `Percentage`, `Money`, `UnitPrice` y `Quantity`, cada uno con su especificación de dígitos, decimales y mínimo.
  - "Sin signo" es una propiedad de esos tipos, todos no negativos, no del parser universal.
- **Escalas desde los XSD.** La tabla de especificaciones decimales vive en `packages/contracts/src/decimal.ts`, y backend y frontend la comparten. Cada especificación nombra su tipo XSD de origen y los documentos en que es común:

  | Especificación | Tipo XSD de origen (1.1.0) | Dígitos totales | Decimales | Uso |
  | --- | --- | --- | --- | --- |
  | `tarifa` → `Percentage` | `tarifa` de factura, liquidación, nota de crédito y nota de débito | 4 | 2 | Porcentaje de IVA (este cambio) |
  | `importe` → `Money` | `importeTotal`, `valor`, `baseImponible`, `total`: 14/2 en los seis documentos | 14 | 2 | Monto de la política de consumidor final (este cambio); importes de la emisión |
  | `precioUnitario` → `UnitPrice` | `precioUnitario` de factura, liquidación y nota de crédito | 18 | 6 | Precio de productos (`add-parties-and-products`) |
  | `cantidad` → `Quantity` | `cantidad` de factura, liquidación, nota de crédito y guía | 18 | 6 | Cantidades de la emisión |

  - Una comprobación estática recorre los seis XSD versionados, sin S-2. Una prueba lee sus `simpleType` y comprueba que cada especificación coincide con todos los tipos equivalentes de los documentos que los definen.
  - Excepción documentada: la retención 2.0.0 define `tarifa` y `porcentajeRetener` con 3/2, así que esa escala es propia de la retención y llegará con su cambio. La prueba la fija como excepción conocida.
  - El mínimo 0 de los cuatro tipos sale de los mismos `simpleType`. Los campos monetarios sin mínimo de algunos documentos se representarán con el `DecimalString` universal cuando se usen.
  - La regla de dominio del IVA limita además el porcentaje a 100.
- **Dominio:** `decimal.js` 10.6.0, como dependencia directa del backend con versión exacta. Es la biblioteca que Prisma usa para `Decimal`.
  - Se envuelve en `platform/decimal`, con una instancia propia (precisión 40), un objeto de valor `FiscalDecimal(spec)` que valida dígitos enteros, escala y mínimo, y los tipos `Percentage`, `Money`, `UnitPrice` y `Quantity`.
  - Ningún importe ni tarifa pasa por `number`.
- **PostgreSQL:** `NUMERIC(dígitos totales, decimales)` de su especificación: `NUMERIC(4,2)` para el porcentaje de IVA y `NUMERIC(14,2)` para el monto de la política, con `CHECK` de mínimo.
  - Prisma devuelve `Decimal`, y el repositorio lo convierte a `decimal.js` mediante su texto.
- **JSON:**
  - Los decimales viajan como cadenas; un número JSON se rechaza, porque ya pasó por coma flotante.
  - Al recibir: primero el `DecimalString` universal, y después los dígitos, la escala y el mínimo de la especificación del campo.
  - Al devolver: la forma canónica más corta y exacta, sin exponente ni ceros finales (`15`, `12.5`).
  - El helper `decimalString(spec)` define el esquema Zod y sus mensajes.
- **Redondeo:** nunca al recibir; más decimales de los admitidos es un error de validación. Este cambio no redondea nada, porque los datasets traen valores exactos. El redondeo de los comprobantes (Q-14) es de la emisión, que recibirá valores ya normalizados con estas especificaciones.
- **Frontend:** un formateador de cadenas decimales para mostrar porcentajes y montos con la convención es-EC, sin convertir a `number`.

### D11. API

Todo bajo `/api/v1` (ADR 0015), con contratos en `packages/contracts/src/fiscal-catalogs.ts` y
OpenAPI regenerado. Ningún listado necesita paginación: el más grande, ICE, tiene 75 entradas.

| Ruta | Permiso | Notas |
| --- | --- | --- |
| `GET /fiscal-catalogs` | `fiscalCatalogs.read` | Catálogos con versión del dataset, fuente y si admiten habilitación. |
| `GET /fiscal-catalogs/{catalogType}/entries` | `fiscalCatalogs.read` | Fecha `at`, hoy en Ecuador por defecto. Por entrada: `entryKey`, `code`, versiones, la versión aplicable en `at` (con su identificador, resuelta con D5) y si está habilitada para la empresa. |
| `PUT /fiscal-catalogs/{catalogType}/entries/{entryKey}/enablement` | `fiscalCatalogs.manage` | `{ enabled }`, estricto. |
| `GET /fiscal-catalogs/consumer-final-policy` | `fiscalCatalogs.read` | Versiones y vigente. |
| `GET /fiscal-catalogs/schemas` | `fiscalCatalogs.read` | Registro de esquemas. |
| `GET /fiscal-catalogs/special-cases` | `fiscalCatalogs.read` | Matriz. |

No hay rutas para crear o modificar datos oficiales: esas peticiones reciben `404`, como cualquier
ruta inexistente (spec "Datos oficiales no modificables").

### D12. Permisos

Se añaden `fiscalCatalogs.read`, para `ADMIN` y `OPERATOR`, y `fiscalCatalogs.manage`, solo para
`ADMIN`, al mapa central y a su espejo en el frontend. Se añade la fila "Habilitar entradas de
catálogos fiscales" a `access-control.md`.

### D13. Auditoría

- **Acciones:** `fiscal_catalog.entry_enabled` y `fiscal_catalog.entry_disabled`, solo en una transición real. `changes` guarda el catálogo, `entryKey`, `code`, `enabled.from` y `enabled.to`.
- **No se auditan:** las lecturas, la carga de datasets ni las peticiones rechazadas.

### D14. Esquema de datos

Una migración crea siete tablas:

- **Del sistema:**
  - `fiscal_catalog_dataset`: catálogo, versión (única con el catálogo), fuente, checksum, política de habilitación y carga;
  - `fiscal_catalog_key`: catálogo y `entryKey`;
  - `fiscal_catalog_entry`: versiones con las columnas de D8 y sus `CHECK`;
  - `consumer_final_policy`;
  - `schema_registry_entry`;
  - `special_case_support`.
- **De la empresa:** `company_fiscal_catalog_setting`.
- **Triggers:**
  - en las tablas del sistema, sin `DELETE` ni `TRUNCATE`;
  - en las entradas y en la política, solo las transiciones de D4;
  - sin superposición de versiones;
  - el registro y la matriz solo admiten inserción de versiones nuevas.
- **Datos:** las tablas empiezan vacías y las llena el cargador en el primer arranque de la versión. Revertir la versión deja las tablas sin uso.

### D15. Obligaciones para los cambios siguientes

**Para `add-parties-and-products`** (se registran en `capabilities.md` y en su futura propuesta):

- Validar identificaciones con las reglas del dataset de tipos y el tipo `07` reservado. No reimplementarlas.
- Crear el consumidor final de cada empresa como registro del sistema, con la identidad que publica la política.
- Referenciar impuestos por `(catálogo, entryKey)` y resolverlos solo con `resolveCatalogEntry`.
- Usar las especificaciones `precioUnitario` e `importe` y `decimalString`.
- Señalar los productos cuando una entrada deje de estar vigente o habilitada.
- Traer el contrato común de paginación, la prueba de volumen de Q-26 y el aviso de `Catálogos fiscales` sobre productos afectados al deshabilitar.

**Para `add-invoice-emission`** (en `fiscal-emission.md`):

- Resolver cada entrada con la fecha que corresponda (D5), guardar el identificador de la versión y copiar sus valores al snapshot.
- Rechazar la emisión mientras falten tarifas de ICE o IRBPNR con fuente legal para los productos que las usen.
- Decidir la política del IVA diferenciado.
- Aplicar la política de consumidor final y la matriz de casos especiales antes de reservar.
- Usar las especificaciones decimales y redondear según Q-14.
- Registrar los XSD del registro en la librería.

### D16. Contrato con `facturacion-electronica-ec`

`catalogs` no importa la librería (ADR 0018). Un adaptador de prueba en `sri-engine` expone sus
catálogos (`TIPOS_IDENTIFICACION`, `FORMAS_PAGO`, `IMPUESTOS_IVA`, `CODIGOS_IMPUESTO`) y una prueba
compara los valores coincidentes con nuestros datasets.

- Las divergencias conocidas quedan listadas de forma explícita: la librería no tiene los códigos de IVA 5 ni 10 y asigna una tarifa al 8.
- La prueba falla con cualquier divergencia nueva.
- Una divergencia se investiga contra la ficha, y nunca se adopta el valor de la librería.

### D17. Interfaz: `Catálogos fiscales`

Destino nuevo en `Configuración`, `/configuracion/catalogos-fiscales`, con `fiscalCatalogs.read`.
Primitiva nueva `Switch` (Radix) en `components/ui`, porque la habilitación aplica al momento
(`component-selection.md`).

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador (cambia); operador (consulta). |
| Objetivo | Usar solo las entradas oficiales que corresponden a la empresa y saber de dónde salen. |
| Decisión principal | Qué tarifas y formas de pago habilitar. |
| Información mínima | Por entrada: código, denominación oficial, vigencia y habilitada. Por catálogo: fuente y versión. |
| Acción principal | El `Switch` de cada entrada; no hay un botón focal. |
| Frecuencia y riesgo | Rara; riesgo medio: deshabilitar una tarifa la retira de lo que la empresa podrá usar. |

- **P0:** tarifas de IVA y formas de pago, cada una con su `Switch`.
- **P1:** ICE, con un filtro de texto local sobre sus 75 entradas y la variante visible en los códigos repetidos, e IRBPNR; fuente y versión de cada catálogo.
- **P2:** tipos de identificación con su regla, política de consumidor final con su identidad, matriz de casos especiales y registro de esquemas, en secciones de solo lectura.
- **Fecha de inicio:** cada fecha indica su origen. "Desde 01/06/2016 (declarada por la fuente)" frente a "Base del proyecto: ficha v2.34 (27/07/2026)", nunca presentada como vigencia legal.
- **P3:** historial de versiones de los datasets, fuera.
- **Comportamiento:**
  - El `Switch` se deshabilita mientras guarda y confirma con un toast.
  - El operador ve los `Switch` en solo lectura, con la explicación.
  - Porcentajes y montos se muestran con el formateador de cadenas (D10).
- **Revisión:** cubre carga, error con reintento, sin permiso, móvil a 375 y 320 px con objetivos de 44 px, teclado y ambos temas, con `frontend-checklist.md` (`ui-review.md`).

### D18. Pruebas

- **Unitarias:**
  - especificaciones decimales: patrones, rechazo de números JSON, forma canónica;
  - especificaciones contra los `simpleType` del XSD;
  - `resolveCatalogEntry` en los bordes y con versiones añadidas;
  - transiciones permitidas;
  - patrones de identificación.
- **Datasets:**
  - esquema de cada archivo y manifiesto contra archivos;
  - valores críticos fijados;
  - duplicados de ICE (D6);
  - registro contra los XSD y sus hashes.
- **Cargador:**
  - idempotencia;
  - dos cargadores simultáneos sobre una base vacía, con dos clientes y conexiones distintas: los dos terminan, se aplica una sola vez y los conteos son los esperados;
  - misma versión con otro checksum o fuente: fallo explícito sin modificar nada;
  - dataset inválido: no se abre la transacción;
  - fallo inyectado a mitad de la aplicación: no queda ninguna fila;
  - alteración y superposición abortadas con la entrada nombrada;
  - transiciones permitidas;
  - ningún evento de auditoría.
- **API con dos empresas:**
  - consulta de ambos roles;
  - operador `403` al habilitar;
  - catálogo no habilitable;
  - valores por defecto de una empresa nueva y de una entrada nueva, sin copiar filas;
  - entrada habilitada que vence o se retira, no utilizable;
  - habilitar una entrada sin vigencia actual ni futura;
  - habilitación repetida sin evento;
  - cambios simultáneos con una sola transición auditada;
  - aislamiento;
  - `companyId` rechazado;
  - `404` al intentar modificar datos oficiales;
  - resolución con `at` en un borde.
- **Arquitectura:** solo `catalogs` lee las tablas de entradas, y `catalogs` no importa `facturacion-electronica-ec`.
- **Contrato con la librería:** D16.
- **End-to-end contra `main.ts`:**
  1. el arranque carga los datasets;
  2. el operador consulta las tarifas;
  3. el administrador deshabilita una y habilita un ICE;
  4. el operador no puede habilitar;
  5. la auditoría tiene las dos transiciones;
  6. un segundo arranque no cambia nada.
- **Interfaz:** pruebas de componentes y recorrido contra el backend real.

## Risks / Trade-offs

- [Error de transcripción de la ficha] → Manifiesto con fuente y hash, `sourceRef` por entrada, valores críticos fijados y revisión fila a fila de la transcripción, incluidas las 76 filas de la tabla 18 (75 entradas).
- [Fechas de inicio no declaradas por la fuente] → `effectiveFromBasis = PROJECT_BASELINE` con la publicación de la ficha, sin historia anterior y nunca presentado como vigencia legal. Una fuente normativa con la fecha real entra como versión nueva.
- [Sin tarifas de ICE ni de IRBPNR] → Entradas `OFFICIAL_REFERENCE` sin columnas de valor. La capacidad que calcule debe traer antes un dataset con fuente legal (D15).
- [Códigos repetidos en la tabla 18] → `entryKey` explícito por fila y pruebas del dataset (D6).
- [La tarifa del 12 % sigue en la tabla 17 aunque la general es del 15 %] → El catálogo refleja la fuente: el sistema no determina obligaciones tributarias (BR-02). La empresa deshabilita lo que no usa.
- [Carga al arrancar con varias instancias] → Advisory lock propio y una transacción para todo, con versión, checksum y fuente por dataset, únicos de respaldo y un reintento. Lo prueban dos cargadores simultáneos. Un dataset alterado detiene el arranque en lugar de corregir datos.
- [Especificaciones decimales que divergen del XSD] → La prueba contra los `simpleType` lo impide.

## Migration Plan

1. Desplegar la versión: la migración crea las tablas y el primer arranque carga los datasets.
2. Sin configuración nueva ni pasos manuales.
3. Marcha atrás: volver a la versión anterior deja las tablas sin uso.

## Open Questions

- Qué normativa se transcribirá para las tarifas de ICE e IRBPNR, y la política del IVA diferenciado. Se decide antes de la capacidad que las calcule; no cambia este diseño.
