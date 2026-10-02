# ADR 0006: Inventario opcional y mínimo

## Status

Accepted. Origen: ERS §22.2, ADR-006.

## Context

El inventario facilita la facturación, pero no es el objetivo del producto, y su
complejidad crece rápido con costeo, bodegas y lotes.

## Decision

- El control de stock se activa por producto.
- Movimientos `INICIAL`, `ENTRADA_MANUAL`, `SALIDA_FACTURA`, `DEVOLUCION_NC` y `AJUSTE`, solo de agregado.
- Sin costo promedio, valorización ni multibodega.
- El inventario reacciona a eventos fiscales; el módulo fiscal no depende del inventario.

## Consequences

- La emisión funciona con el inventario desactivado.
- No hay reportes de valorización.
- Q-18 a Q-21 definen el momento del descuento, el stock negativo, la devolución y el saldo inicial.
