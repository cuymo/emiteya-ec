# Proposal

## Why

Un contribuyente que vende bienes no puede saber hoy cuántas existencias le quedan: el producto
solo guarda la marca "controlado en stock", sin saldo, movimientos ni kárdex. Sin eso no se cumple
ERS AC-08 (una factura de un producto controlado genera una sola salida y un reintento no la
duplica) ni RF-205, RF-206 y RF-310 a RF-315. Q-18 y Q-19 quedaron resueltas el 2026-10-04: la
salida nace al autorizar y el saldo puede quedar negativo. El cambio 7 dejó el puerto de seguidores
de las transiciones que permite reaccionar a la autorización sin que la emisión dependa del
inventario (ADR 0006).

## What Changes

- **Inventario contabilizado por hechos fiscales autorizados**, nunca una reserva de disponibilidad.
  - Una factura genera su salida solo cuando entra de forma concluyente en `AUTHORIZED`, en la misma transacción que esa transición. Si la salida falla, la autorización local se revierte y se recupera desde la respuesta del SRI ya guardada, sin otra llamada.
  - Ningún otro estado modifica el stock, así que no hay compensaciones. Con la transmisión apagada, las facturas pendientes no descuentan.
  - El inventario nunca bloquea guardar un borrador, emitir, firmar, transmitir ni autorizar. El saldo puede quedar negativo y se muestra tal cual.
- **Configuración e inicialización separadas.**
  - La marca del producto dice que el producto debe participar en el inventario.
  - El inventario de un producto existe solo desde su movimiento `INICIAL`, que registra un administrador una sola vez. Ese momento fija el saldo de partida.
  - Un producto marcado pero sin inicializar no tiene saldo: no se muestra como cero ni produce movimientos.
  - Sin backfill: las facturas anteriores a la inicialización no descuentan.
- **Decisión congelada al emitir.** Cada línea del snapshot guarda si afecta al inventario (producto controlado e inventario inicializado en ese momento). La salida usa esa decisión, nunca el producto ni el inventario vigentes al autorizar. Los snapshots anteriores no se reescriben ni descuentan.
- **Movimientos inmutables y saldo materializado.**
  - Tipos: `INICIAL`, `ENTRADA_MANUAL`, `SALIDA_FACTURA` y `AJUSTE`. `DEVOLUCION_NC` existe en el modelo, pero este cambio no lo produce.
  - Cada movimiento guarda su variación con signo, el saldo resultante, el origen y el actor o el comprobante.
  - El saldo de cada producto es la suma exacta de sus movimientos y se actualiza de forma atómica con cada uno.
  - Una factura deja como máximo una salida por producto, con la suma exacta de sus líneas.
- **Entradas manuales y ajustes.** Entrada: incremento positivo, para administrador y operador. Ajuste: corrección positiva o negativa con motivo, solo para el administrador. Ambos con clave de idempotencia por empresa, operación y clave, con la huella de la solicitud: un doble envío crea un solo movimiento, y la misma clave con otra solicitud se rechaza. Nada se edita ni se borra; una corrección es otro movimiento.
- **Desactivar y reactivar el control** de un producto con inventario inicializado: solo el administrador, solo con saldo cero, conservando su kárdex. Al reactivar continúa el mismo kárdex, sin otro `INICIAL`. Desactivar no es retroactivo: una factura emitida con el control activo descuenta al autorizarse aunque el control ya esté desactivado, y una emitida con el control desactivado nunca descuenta. Ese hueco es intencional.
- **Aviso en el borrador**, informativo y no bloqueante, cuando la cantidad pedida de un producto (sumando sus líneas) supera su saldo, o cuando el producto está marcado pero sin inicializar. No garantiza existencias.
- **Consulta:** lista de inventario con el estado de cada producto (sin inicializar, activo, desactivado, saldo negativo) y kárdex por producto y rango de fechas, ambos paginados.
- **Permisos:**

  | Permiso | Acción | ADMIN | OPERATOR |
  | --- | --- | --- | --- |
  | `inventory.read` | Consultar | Sí | Sí |
  | `inventory.entry` | Entrada | Sí | Sí |
  | `inventory.adjust` | Ajuste | Sí | No |
  | `inventory.initialize` | Inicializar | Sí | No |
  | `inventory.configure` | Activar o desactivar el control de un producto inicializado | Sí | No |

  Cambiar la marca de un producto inicializado deja de ser una corrección del producto.
- **Auditoría** de la inicialización y de cada cambio del control de stock. Las entradas y los ajustes no se duplican en la auditoría: el movimiento inmutable es su evidencia.

Fuera de alcance:
- **Reservas** y prevención de la sobreventa: stock reservado o comprometido, disponible para prometer, reservas al guardar o al firmar, bloqueo de la venta.
- **Multibodega** (ERS RF-315, §2.3): bodegas, ubicaciones, lotes, series o caducidad. Un solo saldo por empresa y producto.
- **Devolución por nota de crédito** (`DEVOLUCION_NC`, Q-20): la decide el cambio 10.
- **Valoración y costeo** (ERS RF-315): costo promedio o valorización contable.
- **Compras y recepción** más allá de la entrada manual, y tomas físicas de inventario.
- **Recalcular o fijar el saldo** fuera de los movimientos.
- **Reportes de inventario y exportación XLSX** (cambio de reportes).

## Capabilities

### New Capabilities

- `inventory`: stock contabilizado por hechos fiscales autorizados.
  - Inicialización con `INICIAL` y salida de cada factura al autorizar.
  - Entradas manuales, ajustes y saldo que puede quedar negativo.
  - Kárdex y lista de inventario.
  - Control de stock activable y desactivable sin reescribir la historia, con sus permisos.

### Modified Capabilities

- `products`:
  - "Control de stock solo como dato de los bienes" pasa a llamarse "Control de stock de los bienes": la marca configura la participación en el inventario. Con el inventario inicializado, solo el administrador la cambia, desde el inventario.
  - "Permisos de productos" excluye ese cambio de la corrección que puede hacer el operador.
- `document-emission`: "Snapshot inmutable como fuente de verdad" incorpora la decisión de inventario de cada línea, congelada al reservar.
- `invoices`: nuevo requisito del aviso de existencias en el borrador, que no bloquea la emisión.
- `audit-trail`:
  - "Auditoría de productos" registra también el cambio del control de stock.
  - Nuevo requisito de auditoría de la inicialización y del control de stock de un producto con inventario.

## Impact

- **Backend:**
  - un módulo `inventory` nuevo: saldo, movimientos, inicialización, entradas, ajustes, control, kárdex y lista;
  - el seguidor de la autorización, compuesto en `main.ts`; `fiscal`, `invoices` y `products` no importan `inventory`;
  - `invoices`: el snapshot versión 2 con la decisión por línea y el aviso de existencias, con las lecturas del inventario inyectadas al componer;
  - `products`: el cambio de la marca de un producto inicializado pasa al inventario, mediante una consulta inyectada.
- **Base de datos:**
  - el saldo materializado por empresa y producto;
  - los movimientos de solo agregado, con unicidad del `INICIAL` por producto, de la salida por comprobante y producto, y de la clave de idempotencia;
  - un dominio decimal con signo para saldos y variaciones;
  - índices del kárdex.
- **API** bajo `/api/v1/inventory/items`:
  - lista, detalle y kárdex;
  - inicialización, entradas, ajustes y control.
  - Sin rutas para recalcular ni fijar el saldo.
- **Permisos:** los cinco nuevos de la tabla, con filas nuevas en `access-control.md`.
- **Frontend:**
  - la pantalla `Inventario` y su detalle con el kárdex;
  - la marca del producto inicializado gestionada desde el inventario;
  - los avisos de existencias en el borrador.
- **Rendimiento:** `bench:inventory` con 10 000 productos y un volumen de movimientos equivalente a 100 000 facturas, con el objetivo de ERS RNF-005.
- **Documentación:**
  - `ARCHITECTURE.md`, `backend.md`, `database.md`, `decimal-policy.md` y `fiscal-emission.md`;
  - `access-control.md`, `domain-model.md`, `glossary.md`, `capabilities.md`, `observability.md` y `performance.md`.
