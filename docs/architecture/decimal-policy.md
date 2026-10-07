# Política decimal

Regla vigente para importes, precios, cantidades y tarifas en contratos, backend, base de datos y
frontend. Origen: design D10 de `add-fiscal-catalogs` y D9 de `add-parties-and-products`. Ningún
importe ni tarifa pasa por un `number` de JavaScript.

## Representación universal

`DecimalString` es el texto decimal del producto: `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`.

- **No admite:** exponente, coma decimal, separadores de miles, ceros a la izquierda, espacios, signo `+` ni `-0`.
- **Signo:** admite negativos, porque algunos campos del XSD no tienen mínimo. "Sin signo" es una propiedad de cada tipo, no del texto universal.
- **JSON:** un número JSON se rechaza siempre, porque ya pasó por coma flotante.

## Especificaciones

Viven en `packages/contracts/src/decimal.ts` (`DECIMAL_SPECS`), las comparten backend y frontend,
y cada una nombra el tipo XSD de origen. Una prueba compara cada especificación con los
`simpleType` de los seis XSD soportados. La excepción es `existencia`, un dominio interno del
inventario que no sale de ningún XSD.

| Especificación | Tipo del dominio | Dígitos totales | Decimales | Mínimo | Ejemplos válidos en el límite | Uso |
| --- | --- | --- | --- | --- | --- | --- |
| `tarifa` | `Percentage` | 4 | 2 | 0 | `9999`, `99.99`, `100`, `300` | Porcentaje de una tarifa |
| `importe` | `Money` | 14 | 2 | 0 | `99999999999999`, `999999999999.99` | Monto de la política de consumidor final; importes de la emisión |
| `precioUnitario` | `UnitPrice` | 18 | 6 | 0 | `999999999999999999`, `999999999999.999999` | Precio unitario de productos, sin impuestos |
| `cantidad` | `Quantity` | 18 | 6 | 0 | `999999999999999999`, `999999999999.999999` | Cantidades de la emisión. En la guía de remisión, mayor que cero aunque el XSD admita 0 (política del proyecto, P7 de Q-51); se guarda y se escribe en su forma canónica, sin redondeo (`2.500` es `2.5`), y más de 6 decimales se rechaza |
| `porcentajeRetener` | — | 3 | 2 | 0 | `999`, `100`, `9.99`, `1.75` | Porcentaje de una retención (`porcentajeRetener` del comprobante de retención 2.0.0) y la `tarifa` del impuesto declarado de su documento sustento, que el mismo XSD define con la misma escala (design D6 y D13 de `add-withholding-receipts`). `100` cumple los 3 dígitos en su forma canónica; `100.00` no |
| `existencia` | `StockQuantity` | 30 | 6 | Sin mínimo (con signo) | `999999999999999999999999.999999`, `-999999999999999999999999.999999` | Variaciones y saldos del inventario (design D3 de `add-minimal-inventory`): los decimales de `cantidad` y una parte entera que admite la salida de una factura de 1 000 líneas de cantidad máxima. Un saldo puede ser negativo (Q-19). |

- **Regla del XSD (Q-43):** la parte entera usa los dígitos que no ocupan los decimales; nunca `totalDigits` enteros más `fractionDigits` decimales. La semántica de `NUMERIC(p, s)`, que limitaría la parte entera a `p - s`, no es la regla.
- **Primitivos compartidos:** una especificación no lleva límites normativos de un impuesto o de un código.
  - `tarifa` no tiene un máximo de 100: la ficha v2.34 publica tarifas de ICE superiores.
  - Un límite así pertenece al catálogo del impuesto, con su fuente.
- **Excepción conocida:** la retención 2.0.0 define `tarifa` y `porcentajeRetener` con 3 dígitos y 2 decimales: es la especificación `porcentajeRetener` (`add-withholding-receipts`). El porcentaje de la retención y la tarifa de su documento sustento se escriben en su forma canónica sin ceros finales (`1.75`, `10`, `100`).

## Validación al recibir

1. Se valida primero el `DecimalString` universal.
2. Después, la especificación (`decimalSpecViolation`):
   - **Decimales:** como máximo `fractionDigits`, contados como se escriben. `1.1234560` tiene 7 decimales y se rechaza.
   - **Total:** como máximo `totalDigits`, contados como se escriben y sin el cero entero de `0.5`.
     - `1234567890123.123456` (19 dígitos) se rechaza como precio unitario.
     - `1234567890123.123450` también se rechaza, porque su cero final cuenta.
   - **Mínimo:** el de la especificación.
3. Nunca se redondea al recibir: un valor fuera de la especificación es un error de validación con el mensaje de su límite.

## Dominio y base de datos

- **Dominio:** `decimal.js` 10.6.0, envuelto en `platform/decimal` con una instancia propia (precisión 40), detrás de `FiscalDecimal(spec)` y sus tipos.
- **Base de datos:**
  - Cada campo es `NUMERIC` sin precisión ni escala fijas, que guarda el valor exacto sin redondear. `NUMERIC(p, s)` no se usa: limitaría la parte entera a `p - s` dígitos y redondearía en silencio los decimales de más.
  - Un `CHECK` de dominio fija la especificación: mínimo, `scale(valor) <= fractionDigits` y `valor < 10^(totalDigits - scale(valor))`.
  - Se guarda la forma canónica (`toDatabase`), así que la escala guardada es la del valor.
  - Columnas: `product.unit_price` (`precioUnitario`), `fiscal_catalog_entry.percentage` (`tarifa`), `consumer_final_policy.max_amount` (`importe`) y, desde `add-invoice-emission`, `invoice_draft_line.quantity` (`cantidad`), `invoice_draft_line.discount`, `invoice_draft_payment.amount` y `electronic_document.total` (`importe`); desde `add-minimal-inventory`, `stock_balance.balance`, `stock_movement.delta` y `stock_movement.balance_after` (`existencia`), sin mínimo; desde `add-withholding-receipts`, `withholding_receipt_line.base` (`importe`, mayor que cero), `withholding_receipt_line.percentage` (`porcentajeRetener`) y `withholding_receipt_line.amount` (`importe`), con el porcentaje de los catálogos de retención en `fiscal_catalog_entry.percentage` acotado a 3 dígitos por su `CHECK` de atributos.
- **Conversión:** con el `Decimal` de Prisma siempre por texto.
- **Aritmética fiscal** (design D5 de `add-invoice-emission`):
  - **Primitivas exactas** de `platform/decimal`: `sumExact`, `subtractExact`, `multiplyExact` y `percentageOfExact`, sobre `DecimalString` y sin redondeo. La precisión de 40 dígitos cubre el producto de dos valores de 18 dígitos. Una operación que necesitara más dígitos lanza `InexactOperationError` en vez de redondear en silencio.
  - **`roundHalfUp(valor, escala)`** es el único redondeo.
  - **Funciones de dominio** en el módulo fiscal neutral `fiscal/domain/document-amounts.ts`, una por concepto: `lineSubtotal`, `lineDiscount`, `taxableBase`, `taxAmount`, `lineAmounts`, `materializeMoney` y `documentTotals`. Validan cada entrada con su especificación y nunca usan `number` ni `decimal.js` directamente. Nacieron en la factura y se movieron sin cambiar sus resultados (design D8 de `add-purchase-settlements`): `invoices/domain/amounts.ts` las reexporta con sus nombres (`invoiceTotals`, `InvoiceAmountError`) y la liquidación de compra las usa sin importar `invoices` (ADR 0002). No conocen ningún tipo de comprobante.
  - **Puntos de materialización HALF_UP**, a la escala de `importe`: la base de la línea (subtotal exacto menos descuento), el impuesto de la línea (porcentaje de la base ya materializada) y los totales, que solo fijan la escala de sumas ya exactas.
  - **Límite del esquema:** cada importe materializado se comprueba con `importe` (14/2). Un valor que no cabe es `AMOUNT_OUT_OF_RANGE`, antes de reservar.
  - **Descuento:** importe de 2 decimales entre 0 y el subtotal exacto de la línea (`DISCOUNT_EXCEEDS_SUBTOTAL`), sin redondear.
  - Ningún handler ni builder opera con `decimal.js`; el builder XML no calcula.
  - **Retención** (design D13 de `add-withholding-receipts`): `calculateWithholdingAmounts` (`withholding-receipts/domain/amounts.ts`, versión `1`) materializa cada valor retenido HALF_UP a 2 decimales una sola vez (`base × porcentaje / 100`) y suma exactamente el total retenido; la base es un `importe` mayor que cero y el porcentaje un `porcentajeRetener`. A 2 decimales, el mayor importe que cabe es `999999999999.99`.
  - Una tabla dorada (`backend/test/invoices/amounts.test.ts`) fija los casos de la spec y de S-3: empates, totales desde valores materializados, varias líneas con descuento, consumidor final y regresiones de 17 y 18 dígitos. Una prueba de fuente impide `number` y `decimal.js` en el dominio.
- **Redondeo (Q-14):** política del producto, no regla textual del SRI.
  - Los cálculos internos son exactos, sin redondeos intermedios.
  - Un campo fiscal se redondea HALF_UP solo al materializarlo a la escala de su XSD.
  - Los totales se construyen con los valores ya materializados.
  - La validó la parte offline de S-3. La autorización en Pruebas del SRI (parte online) es la compuerta de go-live, y una contradicción abre `/opsx:update`.

## Salida y frontend

- **Salida:** la API devuelve la forma exacta más corta, sin exponente ni ceros finales (`15`, `12.5`).
- **Frontend:**
  - formatea las cadenas con la convención es-EC (`formatDecimal`, `formatPercentage`, `formatUsd`), sin convertir a `number`;
  - las entradas usan `inputMode="decimal"` y envían texto.
