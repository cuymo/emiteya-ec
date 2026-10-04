# Tasks

## 1. Esquema del inventario

- [ ] 1.1 Añadir el dominio decimal `existencia` (con signo, hasta 6 decimales y menos de 10²⁴ en valor absoluto) a `DECIMAL_SPECS` y a `decimal-policy.md` (design D3). Verificar con pruebas de contratos y de `fiscal-decimal`: bordes aceptados, más decimales y fuera de rango rechazados, signo negativo admitido y ninguna conversión a `number`
- [ ] 1.2 Crear la migración aditiva de design D2:
  - `stock_balance`: FK compuesta al producto, `balance`, `last_position`, `initialized_at` e `initialized_by`, con triggers contra `DELETE` y `TRUNCATE` y contra el cambio de empresa, producto o inicialización;
  - `stock_movement`, de solo agregado: FK a `stock_balance`, FK compuesta al comprobante, actor con `RESTRICT`, `CHECK` de signo por tipo, de coherencia y de dominio, y unicidades del `INICIAL`, de la salida por comprobante y producto, de la clave de idempotencia y de la posición;
  - el trigger de restricción diferido que exige el `INICIAL` de cada saldo al confirmar;
  - los índices `(company_id, product_id, occurred_at)` y `(company_id, balance)`.

  Verificar con pruebas de integración del esquema:
  - un saldo sin `INICIAL` falla al confirmar, y un movimiento sin saldo se rechaza;
  - un segundo `INICIAL` y una segunda salida de la misma factura y producto chocan con la unicidad;
  - cada `CHECK` de signo y de coherencia rechaza su caso;
  - un movimiento no se puede cambiar, borrar ni truncar, y un saldo no se puede borrar;
  - un movimiento con un comprobante de otra empresa se rechaza, y un usuario con movimientos no se puede borrar
- [ ] 1.3 Añadir las tablas a `migrations.test.ts` y documentarlas en `database.md`, reemplazando la tabla planificada `stock_movement`. Verificar que `migrations.test.ts` pasa sin deriva entre migraciones y esquema

## 2. Contratos y permisos

- [ ] 2.1 Crear `packages/contracts/src/inventory.ts` (design D10):
  - estados `NOT_INITIALIZED`, `ACTIVE`, `DISABLED` y el filtro `NEGATIVE`;
  - tipos de movimiento y vistas de lista, detalle y kárdex, con `balance: null` sin inicializar;
  - solicitudes estrictas sin `companyId`: inicialización `>= 0`, entrada `> 0`, ajuste `<> 0` con motivo, y control `{ tracked }`;
  - el filtro del kárdex con `from <= to` y los códigos de error;
  - las rutas en `apiRoutes`.

  Ampliar `draftPreviewViewSchema` con `stockWarnings` (design D9). Verificar con pruebas de contratos: cantidad como número JSON, negativa en la inicialización, cero en la entrada y en el ajuste, ajuste sin motivo, rango invertido y `companyId` en el cuerpo rechazados
- [ ] 2.2 Añadir `inventory.read` e `inventory.entry` para ADMIN y OPERATOR, e `inventory.adjust`, `inventory.initialize` e `inventory.configure` solo para ADMIN, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D11). En `access-control.md`, confirmar las dos filas de inventario existentes, añadir las tres nuevas y registrar que la corrección del producto ya no cambia la marca de un producto inicializado. Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz

## 3. Núcleo del inventario

- [ ] 3.1 Crear el módulo `backend/src/modules/inventory/` con su dominio (tipos, signos, estado derivado y agrupación exacta de líneas por producto con `sumExact`) y su repositorio Prisma:
  - inicializar;
  - bloquear un saldo con `FOR UPDATE`;
  - insertar un movimiento con `position = last_position + 1` y `balance_after`, y actualizar el saldo en la misma transacción;
  - leer saldos por lista de productos (design D2 y D5).

  Verificar con pruebas unitarias del dominio (signos, estado derivado, agrupación de `1.5` y `2.25` en `3.75`, suma cero descartada, sin `number`) y con pruebas de integración del repositorio: el saldo coincide con `SUM(delta)` y con el `balance_after` del último movimiento después de una serie mixta de movimientos

## 4. Snapshot versión 2

- [ ] 4.1 Añadir a `invoices` el puerto `StockReads`, inyectado al componer desde `main.ts` con la implementación del inventario, sin importar `inventory` (design D1).
  - Llevar `SNAPSHOT_VERSION` a 2, con `SnapshotLine.inventoryAffectsStock` decidido en la transacción de reserva: marca del producto y existencia del saldo (design D4).
  - Que los lectores acepten la versión 1 con `false`.
  - Añadir la lectura interna exportada `stockLinesOf(db, companyId, documentId)`.

  Verificar con pruebas de integración de la emisión:
  - línea de un producto activo con `true`; servicio, producto sin marca y producto marcado sin inicializar con `false`;
  - la decisión no cambia al cambiar después el producto o su inventario;
  - un snapshot versión 1 se sigue leyendo y `stockLinesOf` lo devuelve sin líneas que afecten al inventario;
  - el XML firmado es idéntico byte a byte al de la misma factura sin el campo nuevo

## 5. Salida de la factura al autorizar

- [ ] 5.1 Implementar el seguidor `inventory/application/invoice-outflow.ts` con los pasos de design D5 y componerlo en `main.ts` junto al del RIDE. Añadir `inventory-dependency-direction.test.ts` y ampliar `module-boundaries.test.ts` (design D1). Verificar con pruebas de integración y de arquitectura:
  - autorización directa, reconciliación automática y manual: una salida por producto con la suma exacta, que referencia la factura y su número, y el saldo actualizado en la misma transacción;
  - el mismo producto en varias líneas da una sola salida;
  - la suma cero, el servicio, el producto sin inicializar al emitir y el snapshot versión 1 no generan movimientos;
  - ningún otro estado (reservada, firmada, recibida, verificando, revisión manual, devuelta, no autorizada) genera movimientos;
  - el saldo de 2 con una salida de 5 queda en -3 y la factura autorizada;
  - repetir la decisión no crea otra salida;
  - un seguidor que falla revierte la autorización, el XML autorizado, el job del RIDE y todas las salidas de la factura;
  - la prueba de arquitectura pasa sobre el código y detecta cada violación en archivos de ejemplo
- [ ] 5.2 Cubrir la recuperación de design D6 con una prueba de integración: el SRI simulado responde `AUTORIZADO`, la respuesta queda guardada, el seguidor de inventario falla una vez y la factura sigue `RECEIVED`. Al reintentar el job, el intento se clasifica desde la respuesta guardada sin otra llamada al SRI simulado, la factura queda `AUTHORIZED` y existe una sola salida por producto. Verificar que la prueba pasa y cuenta cero llamadas nuevas al SRI
- [ ] 5.3 Probar la concurrencia de design D5: dos autorizaciones simultáneas del mismo producto (saldo final exacto, cruzando cero), varias facturas concurrentes con productos en orden inverso (sin deadlocks y todas autorizadas) y una entrada simultánea con una salida. Al final, comparar cada saldo con `SUM(delta)`. Verificar que las pruebas pasan repetidas veces sin fallos intermitentes

## 6. Inicialización y control del inventario

- [ ] 6.1 Implementar `POST /api/v1/inventory/items/{productId}/initialization` con la operación transaccional exportada de `products` que bloquea el producto, y la auditoría `inventory.initialized` (design D7 y D12). Verificar con pruebas HTTP:
  - inicializar con `12.5` y con `0`;
  - producto sin marca o servicio rechazado;
  - segunda inicialización y dos simultáneas: una sola, la otra `409 INVENTORY_ALREADY_INITIALIZED`;
  - cantidad negativa rechazada;
  - sin sesión `401`, operador `403` y producto de otra empresa `404`, sin evento de auditoría en ningún rechazo
- [ ] 6.2 Implementar `PUT /api/v1/inventory/items/{productId}/tracking` (design D7): desactivar solo con saldo cero (`409 STOCK_TRACKING_HAS_BALANCE` con saldo positivo o negativo), reactivar sin otro `INICIAL`, repetir el estado sin cambios ni auditoría, `409 INVENTORY_NOT_INITIALIZED` para un producto sin inicializar, y la auditoría `inventory.tracking_disabled` y `inventory.tracking_enabled`. Verificar con pruebas HTTP, también que una factura emitida con el control desactivado y autorizada después de reactivarlo no genera salida
- [ ] 6.3 Inyectar en `products` el puerto `InventoryInitialization` y aplicar en la corrección del producto, después de bloquear su fila:
  - `409 STOCK_TRACKING_MANAGED_BY_INVENTORY` si cambia la marca de un producto inicializado;
  - la auditoría del cambio de la marca en `product.updated` (design D7 y D12).

  Verificar con pruebas HTTP y de integración:
  - el operador cambia la marca de un producto sin inicializar, y el evento lleva la marca anterior y la nueva;
  - el nombre y el precio de un producto inicializado se corrigen sin tocar el inventario;
  - el paso a servicio de un producto inicializado con control activo se rechaza;
  - una corrección y una inicialización simultáneas no se cruzan

## 7. Entradas manuales y ajustes

- [ ] 7.1 Implementar `POST /api/v1/inventory/items/{productId}/entries` y `/adjustments` con `Idempotency-Key`, la huella canónica y la unicidad de design D7. Añadir la métrica `inventory_movements_total{type}`. Verificar con pruebas HTTP:
  - entrada de 10 que suma al saldo, y ajuste de -4 con motivo que deja el saldo negativo;
  - entrada de cero o negativa, y ajuste sin motivo o de cero, rechazados;
  - doble envío secuencial y simultáneo: un solo movimiento, con la repetición que devuelve el mismo;
  - clave reutilizada con otra cantidad: `409 IDEMPOTENCY_KEY_REUSED`; sin clave: `400`;
  - producto sin inicializar o con el control desactivado rechazado;
  - operador en ajuste `403`, sin sesión `401` y otra empresa `404`;
  - ningún evento de auditoría por las entradas ni por los ajustes;
  - movimientos sin rutas para editarlos ni borrarlos

## 8. Lista, detalle y kárdex

- [ ] 8.1 Implementar `GET /api/v1/inventory/items`, `/{productId}` y `/{productId}/movements` con la lectura exportada de `products` y los saldos por página de design D8, y la métrica `inventory_negative_balances`. Registrar las rutas en OpenAPI. Verificar con pruebas HTTP:
  - los cuatro estados con `balance: null` sin inicializar y el negativo indicado;
  - filtros de estado y de saldo negativo, búsqueda por código y nombre, y paginación estable;
  - un producto sin marca ni inventario fuera de la lista;
  - el kárdex por rango, del más reciente al más antiguo, con el saldo después de cada movimiento, el número de la factura en la salida, el actor y el motivo;
  - rango invertido rechazado;
  - sin permiso `403` y otra empresa `404`, sin datos de otra empresa en ningún filtro;
  - `openapi-routes.test.ts` y `openapi:check` pasan

## 9. Aviso de existencias en el borrador

- [ ] 9.1 Añadir `stockWarnings` a la vista previa del borrador con `StockReads` (design D9): `STOCK_BELOW_REQUESTED` con la suma de las líneas del producto y su saldo, y `STOCK_NOT_INITIALIZED` sin saldo. Verificar con pruebas HTTP: 3 + 4 sobre saldo 5 avisa 7 frente a 5; un producto marcado sin inicializar avisa sin tratarlo como cero; saldo suficiente sin aviso; y la emisión de un borrador con avisos se completa

## 10. Pantallas

- [ ] 10.1 Implementar la pantalla `Inventario` en `/inventario` dentro de "Operación" (design D13): `AppDataTable` con paginación del servidor, búsqueda y `ChipGroup` del estado en la URL, saldo negativo con icono y texto, sin inicializar sin cifra y tarjetas por debajo de 768 px. Verificar con pruebas de componente: carga, vacío, error con reintento, sin permiso, los cuatro estados y filtros en la URL
- [ ] 10.2 Implementar el detalle `/inventario/{productId}` (design D13):
  - estado, saldo y acción principal según el estado y el rol;
  - diálogos de inicialización, entrada y ajuste con su validación, el motivo obligatorio en el ajuste y la clave de idempotencia reutilizada en los reintentos;
  - `ConfirmDialog` para desactivar, con la explicación del saldo distinto de cero;
  - kárdex paginado con `DatePickerField`.

  Verificar con pruebas de componente:
  - el operador sin inicializar, ajustar ni configurar;
  - el administrador con las cuatro acciones;
  - el doble clic que envía una sola solicitud;
  - los `409` explicados, el foco tras cada acción, y el rango inválido
- [ ] 10.3 En el diálogo del producto, deshabilitar la marca de un producto inicializado con "El control se gestiona en Inventario" y un enlace; en el editor del borrador, mostrar los avisos de existencias junto a su línea como aviso informativo que no bloquea la emisión (design D13). Verificar con pruebas de componente de ambos
- [ ] 10.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado) y registrar la revisión en `openspec/changes/add-minimal-inventory/ui-review.md`. Verificar que la revisión no deja hallazgos abiertos

## 11. Rendimiento y prueba end-to-end

- [ ] 11.1 Añadir `bench:inventory` en `backend/scripts/` (design D15). Debe sembrar 10 000 productos inicializados y un volumen de movimientos equivalente a 100 000 facturas, y medir la lista (con y sin filtro), el kárdex de un producto con muchos movimientos y la salida de una factura de varias líneas. Registrar el resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005 en el entorno registrado
- [ ] 11.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado:
  - marcar e inicializar un producto y registrar una entrada;
  - emitir una factura con dos líneas del producto y ver el aviso en el borrador;
  - autorizar y comprobar una sola salida, el saldo y el kárdex;
  - con la transmisión apagada, otra factura no descuenta.

  Actualizar `capabilities.md` con `inventory`. Verificar que la prueba pasa

## 12. Documentación

- [ ] 12.1 Documentar el módulo, el seguidor, la dirección de las dependencias, los puertos inyectados y el snapshot versión 2:
  - en `ARCHITECTURE.md`, `backend.md` y `fiscal-emission.md`;
  - las métricas y la alerta en `observability.md`;
  - los términos (configurado sin inicializar, `INICIAL`, variación, saldo negativo) en `domain-model.md` y `glossary.md`.

  Verificar que los documentos citan las rutas, los permisos, los códigos de error y las métricas implementados

## 13. Verificación

- [ ] 13.1 Ejecutar `corepack pnpm verify` y verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact` y `check:ride-assets` pasan
