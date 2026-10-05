# ADR 0006: Inventario opcional y mínimo

## Status

Accepted. Origen: ERS §22.2, ADR-006. Q-18 y Q-19 resueltas el 2026-10-04 en la revisión de
readiness de `add-minimal-inventory`, por decisión del dueño del producto.

## Context

El inventario facilita la facturación, pero no es el objetivo del producto, y su
complejidad crece rápido con costeo, bodegas y lotes.

## Decision

- El control de stock se activa por producto.
- Movimientos `INICIAL`, `ENTRADA_MANUAL`, `SALIDA_FACTURA`, `DEVOLUCION_NC` y `AJUSTE`, solo de agregado.
- Sin costo promedio, valorización ni multibodega.
- El inventario reacciona a eventos fiscales; el módulo fiscal no depende del inventario.
- La salida de una factura nace solo cuando el comprobante entra en `AUTHORIZED`, en la misma transacción que esa transición, mediante el puerto genérico de seguidores de transición (Q-18). Ningún otro estado modifica el stock.
- El stock es el contabilizado por hechos fiscales autorizados, no una reserva de disponibilidad: sin stock reservado, comprometido ni disponible para prometer.
- Se permite el stock negativo: el inventario nunca bloquea la emisión ni la autorización, y el saldo negativo se muestra tal cual (Q-19). El borrador solo advierte, de forma orientativa.

## Consequences

- La emisión funciona con el inventario desactivado.
- No hay reportes de valorización.
- Con la transmisión apagada, las facturas pendientes no descuentan stock, y entre la emisión y la autorización se puede vender lo que ya no hay. Es intencional; impedir la sobreventa antes de autorizar sería una capacidad separada de reserva o disponibilidad.
- Las facturas que no se autorizan (`RETURNED`, `NOT_AUTHORIZED`) nunca afectaron el stock, así que no necesitan compensación.
- Q-21 quedó resuelta por el design D3 de `add-minimal-inventory`: un solo `INICIAL` por producto. Q-20 quedó resuelta el 2026-10-04: la devolución por nota de crédito (`DEVOLUCION_NC`) nace solo cuando la nota entra en `AUTHORIZED`, en la misma transacción y por el mismo puerto de seguidores, por el retorno físico que el usuario declara, según el snapshot de la factura original y sin superar lo que su salida sacó y todavía no se devolvió.
