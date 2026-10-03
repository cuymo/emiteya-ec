# Design

## Context

Motivación y alcance en `proposal.md`; comportamiento en `specs/`. Estado y restricciones que
determinan el diseño:

- **Decisiones ya tomadas:**
  - ADR 0020 (Q-25): los catálogos fiscales son datos normativos versionados del sistema. Fluyen así: fuente oficial → dataset del repositorio → release → disponible para las empresas. Solo la habilitación es de cada empresa, y no hay sincronización en tiempo de ejecución.
  - ADR 0014 enmendado (Q-38): la matriz de casos especiales con categorías explícitas.
  - ADR 0008: el registro de esquemas y los datos con vigencia y fuente.
  - ADR 0009: la empresa es el tenant, con claves foráneas compuestas.
  - ADR 0018: `facturacion-electronica-ec` no es fuente de verdad.
- **Fuente oficial:** la ficha técnica v2.34 del SRI, de fecha 2026-07-27 (CTX SRI-02). Se descargó para este diseño desde la URL de CTX, con SHA-256 `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9`. Lo que aporta:
  - tipos de identificación (tabla 6);
  - impuestos (tabla 16);
  - tarifas de IVA (tabla 17);
  - códigos de ICE (tabla 18), con tarifas de 2023 y la advertencia de que "las tarifas deberán calcularse en base a la normativa vigente";
  - formas de pago (tabla 24), con fechas de inicio;
  - consumidor final hasta USD 50 (numeral 9.10).
  - Lo que no aporta: no tiene tabla de IRBPNR. Su código de porcentaje 5001 solo aparece en la especificación del XML de factura, que remite por error a la tabla 18. La tabla 18 repite los códigos 3041 (tres escalas de cerveza) y 3541 con descripciones distintas.
- **Código existente:**
  - No hay módulo `catalogs`, ni tablas de terceros o productos, ni ninguna columna `NUMERIC`.
  - Los tipos de comprobante, el ambiente y el tipo de emisión ya son constantes del protocolo en los contratos (`fiscal-numbering.ts`, CTX §56).
  - El único listado paginado es el de usuarios (`users.ts`: `search`, `page`, `pageSize`, `meta.total`).
  - `decimal.js` 10.6.0 ya está en el lockfile como dependencia transitiva de Prisma.
- **Restricciones de los XSD 1.1.0:**
  - identificación del comprador, `[0][4-8]` y de 1 a 20 caracteres;
  - razón social y dirección, hasta 300 caracteres;
  - `codigoPrincipal` y `codigoAuxiliar`, de 1 a 25 caracteres y opcionales;
  - `descripcion`, hasta 300 caracteres;
  - `precioUnitario`, 18 dígitos con 6 decimales y mínimo 0;
  - `tarifa`, 4 dígitos con 2 decimales;
  - `codigoPorcentaje`, de 1 a 4 dígitos.

## Goals / Non-Goals

**Goals:**

- Datasets oficiales trazables hasta su tabla y su página de la ficha, con carga verificable e inmutabilidad comprobada en cada arranque.
- Un modelo tributario explícito por impuesto, que la emisión pueda usar sin reinterpretar.
- Una política decimal única para todo el producto, desde la base de datos hasta la interfaz.
- Terceros y productos como datos privados de la empresa, con los mismos patrones de aislamiento, concurrencia y auditoría que los cambios anteriores.

**Non-Goals:**

- Calcular impuestos o totales, o validar un comprobante contra el catálogo: lo hará la emisión con lo que este cambio publica.
- Tarifas de ICE e IRBPNR con valores: la ficha no los publica como vigentes (D6).
- Índices de trigramas o búsqueda de texto completo, salvo que la medición de D18 los exija.
- Un combobox con búsqueda: el formulario de producto usa `Select`, con la excepción declarada en D19.

## Decisions

### Brief de operaciones sensibles

Cubre las altas, correcciones y cambios de estado de terceros y productos, y la habilitación de
entradas de catálogo.

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Quién ejecuta | Consultar, registrar y corregir terceros y productos: `ADMIN` y `OPERATOR`. Desactivar y reactivar: `ADMIN`. Consultar catálogos: ambos. Habilitar y deshabilitar entradas: `ADMIN` (D16). |
| 2 | Tenant del llamante | `RequestContext.companyId`. |
| 3 | Tenant del recurso | `company_id` de `party`, `product`, `product_tax` y `company_fiscal_catalog_setting`. Los catálogos oficiales no son de ninguna empresa. |
| 4 | Validación de propiedad | Cada consulta y cada `UPDATE` filtra por `company_id` y por el identificador de la ruta. Si no hay fila, la respuesta es `404`, la misma que para un identificador inexistente. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No: el filtro siempre incluye la empresa de la sesión. Los esquemas son estrictos y rechazan `companyId`. Las referencias de un producto a entradas de catálogo apuntan a datos del sistema, y su habilitación se lee siempre de la empresa de la sesión. |
| 6 | Petición repetida | El alta repetida de un tercero choca con la identificación única, y la de un producto, con el código principal único. El doble envío lo bloquea la interfaz. Cambiar el estado o la habilitación es un estado deseado: repetirlo no cambia nada ni audita. Una corrección repetida con la misma versión esperada choca con la versión ya incrementada (`409`). |
| 7 | Peticiones simultáneas | Las restricciones únicas resuelven las altas. La versión esperada resuelve las correcciones. Para la habilitación, la fila se crea con `ON CONFLICT DO NOTHING`, se bloquea con `FOR UPDATE` y se audita solo la transición real. |
| 8 | Idempotencia | Por restricciones de unicidad, estado deseado y versión esperada. No hace falta clave de idempotencia: ningún efecto fiscal depende de estas operaciones. |
| 9 | Restricciones | Únicos por empresa, consumidor final único por empresa, claves foráneas compuestas por empresa, `CHECK` de precio, de stock solo en bienes y de la coherencia entre impuesto y catálogo, y triggers de inmutabilidad de catálogos y del consumidor final (D21). |
| 10 | Auditoría | Altas, correcciones relevantes, cambios de estado y habilitación, en la misma transacción (D17). |
| 11 | Pruebas de autorización | El operador recibe `403` al desactivar y al habilitar, y `200` o `201` al consultar, registrar y corregir. La empresa B recibe `404` sobre recursos de la empresa A y no los ve en sus búsquedas. |
| 12 | Fugas | Las búsquedas y los totales filtran por empresa, y los mensajes de identificación o código repetido solo nombran registros de la propia empresa. La auditoría no guarda datos de contacto. Nada de un tercero va a los logs. |

### D1. Módulo `catalogs`

Módulo nuevo en `backend/src/modules/catalogs/`, con dominio, aplicación e infraestructura como
`taxpayer`. Contiene los catálogos fiscales, los datasets y su carga, los terceros y los productos.

- **Usa:** el `Authorizer` de `identity` y la auditoría de `audit`.
- **Ofrece:** puertos de lectura que usará la emisión: la entrada vigente de un catálogo en una fecha, la habilitación por empresa, el consumidor final, el registro de esquemas y la matriz de casos especiales. También ofrece la carga de datasets y la creación del consumidor final, que `main.ts` invoca al arrancar después del aprovisionamiento.
- **Política decimal:** vive en `backend/src/platform/decimal/` (D7) porque la usarán también `fiscal` e `inventory`. El formato de texto de los contratos vive en `packages/contracts/src/decimal.ts`.
- **Contrato de paginación:** el común queda en `packages/contracts/src/pagination.ts` (D14).

### D2. Datasets oficiales incluidos

Criterio: se incluye lo que usan terceros y productos, más lo que la capacidad `fiscal-catalogs`
declara (consumidor final, esquemas y matriz). El resto de las tablas llega con el cambio que las
consume (ADR 0020).

| Dataset | Fuente (ficha v2.34) | Entradas | Habilitación por empresa | Valor por defecto |
| --- | --- | --- | --- | --- |
| Tipos de identificación | Tabla 6, página 13 | 5: `04` RUC, `05` cédula, `06` pasaporte, `07` venta a consumidor final, `08` identificación del exterior | No | — |
| Impuestos | Tabla 16, página 29 | 3: `2` IVA, `3` ICE, `5` IRBPNR | No | — |
| Tarifas de IVA | Tabla 17, páginas 29–30 | 9: `0` 0 %, `2` 12 %, `3` 14 %, `4` 15 %, `5` 5 %, `6` no objeto, `7` exento, `8` IVA diferenciado, `10` 13 % | Sí | Habilitadas |
| Códigos de ICE | Tabla 18, páginas 30–31 | Una entrada por fila de la tabla: 75 filas con 71 códigos distintos, con código y descripción oficial | Sí | Deshabilitados |
| Códigos de IRBPNR | Especificación del XML de factura (código `5`, código de porcentaje `5001`) | 1 | Sí | Deshabilitado |
| Formas de pago | Tabla 24, página 79 | 8: `01`, `15`–`21`, con su fecha de inicio | Sí | Habilitadas |
| Política de consumidor final | Numeral 9.10, página 29; historial de la versión 2.22 | 1: USD 50.00 | No | — |
| Registro de esquemas | `docs/product/sri-xsd/README.md` | 6 (CTX §3.1) | No | — |
| Matriz de casos especiales | ADR 0014 sobre el capítulo de anexos de la ficha | 26 | No | — |

- **Fuera de esta lista:**
  - tipos de comprobante, ambiente y tipo de emisión, que siguen como constantes del protocolo (CTX §56) y se documentan como tales;
  - impuestos a retener (tabla 19) y retenciones (tabla 20 y siguientes), para `add-withholding-receipts`;
  - países (tabla 25) y tipos de proveedor de reembolso (tabla 26), que nadie usa en el MVP.
- **Valores por defecto de la habilitación:** ICE e IRBPNR empiezan deshabilitados porque pocas empresas los usan y su presencia invita a errores. IVA y formas de pago empiezan habilitados porque toda factura los necesita.

### D3. Formato y trazabilidad de los datasets

- **Archivos:** un JSON por dataset y versión en `backend/src/modules/catalogs/datasets/<catálogo>/<versión>.json`, validado con Zod al cargar. Una versión nueva no edita el archivo anterior: se añade un archivo.
- **Cabecera:** catálogo, versión del dataset (entera y creciente) y fuente: documento, versión, fecha de publicación, URL y SHA-256 del documento.
- **Cada entrada:**
  - `entryKey`: identidad estable en el catálogo. Es el código, salvo en ICE, donde lleva un sufijo de variante (`3041-gran-escala`) porque la tabla 18 repite códigos;
  - `code`: lo que va al XML;
  - `officialLabel`, transcrita literalmente;
  - `effectiveFrom` y `effectiveFromBasis`: `STATED` si la fuente da la fecha, o `SOURCE_VERSION_DATE` si no la da;
  - `effectiveTo`;
  - `normativeStatus`: `OFFICIAL`, `OFFICIAL_REFERENCE` o `WITHDRAWN`;
  - `sourceRef`: tabla o numeral, y página;
  - los atributos propios del catálogo (D6).
- **Fecha cuando la fuente no la da:** la tabla 17 y la tabla 6 no traen fechas. Se usa la fecha de la versión de la ficha transcrita (2026-07-27), y `effectiveFromBasis` deja constancia de ello. Así el sistema nunca aplica una entrada antes de tener evidencia. El MVP no emite comprobantes anteriores a su instalación.
- **Consumidor final:** la vigencia desde 2022-09-01 sale del historial de la ficha, versión 2.22: "actualización del monto máximo para emitir una factura a consumidor final".
- **Estado normativo:**
  - `OFFICIAL`: el código y sus valores salen de una tabla oficial;
  - `OFFICIAL_REFERENCE`: el código es oficial, pero la fuente no publica valores vigentes. Es el caso de ICE e IRBPNR;
  - `WITHDRAWN`: una versión posterior de la fuente lo retiró, y su vigencia está cerrada.
- **Manifiesto:** `docs/product/sri-catalogs/README.md` lista cada dataset con su versión, la fuente, el SHA-256 del documento y las tablas transcritas, igual que `sri-xsd/README.md`.
  - Una prueba comprueba que el manifiesto y los archivos coinciden.
  - La transcripción se revisa contra la ficha. Una prueba fija además los valores críticos: los códigos y porcentajes de IVA, las formas de pago con sus fechas y el monto de consumidor final.
  - El PDF de la ficha no se commitea: se registran su URL y su hash.

### D4. Modelo de versiones y vigencia

- **Identidad y versiones:**
  - La identidad de una entrada es `(catálogo, entryKey)`. Una versión es `(catálogo, entryKey, effectiveFrom)`, con su descripción, sus valores, su fuente y su estado.
  - Las versiones de una entrada no se solapan. El cargador lo comprueba, y un trigger lo rechaza.
- **Qué puede cambiar una versión posterior del dataset:**
  - añadir entradas o versiones;
  - cerrar un `effectiveTo` abierto;
  - pasar de `OFFICIAL` u `OFFICIAL_REFERENCE` a `WITHDRAWN`.
  - Cada cambio registra la versión del dataset que lo hizo. Cualquier otra diferencia con lo publicado detiene el arranque (D5).
- **Vigencia:**
  - Fechas `DATE`, inclusivas en ambos extremos, del calendario de Ecuador.
  - Una versión está vigente en la fecha `d` si `effectiveFrom <= d` y además `effectiveTo` es nulo o `d <= effectiveTo` (spec "Vigencia por fecha").
- **Fecha que resuelve una tarifa:**
  - La emisión resolverá con la fecha de emisión del comprobante en hora de Ecuador.
  - En notas de crédito y débito, cuando la regla del documento lo pida, se usará la fecha del documento sustento (BR-33, CTX §13.4 y §14.3).
  - En este cambio, el alta y la corrección de un producto validan con la fecha de hoy en Ecuador, y la pantalla consulta por defecto la fecha de hoy.
  - El puerto de lectura recibe siempre la fecha de forma explícita: nunca usa el reloj por su cuenta.
- **Lo que referencia un producto:** la identidad de la entrada (`catálogo`, `entryKey`), no una versión concreta. Así, una corrección normativa del mismo código no obliga a editar productos. El valor aplicado se resuelve por fecha y la emisión lo copia a su snapshot (BR-21).
  - En IVA, cada código tiene un porcentaje fijo: un cambio de tarifa general crea un código nuevo, como el `4` del 15 %, y los productos que deban cambiar se corrigen. La señal de "revisar impuestos" les avisa (D11).

### D5. Carga de los datasets al arrancar

- **Cuándo:** `main.ts` llama a `loadFiscalCatalogs` después de las migraciones y del aprovisionamiento, antes de aceptar peticiones.
- **Pasos**, en una transacción con advisory lock `fiscal-catalogs:load`:
  1. leer y validar todos los archivos;
  2. comparar con lo publicado;
  3. insertar entradas y versiones nuevas;
  4. aplicar las transiciones permitidas;
  5. registrar cada versión de dataset con su checksum.
- **Arranques repetidos:** con los mismos archivos no cambia nada. Un dataset ya cargado con otro checksum, o una versión publicada que difiere, aborta el arranque con un error que nombra el catálogo y la entrada, y no modifica nada.
- **Por qué al arrancar y no en una migración SQL:**
  - el JSON es la única fuente;
  - la inmutabilidad se comprueba en cada arranque;
  - las pruebas cargan los mismos datos en sus esquemas aislados.
  - Una migración generada desde el JSON duplicaría la fuente y no detectaría una edición posterior del archivo.
- **Lo que queda en el registro:** la carga no audita por empresa (spec de auditoría). Registra en el log las versiones cargadas y el número de entradas nuevas.
- **Consumidor final:** `ensureSystemParties` crea uno por cada empresa que no lo tenga, con `ON CONFLICT DO NOTHING` (D10).

### D6. Modelo tributario: IVA, ICE e IRBPNR

Las tarifas no se reducen a `percentage: number`. Cada entrada de los catálogos de tarifas lleva:

- **Comunes:** `taxKind` (`IVA`, `ICE` o `IRBPNR`), el código SRI del impuesto (`2`, `3` o `5`, coherente con el dataset de impuestos) y `code`, el código de porcentaje del XML.
- **IVA:** `rateKind`, que puede ser:
  - `PERCENTAGE`, con `percentage` decimal de escala 2 (0, 12, 14, 15, 5 y 13);
  - `NOT_SUBJECT` (código 6);
  - `EXEMPT` (código 7);
  - `DIFFERENTIATED` (código 8), sin porcentaje fijo, porque su tarifa la fija un decreto (nota 3 de la ficha). Para emitir con el código 8 hará falta una política con fuente; lo decidirá la emisión.
- **ICE:** `rateKind` = `PER_NORMATIVE`. Lleva código y descripción oficiales, sin tarifa. La ficha publica tarifas de 2023 "referenciales" y remite a la normativa vigente: no se transcriben como vigentes. El modelo admite después componentes `adValorem` (porcentaje) y `specificAmount` con su unidad, con vigencia y fuente legal, en una versión posterior del dataset.
- **IRBPNR:** `rateKind` = `PER_UNIT`, con el código 5001 y un `unitAmount` nulo hasta transcribir su fuente legal.
- **Impuestos de un producto:** `product_tax` guarda una fila por impuesto, con el `taxKind` y la entrada referida.
  - Exactamente una de IVA, como mucho una de ICE y como mucho una de IRBPNR, y la de IRBPNR solo en bienes.
  - Un `CHECK` garantiza que el `taxKind` coincide con el catálogo de la entrada.
- **Límite de este cambio:** la representación queda completa y los productos pueden llevar ICE e IRBPNR. Calcular esos impuestos exige que la emisión disponga de sus tarifas con fuente legal; queda como obligación en `fiscal-emission.md`.

### D7. Política decimal y de dinero

- **Dominio:** `decimal.js` 10.6.0, como dependencia directa del backend con versión exacta. Es la misma biblioteca que Prisma usa para `Decimal`.
  - Se envuelve en `platform/decimal`, que configura una instancia propia (precisión 40, `ROUND_HALF_UP`).
  - Ofrece tres objetos de valor que validan escala y rango: `UnitPrice` (de 0 a 999 999 999 999.999999), `Percentage` (escala 2, de 0 a 100) y `MoneyAmount` (escala 2, no negativo).
  - Ningún importe ni tarifa pasa por `number`.
- **PostgreSQL:**
  - precio unitario `NUMERIC(18,6)`;
  - porcentajes de IVA `NUMERIC(5,2)`;
  - montos de política `NUMERIC(14,2)`;
  - componentes futuros de ICE e IRBPNR, `NUMERIC(18,6)`;
  - todos con `CHECK` de no negativo.
  - Prisma devuelve `Decimal`, y el repositorio lo convierte a `decimal.js` mediante su texto.
- **JSON:**
  - Los decimales viajan como cadenas.
  - Al recibir:
    - patrón `^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$` para el precio, y el equivalente por campo para los demás;
    - sin signo, exponente, separador de miles, coma decimal, ceros a la izquierda ni espacios;
    - un valor numérico JSON se rechaza, porque ya pasó por coma flotante.
  - Al devolver: la forma canónica más corta y exacta, sin exponente ni ceros finales (`12.5`, `0.000001`, `12`).
  - El helper `decimalString({ integerDigits, scale })` de `packages/contracts` define cada campo y sus mensajes.
- **Redondeo:**
  - Nunca al recibir: más decimales de los admitidos es un error de validación.
  - Los catálogos y los productos guardan valores exactos.
  - El único redondeo del producto lo hará el motor de emisión: half-up por línea a la escala del campo XSD, y totales con valores ya redondeados (Q-14, pendiente del spike S-3), con la función `roundHalfUp(scale)` de `platform/decimal`.
  - La emisión recibe valores ya normalizados por esta política.
- **Frontend:**
  - Un campo de texto con `inputMode="decimal"` que valida con el mismo helper de contratos.
  - Se muestra con un formateador de cadenas que agrupa la parte entera con la convención es-EC sin convertir a `number`.
  - Las operaciones aritméticas de la interfaz, como las previsualizaciones de totales, no son de este cambio.

### D8. Habilitación por empresa

- **Almacenamiento:** `company_fiscal_catalog_setting (company_id, catalog_type, entry_key, enabled, version, updated_at, updated_by)`, con clave primaria compuesta y clave foránea a la identidad de la entrada.
  - Sin fila vale el valor por defecto del catálogo (D2).
  - Solo admiten fila los catálogos habilitables: un `CHECK` lo garantiza y la API responde `400 FISCAL_CATALOG_NOT_ENABLEABLE` para los demás.
- **Cambio:** `PUT …/enablement { enabled }` es un estado deseado:
  1. inserta la fila con el valor por defecto (`ON CONFLICT DO NOTHING`);
  2. la bloquea `FOR UPDATE`;
  3. si cambia, la actualiza y audita en la misma transacción;
  4. si no cambia, responde `200` sin auditar.
- **Efectos:**
  - una entrada deshabilitada no se ofrece en los formularios ni se acepta en altas o correcciones de productos;
  - los productos que ya la usan figuran como pendientes de revisión;
  - los datos oficiales y lo ya registrado no cambian.

### D9. Terceros

- **Campos:**
  - tipo y número de identificación;
  - razón social o nombres (1–300);
  - dirección (hasta 300), correo (hasta 300, formato de correo) y teléfono (hasta 50, sin saltos de línea), todos opcionales;
  - roles como conjunto de `CUSTOMER`, `SUPPLIER` y `CARRIER`, que puede estar vacío;
  - estado `ACTIVE` o `INACTIVE`, versión y auditoría de creación y modificación.
  - Los textos se normalizan a NFC y se recortan, igual que en `taxpayer`.
- **Identificación:**
  - Las reglas por tipo son reglas del protocolo en el dominio, a partir del XSD y de las tablas 5 y 6 de la ficha:
    - `04`: `^[0-9]{10}001$`;
    - `05`: `^[0-9]{10}$`;
    - `06` y `08`: de 1 a 20 caracteres sin saltos de línea;
    - `07`: reservado al sistema.
  - No hay algoritmo de dígito verificador (ERS RF-322, CTX §9.1).
  - El tipo debe existir en el dataset de tipos de identificación vigente.
- **Unicidad:** `UNIQUE (company_id, identification_type, identification_number)`.
  - Una violación responde `409 PARTY_IDENTIFICATION_TAKEN`, con el identificador y el nombre del tercero existente de la misma empresa.
- **Corrección:** `PUT` con `expectedVersion`. El `UPDATE` filtra por versión; si no actualiza nada, responde `409 PARTY_CHANGED`, o `404` si no existe.
- **Búsqueda:** una columna `search_text` guarda la razón social en minúsculas, sin tildes y normalizada (NFD sin diacríticos), calculada por la aplicación. No hace falta la extensión `unaccent`.
  - El texto de búsqueda pasa por la misma normalización.
  - Hay coincidencia si la identificación empieza por el texto o si `search_text` contiene el texto.
  - Filtros: estado (`ACTIVE` por defecto, `INACTIVE` o `ALL`) y rol.
  - El orden es por razón social y luego por identificador.
- **Estado:** `PUT /parties/{id}/status { status }` es un estado deseado: repetirlo no cambia nada ni audita.

### D10. Consumidor final

- **Registro:** una fila de `party` marcada `system_kind = 'CONSUMER_FINAL'`, con el tipo `07`, la identificación `9999999999999` y la razón social `CONSUMIDOR FINAL` (tabla 6 y ejemplos de la ficha). Tiene el rol cliente.
- **Unicidad:** la columna `consumer_final_company_id`, única y solo con valor en esa fila, garantiza uno por empresa. Prisma no admite índices únicos parciales; es el mismo patrón que `active_company_id` en las firmas.
  - Un `CHECK` exige que `system_kind = 'CONSUMER_FINAL'` equivalga al tipo `07` con la identificación `9999999999999`, y viceversa. Así ningún tercero normal puede tener el tipo `07`.
- **Protección:** un trigger rechaza `UPDATE` y `DELETE` de esa fila. La API responde `409 PARTY_SYSTEM_RECORD` antes de llegar a la base de datos.
  - En el MVP no hay campos editables. Si una regla del producto lo pidiera, por ejemplo la dirección, se permitiría con un cambio explícito.
- **Creación:** `ensureSystemParties` al arrancar, después del aprovisionamiento. Es idempotente y segura ante arranques simultáneos gracias a la columna única. La migración la incluye también para las empresas ya existentes.
- **Reconocimiento:** el dominio y la API lo reconocen por `systemRecord: "CONSUMER_FINAL"`, nunca comparando el nombre ni la identificación en el código de negocio.
  - Aparece en las búsquedas como cualquier tercero activo, marcado "Del sistema" y sin acciones.
- **Fuera de este cambio:** el límite de USD 50 y las restricciones por tipo de comprobante se aplican en la emisión.

### D11. Productos

- **Campos:**
  - código principal y auxiliar, opcionales (1–25, sin saltos de línea);
  - nombre (1–300), que será la `descripcion` del XML;
  - descripción interna opcional (hasta 1000), que no va al XML;
  - tipo `GOOD` o `SERVICE`;
  - precio unitario (D7);
  - impuestos (D6);
  - control de stock;
  - estado, versión y auditoría.
- **Unicidad:** `UNIQUE (company_id, main_code)`. PostgreSQL trata los nulos como distintos, así que los productos sin código no chocan y no hace falta un índice parcial. Una violación responde `409 PRODUCT_MAIN_CODE_TAKEN`.
- **Reglas de alta y corrección:**
  - una tarifa de IVA;
  - como mucho un ICE y un IRBPNR;
  - IRBPNR solo en bienes, o `400 IRBPNR_GOODS_ONLY`;
  - control de stock solo en bienes: `CHECK` y `400 STOCK_CONTROL_GOODS_ONLY`;
  - cada entrada referida debe estar habilitada para la empresa y vigente hoy, o `400 TAX_ENTRY_UNAVAILABLE`, con el impuesto afectado.
  - Las filas de `product_tax` se reemplazan en la misma transacción que el producto.
- **Señal de revisión:** la vista del producto lleva `taxReview: { required, reasons[] }`, derivado al leer: hay una entrada deshabilitada o no vigente hoy. La señal no bloquea la consulta ni la corrección, y la emisión la tratará como bloqueante.
- **Búsqueda:** `search_text` guarda el nombre normalizado. Hay coincidencia si el código principal o el auxiliar empiezan por el texto, o si `search_text` contiene el texto. Filtro de estado como en terceros.
- **Corrección y estado:** como en terceros, con `PRODUCT_CHANGED`.

### D12. Registro de esquemas: dueño y alcance

- **Dueño:** `catalogs` es dueño de los datos del registro: `schema_registry_entry`, cargado desde su dataset con los mismos campos que el manifiesto de `docs/product/sri-xsd/`, más `supported`.
- **Consumidor:** `sri-engine` y el motor fiscal lo usarán en `add-invoice-emission` para registrar los XSD en la librería (ADR 0008) y para el snapshot. Se corrige `ARCHITECTURE.md`, que situaba el registro en `fiscal/xml/`: allí vive su uso, no sus datos.
- **Verificación:** una prueba compara el dataset con el manifiesto y con el SHA-256 de cada archivo (spec "Archivo que no coincide con su hash").
  - Empaquetar los XSD en la imagen y verificarlos al arrancar es de la emisión, junto con el spike S-2.
  - Las seis versiones soportadas son las de CTX §3.1.

### D13. Matriz de casos especiales

`special_case_support` se carga desde su dataset con el número de anexo, el tema (título de la
ficha), la categoría del ADR 0014 y la fuente. Es solo de lectura. La emisión la aplicará antes de
reservar (`fiscal-emission.md`, paso 1).

### D14. Contrato común de búsqueda y paginación

- `packages/contracts/src/pagination.ts` define:
  - `searchParam`: recorte, hasta 100 caracteres y opcional;
  - `pageParams`: `page` desde 1 y `pageSize` de 1 a 100, 25 por defecto, con coerción desde la query;
  - `listMetaSchema`: `{ page, pageSize, total }`.
- `users.ts` pasa a construirse con esas piezas, con los mismos nombres exportados y el mismo comportamiento. Una prueba de contrato fija que no cambia.
- Las consultas no son estrictas: un `companyId` en la query se ignora, como en usuarios. Los cuerpos sí son estrictos.
- La paginación es por desplazamiento (`OFFSET`), con un `COUNT` sobre el mismo filtro. Con el volumen de referencia (D18) basta; el cursor queda para cuando una medición lo pida.

### D15. API

Todo bajo `/api/v1` (ADR 0015), con contratos en `packages/contracts` y OpenAPI regenerado.

| Ruta | Permiso | Notas |
| --- | --- | --- |
| `GET /parties` | `parties.read` | `search`, `status`, `role`, `page`, `pageSize`; `meta` con el total. |
| `POST /parties` | `parties.manage` | `201`; identificación repetida `409`. |
| `GET /parties/{partyId}` | `parties.read` | `404` fuera de la empresa. |
| `PUT /parties/{partyId}` | `parties.manage` | Con `expectedVersion`; `409 PARTY_CHANGED`; `409 PARTY_SYSTEM_RECORD`. |
| `PUT /parties/{partyId}/status` | `parties.changeStatus` | Estado deseado. |
| `GET /products`, `POST /products`, `GET /products/{productId}`, `PUT /products/{productId}`, `PUT /products/{productId}/status` | `products.read`, `products.manage`, `products.changeStatus` | Mismo patrón que terceros. |
| `GET /fiscal-catalogs` | `fiscalCatalogs.read` | Catálogos con versión del dataset, fuente y si admiten habilitación. |
| `GET /fiscal-catalogs/{catalogType}/entries` | `fiscalCatalogs.read` | `at` (fecha, hoy por defecto) y `enabled`. Devuelve cada entrada con sus versiones, si está vigente en `at` y si está habilitada para la empresa. |
| `PUT /fiscal-catalogs/{catalogType}/entries/{entryKey}/enablement` | `fiscalCatalogs.manage` | `{ enabled }`; `400` si el catálogo no es habilitable. |
| `GET /fiscal-catalogs/consumer-final-policy` | `fiscalCatalogs.read` | Versiones de la política. |
| `GET /fiscal-catalogs/schemas` | `fiscalCatalogs.read` | Registro de esquemas. |
| `GET /fiscal-catalogs/special-cases` | `fiscalCatalogs.read` | Matriz. |

No hay rutas para crear o modificar entradas oficiales, la política, el registro o la matriz: esas
peticiones reciben `404`, como cualquier ruta inexistente (spec "Datos oficiales no modificables").

### D16. Permisos

Se añaden al mapa central (`identity/domain/access-policy.ts`) y a su espejo en el frontend:
`parties.read`, `parties.manage`, `parties.changeStatus`, `products.read`, `products.manage`,
`products.changeStatus`, `fiscalCatalogs.read` y `fiscalCatalogs.manage`.

- `ADMIN` tiene todos.
- `OPERATOR` tiene `*.read`, `parties.manage` y `products.manage`.

Confirma las filas propuestas de `access-control.md` ("Crear y editar terceros y productos" y
"Desactivar terceros y productos") y añade la de habilitar catálogos.

### D17. Auditoría

Acciones nuevas en `audit`, escritas en la misma transacción que el cambio:

| Acción | Cuándo | `changes` |
| --- | --- | --- |
| `party.created` | Alta | Identificación, razón social y roles. |
| `party.updated` | Corrección que cambia algo | Identificación, razón social y roles, con su valor anterior y el nuevo. Para dirección, correo y teléfono, solo la lista de campos cambiados (`contactFieldsChanged`). |
| `party.deactivated`, `party.reactivated` | Transición real | Identificación. |
| `product.created` | Alta | Códigos, nombre, tipo, precio e impuestos (catálogo y `entryKey`). |
| `product.updated` | Solo si cambian el precio o los impuestos | Precio e impuestos, con su valor anterior y el nuevo. Un cambio que solo toca el nombre, la descripción, los códigos o el control de stock no se audita, como pide la spec. |
| `product.deactivated`, `product.reactivated` | Transición real | Código principal y nombre. |
| `fiscal_catalog.entry_enabled`, `fiscal_catalog.entry_disabled` | Transición real | Catálogo, `entryKey` y código. |

No se auditan las lecturas, las búsquedas, la carga de datasets ni el aseguramiento del
consumidor final. Este último es un dato del sistema creado al arrancar, como el aprovisionamiento
del sistema.

### D18. Rendimiento y volumen de referencia (Q-26)

- **Volumen:** este cambio adopta como volumen de referencia el que propone Q-26: 10 000 terceros y 10 000 productos por empresa. Q-26 pasa a parcial: el volumen de comprobantes y de usuarios concurrentes sigue pendiente para la emisión.
- **Índices:** btree `(company_id, identification_number)`, `(company_id, main_code)` y `(company_id, auxiliary_code)`, más los únicos.
  - La búsqueda por nombre (`search_text LIKE '%texto%'`) recorre las filas de la empresa. Con 10 000 filas cuesta milisegundos.
- **Prueba de rendimiento:** siembra el volumen en un esquema aislado y mide las búsquedas típicas (prefijo de identificación, nombre parcial, página 1 y última página) contra la API.
  - El presupuesto es un P95 de 300 ms por petición, dentro del objetivo de ERS RNF-005 (pantalla bajo 2 s).
  - Si no lo cumple, se añaden índices `pg_trgm`, como prevé `database.md`.

### D19. Interfaz

Tres destinos nuevos:

- `Terceros` (`/terceros`) y `Productos` (`/productos`) en la navegación principal, con `parties.read` y `products.read`.
- `Catálogos fiscales` (`/configuracion/catalogos-fiscales`) en `Configuración`, con `fiscalCatalogs.read`.
- Primitivas nuevas en `components/ui`: `Switch` (Radix), para la habilitación, que aplica al momento, y `Checkbox` (Radix), para roles y control de stock, que se envían con el formulario (`component-selection.md`).

**Terceros**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador u operador. |
| Objetivo | Encontrar al cliente o proveedor correcto, o registrarlo una vez. |
| Decisión principal | Reutilizar un tercero existente o registrar uno nuevo. |
| Información mínima | Identificación (tipo y número), razón social, roles y estado. |
| Acción principal | `Nuevo tercero`. |
| Frecuencia y riesgo | Frecuente; riesgo medio: una identificación errónea produce comprobantes con el receptor equivocado. |

- **P0:** búsqueda, lista con identificación y razón social, y `Nuevo tercero`.
- **P1:** roles, filtro de estado y rol, y corregir.
- **P2:** correo y teléfono en el detalle del formulario, y desactivar o reactivar (solo administrador, `ConfirmDialog` de un paso).
- **P3:** historial de cambios, fuera.
- **Componentes:**
  - `AppDataTable` con paginación de servidor, que en móvil muestra tarjetas;
  - `FormDialog` con `Select` de tipo de identificación (4 opciones) y `Checkbox` de roles.
  - El consumidor final aparece con un `StatusBadge` "Del sistema" y sin acciones.
- **Errores:** la identificación repetida se muestra en su campo, con el nombre del tercero existente. Un conflicto de versión ofrece `Recargar`.

**Productos**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador u operador. |
| Objetivo | Tener cada ítem facturable con su precio e impuestos correctos. |
| Decisión principal | Qué tarifa de IVA, y si lleva ICE o IRBPNR. |
| Información mínima | Código principal, nombre, precio, IVA y la señal de revisión. |
| Acción principal | `Nuevo producto`. |
| Frecuencia y riesgo | Frecuente al iniciar, después ocasional; riesgo alto: un impuesto erróneo se repite en cada factura. |

- **P0:** búsqueda, lista con código, nombre, precio e IVA, la señal "Revisar impuestos" y `Nuevo producto`.
- **P1:** tipo, ICE, IRBPNR y corregir.
- **P2:** código auxiliar, control de stock, descripción y desactivar o reactivar.
- **P3:** historial, fuera.
- **Formulario:**
  - `SegmentedControl` bien o servicio;
  - campo decimal de precio;
  - `Select` de IVA, con las tarifas habilitadas y vigentes;
  - `Select` de ICE con "Sin ICE", con las habilitadas;
  - `Checkbox` de IRBPNR y de control de stock, visibles solo para bienes.
- **Sin entradas habilitadas:** si no hay ninguna de ICE, el campo explica que se habilitan en `Catálogos fiscales` (enlace solo para el administrador).
- **Excepción declarada:** `Select` nativo para ICE aunque haya más de 15 habilitados. Lo normal son de 1 a 3, y el combobox con búsqueda se construye cuando lo pida un caso real.

**Catálogos fiscales**

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador (cambia); operador (consulta). |
| Objetivo | Usar solo las entradas oficiales que corresponden a la empresa y saber de dónde salen. |
| Decisión principal | Qué tarifas y formas de pago habilitar. |
| Información mínima | Por entrada: código, descripción oficial, vigencia y habilitada. Por catálogo: fuente y versión. |
| Acción principal | El `Switch` de cada entrada; no hay un botón focal. |
| Frecuencia y riesgo | Rara; riesgo medio: deshabilitar una tarifa en uso marca productos para revisión. |

- **P0:** tarifas de IVA y formas de pago, con `Switch`.
- **P1:** ICE (con filtro de texto local sobre sus 75 filas) e IRBPNR, y la fuente con su versión.
- **P2:** tipos de identificación, política de consumidor final, matriz de casos especiales y registro de esquemas, en secciones de solo lectura.
- **P3:** historial de versiones de los datasets, fuera.
- **Respuesta de los `Switch`:** se deshabilita mientras guarda y confirma con un toast. Deshabilitar una tarifa usada por productos avisa cuántos quedan pendientes de revisión.

Las tres pantallas cubren carga, vacío, error con reintento, sin permiso, móvil a 375 y 320 px con
objetivos de 44 px, teclado y ambos temas, y se recorren con `frontend-checklist.md` (`ui-review.md`).

### D20. Pruebas

- **Unitarias:**
  - política decimal: patrones, rechazo de `number`, canónica y redondeo half-up;
  - reglas de identificación por tipo;
  - resolución de vigencia en los bordes;
  - transiciones permitidas de un dataset;
  - normalización de búsqueda.
- **Datasets:**
  - esquema Zod de cada archivo;
  - manifiesto contra archivos;
  - valores críticos fijados (IVA, formas de pago y consumidor final);
  - registro de esquemas contra los XSD.
- **Cargador:** idempotencia, rechazo de una alteración sin modificar nada, transiciones permitidas y arranques simultáneos.
- **Integración de la API con dos empresas:**
  - altas y correcciones;
  - unicidad y altas simultáneas;
  - versión esperada;
  - consumidor final protegido;
  - habilitación con auditoría y concurrencia;
  - impuestos disponibles y señal de revisión;
  - permisos;
  - aislamiento;
  - `companyId` rechazado;
  - auditoría sin datos de contacto.
- **Contrato con `facturacion-electronica-ec`:** en `sri-engine`, un adaptador de prueba expone sus catálogos y una prueba compara los valores coincidentes (tipos de identificación, formas de pago, códigos de IVA).
  - Las divergencias conocidas quedan listadas: la librería no tiene los códigos 5 ni 10 y mapea el 8 a una tarifa. La prueba falla con cualquier divergencia nueva.
  - Nunca adopta el valor de la librería.
- **Rendimiento:** D18.
- **End-to-end contra `main.ts`:**
  1. arranque con los datasets cargados;
  2. un tercero;
  3. un producto con IVA;
  4. deshabilitar la tarifa marca el producto;
  5. consumidor final protegido;
  6. operador sin desactivar;
  7. auditoría.
- **Interfaz:** pruebas de componentes de las tres pantallas y recorrido contra el backend real.

### D21. Datos y migración

- **Migración:** una sola migración crea:
  - `fiscal_catalog_dataset`, `fiscal_catalog_key`, `fiscal_catalog_entry` (con las columnas tributarias de D6 y sus `CHECK` por catálogo), `consumer_final_policy`, `schema_registry_entry` y `special_case_support`;
  - `company_fiscal_catalog_setting`, `party`, `product` y `product_tax`;
  - los únicos, las claves foráneas compuestas por empresa, los `CHECK` y los triggers:
    - sin `DELETE` ni `TRUNCATE` en las tablas del sistema;
    - en `UPDATE` de entradas, solo las transiciones de D4;
    - sin solapamiento de versiones;
    - consumidor final inmutable.
  - Incluye también la inserción del consumidor final de las empresas existentes.
- **Datos:** las tablas de catálogo empiezan vacías y las llena el cargador (D5) en el primer arranque de la versión.
- **Marcha atrás:** revertir la versión deja las tablas sin uso. Los terceros y productos se conservan.

### D22. Relación con `facturacion-electronica-ec`

El ADR 0018 sigue aplicando: `catalogs` no importa la librería. La única relación es la prueba de
contrato de D20, en `sri-engine`. Una divergencia se investiga contra la ficha, y si nuestro dataset
está bien, se documenta.

## Risks / Trade-offs

- [Error de transcripción de la ficha] → Manifiesto con la fuente y su hash, `sourceRef` por entrada, valores críticos fijados en pruebas y revisión de la transcripción en la tarea del dataset.
- [Vigencias desconocidas en la fuente (tablas 6 y 17)] → `effectiveFromBasis = SOURCE_VERSION_DATE` lo hace explícito. El MVP no emite comprobantes anteriores a su instalación.
- [La ficha no publica tarifas vigentes de ICE ni la tabla de IRBPNR] → Entradas `OFFICIAL_REFERENCE` sin tarifa: los productos pueden referenciarlas y la emisión no calculará esos impuestos sin un dataset con fuente legal (obligación en `fiscal-emission.md`).
- [Códigos repetidos en la tabla 18] → `entryKey` con variante, y `code` para el XML.
- [La tarifa del 12 % sigue en la tabla 17 aunque la general es del 15 %] → El catálogo refleja la fuente: el sistema no determina obligaciones tributarias (BR-02). La empresa deshabilita lo que no usa.
- [Carga al arrancar en varias instancias] → Advisory lock y transacción. Un dataset alterado detiene el arranque en lugar de corregir datos.
- [Búsqueda por nombre sin índice] → Prueba con el volumen de referencia y `pg_trgm` solo si no cumple (D18).
- [Tamaño del cambio: tres capacidades, tres pantallas y la política decimal] → Grupos de tareas independientes y verificables, en el orden catálogos, terceros, productos e interfaz. Se puede dividir en `add-fiscal-catalogs` y `add-parties-and-products` sin cambiar este diseño.
- [`Select` nativo para muchos códigos de ICE] → Excepción declarada; el combobox llega cuando lo pida un caso real.

## Migration Plan

1. Desplegar la versión: la migración crea las tablas y el consumidor final de las empresas existentes, y el primer arranque carga los datasets.
2. Sin pasos manuales ni configuración nueva.
3. Marcha atrás: volver a la versión anterior. Las tablas nuevas quedan sin uso.

## Open Questions

- Tarifas de ICE e IRBPNR con fuente legal: qué normativa se transcribe y cuándo. Lo decide la emisión antes de calcularlas; no cambia este diseño.
- Política del IVA diferenciado (código 8): su porcentaje la fija un decreto. Lo decide la emisión.
