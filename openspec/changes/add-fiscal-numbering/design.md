# Design

## Context

Ver `proposal.md` (Why) y las specs `fiscal-numbering` y `audit-trail` de este cambio.

Estado que condiciona el diseño:

- `add-taxpayer-setup` dejó:
  - establecimientos y puntos con códigos de tres dígitos inmutables (trigger), disponibilidad (punto y establecimiento activos) y `UNIQUE (company_id, id)` en ambas tablas;
  - el ambiente vigente en la versión de configuración;
  - un repositorio de establecimientos con `findPointWithEstablishment` y `list`;
  - el patrón de unidad de trabajo con la auditoría en la misma transacción.
- ADR 0003, enmendado por Q-02: un contador por empresa, ambiente, establecimiento, punto y tipo; reserva atómica con bloqueo de fila; unicidad con el ambiente; nada reservado vuelve al contador.
- `fiscal-emission.md` fija que la emisión reservará el secuencial dentro de la misma transacción que la transición desde `DRAFT` (paso 2). Un rollback antes del commit no consume número; después del commit, el número pertenece al comprobante para siempre (Q-01, Q-03).
- Los seis códigos de comprobante (`01`, `03`, `04`, `05`, `06`, `07`) son datos estructurales estables del protocolo, que deben quedar encapsulados (CTX §56).
- `pg` abre como máximo 10 conexiones por cliente. En `$transaction` de Prisma, `maxWait` (2 s por defecto) es el tiempo máximo para adquirir la transacción, que incluye esperar una conexión libre del pool; `timeout` (5 s por defecto) es la duración máxima de la transacción interactiva, desde que empieza hasta que confirma. La espera por un bloqueo de PostgreSQL ocurre dentro de la transacción y cuenta en `timeout`, no en `maxWait`.
- En este proyecto, el SQL crudo con nombres de tabla no resuelve el esquema aislado de las pruebas. La reserva usa la API de Prisma, cuyo `UPDATE ... RETURNING` bloquea la fila.

## Goals / Non-Goals

**Goals:**

- Que la base de datos impida, por sí sola, un secuencial duplicado o un ajuste que vuelva a un número reservado.
- Una operación de reserva que `add-invoice-emission` invoque dentro de su propia transacción, sin rediseño.
- Un ajuste administrativo que no pierda reservas concurrentes.

**Non-Goals:**

- Ruta HTTP para reservar: solo la emisión reserva, y una ruta pública permitiría consumir números sin comprobante.
- Auditar cada reserva como evento: cada reserva queda en su propio registro (D2), y la emisión auditará la transición del comprobante.
- Alertas de agotamiento cercano: con nueve dígitos no hay un riesgo práctico en el MVP.
- Paginación de la lista (Q-26).

## Decisions

### D1. Módulo `fiscal`

Módulo nuevo `backend/src/modules/fiscal/`, dueño de la numeración y, después, de la emisión (`backend.md`, `database.md`):

- `domain/`: tipos de comprobante (los seis códigos y su orden), formato del secuencial y del número, límites y reglas del ajuste.
- `application/`: consulta, ajuste y la operación interna de reserva; autorizan con el `createAuthorizer` de `identity`.
- `infrastructure/`: repositorios de Prisma, unidad de trabajo y router.

Lee los establecimientos y puntos con el repositorio de `taxpayer` (`list` y `findPointWithEstablishment`), ligado a la misma transacción cuando reserva. No escribe en tablas de `taxpayer`.

### D2. Modelo e invariantes de la clave

**`fiscal_sequence`, un contador:**

| Columna | Regla |
| --- | --- |
| `company_id`, `environment`, `establishment_id`, `emission_point_id`, `document_type` | Clave del contador. `UNIQUE` sobre las cinco columnas. `environment IN ('TEST','PRODUCTION')`. `document_type IN ('01','03','04','05','06','07')`. |
| `next_number` | `CHECK (next_number BETWEEN 1 AND 1000000000)`. `1000000000` significa agotado (D6). |
| `last_reserved` | Mayor número reservado, `NULL` sin reservas. `CHECK (last_reserved IS NULL OR last_reserved BETWEEN 1 AND 999999999)`. |
| — | `CHECK (next_number > COALESCE(last_reserved, 0))`: el siguiente siempre supera al mayor reservado, así que ningún ajuste puede volver a un número reservado. |

**`fiscal_sequence_reservation`, una fila por número reservado, de solo agregado:**

- Contiene la misma clave más `sequential` (1 a 999999999), `reserved_at`, `reserved_by` (usuario, opcional) y `correlation_id`.
- `UNIQUE (company_id, environment, establishment_id, emission_point_id, document_type, sequential)` es la unicidad de CTX §5 en la base de datos, antes de que existan comprobantes.
- `add-invoice-emission` referenciará esta fila desde el comprobante, que repetirá la unicidad como segunda defensa.

**Claves foráneas e invariantes en la base de datos:**

- **Pertenencia del punto:** `(company_id, establishment_id, emission_point_id) → emission_point (company_id, establishment_id, id)`. Requiere una restricción única nueva en `emission_point`; garantiza que el punto pertenece a ese establecimiento y a esa empresa. La reserva referencia además su contador por la clave de cinco columnas.
- **Clave inmutable:** un trigger `BEFORE UPDATE` en `fiscal_sequence` rechaza cambiar cualquiera de las cinco columnas de la clave.
- **Contadores permanentes:** otro trigger rechaza `DELETE` y `TRUNCATE`.
- **Último reservado:** un trigger rechaza que `last_reserved` disminuya o vuelva a `NULL`.
- **Reservas:** su tabla tiene el trigger de solo agregado que ya se usa en la auditoría y la configuración.

`last_reserved` se guarda en el contador en lugar de calcularse con `MAX` sobre las reservas. Así la invariante "siguiente > último reservado" es un `CHECK` de la propia fila. Una prueba comprueba que siempre coincide con el máximo de las reservas.

Alternativa descartada: solo el contador, sin registro de reservas. No dejaría la unicidad de CTX §5 en la base de datos hasta el cambio de emisión, ni la trazabilidad de qué se reservó y cuándo (CTX §28 la incluye).

### D3. Creación del contador: perezosa y segura ante la carrera

Un contador no existe hasta su primera reserva o su primer ajuste. Ambas operaciones empiezan
con la misma creación: `createMany(..., skipDuplicates)`, es decir,
`INSERT ... ON CONFLICT DO NOTHING`, con `next_number = 1`. Después actúan sobre la fila con un
`UPDATE` que la bloquea.

**Estrategia concreta: inserción idempotente más serialización por el bloqueo de la fila.** No
hace falta upsert con reintento:

- Si dos transacciones crean a la vez la misma clave, PostgreSQL deja insertar a la primera. La segunda espera en el índice único a que la primera confirme o revierta: si confirma, no hace nada; si revierte, inserta ella. Nunca se produce un error de restricción única, así que ninguno llega al dominio ni al cliente.
- El `UPDATE` posterior de cada transacción espera el bloqueo de la fila. En READ COMMITTED vuelve a evaluar su condición sobre la versión confirmada más reciente, de modo que cada operación ve el efecto completo de la anterior.

Resultados de dominio previstos para cada carrera:

| Carrera | Resultado |
| --- | --- |
| A. Muchas primeras reservas sobre una clave sin contador | Se crea un único contador y las reservas reciben 1, 2, 3… sin duplicados. |
| B. Primera reserva y primer ajuste sobre una clave sin contador | Si la reserva confirma antes, recibe el 1 y el ajuste (preparado viendo 1) se rechaza con `409 SEQUENCE_CHANGED`. Si el ajuste confirma antes, la reserva recibe el valor ajustado. |
| C. Reserva y ajuste sobre un contador existente | Igual que B con el valor vigente: el ajuste solo se aplica si el siguiente sigue en el valor que el administrador vio, y la reserva recibe el siguiente vigente en ese instante. |

En ningún caso se asigna un número dos veces ni se viola `next_number > last_reserved`. Las
pruebas de 3.x cubren A, B y C con órdenes deterministas (una transacción retenida antes de
confirmar) y con ejecuciones simultáneas repetidas.

- La consulta muestra los contadores que aún no existen con su valor inicial (siguiente 1, sin reservados), combinando los puntos de la empresa con las filas existentes.

Alternativa descartada: crearlos de forma ansiosa, 12 por punto (6 tipos × 2 ambientes), al crear cada punto. Acoplaría `taxpayer` a `fiscal`, exigiría rellenar los puntos existentes y crearía filas que muchos tipos nunca usan. Lo observable es igual en ambas.

### D4. Reserva atómica

Operación interna `reserveSequentialIn(scope, { companyId, environment, establishmentId, emissionPointId, documentType, reservedBy, correlationId })`. Corre dentro de una transacción abierta, la de la emisión. Para las pruebas existe además `createSequentialReservation(uow).reserve(...)`, que abre la suya. La transacción contiene solo operaciones de base de datos, sin I/O externo.

Pasos, dentro de la transacción y en este orden:

1. **Comienzo de la reserva:** lee el punto por empresa, establecimiento e identificador.
   - Si no existe: `404 EMISSION_POINT_NOT_FOUND`.
   - Si él o su establecimiento están inactivos: `409 EMISSION_POINT_UNAVAILABLE`, sin tocar el contador.
2. **Creación perezosa** del contador (D3).
3. **Incremento:** `update` con `where` sobre la clave y `next_number <= 999999999`, y `data: { nextNumber: { increment: 1 } }`. El `UPDATE ... RETURNING` toma el bloqueo de la fila hasta el fin de la transacción, y el número reservado es `nuevo − 1`. Si ninguna fila cumple el `where` (Prisma `P2025`), el contador está agotado, porque el paso 2 garantiza que existe: se traduce a `409 SEQUENCE_EXHAUSTED`, nunca a un error interno.
4. **Último reservado:** `update` de `last_reserved` al número reservado, sobre la fila ya bloqueada.
5. **Registro:** `create` de la fila de reserva.

**Desactivación concurrente del punto: semántica definida.**

- La reserva *comienza* en el paso 1, que es la primera sentencia de su transacción. En READ COMMITTED esa sentencia ve exactamente lo confirmado antes de ejecutarse.
- Una reserva que comenzó con el punto y su establecimiento activos se completa aunque una desactivación se confirme mientras está en curso. La desactivación no espera a la reserva ni la reserva a la desactivación, porque no comparten filas que se escriban.
- Una reserva que comienza después de confirmada la desactivación la ve y se rechaza en el paso 1, antes de tocar el contador, sin consumir número.
- Así la regla es determinista sin bloquear la configuración. Una prueba concurrente la cubre: una reserva retenida antes de confirmar mientras otra conexión desactiva el punto y confirma.

**Qué significa "reservado".**

- Un número está reservado cuando la transacción que contiene los pasos 3 a 5 se confirma.
- Si esa transacción se revierte antes del commit, todavía no ha reservado nada: el contador, `last_reserved` y la fila de reserva se revierten, y el número se asignará en la siguiente reserva confirmada.
- Tras el commit, nada lo devuelve. Ni la reserva ni el ajuste pueden bajar `next_number` a un número igual o menor que `last_reserved` (`CHECK`). Una falla posterior de firma, generación, envío al SRI u otra operación deja un hueco, que se tolera (CTX §28.1, Q-03).

**Obligación para `add-invoice-emission`:** no debe tratar el número como reservado fuera de la transacción hasta que la reserva se haya confirmado. No puede:

- devolverlo al cliente ni registrarlo como reservado;
- construir, firmar ni enviar el XML con él;
- exponerlo de ninguna otra forma antes del commit.

Queda escrito en `fiscal-emission.md` (tarea 3.6).

### D5. Concurrencia con más de 100 reservas

- Todas las reservas de un mismo contador se serializan en el bloqueo de su fila, también entre procesos e instancias, porque el bloqueo es de PostgreSQL. Contadores distintos no se bloquean entre sí.
- **Tiempos de la transacción:**
  - `maxWait` limita cuánto espera la reserva para adquirir su transacción (conexión del pool incluida);
  - `timeout` limita cuánto puede durar la transacción una vez iniciada;
  - la espera por el bloqueo de la fila ocurre dentro de la transacción y consume `timeout`.

  Ninguno de estos valores es un requisito funcional.
- **Configuración:** la reserva parte de los valores por defecto de Prisma. Solo se cambian si la prueba de AC-04 muestra que no bastan con margen, y entonces se registran el valor elegido y la medición que lo justifica. La transacción se mantiene mínima (cinco sentencias, sin I/O externo) para que el tiempo de bloqueo por reserva sea el menor posible.
- **Prueba de ERS AC-04:**
  - Escenario: 120 reservas simultáneas repartidas entre dos clientes de Prisma independientes, que simulan dos instancias con su propio pool. Se ejecuta sobre un contador que aún no existe (carrera A de D3) y sobre uno existente.
  - Debe cumplir: 120 números distintos y consecutivos del 1 al 120, un único contador, `last_reserved = 120`, `next_number = 121` y 120 filas de reserva.
  - Variante: con fallos inyectados después de la confirmación, el resultado sigue sin duplicados.
  - Se registran la duración total y la espera máxima de una reserva, como referencia de RNF-003. La configuración y la medición finales se anotan en este diseño durante el apply.
- La restricción única de la reserva respalda cualquier error de código: un duplicado fallaría la transacción en lugar de asignarse.

### D6. Límite de nueve dígitos y estado agotado

- El último secuencial válido es `999999999`. Internamente, el contador admite `next_number = 1000000000` como valor centinela de agotado, que deja reservar el `999999999`. Ese valor nunca es un secuencial: el formato solo acepta de 1 a 999999999.
- La siguiente reserva falla en el paso 3 con `409 SEQUENCE_EXHAUSTED`: "Se agotó la numeración de {tipo} en el punto {EEE-PPP} ({ambiente}). Crea otro punto de emisión para seguir emitiendo."
- El contador nunca se reinicia.
- **El centinela no sale del dominio:**
  - la vista de la API devuelve `exhausted: true` y `nextNumber: null`, nunca `1000000000`, con `lastReserved: 999999999`;
  - la pantalla muestra "Agotado";
  - el esquema del ajuste acepta `expectedNextNumber` solo de 1 a 999999999.
- Ajustar un contador agotado responde `409 SEQUENCE_EXHAUSTED`: no hay ningún valor válido que supere al último reservado.
- El modelo objetivo de `database.md` (`CHECK (next_number BETWEEN 1 AND 999999999)`) se corrige a este rango.

### D7. Ambientes

- El ambiente forma parte de la clave. Cambiar de ambiente no toca ningún contador: cada ambiente continúa su secuencia.
- La reserva recibe el ambiente como parámetro; la emisión pasará el del snapshot.
- La consulta y el ajuste trabajan sobre el ambiente que el administrador elige. La pantalla parte del ambiente vigente.

### D8. Puntos no disponibles

- La reserva se rechaza (D4, paso 1), en coherencia con `taxpayer-setup` ("Desactivar un punto impide emitir desde él").
- El ajuste sí se permite, para preparar la numeración antes de reactivar un punto. Solo exige que el punto exista en la empresa y bajo ese establecimiento.
- La consulta lista también los puntos no disponibles, con su estado.

### D9. Ajuste

`PUT /api/v1/establishments/:establishmentId/emission-points/:emissionPointId/sequences/:environment/:documentType` con `{ nextNumber, expectedNextNumber, reason? }`:

1. **Permiso:** `sequences.adjust`. Después, la pertenencia del punto a la empresa y al establecimiento: `404` con evento de seguridad (`missingResource`).
2. **Validación con Zod:**
   - `nextNumber` y `expectedNextNumber`, enteros de 1 a 999999999;
   - `reason` de 1 a 300 caracteres de una línea;
   - si `nextNumber < expectedNextNumber`, el motivo es obligatorio: "Retroceder el secuencial exige un motivo."
3. **Transacción:**
   - Crea el contador de forma perezosa (D3).
   - Un contador agotado responde `409 SEQUENCE_EXHAUSTED`.
   - Si `nextNumber === expectedNextNumber` y el contador sigue en ese valor, no hay cambio ni evento.
   - Si no, ejecuta un `updateMany` condicional con `where { clave, nextNumber: expectedNextNumber, OR: [lastReserved null, lastReserved < nextNumber] }`.
   - Con `count === 0` relee la fila:
     - si el siguiente cambió: `409 SEQUENCE_CHANGED`, "El secuencial cambió mientras lo editabas. Recarga para ver el valor vigente.";
     - si el valor no supera al último reservado: `409 SEQUENCE_NUMBER_RESERVED`, "El último secuencial reservado es N; el siguiente debe ser mayor."
   - El evento de auditoría (D11) va en la misma transacción.

**Cómo se calcula el máximo reservado.** Es `last_reserved` de la fila, que la reserva mantiene bajo el bloqueo de esa misma fila.

**Ajuste concurrente con una reserva.** Si una reserva tiene bloqueada la fila, el `updateMany` espera y luego vuelve a evaluar su condición sobre la versión confirmada (READ COMMITTED). Por eso un ajuste nunca pisa una reserva ni fija un valor ya reservado; el `CHECK` de la tabla es la última defensa. Las carreras B y C de D3 describen los resultados.

El ajuste es de estado deseado con valor esperado, como la configuración tributaria, y no necesita bloqueo explícito.

### D10. Permisos

| Permiso | Operación | `ADMIN` | `OPERATOR` |
| --- | --- | --- | --- |
| `sequences.read` | Consultar los secuenciales | Sí | No |
| `sequences.adjust` | Ajustar el siguiente secuencial | Sí | No |

- Ajustar sigue la matriz propuesta en `access-control.md` ("Ajustar secuenciales": solo administrador).
- Consultar se reserva al administrador por mínimo privilegio: el operador verá el número de cada comprobante que emita (cambio 6) y no necesita los contadores. Es una decisión de este cambio dentro de Q-22, reversible sin cambiar el modelo.
- La reserva no tiene permiso propio: la invoca la emisión, que autoriza su propia operación.

### D11. Auditoría

- Acción nueva `fiscal_sequence.adjusted` en `AUDIT_ACTIONS`, sin migración.
- `changes` es plano, como en `AuditChanges`: `environment`, `establishmentCode`, `emissionPointCode`, `documentType`, `nextNumber.from`, `nextNumber.to`, `lastReserved` (`null` sin reservas), `decrease` (booleano) y `reason` cuando lo hay. Los nombres evitan las palabras que rechaza `assertNoSecrets`.
- Las reservas no son eventos de auditoría (Non-Goals): quedan en `fiscal_sequence_reservation`.

### D12. API

Rutas bajo `/api/v1/` (ADR 0015), con `requireContext`, el sobre común y registro en `packages/contracts/src/api/routes.ts`:

| Ruta | Permiso | Éxito | Errores propios |
| --- | --- | --- | --- |
| `GET /fiscal-sequences?environment=TEST\|PRODUCTION` | `sequences.read` | `200`: por cada punto de la empresa (orden por establecimiento y punto) y cada tipo, `establishment {id, code, status}`, `emissionPoint {id, code, status, available}`, `environment`, `documentType`, `nextNumber` (`null` si está agotado), `lastReserved`, `exhausted` | `400` sin ambiente válido |
| `PUT /establishments/:establishmentId/emission-points/:emissionPointId/sequences/:environment/:documentType` | `sequences.adjust` | `200` con el contador | `400`, `404`, `409 SEQUENCE_CHANGED`, `409 SEQUENCE_NUMBER_RESERVED`, `409 SEQUENCE_EXHAUSTED` |

- El formato vive en `packages/contracts`, compartido por backend, frontend y la emisión: `formatSequential(n)` devuelve `000000001`, y `documentNumber(establecimiento, punto, n)` devuelve `001-002-000000001`.
- Sin `Idempotency-Key`: el ajuste es de estado deseado con valor esperado; repetirlo no cambia nada.

### D13. Datos

Una migración, `add_fiscal_numbering`, con:

- las dos tablas, sus `CHECK`, `UNIQUE` y claves foráneas compuestas, todas `RESTRICT`;
- la restricción única nueva de `emission_point`;
- en SQL, los triggers de D2.

Los modelos de Prisma añaden relaciones inversas en `EmissionPoint` y en `Organization`. La prueba de regeneración del CLI de Better Auth debe seguir intacta. Índices: los `UNIQUE` de la clave cubren las búsquedas.

### D14. Interfaz: `Secuenciales`

Destino nuevo en `Configuración`, solo para administradores (`sequences.read`).

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador. |
| Objetivo | Revisar desde qué número sigue cada tipo de comprobante en cada punto, y fijarlo cuando haga falta (por ejemplo, para continuar la numeración de un sistema anterior). |
| Decisión principal | Si ajustar el siguiente secuencial de un contador. |
| Información mínima | Ambiente, punto (`001-002`), tipo de comprobante, siguiente secuencial, último reservado y estado del punto. |
| Acción principal | `Ajustar` en la fila del contador. No hay acción global. |
| Frecuencia y riesgo | Rara; riesgo alto: un ajuste deja huecos o, al retroceder, exige motivo. |

- **P0:** `SegmentedControl` `Pruebas | Producción`, que parte del ambiente vigente, y la lista por punto con los seis tipos: siguiente con su número completo (`001-002-000000101`), último reservado (`—` sin reservas) y la acción `Ajustar`.
- **P1:** estado del punto (`No disponible` con su motivo) y `StatusBadge` "Agotado" con la acción deshabilitada y su explicación.
- **P2 y P3:** fechas e identificadores, fuera.
- **Diálogo `Ajustar` (`FormDialog`):**
  - muestra el contador (tipo, punto y ambiente), el siguiente vigente y el último reservado, con el campo "Siguiente secuencial" (entrada numérica exacta);
  - si el valor avanza: "Los números del X al Y no se usarán.";
  - si retrocede, se revelan el campo `Motivo`, obligatorio, y el aviso "Retrocedes el secuencial. Los números reservados no se reutilizan.";
  - el error de número reservado va en el campo; el conflicto ofrece `Recargar`.
- **Estados:** esqueleto; vacío ("Crea un establecimiento con un punto de emisión para ver sus secuenciales", con enlace a Establecimientos); error con reintento; sin permiso; móvil con filas apiladas y objetivos de 44 px; ambos temas; checklist de frontend.
- Toda mutación pasa por `useMutationFeedback`.
- **Volumen:** lista agrupada como Establecimientos, por el volumen esperado (deuda técnica de paginación ya registrada).

### D15. Observabilidad

Las reservas agotadas se registran como advertencia en el log, con la clave del contador y sin datos del comprobante. Las métricas HTTP existentes cubren consulta y ajuste.

### Brief de operaciones sensibles

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Quién ejecuta | Consultar y ajustar: `ADMIN` (D10). Reservar: la emisión, internamente. |
| 2 | Tenant del llamante | `RequestContext.companyId`. |
| 3 | Tenant del recurso | `company_id` del contador, de la reserva y del punto. |
| 4 | Validación de propiedad | El punto se busca por empresa, establecimiento e identificador. Las claves compuestas impiden un contador o una reserva de otra empresa o de un punto ajeno al establecimiento. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No: `404` igual que inexistente, con evento de seguridad. |
| 6 | Petición repetida | Ajuste: estado deseado con valor esperado, sin cambio la segunda vez. Reserva: cada llamada confirmada es un número nuevo, por definición; la emisión la hará idempotente con su clave (Q-30). |
| 7 | Peticiones simultáneas | Reservas: bloqueo de fila. Ajuste frente a reserva: `updateMany` condicional y `CHECK`. |
| 8 | Idempotencia | Por estado deseado y valor esperado en el ajuste; la reserva hereda la idempotencia de la emisión. |
| 9 | Restricciones | `UNIQUE` de la clave y de la reserva, `CHECK` de rangos y `next_number > last_reserved`, claves foráneas compuestas, triggers de clave inmutable, sin borrado, `last_reserved` monótono y reservas de solo agregado. |
| 10 | Auditoría | Cada ajuste, en la misma transacción (D11). |
| 11 | Pruebas de autorización | Operador `403` en consulta y ajuste; otra empresa `404`; punto bajo otro establecimiento `404`. |
| 12 | Fugas entre cuentas | Ninguna lectura sin `companyId`; los errores no distinguen "de otra empresa" de "inexistente". |

## Risks / Trade-offs

- [Contención en un contador muy usado] → Las reservas del mismo contador se serializan por diseño (ADR 0003); la transacción de reserva es mínima y sin I/O externo, y la prueba de D5 mide la duración con 120 reservas.
- [Ráfagas que agoten `maxWait` o `timeout`] → La configuración parte de los valores por defecto y solo cambia con una medición que lo justifique (D5); si una carga real lo pide, se dimensiona el pool.
- [Reserva en curso durante una desactivación] → Semántica definida y probada (D4): lo que comenzó con el punto activo se completa, y lo que comienza después de la desactivación se rechaza.
- [Restricción única nueva en `emission_point`] → Es aditiva y sus columnas ya son únicas por `id`; no puede fallar sobre datos existentes.
- [El valor centinela `1000000000`] → Interno al dominio y a la base de datos (D6): la API devuelve `exhausted: true` con `nextNumber: null`, y el formato solo acepta de 1 a 999999999.

## Migration Plan

1. Migración aditiva `add_fiscal_numbering`: dos tablas, una restricción única nueva en `emission_point`, funciones y triggers; sin relleno, porque los contadores se crean de forma perezosa.
2. Despliegue normal con `prisma migrate deploy` antes de arrancar la API.
3. Reversión: volver a la versión anterior deja las tablas sin uso. Borrarlas solo procede en desarrollo y con una migración explícita.

## Trazabilidad de requisitos

| Requisito | Fuente | Decisiones |
| --- | --- | --- |
| Contador por ambiente, establecimiento, punto y tipo | ERS RF-120; CTX §5; ADR 0003; Q-02 | D2, D7 |
| Valor inicial de un contador | ERS RF-121; domain model | D3, D9 |
| Reserva atómica sin duplicados | ERS RF-122, RNF-003, AC-04; CTX §28 | D4, D5 |
| Un número reservado no se reutiliza | ERS RF-123; CTX §27.3, §28.1; Q-03 | D2, D4 |
| Formato del secuencial y del número | ERS RF-124; CTX §8.2 | D12 |
| Límite de nueve dígitos | ERS RF-124; CTX §8.2 | D6 |
| Reserva solo en puntos disponibles | `taxpayer-setup` | D4, D8 |
| Consulta de los secuenciales | ERS RF-121 | D12, D14 |
| Ajuste y retroceso explícito | ERS RF-121, RF-125 | D9 |
| Permisos | Q-22; `access-control.md` | D10 |
| Aislamiento por empresa | ADR 0009 | D2, D12 |
| Auditoría de los ajustes | ERS RF-003, RF-121, SEC-007 | D11 |
