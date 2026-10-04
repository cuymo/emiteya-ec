# Design

## Context

- **Motivación:** ver proposal.md. Q-18 (salida al entrar en `AUTHORIZED`) y Q-19 (stock negativo permitido) están resueltas y registradas en `open-questions.md`, ADR 0006, `domain-model.md` (BR-43, BR-57 y BR-58) y `ARCHITECTURE.md`.
- **Puerto de seguidores.** `fiscal/application/document-transitions.ts` define `DocumentTransitionFollower`.
  - `applyDecision` (`transmission-step.ts`) llama a cada seguidor con el cliente de la TX B, después de guardar cada transición y su artefacto.
  - `main.ts` compone hoy el seguidor del RIDE.
  - Cualquier camino a `AUTHORIZED` pasa por `applyDecision`: autorización, reconciliación automática y manual.
- **Recuperación existente** (design D8 de `add-sri-transmission`). La TX A confirma el intento y la respuesta original del SRI antes de clasificar. Si la TX B falla, el intento queda sin resultado; al retomar el job, `executeSriStep` lo clasifica desde la respuesta guardada, sin llamar al SRI (caso D de `authorize-handler.test.ts`).
- **Snapshot.** `SNAPSHOT_VERSION = 1`, un JSON en `electronic_document.snapshot`, inmutable por trigger. Cada línea guarda `productId` y `quantity` (`cantidad`, 18 dígitos y 6 decimales), pero no el control de stock. Una factura admite el mismo producto en varias líneas y cantidades de cero.
- **Productos.** `product.stock_tracked` es hoy solo un dato. Lo corrigen administrador y operador (`products.manage`), y su cambio no se audita. `module-boundaries.test.ts` impide que otro módulo lea las tablas de `products`.
- **Lecturas entre módulos.** `invoices` compone las lecturas internas exportadas de los otros módulos; la firma le llega inyectada (`SigningReads`) para no importar `signing`.
- **Idempotencia.** `platform/idempotency` lee `Idempotency-Key` y calcula la huella canónica. Su registro exige un comprobante (`idempotency_record.document_id`), así que no sirve para movimientos de inventario.
- **Decimales.** `platform/decimal/fiscal-decimal.ts` ofrece `sumExact` y `subtractExact` sobre texto, sin `number`.

## Goals / Non-Goals

**Goals:**

- Un módulo `inventory` que reacciona a la autorización sin que `fiscal`, `invoices` ni `products` lo importen.
- Un solo hecho persistente por concepto: la marca en el producto y la inicialización en el inventario.
- La salida de una factura en la TX B, atómica, idempotente en la base y sin deadlocks entre facturas con varios productos.
- Un saldo materializado que siempre coincide con la suma del kárdex, con pruebas de reconciliación.

**Non-Goals:**

- Reservas, multibodega, valoración y devolución por nota de crédito (proposal, fuera de alcance).
- Cambiar cómo se clasifican o se reintentan las respuestas del SRI.
- Reportes de inventario y exportación XLSX.

## Decisions

### D1. Módulo y dirección de las dependencias

```text
fiscal/application/document-transitions.ts      (puerto genérico, no conoce a nadie)
        ▲ lo invoca (TX B)                     ▲ lo implementa
transmission-step.ts                     inventory/application/invoice-outflow.ts
                                                 │ lee las líneas con su decisión
                                                 ▼
                                   invoices: lectura interna exportada del snapshot
products ◀── consulta inyectada "¿inventario inicializado?" ── inventory (main.ts compone)
invoices ◀── lecturas inyectadas de saldo e inicialización ─── inventory (main.ts compone)
```

- **Módulo nuevo `backend/src/modules/inventory/`:** `domain` (tipos, signos, estados), `application` (casos de uso y puertos) e `infrastructure` (Prisma, HTTP y métricas).
- **Qué importa `inventory`:**
  - de `invoices`, la lectura interna `stockLinesOf(db, companyId, documentId)`: número de la factura y líneas con `productId`, `quantity` e `inventoryAffectsStock`;
  - de `products`, la lectura interna para la lista y el detalle, y la operación transaccional que cambia la marca, que bloquea la fila del producto e incrementa su versión;
  - de `audit`, el registro de eventos.
- **`fiscal`, `invoices` y `products` no importan `inventory`.** Reciben sus implementaciones al componer en `main.ts`, igual que el seguidor del RIDE y las lecturas de la firma:
  - `invoices` recibe `StockReads`, con la inicialización y el saldo de una lista de productos;
  - `products` recibe `InventoryInitialization`, que responde si el inventario de un producto está inicializado.
- **Prueba de arquitectura `inventory-dependency-direction.test.ts`:**
  - ningún archivo fuera de `inventory/` y de `main.ts` importa de `inventory/`;
  - ningún archivo de la transmisión contiene `SALIDA_FACTURA`;
  - `inventory` no lee las tablas de `products` ni de `fiscal`; se amplía `module-boundaries.test.ts`.
  - Detecta cada violación en archivos de ejemplo, como las pruebas de fronteras existentes.
- **Alternativa descartada:** que `products` guarde también la inicialización (`inventory_initialized_at`). Evitaría el puerto, pero duplicaría el mismo hecho en dos tablas de dos módulos.

### D2. Modelo persistente

- **`stock_balance`:** la inicialización y el saldo materializado. Una fila por `(company_id, product_id)`.
  - Columnas: `balance` (variación acumulada), `last_position` (último número de movimiento), `initialized_at`, `initialized_by` y `updated_at`.
  - Su existencia **es** la inicialización: un producto marcado sin fila está configurado pero sin inicializar.
  - FK compuesta `(company_id, product_id)` a `product (company_id, id)`.
  - Triggers que impiden `DELETE` y `TRUNCATE`, y cambiar la empresa, el producto o los datos de la inicialización.
- **`stock_movement`:** de solo agregado, con triggers contra `UPDATE`, `DELETE` y `TRUNCATE`. Columnas:
  - identidad: `id`, `company_id`, `product_id` y `position` (ordinal del movimiento en el kárdex del producto);
  - valores: `movement_type`, `delta` con signo y `balance_after`;
  - referencias: `document_id` (FK compuesta al comprobante), `document_number`, `origin` (`USER` o `SYSTEM`), `actor_user_id` (FK con `RESTRICT`) y `reason`;
  - idempotencia: `idempotency_operation` (`inventory.entry` o `inventory.adjust`), `idempotency_key` y `request_hash` (D7);
  - `occurred_at`.
- **FK a `stock_balance (company_id, product_id)`:** ningún movimiento existe sin inventario inicializado.
- **Restricciones de la base:**

  | Restricción | Protege |
  | --- | --- |
  | `CHECK (movement_type = 'INICIAL') = (position = 1)` con `UNIQUE (company_id, product_id, position)` | A lo sumo un `INICIAL` en la vida del inventario (Q-21) |
  | `UNIQUE (company_id, document_id, product_id, movement_type)`, con `document_id` solo en salidas y devoluciones | Una sola salida por factura y producto (ERS RF-206, AC-08) |
  | `UNIQUE (company_id, idempotency_operation, idempotency_key)`, con la clave solo en entradas y ajustes | Una sola entrada o un solo ajuste por empresa, operación y clave |
  | `UNIQUE (company_id, product_id, position)` | Orden total y estable del kárdex |
  | `CHECK` del signo por tipo | `INICIAL >= 0`, `ENTRADA_MANUAL > 0`, `SALIDA_FACTURA < 0`, `DEVOLUCION_NC > 0`, `AJUSTE <> 0` |
  | `CHECK` de coherencia | Comprobante y número solo y siempre en `SALIDA_FACTURA` y `DEVOLUCION_NC`. Actor solo y siempre con origen `USER`. Motivo obligatorio en `AJUSTE`. Operación, clave y huella juntas, obligatorias en `ENTRADA_MANUAL` (`inventory.entry`) y `AJUSTE` (`inventory.adjust`) y ausentes en los demás tipos. |
  | `CHECK` de dominio decimal | `delta`, `balance_after` y `balance` en el dominio `existencia` (D3) |
  | Trigger de restricción diferido en `stock_balance` | Al confirmar, cada saldo tiene su `INICIAL` y es igual al `balance_after` de su último movimiento. Junto con la FK, no puede existir un saldo sin `INICIAL` ni al revés. |
| Trigger `BEFORE INSERT` de la cadena | Cada movimiento sigue al anterior, sin huecos, y su `balance_after` es el anterior más su `delta` |
| Trigger de restricción diferido en `stock_movement` | Un movimiento confirmado está reflejado en su saldo |

- **Sin índices parciales:** las unicidades se apoyan en columnas que solo tienen valor cuando aplican, porque los NULL no chocan, como la cola de jobs. Así el esquema de Prisma y las migraciones coinciden sin deriva.
- **Variación con signo canónica:** un solo modelo, `delta`. El saldo es `SUM(delta)`; `balance_after` y `stock_balance.balance` son su materialización.
  - Invariantes: el `balance_after` de cada movimiento es el saldo anterior más su `delta`, y el saldo vigente es igual a `SUM(delta)` y al `balance_after` del último movimiento.
  - **Reconciliación diagnóstica:** una función interna de `inventory/infrastructure` compara, por empresa y producto, el saldo materializado con `SUM(delta)` y con el último `balance_after`, y devuelve las diferencias. La usan las pruebas y `bench:inventory`. No es un endpoint ni corrige nada.
- **Alternativa descartada:** cantidad sin signo más dirección. Duplica la regla del signo y complica la reconciliación.

### D3. Dominio decimal `existencia` y cantidades

- **`existencia`:** dominio con signo nuevo en `decimal-policy.md` y `DECIMAL_SPECS`, para variaciones y saldos.
  - 30 dígitos en total y hasta 6 decimales, con la regla de la política (Q-43): con 6 decimales, menos de 10²⁴ en valor absoluto. Sin mínimo.
  - Basta para una salida de hasta 1 000 líneas de `cantidad` máxima y para cualquier saldo acumulado realista. Un `CHECK` que rechazara una salida haría fallar la autorización.
  - Guardado como `NUMERIC` sin escala fija en forma canónica, como el resto de la política.
- **Cantidades de las solicitudes:**
  - `INICIAL`: mayor o igual que cero.
  - Entrada: mayor que cero.
  - Ajuste: distinto de cero, con valor absoluto en `cantidad`.
- **Sin `number`:** todo se valida con `decimalString` y se opera con `sumExact` y `subtractExact`, sin redondeo.
- **`INICIAL` negativo no se admite.** Ninguna fuente (ERS RF-310 a RF-315) pide reconstruir un saldo real negativo. El saldo cruza a negativo después, solo con movimientos reales.
- **`INICIAL` de cero sí:** registra un saldo de partida medido, "no hay existencias". Es la única forma de empezar a controlar un producto agotado sin inventar una entrada.

### D4. Snapshot versión 2 con la decisión por línea

- `SNAPSHOT_VERSION = 2` y `SnapshotLine.inventoryAffectsStock: boolean`.
- **Dónde se decide:** en la evaluación de la emisión, dentro de la transacción de reserva. Vale `product.stockTracked` y existe `stock_balance`, leído con `StockReads` en esa misma transacción.
- **Lectores:** aceptan las dos versiones. Para una versión 1, `inventoryAffectsStock` vale `false`: no se reescribe ni se reconstruye nada.
- **El XML no cambia:** `toXmlSnapshot` ignora el campo, y una prueba lo comprueba con los mismos bytes.
- **Una inicialización concurrente con la reserva** confirmada después de la lectura deja la línea en `false`. Es coherente con "inicializado en el momento de emitir".
- **Alternativa descartada:** congelar los dos indicadores por separado y reconstruir la decisión al autorizar. El seguidor tendría que repetir la regla; congelar la decisión es más simple y no admite dos lecturas.

### D5. Seguidor de la autorización

`inventory/application/invoice-outflow.ts` implementa `DocumentTransitionFollower`. Cuando `to === "AUTHORIZED"`, con el cliente de la TX B:

1. Lee `stockLinesOf`. Un documento que no es factura, o un snapshot versión 1, no produce nada.
2. Toma solo las líneas con `inventoryAffectsStock`, las agrupa por `productId` y suma sus cantidades con `sumExact`. Descarta los productos con suma cero.
3. Ordena los productos por `productId`.
4. En ese orden, para cada producto:
   - bloquea su saldo con `SELECT … FOR UPDATE`;
   - inserta la salida (`delta = -suma`, `position = last_position + 1`, `balance_after = balance + delta`, origen `SYSTEM`, la factura y su número) con `ON CONFLICT DO NOTHING` sobre la unicidad de la salida;
   - si la inserta, actualiza `balance` y `last_position`; si ya existía, no toca el saldo.
5. Si falta el saldo de un producto marcado en el snapshot, lanza un error: la TX B entera se revierte.

Detalles:
- **Única fuente de la decisión:** el seguidor usa solo los campos inmutables de la línea (`productId`, `quantity` e `inventoryAffectsStock`) y el número de la factura. Nunca lee el producto ni su marca vigente para decidir la salida.
- **Saldo insuficiente:** el seguidor nunca falla por él. El saldo puede quedar negativo (Q-19).
- **Bloqueos en orden estable:** dos facturas con productos en orden inverso no se bloquean entre sí. La prueba lo comprueba con varias facturas concurrentes.
- **Composición:** `main.ts` añade el seguidor a `stepDependencies.followers` junto al del RIDE. Un error de cualquiera revierte la autorización.
- **`occurred_at`:** el `at` del evento de la transición.

### D6. Recuperación tras un fallo local

- No necesita código nuevo en la transmisión.
- Si la TX B falla (por ejemplo, el seguidor lanza un error), la autorización local, el XML autorizado, el job del RIDE y las salidas se revierten juntos.
- El intento y la respuesta del SRI ya estaban confirmados en la TX A. El job falla con backoff y, al retomarse, `executeSriStep` clasifica el intento sin resultado desde la respuesta guardada, sin llamar al SRI, y vuelve a aplicar la decisión.
- La unicidad de la salida impide una segunda salida en cualquier repetición.
- Una prueba de integración nueva lo cubre: un seguidor de inventario que falla una vez, el reintento sin llamada al SRI simulado, la factura `AUTHORIZED` y una sola salida por producto.

### D7. Inicialización, control y entradas

- **`POST /items/{productId}/initialization`** (`inventory.initialize`).
  - En una transacción: toma el lock transaccional del control de stock del producto (`pg_advisory_xact_lock` de `stock-tracking:{empresa}:{producto}`), lee el producto con la lectura exportada de `products` y exige que sea un bien marcado.
  - Inserta `stock_balance` y el `INICIAL` (`position = 1`) y registra la auditoría `inventory.initialized`.
  - Una segunda inicialización o una simultánea choca con la clave de `stock_balance` y responde `409 INVENTORY_ALREADY_INITIALIZED`.
  - Es idempotente por construcción, sin clave.
- **`PUT /items/{productId}/tracking`** (`inventory.configure`), con `{ tracked }`. Es una operación de fijar estado, idempotente por definición.
  - Solo para productos inicializados; un producto sin inicializar responde `409 INVENTORY_NOT_INITIALIZED`, porque su marca se cambia en el producto.
  - Toma el mismo lock y bloquea el saldo con una actualización atómica. Desactivar exige `balance = 0` (`409 STOCK_TRACKING_HAS_BALANCE`); reactivar exige que el producto sea un bien.
  - Cambia la marca con la operación de `products` y audita `inventory.tracking_disabled` o `inventory.tracking_enabled`.
  - Repetir el estado actual no cambia nada ni audita.
- **Corrección del producto (`PUT /products/{id}`):** cuando la solicitud cambia la marca, consulta `InventoryInitialization`, que toma el mismo lock por producto.
  - Si el inventario está inicializado y la solicitud cambia la marca, responde `409 STOCK_TRACKING_MANAGED_BY_INVENTORY`.
  - Sin inicializar, la marca cambia como hoy y su cambio se audita en `product.updated`.
  - La inicialización, el control, las entradas, los ajustes y la corrección de la marca toman el mismo lock por producto, así que no pueden cruzarse. La salida al autorizar no lo necesita: el saldo bloqueado por su actualización atómica la serializa.
- **Entradas y ajustes** (`POST /items/{productId}/entries` con `inventory.entry`, y `POST /items/{productId}/adjustments` con `inventory.adjust`).
  - **Contrato de idempotencia, tan fuerte como el de la emisión:**
    - `Idempotency-Key` obligatoria (`400 IDEMPOTENCY_KEY_REQUIRED` sin ella), con el formato de `platform/idempotency`.
    - Alcance: empresa + operación (`inventory.entry` o `inventory.adjust`) + clave.
    - Huella `request_hash`: SHA-256 del JSON canónico `{ operation, productId, quantity | delta, note | reason }`. Los decimales van en su forma exacta más corta, así que `10` y `10.00` son la misma solicitud.
    - La misma clave sirve en otra empresa, y entre una entrada y un ajuste, porque la operación forma parte del alcance.
    - Sin caducidad: no hay una razón de producto para limitarla.
    - La unicidad de la base es la última defensa.
  - En una transacción: busca un movimiento con la misma empresa, operación y clave.
    - Con la misma huella devuelve ese movimiento (`200`, repetición). Con otra, `409 IDEMPOTENCY_KEY_REUSED`.
    - Si no existe, exige inventario inicializado y control activo (`409 INVENTORY_NOT_INITIALIZED` o `409 STOCK_TRACKING_DISABLED`), bloquea el saldo, inserta el movimiento y actualiza el saldo (`201`).
  - Un choque de la unicidad de la clave entre dos solicitudes simultáneas se resuelve releyendo el movimiento ganador.
  - Se reutilizan la cabecera y la huella de `platform/idempotency`, y su tipo de operación se amplía con `inventory.entry` e `inventory.adjust`, sin escribir en `idempotency_record`.
- **Desactivar no es retroactivo.** Desactivar solo hace que las emisiones nuevas congelen `inventoryAffectsStock = false`.
  - Una factura emitida con el control activo y autorizada después de desactivarlo registra su salida, aunque el saldo pase de 0 a negativo. El kárdex histórico sigue siendo válido.
  - Una factura emitida con el control desactivado nunca descuenta, ni siquiera si se reactiva antes de autorizarla.
  - No se buscan ni se bloquean facturas pendientes al desactivar: eso convertiría el inventario en un sistema de compromisos, fuera de alcance.
  - El diálogo de desactivación explica esta consecuencia.
- **Sin entradas ni ajustes con el control desactivado.** Para corregir, el administrador lo reactiva.

### D8. Lista, detalle y kárdex

- **Lista (`GET /items`)**, paginada con el contrato común:
  - filtros: `search` (código o nombre, con la clave de búsqueda de `products`) y `state` (`TRACKED_NOT_INITIALIZED`, `TRACKED_INITIALIZED`, `DISABLED_INITIALIZED` o `NEGATIVE`);
  - la pagina la lectura exportada de `products` con un filtro `{ stockTracked?, onlyIds?, excludeIds? }`, con los identificadores inicializados (o con saldo negativo) que aporta el inventario, y después se completa con los saldos de la página en una sola consulta;
  - sin N+1 y sin leer tablas ajenas. `bench:inventory` mide el caso de 10 000 productos inicializados.
- **Estado derivado, nunca persistido:**
  - `NOT_TRACKED`: sin marca y sin inventario; solo aparece en el detalle;
  - `TRACKED_NOT_INITIALIZED`: marcado y sin saldo;
  - `TRACKED_INITIALIZED`: marcado y con saldo;
  - `DISABLED_INITIALIZED`: sin marca y con saldo;
  - `negative`: un indicador aparte, con saldo menor que cero.
  - Un producto sin inicializar devuelve `balance: null`, nunca `"0"`.
- **Detalle (`GET /items/{productId}`):** producto, estado, saldo, inicialización (fecha y actor) y último movimiento.
- **Kárdex (`GET /items/{productId}/movements`)**, con `from` y `to` en fechas de Ecuador inclusivas (`from <= to`) y paginado:
  - orden por `position` descendente;
  - cada movimiento con tipo, variación, saldo resultante, momento, origen, nombre del actor, número de la factura y motivo o nota;
  - no suma el kárdex: muestra `balance_after`.
- **Índices:** `(company_id, product_id, position)` (único), `(company_id, product_id, occurred_at)` y `(company_id, balance)` para el filtro de saldo negativo.

### D9. Aviso de existencias en el borrador

- La vista previa del borrador añade `preview.stockWarnings`, una lista separada de `issues`: los `issues` bloquean la emisión y estos avisos no. Cada aviso es uno de:
  - `{ code: "STOCK_BELOW_REQUESTED", productId, requested, balance }`, cuando la suma de las líneas del producto supera su saldo;
  - `{ code: "STOCK_NOT_INITIALIZED", productId, requested }`, para un producto marcado sin inventario.
- Se calcula con `StockReads` en la lectura de la vista previa, sobre los productos marcados del borrador. La emisión no lo consulta.
- El texto de la interfaz dice que es orientativo.

### D10. API y contratos

| Método y ruta | Uso | Permiso |
| --- | --- | --- |
| `GET /api/v1/inventory/items` | Lista con estado, saldo, búsqueda, filtro y paginación | `inventory.read` |
| `GET /api/v1/inventory/items/{productId}` | Detalle | `inventory.read` |
| `GET /api/v1/inventory/items/{productId}/movements` | Kárdex por rango de fechas | `inventory.read` |
| `POST /api/v1/inventory/items/{productId}/initialization` | Inicializar con `INICIAL` (`201`) | `inventory.initialize` |
| `POST /api/v1/inventory/items/{productId}/entries` | Entrada manual (`201`, o `200` en la repetición) | `inventory.entry` |
| `POST /api/v1/inventory/items/{productId}/adjustments` | Ajuste (`201`, o `200` en la repetición) | `inventory.adjust` |
| `PUT /api/v1/inventory/items/{productId}/tracking` | Activar o desactivar el control de un producto inicializado | `inventory.configure` |

- Sin rutas para recalcular ni fijar el saldo.
- Contratos en `packages/contracts/src/inventory.ts`: filtros, vistas, solicitudes estrictas (sin `companyId`), códigos de error, estados, tipos de movimiento y avisos de existencias.
- El contrato del borrador amplía `draftPreviewViewSchema` con `stockWarnings`.

### D11. Permisos

- Permisos nuevos en `access-policy.ts`, su espejo del frontend y `access-control.md`:
  - `inventory.read` e `inventory.entry` para ADMIN y OPERATOR;
  - `inventory.adjust`, `inventory.initialize` e `inventory.configure` solo para ADMIN.
- Este cambio confirma las filas "Registrar entradas manuales de inventario" (ambos roles) y "Registrar ajustes de inventario" (administrador).
- Añade tres filas:
  - "Consultar el inventario y el kárdex" (ambos roles);
  - "Inicializar el inventario de un producto" (administrador);
  - "Activar o desactivar el control de stock de un producto con inventario" (administrador).
- **Quién cambia la marca `stockTracked`** (política explícita, sin contradicción entre `products` e `inventory`):
  - sin inventario inicializado: administrador y operador, con la corrección del producto (`products.manage`), y queda auditado;
  - con inventario inicializado: solo el administrador, con `PUT /inventory/items/{productId}/tracking` (`inventory.configure`). La corrección del producto la rechaza con `409 STOCK_TRACKING_MANAGED_BY_INVENTORY`.
  - El servidor lo aplica en ambas rutas (D7), no solo la interfaz.
- **Modificación del requisito de productos.** "Crear y editar terceros y productos" ya no incluye la marca de un producto con inventario inicializado.

### D12. Auditoría

- **Acciones nuevas en `AUDIT_ACTIONS`:** `inventory.initialized` (producto) e `inventory.tracking_disabled` o `inventory.tracking_enabled` (producto, marca anterior y nueva).
- **`product.updated` incluye `stockTracked`** cuando la corrección cambia la marca.
- **Entradas, ajustes y salidas no se auditan.** El movimiento inmutable guarda actor, motivo o nota, momento y origen, y ERS RF-003 no incluye el inventario entre los cambios críticos. Es el mismo criterio que el historial de entregas (design D12 de `add-document-archive`).
- **Por qué sí se audita la configuración:** inicializar o desactivar cambia el comportamiento futuro del producto, y el kárdex no lo registra por sí solo. La reactivación no tiene movimiento.

### D13. Pantallas

**`Inventario` (`/inventario`, en "Operación").**

- **Brief:**
  - **usuario:** administrador u operador;
  - **objetivo:** saber cuánto queda de cada producto controlado y detectar anomalías;
  - **decisión:** qué producto revisar, inicializar o reponer;
  - **información mínima:** código, nombre, estado y saldo;
  - **acción principal:** abrir el producto.
- **Uso:** diario, por usuarios con experiencia media, primero en escritorio. Un error es leve: la lista solo lee.
- **Niveles:** P0 nombre, estado y saldo (negativo destacado con icono y texto); P1 código y último movimiento; P2 búsqueda y filtro de estado; P3 (identificadores) no se muestra.
- **Componentes:** `AppDataTable` con paginación del servidor y filtros en la URL, `SearchInput` y `ChipGroup` del estado. Por debajo de 768 px, tarjetas.
- **Presentación del estado:**
  - sin inicializar: "Sin inicializar", sin cifra;
  - desactivado: "Control desactivado";
  - negativo: "Saldo negativo" con su cifra.

**Detalle del producto en el inventario (`/inventario/{productId}`).**

- **Brief:**
  - **objetivo:** ver el saldo y su historia, y registrar lo que pasó físicamente;
  - **decisión:** registrar una entrada, ajustar, inicializar o desactivar el control;
  - **información mínima:** estado, saldo y últimos movimientos;
  - **acción principal:** según el estado y el rol: "Inicializar inventario" (administrador, sin inicializar), "Registrar entrada" (activo) o "Activar control" (administrador, desactivado).
- **Uso:** ocasional y con riesgo medio. Un ajuste equivocado se corrige con otro ajuste, nunca editando.
- **Niveles:** P0 estado, saldo y acción principal; P1 kárdex con fechas, tipo, variación, saldo, origen y factura o motivo; P2 acciones secundarias (ajustar, desactivar); P3 no se muestra.
- **Componentes:**
  - formularios en diálogo con React Hook Form y Zod: cantidad con su dominio, nota, y motivo obligatorio en el ajuste;
  - la clave de idempotencia se genera al abrir el diálogo y se reutiliza en los reintentos;
  - `ConfirmDialog` para desactivar el control; `DatePickerField` para el rango del kárdex.
- **Permisos en la interfaz:** el operador ve consultar y registrar entrada; nunca inicializar, ajustar ni configurar. Desactivar con saldo distinto de cero explica el motivo en lugar de fallar.

**Otras pantallas.**

- **Producto:** en el diálogo, con el inventario inicializado, la marca queda deshabilitada con "El control se gestiona en Inventario" y un enlace al detalle.
- **Borrador:** los avisos de existencias aparecen junto a la línea del producto, como aviso informativo que no bloquea, con el texto orientativo.
- Se cubren carga, vacío, error, sin permiso, éxito, diseño responsive, teclado y los dos temas.

### D14. Observabilidad

- **`inventory_movements_total{type}`:** contador por tipo de movimiento registrado.
- **`inventory_negative_balances`:** gauge con los productos con saldo negativo.
- Nunca identificadores de empresa ni de producto como etiqueta.
- Un fallo del seguidor queda en el log del job, sin datos del comprador.
- Alerta propuesta en `observability.md`: saldos negativos que crecen. Es informativa, porque el negativo está permitido.

### D15. Rendimiento

- `bench:inventory` es un gate dedicado fuera de `verify`, como `bench:search`. Siembra en un esquema aislado 10 000 productos inicializados y un volumen de movimientos equivalente a 100 000 facturas, y mide por separado:
  - la lista, con y sin filtro de estado;
  - el detalle;
  - la primera página del kárdex de un producto con muchos movimientos;
  - el kárdex filtrado por fechas;
  - una entrada manual;
  - la salida automática de una factura de varias líneas dentro de su transacción.
- Termina con la reconciliación diagnóstica (D2) sin diferencias.
- El riesgo de pasar los identificadores inicializados a la lectura de productos se resuelve con esta medición, no se da por supuesto.
- Objetivo: ERS RNF-005, P95 menor que 2 s. Se registra el resultado medido; el objetivo no se sube.

### D16. Briefs de las operaciones sensibles

| Pregunta | Inicializar y control | Entradas y ajustes | Salida al autorizar | Consultas |
| --- | --- | --- | --- | --- |
| Quién | `inventory.initialize` y `inventory.configure` | `inventory.entry` y `inventory.adjust` | El sistema, al autorizar | `inventory.read` |
| Empresa del llamador | La de la sesión | La de la sesión | La del comprobante | La de la sesión |
| Empresa del recurso | `product.company_id` | Igual | Igual | Igual |
| Propiedad | Producto por `(company_id, id)` y saldo por `(company_id, product_id)` | Igual | Comprobante y saldo por empresa | Filtro por empresa en toda consulta |
| ¿Otro ID llega a otra empresa? | No: `404` | No: `404` | No | No |
| Dos veces | Inicializar: `409`. Control: sin efecto. | Misma clave y solicitud: el mismo movimiento | Unicidad: una salida | Sin efecto |
| A la vez | Una sola inicialización; el control serializa con el saldo bloqueado | Una sola por clave; el saldo exacto | Saldo bloqueado en orden estable | Sin efecto |
| Idempotencia | Natural: clave de `stock_balance` y fijar estado | `Idempotency-Key` con huella | Unicidad `(empresa, comprobante, producto, tipo)` | No aplica |
| Restricciones | `INICIAL` único; trigger diferido; FK compuesta | `CHECK` de signo y coherencia; clave única | Clave única; `CHECK` de signo | — |
| Auditoría | Sí (D12) | No: el movimiento es la evidencia | No: el movimiento y la transición | No |
| Pruebas | Sin sesión, sin permiso, otra empresa, repetida y simultánea | Además, doble envío y clave reutilizada | Repetición, recuperación, concurrencia e inverso | Sin permiso, otra empresa y filtros |
| Filtración | Errores sin datos internos | Errores sin datos internos | Log sin datos del comprador | Vistas sin datos de otra empresa |

## Risks / Trade-offs

- **[Compromiso] El saldo no refleja las facturas pendientes, y se puede vender lo que ya no hay** → Decisión de producto aceptada (Q-18, R-23). El aviso del borrador es orientativo y el saldo negativo es visible.
- **[Riesgo] Un error del seguidor impide autorizar localmente una factura que el SRI ya autorizó** → La respuesta queda guardada y el reintento la aplica sin llamar al SRI (D6). El seguidor no falla por saldo insuficiente; solo por un invariante roto o por la base, y el job lo deja visible.
- **[Riesgo] La lista pasa muchos identificadores a la lectura de productos** → Se mide con 10 000 productos inicializados. Si no cumple, se propone con `/opsx:update` un índice o una lectura dedicada en `products`, sin leer tablas ajenas.
- **[Compromiso] Un hueco en el kárdex mientras el control está desactivado** → Intencional y documentado: las facturas emitidas entonces no descuentan, ni siquiera al reactivar.
- **[Riesgo] Un saldo materializado distinto de la suma del kárdex** → Lo actualiza un único camino bajo bloqueo, en la misma transacción que el movimiento. Las pruebas de reconciliación lo comparan con `SUM(delta)` y con `balance_after` del último movimiento.
- **[Riesgo] Deadlocks entre facturas con varios productos** → Bloqueos en orden estable de `productId` y prueba concurrente con órdenes inversos.

## Migration Plan

1. **Migración aditiva:**
   - `stock_balance` y `stock_movement` con sus restricciones, triggers e índices;
   - el dominio `existencia`.

   Sin cambios en los datos existentes.
2. **Despliegue:**
   - los productos ya marcados quedan sin inicializar;
   - las facturas ya emitidas tienen snapshot versión 1 y nunca descuentan;
   - las nuevas emisiones usan la versión 2.
3. **Reversión:** hacia adelante. Una versión anterior ignora las tablas nuevas. Los snapshots versión 2 siguen siendo legibles por los lectores anteriores, que ignoran el campo nuevo.
